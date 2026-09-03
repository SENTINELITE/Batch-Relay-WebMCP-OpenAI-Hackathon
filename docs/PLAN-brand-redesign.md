# Plan: bring the WebMCP storefront on brand, with light and dark mode

Status: implemented 2026-09-01 on branch `codex/webmcp-storefront` (uncommitted). Screenshots in `docs/screenshots/`. Deviations: prepare and review JSX moved to `prepare-step.tsx` and `review-step.tsx` with the test read targets updated; `PhotoTray` and `FormatPicker` kept their props.

## 1. Goal

Rebuild the storefront's presentation layer so it reads as a Batch Relay
surface next to batchrelay.com and app.batchrelay.com, and so it supports
light and dark mode with the same preference mechanism the app uses. Business
logic, the WebMCP tool contract, and the API boundary do not change.

## 2. Sources of truth

Read these before writing any UI code. They are outside this repo.

| Source | Path | What to take from it |
|---|---|---|
| Brand design system | `/Users/kirkland/Developer/Websites/app-batch-relay/BATCH-RELAY-MARKETING-DESIGN-SYSTEM.md` | Colors, type scale, shape system, motion rules, voice. Authoritative. |
| App tokens | `/Users/kirkland/Developer/Websites/app-batch-relay/src/app/globals.css` | Tailwind v4 `@theme` block, `:root` and `.dark` token ramps, warm shadows, `--ease-out-expo`. |
| App theme mechanism | `/Users/kirkland/Developer/Websites/app-batch-relay/src/lib/theme-preference.ts` and `src/components/theme-provider.tsx` | Class-based dark mode, pre-paint bootstrap script, `batchrelay-theme-preference` cookie shared across `*.batchrelay.com`. |
| Brand-grade button and field | `/Users/kirkland/Developer/Websites/app-batch-relay/src/components/auth/auth-primitives.tsx` | Pill CTA (54px, orange fill, espresso text), 14px-radius field, focus ring at 3px orange/40. |
| General Sans font file | `/Users/kirkland/Developer/Websites/app-batch-relay/src/fonts/GeneralSans-Variable.woff2` | Copy into this repo. 38KB, weight axis 200 to 700. |
| App component bundle | `/Users/kirkland/Developer/Websites/app-batch-relay/ds-bundle/README.md` | Utility idiom, semantic surface pairs, radius and shadow names. |

Observed on the live sites (2026-09-01):

- batchrelay.com is Next.js with shadcn neutral tokens plus the warm brand hexes
  in components (`#fef7f0`, `#17110c`, `#ff7c21`, `#322821`, `#c6b6aa`), Inter
  and JetBrains Mono, pill buttons (`border-radius: 999px`), and a class-based
  `.dark` block. The design-system doc describes where that site is heading,
  so this plan follows the doc, not the live neutral tokens.
- app.batchrelay.com uses the warm cream/espresso ramp above, Geist for app UI,
  General Sans on the auth surface, orange as the only accent, and a
  three-state System/Light/Dark preference.

## 3. What is off brand today

- Palette: cool grey paper (`#edf0ef`), slate ink (`#1e2c35`), cobalt
  (`#1459e5`) and coral (`#ef6b5b`). The brand has one accent, orange, on
  warm cream and espresso.
- Type: Playfair Display italics, Manrope body, DM Mono uppercase eyebrows on
  almost every block. The brand is a single family, General Sans, sentence
  case, with italics used sparingly.
- Shape: square corners everywhere, 1px ink borders, hard offset shadows on
  hover (`10px 10px 0 cobalt`), a rotated square wordmark. The brand uses
  18 to 20px surfaces, 12 to 14px fields, pill buttons, warm soft shadows,
  and photography with a physical print border.
- Density: many labels at 0.52 to 0.66rem. The brand floor is 13px.
- No dark mode. Hard-coded hexes (`#7d2634`, `#c7d0d3`, `#cbd2d2`) and
  `white` are sprinkled through the stylesheet.
- Architecture: one 1,427-line client component and one 31KB stylesheet
  written as single-line rules. Hard to theme, hard to review.

## 4. Decisions

1. **Tailwind v4 with a copied `@theme` block.** Same idiom as the app, so
   token names match (`bg-background`, `text-ink`, `border-border`,
   `shadow-studio-sm`, `rounded-field`, `rounded-panel`). Adds
   `tailwindcss` and `@tailwindcss/postcss` as dev dependencies. No runtime
   dependency on the private app.
2. **General Sans Variable for all UI text**, loaded with `next/font/local`
   from `src/fonts/`. Geist Mono from `next/font/google` for identifiers only
   (asset IDs, render IDs, slot keys, order codes). Mono never carries labels
   or headings.
3. **Class-based dark mode, three-state preference.** Port
   `theme-preference.ts` verbatim minus nothing (it has no private imports),
   and a slimmed `ThemeProvider` without analytics. Keep the cookie name and
   domain rule so a deploy on a `*.batchrelay.com` host inherits the visitor's
   app preference. Inject the bootstrap script in `layout.tsx` before paint
   and set `color-scheme` on `html` so native `select`, `range`, and file
   inputs theme correctly.
4. **Pill primary buttons, per the design doc and the auth surface.** The
   app's generic `Button` is 8px radius, but the brand doc and the brand-grade
   auth CTA are both pills, and the marketing site uses 999px. Secondary
   actions are outlined pills. Tertiary actions are text buttons.
5. **Decompose the component but keep test anchors.** Six tests grep
   `manual-storefront.tsx` for exact strings (section 8). Extraction must
   either keep those strings in that file or update the test in the same
   change. No silent breakage.
6. **Commit the current working tree first.** There are 1,306 uncommitted
   lines across 12 files (tray-first WebMCP work). The redesign lands on top
   of that commit, never mixed into it.

## 5. Target design language for this surface

The storefront is a working tool, not a marketing page. Use the brand's
tokens and shapes at the app's density, not the homepage's.

### Tokens

Copy the design doc's theme tokens plus the app's semantic aliases.

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: var(--font-general-sans);
  --font-mono: var(--font-geist-mono);
  --color-background: var(--background);   /* canvas */
  --color-foreground: var(--foreground);
  --color-card: var(--card);               /* surface */
  --color-card-foreground: var(--card-foreground);
  --color-surface-warm: var(--surface-warm);
  --color-primary: var(--primary);         /* orange */
  --color-primary-foreground: var(--primary-foreground); /* espresso, both modes */
  --color-primary-hover: var(--primary-hover);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-ring: var(--ring);
  --color-photo-border: var(--photo-border);
  --color-status-success: var(--status-success);
  --color-status-success-surface: var(--status-success-surface);
  --color-status-warning: var(--status-warning);
  --color-status-warning-surface: var(--status-warning-surface);
  --color-status-error: var(--status-error);
  --color-status-error-surface: var(--status-error-surface);
  --radius-control: 12px;
  --radius-field: 14px;
  --radius-photo: 14px;
  --radius-surface: 18px;
  --radius-panel: 22px;
  --ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1);
}

:root {
  --background: #fbf2eb;  --foreground: #17110c;
  --card: #ffffff;        --card-foreground: #17110c;
  --surface-warm: #ffede1;
  --primary: #ff7c21;     --primary-hover: #e9650e;  --primary-foreground: #17110c;
  --muted-foreground: #4b4240;
  --border: rgb(23 17 12 / 0.12);  --border-strong: rgb(23 17 12 / 0.24);
  --ring: #ff7c21;        --photo-border: #ffffff;
  --status-success: #236f77; --status-success-surface: #e3f2e3;
  --status-warning: #8b4a16; --status-warning-surface: #ffe4cf;
  --status-error: #a4382a;   --status-error-surface: #fbe5e1;
  --shadow-warm: 0 8px 24px rgb(23 17 12 / .08), 0 2px 6px rgb(23 17 12 / .06);
  --shadow-warm-lg: 0 20px 48px rgb(23 17 12 / .12), 0 6px 16px rgb(23 17 12 / .08);
}

.dark {
  --background: #17110c;  --foreground: #fef7f0;
  --card: #322821;        --card-foreground: #fef7f0;
  --surface-warm: #4c2818;
  --primary: #ff7c21;     --primary-hover: #ff9147;  --primary-foreground: #17110c;
  --muted-foreground: #c6b6aa;
  --border: rgb(254 247 240 / 0.14);  --border-strong: rgb(254 247 240 / 0.28);
  --ring: #ff7c21;        --photo-border: #fef7f0;
  --status-success: #75c9c0; --status-success-surface: color-mix(in srgb, #75c9c0 16%, var(--card));
  --status-warning: #ffb77c; --status-warning-surface: color-mix(in srgb, #ffb77c 16%, var(--card));
  --status-error: #ff958b;   --status-error-surface: color-mix(in srgb, #ff958b 16%, var(--card));
  --shadow-warm: 0 8px 24px rgb(0 0 0 / .28), 0 2px 6px rgb(0 0 0 / .2);
  --shadow-warm-lg: 0 20px 48px rgb(0 0 0 / .4), 0 6px 16px rgb(0 0 0 / .28);
}
```

The design doc lists semantic colors for light mode only. The dark values
above are taken from the app's `.dark` block so both surfaces agree.

### Type

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title (h1) | 40 to 56px, `clamp(2.5rem, 4vw, 3.5rem)` | 600 | Tracking -0.03em, line height 1.0. Smaller than the marketing hero on purpose. |
| Section title (h2) | 28 to 36px | 600 | Tracking -0.02em. |
| Card title | 18 to 20px | 600 | |
| Body | 16px | 400 | Line height 1.55, max 65ch. |
| Supporting | 14px | 400 to 500 | `text-muted-foreground`. |
| Identifier | 13px mono | 400 | Only for IDs, keys, and codes. |
| Button | 15 to 16px | 600 | |

Rules: sentence case everywhere. Drop the uppercase mono eyebrows. Keep at
most one small overline per page region and set it in General Sans 500 at
13px, not mono. Nothing under 13px.

### Shape and elevation

- Surfaces (tray, format cards, prep panels, cart, sandbox card): 18px
  radius, `bg-card`, `border-border`, `shadow-warm` on hover or focus-within
  only.
- Fields and selects: 14px radius, 48px tall, `bg-card`, `border-border-strong`,
  orange border and 3px orange/18 halo on focus.
- Buttons: full pill. Primary is orange fill with espresso text, 48px tall
  (54px for the two conversion buttons: add to cart, sandbox order).
  Secondary is a 1px `border-strong` outline. Tertiary is text only.
- Selected state on cards and chips: 2px orange border plus a small orange
  check badge. Replace the current inset bottom bar.
- Photographs (tray thumbnails, crop station, browser preview): 14px radius,
  6px `photo-border` frame, `shadow-warm`, slight rotation on hover for tray
  cards only. No labels overlaid on images. Move the ordinal badge and crop
  label outside the image frame.
- Focus: `outline: 3px solid var(--ring); outline-offset: 2px` on every
  interactive element.

### Motion

Intensity 6 of 10 per the doc, but this is a tool, so cap it lower here:
tactile press (`active:scale-[.99]`), 200ms `ease-out-expo` on color and
transform, a single staggered reveal for tray cards on import. Nothing loops.
Everything respects `prefers-reduced-motion`.

## 6. Page structure after the redesign

Same three steps, same order, same copy where it is already good.

1. **Masthead (sticky, 64 to 72px).** Batch Relay wordmark in orange, no
   rotated square. Center: "Print workbench" as quiet text. Right: a Test
   Mode chip using the warning status pair, cart count pill, and the theme
   menu (port of `ThemePreferenceMenu`, sun/moon icon, System/Light/Dark).
2. **Visible drafts rail** (only when drafts exist). Horizontal chips on
   `bg-surface-warm`, selected chip gets the orange border.
3. **Intro.** One h1 in General Sans 600, one lede at 18px. Drop the Playfair
   italic line. Suggested copy stays: "Load the photographs. Name the print."
4. **Photo tray.** Full width card with 18px radius. Header row: title, one
   sentence, then three pill actions (Add images, Add folder, Reconnect
   folder). Thumbnails as physical prints with the ordinal and filename
   below the frame. Drop target state: orange dashed border on the card.
5. **Stepper.** A pill segmented control, three segments, disabled segments
   at 50 percent. Replaces the top-and-bottom-rule strip.
6. **Format step.** Three quick-format cards in a row (one column under
   768px). "All compatible formats" as a disclosure that expands into a
   four-up grid. Product ID and revision in 13px mono under the name.
7. **Prepare step.** Two columns from 1024px. Left: crop station in a print
   frame with the registration marks removed and a small "Crop 5 : 7"
   caption below. Right: three numbered panels (Prepare photo, Artwork path,
   Provider offer) each an 18px surface. Range inputs use `accent-color:
   var(--primary)`. The template fieldset keeps its slot assignment rows and
   the browser preview; the browser preview canvas gets the print frame.
8. **Review step.** Two columns. Left: cart list and address form. Right:
   sandbox card on `bg-surface-warm` in light mode and `bg-card` in dark,
   with the Test Mode chip, quote result, the two conversion buttons, and the
   "Production checkout is disabled" lock as an error-status callout.
9. **Footer.** One line, 14px, muted.

## 7. Architecture and file plan

```
src/
  app/
    globals.css              rewritten: tailwind import, @theme, :root, .dark, base
    layout.tsx               fonts, theme bootstrap script, ThemeProvider, suppressHydrationWarning
    page.tsx                 unchanged
  fonts/
    GeneralSans-Variable.woff2
  lib/theme/
    theme-preference.ts      port from app, pure functions + bootstrap script
  components/theme/
    theme-provider.tsx       context, applyTheme, useThemePreference
    theme-menu.tsx           ThemePreferenceMenu port, lucide icons or inline SVG
  components/ui/
    button.tsx               variants: primary | secondary | ghost; sizes: md | lg
    field.tsx                Label + Input, Label + Select, Label + Range
    surface.tsx              Card-like wrapper with optional selected state
    chip.tsx                 status and environment chips
    notice.tsx               status callout (info | success | warning | error)
    print-frame.tsx          photo border + shadow + optional aspect ratio
  components/storefront/
    manual-storefront.tsx    state container; JSX delegates to the sections below
    storefront-masthead.tsx
    draft-rail.tsx
    workbench-stepper.tsx
    photo-tray.tsx           restyled, same props
    format-picker.tsx        restyled, same props
    prepare-step.tsx         crop station + prep panels; receives props from the container
    review-step.tsx          cart, address desk, sandbox card
    template-slot-assignment.tsx   restyled, same props
    browser-template-preview.tsx   restyled, same props and same test anchors
```

`lucide-react` is optional. Three icons (sun, moon, sun-moon, check) can be
inline SVG to avoid a dependency in a public repo.

Untouched: `src/webmcp/**`, `src/lib/storefront/**`, `src/lib/batch-relay/**`,
every `src/app/api/**` route, and `WebMcpRegistrar.tsx`. The WebMCP layer has
no DOM coupling (no selectors, no class names), so the redesign cannot affect
agent tools as long as the bridge and state contract stay put.

## 8. Test anchors that constrain extraction

These tests read component source as text. Either keep the matched text in
the named file or update the test in the same commit.

`tests/implementation-boundaries.test.mjs` reads `manual-storefront.tsx` for:
`Place no-charge sandbox order`, `Production checkout is disabled`,
`storefrontClient.submitSandboxOrder`, and asserts no `checkout intent` text.

`tests/template-workflow.test.mjs` reads `manual-storefront.tsx` for:
`compatibleTemplateOutputs(outputs.outputs, productForCompatibility)`,
`compatible.length === 0`, `Compatible published output`,
`rememberedCompatibleOutput(draft.template, template.id, outputs.revision_id, compatible)`,
`draftId?: string;`, `const targetDraftId = draftId ?? selectedDraftId;`,
`chooseTemplate(template.id, product, output.id, requestedOrientation, draft.id)`,
`published_required:`, `slots={visibleTemplateSlots}`,
`const missingRequirements = product.template_requirement === "required"`,
`missing_requirements: missingRequirements`, `"ready_for_proof_or_cart"`,
`slot_assignments:`, `const nextShipTo = typeof request.input.shippingPostalCode === "string"`,
`completeAddress(nextShipTo) && completeAddress(shipFrom)`,
`function invalidateTemplateRenderForBrowserPreviewChange()`,
`setTemplateRender(null)`, and `function updateBrowserPreviewTransform(...)`.
It also reads `browser-template-preview.tsx` for several identifiers listed
at lines 311 to 320.

Practical consequence: the two conversion buttons, the "Compatible published
output" select label, and `slots={visibleTemplateSlots}` should stay in
`manual-storefront.tsx` JSX, or `review-step.tsx` and `prepare-step.tsx`
become the files the tests read. Recommendation: update the tests to read
the new files. The assertions are about behavior, not about which file
holds the JSX.

## 9. Work breakdown

Phase 0, prerequisite, one commit: commit the current working tree as is.

Phase 1, foundation, one agent, must finish before Phase 2:

- Add Tailwind v4, `postcss.config.mjs`, rewrite `globals.css` with the
  tokens above and base styles.
- Copy the font, wire `next/font/local` and Geist Mono in `layout.tsx`.
- Port theme preference, provider, bootstrap script, and menu.
- Build `components/ui/*` with light and dark verified in a scratch page
  that is deleted before merge.
- Run `npm run typecheck`, `npm run lint`, `npm run build`.

Phase 2, parallel agents with disjoint file ownership:

| Agent | Owns | Notes |
|---|---|---|
| A: shell | `storefront-masthead.tsx`, `draft-rail.tsx`, `workbench-stepper.tsx`, footer, the intro block, and the outer JSX of `manual-storefront.tsx` | Only agent allowed to edit `manual-storefront.tsx`. Others export components it imports. |
| B: photos and formats | `photo-tray.tsx`, `format-picker.tsx` | Same props. Print frame treatment for thumbnails. |
| C: prepare | `prepare-step.tsx`, `template-slot-assignment.tsx`, `browser-template-preview.tsx` | Keeps the browser preview test anchors. |
| D: review | `review-step.tsx` | Moves the review JSX out; updates `implementation-boundaries.test.mjs` read target. |

Agent A lands last and stitches the sections in. To avoid A blocking on
B, C, D, each of those agents exports a component with the exact prop
signature written in a shared `docs/PLAN-brand-redesign-props.md` before
Phase 2 starts.

Phase 3, verification, one agent:

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Screenshots in light and dark at 390px, 820px, and 1440px for each of the
  three steps, with photos loaded and a draft selected. Store under
  `docs/screenshots/` for review.
- Contrast check every text and border token pair in both modes against
  WCAG AA. Orange text on cream fails at body size; orange is used for
  fills, borders, and icons only.
- Keyboard walk of the whole flow: every control reachable, focus ring
  visible in both modes, theme menu operable with arrows and Escape.
- `prefers-reduced-motion` walk: no transitions, no rotation.
- Native controls in dark mode: `select`, `range`, and file inputs render
  dark because `color-scheme` is set on `html`.

## 10. Open questions for the owner

1. Font: General Sans for everything (this plan) versus Geist to match app
   dashboard chrome. The brand doc says General Sans; the plan follows it.
2. Should the storefront ship its own theme menu, or follow only the system
   and the shared cookie with no visible toggle? The plan includes the menu
   because the app has one.
3. "Print workbench" naming and the current h1 copy stay unless you want
   the storefront to read as a customer store rather than an agent desk.
4. Deploy host: if this ends up on a `*.batchrelay.com` subdomain, the
   shared theme cookie applies automatically. If it stays on another
   domain, the preference is local to that site.
