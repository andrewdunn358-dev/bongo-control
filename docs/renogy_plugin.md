# Renogy MPPT Plugin (BT-1 / BT-2)

> ## ⚠️ Untested against real hardware
>
> Nobody on this project owns a Renogy controller. The protocol is
> implemented from a well-established open-source reference
> (`cyrils/renogy-bt`, MIT), and the frame construction and value
> parsing are verified byte-for-byte against it — but this code has
> **never spoken to a physical device**.
>
> Treat any reading as unverified until you've compared it against the
> Renogy app. **Please open an issue either way** — a "works fine"
> report is as useful as a bug report, and right now we have neither.

---

## What it should support

Renogy charge controllers with a **BT-1** (RS232) or **BT-2** (RS485)
Bluetooth module. Possibly also "SRNE-like" controllers sold as Rich
Solar, PowMr and similar, which use the same protocol.

Publishes to three telemetry domains:

| Domain | Fields |
|---|---|
| `battery` | `soc_pct`, `voltage`, `charging`, `charging_power_w` |
| `solar` | `watts`, `peak_today_watts`, `yield_today_wh`, `charge_state`, `pv_voltage`, `pv_current`, `load_current_a`, `load_power_w` |
| `energy` | `solar_watts`, `load_watts`, `net_watts` |

### Two differences from the Victron plugin worth knowing

**Renogy reports a battery percentage; Victron doesn't.** It's the
controller's own estimate from voltage, not a shunt-based coulomb
count, so it's less accurate than true state-of-charge — but it *is* a
genuine reading from the device rather than something invented here,
so it's passed through as `soc_pct`. If you have a shunt, trust that
instead.

**Load output is measured, not derived.** Renogy controllers have a
switched load terminal and report current and power directly. The
Victron plugin has to compute load power from current × voltage.

---

## Setup

### 1. Find your controller

Settings → Plugins → Renogy MPPT → **Scan for Devices**. Look for a
name starting `BT-TH`. Note its MAC address.

The Renogy app must not be connected at the same time — these modules
generally allow one connection at a time.

### 2. Configure

```bash
curl -X PUT http://localhost:8000/api/plugins/renogy_mppt/config \
  -H 'Content-Type: application/json' \
  -d '{"config": {"mac_address": "XX:XX:XX:XX:XX:XX"}}'
```

Optional settings:

| Key | Default | Notes |
|---|---|---|
| `mac_address` | — | Required |
| `device_id` | `255` | Modbus address. 255 is broadcast and works for a single BT-1. If you have a battery or several devices on one RS485 hub, this will need to be the controller's real address (often `1` or `16`). |
| `poll_interval_seconds` | `30` | |

### 3. Enable

```bash
curl -X POST http://localhost:8000/api/plugins/renogy_mppt/enable
docker compose restart backend
```

**Disable the Victron plugin if you're not running one** — both publish
to the same domains, and whichever writes last wins.

---

## No encryption key needed

Unlike Victron, which requires an encryption key from its app, Renogy's
BLE modules are **unencrypted**. Convenient here; mildly alarming in
general — anyone in Bluetooth range can read your controller.

---

## If it doesn't work

`docker compose logs backend --tail=40` first. Then, in order of
likelihood:

**"No response from controller within timeout"** — the most likely
failure. Usually one of:
- The Renogy phone app is connected. Close it fully.
- Wrong `device_id`. Try `1`, then `16`, then `48`.
- Out of Bluetooth range, or the Pi's adapter is busy with something
  else (this project's Victron plugin also uses BLE).

**"Controller returned a Modbus error"** — connected successfully but
rejected the read. Almost certainly a `device_id` mismatch.

**Values look wrong rather than absent** — voltages ten times too big
or small, nonsense temperatures. That would suggest a different
register layout on your model. Please open an issue with the model
number and what the Renogy app shows; the offsets are all in one
function (`parse_charging_info`) and easy to adjust.

---

## Why this doesn't use the `renogy-bt` library directly

`renogy-bt` isn't on PyPI and has no `setup.py` or `pyproject.toml`, so
it can't be pip-installed as a dependency — it's built to be cloned and
run as an application. Vendoring the whole thing to use one class would
be heavy and would leave a copy that silently drifts from upstream.

The underlying protocol is just Modbus RTU framed over a BLE
characteristic, and this project already depends on `bleak` for the
Victron plugin, so implementing it directly is lighter and clearer.

Credit to [cyrils/renogy-bt](https://github.com/cyrils/renogy-bt) for
documenting the protocol.
