<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/hub/public/logos/wrenchless-wordmark-dark.png" />
    <img src="apps/hub/public/logos/wrenchless-wordmark.png" alt="Wrenchless" width="276" />
  </picture>
</p>

# Wrenchless

Lock private STRK until you return.

[Open Wrenchless](https://wrenchless.timidan.xyz) · [Mainnet contract](https://voyager.online/contract/0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a) · [Transaction evidence](strk20.json)

## Live now: Travel Safe v2

The public app locks one private STRK amount until a return date. The connected
Ready account can return it after that date. Saved recovery words can return it
early.

- Private STRK
- One amount and one return date
- Passkey-protected local Safe ticket
- Twelve recovery words for early return or a replacement device
- Live helper state and transaction status
- Three verified STRK20 mainnet transactions

| Lock it | Leave it locked | Bring it back |
| --- | --- | --- |
| <img src="apps/hub/public/images/story/s2-counter.webp" alt="Choose private funds to lock" width="280" /> | <img src="apps/hub/public/images/story/s4-vault.webp" alt="Keep the funds locked" width="280" /> | <img src="apps/hub/public/images/story/s5-hallway.webp" alt="Return the private funds" width="280" /> |

## How it works

1. Connect Ready Wallet.
2. Choose how much private STRK to lock and when it should return.
3. Save the recovery words.
4. Confirm the private transaction.
5. Return the funds early with the recovery words, or after the return date
   from the connected account.

The recovery words remain in page memory during setup. Wrenchless never sends
them to its server.

Ready supplies the private balance, proof, and signature. The Wrenchless
contract enforces the return date. Funds remain inside the STRK20 flow.

## Built next: Trip Allowance v3

Trip Allowance v3 is implemented in the app, sponsor, shared packages, and
Cairo contract. It is not deployed or enabled in production.

When deployed and verified, it adds:

- Private STRK or USDC
- A fixed daily amount, with missed days carried forward
- A single-release option
- Top-ups and return-date extensions
- A readiness check before funds move
- A local recovery-word check
- Replacement-device recovery
- An action timeline and calendar export

No v3 helper address appears in this README or `strk20.json` because no v3
helper has been deployed. New Safes stay on the verified v2 flow until that
changes. Both versions need private STRK for protocol and network fees.

## Privacy boundary

| Hidden by STRK20 | Visible on Starknet |
| --- | --- |
| Wallet balance, private note ownership, sender-to-recipient link | Token, locked amount, return date, contract status |

The encrypted Safe ticket stays in the browser. Wrenchless stores no user
profile, wallet balance, recovery words, or activity history on a server.

## Mainnet evidence

The deployed STRK-only Travel Safe v2 proves the private FUND and CLAIM
lifecycle. Trip Allowance v3 has no mainnet deployment evidence yet.

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

Set `VITE_WALLETCONNECT_PROJECT_ID` in `apps/hub/.env.local`. Start the sponsor
in another terminal:

```bash
WRENCHLESS_SPONSOR_ENV=/absolute/path/sponsor.env pnpm sponsor:dev
```

The local hub uses `http://localhost:8788` when `VITE_SPONSOR_URL` is empty. To
enable v3 after a verified deployment, set the same helper address in
`VITE_TRAVEL_SAFE_V3_HELPER_ADDRESS` and
`WRENCHLESS_SPONSOR_V3_HELPER_ADDRESS`, then set
`WRENCHLESS_ALLOW_TRAVEL_SAFE_V3_BROADCAST=true`. Keep both helper values empty
until deployment is confirmed.

## Verify

```bash
pnpm test
pnpm typecheck
pnpm contracts:test
```

These commands do not broadcast transactions.

## License

[MIT](LICENSE)
