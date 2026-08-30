<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/hub/public/logos/wrenchless-wordmark-dark.png" />
    <img src="apps/hub/public/logos/wrenchless-wordmark.png" alt="Wrenchless" width="276" />
  </picture>
</p>

# Wrenchless

Park private STRK or USDC until you return, or release a fixed amount each day.

[Open Wrenchless](https://wrenchless.timidan.xyz) · [Mainnet contract](https://voyager.online/contract/0x043d60a5bf9cd864d9d5bb1d86d48a3268d32c3a004db64962b03215d3fdb2ed) · [Transaction evidence](strk20.json)

## Travel Safe v3

Create a private Travel Safe with STRK or USDC. Park everything until a return
date, or make a fixed amount available each day. Missed daily amounts carry
forward.

- STRK or USDC, private or still in your wallet (wallet funds are shielded first, with your approval)
- One return date or a daily allowance
- Top-ups and return-date extensions
- Early return with recovery words
- Passkey or wallet-confirmed local Safe ticket
- Live helper state, transaction status and action history

| Lock it | Leave it locked | Bring it back |
| --- | --- | --- |
| <img src="apps/hub/public/images/story/s2-counter.webp" alt="Choose private funds to lock" width="280" /> | <img src="apps/hub/public/images/story/s4-vault.webp" alt="Keep the funds locked" width="280" /> | <img src="apps/hub/public/images/story/s5-hallway.webp" alt="Return the private funds" width="280" /> |

## How it works

1. Connect a privacy-ready Starknet wallet.
2. Choose STRK or USDC, an amount, and a return date or daily allowance.
3. Save the recovery words.
4. Confirm the private transaction.
5. Return the funds early with the recovery words, or after the return date
   from the connected account.

The recovery words remain on the device during setup. Wrenchless never sends
them to its server.

Your wallet supplies the private balance, proof, and signature. The Wrenchless
contract enforces the return date. Funds remain inside the STRK20 flow.

Normal browsers use a passkey to open the encrypted local ticket. If an
embedded wallet browser does not expose passkeys, Wrenchless asks that wallet
for a fresh confirmation instead. The confirmation is never stored, but it is
not an independent security factor from the wallet.

## Privacy boundary

| Hidden by STRK20 | Visible on Starknet |
| --- | --- |
| Wallet balance, private note ownership, sender-to-recipient link | Token, locked amount, return date, contract status |

The encrypted Safe ticket stays in the browser. Wrenchless stores no user
profile, wallet balance, recovery words, or activity history on a server.

## Mainnet evidence

Travel Safe v3 is declared and deployed on Starknet mainnet with the STRK20
pool, STRK and USDC pinned in its immutable configuration. The earlier v2
transactions remain the verified private FUND and CLAIM lifecycle evidence;
the first funded v3 lifecycle is still pending user testing.

- Travel Safe v3: [`0x043d...db2ed`](https://voyager.online/contract/0x043d60a5bf9cd864d9d5bb1d86d48a3268d32c3a004db64962b03215d3fdb2ed)
- v3 declaration: [`0x07fc...447f3`](https://voyager.online/tx/0x07fc844dcbdb0b520c0efdc71f92ea1cd6fe2b13e4cfa7b1d2c3e461126447f3)
- v3 deployment: [`0x07c9...a311e`](https://voyager.online/tx/0x07c9db1b6dded305dcd55a4701a985a75e88eacfa5f6dd0df9014c2e660a311e)
- Travel Safe v2: [`0x018f...2844a`](https://voyager.online/contract/0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a)
- STRK20 pool: [`0x0403...e812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- FUND: [`0x0c4f...13a6`](https://voyager.online/tx/0x0c4fbacb5ee5fd3a65f09d7a724ad585387ba642e570a11ed79f9be8ac013a6)
- CLAIM: [`0x02e9...788e`](https://voyager.online/tx/0x02e969f712d5ff8f3091bd42b06978c285c8ad221081da5f575afbc72f87888e)
- Machine-readable record: [`strk20.json`](strk20.json)

## Architecture

```text
Browser + device confirmation
     ├─ Privacy wallet: private balance, proof, signature
     └─ Sponsor relay → Travel Safe helper → STRK20 pool
```

- `apps/hub` — React web app
- `apps/sponsor` — bounded transaction relay
- `contracts/refill-helper` — immutable Cairo helpers
- `packages/canary-core` — shared actions, tickets, and recovery logic

Wrenchless requires an injected Starknet Wallet API `>= 0.10.3`. Ready's
browser extension and Xverse are supported when they expose that capability.
On mobile, Wrenchless opens the current page in Xverse's in-app browser; the
wallet remains responsible for private balance discovery and proof generation.

## Run locally

Requirements: Node.js 22 and pnpm 11.

```bash
pnpm install
cp apps/hub/.env.example apps/hub/.env.local
pnpm hub:dev
```

Start the sponsor in another terminal:

```bash
WRENCHLESS_SPONSOR_ENV=/absolute/path/sponsor.env pnpm sponsor:dev
```

The local hub uses `http://localhost:8788` when `VITE_SPONSOR_URL` is empty.
The example environments contain the verified v3 helper address. Set
`WRENCHLESS_ALLOW_TRAVEL_SAFE_V3_BROADCAST=true` only for a funded sponsor that
is intended to relay mainnet transactions.

## Verify

```bash
pnpm test
pnpm typecheck
pnpm contracts:test
```

These commands do not broadcast transactions.

## License

[MIT](LICENSE)
