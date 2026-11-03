# Swatch

Branded demo asset generator. Type a retailer or brand name; Swatch resolves the brand's
logo, palette and font, then renders a consistently named set of PNGs (splash screens, app
icons, banners, header logos, signage, tiles, logo knockouts) plus a `manifest.json`, a
`contact-sheet.html` and a `.zip`, ready to drop into the demo UI.

Logos are never drawn or redrawn by a model: templates composite the real logo file, sized
with `object-fit: contain` inside each template's safe area. The only intentional recoloring
is the white and dark knockout variants.

## Setup

Requires Node 22+ (tested on Node 25, macOS).

```bash
npm install
npx playwright install chromium
cp .env.example .env    # optional: add logo.dev keys
```

Optional global command (otherwise use `npm run swatch -- …`):

```bash
npm link
```

## Web UI

```bash
npm run ui        # http://127.0.0.1:3000 (local only)
```

1. **Brand**: name, optional domain, optional logo upload, and an Offline switch. If the
   brand already has a saved identity, Swatch offers to reuse it instead of calling the
   APIs again. Saved identities are also listed as chips.
2. **Progress** streams while the identity is resolved. If no usable logo is found, the
   form asks for an upload.
3. **Identity editor**:
   - Replace the wordmark or mark (same 500px gate), and edit the four hex colors.
     Edited values are tagged `manual`, and you can re-extract the palette from the logos.
   - Pick any Google Font (bundled fonts only when offline), and edit the headline,
     subhead and tagline copy.
   - The preview shows each surface with the logo variant and text color Swatch will
     use, plus their contrast ratios.
4. **Generate** with a device filter. Progress shows per asset.
5. **Gallery** grouped by device and orientation, with links to the contact sheet and
   manifest, and **Download zip**.

The UI and CLI share `brands/` and `output/`, so a brand resolved in one opens in the
other. For production-style serving: `npm run ui:build && npm run ui:start`.

## CLI usage

```bash
swatch "Ace Hardware" --domain acehardware.com
swatch "Kroger" --only phone,tablet
swatch "Fixture Co" --offline --logo path/to/logo.svg
swatch "Patagonia" --reuse          # re-render from saved brand.json, no lookups
swatch "Patagonia" --refresh        # resolve again from scratch
swatch "Kroger" --resolve-only      # write brand.json, render nothing
```

| Flag | Meaning |
| --- | --- |
| `--domain` | Official domain. Strongly recommended: it disambiguates and enables site/logo.dev lookups. |
| `--only` | Comma-separated devices, asset ids or types from `config/sizes.yaml`. |
| `--logo`, `--mark` | Use these files instead of discovery (SVG, or PNG ≥ 500px). |
| `--font` | Force a Google Font family. |
| `--offline` | Zero third-party network calls (see below). |
| `--reuse` / `--refresh` | Skip the "reuse saved identity?" prompt either way. |
| `--out` | Output folder (default `output/<slug>/<timestamp>/`). |
| `--no-ai` / `--ai` | AI backgrounds are off by default (and not built yet). |

Exit code `2` means no usable logo was found. Swatch refuses to upscale a logo under
500px; re-run with `--logo`.

### Output

```
output/<slug>/<timestamp>/
  splash_portrait_1170x2532.png        <asset-type>_<orientation>_<w>x<h>.png
  header-logo_landscape_200x50@2x.png  @2x = double the pixels, same logical size
  …
  manifest.json                        file, size, type, device, orientation, template, demo-UI slot
  contact-sheet.html                   every asset, grouped by device and orientation
  <slug>_<timestamp>.zip
```

The same `brand.json` + templates always render byte-identical PNGs. Renders are cached in
`brands/<slug>/.cache/`, keyed by the full HTML, size and Chromium version, so re-runs only
render what changed.

## How brand resolution works

Everything ends up in `brands/<slug>/brand.json` (plus `logo/` and `fonts/`). Each value
records its `source` (`site`, `api`, `pixels`, `derived`, `manual`, `fallback`), and
`notes` explains what was picked and what was rejected. **Hand-edit it freely**, then
re-run with `--reuse`.

1. **Domain**: `--domain`, else logo.dev Brand Search (secret key), else Wikidata's
   "official website", else a `<name>.com` guess.
2. **Logo**, best first:
   1. `--logo` / `--mark`
   2. the brand site's header logo (inline SVG or `<img>`, scored by "logo" in its
      attributes, linking home, position in the header). Swatch loads the homepage in
      headless Chromium. Sites that block automated visitors are respected, not bypassed.
   3. logo.dev (publishable key)
   4. Wikimedia: the English Wikipedia infobox logo, then Wikidata's logo (P154).
      Retired logos such as "Kroger logo (1961-2019).svg" are skipped.
   5. web-manifest icons, favicons, apple-touch-icon, og:image (only if it looks like a logo)

   Swatch keeps a **wordmark** (wide) and a **mark** (square-ish) when it finds both.
   White canvases are removed, SVG viewBoxes are tightened to the artwork, and solid
   app-icon style marks are flagged as `tile` and never knocked out.
3. **Palette**: k-means in OKLab over the logo's opaque pixels, plus the site's
   `theme-color`. Missing slots are derived from the primary. Every surface's text color
   is checked against WCAG AA (4.5:1). Headline colors are nudged in lightness until they
   pass, and each surface picks the logo variant (full-color, white, or dark) that reaches
   3:1. The contact sheet shows the ratios.
4. **Font**: the font-family the site actually uses. If it's a Google Font it's used as
   is; commercial fonts map to the closest Google Font via `config/font-fallbacks.yaml`
   (Gotham → Montserrat, Avenir → Nunito Sans…). 13 common families ship with Swatch, so
   offline runs and tests never download fonts.

### Offline mode

`--offline` (or the UI's Offline switch) makes `fetch` throw, skips the site scan, logo.dev
and Wikimedia, and only uses bundled fonts. In the UI the guard is scoped to that request,
so other requests can still go online. The renderer aborts every non-`data:` request in all
modes. You must supply `--logo` (or have a saved `brand.json`). Use it for confidential
prospects: outside offline mode, a lookup discloses the brand name to the brand's own
site, logo.dev, Wikimedia, and (for non-bundled fonts) jsDelivr.

## Adding a size

Add a `sizes` row to an existing entry in `config/sizes.yaml`:

```yaml
  - id: tablet-splash
    …
    sizes:
      - { orientation: portrait, width: 1668, height: 2388 }
      - { orientation: portrait, width: 1536, height: 2048 }   # new
```

Orientation must match the dimensions, and no two rows may produce the same filename.
`npm test` checks both.

## Adding a demo-UI slot

Add an entry. `slot` is the identifier the demo UI uses, and it is written to `manifest.json`:

```yaml
  - id: kiosk-attract
    device: display            # contact-sheet group and --only key
    type: attract              # filename prefix
    template: splash
    slot: kiosk.attract.loop
    ai_background: true
    options: { surface: secondary, logo: mark, logo_scale: 0.5 }
    sizes:
      - { orientation: portrait, width: 1080, height: 1920 }
```

Template options are documented at the top of each `templates/<name>/layout.ts`.

## Adding a template

1. Create `templates/<name>/template.hbs`. Start it with `{{> head}}`, which adds the
   embedded brand font, a CSS reset, page size and a `.safe` class (absolute box inset by
   the safe area). Use `{{{logoHtml}}}` for the logo.
2. Create `templates/<name>/layout.ts` exporting `prepare(input)`, which returns the
   values your `.hbs` uses. Helpers are in `src/core/render/layout.ts` and
   `src/core/render/context.ts`:
   - `pickLogo`, `fitBox` / `sizeByArea`, `logoHtml` (never distorts)
   - `input.surface("primary")`: background, gradient shades, AA-checked `ink` and `brandInk`
   - `variantOn(logo, bg)`: full-color vs knockout by contrast
3. Register it in `templates/index.ts`, then reference it from `config/sizes.yaml`.

Text elements with `data-fit="2"` shrink until they fit in 2 lines; `data-fit-box` scales an
element down to its parent's width. Templates must be self-contained (everything is a
`data:` URI), because network requests are blocked during rendering.

## Tests

```bash
npm test            # palette, contrast, matrix, naming, offline run, snapshot
npm run test:update # re-baseline the splash snapshot after an intentional template change
npm run typecheck
```

## Project layout

```
src/core/        brand resolution, size matrix, rendering, output (shared by CLI and UI)
src/cli/         the swatch command
src/server/      small HTTP helpers for the UI's API routes (SSE, safe file serving)
app/             Next.js UI (page + components in app/ui/) and API routes in app/api/
templates/       HTML/CSS templates + layout logic
config/          sizes.yaml, font-fallbacks.yaml
```

## Not built yet

- Optional AI backgrounds (`--ai`)
