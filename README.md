<p align="center">
  <img src="apps/hub/public/og.png" alt="Wrenchless — A Travel Safe for private STRK" width="900" />
</p>

# Wrenchless

A passkey-protected Travel Safe for private STRK on Starknet.

[Open Wrenchless](https://wrenchless.timidan.xyz) · [Mainnet contract](https://voyager.online/contract/0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a) · [Transaction evidence](strk20.json)

Wrenchless parks part of your private STRK until a date you choose. Ready handles
your wallet and privacy proofs. Wrenchless enforces when the STRK can return.

> Wrenchless runs on Starknet mainnet and uses real STRK.

## How it works

1. Connect Ready.
2. Choose an amount and return date.
3. Confirm the private transaction.
4. Bring the STRK back after the return date.

A passkey protects the Safe on your device. Optional recovery words let you
bring it back early from another compatible browser.

| Park it | Leave it | Bring it back |
| --- | --- | --- |
| <img src="apps/hub/public/images/story/s2-counter.webp" alt="Park private STRK" width="280" /> | <img src="apps/hub/public/images/story/s4-vault.webp" alt="Private STRK held in the Travel Safe" width="280" /> | <img src="apps/hub/public/images/story/s5-hallway.webp" alt="Return private STRK" width="280" /> |

## Why STRK20

STRK20 lets Wrenchless use shielded STRK without taking over the wallet. Ready
creates the privacy proof and receives the returned private note. The Wrenchless
contract adds the return date and allows only one final release.

## Mainnet proof

- Travel Safe helper: [`0x018f...2844a`](https://voyager.online/contract/0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a)
- STRK20 pool: [`0x0403...e812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
- FUND: [`0x05a9...6e01d`](https://voyager.online/tx/0x05a9458404b7c44510f712de9f59140e10106801eb0d79e49603451de706e01d)
- Full FUND → CLAIM lifecycle: [`FUND`](https://voyager.online/tx/0x0c4fbacb5ee5fd3a65f09d7a724ad585387ba642e570a11ed79f9be8ac013a6) · [`CLAIM`](https://voyager.online/tx/0x02e969f712d5ff8f3091bd42b06978c285c8ad221081da5f575afbc72f87888e)

The machine-readable record is in [`strk20.json`](strk20.json).

## Architecture

```text
Browser + passkey
     ├─ Ready: balance, proof, signature
     └─ Sponsor relay → Travel Safe helper → STRK20 pool
```

- **Hub:** React interface for creating, watching, and returning a Safe.
- **Ready:** wallet connection, private balance, proof generation, and signing.
- **Sponsor:** validates and submits bounded FUND calls.
- **Travel Safe:** Cairo contract enforcing FUND, CLAIM, and REFUND.

The sponsor does not store the user's wallet balance or activity history. The
encrypted Safe ticket stays in the browser. The helper's amount, return date,
and status remain public on Starknet.

## Run locally

Requirements: Node.js 22, pnpm 11, and a WalletConnect project ID for Ready on
mobile.

```bash
pnpm install
cp apps/hub/.env.example apps/hub/.env.local
pnpm hub:dev
```

Set `VITE_WALLETCONNECT_PROJECT_ID` in `apps/hub/.env.local` for mobile wallet
connections. A real FUND also needs the sponsor service configured from
`deployment/sponsor.env.example`.

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

## Repository

```text
apps/hub/                 Web app
apps/sponsor/             Bounded FUND relay
apps/relay-canary/        Mainnet inspection tools
contracts/refill-helper/  Travel Safe contract
packages/canary-core/     Shared privacy and recovery logic
deployment/               Production configuration
```

## License

[MIT](LICENSE)
