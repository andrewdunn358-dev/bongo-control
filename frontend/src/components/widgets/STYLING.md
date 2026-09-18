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
