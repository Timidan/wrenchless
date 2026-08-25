# Transaction Certainty

## Purpose

Wrenchless must always tell the user whether a financial action is being
prepared, awaiting approval, submitted, confirmed, or safe to retry. A reload
must resume from the encrypted local ticket and Starknet state instead of
starting the action again.

This change improves the existing Travel Safe lifecycle. It does not add a new
contract, sponsor service, activity log, analytics store, or wallet capability.

## User outcome

Creating a Safe presents five factual stages:

1. **Check** — Wrenchless verifies the device, sponsor, RPC, pool, and helper.
2. **Approve** — the wallet is connected and required approvals are identified
   as they occur.
3. **Review** — the prepared amount, return date, and current relay cost are
   ready for the user to accept.
4. **Submit** — Wrenchless sends the prepared action once and records its
   transaction hash as soon as one exists.
5. **Confirm** — Wrenchless reconciles the transaction and helper state until
   the Safe is locked or the attempt is known to have failed.

Every stage states one of three money outcomes: no transaction sent,
transaction submitted, or Safe locked. The interface uses no percentages or
estimated completion times.

## Existing sources of truth

The encrypted `TravelSafeTicket` remains the only persisted client record. Its
status, proof-expiry block, FUND transaction hash, return transaction hash, and
submission block already describe the durable parts of an action. The helper
state and Starknet transaction receipt remain authoritative.

The current session may hold short-lived UI state for wallet approval and cost
preparation. Prepared proofs and wallet balances remain memory-only and are not
restored after a reload.

No ticket-schema migration is required.

## Components

### Passive preflight

A small preflight function runs before opening the wallet. It checks:

- secure-context and passkey support;
- sponsor readiness;
- Starknet RPC availability;
- configured helper and pool readability.

It performs no balance request, signature, proof preparation, or broadcast.
Account registration and private balance are read once after the user connects
the wallet and remain session-only.

### Progress derivation

A pure hub module derives the five visible stages from:

- the current setup step;
- the current preparation substage;
- the encrypted ticket status and stored hashes;
- the latest chain snapshot or transaction receipt;
- the latest known error.

The derivation returns display data only. It cannot submit, retry, clear, or
transition a ticket.

### Controller

`useTravelSafe` owns the current preparation substage and invokes passive
preflight before wallet connection. Existing operation functions remain the
only code allowed to prepare or submit financial actions.

When submission starts, the ticket moves to `FUND_SUBMITTING` before the relay
call. A returned hash is persisted immediately. The controller then closes the
review flow and reconciles from Starknet.

### Interface

The Safe surface renders one compact timeline during creation, submission, and
reconciliation. Completed, current, and pending stages are visually distinct,
and status changes use the existing polite live region. Motion provides
feedback but carries no unique information and respects reduced-motion
preferences.

## Failure and retry rules

- Preflight failure: no wallet opens and no transaction is sent.
- Wallet rejection or proof failure: no transaction is sent; entered Safe
  details remain available.
- Known relay rejection before broadcast: reset the ticket to `READY` and allow
  a fresh preparation.
- Ambiguous relay response: keep `FUND_SUBMITTING`, reconcile from the chain,
  and disable resubmission.
- Hash available: show it immediately and poll its receipt plus helper state.
- Hash unavailable: keep reconciling until the stored proof-expiry block passes.
  Only then may the ticket return to `READY` if no helper state exists.
- Reverted transaction: state that the Safe was not locked and allow a fresh
  preparation.
- Helper state found: stop all waiting indicators immediately and show the
  locked Safe, even if a prior request returned an error.

No financial action is automatically retried.

## Storage and privacy

The upgrade stores no new user history. It does not persist wallet balances,
preflight results, approval stages, errors, or timeline events. The existing
encrypted ticket and public Starknet state are sufficient to reconstruct the
durable action state.

## Verification

One focused test file covers the pure progress derivation for ready, preparing,
submitted with and without a hash, confirmed, reverted, and expired states.
Implementation verification is limited to that core test, hub typecheck, hub
production build, and one manual reload during a pending test transaction. No
additional test framework or broad UI suite is introduced.

## Out of scope

- Recovery Drill;
- transaction-history storage;
- background or automatic submission;
- new sponsor endpoints;
- contract changes;
- multiple active Safes;
- wallet-provider-specific integrations.

Recovery Drill follows this work and will consume the same read-only ticket and
chain-reconciliation boundary.
