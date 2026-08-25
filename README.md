# Wrenchless

Wrenchless is a one-device Travel Safe for private STRK on Starknet mainnet.

A traveller chooses an amount and a return date. Ready prepares a STRK20 FUND
proof and the Wrenchless sponsor submits it to the deployed refill helper. The
reserve is no longer spendable from the wallet they carry. After the return
date, the chosen Ready account can return it as private STRK. A passkey unlocks
the saved Safe on this device. An optional twelve-word backup can return the
reserve early from another compatible browser.

Wrenchless is not a wallet implementation. Ready remains the wallet, account
selector, signer, private-balance reader, proof producer, and private-note
recipient.

## Product routes

- `/safe` creates, monitors, and returns the one active Safe on this device.
- `/recover` releases a funded Safe from its twelve words.
- Retired setup, wallet, reserve, guardian, and signal paths redirect to
  `/safe`.

There are no demo balances, seeded transactions, pairing codes, guardian
mailboxes, PINs, or second-device setup in the shipped hub.

## Security boundary

- Wrenchless generates early-return material inside one local ticket. The
  ticket is AES-GCM encrypted by a key derived from the device passkey and can
  reveal an optional twelve-word backup after passkey verification.
- The passkey-derived encryption key is non-extractable and lives only for the
  current unlocked session. Explicitly forgetting the Safe also removes legacy
  ticket ciphertext and its former browser key database.
- Before the return date, CLAIM requires the early-return key. After the date,
  REFUND requires a typed-data signature from the Ready account selected during
  setup.
- Starknet accepted-block time, not device time, selects CLAIM at or before the
  return date and REFUND strictly after it.
- The helper contract enforces the release boundary and one terminal release.
- Every FUND attempt prepares a fresh short-lived Ready proof and sends it
  immediately. Prepared proofs are not persisted.
- The sponsor verifies Ready's registration approval, rejects parks below 1
  STRK, shorter than two hours, or longer than 90 days, validates the prepared
  FUND, caps fees and daily spend, serializes its nonce stream, rate-limits
  callers, and can disable broadcasts.

For fresh-browser recovery after the date, the sponsor retains one HMAC account
tag and an encrypted locator containing only the Safe ID and recovery salt. A
new Safe replaces the old locator. The sponsor does not retain the amount,
return date, backup, balance, wallet address, or transaction history.

The helper publishes the Safe ID, token, amount, return date, timing, and final
status. Distinctive amounts or closely timed actions can still be correlated.
The browser passkey is a local gate, not protection against malware or a
compromised same-origin page.

## Mainnet configuration

The hub uses the deployed STRK20 pool and Travel Safe helper declared in
`apps/hub/src/lib/product-config.ts`. The production sponsor URL comes from
`VITE_SPONSOR_URL`; local development defaults to `http://localhost:8788`.

The sponsor reads its operator account, private key, RPC, helper, pool, token,
fee bounds, and daily budget from the file selected by
`WRENCHLESS_SPONSOR_ENV`. Use `deployment/sponsor.env.example` as the schema;
never commit a populated secret file.

FUND broadcasting remains an explicit operator switch:

```text
WRENCHLESS_ALLOW_REFILL_FUND_BROADCAST=true
```

This switch does not replace the sponsor readiness, balance, fee-bound, budget,
artifact, and onchain-state checks.

## Development

Install and run the hub:

```bash
pnpm install
pnpm hub:dev
```

Run the sponsor separately when testing a real FUND:

```bash
WRENCHLESS_SPONSOR_ENV=/absolute/path/sponsor.env pnpm sponsor:dev
```

Core verification:

```bash
pnpm --filter @wrenchless/canary-core test -- travel-safe.test.ts refill-ticket-store.test.ts
pnpm --filter @wrenchless/canary-core typecheck
pnpm --filter @wrenchless/hub typecheck
pnpm --filter @wrenchless/hub build
pnpm --filter @wrenchless/sponsor typecheck
pnpm contracts:test
```

No command above broadcasts a transaction. A mainnet rehearsal requires a
separate review of the Ready account, amount, return date, live fee reserve,
sponsor fee bound, helper, token, and expected state transition before approval.

## Repository map

```text
apps/hub/                 React Travel Safe and recovery UI
apps/sponsor/             Bounded relay for prepared STRK20 FUND proofs
apps/relay-canary/        Artifact inspection and Starknet relay client
contracts/refill-helper/  FUND, CLAIM, and REFUND state machine
packages/canary-core/     Derivation, proof boundaries, releases, and sealed ticket
deployment/               Gateway and sponsor deployment configuration
docs/superpowers/specs/   Approved product and security design
```
