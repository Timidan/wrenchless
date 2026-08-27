use snforge_std::signature::stark_curve::{
    StarkCurveKeyPair, StarkCurveKeyPairImpl, StarkCurveSignerImpl,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp};
use starknet::ContractAddress;
use crate::mock_privacy_pool::{IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use crate::test_token::{ITestTokenDispatcher, ITestTokenDispatcherTrait};
use crate::travel_safe_v3::{
    ClaimEarlyRequestV3, ExtendRequestV3, FundRequestV3, ITravelSafeHelperV3Dispatcher,
    ITravelSafeHelperV3DispatcherTrait, MAX_SAFE_DURATION_SECONDS, RefundRequestV3,
    ReleaseAllowanceRequestV3, SafeOperationV3, SafeStatusV3, TopUpRequestV3,
    compute_v3_claim_commitment, compute_v3_device_commitment, compute_v3_recovery_commitment,
};

const NOW: u64 = 1_800_000_000;
const DAY: u64 = 86_400;
const AMOUNT: u128 = 1_000;
const DAILY_AMOUNT: u128 = 100;

#[derive(Copy, Drop)]
struct Setup {
    helper: ContractAddress,
    pool: ContractAddress,
    token_a: ContractAddress,
    token_b: ContractAddress,
    recovery_account: ContractAddress,
    recovery_salt: felt252,
    device_key: StarkCurveKeyPair,
    claim_key: StarkCurveKeyPair,
}

fn deploy_contract(name: ByteArray, constructor_calldata: Array<felt252>) -> ContractAddress {
    let contract = declare(name).unwrap().contract_class();
    let (address, _) = contract.deploy(@constructor_calldata).unwrap();
    address
}

fn setup() -> Setup {
    let token_a = deploy_contract("TestToken", array![]);
    let token_b = deploy_contract("TestToken", array![]);
    let pool = deploy_contract("MockPrivacyPool", array![]);
    let recovery_account = deploy_contract("TestAccount", array![]);
    let helper = deploy_contract(
        "TravelSafeHelperV3", array![pool.into(), 2, token_a.into(), token_b.into()],
    );
    start_cheat_block_timestamp(helper, NOW);
    Setup {
        helper,
        pool,
        token_a,
        token_b,
        recovery_account,
        recovery_salt: 0x987,
        device_key: StarkCurveKeyPairImpl::from_secret_key(0x12345),
        claim_key: StarkCurveKeyPairImpl::from_secret_key(0x67890),
    }
}

fn mint(token: ContractAddress, recipient: ContractAddress, amount: u128) {
    ITestTokenDispatcher { contract_address: token }.mint(recipient, amount.into());
}

fn fund_request(
    setup: Setup, state_id: felt252, token: ContractAddress, amount: u128,
) -> FundRequestV3 {
    FundRequestV3 {
        state_id,
        claim_commitment: compute_v3_claim_commitment(state_id, setup.claim_key.public_key),
        device_commitment: compute_v3_device_commitment(state_id, setup.device_key.public_key),
        recovery_commitment: compute_v3_recovery_commitment(
            state_id, setup.recovery_account, setup.recovery_salt,
        ),
        token,
        amount,
        daily_amount: DAILY_AMOUNT,
        first_release_at: NOW + DAY,
        return_at: NOW + 10 * DAY,
    }
}

fn fund(setup: Setup, state_id: felt252, token: ContractAddress, amount: u128) {
    mint(token, setup.pool, amount);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .fund_v3_helper(setup.helper, fund_request(setup, state_id, token, amount));
}

fn release_request(setup: Setup, state_id: felt252, note_id: felt252) -> ReleaseAllowanceRequestV3 {
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(state_id);
    let amount = helper.claimable_amount(state_id);
    let message_hash = helper.action_message_hash(state_id, 'RELEASE', amount, note_id);
    let (signature_r, signature_s) = StarkCurveSignerImpl::sign(setup.device_key, message_hash)
        .unwrap();
    ReleaseAllowanceRequestV3 {
        state_id,
        note_id,
        nonce: state.action_nonce,
        device_public_key: setup.device_key.public_key,
        signature_r,
        signature_s,
    }
}

fn release(
    setup: Setup, request: ReleaseAllowanceRequestV3,
) -> crate::travel_safe_v3::OpenNoteDepositV3 {
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_and_deposit(setup.helper, SafeOperationV3::Release(request))
}

fn top_up_request(setup: Setup, state_id: felt252, amount: u128) -> TopUpRequestV3 {
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(state_id);
    let message_hash = helper.action_message_hash(state_id, 'TOP_UP', amount, 0);
    let (signature_r, signature_s) = StarkCurveSignerImpl::sign(setup.device_key, message_hash)
        .unwrap();
    TopUpRequestV3 {
        state_id,
        token: state.token,
        amount,
        nonce: state.action_nonce,
        device_public_key: setup.device_key.public_key,
        signature_r,
        signature_s,
    }
}

fn extend_request(setup: Setup, state_id: felt252, new_return_at: u64) -> ExtendRequestV3 {
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(state_id);
    let message_hash = helper.action_message_hash(state_id, 'EXTEND', new_return_at.into(), 0);
    let (signature_r, signature_s) = StarkCurveSignerImpl::sign(setup.device_key, message_hash)
        .unwrap();
    ExtendRequestV3 {
        state_id,
        new_return_at,
        nonce: state.action_nonce,
        device_public_key: setup.device_key.public_key,
        signature_r,
        signature_s,
    }
}

fn claim_early_request(setup: Setup, state_id: felt252, note_id: felt252) -> ClaimEarlyRequestV3 {
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(state_id);
    let message_hash = helper
        .action_message_hash(state_id, 'CLAIM_EARLY', state.remaining_amount, note_id);
    let (signature_r, signature_s) = StarkCurveSignerImpl::sign(setup.claim_key, message_hash)
        .unwrap();
    ClaimEarlyRequestV3 {
        state_id,
        note_id,
        nonce: state.action_nonce,
        claim_public_key: setup.claim_key.public_key,
        signature_r,
        signature_s,
    }
}

fn refund_request(setup: Setup, state_id: felt252, note_id: felt252) -> RefundRequestV3 {
    let state = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper }
        .get_state(state_id);
    RefundRequestV3 {
        state_id,
        note_id,
        nonce: state.action_nonce,
        recovery_account: setup.recovery_account,
        recovery_salt: setup.recovery_salt,
        signature: array![0x123],
    }
}

#[test]
fn supports_two_tokens_and_tracks_exact_liability() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    fund(setup, 2, setup.token_b, 500);
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };

    assert(helper.is_supported_token(setup.token_a), 'TOKEN_A_NOT_SUPPORTED');
    assert(helper.is_supported_token(setup.token_b), 'TOKEN_B_NOT_SUPPORTED');
    assert(helper.liability_for(setup.token_a) == AMOUNT.into(), 'WRONG_A_LIABILITY');
    assert(helper.liability_for(setup.token_b) == 500, 'WRONG_B_LIABILITY');
    assert(helper.get_state(1).remaining_amount == AMOUNT, 'WRONG_STATE_AMOUNT');
}

#[test]
#[should_panic]
fn rejects_duplicate_constructor_token() {
    let token = deploy_contract("TestToken", array![]);
    let pool = deploy_contract("MockPrivacyPool", array![]);
    deploy_contract("TravelSafeHelperV3", array![pool.into(), 2, token.into(), token.into()]);
}

#[test]
#[should_panic]
fn rejects_zero_constructor_token() {
    let pool = deploy_contract("MockPrivacyPool", array![]);
    deploy_contract("TravelSafeHelperV3", array![pool.into(), 1, 0]);
}

#[test]
#[should_panic(expected: 'WRONG_TOKEN')]
fn rejects_unconfigured_token() {
    let setup = setup();
    let other = deploy_contract("TestToken", array![]);
    mint(other, setup.pool, AMOUNT);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .fund_v3_helper(setup.helper, fund_request(setup, 1, other, AMOUNT));
}

#[test]
fn releases_only_accumulated_allowance_into_the_exact_note() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };

    start_cheat_block_timestamp(setup.helper, NOW + DAY - 1);
    assert(helper.claimable_amount(1) == 0, 'RELEASED_FUTURE_DAY');
    start_cheat_block_timestamp(setup.helper, NOW + DAY);
    assert(helper.claimable_amount(1) == DAILY_AMOUNT, 'FIRST_DAY_MISSING');
    start_cheat_block_timestamp(setup.helper, NOW + 3 * DAY);
    assert(helper.claimable_amount(1) == 3 * DAILY_AMOUNT, 'MISSED_DAYS_NOT_ACCRUED');

    let deposit = release(setup, release_request(setup, 1, 0x444));
    let state = helper.get_state(1);
    let pool = IMockPrivacyPoolDispatcher { contract_address: setup.pool };
    assert(deposit.note_id == 0x444, 'WRONG_NOTE');
    assert(deposit.amount == 300, 'WRONG_RELEASE');
    assert(state.remaining_amount == 700, 'WRONG_REMAINING');
    assert(state.released_amount == 300, 'WRONG_RELEASED_TOTAL');
    assert(state.action_nonce == 1, 'NONCE_NOT_CONSUMED');
    assert(helper.liability_for(setup.token_a) == 700, 'LIABILITY_NOT_REDUCED');
    assert(pool.open_note(0x444) == (setup.token_a, 300), 'OPEN_NOTE_NOT_FILLED');
}

#[test]
#[should_panic(expected: 'INVALID_SIGNATURE')]
fn release_signature_is_bound_to_note() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    start_cheat_block_timestamp(setup.helper, NOW + DAY);
    let mut request = release_request(setup, 1, 0x444);
    request.note_id = 0x445;
    release(setup, request);
}

#[test]
#[should_panic(expected: 'INVALID_NONCE')]
fn release_signature_cannot_be_replayed() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    start_cheat_block_timestamp(setup.helper, NOW + DAY);
    let request = release_request(setup, 1, 0x444);
    release(setup, request);
    release(setup, request);
}

#[test]
fn top_up_increases_liability_but_not_scheduled_entitlement() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    let request = top_up_request(setup, 1, 500);
    mint(setup.token_a, setup.pool, 500);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .top_up_v3_helper(setup.helper, request);

    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(1);
    assert(state.initial_amount == AMOUNT, 'INITIAL_AMOUNT_CHANGED');
    assert(state.remaining_amount == 1_500, 'TOP_UP_NOT_RECORDED');
    assert(helper.liability_for(setup.token_a) == 1_500, 'TOP_UP_LIABILITY_WRONG');

    start_cheat_block_timestamp(setup.helper, state.return_at);
    assert(helper.claimable_amount(1) == AMOUNT, 'TOP_UP_CHANGED_ENTITLEMENT');
}

#[test]
fn extend_moves_only_the_return_date_and_consumes_nonce() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    let request = extend_request(setup, 1, NOW + 20 * DAY);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_without_deposit(setup.helper, SafeOperationV3::Extend(request));

    let state = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper }.get_state(1);
    assert(state.return_at == NOW + 20 * DAY, 'RETURN_NOT_EXTENDED');
    assert(state.max_return_at == NOW + MAX_SAFE_DURATION_SECONDS, 'MAX_RETURN_CHANGED');
    assert(state.action_nonce == 1, 'NONCE_NOT_CONSUMED');
}

#[test]
#[should_panic(expected: 'NOT_AN_EXTENSION')]
fn extend_rejects_same_date() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    let state = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper }.get_state(1);
    let request = extend_request(setup, 1, state.return_at);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_without_deposit(setup.helper, SafeOperationV3::Extend(request));
}

#[test]
#[should_panic(expected: 'EXTENSION_TOO_LATE')]
fn extend_rejects_date_after_absolute_lifetime() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    let request = extend_request(setup, 1, NOW + MAX_SAFE_DURATION_SECONDS + 1);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_without_deposit(setup.helper, SafeOperationV3::Extend(request));
}

#[test]
#[should_panic(expected: 'RETURN_ALREADY_OPEN')]
fn extend_rejects_after_return_is_open() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    start_cheat_block_timestamp(setup.helper, NOW + 10 * DAY);
    let request = extend_request(setup, 1, NOW + 20 * DAY);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_without_deposit(setup.helper, SafeOperationV3::Extend(request));
}

#[test]
fn early_claim_releases_everything_and_is_terminal() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    let deposit = IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_and_deposit(
            setup.helper, SafeOperationV3::ClaimEarly(claim_early_request(setup, 1, 0x555)),
        );
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(1);
    assert(deposit.amount == AMOUNT, 'WRONG_EARLY_AMOUNT');
    assert(state.remaining_amount == 0, 'EARLY_REMAINDER');
    assert(state.status == SafeStatusV3::Claimed, 'EARLY_NOT_TERMINAL');
    assert(helper.liability_for(setup.token_a) == 0, 'EARLY_LIABILITY_REMAINS');
}

#[test]
fn refund_releases_everything_strictly_after_return() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    start_cheat_block_timestamp(setup.helper, NOW + 10 * DAY + 1);
    let deposit = IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_and_deposit(
            setup.helper, SafeOperationV3::Refund(refund_request(setup, 1, 0x666)),
        );
    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let state = helper.get_state(1);
    assert(deposit.amount == AMOUNT, 'WRONG_REFUND_AMOUNT');
    assert(state.remaining_amount == 0, 'REFUND_REMAINDER');
    assert(state.status == SafeStatusV3::Refunded, 'REFUND_NOT_TERMINAL');
    assert(helper.liability_for(setup.token_a) == 0, 'REFUND_LIABILITY_REMAINS');
}

#[test]
#[should_panic(expected: 'NOT_RETURNABLE')]
fn refund_rejects_return_boundary() {
    let setup = setup();
    fund(setup, 1, setup.token_a, AMOUNT);
    start_cheat_block_timestamp(setup.helper, NOW + 10 * DAY);
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_v3_and_deposit(
            setup.helper, SafeOperationV3::Refund(refund_request(setup, 1, 0x666)),
        );
}

#[test]
fn surplus_tokens_never_become_liability() {
    let setup = setup();
    mint(setup.token_a, setup.helper, 1);
    fund(setup, 1, setup.token_a, AMOUNT);
    start_cheat_block_timestamp(setup.helper, NOW + DAY);
    release(setup, release_request(setup, 1, 0x777));

    let helper = ITravelSafeHelperV3Dispatcher { contract_address: setup.helper };
    let token = ITestTokenDispatcher { contract_address: setup.token_a };
    assert(helper.liability_for(setup.token_a) == 900, 'WRONG_LIABILITY');
    assert(token.balance_of(setup.helper) == 901, 'SURPLUS_NOT_PRESERVED');
}
