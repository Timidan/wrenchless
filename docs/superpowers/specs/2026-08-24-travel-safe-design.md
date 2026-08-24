# Wrenchless Travel Safe design

Date: 2026-08-24

## Decision

Wrenchless becomes a focused Travel Safe rather than a wallet or a three-device
safety system.

The user parks a chosen STRK reserve outside every wallet until a chosen return
date. The user carries their existing, genuine low-balance Ready account. Before
the date, the deployed helper contract rejects the device-held refund authority.
After the date, the user unlocks Wrenchless with a passkey and asks Ready to
return the reserve as a private STRK20 note.

The defining feature is not shielding. Ready already shields, privately
transfers, swaps, and unshields assets. Wrenchless adds a user-selected,
token-specific lock whose value is absent from the Ready account and its viewing
key while parked.

## Consumer promise

> Lock a travel reserve outside every wallet until you are safely home. A stolen
> or unlocked phone cannot bring it back early.

This is a bounded-access promise, not a claim of complete invisibility or
production-grade device security.

## Scope

### MVP

- One user, one browser or phone, and one already-registered Ready account.
- STRK on Starknet mainnet only.
- One active Travel Safe at a time.
- A Wrenchless passkey gates locally retained safe management. Phrase recovery
  remains available on a new device without the old passkey.
- The user chooses an amount and return date.
- One random twelve-word BIP-39 recovery phrase is generated per safe, displayed
  once, confirmed, and never stored by Wrenchless.
- FUND parks the amount using the existing STRK20 helper and sponsor.
- The normal return uses REFUND after expiry.
- The recovery phrase provides an early CLAIM before expiry and disaster
  recovery through REFUND after expiry.
- The app reads the authoritative safe status from the deployed helper.
- The UI uses only real connected-wallet, chain, fee, and transaction data.

### Explicit cuts

- No new Starknet account or wallet implementation.
- No new Cairo contract, class declaration, or deployment.
- No guardian, heartbeat, mailbox, carried-phone pairing, QR handshake, or
  confirmation-code onboarding.
- No normal or duress PIN in the MVP.
- No fake balance, seeded activity, demo fixture, or hardcoded successful state.
- No multiple safes, token picker, extend-lock action, automatic emergency
  response, or location tracking.
- No claim that a browser passkey hardware-encrypts the refund key.

The old guardian and mailbox code is removed from the shipped product path after
the Travel Safe flow is working. It must not remain reachable from primary
navigation or be presented in the demo as current product functionality.

### Copy and route decommissioning ownership

The landing story, footer, and privacy page currently describe guardians,
pairing, device keys, and four product roles. They are part of this milestone,
not deferred cleanup.

Codex owns the factual threat-model and security copy in `PrivacyPage.tsx` and
`Footer.tsx`. Claude owns the landing-page composition and concise consumer copy
in `SceneStory.tsx`, `SceneHero.tsx`, and `Evidence.tsx`, using the approved
security claims. Neither may leave the previous guardian narrative visible or
replace it with demo data.

## Privacy and safety boundary

### What the design protects

- The parked value is absent from every Ready public balance and shielded-note
  inventory.
- FUND originates from STRK20 private notes and is submitted through the existing
  unrelated sponsor path, so the helper does not record the funding wallet.
- The helper chooses no recipient at FUND time. CLAIM or REFUND binds release to
  the exact OPEN note created later by the connected privacy wallet.
- Before expiry, the contract accepts only the claim key. That key exists only in
  the offline recovery phrase and is not stored on the travel device.
- The locally retained refund key is useless before expiry because the helper
  rejects REFUND until the onchain timestamp passes the chosen return date.

### What remains public or out of scope

- The helper's `Funded` event exposes state ID, token, amount, expiry, and timing.
- Distinctive amounts and tight shield-to-FUND timing can permit correlation.
- A person carrying or revealing the recovery phrase can release before expiry.
- A thief retaining an unlocked device until after expiry can attempt to return
  the safe. The passkey is a device gate, not a production remote-authentication
  or secure-enclave guarantee.
- The chosen expiry cannot be extended on the deployed helper.
- The browser implementation does not claim resistance to malware, advanced
  forensics, or prolonged coercion.
- A newly created or unregistered Ready account cannot bootstrap CLAIM or REFUND
  without the wallet's required STRK20 registration and private fee reserve.

## Existing architecture reused

### Unchanged

- `contracts/refill-helper`: FUND, CLAIM, REFUND, terminal state, expiry checks,
  destination-bound signatures, exact liability accounting, and state reads.
- `packages/canary-core/src/refill-claim.ts`: wallet action construction,
  two-pass OPEN-note preview binding, Stark signatures, and prepared-call
  validation.
- `apps/sponsor`: secret-rejecting FUND submission, live helper checks, rate
  limits, daily budget, fee caps, and final-state reconciliation.
- `apps/hub/src/lib/ready-refill.ts`: Ready capability checks and FUND, CLAIM,
  and REFUND wallet requests.
- `apps/hub/src/lib/relayed-refill.ts`: sponsor submission and result parsing.
- Existing deployed pool, token, helper, class, and verified mainnet evidence.

### Reused after simplification

- `apps/hub/src/lib/refill-state.ts` keeps authoritative helper-state reads and
  adds the timestamp and block number of a recent accepted RPC block. It returns
  `chainTimeSeconds` with the safe state. Device time never decides whether a
  safe is locked or return-ready.
- `apps/hub/src/adapters/device-passkey.ts` remains the local user-verification
  gate. It does not derive or wrap Travel Safe secrets.
- `packages/canary-core/src/refill-ticket-store.ts` keeps encrypted-at-rest
  ticket persistence and strict lifecycle transitions, with a new single-role
  Travel Safe schema.
- `apps/hub/src/lib/refill-ticket.ts` removes the `cover` and `vault` handshake
  types and `randomStateId()` in favour of one `safe` role whose state ID comes
  from the recovery phrase. Its IndexedDB sealing key uses a new `safe` slot.
- Reserve and restore async logic is extracted from `ReserveSurface` and
  `RestoreFlow`; their multi-role page structure is not retained.
- Existing wallet connectors, fee readers, submission records, animation
  utilities, token mark, and product shell remain where they serve the new flow.

Legacy `cover` and `vault` tickets are never loaded into the new flow. A bounded
migration checks their helper states: terminal or never-funded records and their
old sealing-key slots are removed; any nonterminal funded record is quarantined
and shown as legacy recovery work rather than silently deleted. This prevents a
cleanup from destroying the only local key for real parked funds.

## Key derivation and storage

### Recovery phrase

Wrenchless generates 128 random bits and encodes them as a twelve-word BIP-39
phrase. The canary core declares `@scure/bip39` as a direct dependency rather
than depending on a transitive copy.

The validated phrase is converted back to its original entropy. Domain-separated
HKDF-SHA256 expansion derives:

- the non-zero Stark-field `stateId`;
- the non-zero Stark-curve `claimPrivateKey`;
- the non-zero Stark-curve `refundPrivateKey`.

The respective public keys and existing claim commitment are derived with the
same Starknet primitives already used by the refill core. Domain labels include
the schema version and purpose. Scalar derivation uses deterministic rejection
sampling rather than accepting zero or an out-of-range key.

One phrase represents one safe. If the derived state ID already exists before
FUND, the app discards the phrase and generates a new one. The collision path is
not repaired with a locally stored counter because recovery must require only
the phrase.

### Device storage

The phrase and claim private key are never stored.

After phrase confirmation, Wrenchless stores a Travel Safe ticket containing the
derived state ID, claim commitment, refund keypair, token, amount, return date,
local timestamps, persisted status, and known transaction hashes. The existing
non-extractable AES-GCM browser key seals the ticket at rest. The existing
passkey assertion must succeed before the UI reads or uses the refund key.

This is honest gating, not cryptographic passkey wrapping. The contract expiry is
the control that prevents early REFUND even if local storage is compromised.

## Travel Safe lifecycle

Persisted ticket status survives reload and uses strict transitions:

1. `PHRASE_CONFIRMED`: phrase verified; refund ticket is sealed locally and the
   phrase and claim private key are cleared from application memory.
2. `FUND_SUBMITTING`: a prepared FUND was handed to the sponsor.
3. `FUNDED`: the helper reports the state as funded.
4. `RETURN_SUBMITTING`: a prepared REFUND was handed to Ready.
5. `TERMINAL`: the helper reports the state as claimed or refunded.

View state is derived from the current screen, helper state, chain time, and the
persisted ticket. It is never stored as lifecycle truth:

- `DRAFT`, `FUND_REVIEW`, and `FUND_PREPARING` describe the create flow;
- `LOCKED` means helper state `Funded` at or before the return date;
- `RETURN_READY` means helper state `Funded` after the return date;
- `RETURNED` means helper state `Refunded`;
- `RELEASED_EARLY` means helper state `Claimed`.

On every load and retry, the app reads the helper before rendering a safe state.
A persisted `FUND_SUBMITTING` or `RETURN_SUBMITTING` is reconciled with the
helper: success advances it, while an unchanged helper returns to an actionable
review state. It is never resubmitted automatically.

Recovery with the phrase branches from authoritative chain state:

- Before or at expiry: derive the claim key and submit CLAIM.
- After expiry: derive the refund key and submit REFUND.
- Claimed or refunded: show the terminal state and transaction evidence.
- Missing state: say that no funded safe matches those words. Do not reveal which
  word or checksum guess was close beyond normal BIP-39 validity feedback.

Recovery never requires an existing passkey or local ticket. It derives the
state, reads the helper, and permits the appropriate one-time CLAIM or REFUND.
It stores a new local Travel Safe ticket only if the user explicitly chooses to
manage that funded safe on this device and creates or verifies a local passkey.
It does not overwrite a different active local safe.

## Fee and time rules

- FUND must leave the connected Ready account with the live private fee reserve
  required to construct and submit the later CLAIM or REFUND.
- Codex exports one live return-reserve reader. It reports the current private
  pool/network cost of a later CLAIM or REFUND, the minimum private balance FUND
  must leave, and whether the connected Ready account satisfies it. UI code
  displays these values and never calculates or guesses them.
- The review screen shows the amount parked, live protocol/network costs, amount
  left privately spendable, and exact return date.
- The consumer UI accepts a local return date and time from two hours to ninety
  days in the future. It stores and submits the equivalent Unix timestamp and
  always displays the resolved local time during review.
- The mainnet REFUND rehearsal may use a shorter explicit CLI duration. That
  operator-only rehearsal value must not appear as a demo fixture or consumer
  default.
- The UI compares expiry with chain time from a recent RPC block rather than
  trusting only the device clock.
- App-domain code and copy use `returnDateSeconds` for the safe's unlock time.
  The existing core artifact and contract boundary may retain the Cairo field
  name `expiry`, but it is mapped once and never presented as a second deadline.
- The STRK20 FUND proof is short-lived. Review happens before proof preparation;
  **Park it** prepares and immediately hands the artifact to the sponsor in one
  contiguous pending action. The proof is never persisted or left waiting on a
  review screen, and every retry prepares a new proof.
- Long countdowns update once per minute; below one hour they may update once per
  second. Reduced-motion mode uses static text and no ticking animation.

## One-device user experience

### Entry

The existing landing page remains visually consistent but tells the Travel Safe
story and points to `/safe`.

There are two product routes. `/safe` is the safe home and `/recover` is phrase
recovery. Recovery is reachable from the home and directly by URL and requires
neither a passkey nor a local ticket. `/start`, `/setup`, `/cover`, `/vault`,
`/guardian`, `/wallet`, `/reserve`, `/signal`, and `/signals` redirect directly
to `/safe`; none renders a legacy surface. Old unknown product routes render the
ordinary not-found page rather than guessing a destination.

### New safe

1. **Connect Ready** — show the Ready mark and selected account. Verify mainnet,
   deployment, STRK20 registration, shielded balance, and return-fee reserve.
   Create the local Wrenchless passkey here if one does not exist; verify it if
   one does.
2. **Choose what stays home** — amount and return date. Keep the page concise.
3. **Save your recovery words** — state plainly that the words can release the
   safe early and must not travel with the user. Require an intentional phrase
   confirmation.
4. **Review** — amount, public metadata, return date, remaining private balance,
   and live fees.
5. **Park it** — Ready preparation followed by sponsor submission, with animated
   proving and confirmation states.

### Safe home

The product home is not a generic wallet dashboard. It has one authoritative
safe state:

- `No safe on this device` when there is no local ticket. It does not claim that
  no safe exists elsewhere and offers **Create a safe** and **Recover with your
  words**.
- `Setup incomplete` when a confirmed phrase exists locally but FUND is absent.
  It resumes from review rather than generating new keys.
- `Locked until <date>` with amount, countdown, and clear early-recovery link.
- `Ready to return` with one primary **Bring it back** action.
- `Returning` while a submitted return is being reconciled.
- `Returned to Shielded Starknet` with chain status and transaction evidence
  when known. It tells the user to open Ready to spend or unshield; Wrenchless
  does not implement a new unshield action.
- `Released early` when the helper reports `Claimed`, with transaction evidence
  when known and an explicit action to clear the terminal local ticket.
- `Cannot read the chain` when RPC or helper reads fail. It states that the
  safe's status is unknown and offers retry; it never falls back to an empty
  state.

Ready balances are secondary context, not the product's central object.
Creating a second safe is unavailable while the local ticket is funded or a
submission is unresolved. Once a terminal ticket is acknowledged and cleared,
the user can create another safe.

The safe is not bound to the account that funded it. Before CLAIM or REFUND, the
UI validates the currently connected Ready account and names it as the private
note destination. An account change never silently changes a prepared action;
the app discards the artifact and asks for a fresh review.

### Visual rules for Claude

Claude owns the Travel Safe page composition and CSS after the data and action
interfaces are stable. Claude must:

- preserve the current minimalist Wrenchless visual language and enlarged brand
  mark;
- use Phosphor icons and the existing STRK token mark;
- keep primary actions centred and content-width rather than full-width by
  default;
- keep back controls on their own row, not aligned beside the page title;
- animate hover, press, proving, submitting, confirmation, countdown, and state
  transitions while respecting reduced motion;
- keep every screen useful at a narrow mobile viewport;
- use short, human copy and show prose only when it describes the current action,
  a safety consequence, or a recoverable error;
- consume real props and live state only; no mock balances, fake history, or
  hardcoded success;
- avoid reintroducing wallet tabs, guardian setup, pairing, or multi-role copy.

Before Claude composes these pages, Codex extracts the FUND and private-readiness
state machines embedded in `ReserveSurface` into typed hooks or modules. Claude
consumes those interfaces rather than copying logic out of a surface that will
be removed. The visual layer receives:

- `readSafeState(stateId)`, including helper state, accepted-block time and
  typed not-found/read-failure results;
- `readReturnReserve(account)`, including live costs, minimum retained balance,
  and sufficiency;
- one-role ticket reads and strict persisted status;
- typed phrase generation/confirmation, FUND prepare/submit, REFUND, and
  recovery actions whose failures separate a short user message from technical
  detail.

Claude may change UI components and styles but must not change contract calls,
key derivation, ticket storage, chain-state interpretation, or security copy
without review.

## Error handling

Every asynchronous action has pending, success, failure, and retry behavior.
Errors must identify the next safe action:

- wrong network or account switched;
- Ready not installed, disconnected, undeployed, or not registered for private
  tokens;
- insufficient private STRK or insufficient return-fee reserve;
- passkey unavailable, cancelled, or belonging to another origin;
- phrase invalid or safe not found;
- FUND proof rejected as stale or sponsor unavailable;
- sponsor accepted FUND but the transaction reverted or never reached funded
  state;
- return date passed while FUND review was open, requiring a new date and proof;
- connected Ready account changed after an artifact was prepared, requiring a
  fresh destination review;
- safe not yet eligible for REFUND;
- return date passed while CLAIM was preparing, in which case refresh state and
  offer REFUND;
- helper already terminal;
- Ready rejection, proof failure, or transaction pending beyond the UI timeout.

Retries always re-read helper state before preparing or submitting. Local status
never overrides onchain state.

## Verification strategy

The user explicitly prefers core tests only. Add focused tests for:

- fixed phrase-to-state/claim/refund derivation vectors;
- invalid phrase and out-of-range derivation handling;
- lifecycle choice at the expiry boundary: CLAIM at or before, REFUND after;
- Travel Safe ticket sealing and recovery only if the schema cannot reuse the
  existing core store tests.

Do not add component snapshot tests, broad UI test scaffolding, or tests for
presentational copy. Run the existing core suites, TypeScript checks, lint, Cairo
tests, and production build.

## Mainnet gate and fallback

Before the UI overhaul, prepare a small REFUND rehearsal through the existing
code path. Read-only checks and fee estimation happen first. Broadcasting still
requires the user's explicit approval with the exact amount, addresses, return
date, fee bound, and expected state transition.

The time-locked product proceeds only after a real mainnet sequence confirms:

1. FUND reaches the deployed helper and records the expected return date and
   liability.
2. After expiry, REFUND creates the exact OPEN note and moves the helper to
   `Refunded`.
3. The Ready wallet discovers the returned private balance; a later unshield can
   demonstrate ordinary spendability.

If REFUND cannot be made reliable within two focused days, keep the same
single-device UI and phrase derivation but switch the normal return to the
already-proven CLAIM path. That fallback is called Travel Safe, not Time-Locked
Travel Safe, and makes no claim that the phone is cryptographically unable to
release early.

## Acceptance criteria

- A new user reaches a funded Travel Safe without another device or person.
- Ready remains the only wallet and signer.
- The phrase and claim private key are absent from browser persistence.
- The connected device cannot use its stored refund key before expiry.
- After expiry, passkey plus Ready returns the exact parked amount as a private
  note.
- Phrase recovery works before and after expiry using the correct contract path.
- The UI shows only authoritative wallet, RPC, helper, fee, and transaction data.
- No stale guardian, pairing, demo, or multi-role route remains in the primary
  product.
- At least FUND, REFUND, and one returned-funds pool action succeed on mainnet and
  are recorded as evidence.
- README and public copy state the public metadata, correlation risks, phrase
  risk, fixed expiry, fee requirement, and browser-security limit plainly.
