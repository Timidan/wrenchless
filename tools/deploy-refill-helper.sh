#!/usr/bin/env bash

set -euo pipefail

readonly MODE="${1:-}"
readonly ACCOUNT_FILE="${2:-}"
readonly KEYSTORE_FILE="${3:-}"
readonly RPC_URL="https://rpc.starknet.lava.build/rpc/v0_8"
readonly CLASS_HASH="0x0283df9cd21202733cd646caa8c4f37663f908ba6d43905632b9002f95fefacf"
readonly PRIVACY_POOL="0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a"
readonly ALLOWED_TOKEN="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
readonly DEPLOY_SALT="0xe270c78c7825dbee13cc87c2074c731a9b84149443ea534c5432637b6acb19"
readonly EXPECTED_ADDRESS="0x026ce951b858934b1ad832be2f93a102b9bf42deb5b824204278ed72b45fa828"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "Usage: bash tools/deploy-refill-helper.sh <estimate|submit> <account.json> <keystore.json>" >&2
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
  echo "Refusing to deploy: refill helper class is not declared on Starknet mainnet." >&2
  exit 1
fi

deploy_args=(
  deploy
  "${CLASS_HASH}"
  "${PRIVACY_POOL}"
  "${ALLOWED_TOKEN}"
  --salt "${DEPLOY_SALT}"
  --rpc "${RPC_URL}"
  --account "${ACCOUNT_FILE}"
  --keystore "${KEYSTORE_FILE}"
)

if [[ "${MODE}" == "estimate" ]]; then
  deploy_args+=(--estimate-only)
else
  deploy_args+=(--watch)
fi

echo "Refill helper class: ${CLASS_HASH}"
echo "Privacy pool:       ${PRIVACY_POOL}"
echo "Allowed token:      ${ALLOWED_TOKEN}"
echo "Deployment salt:    ${DEPLOY_SALT}"
echo "Expected address:   ${EXPECTED_ADDRESS}"
echo "RPC:                ${RPC_URL}"
starkli "${deploy_args[@]}"
