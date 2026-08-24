# Wrenchless Travel Safe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-device Wrenchless product with a one-device, passkey-gated Travel Safe that parks private STRK until a chosen return date and restores it through Ready X.

**Architecture:** Keep Ready X as the only wallet and reuse the deployed refill helper's FUND, CLAIM, and REFUND paths. A BIP-39 phrase deterministically derives the state and both release keys; only the refund key is sealed locally, while helper state plus accepted-block time remains authoritative. Codex builds the typed core and action interfaces; Claude composes the UI against those interfaces without changing security logic.

**Tech Stack:** TypeScript 5.9, React 19, Vite 6, Starknet.js 10, `@scure/bip39` 1.6, Zod 4, Web Crypto, Ready Wallet API 0.10.3, Vitest 4, Cairo/Scarb.

**Spec:** `docs/superpowers/specs/2026-08-24-travel-safe-design.md`

## Global Constraints

- Mainnet and STRK only; Ready X remains the wallet and signer.
- One active local Travel Safe at a time.
- One twelve-word phrase per safe; never persist the phrase or claim private key.
- Never use device time to decide CLAIM versus REFUND.
- Use live wallet, RPC, helper, fee, sponsor, and transaction data only.
- No guardian, mailbox, pairing, QR, wallet tabs, PIN, demo fixtures, fake balances, or hardcoded success.
- Use `returnDateSeconds` in app code; map it to the existing contract/artifact `expiry` field only at that boundary.
- Review precedes proof generation; every FUND retry prepares a fresh proof and submits it immediately.
- Add only core tests for derivation, release-boundary selection, and encrypted ticket lifecycle.
- Claude owns page composition and CSS after the typed interfaces exist; Codex owns key, chain, fee, storage, contract, migration, and security-copy behavior.
- No mainnet broadcast without a separate explicit user approval containing exact amount, addresses, return date, fee bound, and expected transition.

---

## File map

### Core and persistence

- `packages/canary-core/src/travel-safe.ts`: phrase generation, validation, deterministic HKDF derivation, and CLAIM/REFUND choice.
- `packages/canary-core/src/travel-safe.test.ts`: one fixed derivation vector, invalid phrase, and exact return-date boundary.
- `packages/canary-core/src/refill-ticket-store.ts`: replace the role-paired ticket union with the single encrypted Travel Safe ticket and strict status graph.
- `packages/canary-core/src/refill-ticket-store.test.ts`: sealing, tamper rejection, transition, and removal tests.
- `packages/canary-core/src/index.ts`: public Travel Safe and ticket exports.
- `packages/canary-core/package.json`: direct `@scure/bip39` dependency.

### Hub domain interfaces

- `apps/hub/src/lib/refill-state.ts`: consistent accepted-block snapshot containing helper state, block number, and chain timestamp.
- `apps/hub/src/lib/ready-private-setup.ts`: live return-reserve and max-parkable figures derived from Ready's live pool fee and shielded balance.
- `apps/hub/src/lib/ready-refill.ts`: app-facing `returnDateSeconds` naming at the single `expiry` mapping boundary.
- `apps/hub/src/lib/refill-ticket.ts`: one `safe` IndexedDB sealing-key slot and active-ticket CRUD.
- `apps/hub/src/lib/refill-operations.ts`: phrase or stored-ticket CLAIM/REFUND using snapshot chain time, fresh nonce, and current Ready destination.
- `apps/hub/src/lib/travel-safe.ts`: orchestration-facing types and pure validation for amount/date/readiness.
- `apps/hub/src/adapters/settings.ts`: compact v3 settings with sponsor URL, passkey reference, active state ID, and bounded legacy-state quarantine only.

### Product flow

- `apps/hub/src/surfaces/safe/useTravelSafe.ts`: the only React state machine for connect, passkey, draft, phrase confirmation, FUND, reconciliation, return, and recovery.
- `apps/hub/src/surfaces/safe/SafeSurface.tsx`: `/safe` page composition supplied to Claude.
- `apps/hub/src/surfaces/safe/RecoverSurface.tsx`: `/recover` phrase recovery supplied to Claude.
- `apps/hub/src/surfaces/shared/product.tsx`: one-role product frame and existing reusable controls.
- `apps/hub/src/routes.ts`, `apps/hub/src/Root.tsx`: two product routes and direct legacy redirects.
- `apps/hub/src/styles/wallet.css`: Travel Safe layout, interaction, pending, confirmation, countdown, and reduced-motion states supplied to Claude.

### Public copy and cleanup

- `apps/hub/src/components/SceneHero.tsx`, `SceneStory.tsx`, `Evidence.tsx`, `Nav.tsx`: Claude rewrites the landing story and CTA.
- `apps/hub/src/components/Footer.tsx`, `PrivacyPage.tsx`: Codex rewrites threat-model and security claims.
- `apps/hub/src/surfaces/onboarding/**`, `reserve/**`, `signals/**`, `wallet/**`, and obsolete hub guardian/pairing modules: remove after the Safe routes compile without them.
- `apps/hub/package.json`: add direct BIP-39 dependency only if hub imports it; remove `react-qr-code` when QR surfaces are removed.

---

### Task 1: Recovery phrase and deterministic release authority

**Files:**
- Create: `packages/canary-core/src/travel-safe.ts`
- Create: `packages/canary-core/src/travel-safe.test.ts`
- Modify: `packages/canary-core/src/index.ts`
- Modify: `packages/canary-core/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `generateTravelSafePhrase(): string`
- Produces: `deriveTravelSafeSecrets(phrase: string): Promise<TravelSafeSecrets>`
- Produces: `chooseTravelSafeRelease(returnDateSeconds: string | bigint, chainTimeSeconds: string | bigint): "claim" | "refund"`

- [ ] **Step 1: Add the direct mnemonic dependency**

Run:

```bash
pnpm --filter @wrenchless/canary-core add @scure/bip39@1.6.0
```

- [ ] **Step 2: Write the focused failing core tests**

Use this exact fixed phrase and expected vector:

```ts
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

expect(await deriveTravelSafeSecrets(PHRASE)).toEqual({
  stateId: "0x32ef0f64a7ead9b0fb9f3ccd6e7098b98b71aaaf6df4df0ccf5b2253b550a16",
  claimPrivateKey: "0x5483c5a0c18e332068abb37bcd35d76f483da443348a8e6423aa667fe0e33c9",
  claimPublicKey: "0x56cd39dbbeb912cd52a5dd41516ebd84e0e6c7826139caae1408b8672081dd7",
  claimCommitment: "0xb1d4e061176740b93444ad5c6be3ca7f00d5cad3228f6cb26c2ca67844b084",
  refundPrivateKey: "0x5e1843311a3b03dfe3c64677a6c332f7b42ee4574b84870fa1c6f6489d19328",
  refundPublicKey: "0x695d544e8ee026ee26fddfc7b65fdeb1da8622da07be97dc28f27b4a94bbe31",
});
expect(chooseTravelSafeRelease("200", "200")).toBe("claim");
expect(chooseTravelSafeRelease("200", "201")).toBe("refund");
await expect(deriveTravelSafeSecrets("not twelve valid words")).rejects.toThrow(
  "Enter a valid twelve-word recovery phrase",
);
```

- [ ] **Step 3: Run the test and confirm the module is absent**

Run: `pnpm --filter @wrenchless/canary-core test -- travel-safe.test.ts`

Expected: FAIL because `travel-safe.ts` does not exist.

- [ ] **Step 4: Implement the derivation**

Use BIP-39 English words and 128 bits of entropy. Convert validated words back to entropy, import it as HKDF key material, and derive 256-bit candidates using:

```ts
const DOMAIN = "WRENCHLESS_TRAVEL_SAFE_V1";
const info = `${DOMAIN}:${purpose}:${counter}`;
```

Accept a state ID only in `(0, STARK_FIELD_PRIME)` and private keys only in `(0, ec.starkCurve.CURVE.n)`. Increment `counter` until valid, canonicalize as lowercase `0x` hex, derive Stark public keys, and call the existing `computeRefillClaimCommitment`.

- [ ] **Step 5: Export and verify**

Run:

```bash
pnpm --filter @wrenchless/canary-core test -- travel-safe.test.ts
pnpm --filter @wrenchless/canary-core typecheck
```

Expected: the focused test and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add packages/canary-core/src/travel-safe.ts packages/canary-core/src/travel-safe.test.ts packages/canary-core/src/index.ts packages/canary-core/package.json pnpm-lock.yaml
git commit -m "feat: derive Travel Safe recovery authority"
```

### Task 2: Single-role encrypted Travel Safe ticket

**Files:**
- Modify: `packages/canary-core/src/refill-ticket-store.ts`
- Modify: `packages/canary-core/src/refill-ticket-store.test.ts`
- Modify: `packages/canary-core/src/index.ts`
- Modify: `apps/hub/src/lib/refill-ticket.ts`
- Modify: `apps/hub/src/adapters/settings.ts`

**Interfaces:**
- Consumes: `TravelSafeSecrets` from Task 1.
- Produces: `TravelSafeTicket`, `TravelSafeTicketStatus`, `TravelSafeTicketStore`.
- Produces: `createTravelSafeTicket`, `readActiveTravelSafeTicket`, `transitionTravelSafeTicket`, `clearTravelSafeTicket`.

- [ ] **Step 1: Replace the ticket fixture with the v1 Safe schema**

```ts
const TICKET: TravelSafeTicket = {
  schemaVersion: "wrenchless.travel-safe-ticket.v1",
  role: "safe",
  stateId: "0x111",
  status: "PHRASE_CONFIRMED",
  claimCommitment: "0x222",
  refundPrivateKey: "0x333",
  refundPublicKey: "0x444",
  tokenAddress: "0x555",
  amountFri: "1000000000000000000",
  returnDateSeconds: "1800003600",
  fundTransactionHash: null,
  returnTransactionHash: null,
  createdAt: "2026-08-24T12:00:00.000Z",
  updatedAt: "2026-08-24T12:00:00.000Z",
};
```

Assert ciphertext omits `refundPrivateKey`, tampering fails, duplicate save fails, `PHRASE_CONFIRMED → FUND_SUBMITTING → FUNDED → RETURN_SUBMITTING → TERMINAL` succeeds, skipping states fails, and `remove` makes `get` return null.

- [ ] **Step 2: Run the focused test and observe schema failure**

Run: `pnpm --filter @wrenchless/canary-core test -- refill-ticket-store.test.ts`

- [ ] **Step 3: Implement the strict ticket store**

Use a new prefix and encryption context:

```ts
const STORAGE_PREFIX = "wrenchless.travel-safe-ticket.v1:";
const ENCRYPTION_CONTEXT = "WRENCHLESS_TRAVEL_SAFE_TICKET_V1";
type TravelSafeTicketStatus =
  | "PHRASE_CONFIRMED"
  | "FUND_SUBMITTING"
  | "FUNDED"
  | "RETURN_SUBMITTING"
  | "TERMINAL";
```

Add `remove(stateId)` to the storage abstraction; transition accepts an optional transaction-hash patch but never mutates keys, token, amount, state ID, or return date.

- [ ] **Step 4: Rewrite the hub wrapper and compact settings**

Use IndexedDB key name `safe`. Settings v3 contains only:

```ts
type HubSettings = {
  schemaVersion: "wrenchless.hub-settings.v3";
  sponsorUrl: string;
  devicePasskeyId: string | null;
  devicePasskeyPublicKey: string | null;
  activeSafeStateId: string | null;
  legacyRecoveryStateIds: string[];
};
```

The v2 migration preserves sponsor URL and passkey fields, moves at most 24 old refill IDs into `legacyRecoveryStateIds`, and discards mailbox capabilities, codes, aliases, account labels, and demo/setup state. It never marks a safe funded from local data.

- [ ] **Step 5: Verify core storage and hub types**

Run:

```bash
pnpm --filter @wrenchless/canary-core test -- refill-ticket-store.test.ts
pnpm --filter @wrenchless/canary-core typecheck
```

The hub typecheck may remain pending until Task 5 deletes old role consumers.

- [ ] **Step 6: Commit**

Commit together with Task 3 after the hub compiles, so no commit leaves the application with removed role types and live imports.

### Task 3: Authoritative chain snapshot, fee reserve, and release operations

**Files:**
- Modify: `apps/hub/src/lib/refill-state.ts`
- Modify: `apps/hub/src/lib/ready-private-setup.ts`
- Modify: `apps/hub/src/lib/ready-refill.ts`
- Modify: `apps/hub/src/lib/refill-operations.ts`
- Create: `apps/hub/src/lib/travel-safe.ts`

**Interfaces:**
- Produces: `readRefillChainSnapshot({ helperAddress, stateId })`.
- Produces: `inspectTravelSafeReadiness({ wallet, poolAddress, tokenAddress })`.
- Produces: `fundTravelSafe`, `returnTravelSafe`, and `recoverTravelSafe`.

- [ ] **Step 1: Return one consistent accepted-block snapshot**

Define:

```ts
type RefillChainSnapshot = {
  blockNumber: string;
  chainTimeSeconds: string;
  state: null | {
    stateId: string;
    claimCommitment: string;
    refundPublicKey: string;
    tokenAddress: string;
    amountFri: string;
    returnDateSeconds: string;
    status: "funded" | "claimed" | "refunded";
  };
};
```

Read `starknet_getBlockWithTxHashes` at `latest`, then run both helper calls at that exact block number. Reject malformed timestamps, block numbers, states, amounts, and statuses.

- [ ] **Step 2: Export live readiness figures**

Extend the existing Ready read into:

```ts
type TravelSafeReadiness = ReadyPrivateReadiness & {
  returnReserveFri: string;
  maxParkableFri: string;
  canPark: boolean;
};
```

`returnReserveFri` equals the live pool fee. `maxParkableFri` is `max(shieldedBalanceFri - returnReserveFri, 0)`. `canPark` requires registration and positive max parkable. The UI receives these values and performs no fee arithmetic.

- [ ] **Step 3: Make the contract naming boundary explicit**

Rename public hub inputs to `returnDateSeconds`; map once to core `expiry` inside `ready-refill.ts`. For CLAIM/REFUND, pass the state snapshot's `returnDateSeconds` because that is the value the helper signs.

- [ ] **Step 4: Replace role operations with Safe operations**

`fundTravelSafe` validates readiness, amount, date, current account, and state absence; prepares a new Ready FUND proof and immediately posts it to the sponsor. `returnTravelSafe` verifies passkey before opening the stored refund key, re-reads the snapshot, requires `chooseTravelSafeRelease(...) === "refund"`, validates the current Ready account, and submits REFUND. `recoverTravelSafe` derives from words, re-reads the snapshot, validates both public bindings and token, then submits CLAIM at/before the return date or REFUND after it.

No operation uses `Date.now()` for eligibility and no retry reuses a FUND artifact.

- [ ] **Step 5: Typecheck the domain layer**

Run: `pnpm --filter @wrenchless/hub typecheck`

Expected after Task 5 cleanup: PASS.

- [ ] **Step 6: Commit Tasks 2 and 3**

```bash
git add packages/canary-core/src apps/hub/src/lib apps/hub/src/adapters/settings.ts
git commit -m "feat: add authoritative Travel Safe lifecycle"
```

### Task 4: Safe controller and routes

**Files:**
- Create: `apps/hub/src/surfaces/safe/useTravelSafe.ts`
- Modify: `apps/hub/src/routes.ts`
- Modify: `apps/hub/src/Root.tsx`

**Interfaces:**
- Consumes: Task 3 snapshot/readiness/actions and Task 2 ticket/passkey functions.
- Produces: `TravelSafeViewModel` and `TravelSafeActions` for Claude.

- [ ] **Step 1: Implement the controller as one discriminated state model**

Expose:

```ts
type SafeHomeState =
  | { name: "no-local-safe" }
  | { name: "setup-incomplete"; ticket: TravelSafeTicket }
  | { name: "locked"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "return-ready"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "returning"; ticket: TravelSafeTicket }
  | { name: "returned"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "released-early"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "chain-unavailable"; reason: string };
```

The create flow is `connect → amount-date → words → confirm-words → review → parking`. Require full phrase re-entry for confirmation. On reload, re-read chain before choosing a home state and reconcile submitting statuses without resubmission.

- [ ] **Step 2: Implement passkey timing**

Create a passkey after Ready readiness succeeds if none exists. Verify it before reading an active ticket and again immediately before REFUND. `/recover` works without it; storing a recovered ticket requires explicit opt-in and a new or verified passkey.

- [ ] **Step 3: Replace the route table**

Use only `"/" | "/safe" | "/recover"`. Replace the browser address with `/safe` when `/start`, `/setup`, `/cover`, `/vault`, `/guardian`, `/wallet`, `/reserve`, `/signal`, or `/signals` is resolved. Root renders `SafeSurface` and `RecoverSurface`; unknown routes keep the current not-found page.

- [ ] **Step 4: Verify route and controller types**

Run: `pnpm --filter @wrenchless/hub typecheck`

Expected after the Safe components in Task 5 exist: PASS.

### Task 5: Claude Travel Safe UI composition

**Files:**
- Create: `apps/hub/src/surfaces/safe/SafeSurface.tsx`
- Create: `apps/hub/src/surfaces/safe/RecoverSurface.tsx`
- Modify: `apps/hub/src/surfaces/shared/product.tsx`
- Modify: `apps/hub/src/styles/wallet.css`
- Modify: `apps/hub/src/components/Nav.tsx`
- Modify: `apps/hub/src/components/SceneHero.tsx`
- Modify: `apps/hub/src/components/SceneStory.tsx`
- Modify: `apps/hub/src/components/Evidence.tsx`

**Interfaces:**
- Consumes only `TravelSafeViewModel` and `TravelSafeActions` from Task 4.
- Produces the `/safe`, `/recover`, and landing visual experience.

- [ ] **Step 1: Give Claude the approved spec, plan, existing primitives, and exact ownership boundary**

Claude may edit only the files listed above. It must not edit key derivation, tickets, settings, chain reads, readiness, operations, routes, Footer, or PrivacyPage.

- [ ] **Step 2: Compose every real state**

Render no-local-safe, setup-incomplete, locked, return-ready, returning, returned, released-early, chain-unavailable, five create steps, and four recovery outcomes. Use Phosphor icons, the STRK mark on figures, centred content-width outline buttons, back controls on their own row, narrow-mobile layout, short copy, and existing live/error detail components.

- [ ] **Step 3: Add interaction feedback without invented progress**

Use existing hover/press styles, the existing `processing-spin`, elapsed time for proving, once-per-minute countdown above one hour, once-per-second below, and static reduced-motion text. Never render percentage completion for Ready proof generation.

- [ ] **Step 4: Rewrite landing visuals**

The CTA points to `/safe`. The landing story explains: park private STRK, carry the low-balance Ready account, bring the reserve back after the return date, recover early only with the words. It must not mention guardians, pairing, codes, distress signals, or a Wrenchless wallet.

- [ ] **Step 5: Review Claude's diff before accepting it**

Reject changes outside the file allowlist, fee math in components, `Date.now()` eligibility checks, fake data, full-width filled actions, non-Phosphor icon additions, and security claims not present in the spec.

### Task 6: Security copy and legacy product-path removal

**Files:**
- Modify: `apps/hub/src/components/Footer.tsx`
- Modify: `apps/hub/src/components/PrivacyPage.tsx`
- Delete: old hub surfaces and their unreachable guardian/pairing-only imports
- Modify: `apps/hub/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the approved privacy boundary from the spec.
- Produces: no reachable or published claim for the retired product.

- [ ] **Step 1: Rewrite factual public copy**

State plainly that FUND metadata is public, amounts/timing may correlate, recovery words release early, expiry is fixed, Ready registration and fee reserve are required, and browser passkeys are local gates rather than hardware encryption.

- [ ] **Step 2: Remove legacy surfaces and QR dependency**

Delete old onboarding, reserve, signals, and wallet surface files once Root no longer imports them. Remove `react-qr-code`. Remove hub modules that become unreferenced and contain guardian capabilities, mailbox access, pairing receipts, PINs, or duress sessions. Keep sponsor, refill helper, Ready integration, passkey adapter, motion, wallet connector, token/brand components, and reusable product primitives.

- [ ] **Step 3: Scan for retired product language and demo data**

Run:

```bash
rg -n "guardian|carried phone|pairing|duress|demo|fixture|mock balance|seeded" apps/hub/src apps/hub/public --glob '!*.test.ts'
```

Every remaining match must be either the privacy page explaining a removed feature is not used or a technical file intentionally retained outside the shipped hub path.

- [ ] **Step 4: Build and commit the product flow**

```bash
pnpm --filter @wrenchless/hub typecheck
pnpm --filter @wrenchless/hub build
git add apps/hub pnpm-lock.yaml
git commit -m "feat: replace multi-device setup with Travel Safe"
```

### Task 7: Proportionate verification and local user-test checkpoint

**Files:**
- Modify only if verification exposes a concrete defect.

- [ ] **Step 1: Run core verification**

```bash
pnpm --filter @wrenchless/canary-core test -- travel-safe.test.ts refill-ticket-store.test.ts
pnpm --filter @wrenchless/canary-core typecheck
pnpm --filter @wrenchless/hub typecheck
pnpm --filter @wrenchless/hub build
pnpm --filter @wrenchless/sponsor typecheck
pnpm contracts:test
git diff --check
```

Do not add snapshot, copy, route, or broad component tests.

- [ ] **Step 2: Run local interactive smoke checks with live reads**

At mobile and desktop widths, verify landing → `/safe`, Ready connect/account switching, passkey create/verify, real readiness and balance figures, date bounds, phrase confirmation, back navigation, reload reconciliation, `/recover`, legacy redirects, unknown-chain errors, and reduced motion. Stop before any wallet approval or mainnet broadcast not already explicitly authorized.

- [ ] **Step 3: Record exact repository state**

Report branch, local commit SHA, remote SHA, working-tree state, successful commands, and any behavior that remains unverified because it needs a wallet or mainnet action.

### Task 8: Explicitly approved mainnet REFUND rehearsal

**Files:**
- Add a timestamped evidence record under the existing mainnet evidence location only after a successful run.

- [ ] **Step 1: Perform read-only preflight**

Read sponsor readiness, connected Ready account, registration, shielded balance, pool fee, helper identity, token, current block time, and estimated maximum transaction cost. Assemble the proposed amount and short operator-only return date without calling `wallet_strk20PrepareInvoke` or broadcasting.

- [ ] **Step 2: Ask for transaction approval**

Show the user the exact FUND amount, Ready account, helper, token, return date, sponsor fee bound, expected `missing → funded → refunded` transitions, and what balance remains. Do not trigger Ready or sponsor submission until the user explicitly approves that payload.

- [ ] **Step 3: Execute and reconcile**

After approval, submit FUND, wait for authoritative funded state, wait until accepted chain time is past the return date, verify passkey, submit REFUND, and reconcile to `refunded`. Confirm Ready discovers the returned private STRK; a separate Ready spend/unshield action requires its own user approval.

- [ ] **Step 4: Stop at the user-test checkpoint**

If REFUND works, hand the full local product to the user for UI E2E. If it fails after focused diagnosis, preserve evidence and apply the approved CLAIM-path fallback without claiming contract-enforced delayed return.
