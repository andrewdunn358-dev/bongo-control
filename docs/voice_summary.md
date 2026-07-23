# Voice Summary — "How's the van?"

Ask your phone how the van is doing and have it read back battery,
solar and temperature in one sentence.

Deliberately **not** a Google Home / Alexa integration. Those require
registering a Smart Home Action, implementing OAuth, and mapping van
telemetry onto a device model built for thermostats and light bulbs —
days of work plus a certification process, to say a sentence out loud.
A phone shortcut takes five minutes and gives the same result where it
matters.

---

## The endpoints

```
GET /api/voice/summary.txt     plain text, ready to speak
GET /api/voice/summary         JSON: the same sentence plus raw numbers
```

Both accept `?token=` for auth (see below).

Example response from `summary.txt`:

> Battery is at 13.7 volts and charging, solar is making about 120
> watts and it's 25 degrees inside and 20 outside.

Written for the ear, not the eye: no abbreviations, no units that
sound wrong spoken, rounded hard. "About 120 watts" is useful aloud;
"118.4 watts" is noise.

If a reading is missing it's **left out of the sentence entirely**
rather than spoken as zero. Battery is reported as voltage because
this van has no shunt — speaking a percentage would be inventing a
number, and it'd be even more convincing spoken than on screen.

---

## Auth

If `APP_ACCESS_PASSWORD` is set, append your token:

```
https://bongo.3bty.co.uk/api/voice/summary.txt?token=YOUR_TOKEN
```

Get a token once:

```bash
curl -X POST https://bongo.3bty.co.uk/api/auth/unlock \
  -H 'Content-Type: application/json' \
  -d '{"password":"YOUR_PASSWORD"}'
```

Tokens don't expire and survive a backend restart, so this is a
one-time step. The query parameter is used rather than a header
because phone shortcuts can only build a URL.

**This URL is a credential.** Anyone with it can read your van's
telemetry. It's read-only — no relay control, no camera — but treat it
like a password.

---

## iOS Shortcuts

1. Shortcuts app → **+** → **Add Action**
2. **Get Contents of URL** → paste the URL with your token
3. **Add Action** → **Speak Text** → set input to the previous action's
   result
4. Name it something you'd actually say — "How's the van"
5. Done. Say *"Hey Siri, how's the van"*

`summary.txt` returns bare text, so nothing needs parsing between
those two steps.

## Android

Google Assistant can't call arbitrary URLs directly, so you need one
app in between. Any of these work:

- **Tasker** — HTTP Request action → Say action, triggered by an
  Assistant voice command
- **Automate** — same shape, free
- **HTTP Shortcuts** — simplest if you don't mind tapping an icon
  rather than speaking

---

## Widget / card

The JSON variant returns the sentence *and* the underlying numbers:

```json
{
  "speech": "Battery is at 13.7 volts and charging, ...",
  "battery_voltage": 13.74,
  "battery_soc_pct": null,
  "charging": true,
  "solar_watts": 118.4,
  "internal_temp_c": 24.8,
  "external_temp_c": 19.6
}
```

Useful if you want a home-screen widget showing figures rather than
reading a sentence aloud. Note `battery_soc_pct` is `null` and will
stay that way until a shunt is fitted — if you build a widget, show
voltage.

---

## If a shunt gets fitted later

The sentence improves on its own. The service already prefers
`soc_pct` when it's present and falls back to voltage when it isn't,
so it would start saying *"Battery is at 78 percent and charging"*
with no code change.
