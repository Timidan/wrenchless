#!/usr/bin/env bash

set -euo pipefail

readonly MODE="${1:-}"
readonly ACCOUNT_FILE="${2:-}"
readonly KEYSTORE_FILE="${3:-}"
readonly RPC_URL="${WRENCHLESS_STARKNET_RPC:-https://rpc.starknet.lava.build/rpc/v0_8}"
readonly CLASS_HASH="0x0624c6c8f01a6d2d3533f44b3f1d6fb90367fe7fdfe667c94535a7f468b30496"
readonly PRIVACY_POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
readonly STRK_TOKEN="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
readonly USDC_TOKEN="0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
readonly DEPLOY_SALT="0x023a98f74dfed6c877c61793bac5b9a16dc201da50f3ea7f11bf7d6d839559df"
readonly APPROVED_MAX_FEE_STRK="0.1049999"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "Usage: bash tools/deploy-travel-safe-v3.sh <estimate|submit> <account.json> <keystore.json>" >&2
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

if ! starkli class-by-hash "${CLASS_HASH}" --rpc "${RPC_URL}" >/dev/null; then
  echo "Refusing to deploy: the Travel Safe v3 class is not declared on Starknet mainnet." >&2
  exit 1
fi

deploy_args=(
  deploy
  "${CLASS_HASH}"
  "${PRIVACY_POOL}"
  2
  "${STRK_TOKEN}"
  "${USDC_TOKEN}"
  --salt "${DEPLOY_SALT}"
  --rpc "${RPC_URL}"
  --account "${ACCOUNT_FILE}"
  --keystore "${KEYSTORE_FILE}"
)

if [[ "${MODE}" == "estimate" ]]; then
  deploy_args+=(--estimate-only)
else
  # Cap the signed maximum below the approved 0.105 STRK deployment fee.
  # Supplying every resource bound also disables Starkli's automatic buffer.
  deploy_args+=(
    --l1-gas 0
    --l1-gas-price-raw 120000000000000
    --l2-gas 2900000
    --l2-gas-price-raw 36199800000
    --l1-data-gas 512
    --l1-data-gas-price-raw 40000000000
    --watch
  )
fi

echo "Travel Safe v3 class: ${CLASS_HASH}"
echo "Privacy pool:         ${PRIVACY_POOL}"
echo "Supported tokens:     STRK, USDC"
echo "Deployment salt:      ${DEPLOY_SALT}"
echo "RPC:                  ${RPC_URL}"
echo "Mode:                 ${MODE}"
if [[ "${MODE}" == "submit" ]]; then
  echo "Signed maximum fee:   ${APPROVED_MAX_FEE_STRK} STRK"
fi
starkli "${deploy_args[@]}"
