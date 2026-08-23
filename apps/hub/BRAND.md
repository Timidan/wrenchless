# Wrenchless brand assets

Wrenchless is a private Starknet spending wallet with a covert duress mode. Its identity stays quiet, ordinary-looking, and precise: the safety mechanism should never advertise itself.

## The mark

The W is built from two identical V strokes. The solid front V is the visible payment. The rear V is the sealed DISTRESS heartbeat behind it: the same shape and outcome, but at 55% presence and readable only by its intended guardian. The offset makes the W without adding a shield, lock, key, or other overt security signal.

The construction uses a 32 × 32 viewBox, 2.5-unit strokes, square caps, and miter joins. Keep the geometry and the front/rear order intact.

## Space and size

Keep clearspace of at least 8 units—one quarter of the mark width—on every side of the standalone mark or full lockup. No type, rule, crop, or image edge should enter it.

- Standalone mark: 16px minimum digital size.
- Full lockup: 120px minimum digital width.
- Favicon: use `favicon.svg`; its ink tile supplies the required edge separation.

## Ground and type

Use `*-dark.svg` on `#0f0e0d` or `#141414` grounds; it draws in paper white. Use `*-light.svg` on white or near-white grounds; it draws in `#141414`. Photography is acceptable only where the approved mark variant stays clearly legible.

The exported lockups set lowercase “wrenchless” in Hanken Grotesk Medium (500). Hanken Grotesk is loaded by the hub but its font file is not stored in this repository, so the wordmark SVGs use a `<text>` element with the existing fallback stack rather than inaccurate hand-traced glyphs. For a fully outlined production export, convert that text with the official Hanken Grotesk Medium font. The live nav and footer deliberately retain Fragment Mono.

## Do / don’t

- Do use only the supplied paper and ink variants.
- Do preserve the rear stroke at 55% opacity and the front stroke at full strength.
- Don’t introduce color, gradient grounds, shadows, outlines, or effects.
- Don’t rotate, skew, stretch, crop, or rearrange the two strokes.
- Don’t place the mark elsewhere in the hub; the nav and footer are the deliberate brand moments.

## File inventory

- `public/logos/wrenchless-mark-dark.svg` — paper mark for dark grounds.
- `public/logos/wrenchless-mark-light.svg` — ink mark for light grounds.
- `public/logos/wrenchless-wordmark-dark.svg` — paper mark and Hanken lockup.
- `public/logos/wrenchless-wordmark-light.svg` — ink mark and Hanken lockup.
- `public/favicon.svg` — layered W on the ink tile.
- `public/og.svg` — 1200 × 630 social source.
- `public/og.png` — raster social image.

## Scene photography

The hero and the five story scenes ship as WebP under `public/images/`. Those
files are derived, not originals: each one is downsampled from a master PNG four
to eight times its linear size, and the masters are the only source that can
produce a new crop, a new aspect ratio, or a retina export.

The masters live in `apps/hub/art-src/` and are **not in this repository** —
56 MB of PNG that no build step reads has no business in git history. They are
kept outside it. Anyone re-deriving a scene needs that directory; git will not
supply it.

- `art-src/hero-wallet.png` (7680 x 4320) -> `public/images/hero-wallet.webp` (1600 x 900)
- `art-src/story/*.png` (up to 7680 x 5760) -> `public/images/story/*.webp`
