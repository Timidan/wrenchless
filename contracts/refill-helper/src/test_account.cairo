#[starknet::interface]
pub trait ITestAccount<TContractState> {
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Span<felt252>,
    ) -> felt252;
}

#[starknet::contract]
pub mod TestAccount {
    use super::ITestAccount;

    #[storage]
    struct Storage {}

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[abi(embed_v0)]
    impl TestAccountImpl of ITestAccount<ContractState> {
        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Span<felt252>,
        ) -> felt252 {
            assert(hash != 0, 'ZERO_HASH');
            assert(signature.len() == 1, 'WRONG_SIGNATURE_LENGTH');
            assert(*signature.at(0) == 0x123, 'BAD_SIGNATURE');
            'VALID'
        }
    }
}
