use snforge_std::signature::stark_curve::{
    StarkCurveKeyPair, StarkCurveKeyPairImpl, StarkCurveSignerImpl,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::mock_privacy_pool::{IMockPrivacyPoolDispatcher, IMockPrivacyPoolDispatcherTrait};
use crate::refill_helper::{
    ClaimRequest, FundRequest, IRefillHelperDispatcher, IRefillHelperDispatcherTrait,
    OpenNoteDeposit, RefillOperation, RefillStatus, RefundRequest, compute_claim_commitment,
    compute_recovery_commitment, compute_safe_return_message_hash,
};
use crate::test_token::{ITestTokenDispatcher, ITestTokenDispatcherTrait};

const DIRECT_CALLER: felt252 = 0x200;
const NOW: u64 = 1_800_000_000;
const AMOUNT: u128 = 1_000;

#[test]
fn safe_return_hash_matches_sdk_vector() {
    let helper: ContractAddress = 0x1234.try_into().unwrap();
    let token: ContractAddress = 0x333.try_into().unwrap();
    let recovery_account: ContractAddress = 0x5678.try_into().unwrap();

    assert(
        compute_safe_return_message_hash(
            chain_id: 'SN_SEPOLIA',
            recovery_account: recovery_account,
            helper: helper,
            state_id: 0x111,
            expiry: 1_800_003_600,
            token: token,
            amount: 1_000,
            note_id: 0x444,
        ) == 0x3c38077faa10fc1942347c9cd014fa9c89b58aa93c5922b7e773c4d3a4edefc,
        'SAFE_RETURN_HASH_MISMATCH',
    );
}

#[derive(Copy, Drop)]
struct Setup {
    helper: ContractAddress,
    pool: ContractAddress,
    token: ContractAddress,
    recovery_account: ContractAddress,
    recovery_salt: felt252,
    claim_key: StarkCurveKeyPair,
}

fn deploy_contract(name: ByteArray, constructor_calldata: Array<felt252>) -> ContractAddress {
    let contract = declare(name).unwrap().contract_class();
    let (address, _) = contract.deploy(@constructor_calldata).unwrap();
    address
}

fn setup() -> Setup {
    let token = deploy_contract("TestToken", array![]);
    let pool = deploy_contract("MockPrivacyPool", array![]);
    let recovery_account = deploy_contract("TestAccount", array![]);
    let helper = deploy_contract("RefillHelper", array![pool.into(), token.into()]);
    start_cheat_block_timestamp(helper, NOW);
    Setup {
        helper,
        pool,
        token,
        recovery_account,
        recovery_salt: 0x987,
        claim_key: StarkCurveKeyPairImpl::from_secret_key(0x12345),
    }
}

fn fund_request(setup: Setup, state_id: felt252) -> FundRequest {
    FundRequest {
        state_id,
        claim_commitment: compute_claim_commitment(state_id, setup.claim_key.public_key),
        recovery_commitment: compute_recovery_commitment(
            state_id, setup.recovery_account, setup.recovery_salt,
        ),
        token: setup.token,
        amount: AMOUNT,
        expiry: NOW + 3600,
    }
}

fn mint(setup: Setup, recipient: ContractAddress, amount: u128) {
    ITestTokenDispatcher { contract_address: setup.token }.mint(recipient, amount.into());
}

fn fund(setup: Setup, state_id: felt252) -> Span<crate::refill_helper::OpenNoteDeposit> {
    IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .fund_helper(setup.helper, fund_request(setup, state_id));
    array![].span()
}

fn claim_request(setup: Setup, state_id: felt252, note_id: felt252) -> ClaimRequest {
    let helper = IRefillHelperDispatcher { contract_address: setup.helper };
    let nonce = 0xabc;
    let message_hash = helper.claim_message_hash(state_id, note_id, nonce);
    let (signature_r, signature_s) = StarkCurveSignerImpl::sign(setup.claim_key, message_hash)
        .unwrap();
    ClaimRequest {
        state_id,
        note_id,
        nonce,
        claim_public_key: setup.claim_key.public_key,
        signature_r,
        signature_s,
    }
}

fn claim(setup: Setup, request: ClaimRequest) -> Span<OpenNoteDeposit> {
    let deposit = IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_and_deposit(setup.helper, RefillOperation::Claim(request));
    array![deposit].span()
}

fn refund_request(setup: Setup, state_id: felt252, note_id: felt252) -> RefundRequest {
    RefundRequest {
        state_id,
        note_id,
        recovery_account: setup.recovery_account,
        recovery_salt: setup.recovery_salt,
        signature: array![0x123],
    }
}

fn refund(setup: Setup, request: RefundRequest) -> Span<OpenNoteDeposit> {
    let deposit = IMockPrivacyPoolDispatcher { contract_address: setup.pool }
        .invoke_and_deposit(setup.helper, RefillOperation::Refund(request));
    array![deposit].span()
}

#[test]
fn configured_pool_records_fund_and_returns_no_open_note() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);

    let deposits = fund(setup, 1);
    let helper = IRefillHelperDispatcher { contract_address: setup.helper };
    let state = helper.get_state(1);

    assert(deposits.is_empty(), 'EXPECTED_EMPTY_RETURN');
    assert(helper.state_exists(1), 'STATE_NOT_RECORDED');
    assert(helper.total_liability() == AMOUNT.into(), 'WRONG_LIABILITY');
    assert(state.amount == AMOUNT, 'WRONG_AMOUNT');
    assert(state.status == RefillStatus::Funded, 'WRONG_STATUS');
}

#[test]
#[should_panic(expected: 'ONLY_PRIVACY_POOL')]
fn rejects_direct_non_pool_call() {
    let setup = setup();
    mint(setup, setup.helper, AMOUNT);
    start_cheat_caller_address(setup.helper, DIRECT_CALLER.try_into().unwrap());

    IRefillHelperDispatcher { contract_address: setup.helper }
        .privacy_invoke(RefillOperation::Fund(fund_request(setup, 1)));
}

#[test]
#[should_panic(expected: 'STATE_EXISTS')]
fn rejects_duplicate_state() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);

    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);
}

#[test]
fn surplus_token_cannot_block_fund_or_claim() {
    let setup = setup();
    mint(setup, setup.helper, 1);
    mint(setup, setup.pool, AMOUNT);

    fund(setup, 1);
    let deposits = claim(setup, claim_request(setup, 1, 0x444));
    let helper = IRefillHelperDispatcher { contract_address: setup.helper };
    let token = ITestTokenDispatcher { contract_address: setup.token };

    assert(deposits.len() == 1, 'EXPECTED_ONE_DEPOSIT');
    assert(helper.total_liability() == 0, 'LIABILITY_NOT_CLEARED');
    assert(token.balance_of(setup.helper) == 1, 'SURPLUS_NOT_PRESERVED');
}

#[test]
fn claim_returns_exact_open_note_and_reconciles_after_pool_transfer() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);

    let deposits = claim(setup, claim_request(setup, 1, 0x444));
    let helper = IRefillHelperDispatcher { contract_address: setup.helper };
    let token = ITestTokenDispatcher { contract_address: setup.token };
    let deposit = *deposits.at(0);
    let pool = IMockPrivacyPoolDispatcher { contract_address: setup.pool };

    assert(deposits.len() == 1, 'EXPECTED_ONE_DEPOSIT');
    assert(deposit.note_id == 0x444, 'WRONG_NOTE');
    assert(deposit.token == setup.token, 'WRONG_TOKEN');
    assert(deposit.amount == AMOUNT, 'WRONG_AMOUNT');
    assert(helper.get_state(1).status == RefillStatus::Claimed, 'WRONG_STATUS');
    assert(helper.total_liability() == 0, 'LIABILITY_NOT_CLEARED');
    assert(token.allowance(setup.helper, setup.pool) == 0, 'ALLOWANCE_REMAINS');
    assert(token.balance_of(setup.helper) == 0, 'HELPER_RESIDUE');
    assert(pool.open_note(0x444) == (setup.token, AMOUNT), 'OPEN_NOTE_NOT_FILLED');
}

#[test]
#[should_panic(expected: 'INVALID_SIGNATURE')]
fn claim_signature_is_bound_to_open_note() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);

    let mut request = claim_request(setup, 1, 0x444);
    request.note_id = 0x445;
    claim(setup, request);
}

#[test]
#[should_panic(expected: 'STATE_NOT_FUNDED')]
fn claim_cannot_be_replayed() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);

    let request = claim_request(setup, 1, 0x444);
    claim(setup, request);
    claim(setup, request);
}

#[test]
fn refund_returns_exact_open_note_after_expiry() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);
    start_cheat_block_timestamp(setup.helper, NOW + 3601);

    let deposits = refund(setup, refund_request(setup, 1, 0x555));
    let helper = IRefillHelperDispatcher { contract_address: setup.helper };
    let token = ITestTokenDispatcher { contract_address: setup.token };
    let deposit = *deposits.at(0);
    let pool = IMockPrivacyPoolDispatcher { contract_address: setup.pool };

    assert(deposits.len() == 1, 'EXPECTED_ONE_DEPOSIT');
    assert(deposit.note_id == 0x555, 'WRONG_NOTE');
    assert(deposit.token == setup.token, 'WRONG_TOKEN');
    assert(deposit.amount == AMOUNT, 'WRONG_AMOUNT');
    assert(helper.get_state(1).status == RefillStatus::Refunded, 'WRONG_STATUS');
    assert(helper.total_liability() == 0, 'LIABILITY_NOT_CLEARED');
    assert(token.allowance(setup.helper, setup.pool) == 0, 'ALLOWANCE_REMAINS');
    assert(token.balance_of(setup.helper) == 0, 'HELPER_RESIDUE');
    assert(pool.open_note(0x555) == (setup.token, AMOUNT), 'OPEN_NOTE_NOT_FILLED');
}

#[test]
#[should_panic(expected: 'NOT_EXPIRED')]
fn refund_is_rejected_before_expiry() {
    let setup = setup();
    mint(setup, setup.pool, AMOUNT);
    fund(setup, 1);

    refund(setup, refund_request(setup, 1, 0x555));
}
