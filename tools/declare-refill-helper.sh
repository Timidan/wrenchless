#!/usr/bin/env bash

set -euo pipefail

readonly MODE="${1:-}"
readonly ACCOUNT_FILE="${2:-}"
readonly KEYSTORE_FILE="${3:-}"
readonly RPC_URL="https://rpc.starknet.lava.build/rpc/v0_8"
readonly CLASS_HASH="0x002b9104960ea863f78027933eba57370c7c13b88a3e67f828a5c989afb862f9"
readonly COMPILED_CLASS_HASH="0x06ed0187bbf46dba0b19826eea65d8d3b8754fe62d3b1d58ab40e840df41815d"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SIERRA_FILE="${REPO_ROOT}/contracts/refill-helper/target/release/refill_helper_RefillHelper.contract_class.json"

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

actual_class_hash="$(starkli class-hash "${SIERRA_FILE}")"
if [[ "${actual_class_hash,,}" != "${CLASS_HASH}" ]]; then
  echo "Refusing to declare: rebuilt class hash is ${actual_class_hash}, expected ${CLASS_HASH}." >&2
  exit 1
fi

declare_args=(
  declare
  "${SIERRA_FILE}"
  --rpc "${RPC_URL}"
  --account "${ACCOUNT_FILE}"
  --keystore "${KEYSTORE_FILE}"
  --casm-hash "${COMPILED_CLASS_HASH}"
)

if [[ "${MODE}" == "estimate" ]]; then
  declare_args+=(--estimate-only)
else
  declare_args+=(--watch)
fi

echo "Refill helper class: ${CLASS_HASH}"
echo "Compiled class:      ${COMPILED_CLASS_HASH}"
echo "RPC:                 ${RPC_URL}"
starkli "${declare_args[@]}"
