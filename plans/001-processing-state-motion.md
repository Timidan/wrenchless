# 001 — Make processing states visibly move

- **Status**: DONE
- **Commit**: 35a4df8
- **Severity**: HIGH
- **Category**: Missed opportunities
- **Estimated scope**: 4-7 UI files, small

## Problem

The product already animates screen entry and pointer feedback, but its asynchronous
states use the same static Phosphor icons as settled states. On a phone this makes a
live request look frozen. The clearest example is the guardian handoff:

```tsx
// apps/hub/src/surfaces/signals/SignalsSurface.tsx:550 — current
<StatusLine icon={<ArrowsClockwiseIcon />}>
  Updating the other device.
</StatusLine>
```

The shared state line renders its icon without a motion state:

```tsx
// apps/hub/src/surfaces/shared/product.tsx:268 — current
export function StatusLine(props: {
  icon: ReactNode;
  tone?: "plain" | "alert" | undefined;
  children: ReactNode;
}): JSX.Element {
```

```css
/* apps/hub/src/styles/wallet.css:906 — current */
.statusline__icon {
  display: inline-flex;
  flex: none;
  color: var(--ink-body);
}
```

## Target

Add an explicit, optional processing-icon state to shared product primitives.
Only call sites that are actively waiting on asynchronous work may opt in; status
icons such as “balance low” must remain still.

- Rotation: `900ms linear infinite`.
- Animate only `transform`.
- Set `transform-origin: center` on the moving icon wrapper.
- Keep the existing Phosphor icons and existing layout.
- Under `prefers-reduced-motion: reduce` and `html.reduced-motion`, do not rotate.
- Processing elements expose `aria-busy="true"` where appropriate.
- Do not animate Ready Wallet or STRK logos.

The guardian handoff must visibly rotate while `pairDelivery` is `idle` or
`sending`, stop when sent/failed, and leave all settled icons still.

## Repo conventions to follow

- Motion tokens live in `apps/hub/src/styles/tokens.css`.
- Product-surface motion lives in `apps/hub/src/styles/wallet.css`.
- The existing interaction curve is `--ease-settle`; constant progress motion is
  the one case that uses `linear`.
- Reduced-motion rules already exist near the shared button and waiting styles in
  `apps/hub/src/styles/wallet.css`.
- Shared controls are defined in `apps/hub/src/surfaces/shared/product.tsx`.

## Steps

1. Add a `--dur-spin: 900ms` token beside the existing motion tokens in
   `apps/hub/src/styles/tokens.css`.
2. Extend only the shared primitives that need it with an optional explicit prop,
   for example `iconMotion?: "spin"`. Render a data attribute on the existing icon
   wrapper and `aria-busy` on the owning status/control when spinning. Do not add a
   new dependency or a new icon system.
3. In `apps/hub/src/styles/wallet.css`, add one reusable spin keyframe and selectors
   for the opted-in icon wrappers. Use `animation: processing-spin var(--dur-spin)
   linear infinite` and `transform-origin: center`.
4. Add the explicit spin state to the guardian `Updating the other device` line in
   `apps/hub/src/surfaces/signals/SignalsSurface.tsx`.
5. Audit the product surfaces for other *currently active* asynchronous states that
   already use `ArrowsClockwiseIcon`. Opt in only while their state machine says
   work is running (for example activity status refresh or reserve settlement).
   Do not spin icons that merely represent restore, refresh, low balance, or history.
6. Extend both existing reduced-motion blocks so processing icons remain still.
7. Preserve all current button hover, press, screen-entry, spacing, typography,
   and layout behavior.

## Boundaries

- Do NOT edit mailbox, pairing, cryptography, settings, or backend logic.
- Do NOT change layout, copy, icons, colors, or component geometry.
- Do NOT add Framer Motion, GSAP usage, or any dependency.
- Do NOT turn every `ArrowsClockwiseIcon` into a spinner; opt-in is state-driven.
- Do NOT add tests beyond the existing build/typecheck/lint verification.
- You are not alone in this repository. Preserve concurrent edits and do not revert
  changes outside your UI-motion ownership.
- If the cited component structure has drifted, stop and report rather than
  improvising across backend files.

## Verification

- **Mechanical**: run `pnpm --filter @wrenchless/hub typecheck`, `pnpm lint`, and
  `pnpm --filter @wrenchless/hub build`; all must pass.
- **Feel check**:
  - Open guardian pairing on a phone-sized viewport and confirm the arrows rotate
    continuously while “Updating the other device” is shown.
  - Confirm rotation stops when the line changes to success or failure.
  - Press and hover shared buttons and confirm existing feedback remains intact.
  - In DevTools, set animation playback to 10% and confirm the spinner rotates
    around its centre without moving surrounding text.
  - Emulate `prefers-reduced-motion: reduce` and confirm the state remains readable
    but no icon rotates.
- **Done when**: every opted-in processing state moves only while work is active,
  settled/status icons stay still, and the three verification commands pass.
