# Shared design: EOSTracker & Roadmapper

One look and feel for our internal prototypes. **This spec is cosmetic only**: colors, type, spacing, shapes and component styling. Each app keeps its own interaction patterns (drag and drop, pickers, views, keyboard behavior).

The source of truth is **EOSTracker** (`gabrielvdk/eos-proto`, `index.html`). Roadmapper (`gabrielvdk/roadmap-proto`) follows it. Each repo keeps its own copy of this file. Never load styles from the other repo at runtime, so the two sites can't break each other.

When you change a token or recipe, update this file in **both** repos.

---

## 1. Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| Body, controls, tables, labels | **Figtree** | 400 / 500 / 600 / 700 | 14px base, line-height 1.45 |
| Titles (corporate identity) | **Titillium Web** | 600 / 700 | see below |

**Titillium Web is for titles only:**
- app name in the top bar (17-18px, 700)
- view or page heading (`h1`, 22px, 700)
- modal title (20-22px, 700)

Column, group, table and section headers stay in Figtree (700) so dense views stay compact.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Titillium+Web:wght@600;700&display=swap" rel="stylesheet">
```

```css
--font-body:  Figtree, "Segoe UI", system-ui, -apple-system, sans-serif;
--font-title: "Titillium Web", Figtree, "Segoe UI", system-ui, sans-serif;
```

**Type scale**

| Size | Use |
|---|---|
| 22px / 700 | view heading |
| 17px / 700 | modal header (EOS), app name |
| 14px | body, buttons, inputs |
| 13.5px | menu items, card titles, history text |
| 13px | table headers (700), small buttons, secondary cells |
| 12.5px | field labels (600), pills, toasts/tooltips |
| 12px | group-row headers (700, uppercase, letter-spacing .02em), legends |
| 11.5px | meta: timestamps, counts, "via …" |
| 11px | dropdown group captions (700, uppercase, .04em) |

Never go below 11px.

---

## 2. Color tokens

Define these on `:root` and use them everywhere. Never hard-code colors in components; `#fff` is only for text on solid accent or status fills.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#F3F5F9` | `#141922` | page background, hover fill, segmented-tab track |
| `--surface` | `#FFFFFF` | `#1C232E` | cards, panels, modals, inputs |
| `--line` | `#E3E7EE` | `#2A3340` | dividers, card borders |
| `--line-strong` | `#C9D0DB` | `#3A4556` | input and button borders |
| `--ink` | `#1C2430` | `#EDF1F7` | primary text |
| `--ink-2` | `#5B6778` | `#AEB8C8` | secondary text, labels |
| `--ink-3` | `#8A95A6` | `#7D8898` | meta, placeholders, icons |
| `--accent` | `#2F6FE4` | `#6B9BFF` | primary buttons, selection, focus, links |
| `--accent-soft` | `#E6EEFC` | `#213353` | selected or hover tint, focus ring |
| `--green` | `#19A974` | same | on track, done-ish |
| `--green-deep` | `#0E7A5A` | same | done |
| `--green-soft` | `#DDF5EA` | `#17382C` | green tint |
| `--amber` | `#E29A1C` | same | at risk, due soon |
| `--amber-soft` | `#FCF0D8` | `#3E3119` | amber tint |
| `--red` | `#D93B4F` | same | off track, late, overdue, destructive |
| `--red-deep` | `#A51E35` | same | escalated |
| `--red-soft` | `#FBE4E7` | `#3F1F26` | red tint |
| `--grey-pill` | `#C7CDD7` | `#3A4556` | not set, empty progress |
| `--grey-fill` | `#8A95A6` | `#7D8898` | neutral markers |

**Dark mode** follows the OS, with an explicit override:

```css
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){ /* dark values */ } }
:root[data-theme="dark"]{ /* dark values */ }
```

**Tints and text on tints.** Mix tints from the base color with the surface, so they work in both themes:
- tint background: `color-mix(in srgb, <color> 14%, var(--surface))`
- text on a tint: `color-mix(in srgb, <color> 70%, var(--ink))`

### 2.1 Status colors (shared meaning)

The same color means the same thing in both apps.

| Meaning | EOSTracker status | Roadmapper health | Solid | Tint / text |
|---|---|---|---|---|
| Not set | Not Set | — | `--grey-pill`, text `--ink-2` | — |
| Good | On-Track | On track | `--green` | `--green-soft` / green→ink |
| Warning | — | At risk | `--amber` | `--amber-soft` / amber→ink |
| Bad | Off-Track | Late | `--red` | `--red-soft` / red→ink |
| Escalated | OT - Escalate | — | `--red-deep` | — |
| Finished | Done | Done | `--green-deep` (+ ✓ icon) | green-deep tint |
| Stopped | Cancelled | (future: Closed/Stopped) | grey hatch, strike-through | — |

- **Solid fill with white text** is for an interactive status control (EOS status button).
- **Soft pill** (tint background, darker text) is for read-only display (Roadmapper badges, lists).

### 2.2 Category colors (per app, may differ)

These carry identity, not status, so each app has its own set:
- **EOSTracker levels:** Company `#5B4BDB`, Department `#1F8FD1`, Team `#19A974`, Forum `#E2741C`.
- **Roadmapper stages** (from the product pipeline slide): Validation `#6A3D9A`, Prototyping `#3F9B5B`, Development `#1F58A3`, Productization `#E3A310`, Launch `#C8326E`, Learn `#159FA6`.

Show categories as a dot (8px circle), a 3px top border on a column, or a tint (`color-mix` 9-14% with `--surface`). Never use them as large solid fills.

---

## 3. Shape and depth

| Radius | Use |
|---|---|
| 4px | progress bars, timeline bars (3px) |
| 6px | inline inputs, small icon buttons, chips |
| 7px | status button, menu items |
| **9px** | **buttons, inputs, selects, segmented controls** |
| 10px | cards, dropdown menus, kanban cards |
| 12px | popovers, top-bar tab track |
| **14px** | **boards, tables, panels, kanban columns** |
| 16px | modals |
| 999px | pills, avatars, counters |

| Shadow | Value | Use |
|---|---|---|
| card | `0 1px 2px rgba(28,36,48,.07)` | resting card |
| card hover | `0 2px 8px rgba(28,36,48,.10)` | hovered card |
| tab | `0 1px 3px rgba(28,36,48,.12)` | selected top-bar tab |
| `--shadow` | `0 10px 30px rgba(28,36,48,.14)` (dark: `rgba(0,0,0,.5)`) | modals, menus, popovers, toasts |

Boards and tables use a **1px `--line` border, no shadow**.

**Focus:** `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`. Focused inputs get `border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft)`.

Respect `prefers-reduced-motion`.

---

## 4. Layout

- **Page:** `--canvas` background. Content area `max-width:1280px; margin:0 auto; padding:22px 24px 40px`. Wide views (timelines, review grids) use `max-width:none`.
- **Top bar:** `--surface`, `border-bottom:1px solid var(--line)`, `padding:14px 24px`, sticky, `gap:20px`. Order: brand (logo + app name in Titillium) → view tabs → spacer → global filter or primary action.
- **View header:** `h1` (Titillium 22px) plus a muted count, then view controls on the right; `margin-bottom:14px`.

---

## 5. Components

**View tabs (top bar).** A segmented track:
- track: `background:var(--canvas); padding:4px; border-radius:12px; gap:4px`
- tab: `padding:7px 14px; border-radius:9px; font-weight:600; color:var(--ink-2)`
- selected: `background:var(--surface); color:var(--ink)` plus the tab shadow

**Buttons.**

| Variant | Style |
|---|---|
| default | `border:1px solid var(--line-strong); background:var(--surface); padding:7px 12px; border-radius:9px; font-weight:600`; hover `--canvas` |
| primary | `--accent` background and border, white text; hover `filter:brightness(1.07)` |
| ghost | transparent, `--ink-2`; hover `--canvas` with `--ink` |
| small | `padding:4px 9px; font-size:13px` |
| danger | red text; danger-solid is a red fill |

Use at most one primary button per view or modal.

**Segmented control** (Group by, Quarters):
- wrapper: `border:1px solid var(--line-strong); border-radius:9px; overflow:hidden`
- options: `padding:6px 12px; font-weight:600; color:var(--ink-2)`
- pressed: `background:var(--accent-soft); color:var(--accent)`

**Select (toolbar):** `border:1px solid var(--line-strong); border-radius:9px; padding:6px 10px; font-weight:600`. When the filter is active: accent border, accent-soft background, accent text.

**Form field:**
- label: 12.5px, 600, `--ink-2`, gap 5px
- input, select, textarea: `border:1px solid var(--line-strong); border-radius:9px; padding:8px 10px; background:var(--surface)`, plus the focus ring from §3
- columns shrink with `minmax(0,1fr)`; set `width:100%; min-width:0` on controls
- below 640px, the grids stack to one column

**Pills:** `padding:3px 10px; border-radius:999px; font-size:12.5px; font-weight:600`, tint background with darker text. A team or neutral tag is `--canvas` background with a 1px `--line` border and `--ink-2` text.

**Avatar:** a 24px circle with initials, 11px, 700, white on a person color. 20-22px in dense rows.

**Tables and lists:**
- container: `--surface`, 1px `--line` border, radius 14px
- `thead th`: 13px, 700, `--ink`, no uppercase
- rows: 46px high (36px in dense trees) with a `--line` divider; hover fill is `color-mix(--canvas 60%, --surface)`
- group rows: `--canvas`, 12px, 700, uppercase, `--ink-2`, with the count in 500 `--ink-3`

**Kanban column and card:**
- column: `color-mix(in srgb,var(--line) 45%,var(--canvas))` (or a category tint), radius 14px, `padding:10px`, 3px top border in the category color
- column header: 13.5px, 700, plus a counter pill
- card: `--surface`, 1px `--line` border, radius 10px, `padding:9px 11px`, card shadow; on hover, `--line-strong` border and the card-hover shadow

**Modal:**
- backdrop: `rgba(14,18,26,.45)`, top-aligned (`padding:6vh 16px`)
- modal: `--surface`, radius 16px, 1px `--line` border, `--shadow`, `max-width:720px` (wide: 1040px)
- header: `padding:16px 20px`, bottom border, title in Titillium, close as a ghost button ✕
- **Two-column modal:**
  - main column 1.15fr, side column 1fr, separated by a 1px `--line`
  - each column starts with its own tab row (`.mtabs`) at the same height, directly under the header
  - main: Details (plus Milestones and so on); side: Updates · History
  - no background difference between the columns
- tab row: `padding:0 20px; border-bottom:1px solid var(--line)`; tabs `padding:10px 12px; font-weight:600; color:var(--ink-2)`; selected tab `--ink` with a 2px `--accent` bottom border; counts in 400 `--ink-3`
- body: `padding:18px 20px; gap:14px`
- footer: `padding:14px 20px`, top border, right-aligned Cancel and primary
- below 860px the two columns stack

**Updates and history (side pane):**
- composer: a single input ("What's the latest?") plus a default **Post** button
- entries: rows separated by `--line` dividers, not shadowed cards
- each entry: avatar, then author (600) and time (11.5px `--ink-3`), then text (13.5px)
- history entries show one entry per save, listing `Field  old → new` (old value muted with strike-through, new value 600)

**Menus, dropdowns, popovers:**
- container: `--surface`, 1px `--line-strong` border, radius 10-12px, `--shadow`, `padding:4px`
- items: `padding:7px 10px; border-radius:7px; font-size:13.5px`; hover `--canvas` (accent-soft in comboboxes)
- group captions: 11px uppercase

**Checkbox:** native, with `accent-color:var(--accent)` at 14px; or a 15px custom box with radius 3px.

**Toast and tooltip:** `--ink` background, `--surface` text, radius 8-9px, 12.5px, `--shadow`.

**Empty state:** centered, 40px padding, a bold `--ink` line plus a `--ink-2` explanation.

**Legend:** 12px `--ink-3`, 10px swatches with radius 3px, gap 14px.

---

## 6. Rules

- Use tokens only; check every new element in both light and dark mode.
- Never use `window.confirm()`, `alert()` or `prompt()` (they're blocked in Claude Code's browser pane). Use an in-app confirm dialog.
- Put `<meta name="robots" content="noindex, nofollow">` on every page (both sites are public on GitHub Pages).
- Keep it cosmetic. If aligning the look would change how something behaves, it doesn't belong in this spec; discuss it separately.
