use core::hash::{HashStateExTrait, HashStateTrait};
use core::poseidon::PoseidonTrait;
use starknet::ContractAddress;

pub const MAX_SAFE_DURATION_SECONDS: u64 = 15_552_000;
const MAX_SUPPORTED_TOKENS: u32 = 8;
const TRAVEL_SAFE_SNIP12_NAME: felt252 = 'WrenchlessSafe';
const TRAVEL_SAFE_SNIP12_VERSION: felt252 = 3;
const STARKNET_DOMAIN_TYPE_HASH: felt252 =
    0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210;
const SAFE_ACTION_TYPE_HASH: felt252 = selector!(
    "\"TravelSafeAction\"(\"operation\":\"shortstring\",\"stateId\":\"felt\",\"nonce\":\"u128\",\"token\":\"ContractAddress\",\"remainingAmount\":\"u128\",\"value\":\"u128\",\"firstReleaseAt\":\"u128\",\"returnAt\":\"u128\",\"noteId\":\"felt\")",
);
const SAFE_RETURN_TYPE_HASH: felt252 = selector!(
    "\"TravelSafeReturn\"(\"helper\":\"ContractAddress\",\"stateId\":\"felt\",\"nonce\":\"u128\",\"token\":\"ContractAddress\",\"remainingAmount\":\"u128\",\"returnAt\":\"u128\",\"noteId\":\"felt\")",
);

#[derive(Copy, Drop, Hash)]
struct StarknetDomainV3 {
    name: felt252,
    version: felt252,
    chain_id: felt252,
    revision: felt252,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct OpenNoteDepositV3 {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct FundRequestV3 {
    pub state_id: felt252,
    pub claim_commitment: felt252,
    pub device_commitment: felt252,
    pub recovery_commitment: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub daily_amount: u128,
    pub first_release_at: u64,
    pub return_at: u64,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct ReleaseAllowanceRequestV3 {
    pub state_id: felt252,
    pub note_id: felt252,
    pub nonce: u64,
    pub device_public_key: felt252,
    pub signature_r: felt252,
    pub signature_s: felt252,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct TopUpRequestV3 {
    pub state_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub nonce: u64,
    pub device_public_key: felt252,
    pub signature_r: felt252,
    pub signature_s: felt252,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct ExtendRequestV3 {
    pub state_id: felt252,
    pub new_return_at: u64,
    pub nonce: u64,
    pub device_public_key: felt252,
    pub signature_r: felt252,
    pub signature_s: felt252,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct ClaimEarlyRequestV3 {
    pub state_id: felt252,
    pub note_id: felt252,
    pub nonce: u64,
    pub claim_public_key: felt252,
    pub signature_r: felt252,
    pub signature_s: felt252,
}

#[derive(Drop, Serde, PartialEq, Debug)]
pub struct RefundRequestV3 {
    pub state_id: felt252,
    pub note_id: felt252,
    pub nonce: u64,
    pub recovery_account: ContractAddress,
    pub recovery_salt: felt252,
    pub signature: Array<felt252>,
}

#[derive(Drop, Serde, PartialEq, Debug)]
pub enum SafeOperationV3 {
    Fund: FundRequestV3,
    Release: ReleaseAllowanceRequestV3,
    TopUp: TopUpRequestV3,
    Extend: ExtendRequestV3,
    ClaimEarly: ClaimEarlyRequestV3,
    Refund: RefundRequestV3,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum SafeStatusV3 {
    #[default]
    Missing,
    Funded,
    Claimed,
    Refunded,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct SafeStateV3 {
    pub claim_commitment: felt252,
    pub device_commitment: felt252,
    pub recovery_commitment: felt252,
    pub token: ContractAddress,
    pub initial_amount: u128,
    pub remaining_amount: u128,
    pub released_amount: u128,
    pub daily_amount: u128,
    pub first_release_at: u64,
    pub return_at: u64,
    pub max_return_at: u64,
    pub action_nonce: u64,
    pub status: SafeStatusV3,
}

#[starknet::interface]
pub trait ITravelSafeHelperV3<TContractState> {
    fn privacy_invoke(
        ref self: TContractState, operation: SafeOperationV3,
    ) -> Span<OpenNoteDepositV3>;
    fn privacy_pool(self: @TContractState) -> ContractAddress;
    fn is_supported_token(self: @TContractState, token: ContractAddress) -> bool;
    fn liability_for(self: @TContractState, token: ContractAddress) -> u256;
    fn state_exists(self: @TContractState, state_id: felt252) -> bool;
    fn get_state(self: @TContractState, state_id: felt252) -> SafeStateV3;
    fn claimable_amount(self: @TContractState, state_id: felt252) -> u128;
    fn action_message_hash(
        self: @TContractState, state_id: felt252, operation: felt252, value: u128, note_id: felt252,
    ) -> felt252;
    fn safe_return_message_hash(
        self: @TContractState,
        state_id: felt252,
        note_id: felt252,
        recovery_account: ContractAddress,
    ) -> felt252;
}

#[starknet::interface]
trait IERC20V3<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
trait IAccountSignatureV3<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Span<felt252>,
    ) -> felt252;
}

pub fn compute_v3_claim_commitment(state_id: felt252, claim_public_key: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(array!['WR_CLAIM_KEY_V3', state_id, claim_public_key].span())
}

pub fn compute_v3_device_commitment(state_id: felt252, device_public_key: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array!['WR_DEVICE_KEY_V3', state_id, device_public_key].span(),
    )
}

pub fn compute_v3_recovery_commitment(
    state_id: felt252, recovery_account: ContractAddress, recovery_salt: felt252,
) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array!['WR_RECOVERY_V3', state_id, recovery_account.into(), recovery_salt].span(),
    )
}

pub fn compute_v3_action_message_hash(
    chain_id: felt252,
    helper: ContractAddress,
    operation: felt252,
    state_id: felt252,
    nonce: u64,
    token: ContractAddress,
    remaining_amount: u128,
    value: u128,
    first_release_at: u64,
    return_at: u64,
    note_id: felt252,
) -> felt252 {
    let domain = StarknetDomainV3 {
        name: TRAVEL_SAFE_SNIP12_NAME, version: TRAVEL_SAFE_SNIP12_VERSION, chain_id, revision: 1,
    };
    let domain_hash = PoseidonTrait::new()
        .update_with(STARKNET_DOMAIN_TYPE_HASH)
        .update_with(domain)
        .finalize();
    let authorization_hash = PoseidonTrait::new()
        .update_with(SAFE_ACTION_TYPE_HASH)
        .update_with(operation)
        .update_with(state_id)
        .update_with(nonce)
        .update_with(token)
        .update_with(remaining_amount)
        .update_with(value)
        .update_with(first_release_at)
        .update_with(return_at)
        .update_with(note_id)
        .finalize();
    PoseidonTrait::new()
        .update_with('StarkNet Message')
        .update_with(domain_hash)
        .update_with(helper)
        .update_with(authorization_hash)
        .finalize()
}

pub fn compute_v3_safe_return_message_hash(
    chain_id: felt252,
    recovery_account: ContractAddress,
    helper: ContractAddress,
    state_id: felt252,
    nonce: u64,
    token: ContractAddress,
    remaining_amount: u128,
    return_at: u64,
    note_id: felt252,
) -> felt252 {
    let domain = StarknetDomainV3 {
        name: TRAVEL_SAFE_SNIP12_NAME, version: TRAVEL_SAFE_SNIP12_VERSION, chain_id, revision: 1,
    };
    let domain_hash = PoseidonTrait::new()
        .update_with(STARKNET_DOMAIN_TYPE_HASH)
        .update_with(domain)
        .finalize();
    let authorization_hash = PoseidonTrait::new()
        .update_with(SAFE_RETURN_TYPE_HASH)
        .update_with(helper)
        .update_with(state_id)
        .update_with(nonce)
        .update_with(token)
        .update_with(remaining_amount)
        .update_with(return_at)
        .update_with(note_id)
        .finalize();
    PoseidonTrait::new()
        .update_with('StarkNet Message')
        .update_with(domain_hash)
        .update_with(recovery_account)
        .update_with(authorization_hash)
        .finalize()
}

pub fn compute_claimable_amount(state: SafeStateV3, timestamp: u64) -> u128 {
    if state.status != SafeStatusV3::Funded
        || state.daily_amount == 0
        || timestamp < state.first_release_at
        || timestamp > state.return_at {
        return 0;
    }

    let elapsed_days: u64 = 1 + (timestamp - state.first_release_at) / 86_400;
    let accrued: u256 = elapsed_days.into() * state.daily_amount.into();
    let initial: u256 = state.initial_amount.into();
    let entitlement: u128 = if accrued >= initial {
        state.initial_amount
    } else {
        accrued.try_into().expect('ENTITLEMENT_OVERFLOW')
    };
    assert(state.released_amount <= entitlement, 'BAD_RELEASED_AMOUNT');
    let unreleased = entitlement - state.released_amount;
    if state.remaining_amount < unreleased {
        state.remaining_amount
    } else {
        unreleased
    }
}

#[starknet::contract]
pub mod TravelSafeHelperV3 {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{
        ClaimEarlyRequestV3, ExtendRequestV3, FundRequestV3, IAccountSignatureV3Dispatcher,
        IAccountSignatureV3DispatcherTrait, IERC20V3Dispatcher, IERC20V3DispatcherTrait,
        ITravelSafeHelperV3, MAX_SAFE_DURATION_SECONDS, MAX_SUPPORTED_TOKENS, OpenNoteDepositV3,
        RefundRequestV3, ReleaseAllowanceRequestV3, SafeOperationV3, SafeStateV3, SafeStatusV3,
        TopUpRequestV3, compute_claimable_amount, compute_v3_action_message_hash,
        compute_v3_claim_commitment, compute_v3_device_commitment, compute_v3_recovery_commitment,
        compute_v3_safe_return_message_hash,
    };

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        supported_tokens: Map<ContractAddress, bool>,
        liabilities: Map<ContractAddress, u256>,
        states: Map<felt252, SafeStateV3>,
        state_exists: Map<felt252, bool>,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct FundedV3 {
        #[key]
        pub state_id: felt252,
        #[key]
        pub token: ContractAddress,
        pub amount: u128,
        pub daily_amount: u128,
        pub first_release_at: u64,
        pub return_at: u64,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct AllowanceReleasedV3 {
        #[key]
        pub state_id: felt252,
        #[key]
        pub note_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub remaining_amount: u128,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct ToppedUpV3 {
        #[key]
        pub state_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub remaining_amount: u128,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct ExtendedV3 {
        #[key]
        pub state_id: felt252,
        pub previous_return_at: u64,
        pub new_return_at: u64,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct ReleasedV3 {
        #[key]
        pub state_id: felt252,
        #[key]
        pub note_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub status: SafeStatusV3,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        FundedV3: FundedV3,
        AllowanceReleasedV3: AllowanceReleasedV3,
        ToppedUpV3: ToppedUpV3,
        ExtendedV3: ExtendedV3,
        ReleasedV3: ReleasedV3,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_pool: ContractAddress,
        supported_tokens: Array<ContractAddress>,
    ) {
        assert(!privacy_pool.is_zero(), 'ZERO_POOL');
        let count = supported_tokens.len();
        assert(count > 0, 'NO_SUPPORTED_TOKENS');
        assert(count <= MAX_SUPPORTED_TOKENS, 'TOO_MANY_TOKENS');

        self.privacy_pool.write(privacy_pool);
        let mut index = 0;
        loop {
            if index == count {
                break;
            }
            let token = *supported_tokens.at(index);
            assert(!token.is_zero(), 'ZERO_TOKEN');
            assert(!self.supported_tokens.read(token), 'DUPLICATE_TOKEN');
            self.supported_tokens.write(token, true);
            index += 1;
        };
    }

    #[abi(embed_v0)]
    impl TravelSafeHelperV3Impl of ITravelSafeHelperV3<ContractState> {
        fn privacy_invoke(
            ref self: ContractState, operation: SafeOperationV3,
        ) -> Span<OpenNoteDepositV3> {
            match operation {
                SafeOperationV3::Fund(request) => {
                    self.fund(request);
                    array![].span()
                },
                SafeOperationV3::Release(request) => self.release_allowance(request),
                SafeOperationV3::TopUp(request) => {
                    self.top_up(request);
                    array![].span()
                },
                SafeOperationV3::Extend(request) => {
                    self.extend(request);
                    array![].span()
                },
                SafeOperationV3::ClaimEarly(request) => self.claim_early(request),
                SafeOperationV3::Refund(request) => self.refund(request),
            }
        }

        fn privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }

        fn is_supported_token(self: @ContractState, token: ContractAddress) -> bool {
            self.supported_tokens.read(token)
        }

        fn liability_for(self: @ContractState, token: ContractAddress) -> u256 {
            self.liabilities.read(token)
        }

        fn state_exists(self: @ContractState, state_id: felt252) -> bool {
            self.state_exists.read(state_id)
        }

        fn get_state(self: @ContractState, state_id: felt252) -> SafeStateV3 {
            assert(self.state_exists.read(state_id), 'STATE_NOT_FOUND');
            self.states.read(state_id)
        }

        fn claimable_amount(self: @ContractState, state_id: felt252) -> u128 {
            assert(self.state_exists.read(state_id), 'STATE_NOT_FOUND');
            compute_claimable_amount(self.states.read(state_id), get_block_timestamp())
        }

        fn action_message_hash(
            self: @ContractState,
            state_id: felt252,
            operation: felt252,
            value: u128,
            note_id: felt252,
        ) -> felt252 {
            assert(self.state_exists.read(state_id), 'STATE_NOT_FOUND');
            let state = self.states.read(state_id);
            compute_v3_action_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                helper: get_contract_address(),
                operation: operation,
                state_id: state_id,
                nonce: state.action_nonce,
                token: state.token,
                remaining_amount: state.remaining_amount,
                value: value,
                first_release_at: state.first_release_at,
                return_at: state.return_at,
                note_id: note_id,
            )
        }

        fn safe_return_message_hash(
            self: @ContractState,
            state_id: felt252,
            note_id: felt252,
            recovery_account: ContractAddress,
        ) -> felt252 {
            assert(self.state_exists.read(state_id), 'STATE_NOT_FOUND');
            let state = self.states.read(state_id);
            compute_v3_safe_return_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                recovery_account: recovery_account,
                helper: get_contract_address(),
                state_id: state_id,
                nonce: state.action_nonce,
                token: state.token,
                remaining_amount: state.remaining_amount,
                return_at: state.return_at,
                note_id: note_id,
            )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_pool(self: @ContractState) {
            assert(get_caller_address() == self.privacy_pool.read(), 'ONLY_PRIVACY_POOL');
        }

        fn fund(ref self: ContractState, request: FundRequestV3) {
            self.assert_pool();
            assert(request.state_id != 0, 'ZERO_STATE_ID');
            assert(request.claim_commitment != 0, 'ZERO_CLAIM');
            assert(request.device_commitment != 0, 'ZERO_DEVICE');
            assert(request.recovery_commitment != 0, 'ZERO_RECOVERY');
            assert(self.supported_tokens.read(request.token), 'WRONG_TOKEN');
            assert(request.amount > 0, 'ZERO_AMOUNT');
            assert(request.daily_amount <= request.amount, 'DAILY_EXCEEDS_AMOUNT');
            let now = get_block_timestamp();
            assert(request.return_at > now, 'RETURN_NOT_FUTURE');
            let max_return_at = now + MAX_SAFE_DURATION_SECONDS;
            assert(request.return_at <= max_return_at, 'RETURN_TOO_LATE');
            assert(request.first_release_at <= request.return_at, 'BAD_FIRST_RELEASE');
            if request.daily_amount == 0 {
                assert(request.first_release_at == request.return_at, 'BAD_SINGLE_RELEASE');
            } else {
                assert(request.first_release_at >= now, 'FIRST_RELEASE_PAST');
            }
            assert(!self.state_exists.read(request.state_id), 'STATE_EXISTS');

            let current_liability = self.liabilities.read(request.token);
            let amount: u256 = request.amount.into();
            let next_liability = current_liability + amount;
            let token = IERC20V3Dispatcher { contract_address: request.token };
            assert(token.balance_of(get_contract_address()) >= next_liability, 'BALANCE_MISMATCH');

            self
                .states
                .write(
                    request.state_id,
                    SafeStateV3 {
                        claim_commitment: request.claim_commitment,
                        device_commitment: request.device_commitment,
                        recovery_commitment: request.recovery_commitment,
                        token: request.token,
                        initial_amount: request.amount,
                        remaining_amount: request.amount,
                        released_amount: 0,
                        daily_amount: request.daily_amount,
                        first_release_at: request.first_release_at,
                        return_at: request.return_at,
                        max_return_at,
                        action_nonce: 0,
                        status: SafeStatusV3::Funded,
                    },
                );
            self.state_exists.write(request.state_id, true);
            self.liabilities.write(request.token, next_liability);
            self
                .emit(
                    FundedV3 {
                        state_id: request.state_id,
                        token: request.token,
                        amount: request.amount,
                        daily_amount: request.daily_amount,
                        first_release_at: request.first_release_at,
                        return_at: request.return_at,
                    },
                );
        }

        fn release_allowance(
            ref self: ContractState, request: ReleaseAllowanceRequestV3,
        ) -> Span<OpenNoteDepositV3> {
            self.assert_pool();
            assert(request.note_id != 0, 'ZERO_NOTE_ID');
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');
            let mut state = self.states.read(request.state_id);
            assert(state.status == SafeStatusV3::Funded, 'STATE_NOT_FUNDED');
            assert(request.nonce == state.action_nonce, 'INVALID_NONCE');
            let amount = compute_claimable_amount(state, get_block_timestamp());
            assert(amount > 0, 'NO_ALLOWANCE');
            self
                .assert_device_authorization(
                    request.state_id,
                    state,
                    'RELEASE',
                    amount,
                    request.note_id,
                    request.device_public_key,
                    request.signature_r,
                    request.signature_s,
                );

            state.remaining_amount -= amount;
            state.released_amount += amount;
            state.action_nonce += 1;
            if state.remaining_amount == 0 {
                state.status = SafeStatusV3::Claimed;
            }
            let deposit = self.release_value(request.state_id, request.note_id, state, amount);
            self
                .emit(
                    AllowanceReleasedV3 {
                        state_id: request.state_id,
                        note_id: request.note_id,
                        token: state.token,
                        amount,
                        remaining_amount: state.remaining_amount,
                    },
                );
            array![deposit].span()
        }

        fn top_up(ref self: ContractState, request: TopUpRequestV3) {
            self.assert_pool();
            assert(request.amount > 0, 'ZERO_AMOUNT');
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');
            let mut state = self.states.read(request.state_id);
            assert(state.status == SafeStatusV3::Funded, 'STATE_NOT_FUNDED');
            assert(get_block_timestamp() < state.return_at, 'RETURN_ALREADY_OPEN');
            assert(request.token == state.token, 'WRONG_TOKEN');
            assert(request.nonce == state.action_nonce, 'INVALID_NONCE');
            self
                .assert_device_authorization(
                    request.state_id,
                    state,
                    'TOP_UP',
                    request.amount,
                    0,
                    request.device_public_key,
                    request.signature_r,
                    request.signature_s,
                );

            let current_liability = self.liabilities.read(state.token);
            let next_liability = current_liability + request.amount.into();
            let token = IERC20V3Dispatcher { contract_address: state.token };
            assert(token.balance_of(get_contract_address()) >= next_liability, 'BALANCE_MISMATCH');
            state.remaining_amount += request.amount;
            state.action_nonce += 1;
            self.states.write(request.state_id, state);
            self.liabilities.write(state.token, next_liability);
            self
                .emit(
                    ToppedUpV3 {
                        state_id: request.state_id,
                        token: state.token,
                        amount: request.amount,
                        remaining_amount: state.remaining_amount,
                    },
                );
        }

        fn extend(ref self: ContractState, request: ExtendRequestV3) {
            self.assert_pool();
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');
            let mut state = self.states.read(request.state_id);
            assert(state.status == SafeStatusV3::Funded, 'STATE_NOT_FUNDED');
            assert(request.nonce == state.action_nonce, 'INVALID_NONCE');
            assert(get_block_timestamp() < state.return_at, 'RETURN_ALREADY_OPEN');
            assert(request.new_return_at > state.return_at, 'NOT_AN_EXTENSION');
            assert(request.new_return_at <= state.max_return_at, 'EXTENSION_TOO_LATE');
            self
                .assert_device_authorization(
                    request.state_id,
                    state,
                    'EXTEND',
                    request.new_return_at.into(),
                    0,
                    request.device_public_key,
                    request.signature_r,
                    request.signature_s,
                );

            let previous_return_at = state.return_at;
            state.return_at = request.new_return_at;
            state.action_nonce += 1;
            self.states.write(request.state_id, state);
            self
                .emit(
                    ExtendedV3 {
                        state_id: request.state_id,
                        previous_return_at,
                        new_return_at: request.new_return_at,
                    },
                );
        }

        fn claim_early(
            ref self: ContractState, request: ClaimEarlyRequestV3,
        ) -> Span<OpenNoteDepositV3> {
            self.assert_pool();
            assert(request.note_id != 0, 'ZERO_NOTE_ID');
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');
            let mut state = self.states.read(request.state_id);
            assert(state.status == SafeStatusV3::Funded, 'STATE_NOT_FUNDED');
            assert(get_block_timestamp() <= state.return_at, 'CLAIM_EXPIRED');
            assert(request.nonce == state.action_nonce, 'INVALID_NONCE');
            assert(
                compute_v3_claim_commitment(request.state_id, request.claim_public_key) == state
                    .claim_commitment,
                'WRONG_CLAIM_KEY',
            );
            let message_hash = compute_v3_action_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                helper: get_contract_address(),
                operation: 'CLAIM_EARLY',
                state_id: request.state_id,
                nonce: state.action_nonce,
                token: state.token,
                remaining_amount: state.remaining_amount,
                value: state.remaining_amount,
                first_release_at: state.first_release_at,
                return_at: state.return_at,
                note_id: request.note_id,
            );
            assert_valid_stark_signature(
                request.claim_public_key, message_hash, request.signature_r, request.signature_s,
            );

            let amount = state.remaining_amount;
            state.remaining_amount = 0;
            state.action_nonce += 1;
            state.status = SafeStatusV3::Claimed;
            let deposit = self.release_value(request.state_id, request.note_id, state, amount);
            self
                .emit(
                    ReleasedV3 {
                        state_id: request.state_id,
                        note_id: request.note_id,
                        token: state.token,
                        amount,
                        status: SafeStatusV3::Claimed,
                    },
                );
            array![deposit].span()
        }

        fn refund(ref self: ContractState, request: RefundRequestV3) -> Span<OpenNoteDepositV3> {
            self.assert_pool();
            assert(request.note_id != 0, 'ZERO_NOTE_ID');
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');
            let mut state = self.states.read(request.state_id);
            assert(state.status == SafeStatusV3::Funded, 'STATE_NOT_FUNDED');
            assert(get_block_timestamp() > state.return_at, 'NOT_RETURNABLE');
            assert(request.nonce == state.action_nonce, 'INVALID_NONCE');
            assert(!request.recovery_account.is_zero(), 'ZERO_RECOVERY_ACCOUNT');
            assert(request.recovery_salt != 0, 'ZERO_RECOVERY_SALT');
            assert(
                compute_v3_recovery_commitment(
                    request.state_id, request.recovery_account, request.recovery_salt,
                ) == state
                    .recovery_commitment,
                'WRONG_RECOVERY_ACCOUNT',
            );
            let message_hash = compute_v3_safe_return_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                recovery_account: request.recovery_account,
                helper: get_contract_address(),
                state_id: request.state_id,
                nonce: state.action_nonce,
                token: state.token,
                remaining_amount: state.remaining_amount,
                return_at: state.return_at,
                note_id: request.note_id,
            );

            let amount = state.remaining_amount;
            state.remaining_amount = 0;
            state.action_nonce += 1;
            state.status = SafeStatusV3::Refunded;
            self.states.write(request.state_id, state);
            assert(
                IAccountSignatureV3Dispatcher { contract_address: request.recovery_account }
                    .is_valid_signature(message_hash, request.signature.span()) == 'VALID',
                'INVALID_RECOVERY_SIGNATURE',
            );
            let deposit = self.release_value(request.state_id, request.note_id, state, amount);
            self
                .emit(
                    ReleasedV3 {
                        state_id: request.state_id,
                        note_id: request.note_id,
                        token: state.token,
                        amount,
                        status: SafeStatusV3::Refunded,
                    },
                );
            array![deposit].span()
        }

        fn assert_device_authorization(
            self: @ContractState,
            state_id: felt252,
            state: SafeStateV3,
            operation: felt252,
            value: u128,
            note_id: felt252,
            device_public_key: felt252,
            signature_r: felt252,
            signature_s: felt252,
        ) {
            assert(
                compute_v3_device_commitment(state_id, device_public_key) == state
                    .device_commitment,
                'WRONG_DEVICE_KEY',
            );
            let message_hash = compute_v3_action_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                helper: get_contract_address(),
                operation: operation,
                state_id: state_id,
                nonce: state.action_nonce,
                token: state.token,
                remaining_amount: state.remaining_amount,
                value: value,
                first_release_at: state.first_release_at,
                return_at: state.return_at,
                note_id: note_id,
            );
            assert_valid_stark_signature(device_public_key, message_hash, signature_r, signature_s);
        }

        fn release_value(
            ref self: ContractState,
            state_id: felt252,
            note_id: felt252,
            state: SafeStateV3,
            amount: u128,
        ) -> OpenNoteDepositV3 {
            assert(amount > 0, 'ZERO_RELEASE');
            let pool = self.privacy_pool.read();
            let token = IERC20V3Dispatcher { contract_address: state.token };
            let helper = get_contract_address();
            let current_liability = self.liabilities.read(state.token);
            let released: u256 = amount.into();
            assert(current_liability >= released, 'LIABILITY_UNDERFLOW');
            assert(token.balance_of(helper) >= current_liability, 'BALANCE_MISMATCH');
            assert(token.allowance(helper, pool) == 0, 'NONZERO_ALLOWANCE');

            self.states.write(state_id, state);
            self.liabilities.write(state.token, current_liability - released);
            assert(token.approve(pool, released), 'APPROVE_FAILED');
            OpenNoteDepositV3 { note_id, token: state.token, amount }
        }
    }

    fn assert_valid_stark_signature(
        public_key: felt252, message_hash: felt252, signature_r: felt252, signature_s: felt252,
    ) {
        use core::ec::stark_curve::ORDER;
        assert(public_key != 0, 'INVALID_PUBLIC_KEY');
        let curve_order: u256 = ORDER.into();
        let signature_r_value: u256 = signature_r.into();
        let signature_s_value: u256 = signature_s.into();
        assert(signature_r_value < curve_order, 'INVALID_SIGNATURE');
        assert(signature_s_value < curve_order, 'INVALID_SIGNATURE');
        assert(
            core::ecdsa::check_ecdsa_signature(message_hash, public_key, signature_r, signature_s),
            'INVALID_SIGNATURE',
        );
    }
}
