# VanOS — Contributor Contract

**Read this before writing any code in this repository.**

This is not a web app with a hardware theme. It drives **real 12V circuits in a
campervan**: relays on fused loads, a pop-top roof with two motors and **no position
sensor**, and a diesel heater that can foul its own exhaust if stopped at the wrong
moment. More than one AI agent contributes here.

A wrong constant in this repo does not fail a type check and does not look wrong in
review. It drives the wrong circuit, or removes the only thing that stops a motor.

**CI enforces the rules below.** If a check fails, do not work around it.

---

## 1. Frozen: never change without explicit instruction

`tools/check_hardware_contract.py` fails the build if any of these move.

| Frozen | Value |
|---|---|
| GPIO map | 1→17 TV, 2→27 Lights, 3→22 Amp, 4→23 Spare, 5→12 / 6→13 roof isolate, 7→16 roof up, 8→26 roof down |
| Relay polarity | `active_high = True` (**HIGH-trigger** — any doc saying `false` is stale) |
| Boot guard | `gpio=17,27,22,23,16,26,12,13=op,dl` (`dl` = drive LOW = relays off) |
| Roof watchdog | `WATCHDOG_SECONDS = 1.5` |
| Roof ceiling | `MAX_RUN_SECONDS = 30.0` |
| Roof interlock | Roof channels excluded from `/api/relays` set/toggle |
| Heater guards | No stop during ignition, no start during cooldown, ventilate only from standby |

**GPIO 25 / physical pin 22 is DEAD on this board.** Do not reuse it.

If the physical van genuinely changes, update `EXPECTED` in
`tools/check_hardware_contract.py` in the **same commit**, and say why.

---

## 2. Honesty rules

**The UI must never imply a state the hardware cannot verify.**
`tools/check_frontend_contract.py` enforces these.

| Thing | Truth | Therefore |
|---|---|---|
| **Relay state** | Relays are wired **in parallel with physical wall switches**. No sense line. | State is *commanded*, never measured. Never show a verified on/off indicator without saying so. |
| **Roof position** | **No position sensor exists.** API emits `position_is_unknown: true`. | Never show Open/Closed as a *state*. OPEN/CLOSE as button labels is fine. |
| **Heater fuel** | Estimated from run-time. **No tank sender.** | Always label "estimated". |
| **Battery SoC** | **Genuinely measured** by the SmartShunt (coulomb counting). | This one you may show plainly. |
| **Network** | Pi is on **Ethernet** to the van router. | Label "Ethernet". Never "WiFi" or signal strength. |
| **Mobile signal** | **Nothing reads the 4G modem.** | Never display mobile signal. |

---

## 3. Two traps that have already caused real bugs

### Never test `current_a` alone

`BATTERY` has **two publishers** — the Victron MPPT and the SmartShunt — merged by
precedence. When the MPPT's message is most recent it carries voltage but **no
current**, so testing that one field reports "no shunt" on a van that has had one
fitted for months, flickering as the publishers interleave.

```ts
import { hasShunt } from '@/lib/telemetry';
if (hasShunt(battery.payload)) { ... }
```

Displaying the *value* conditionally is fine. Concluding something about the
*hardware* from its absence is not.

### Never use the `CONNECTIVITY` domain

Nothing in the backend publishes it except `plugins/simulation/engine.py`. Any widget
built on it reads "offline" permanently on the real van. Use `useConnected()`.

---

## 4. Architecture you need to know

- **Same-origin API.** `API_BASE = '/api'`. Never introduce `VITE_API_URL` — the app
  must work identically on the LAN and through the Cloudflare Tunnel with no rebuild.
- **The heater's Bluetooth runs on the Pi HOST**, as systemd (`vanos-heater-agent`),
  not in Docker — a container BLE scan collides with the Victron scan. The container
  reaches it over HTTP on `127.0.0.1:8091`.
- **`config.json` lives in a Docker volume**, not on disk, and **shadows the code
  defaults**. New keys in an existing section only reach fresh installs.
- **The Pi is a 2B with 920MB RAM.** CPU starvation has broken voice control before.
  No persistent video streams, no polling loops on the home screen.

---

## 5. Cockpit themes

Adding a theme is **one registry entry + one component + one stylesheet**. Nothing else.

```
lib/cockpitThemes.ts          ← add your entry here
components/cockpits/          ← your component + CSS here
```

- Keep `lazy()` loading. Never import a theme statically.
- **Prefix every class and custom property** (`vm-`, `van-`, `vi-`…). All themes' CSS
  ships in the bundle even though one mounts, so an unprefixed `.card` restyles the
  others. CI checks this.
- Never add theme styles to `index.css`.
- **Mobile is not themed** — below 900px Home always renders `MobileHome`.
- A theme may change layout, styling and emphasis. It may **not** change the data.

---

## 6. Tablet viewport

The cockpit runs on a mounted tablet and **must fit one screen with no page scroll**.

Measured on the real device (Honor Pad X9, landscape):

| Context | CSS viewport |
|---|---|
| Chrome tab | 1143 × 532 |
| Installed PWA / Fully Kiosk | **1143 × 628** ← the real target |

**The lesson that cost the most time: cap the CONTAINER, not its children.** Several
build cycles were lost shrinking a camera's `min-height` when the row height was set
by the taller column beside it. Also: `min-height: 0` is load-bearing on flex and grid
children — they default to `min-content`, which lets a tall child push the container
past its own height.

**Verify, don't estimate.** **Settings → Viewport** shows live dimensions and which
tier is matching. Estimating card heights was wrong repeatedly; measuring settled it
in one pass.

---

## 7. Before you commit

```bash
python3 tools/check_hardware_contract.py
python3 tools/check_frontend_contract.py
cd frontend && npx tsc -b && npm run build && VITE_DEMO=true npm run build
```

CI runs all of these plus the backend safety suites. Never commit secrets, `.env`,
`config.json`, or any `.enc`/`.tar.gz` — use **Settings → Backup** in the app to move
config between SD cards.

---

## 8. Deploy tiers (for the human, not the agent)

| Change | Command | Time |
|---|---|---|
| `backend/tools/` | `git pull && sudo systemctl restart vanos-heater-agent` | seconds |
| `backend/app/` only | `docker compose --profile cloudflare-tunnel up -d --build backend` | ~30s |
| Frontend or any dependency | `docker compose --profile cloudflare-tunnel up -d --build --remove-orphans` | 5–25 min |

---

## 9. Custom theme files (data, not code)

A theme can also be a **JSON file** uploaded in Settings → Cockpit theme. No rebuild,
no deploy — it applies immediately. See `docs/themes/example-highland.json`.

```json
{ "name": "Highland", "author": "optional",
  "tokens": { "ink": "244 249 255", "surface": "7 21 34" } }
```

- Colour values are `"R G B"` (0–255), the form Tailwind's `<alpha-value>` needs.
- `aurora-base` may be a `linear-gradient(...)`, `radial-gradient(...)` or hex colour.
- Settable tokens: `ink`, `ink-soft`, `ink-muted`, `ink-faint`, `surface`,
  `surface-raised`, `surface-sunken`, `line`, `aurora-teal`, `aurora-blue`,
  `aurora-purple`, `aurora-pink`, `aurora-lime`, `aurora-base`.
- **`status-green/amber/red` and `brand-orange` are deliberately NOT settable.** They
  mean charging, attention, fault and active-nav. A theme must not make a fault harder
  to spot.
- Unknown tokens are ignored; invalid values are rejected with a readable message.
- A custom theme supplies **colours only** — it uses the default cockpit layout. A data
  file cannot supply a component.

Every value is validated before it reaches the DOM, and applied via
`style.setProperty()` — never by injecting CSS. A theme file cannot break the app.

---

## 10. Auto-fit — do not write viewport tiers

The cockpit **measures itself**. `useAutoFit` compares the real rendered height
against the space available and, if it overflows, lowers a `--fit` variable
(1 → 0.78) that the cockpit CSS multiplies its spacing by.

**So do not add `@media (max-height: ...)` tiers to a cockpit or theme.** Every
viewport failure on this project came from estimating how tall cards render and
getting it wrong — a tier sized for a height the device never reported, a
`min-height` on the element that wasn't setting the row height, card heights guessed
optimistically twice over. The browser already knows. Ask it.

### What this means when you build a cockpit or theme

- **Express spacing so it can scale.** Use `calc(<value> * var(--fit))` for gaps,
  padding and decorative heights. A hardcoded `padding: 20px` cannot be fitted.
- **Never scale touch targets or body text.** A control that is harder to hit, or a
  label harder to read, is the wrong thing to trade away in a moving vehicle.
  Whitespace is the cheap thing to give up.
- **Never use `transform: scale()`** to make something fit. It blurs text at
  non-integer scales — bad on a screen read at a glance while driving — and breaks
  `position: fixed` descendants.
- **It cannot rescue a layout that is fundamentally too tall.** Auto-fit stops at
  0.78 and lets the page scroll rather than becoming unreadable. If your cockpit
  needs 900px of content at a 613px viewport, the layout needs redesigning — no
  amount of scaling fixes that.

### Verify against the real device

Measured, in kiosk mode on the target tablet:

| Context | CSS viewport |
|---|---|
| Chrome tab | 1143 × 532 |
| Installed PWA | 1143 × 628 |
| **Fully Kiosk fullscreen** | **1143 × 685** ← the real target |

**Settings → Viewport** shows live dimensions in whichever mode the app is running.
Use it. Estimating card heights was wrong every single time it was tried.

### Themes and colour

A theme sets tokens, not layout. If a cockpit is built with hardcoded hex — as both
cockpits originally were — **no theme can change it**. Colours must come from the
tokens (`--ink*`, `--surface*`, `--line`, `--aurora-*`) or from a private palette
that itself resolves to them, e.g. `--vm-panel: rgb(var(--surface))`.

Status colours (`--status-green/amber/red`) and `--brand-orange` are **not**
themeable, by design. A fault must stay readable whatever theme is loaded.
