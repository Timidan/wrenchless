<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/hub/public/logos/wrenchless-wordmark-dark.png" />
    <img src="apps/hub/public/logos/wrenchless-wordmark.png" alt="Wrenchless" width="276" />
  </picture>
</p>

# Wrenchless

A passkey-protected trip allowance for private STRK and USDC on Starknet.

[Open Wrenchless](https://wrenchless.timidan.xyz) · [Deployed v2 contract](https://voyager.online/contract/0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a) · [Transaction evidence](strk20.json)

## What it does

Wrenchless keeps most of a private balance locked and makes a chosen amount
available each day. Skipped daily amounts carry over. The remaining balance
stays locked until the return date.

- Private STRK and USDC
- Daily or single-release plans
- Top-ups and return-date extensions
- One trip-readiness check before setup
- Local recovery-word drills
- Replacement-phone recovery

| Lock most | Use the allowance | Return the rest |
| --- | --- | --- |
| <img src="apps/hub/public/images/story/s2-counter.webp" alt="Lock most of a private balance" width="280" /> | <img src="apps/hub/public/images/story/s4-vault.webp" alt="Use a private daily allowance" width="280" /> | <img src="apps/hub/public/images/story/s5-hallway.webp" alt="Return the remaining private balance" width="280" /> |

Travel Safe v2 supports private STRK only. Trip Allowance v3 supports private
STRK and USDC. Both require private STRK for action fees.

## How it works

1. Connect Ready Wallet.
2. Check the passkey, relay, private balance, and action reserve once.
3. Choose STRK or USDC, a daily amount, and a return date.
4. Save the recovery words and confirm the private transaction.
5. Release what is available or return the remainder when the trip ends.

If the original device is lost, recovery can return the locked balance
to another Ready account before the return date. Recovery words remain in page
memory and are never sent to the server.

Ready supplies the private balance, proof, and signature. The Wrenchless
contract enforces the schedule. Funds remain inside the STRK20 flow.

## Privacy boundary

| Hidden by STRK20 | Visible on Starknet |
| --- | --- |
| Wallet balance, private note ownership, sender-to-recipient link | Token, locked amount, schedule, contract status |

The encrypted Safe ticket stays in the browser. Wrenchless stores no user
profile, wallet balance, recovery words, or activity history on a server.

## Mainnet evidence

The deployed STRK-only Travel Safe v2 proves the complete private FUND → CLAIM
lifecycle. The STRK-and-USDC Trip Allowance v3 helper is implemented but is not
yet deployed or configured in production.

- Travel Safe v2: [`0x018f...2844a`](https://voyager.online/contract/0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a)
- STRK20 pool: [`0x0403...e812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- FUND: [`0x0c4f...13a6`](https://voyager.online/tx/0x0c4fbacb5ee5fd3a65f09d7a724ad585387ba642e570a11ed79f9be8ac013a6)
- CLAIM: [`0x02e9...788e`](https://voyager.online/tx/0x02e969f712d5ff8f3091bd42b06978c285c8ad221081da5f575afbc72f87888e)
- Machine-readable record: [`strk20.json`](strk20.json)

## Architecture

```text
Browser + passkey
     ├─ Ready: private balance, proof, signature
     └─ Sponsor relay → Travel Safe helper → STRK20 pool
```

- `apps/hub` — React web app
- `apps/sponsor` — bounded transaction relay
- `contracts/refill-helper` — immutable Cairo helpers
- `packages/canary-core` — shared actions, tickets, and recovery logic

## Run locally

Requirements: Node.js 22, pnpm 11, and a WalletConnect project ID for mobile.

```bash
pnpm install
cp apps/hub/.env.example apps/hub/.env.local
pnpm hub:dev
```

Set `VITE_WALLETCONNECT_PROJECT_ID` in `apps/hub/.env.local`. A v3 setup also
needs `VITE_TRAVEL_SAFE_V3_HELPER_ADDRESS` and `VITE_SPONSOR_URL`. Leave the v3
helper address empty until its deployment is verified. To run the sponsor:

```bash
WRENCHLESS_SPONSOR_ENV=/absolute/path/sponsor.env pnpm sponsor:dev
```

## Verify

```bash
pnpm test
pnpm typecheck
pnpm contracts:test
```

These commands do not broadcast transactions.

## License

[MIT](LICENSE)
