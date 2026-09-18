# Widget styling coupling — known, temporary, and measured

_Phase 2. Read this before Phase 3/4._

The Phase 2 extraction moved the JSX and the data logic out of the
cockpits. It did **not** move the presentation. Every widget still
renders Adventure's `vm-*` classes, and those classes are defined in
`adventure.css`.

## Why that matters — demonstrated, not assumed

`adventure.css` is a lazy-loaded chunk. It arrives only when the
Adventure cockpit is selected. Measured in a real browser by creating a
`.vm-card` on each cockpit and reading its computed style:

| cockpit | adventure.css loaded | a `.vm-card` renders as |
|---|---|---|
| Adventure | yes | border 1px, gradient background |
| Instrument | **no** | **border 0, no background** |
| Control | **no** | **border 0, no background** |

So a widget placed in a Freeda layout today would be **completely
unstyled**. This is the "why doesn't the battery widget look right in
Control?" problem, caught before it could happen rather than after.

## The exact dependency

Two separate couplings, which need different fixes:

**1. Chunk coupling.** The base rules live in `adventure.css`, which
ships with the Adventure chunk.

| widget | classes it renders that adventure.css defines |
|---|---|
| battery | `vm-card` `vm-card-head` `vm-eyebrow` `vm-battery-main` `vm-battery-value` `vm-progress` `vm-data-box` |
| solar | `vm-card` `vm-card-head` `vm-eyebrow` `vm-solar-visual` `vm-sun` `vm-data-box` |
| power-flow | `vm-card` `vm-card-head` `vm-eyebrow` `vm-flow-visual` `vm-flow-line` `vm-flow-total` `vm-cyan` |
| weather | `vm-card` `vm-card-head` `vm-eyebrow` `vm-weather-main` `vm-weather-data` |
| shared | `vm-data-row` `vm-spark` |

`vm-battery-card`, `vm-solar-card`, `vm-flow-card` and `vm-weather-card`
are defined **nowhere** — they are hooks for the container queries and
carry no styling of their own.

**2. Scope coupling.** The `--fit` and ladder rules in `index.css` are
written as `.vm-page .vm-card`, so they need a `.vm-page` ANCESTOR.
A widget outside a `.vm-page` gets none of the sizing behaviour even if
the stylesheet is loaded.

## The path out, for Phase 3/4

Not done here, and deliberately not designed here either — but the shape
the evidence points at:

1. **Widget-owned base styling.** Each widget ships its own stylesheet
   with its own namespace, so it is styled wherever it is placed. This
   is what makes it a widget rather than an Adventure card.
2. **Theming through tokens, which already works.** Every one of those
   rules is already tokenised, so a widget with its own stylesheet still
   recolours per theme with no extra mechanism.
3. **Layout-supplied modifiers for the parts that are genuinely the
   layout's business** — a card's padding and gaps belong to the
   composition, not to the widget.
4. **Sizing scoped to the renderer, not to `.vm-page`.** The generic
   renderer supplies the container the `--fit` rules hang off, so any
   layout gets the ladder rather than only Adventure.

## The rule this enforces

> A widget must look right wherever it is placed. If it only looks right
> inside one cockpit, it is that cockpit's card, not a widget.

Phase 2 does not meet that rule and does not claim to. It is a
mechanical extraction with the coupling written down so it cannot be
forgotten.

---

# Phase 3 — resolved

The coupling above is gone. Widgets own their presentation and size from
whatever the renderer supplies.

## What changed

1. **`widgets.css`** — the widget rules, moved out of `adventure.css`
   and renamed to a `vw-` namespace so there is one owner.
2. **Loaded from the entry (`main.tsx`), not from the widgets.** Vite
   chunks CSS along the JS import graph, so importing it from the widget
   modules put it straight back into Adventure's lazy chunk. Measured,
   not assumed — the first attempt looked right and shipped the CSS to
   exactly the wrong place.
3. **The widget palette is owned here.** `--vw-panel`, `--vw-line`,
   `--vw-text` and the rest were `adventure.css`'s private `--vm-*`
   variables, so a widget outside Adventure still had no border and no
   background even once its stylesheet loaded. Same values, resolved
   from the same theme tokens.
4. **Sizing uses `var(--fit, 1)`** and no `.vm-page` ancestor. Whatever
   supplies `--fit` — Adventure today, the generic renderer next — gets
   the scaling; with no surface at all the widget renders at full size
   instead of collapsing.
5. **Container queries key off the card itself**, which declares
   `container-type: inline-size`, so a widget's internals respond to the
   width it was actually given in any layout.

## Proof

A `.vw-card` built outside any cockpit, with no `.vm-page` ancestor:

| cockpit loaded | border | background | text |
|---|---|---|---|
| Adventure | 1px rgba(119,202,255,.28) | gradient | rgb(244,249,255) |
| Instrument | 1px rgba(148,163,184,.28) | gradient | rgb(230,240,255) |
| Control | 1px rgba(148,163,184,.28) | gradient | rgb(230,240,255) |

Styled on all three, and the values differ per cockpit because they
resolve from theme tokens — which is the point.

Sizing, from a `--fit` supplied by an arbitrary parent:

| `--fit` | card padding | battery visual |
|---|---|---|
| 1 | 14px | 110px |
| 0.78 | 10.92px | 85.8px |
| 0.5 | 7px | 84px (floor holds) |

## Regression

**90 of 90 deterministic measures identical** to the pre-extraction
baseline, across three cockpits and five reference viewports.

One real error was caught doing this, and only by measuring: the
`110/100/112` visual heights came from **inside** `@container card
(max-width: 300px)` — narrow cards only. Folding them into the base
rules shrank the desktop visuals from 145px to 110px. The base/narrow
split is restored.
