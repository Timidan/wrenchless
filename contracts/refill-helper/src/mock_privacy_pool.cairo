use starknet::ContractAddress;
use crate::refill_helper::{FundRequest, OpenNoteDeposit, RefillOperation};
use crate::travel_safe_v3::{FundRequestV3, OpenNoteDepositV3, SafeOperationV3, TopUpRequestV3};

#[starknet::interface]
pub trait IMockPrivacyPool<TContractState> {
    fn fund_helper(ref self: TContractState, helper: ContractAddress, request: FundRequest);
    fn invoke_and_deposit(
        ref self: TContractState, helper: ContractAddress, operation: RefillOperation,
    ) -> OpenNoteDeposit;
    fn open_note(self: @TContractState, note_id: felt252) -> (ContractAddress, u128);
    fn fund_v3_helper(ref self: TContractState, helper: ContractAddress, request: FundRequestV3);
    fn top_up_v3_helper(ref self: TContractState, helper: ContractAddress, request: TopUpRequestV3);
    fn invoke_v3_and_deposit(
        ref self: TContractState, helper: ContractAddress, operation: SafeOperationV3,
    ) -> OpenNoteDepositV3;
    fn invoke_v3_without_deposit(
        ref self: TContractState, helper: ContractAddress, operation: SafeOperationV3,
    );
}

#[starknet::interface]
trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::contract]
pub mod MockPrivacyPool {
    use core::num::traits::Zero;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_contract_address};
    use crate::refill_helper::{
        FundRequest, IRefillHelperDispatcher, IRefillHelperDispatcherTrait, OpenNoteDeposit,
        RefillOperation,
    };
    use crate::travel_safe_v3::{
        FundRequestV3, ITravelSafeHelperV3Dispatcher, ITravelSafeHelperV3DispatcherTrait,
        OpenNoteDepositV3, SafeOperationV3, TopUpRequestV3,
    };
    use super::{IERC20Dispatcher, IERC20DispatcherTrait, IMockPrivacyPool};

    #[storage]
    struct Storage {
        open_note_tokens: Map<felt252, ContractAddress>,
        open_note_amounts: Map<felt252, u128>,
    }

    #[abi(embed_v0)]
    impl MockPrivacyPoolImpl of IMockPrivacyPool<ContractState> {
        fn fund_helper(ref self: ContractState, helper: ContractAddress, request: FundRequest) {
            let token = IERC20Dispatcher { contract_address: request.token };
            assert(token.transfer(helper, request.amount.into()), 'TRANSFER_FAILED');

            let deposits = IRefillHelperDispatcher { contract_address: helper }
                .privacy_invoke(RefillOperation::Fund(request));
            assert(deposits.is_empty(), 'FUND_RETURNED_DEPOSIT');
        }

        fn invoke_and_deposit(
            ref self: ContractState, helper: ContractAddress, operation: RefillOperation,
        ) -> OpenNoteDeposit {
            let deposits = IRefillHelperDispatcher { contract_address: helper }
                .privacy_invoke(operation);
            assert(deposits.len() == 1, 'EXPECTED_ONE_DEPOSIT');
            let deposit = *deposits.at(0);
            assert(
                self.open_note_tokens.read(deposit.note_id).is_zero(), 'OPEN_NOTE_ALREADY_FILLED',
            );

            let token = IERC20Dispatcher { contract_address: deposit.token };
            assert(
                token.transfer_from(helper, get_contract_address(), deposit.amount.into()),
                'TRANSFER_FROM_FAILED',
            );
            self.open_note_tokens.write(deposit.note_id, deposit.token);
            self.open_note_amounts.write(deposit.note_id, deposit.amount);
            deposit
        }

        fn open_note(self: @ContractState, note_id: felt252) -> (ContractAddress, u128) {
            let token = self.open_note_tokens.read(note_id);
            assert(!token.is_zero(), 'OPEN_NOTE_NOT_FOUND');
            (token, self.open_note_amounts.read(note_id))
        }

        fn fund_v3_helper(
            ref self: ContractState, helper: ContractAddress, request: FundRequestV3,
        ) {
            let token = IERC20Dispatcher { contract_address: request.token };
            assert(token.transfer(helper, request.amount.into()), 'TRANSFER_FAILED');
            let deposits = ITravelSafeHelperV3Dispatcher { contract_address: helper }
                .privacy_invoke(SafeOperationV3::Fund(request));
            assert(deposits.is_empty(), 'FUND_RETURNED_DEPOSIT');
        }

        fn top_up_v3_helper(
            ref self: ContractState, helper: ContractAddress, request: TopUpRequestV3,
        ) {
            let token = IERC20Dispatcher { contract_address: request.token };
            assert(token.transfer(helper, request.amount.into()), 'TRANSFER_FAILED');
            let deposits = ITravelSafeHelperV3Dispatcher { contract_address: helper }
                .privacy_invoke(SafeOperationV3::TopUp(request));
            assert(deposits.is_empty(), 'TOP_UP_RETURNED_DEPOSIT');
        }

        fn invoke_v3_and_deposit(
            ref self: ContractState, helper: ContractAddress, operation: SafeOperationV3,
        ) -> OpenNoteDepositV3 {
            let deposits = ITravelSafeHelperV3Dispatcher { contract_address: helper }
                .privacy_invoke(operation);
            assert(deposits.len() == 1, 'EXPECTED_ONE_DEPOSIT');
            let deposit = *deposits.at(0);
            assert(
                self.open_note_tokens.read(deposit.note_id).is_zero(), 'OPEN_NOTE_ALREADY_FILLED',
            );
            let token = IERC20Dispatcher { contract_address: deposit.token };
            assert(
                token.transfer_from(helper, get_contract_address(), deposit.amount.into()),
                'TRANSFER_FROM_FAILED',
            );
            self.open_note_tokens.write(deposit.note_id, deposit.token);
            self.open_note_amounts.write(deposit.note_id, deposit.amount);
            deposit
        }

        fn invoke_v3_without_deposit(
            ref self: ContractState, helper: ContractAddress, operation: SafeOperationV3,
        ) {
            let deposits = ITravelSafeHelperV3Dispatcher { contract_address: helper }
                .privacy_invoke(operation);
            assert(deposits.is_empty(), 'EXPECTED_EMPTY_DEPOSIT');
        }
    }
}
