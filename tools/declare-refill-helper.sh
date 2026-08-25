#!/usr/bin/env bash

set -euo pipefail

readonly MODE="${1:-}"
readonly ACCOUNT_FILE="${2:-}"
readonly KEYSTORE_FILE="${3:-}"
readonly RPC_URL="https://api.cartridge.gg/x/starknet/mainnet"
readonly CLASS_HASH="0x002b9104960ea863f78027933eba57370c7c13b88a3e67f828a5c989afb862f9"
readonly L1_GAS_BOUND="0"
readonly L1_GAS_PRICE_BOUND="110000000000000"
readonly L2_GAS_BOUND="590000000"
readonly L2_GAS_PRICE_BOUND="44000000000"
readonly L1_DATA_GAS_BOUND="220"
readonly L1_DATA_GAS_PRICE_BOUND="65000000000"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SIERRA_FILE="${REPO_ROOT}/contracts/refill-helper/target/release/refill_helper_RefillHelper.contract_class.json"
readonly SNCAST_BIN="${SNCAST_BIN:-sncast}"

usage() {
  echo "Usage: bash tools/declare-refill-helper.sh <estimate|submit> <account.json> <keystore.json>" >&2
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
  echo "Build contracts/refill-helper in release mode before declaring." >&2
  exit 2
fi

if ! command -v "${SNCAST_BIN}" >/dev/null 2>&1; then
  echo "sncast is required to declare the helper." >&2
  exit 2
fi

if ! "${SNCAST_BIN}" declare-from --help 2>&1 | grep -q -- "--sierra-file"; then
  echo "sncast 0.61.0 or newer is required for Starknet's current compiled-class hash." >&2
  exit 2
fi

actual_class_hash="$(starkli class-hash "${SIERRA_FILE}")"
if [[ "${actual_class_hash,,}" != "${CLASS_HASH}" ]]; then
  echo "Refusing to declare: rebuilt class hash is ${actual_class_hash}, expected ${CLASS_HASH}." >&2
  exit 1
fi

# sncast 0.61 checks an accounts file even when signing through a Starkli
# keystore. Supply the empty mainnet shape it expects; the account and signer
# still come exclusively from ACCOUNT_FILE and KEYSTORE_FILE.
empty_accounts_file="$(mktemp "${TMPDIR:-/tmp}/wrenchless-sncast-accounts.XXXXXX.json")"
trap 'rm -f "${empty_accounts_file}"' EXIT
printf '{"alpha-mainnet":{}}\n' > "${empty_accounts_file}"

declare_args=(
  --account "${ACCOUNT_FILE}"
  --keystore "${KEYSTORE_FILE}"
  --accounts-file "${empty_accounts_file}"
)

if [[ "${MODE}" == "submit" ]]; then
  declare_args+=(--wait)
fi

declare_args+=(
  declare-from
  --sierra-file "${SIERRA_FILE}"
  --url "${RPC_URL}"
)

if [[ "${MODE}" == "estimate" ]]; then
  declare_args+=(--dry-run --detailed)
else
  declare_args+=(
    --l1-gas "${L1_GAS_BOUND}"
    --l1-gas-price "${L1_GAS_PRICE_BOUND}"
    --l2-gas "${L2_GAS_BOUND}"
    --l2-gas-price "${L2_GAS_PRICE_BOUND}"
    --l1-data-gas "${L1_DATA_GAS_BOUND}"
    --l1-data-gas-price "${L1_DATA_GAS_PRICE_BOUND}"
  )
fi

echo "Refill helper class: ${CLASS_HASH}"
echo "Declaration tool:    $("${SNCAST_BIN}" --version)"
echo "RPC:                 ${RPC_URL}"
if [[ "${MODE}" == "submit" ]]; then
  echo "Maximum fee bounds:  25.9600143 STRK"
fi
"${SNCAST_BIN}" "${declare_args[@]}"
