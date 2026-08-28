#!/usr/bin/env bash

set -euo pipefail

readonly MODE="${1:-}"
readonly ACCOUNT_FILE="${2:-}"
readonly KEYSTORE_FILE="${3:-}"
readonly RPC_URL="${WRENCHLESS_STARKNET_RPC:-https://rpc.starknet.lava.build/rpc/v0_8}"
readonly CLASS_HASH="0x0624c6c8f01a6d2d3533f44b3f1d6fb90367fe7fdfe667c94535a7f468b30496"
readonly COMPILED_CLASS_HASH="0x074e4a0e184836cdf35dde5bf16dd3387fb4675f7739b7ea9abf00613a892afa"
readonly APPROVED_MAX_FEE_STRK="33.85881024"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SIERRA_FILE="${REPO_ROOT}/contracts/refill-helper/target/release/refill_helper_TravelSafeHelperV3.contract_class.json"

usage() {
  echo "Usage: bash tools/declare-travel-safe-v3.sh <estimate|submit> <account.json> <keystore.json>" >&2
}

if [[ "${MODE}" != "estimate" && "${MODE}" != "submit" ]]; then
  usage
  exit 2
fi

if [[ ! -f "${ACCOUNT_FILE}" || ! -f "${KEYSTORE_FILE}" ]]; then
  echo "Account and encrypted keystore files must both exist." >&2
  exit 2
fi

if [[ "$(realpath "${KEYSTORE_FILE}")" == "${REPO_ROOT}"/* ]]; then
  echo "Keep the encrypted keystore outside the repository." >&2
  exit 2
fi

if [[ -n "${STARKNET_PRIVATE_KEY:-}" ]]; then
  echo "Unset STARKNET_PRIVATE_KEY; this command accepts only an encrypted keystore." >&2
  exit 2
fi

if [[ ! -f "${SIERRA_FILE}" ]]; then
  echo "Build contracts/refill-helper with the release profile before declaring." >&2
  exit 2
fi

actual_class_hash="$(starkli class-hash "${SIERRA_FILE}")"
if [[ "${actual_class_hash,,}" != "${CLASS_HASH}" ]]; then
  echo "Refusing to declare: rebuilt class hash is ${actual_class_hash}, expected ${CLASS_HASH}." >&2
  exit 1
fi

declare_args=(
  declare
  "${SIERRA_FILE}"
  # Starknet's BLAKE compiled-class hash, returned as the expected value by
  # mainnet simulation. Starkli 0.4.2 otherwise submits the legacy Poseidon
  # hash for this CASM even though the Sierra class hash is identical.
  --casm-hash "${COMPILED_CLASS_HASH}"
  --rpc "${RPC_URL}"
  --account "${ACCOUNT_FILE}"
  --keystore "${KEYSTORE_FILE}"
)

if [[ "${MODE}" == "estimate" ]]; then
  declare_args+=(--estimate-only)
else
  # These bounds cap the signed maximum below the user's approved
  # 33.859187848043785728 STRK estimate. Supplying all resource bounds also
  # prevents Starkli's automatic 50% buffer from exceeding the account balance.
  declare_args+=(
    --l1-gas 0
    --l1-gas-price-raw 120000000000000
    --l2-gas 940000000
    --l2-gas-price-raw 36020000000
    --l1-data-gas 256
    --l1-data-gas-price-raw 40000000000
    --watch
  )
fi

echo "Travel Safe v3 class: ${CLASS_HASH}"
echo "Compiled class hash:   ${COMPILED_CLASS_HASH}"
echo "RPC:                  ${RPC_URL}"
echo "Mode:                 ${MODE}"
if [[ "${MODE}" == "submit" ]]; then
  echo "Signed maximum fee:   ${APPROVED_MAX_FEE_STRK} STRK"
fi
starkli "${declare_args[@]}"
