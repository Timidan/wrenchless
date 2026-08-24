# Wrenchless

**A private spending wallet with a covert safety mode.**

Wrenchless lets someone carry a genuine low-balance wallet for everyday Starknet
payments while keeping their main vault on a separate device. The normal and
duress unlock paths produce the same visible payment flow, but each payment also
carries an encrypted heartbeat that only one trusted guardian can read.

The goal is practical personal safety, not a wallet that merely looks empty.

## User flow

1. The user keeps long-term funds in a separate vault and carries a Ready-based
   cover wallet with an ordinary spending balance.
2. Funds move from the vault through STRK20 rather than directly to the cover
   address, avoiding an obvious public vault-to-cover transfer edge.
3. The user pays normally from the cover wallet.
4. A normal PIN emits an encrypted `OK` heartbeat. A separate duress PIN completes
   the same payment flow but emits encrypted `DISTRESS`.
5. One preselected guardian receives the opaque heartbeat and can decrypt its
   meaning. Wrenchless never publishes a distress flag onchain.

The MVP does not freeze funds, contact authorities, or automatically move money.
Those actions are too context-dependent to make safe defaults.

## Why STRK20 is load-bearing

A transparent transfer from the vault to the cover wallet would permanently link
the two addresses. A direct private note is not enough for this design because its
recipient can recover sender metadata. Wrenchless instead uses a STRK20 helper
handoff so the cover wallet receives funds without learning the vault address.

Wrenchless has validated the relay-side policy for a registration-only proof,
but Ready's Wallet API cannot register an account through
`wallet_strk20PrepareInvoke`: an empty action list is invalid and Ready rejects
prepare requests until the account is already registered. Cover registration is
instead an explicit Ready wallet action named **Enable private tokens**. An
unrelated-relay registration claim remains unproven and will not be presented as
a product dependency until a supported producer exists.

## What privacy means here

Wrenchless is designed to hide the direct wallet graph and the meaning of the
guardian heartbeat. It does **not** claim to hide every observable:

- the cover wallet remains a public Starknet account;
- helper calls, transaction amounts, and timing remain public and may permit
  probabilistic correlation;
- registration transactions reveal the relay and cover addresses;
- network, browser, device, and physical-world metadata require separate defenses;
- a visibly branded safety application may itself attract attention.

These limits are part of the product contract, not fine print.

## Current status

Wrenchless is under active development for the STRK20 Private Sprint.

Implemented and locally verified:

- a strict, secret-rejecting registration artifact schema;
- canonical decoding of a registration-only `apply_actions` call;
- rejection of transfers, invokes, extra actions, mismatched viewing keys, and
  non-`None` screening;
- a bounded relay transaction containing exactly STRK approval followed by the
  validated pool call;
- a dry-run-first relay CLI with live chain, class, ABI, pool-state, fee, cover,
  and relay-balance checks;
- independent unsigned and signed fee-estimation paths with hard spend caps;
- two mandatory broadcast opt-ins and recursive secret redaction;
- post-broadcast receipt, relay-sender, `ViewingKeySet` event, and finalized pool
  state verification;
- a read-only Ready preflight that checks account deployment, public STRK,
  registration cost, and pool registration before suggesting the next action;
- a private refill helper with immutable pool/token configuration, FUND
  accounting, destination-bound CLAIM and REFUND signatures, terminal-state
  enforcement, and exact balance and allowance reconciliation;
- client-side refill key generation, claim commitments, Ready FUND preparation,
  and two-pass CLAIM and REFUND preparation that signs the previewed OPEN note
  and rejects a changed prepared note;
- a secret-free FUND artifact and dry-run-first relay path that rechecks the
  live helper, proof binding, expiry, state uniqueness, fee bounds, final
  `Funded` event, and helper liability;
- AES-GCM-sealed local refill-ticket records with non-extractable key
  enforcement, tamper detection, duplicate prevention, and explicit lifecycle
  transitions;
- fixed-size RFC 9180 HPKE heartbeat envelopes whose external shape is the same
  for normal and distress signals;
- a persistent opaque mailbox with one-time sender binding, per-message ECDSA
  authentication, a separate receive capability, bounded storage, rate limits,
  and seven-day expiry;
- recipient-built CLAIM submission through Ready Wallet, so the relay never
  chooses the destination note;
- authenticated HPKE signals and guardian controls whose encryption keys are
  bound alongside their separate mailbox signing keys;
- four-digit normal and duress codes whose verifiers stay on the carried device,
  plus passkey gates for the home vault and guardian surfaces;
- a persistent daily cap over the FUND relay's pool fees and network fees;
- focused tests for the artifact boundary, relay planner, and refill state machine.

Still to prove:

- a live REFUND with a real OPEN note; FUND and CLAIM have succeeded on mainnet;
- a complete three-device rehearsal of normal, duress, offline retry, guardian
  decryption, restore pause, FUND, and recipient-built CLAIM through the UI;
- production deployment, TLS termination, backup, and operational monitoring.

This repository is not production-ready. Mainnet verification has used only
explicitly approved transfers. The local public FUND relay is bounded by fee,
rate, and daily-spend caps.

### Verified cover flow

On 2026-08-23 the complete five-step cover flow was rechecked from canonical
Starknet mainnet receipts. Each transaction executed successfully:

1. Ready cover registration:
   `0x01bb5236b2294337bf5bba35aa69c17edb49bf313e8bcaef9d0afbec1d0d4ec8`
   emitted the cover's `ViewingKeySet` event from the STRK20 pool.
2. FUND:
   `0x0c4fbacb5ee5fd3a65f09d7a724ad585387ba642e570a11ed79f9be8ac013a6`
   emitted the helper's funded state for the 0.1 STRK refill.
3. CLAIM:
   `0x02e969f712d5ff8f3091bd42b06978c285c8ad221081da5f575afbc72f87888e`
   moved the helper to its claimed state and created the destination note.
4. Unshield:
   `0x07d09c4f15594894c7262fdb0fd27a1b28d36fb987351f40f4eec8132fc73d07`
   transferred exactly 0.1 STRK from the pool to the Harmonious Hotdog cover
   account.
5. Public payment:
   `0x02a1a7d18bf0a6c5b0b77a9db356127be5f549b3e1de0efbf61519f237449a91`
   transferred exactly 0.1 STRK from Harmonious Hotdog to Colorful Cat.

The shield prerequisite also succeeded in transaction
`0x0716271d53b8ffffef6eca7341c0158cd87cd9c2adf6e719fbdf024707e2cbc1`,
depositing 10.1 STRK into the pool before the unshield. Registration, FUND,
CLAIM, and unshield were submitted by distinct relayer addresses; the ordinary
payment's sender was the cover account itself.

## Repository layout

```text
packages/canary-core/   Relay policy plus FUND, CLAIM, and REFUND preparation
apps/relay-canary/      Read-only Ready status and dry-run-first relay inspection
apps/mailbox/           Opaque signed-sender heartbeat mailbox
apps/sponsor/           Bounded public relay for prepared refill FUND proofs
contracts/refill-helper Private refill FUND/CLAIM/REFUND state machine
```

## Local verification

Requirements: Node.js 22, pnpm 11, Scarb 2.15, and Starknet Foundry 0.56.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm contracts:build
pnpm contracts:test
```

The helper's FUND leg deliberately returns no open-note deposit. CLAIM and REFUND
each return one exact deposit after a domain-separated Stark signature. The class
and one pool-bound instance are deployed on mainnet. FUND and CLAIM have completed
through the live privacy pool; REFUND still needs its live rehearsal.

`prepareRefillFund` asks Ready to withdraw the exact private token amount to the
helper and invoke FUND in the same pool call. It rejects a prepared proof if the
wallet changes the pool, token, amount, helper, action order, or FUND calldata.
The browser adapter normalizes that result without including the vault address
or any wallet key. Inspect it with the unrelated relay before considering a
broadcast:

```bash
export STARKNET_RPC_URL="https://your-mainnet-rpc.example"
export WRENCHLESS_RELAY_ADDRESS="0x..."
pnpm refill:inspect --artifact /absolute/path/to/refill-fund-artifact.json
```

Inspection does not read a private key. The same two explicit broadcast gates
used by the registration canary apply to FUND. A successful submission is not
reported until the finalized helper state and liability match the artifact.

CLAIM and REFUND preview the next OPEN note ID, sign that exact ID locally, and
submit through the recipient's Ready Wallet. The one-time private keys remain in
encrypted local storage. The sponsor never constructs or receives a CLAIM.

### FUND relay and CLAIM fees

`apps/sponsor` relays only a prepared FUND proof. Before broadcasting, it
rechecks the helper, proof, expiry, state uniqueness, pool fee, operator balance,
and transaction-fee cap. It reserves the pool fee plus estimated network fee in
a persistent UTC-day ledger before submission. The daily cap survives restarts
and bounds operator exposure even if public rate limits are bypassed.

CLAIM is not sponsored. The carried Ready Wallet constructs the OPEN note,
signs that note ID with its one-time claim key, and submits the exact action.
This binds the destination to the recipient's wallet instead of trusting an
operator to choose it. Ready needs one pool fee already available privately for
the first claim, so carried-wallet setup leaves that reserve after registration.

Create the protected local configuration from the existing Starkli operator
keystore:

```bash
pnpm sponsor:configure
```

The command asks Starkli for the keystore password and writes the operator key
directly to
`~/.config/wrenchless/sponsor.env` with mode `0600`. It refuses to overwrite an
existing file and never prints the key. Never paste that secret into source,
chat, or a committed `.env` file.

Under Node 22 or newer, run the read-only readiness check first; it automatically
loads the protected configuration:

```bash
pnpm sponsor:check
```

It reads mainnet, the helper binding, live pool fee, operator public STRK, and
whether the relay is enabled. It does not generate a proof or broadcast. Only
after that succeeds should the service be started with `pnpm sponsor:dev`.
`GET /healthz` reports process liveness; `GET /readyz` reports whether one FUND
can be relayed now, including the remaining daily budget. Claims do not depend
on this service.

The core package also provides a sealed refill-ticket store and fixed-size
guardian heartbeats using RFC 9180 HPKE with P-256, HKDF-SHA256, and AES-256-GCM.
Guardian private keys remain client-side. A one-time invitation binds distinct
encryption and signing public keys; each opaque envelope must then carry a valid
signature. Only inbox retrieval retains a random bearer capability.

Run the local mailbox with an explicit browser origin:

```bash
WRENCHLESS_MAILBOX_ORIGIN=http://localhost:5174 pnpm mailbox:dev
```

Set `WRENCHLESS_MAILBOX_DB` to choose its SQLite file. The service binds to
`127.0.0.1`; production mode expects TLS termination by a local reverse proxy and
rejects requests not marked as HTTPS. The mailbox is implemented and locally
smoke-tested, but no public deployment or real two-device guardian rehearsal is
claimed yet.

### Refill helper mainnet deployment

Verified public deployment evidence:

- class hash: `0x0283df9cd21202733cd646caa8c4f37663f908ba6d43905632b9002f95fefacf`;
- compiled class hash: `0x05dbf2bc1c2a5432a00f59e550e7d3152a7a043ea92f85dadcf4ec30042a58aa`;
- declaration transaction: `0x04baefcd8c7f79889071466e51bdd4315bcdc4f66de9c0dc11f5561381ed9c0e`;
- deployed helper: `0x026ce951b858934b1ad832be2f93a102b9bf42deb5b824204278ed72b45fa828`;
- deployment transaction: `0x0703e4cdb10dfd2f9e8a316cab07c7100bd156830d6ccee6c19b1cdb0b96772f`.

The deployed instance is immutably bound to the STRK20 mainnet pool
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
and STRK token
`0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`.

Ready X can review the helper class but its current declaration screen may not
produce a fee estimate. Use a dedicated Starkli operator account rather than
exporting a Ready account key. Keep its encrypted keystore outside this
repository. After the account is deployed and funded, estimate first:

```bash
bash tools/declare-refill-helper.sh estimate /absolute/path/account.json /absolute/path/keystore.json
```

The command pins the healthy mainnet RPC and refuses artifacts whose Sierra
class hash differs from the reviewed helper. It also supplies the mainnet
Blake-compiled class hash explicitly. Submission remains a separate, interactive
keystore-password step:

```bash
bash tools/declare-refill-helper.sh submit /absolute/path/account.json /absolute/path/keystore.json
```

The deployment helper pins the verified class, constructor values, and public
salt so estimate and submission resolve to the same contract address:

```bash
bash tools/deploy-refill-helper.sh estimate /absolute/path/account.json /absolute/path/keystore.json
bash tools/deploy-refill-helper.sh submit /absolute/path/account.json /absolute/path/keystore.json
```

## Registration canary

### Ready cover preflight

Before opening Ready, inspect the cover account without connecting a wallet or
reading any wallet secret:

```bash
export STARKNET_RPC_URL="https://your-mainnet-rpc.example"
pnpm ready:status --cover 0x...
```

The command is read-only. It reports whether the account is deployed, its public
STRK balance, the live privacy registration fee and shortfall, and whether the
pool already has its viewing public key. Its `nextAction` is one of funding,
account activation, **Enable private tokens** inside Ready X, or `ready`.

An undeployed account must first be funded and activated in Ready X. Once it is
deployed and has enough public STRK for the reported registration fee, open Ready
X and choose **Enable private tokens**. Do not send an empty
`wallet_strk20PrepareInvoke` request; it is not Ready's registration interface.

### Relay inspection

The canary defaults to inspection only. It requires a Starknet mainnet RPC that
supports current proof-bearing V3 transactions, a deployed relay address, and a
legitimate registration artifact produced locally by a supported key-owning
client:

```bash
export STARKNET_RPC_URL="https://your-mainnet-rpc.example"
export WRENCHLESS_RELAY_ADDRESS="0x..."

pnpm canary:inspect --artifact /absolute/path/to/registration-artifact.json
```

No private key is needed or read in this mode. Before fee estimation, the CLI:

1. verifies `SN_MAIN`, the live pool class, required ABI functions, and the exact
   `ServerAction` discriminant order;
2. records the live pool version and rejects a paused pool;
3. confirms that the cover is not already registered;
4. decodes the artifact as exactly two `WriteOnce` actions followed by one
   `EmitViewingKeySet`, with `screening: None` and no trailing calldata;
5. verifies the proof protocol headers, mainnet configuration hash, base-block
   lifetime, and Poseidon message binding to the live pool class and exact actions,
   refusing proofs with fewer than 60 blocks remaining;
6. checks the live pool fee and relay balance against fixed caps;
7. simulates the exact approval plus `apply_actions` transaction while skipping
   only the relay account's signature validation.

Broadcast remains disabled unless `--broadcast` and
`WRENCHLESS_ALLOW_MAINNET_BROADCAST=true` are both present. Only then is
`WRENCHLESS_RELAY_PRIVATE_KEY` read. The CLI performs a signed estimate, rejects
it above the 10 STRK transaction-fee cap, and submits using those estimated
resource bounds. An operator must separately approve the printed pool, cover,
relay, estimated fee, and maximum spend before enabling those gates.

### Registration artifact boundary

The relay accepts only a normalized, registration-only `apply_actions` artifact
and independently rejects every transfer, deposit, withdrawal, or invoke. It
does not generate that artifact or receive wallet keys.

Ready's Wallet API is not a standalone registration interface. Calling
`wallet_strk20PrepareInvoke` with `[]` is invalid, while a nonempty prepare request
from an unregistered account is rejected as `NOT_REGISTERED`. A Ready user must
register from the wallet's own **Enable private tokens** action. An explicit
registration-only proof for relay handoff still requires a supported producer,
such as an approved key-owning Privacy SDK client. Wrenchless will not ask a Ready
user to export wallet or viewing-key secrets as a workaround.

The existing strict normalizer remains the secret-free artifact boundary for a
supported producer. Account keys, viewing keys, recovery material, guardian
keys, passphrases, and mnemonics must never enter it or leave the producing
client.

After an explicitly authorized broadcast, the CLI does not treat a transaction
hash as success. It waits for an accepted receipt, confirms the submitted
transaction sender is the configured relay, matches the pool's `ViewingKeySet`
event to the exact cover and public key in the artifact, and rereads that public
key at the receipt block. This verification is locally tested; the unrelated-
relay mainnet canary remains unproven until a real transaction completes.

## Security

Do not use Wrenchless with meaningful funds while it is under construction. Please
report a vulnerability privately to the repository owner instead of opening a
public exploit report while a fix is being coordinated.

## License

[MIT](./LICENSE)
