# MediNext Design Language

Supporting document to the architecture proposal. This defines the visual system before any
component is built, because retrofitting restraint into an interface is much harder than
starting with it.

## 1. Position

The product should feel like proprietary MediNext software: something built for this business,
by people who understand the work. Not a template, not a dashboard demo, not a colourful SaaS
starter.

The reference points are dense professional tools — Linear, Height, Stripe's dashboard — where
the interface recedes and the data is the interface.

**What that rules out:** gradient hero cards, coloured stat tiles competing for attention, drop
shadows as decoration, illustrations in empty states, rounded-everything, a different accent
colour per section, and charts on a screen whose job is data entry.

## 2. Colour

A near-monochrome interface with one brand accent and a small set of semantic colours that
appear only when they carry meaning.

```css
:root {
  /* Neutral ramp — the entire interface */
  --n-0:   #ffffff;
  --n-25:  #fcfcfd;
  --n-50:  #f8f9fa;
  --n-100: #f1f3f5;
  --n-200: #e6e8eb;   /* borders */
  --n-300: #d3d7dc;
  --n-400: #a6acb5;
  --n-500: #767e88;   /* muted text — AA on --n-0 */
  --n-600: #545c66;
  --n-700: #3a424c;
  --n-800: #242a32;
  --n-900: #14181d;   /* primary text */

  /* Brand accent — used sparingly: primary action, active nav, focus */
  --accent-600: #0f5c8c;
  --accent-700: #0c4a70;
  --accent-50:  #eef5fa;

  /* Semantic — meaning only, never decoration */
  --success: #1a7f52;
  --warning: #9a6400;
  --danger:  #b32219;
  --info:    #1e5fa8;
}
```

Rules:

- Accent appears on roughly one element per screen. If two things are competing for the accent,
  one of them is not the primary action.
- Semantic colour requires an accompanying word. Colour never carries meaning alone — that is
  an accessibility requirement and a legibility one.
- Status colours are decided once, in `config/statuses.ts`, and rendered only through
  `StatusBadge`.
- Surfaces are separated by **borders**, not shadows. Shadow is reserved for genuinely floating
  layers: dropdown, popover, dialog, toast.

Dark theme mirrors the ramp rather than inverting it, with slightly desaturated accents and
borders raised in contrast so density does not become mush.

## 3. Typography

One family. Inter (or the system UI stack), with a monospace face for identifiers, ids,
checksums and audit diffs — anywhere character-level accuracy matters.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display` | 28 / 34 | 600 | page title, one per screen |
| `title` | 20 / 28 | 600 | section heading |
| `subtitle` | 16 / 24 | 500 | card heading |
| `body` | 14 / 20 | 400 | default |
| `body-strong` | 14 / 20 | 500 | emphasis, table headers |
| `small` | 13 / 18 | 400 | secondary |
| `caption` | 12 / 16 | 500 | labels, metadata, uppercase +0.04em |
| `mono` | 13 / 18 | 400 | references, ids |

14px body, not 16. This is a dense professional tool used all day on desktop; 16px body forces
scrolling in tables where scanning matters more than comfortable reading. Line length in prose
regions is capped around 72 characters.

**Tabular numerals** (`font-variant-numeric: tabular-nums`) on every number in a table or
metric. Without it, columns of figures visibly jitter, and it is the single cheapest thing that
makes an interface look professionally made.

## 4. Space

4px base. Only these values: `4, 8, 12, 16, 24, 32, 48, 64`. An arbitrary `18px` anywhere is a
bug.

| Context | Value |
|---|---|
| Icon to label | 8 |
| Within a form field group | 8 |
| Between form fields | 16 |
| Card padding | 20 (comfortable) / 16 (compact) |
| Between sections | 32 |
| Page padding | 24 mobile, 32 desktop |
| Table row height | 44 comfortable / 36 compact |

Density is a user setting, persisted, because managers and recruiters genuinely want different
things from the same table.

## 5. Borders, radius, elevation

- Radius: `4px` inputs and buttons, `6px` cards and dialogs, `9999px` badges only. Nothing
  larger — heavy rounding reads consumer.
- Borders: `1px solid var(--n-200)` light, one step lighter than the surface in dark.
- Elevation: four levels only — flat (borders), dropdown, dialog, toast. Shadows are soft, low
  opacity, short offset.

## 6. Motion

Fast, small, and never blocking.

| Interaction | Duration | Easing |
|---|---|---|
| Hover / focus | 120ms | ease-out |
| Dropdown, popover | 150ms | cubic-bezier(.16,1,.3,1) |
| Dialog | 180ms | same |
| Toast | 200ms | same |
| Page transition | none | — |

Nothing animates position by more than 8px. No spinners under 400ms — show the previous state
instead of flashing a loader. Skeletons only where layout is known in advance. Full compliance
with `prefers-reduced-motion`, which disables transforms and keeps opacity fades.

## 7. Components — the ones that set the tone

**Tables.** The core of the product. Sticky header, no zebra striping (borders are enough and
striping fights with row selection), hover row tint from `--n-50`, left-aligned text,
right-aligned numbers, monospace for references, sortable headers with a clear indicator,
column visibility, resizable where useful.

**Status badges.** Small, `caption` weight, subtle tinted background with a matching text
colour — never solid saturated fills. Always a word.

**Forms.** Labels above inputs, always visible; placeholders never substitute for labels.
Errors below the field in `--danger` with an icon. Required marked, not optional. Inline
validation on blur, never on keystroke.

**Empty states.** One line saying what belongs here, one line saying what to do, one action if
there is one. No illustrations.

**Buttons.** Primary (accent, one per view), secondary (bordered), ghost (toolbar), destructive
(danger, always with confirmation). Sizes 32/36/40px.

## 8. Layout

Breakpoints `640 / 768 / 1024 / 1280 / 1536`. Content max-width `1440px`; tables may go full
width.

The internal CRM is desktop-first and honest about it — it is a professional tool used at a
desk. It must remain *usable* on a tablet, but it is not designed for phones. The candidate
portal is the opposite: mobile-first, because candidates will check it on a phone between
things.

## 9. Accessibility as a build requirement

WCAG 2.1 AA, checked during development, not audited afterwards.

Focus rings are a 2px accent outline with a 2px offset, visible on every interactive element,
and they survive the design pass — removing a focus ring because it looks untidy is not a
trade that is available. Contrast 4.5:1 for all text including `--n-500` muted text and every
badge. Full keyboard operability, logical tab order, `aria-live` for async results, accessible
names on every icon-only control, and never colour alone as a carrier of meaning.
