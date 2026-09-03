# Brand redesign: tokens and primitive API

Phase 1 output. This is the contract Phase 2 agents build against. Everything
here exists in the repo today; nothing is aspirational.

Import paths:

```tsx
import { Button, Chip, Notice, PrintFrame, RangeField, SelectField, Surface, TextField, buttonClassName } from "@/components/ui";
import { ThemeProvider, useThemePreference } from "@/components/theme/theme-provider";
import { ThemePreferenceMenu } from "@/components/theme/theme-menu";
import { cn } from "@/lib/cn";
```

`ThemeProvider` already wraps the whole tree in `src/app/layout.tsx`. Do not add
a second one. Drop `<ThemePreferenceMenu />` into the masthead.

---

## 1. Rules of the surface

- General Sans is the only UI font (`font-sans`, the default on `body`). Geist
  Mono (`font-mono`) is for identifiers only: asset IDs, render IDs, slot keys,
  order codes, product IDs. Never for labels or headings.
- Sentence case everywhere. No uppercase eyebrows, no letter-spaced overlines.
- Nothing under 13px.
- Orange is a fill, border and icon color. Never body text on cream: it fails
  AA. `text-primary` is fine on `bg-primary/15`, on `bg-card` for icons, and for
  short bold labels at 15px or larger; prefer `text-foreground` for prose.
- Motion is capped: 200ms, `ease-out-expo`, `active:scale-[.99]`.
  Always pair with `motion-reduce:transition-none`. Nothing loops.
- Focus: a global `:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px }`
  is in the base layer. Do not remove it. Fields opt out on purpose and use the
  orange border plus halo instead.

## 2. Tokens and utility class names

Defined in `src/app/globals.css`. Both modes are wired; `.dark` on
`<html>` swaps every value. Never hard-code a hex.

### Color utilities

| Utility | Light | Dark | Use |
|---|---|---|---|
| `bg-background` | `#fbf2eb` | `#17110c` | Page canvas. Already on `body`. |
| `text-foreground` | `#17110c` | `#fef7f0` | Default text. Already on `body`. |
| `bg-card` / `text-card-foreground` | `#ffffff` / `#17110c` | `#322821` / `#fef7f0` | Panels, fields, menus, tray. |
| `bg-surface-warm` | `#ffede1` | `#4c2818` | Secondary fill: rails, hovers, quiet chips. |
| `bg-primary` | `#ff7c21` | `#ff7c21` | Orange fill. |
| `hover:bg-primary-hover` | `#e9650e` | `#ff9147` | Primary hover only. |
| `text-primary-foreground` | `#17110c` | `#17110c` | Text on orange, espresso in both modes. |
| `text-primary` / `border-primary` | `#ff7c21` | `#ff7c21` | Icons, selected borders, accents. |
| `text-muted-foreground` | `#4b4240` | `#c6b6aa` | Supporting copy, hints, captions. |
| `border-border` | `rgb(23 17 12 / .12)` | `rgb(254 247 240 / .14)` | Default hairline. |
| `border-border-strong` | `rgb(23 17 12 / .24)` | `rgb(254 247 240 / .28)` | Fields, outlined buttons. |
| `ring`/`outline-ring` (`var(--ring)`) | `#ff7c21` | `#ff7c21` | Focus ring, set globally. |
| `bg-photo-border` | `#ffffff` | `#fef7f0` | The physical print frame. |

Status pairs, always used together (surface behind, color on the accent bar or
chip text):

| Text utility | Surface utility | Light | Dark |
|---|---|---|---|
| `text-status-success` | `bg-status-success-surface` | `#236f77` on `#e3f2e3` | `#75c9c0` on 16% mix into card |
| `text-status-warning` | `bg-status-warning-surface` | `#8b4a16` on `#ffe4cf` | `#ffb77c` on 16% mix into card |
| `text-status-error` | `bg-status-error-surface` | `#a4382a` on `#fbe5e1` | `#ff958b` on 16% mix into card |
| `text-status-info` | `bg-status-info-surface` | `#4b4240` on `#ffede1` | `#c6b6aa` on 12% mix into card |

Opacity modifiers work as usual: `bg-primary/15`, `text-muted-foreground/70`,
`border-primary/40`.

### Radius

| Utility | Value | Use |
|---|---|---|
| `rounded-control` | 12px | Small controls, menu items, badges. |
| `rounded-field` | 14px | Inputs, selects, textareas. |
| `rounded-photo` | 14px | Photo frames. |
| `rounded-surface` | 18px | Cards, panels, tray, menus. |
| `rounded-panel` | 22px | The largest outer containers. |
| `rounded-full` | pill | Every button and chip. |

`Surface`, `Notice`, `PrintFrame` and the theme menu currently hard-code the
matching pixel values (`rounded-[18px]`, `rounded-[14px]`); `rounded-surface`
and `rounded-field` are the equivalent named utilities for your own markup.

### Elevation, motion, type

| Utility | Value |
|---|---|
| `shadow-warm` | `0 8px 24px rgb(23 17 12 / .08), 0 2px 6px rgb(23 17 12 / .06)`, dark: `0 8px 24px rgb(0 0 0 / .28), 0 2px 6px rgb(0 0 0 / .2)` |
| `shadow-warm-lg` | `0 20px 48px rgb(23 17 12 / .12), 0 6px 16px rgb(23 17 12 / .08)`, dark: `0 20px 48px rgb(0 0 0 / .4), 0 6px 16px rgb(0 0 0 / .28)` |
| `ease-out-expo` (or `ease-[var(--ease-out-expo)]`) | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `font-sans` | General Sans variable, weight axis 200 to 700 |
| `font-mono` | Geist Mono |

Shadows read `--shadow-warm-value` / `--shadow-warm-lg-value` under the hood, so
`var(--shadow-warm)` also works in an arbitrary value.

### Type scale to follow (from the plan, section 5)

| Role | Classes |
|---|---|
| Page title h1 | `text-[clamp(2.5rem,4vw,3.5rem)] font-semibold tracking-[-0.03em] leading-none` |
| Section title h2 | `text-3xl font-semibold tracking-[-0.02em]` (28 to 36px) |
| Card title | `text-lg font-semibold` or `text-xl font-semibold` |
| Body | `text-base leading-[1.55]`, cap prose at `max-w-[65ch]` |
| Supporting | `text-sm text-muted-foreground` |
| Identifier | `font-mono text-[13px]` |
| Overline (at most one per region) | `text-[13px] font-medium text-muted-foreground` |

### Dark mode

Class-based: `@custom-variant dark (&:where(.dark, .dark *))`. Write
`dark:` variants only for the rare case a token pair cannot express the change,
for example `bg-surface-warm dark:bg-card`.

## 3. Button

`src/components/ui/button.tsx`. Server component; no `"use client"` needed
unless your own file needs it.

```ts
type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "md" | "lg";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;   // default "primary"
  size?: ButtonSize;         // default "md"
  loading?: boolean;         // default false
};

const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
function buttonClassName(variant?: ButtonVariant, size?: ButtonSize, className?: string): string;
```

- Always a pill. `md` is `h-12 px-5 text-[15px] font-semibold`; `lg` is
  `h-[54px] px-6 text-base font-semibold` and is reserved for the two conversion
  buttons (add to cart, place sandbox order).
- `primary` orange fill with espresso text. `secondary` is a `border-border-strong`
  outline on `bg-card` that warms on hover. `ghost` is text only, muted until hover.
- `loading` renders a spinner, sets `aria-busy` and disables the button.
- `type` defaults to `"button"`, so a button inside a form will not submit unless
  you pass `type="submit"`.
- Extra classes are appended, not merged. Passing `className="bg-card"` after a
  `primary` variant is a coin flip; change the variant instead.

```tsx
<Button onClick={addToCart}>Add to cart</Button>
<Button size="lg" loading={submitting} onClick={placeOrder}>Place no-charge sandbox order</Button>
<Button variant="secondary" onClick={pickFolder}>Add folder</Button>
<Button variant="ghost" onClick={clearTray}>Clear tray</Button>

{/* a <label> or <a> that must look like a button */}
<label className={`${buttonClassName("secondary")} cursor-pointer`}>
  Add images
  <input type="file" multiple className="sr-only" onChange={onFiles} />
</label>
```

## 4. Fields

`src/components/ui/field.tsx`. Three components, one shell.

```ts
type SharedFieldProps = {
  label: React.ReactNode;          // required
  hint?: React.ReactNode;          // rendered under the label, wired to aria-describedby
  containerClassName?: string;     // the wrapping <div class="flex w-full flex-col gap-1.5">
};

type TextFieldProps   = React.InputHTMLAttributes<HTMLInputElement> & SharedFieldProps;
type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & SharedFieldProps;
type RangeFieldProps  = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & SharedFieldProps;

const TextField:   ForwardRef<HTMLInputElement, TextFieldProps>;
const SelectField: ForwardRef<HTMLSelectElement, SelectFieldProps>;
const RangeField:  ForwardRef<HTMLInputElement, RangeFieldProps>;

const fieldControlClassName: string; // the bare control classes, for a textarea or a custom control
```

- Layout is label, then hint, then control, stacked with `gap-1.5`.
- `id` is optional. Without one a `useId` value is generated and wired to
  `htmlFor` and to `${id}-hint`. Pass `id` when something else must reference it.
- All native props spread onto the control: `value`, `onChange`, `min`, `max`,
  `step`, `required`, `disabled`, `placeholder`, `inputMode`, `autoComplete`.
- Inputs and selects: `h-12 w-full rounded-field border border-border-strong bg-card px-4 text-base`,
  focus turns the border orange and adds a 3px orange/18 halo.
- `SelectField` renders its own chevron (`appearance-none` plus a token-driven
  SVG background that recolors in dark mode). Pass `<option>`s as children.
- `RangeField` is `w-full accent-primary`. Render the numeric readout yourself
  next to the label or in `hint`.
- There is no `error` prop yet. For an invalid field pass
  `aria-invalid` and render a `<Notice tone="error">` next to it.

```tsx
<TextField label="Ship to postal code" value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="97205" inputMode="numeric" />

<SelectField label="Compatible published output" value={outputId} onChange={(e) => chooseOutput(e.target.value)} hint="Published outputs only.">
  {compatible.map((output) => (
    <option key={output.id} value={output.id}>{output.name}</option>
  ))}
</SelectField>

<RangeField label="Zoom" min={0} max={100} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} hint={`${zoom} percent`} />
```

## 5. Surface

`src/components/ui/surface.tsx`. The 18px card.

```ts
type SurfaceTag  = "div" | "section" | "article" | "button" | "li";
type SurfaceTone = "card" | "warm";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: SurfaceTag;        // default "div"
  tone?: SurfaceTone;     // default "card"
  selected?: boolean;     // default false
  interactive?: boolean;  // default false
  disabled?: boolean;     // only meaningful with as="button"
  type?: "button" | "submit" | "reset"; // only with as="button", defaults to "button"
};

const Surface: ForwardRef<HTMLElement, SurfaceProps>;
```

- Base: `relative rounded-[18px] border border-border p-5 text-left` plus
  `bg-card` or `bg-surface-warm`.
- `selected` swaps to `border-2 border-primary` and renders an orange check
  badge at `absolute right-3 top-3` (`size-6 rounded-full bg-primary`). The badge
  is `aria-hidden`; convey selection to assistive tech with `aria-pressed` or
  `aria-selected` on the element.
- `interactive` adds `cursor-pointer`, a 200ms transition and `hover:shadow-warm`.
- `as="button"` adds `block w-full` and disabled styling. Selectable cards
  should be `as="button" interactive selected={...} aria-pressed={...}`.
- `ref` is typed `HTMLElement`; cast at the call site if you need `HTMLButtonElement`.

```tsx
<Surface as="button" interactive selected={isChosen} aria-pressed={isChosen} onClick={() => choose(product.id)}>
  <h3 className="text-lg font-semibold">{product.name}</h3>
  <p className="mt-1 font-mono text-[13px] text-muted-foreground">{product.id}</p>
</Surface>

<Surface as="section" tone="warm" className="p-6">…sandbox card…</Surface>
```

## 6. Chip

`src/components/ui/chip.tsx`. Pill label, `h-7 px-3 text-[13px] font-medium`.

```ts
type ChipTone = "neutral" | "warning" | "success" | "error" | "info";
type ChipProps = React.HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }; // default "neutral"
const Chip: ForwardRef<HTMLSpanElement, ChipProps>;
```

- `neutral` `bg-surface-warm text-foreground`; `warning`, `success`, `error` use
  their status surface plus status text; `info` is a bare `border border-border
  text-muted-foreground` outline.
- Renders a `<span>`, so it nests in a heading or a row of text. It is not a
  button; wrap it or use `Surface as="button"` for a selectable chip.

```tsx
<Chip tone="warning">Test mode</Chip>
<Chip tone="info">{cartCount} in cart</Chip>
```

## 7. Notice

`src/components/ui/notice.tsx`. Status callout with a 3px left accent.

```ts
type NoticeTone = "info" | "success" | "warning" | "error";
type NoticeProps = React.HTMLAttributes<HTMLDivElement> & { tone?: NoticeTone }; // default "info"
const Notice: ForwardRef<HTMLDivElement, NoticeProps>;
```

- `rounded-[14px] border-l-[3px] px-4 py-3 text-[15px] leading-relaxed text-foreground`
  over the tone surface. Body text stays `text-foreground` for AA in both modes.
- `role` defaults to `"status"`, or `"alert"` when `tone="error"`. Override with
  the `role` prop when the message is static chrome rather than a live update.

```tsx
<Notice tone="error">Production checkout is disabled.</Notice>
<Notice tone="warning" role="note">This storefront places sandbox orders only.</Notice>
```

## 8. PrintFrame

`src/components/ui/print-frame.tsx`. The physical print treatment.

```ts
type PrintFrameProps = React.HTMLAttributes<HTMLDivElement> & {
  aspect?: string | number;  // CSS aspect-ratio for the inner window, e.g. "5 / 7" or 1.4
  innerClassName?: string;
  rotate?: boolean;          // hover tilt, tray thumbnails only
};
const PrintFrame: ForwardRef<HTMLDivElement, PrintFrameProps>;
```

- Outer: `rounded-[14px] bg-photo-border p-1.5 shadow-warm`. Inner:
  `overflow-hidden rounded-[10px]` with the optional aspect ratio.
- Size it from the outside with `className` (`w-40`, `max-w-md`, a grid cell).
- `rotate` adds `hover:-rotate-1` with `motion-reduce` disabling it.
- No text over the image. Put the ordinal, filename and crop caption below the
  frame.

```tsx
<PrintFrame aspect="5 / 7" className="w-full" rotate>
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img alt="" src={photo.previewUrl} className="size-full object-cover" />
</PrintFrame>
<p className="mt-2 text-sm text-muted-foreground">{index + 1}. {photo.name}</p>
```

## 9. Theme

`src/lib/theme/theme-preference.ts` (pure, no React) and
`src/components/theme/*`.

```ts
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

function useThemePreference(): {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

function ThemePreferenceMenu(props: { className?: string }): JSX.Element;
```

- The preference is stored in `localStorage` and in a
  `batchrelay-theme-preference` cookie, with `Domain=.batchrelay.com` when the
  host is under that domain, so a deploy on a Batch Relay subdomain inherits the
  app's setting.
- A bootstrap script in `<head>` sets `.dark`, `color-scheme` and
  `data-theme-preference` on `<html>` before paint. `<html>` carries
  `suppressHydrationWarning` for that reason.
- `ThemePreferenceMenu` is a 36px round `border-border bg-card` trigger with an
  18px menu on `shadow-warm-lg`. Arrow keys move between System, Light and Dark,
  Escape closes and returns focus, and it opens on hover on fine pointers.
  Selected row is `bg-primary/15 text-primary`.
- Use `resolvedTheme` only when JS must branch, for example a canvas fill. For
  styling, use tokens and let the class do the work.

## 10. cn

`src/lib/cn.ts`. `cn(...values: (string | false | null | undefined)[]): string`.
Filters falsy and joins with a space. No conflict resolution, so order does not
save you from writing two competing utilities.

## 11. Transitional legacy stylesheet

`src/app/legacy-storefront.css` holds the pre-redesign rules
(`.workbench-shell`, `.photo-tray`, `.format-chip`, `.product-ticket`, and the
rest) so the app keeps rendering mid-migration. It is imported at the end of
`globals.css` into a `legacy` cascade layer that sits above Tailwind's `base`
and below `utilities`, so:

- legacy element defaults (its `h1`, `h2` sizes) still apply to markup that has
  no utilities on it, and
- any Tailwind utility you write beats the legacy rule.

As you convert a component, delete the class names from the JSX. When the last
legacy class name is gone, delete the file and the `@import` in `globals.css`.
Do not add rules to it.
