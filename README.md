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

STRK20 also lets an unrelated funded relay submit a cover wallet's registration
proof while the relay pays the public pool fee. The first implementation milestone
is a mainnet canary that proves this relay boundary end to end before the helper or
application is built around it.

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
- unit tests for the artifact, decoder, and relay planner.

Still to prove or build:

- dry-run inspection against the live mainnet pool;
- the unrelated-relay mainnet registration canary;
- immutable vault-to-cover helper contracts;
- encrypted guardian mailbox and heartbeat delivery;
- the Ready cover-wallet experience and public demo.

This repository is not production-ready and currently moves no user funds.

## Repository layout

```text
packages/canary-core/   Registration artifact validation and bounded relay plan
```

## Local verification

Requirements: Node.js 22 and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Mainnet broadcast is disabled by default. The future relay CLI will require both
an explicit command-line flag and an environment opt-in, and its operator runbook
will require a separate approval of the resolved addresses and maximum spend.

## Security

Do not use Wrenchless with meaningful funds while it is under construction. Please
report a vulnerability privately to the repository owner instead of opening a
public exploit report while a fix is being coordinated.

## License

[MIT](./LICENSE)
