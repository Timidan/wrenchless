# Wrenchless brand assets

Wrenchless is a passkey-protected trip allowance for private STRK and USDC. Its identity stays quiet, ordinary-looking, and precise: the product should feel like a small place to lock part of a balance, not a trading dashboard.

## The mark

The W is built from two identical V strokes. The solid front V is what travels with you. The quieter rear V is the balance locked until your return. The offset makes the W without adding a shield, lock, key, or other overt security symbol.

The construction uses a 32 × 32 viewBox, 2.5-unit strokes, square caps, and miter joins. Keep the geometry and the front/rear order intact.

## Space and size

Keep clearspace of at least 8 units—one quarter of the mark width—on every side of the standalone mark or full lockup. No type, rule, crop, or image edge should enter it.

- Standalone mark: 16px minimum digital size.
- Full lockup: 120px minimum digital width.
- Favicon: use `favicon.svg`; its ink tile supplies the required edge separation.

## Ground and type

Use `*-dark.svg` on `#0f0e0d` or `#141414` grounds; it draws in paper white. Use `*-light.svg` on white or near-white grounds; it draws in `#141414`. Photography is acceptable only where the approved mark variant stays clearly legible.

The exported lockups set lowercase “wrenchless” with the approved fallback metrics. The hub does not request remote fonts. For a fully outlined production export, convert the wordmark text with the official Hanken Grotesk Medium font. The live nav and footer use the bundled Fragment-compatible fallback metrics.

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
- `public/logos/wrenchless-wordmark-dark.png` — transparent paper lockup for dark README themes.
- `public/logos/wrenchless-wordmark.png` — transparent ink lockup for light README themes.
- `public/favicon.svg` — layered W on the ink tile.
- `public/og.svg` — 1200 × 630 social source.
- `public/og.png` — raster social image.

## Scene photography

The hero and the five story scenes ship as WebP under `public/images/`. Those
files are derived, not originals: each one is downsampled from a master PNG four
to eight times its linear size, and the masters are the only source that can
produce a new crop, a new aspect ratio, or a retina export.

The generated masters are intentionally not kept in the workspace or the
repository. The build and the live site use only the compressed WebP files.

- hero wallet master (7680 x 4320) -> `public/images/hero-wallet.webp` (1600 x 900)
- story masters (up to 7680 x 5760) -> `public/images/story/*.webp`
