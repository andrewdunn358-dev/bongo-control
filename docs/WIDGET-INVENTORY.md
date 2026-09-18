# Widget inventory — Phase 1 of composable pages

_18 Sep 2026. Produced from the code, not from memory: every row below
was read out of the three cockpit components and the telemetry hooks
they call._

## Why this exists

A theme can currently recolour VanOS but cannot compose it. Every new
arrangement has required a developer to write another cockpit component
— which is how `control` arrived. This inventory is the input to the
widget registry that replaces that.

## The case for the registry, in one table

The same concepts are implemented **three separate times**, against the
same telemetry hooks:

| concept | Instrument | Adventure | Control |
|---|---|---|---|
| Battery | yes | yes | yes |
| Solar | yes | yes | — |
| Weather | yes | yes | — |
| Camera | yes | yes | yes |
| GPS / satellites | yes | yes | yes |
| Roof | — | yes | yes |
| Switches / relays | — | yes | yes |
| Power flow | — | yes | — |
| Mission brief | yes | — | — |
| Temperatures | yes | yes | yes |
| Charging power | yes | yes | yes |

Hooks consumed: `useBattery`, `useSolar`, `useEnergy`, `useEnvironment`,
`useWeather`, `useConnected`. All three cockpits call the same ones.
Nothing needs inventing; it needs extracting once.

## Candidate widgets

Sizes are marked TO MEASURE rather than guessed — the fitting work has
already shown that estimated heights run optimistic.

| id | data | truth contract | priority |
|---|---|---|---|
| `battery` | BATTERY (two publishers) | SoC only when `hasShunt()`; never infer a shunt from `current_a` alone | critical |
| `solar` | SOLAR (Victron MPPT) | real telemetry | high |
| `power-flow` | SOLAR + BATTERY + ENERGY | total van draw is not measurable without a shunt, and must not be implied | high |
| `weather` | ENVIRONMENT / WEATHER | forecast is predicted, not measured | low |
| `camera` | camera endpoints | backend owns `/dev/video0`; never direct browser access | high |
| `roof` | roof service | **position is UNKNOWN** — no sensor. Hold-to-run, 1.5s watchdog, 30s ceiling, direction interlock are BEHAVIOUR and not theme-configurable | critical |
| `relay` / `switches` | relays API | state is **commanded, never measured** — wall switches are in parallel | critical |
| `gps` | LOCATION | satellite count and fix quality are readings; the sky graphic is decoration | medium |
| `temperature` | ENVIRONMENT (DS18B20) | real readings | medium |
| `charging-power` | BATTERY / SOLAR | from the MPPT; not total draw | medium |
| `mission-brief` | intelligence endpoint | derived summary, labelled as such | low |
| `clock` | local | — | low |

## Presentation states

Per ChatGPT's architecture: each widget exposes FULL / COMPACT / MINIMAL
rather than the layout author writing responsive CSS. Two rules the
fitting work established the hard way:

- **A state may drop decoration. It may never drop a reading.** The
  ladder rungs built for Adventure and Instrument shed sparklines,
  satellite-sky artwork, quotes and footer branding — never a number.
- **Touch targets do not scale.** They have a floor (64px on tiles,
  120px on the relay command button) and the composition reflows
  instead.

## Things to settle BEFORE the schema is written

1. **Absent data.** A widget whose domain is not present must show
   nothing rather than a fabricated value. `battery` with no shunt is
   the live example. This belongs in the widget contract, not in each
   layout.
2. **Unknown widget id.** A theme naming a widget this build does not
   have must skip it visibly, never crash. Needs a schema version.
3. **Behaviour is not layout.** The roof watchdog and heater
   ignition/cooldown guards live in widgets and must not become
   theme-configurable. Worth stating before page migration starts.
4. **The CI guard must move with the widgets.** It currently greps
   `screens/Roof.tsx` and `screens/Switches.tsx` for the honesty
   disclosures. The moment those become widgets, the guard passes
   against files that no longer drive the UI — it must be repointed in
   the SAME change, or the safety net lapses exactly when most is
   moving.

## Suggested order, differing from the plan in one place

Rebuild **Adventure first**, not last. It is the hardest — hero imagery,
overlays, absolutely-positioned copy — so if the schema cannot express
it, that should surface before Instrument and Control have shaped the
schema around easier cases.
