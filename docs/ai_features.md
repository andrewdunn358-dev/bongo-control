# AI Features

Optional. The app works completely normally without any of this
configured — these are add-ons layered on top of the core dashboard,
not a dependency of it.

## What exists today: "What's cool nearby?"

A button on the Nearby page. Tap it, and Claude (Anthropic's AI) is
asked to suggest genuinely worthwhile things to see or do near your
current location — castles, viewpoints, walks, good local food — the
kind of specific, real recommendation a knowledgeable local friend
would give, not generic tourist-board copy.

**Deliberately one-shot, not a chat.** A single request/response per
tap. No back-and-forth conversation (yet — see "Possible future work"
below), no automatic or scheduled calls. This keeps things simple and
keeps cost predictable: unlike telemetry, there's no reason to poll an
LLM in the background, and every call costs real money.

### How it reduces the "AI makes things up" risk

LLMs can state incorrect details, or in rare cases describe a place
that doesn't quite exist as claimed, with total confidence — a known
limitation of the technology, not a bug in this integration. Two
things reduce (not eliminate) that risk here:

- The prompt is grounded with real, already-known places from this
  app's own OpenStreetMap POI cache, not just bare coordinates
- The location is reverse-geocoded (via OpenStreetMap's Nominatim) to
  a real place name, giving the model more specific context than raw
  latitude/longitude

The app also labels this content as AI-generated in the UI and
suggests double-checking details before relying on them — the same
"don't overstate precision" principle applied elsewhere in this app
(e.g. the voltage-only battery estimate when no shunt is installed).

## Setup

```bash
# In your .env file:
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com).
That's the only required step — no other configuration needed.
Leave it unset and the feature just shows "not configured" in the UI;
nothing else in the app is affected.

Optional: override the model (defaults to Haiku, see cost rationale
below):
```bash
AI_RECOMMENDATIONS_MODEL=claude-haiku-4-5-20251001
```

## Cost

Uses **Claude Haiku 4.5** by default — Anthropic's fastest, cheapest
current model, and the right fit for a short, well-defined
recommendation task like this (no need to pay for deeper reasoning a
simple "suggest 5 things nearby" doesn't require).

As of writing, Haiku 4.5 pricing is **$1 per million input tokens,
$5 per million output tokens**. A typical call here (location +
known-nearby context in, a handful of short recommendations out) is on
the order of **a few hundred tokens each way — a fraction of a cent
per call.** Pricing can change; check
[Anthropic's current pricing page](https://platform.claude.com/docs/en/about-claude/pricing)
for the up-to-date rate.

**Caching is the real cost control, not just a performance nicety.**
Results are cached per location (rounded to ~1km) for 7 days — "what's
interesting nearby" doesn't meaningfully change day to day, so this
costs nothing in usefulness. In practice: tapping the button repeatedly
at the same spot, or reopening the page, doesn't trigger repeat paid
calls. A genuinely new location does.

**Security note:** the recommendations endpoint requires the app's
password gate (see the main README's Auth section) if one is
configured — this feature costs real money per genuinely-new location,
and the app can be reachable from the public internet via a Cloudflare
Tunnel, so it's worth protecting the same way the camera is.

## Possible future work (not built)

- A genuine back-and-forth chat about a trip, grounded in trip
  history — this is real future scope, but a meaningfully bigger
  feature (needs an actual trip-history concept the app doesn't have
  yet, and ongoing conversational cost rather than one-shot).
- Folding this into the Daily SITREP / Intelligence Engine as another
  signal source.

## Architecture note

Every AI call happens **backend-only** — the frontend never talks to
Anthropic directly, and the API key never reaches the browser. This
matches how every other secret in this project is handled (Cloudflare
tunnel token, camera credentials): read from an environment variable,
never hardcoded, never sent to the client.
