use core::hash::{HashStateExTrait, HashStateTrait};
use core::poseidon::PoseidonTrait;
use starknet::ContractAddress;

pub const REFILL_SNIP12_NAME: felt252 = 'WrenchlessRefill';
pub const REFILL_SNIP12_VERSION: felt252 = 1;
pub const SAFE_SNIP12_NAME: felt252 = 'WrenchlessSafe';
pub const SAFE_SNIP12_VERSION: felt252 = 2;
const STARKNET_DOMAIN_TYPE_HASH: felt252 =
    0x1ff2f602e42168014d405a94f75e8a93d640751d71d16311266e140d8b0a210;
const RELEASE_AUTHORIZATION_TYPE_HASH: felt252 = selector!(
    "\"RefillRelease\"(\"operation\":\"shortstring\",\"stateId\":\"felt\",\"nonce\":\"felt\",\"expiry\":\"u128\",\"token\":\"ContractAddress\",\"amount\":\"u128\",\"noteId\":\"felt\")",
);
const SAFE_RETURN_AUTHORIZATION_TYPE_HASH: felt252 = selector!(
    "\"SafeReturn\"(\"helper\":\"ContractAddress\",\"stateId\":\"felt\",\"expiry\":\"u128\",\"token\":\"ContractAddress\",\"amount\":\"u128\",\"noteId\":\"felt\")",
);

#[derive(Copy, Drop, Hash)]
struct StarknetDomain {
    name: felt252,
    version: felt252,
    chain_id: felt252,
    revision: felt252,
}

#[derive(Copy, Drop, Hash)]
struct ReleaseAuthorization {
    operation: felt252,
    state_id: felt252,
    nonce: felt252,
    expiry: u64,
    token: ContractAddress,
    amount: u128,
    note_id: felt252,
}

#[derive(Copy, Drop, Hash)]
struct SafeReturnAuthorization {
    helper: ContractAddress,
    state_id: felt252,
    expiry: u64,
    token: ContractAddress,
    amount: u128,
    note_id: felt252,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct FundRequest {
    pub state_id: felt252,
    pub claim_commitment: felt252,
    pub recovery_commitment: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub expiry: u64,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct ClaimRequest {
    pub state_id: felt252,
    pub note_id: felt252,
    pub nonce: felt252,
    pub claim_public_key: felt252,
    pub signature_r: felt252,
    pub signature_s: felt252,
}

#[derive(Drop, Serde, PartialEq, Debug)]
pub struct RefundRequest {
    pub state_id: felt252,
    pub note_id: felt252,
    pub recovery_account: ContractAddress,
    pub recovery_salt: felt252,
    pub signature: Array<felt252>,
}

#[derive(Drop, Serde, PartialEq, Debug)]
pub enum RefillOperation {
    Fund: FundRequest,
    Claim: ClaimRequest,
    Refund: RefundRequest,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub enum RefillStatus {
    #[default]
    Missing,
    Funded,
    Claimed,
    Refunded,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct RefillState {
    pub claim_commitment: felt252,
    pub recovery_commitment: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub expiry: u64,
    pub status: RefillStatus,
}

#[starknet::interface]
pub trait IRefillHelper<TContractState> {
    fn privacy_invoke(
        ref self: TContractState, operation: RefillOperation,
    ) -> Span<OpenNoteDeposit>;
    fn privacy_pool(self: @TContractState) -> ContractAddress;
    fn allowed_token(self: @TContractState) -> ContractAddress;
    fn total_liability(self: @TContractState) -> u256;
    fn state_exists(self: @TContractState, state_id: felt252) -> bool;
    fn get_state(self: @TContractState, state_id: felt252) -> RefillState;
    fn claim_message_hash(
        self: @TContractState, state_id: felt252, note_id: felt252, nonce: felt252,
    ) -> felt252;
    fn safe_return_message_hash(
        self: @TContractState,
        state_id: felt252,
        note_id: felt252,
        recovery_account: ContractAddress,
    ) -> felt252;
}

#[starknet::interface]
trait IERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
trait IAccountSignature<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Span<felt252>,
    ) -> felt252;
}

pub fn compute_claim_commitment(state_id: felt252, claim_public_key: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span(array!['WR_CLAIM_KEY_V1', state_id, claim_public_key].span())
}

pub fn compute_recovery_commitment(
    state_id: felt252, recovery_account: ContractAddress, recovery_salt: felt252,
) -> felt252 {
    core::poseidon::poseidon_hash_span(
        array![
            'WR_RECOVERY_ACCOUNT_V1', state_id, recovery_account.into(), recovery_salt,
        ]
            .span(),
    )
}

pub fn compute_release_message_hash(
    operation: felt252,
    chain_id: felt252,
    helper: ContractAddress,
    state_id: felt252,
    nonce: felt252,
    expiry: u64,
    token: ContractAddress,
    amount: u128,
    note_id: felt252,
) -> felt252 {
    let domain = StarknetDomain {
        name: REFILL_SNIP12_NAME, version: REFILL_SNIP12_VERSION, chain_id, revision: 1,
    };
    let authorization = ReleaseAuthorization {
        operation, state_id, nonce, expiry, token, amount, note_id,
    };
    let domain_hash = PoseidonTrait::new()
        .update_with(STARKNET_DOMAIN_TYPE_HASH)
        .update_with(domain)
        .finalize();
    let authorization_hash = PoseidonTrait::new()
        .update_with(RELEASE_AUTHORIZATION_TYPE_HASH)
        .update_with(authorization)
        .finalize();
    PoseidonTrait::new()
        .update_with('StarkNet Message')
        .update_with(domain_hash)
        .update_with(helper)
        .update_with(authorization_hash)
        .finalize()
}

pub fn compute_safe_return_message_hash(
    chain_id: felt252,
    recovery_account: ContractAddress,
    helper: ContractAddress,
    state_id: felt252,
    expiry: u64,
    token: ContractAddress,
    amount: u128,
    note_id: felt252,
) -> felt252 {
    let domain = StarknetDomain {
        name: SAFE_SNIP12_NAME, version: SAFE_SNIP12_VERSION, chain_id, revision: 1,
    };
    let authorization = SafeReturnAuthorization {
        helper, state_id, expiry, token, amount, note_id,
    };
    let domain_hash = PoseidonTrait::new()
        .update_with(STARKNET_DOMAIN_TYPE_HASH)
        .update_with(domain)
        .finalize();
    let authorization_hash = PoseidonTrait::new()
        .update_with(SAFE_RETURN_AUTHORIZATION_TYPE_HASH)
        .update_with(authorization)
        .finalize();
    PoseidonTrait::new()
        .update_with('StarkNet Message')
        .update_with(domain_hash)
        .update_with(recovery_account)
        .update_with(authorization_hash)
        .finalize()
}

#[starknet::contract]
pub mod RefillHelper {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{
        ClaimRequest, FundRequest, IAccountSignatureDispatcher,
        IAccountSignatureDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait, IRefillHelper,
        OpenNoteDeposit, RefillOperation, RefillState, RefillStatus, RefundRequest,
        compute_claim_commitment, compute_recovery_commitment, compute_release_message_hash,
        compute_safe_return_message_hash,
    };

    #[storage]
    struct Storage {
        privacy_pool: ContractAddress,
        allowed_token: ContractAddress,
        states: Map<felt252, RefillState>,
        state_exists: Map<felt252, bool>,
        total_liability: u256,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct Funded {
        #[key]
        pub state_id: felt252,
        #[key]
        pub token: ContractAddress,
        pub amount: u128,
        pub expiry: u64,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub state_id: felt252,
        #[key]
        pub note_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[derive(Copy, Drop, Serde, starknet::Event)]
    pub struct Refunded {
        #[key]
        pub state_id: felt252,
        #[key]
        pub note_id: felt252,
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Funded: Funded,
        Claimed: Claimed,
        Refunded: Refunded,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, privacy_pool: ContractAddress, allowed_token: ContractAddress,
    ) {
        assert(!privacy_pool.is_zero(), 'ZERO_POOL');
        assert(!allowed_token.is_zero(), 'ZERO_TOKEN');

        self.privacy_pool.write(privacy_pool);
        self.allowed_token.write(allowed_token);
    }

    #[abi(embed_v0)]
    impl RefillHelperImpl of IRefillHelper<ContractState> {
        fn privacy_invoke(
            ref self: ContractState, operation: RefillOperation,
        ) -> Span<OpenNoteDeposit> {
            match operation {
                RefillOperation::Fund(request) => {
                    self.fund(request);
                    let deposits: Array<OpenNoteDeposit> = array![];
                    deposits.span()
                },
                RefillOperation::Claim(request) => self.claim(request),
                RefillOperation::Refund(request) => self.refund(request),
            }
        }

        fn privacy_pool(self: @ContractState) -> ContractAddress {
            self.privacy_pool.read()
        }

        fn allowed_token(self: @ContractState) -> ContractAddress {
            self.allowed_token.read()
        }

        fn total_liability(self: @ContractState) -> u256 {
            self.total_liability.read()
        }

        fn state_exists(self: @ContractState, state_id: felt252) -> bool {
            self.state_exists.read(state_id)
        }

        fn get_state(self: @ContractState, state_id: felt252) -> RefillState {
            assert(self.state_exists.read(state_id), 'STATE_NOT_FOUND');
            self.states.read(state_id)
        }

        fn claim_message_hash(
            self: @ContractState, state_id: felt252, note_id: felt252, nonce: felt252,
        ) -> felt252 {
            assert(self.state_exists.read(state_id), 'STATE_NOT_FOUND');
            let state = self.states.read(state_id);
            compute_release_message_hash(
                operation: 'CLAIM',
                chain_id: starknet::get_tx_info().unbox().chain_id,
                helper: get_contract_address(),
                state_id: state_id,
                nonce: nonce,
                expiry: state.expiry,
                token: state.token,
                amount: state.amount,
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
            compute_safe_return_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                recovery_account: recovery_account,
                helper: get_contract_address(),
                state_id: state_id,
                expiry: state.expiry,
                token: state.token,
                amount: state.amount,
                note_id: note_id,
            )
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn fund(ref self: ContractState, request: FundRequest) {
            assert(get_caller_address() == self.privacy_pool.read(), 'ONLY_PRIVACY_POOL');
            assert(request.state_id != 0, 'ZERO_STATE_ID');
            assert(request.claim_commitment != 0, 'ZERO_CLAIM');
            assert(request.recovery_commitment != 0, 'ZERO_RECOVERY');
            assert(request.token == self.allowed_token.read(), 'WRONG_TOKEN');
            assert(request.amount > 0, 'ZERO_AMOUNT');
            assert(request.expiry > get_block_timestamp(), 'EXPIRED');
            assert(!self.state_exists.read(request.state_id), 'STATE_EXISTS');

            let current_liability = self.total_liability.read();
            let amount: u256 = request.amount.into();
            let next_liability = current_liability + amount;
            let token = IERC20Dispatcher { contract_address: request.token };
            assert(token.balance_of(get_contract_address()) >= next_liability, 'BALANCE_MISMATCH');

            self
                .states
                .write(
                    request.state_id,
                    RefillState {
                        claim_commitment: request.claim_commitment,
                        recovery_commitment: request.recovery_commitment,
                        token: request.token,
                        amount: request.amount,
                        expiry: request.expiry,
                        status: RefillStatus::Funded,
                    },
                );
            self.state_exists.write(request.state_id, true);
            self.total_liability.write(next_liability);
            self
                .emit(
                    Funded {
                        state_id: request.state_id,
                        token: request.token,
                        amount: request.amount,
                        expiry: request.expiry,
                    },
                );
        }

        fn claim(ref self: ContractState, request: ClaimRequest) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.privacy_pool.read(), 'ONLY_PRIVACY_POOL');
            assert(request.note_id != 0, 'ZERO_NOTE_ID');
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');

            let state = self.states.read(request.state_id);
            assert(state.status == RefillStatus::Funded, 'STATE_NOT_FUNDED');
            assert(get_block_timestamp() <= state.expiry, 'CLAIM_EXPIRED');
            assert(
                compute_claim_commitment(request.state_id, request.claim_public_key) == state
                    .claim_commitment,
                'WRONG_CLAIM_KEY',
            );
            let message_hash = compute_release_message_hash(
                operation: 'CLAIM',
                chain_id: starknet::get_tx_info().unbox().chain_id,
                helper: get_contract_address(),
                state_id: request.state_id,
                nonce: request.nonce,
                expiry: state.expiry,
                token: state.token,
                amount: state.amount,
                note_id: request.note_id,
            );
            assert_valid_signature(
                request.claim_public_key, message_hash, request.signature_r, request.signature_s,
            );

            let deposit = self
                .release(request.state_id, request.note_id, state, RefillStatus::Claimed);
            self
                .emit(
                    Claimed {
                        state_id: request.state_id,
                        note_id: request.note_id,
                        token: deposit.token,
                        amount: deposit.amount,
                    },
                );

            array![deposit].span()
        }

        fn refund(ref self: ContractState, request: RefundRequest) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.privacy_pool.read(), 'ONLY_PRIVACY_POOL');
            assert(request.note_id != 0, 'ZERO_NOTE_ID');
            assert(self.state_exists.read(request.state_id), 'STATE_NOT_FOUND');

            let state = self.states.read(request.state_id);
            assert(state.status == RefillStatus::Funded, 'STATE_NOT_FUNDED');
            assert(get_block_timestamp() > state.expiry, 'NOT_EXPIRED');
            assert(!request.recovery_account.is_zero(), 'ZERO_RECOVERY_ACCOUNT');
            assert(request.recovery_salt != 0, 'ZERO_RECOVERY_SALT');
            assert(
                compute_recovery_commitment(
                    request.state_id, request.recovery_account, request.recovery_salt,
                ) == state.recovery_commitment,
                'WRONG_RECOVERY_ACCOUNT',
            );
            let message_hash = compute_safe_return_message_hash(
                chain_id: starknet::get_tx_info().unbox().chain_id,
                recovery_account: request.recovery_account,
                helper: get_contract_address(),
                state_id: request.state_id,
                expiry: state.expiry,
                token: state.token,
                amount: state.amount,
                note_id: request.note_id,
            );
            let mut authorized_state = state;
            authorized_state.status = RefillStatus::Refunded;
            self.states.write(request.state_id, authorized_state);
            assert(
                IAccountSignatureDispatcher { contract_address: request.recovery_account }
                    .is_valid_signature(message_hash, request.signature.span()) == 'VALID',
                'INVALID_RECOVERY_SIGNATURE',
            );

            let deposit = self
                .release(
                    request.state_id,
                    request.note_id,
                    authorized_state,
                    RefillStatus::Refunded,
                );
            self
                .emit(
                    Refunded {
                        state_id: request.state_id,
                        note_id: request.note_id,
                        token: deposit.token,
                        amount: deposit.amount,
                    },
                );

            array![deposit].span()
        }

        fn release(
            ref self: ContractState,
            state_id: felt252,
            note_id: felt252,
            mut state: RefillState,
            terminal_status: RefillStatus,
        ) -> OpenNoteDeposit {
            let pool = self.privacy_pool.read();
            let token = IERC20Dispatcher { contract_address: state.token };
            let helper = get_contract_address();
            let current_liability = self.total_liability.read();
            assert(token.balance_of(helper) >= current_liability, 'BALANCE_MISMATCH');
            assert(token.allowance(helper, pool) == 0, 'NONZERO_ALLOWANCE');

            let amount: u256 = state.amount.into();
            state.status = terminal_status;
            self.states.write(state_id, state);
            self.total_liability.write(current_liability - amount);
            assert(token.approve(pool, amount), 'APPROVE_FAILED');

            OpenNoteDeposit { note_id, token: state.token, amount: state.amount }
        }
    }

    fn assert_valid_signature(
        public_key: felt252, message_hash: felt252, signature_r: felt252, signature_s: felt252,
    ) {
        use core::ec::stark_curve::ORDER;
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
