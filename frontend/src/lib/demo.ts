/**
 * DEMO MODE — a complete in-browser simulation of the backend, so the
 * dashboard can run as a static site (e.g. on 20i shared hosting) with
 * no server at all. Enabled only when built with VITE_DEMO=true; the
 * real Pi build never includes this path.
 *
 * It fills the exact same two data channels the real app uses:
 *   1. the telemetry "WebSocket" (here: a timer emitting TelemetryMessages)
 *   2. the REST API (here: demoRequest returns canned/simulated payloads)
 *
 * Everything is clearly marked as simulated in the UI (the existing sim
 * banner fires because sources are 'simulation'), keeping the project's
 * "nothing fabricated" honesty even in a showcase.
 */
import type { TelemetryMessage } from '@/lib/types';

export const isDemo = import.meta.env.VITE_DEMO === 'true';

// A pleasant demo location — the Lake District.
const DEMO_LAT = 54.4609;
const DEMO_LON = -3.0886;

// Places — Trips & Memories Phase 2. A couple of seeded saved places so
// the showcase has something to look at, plus mutable state so the
// create/edit/delete flow actually works in the browser demo.
let nextPlaceId = 3;
const demoPlaces: { id: number; name: string; notes: string | null; latitude: number; longitude: number; arrived_at: number; departed_at: number | null; created_at: number }[] = [
  {
    id: 1,
    name: 'Ashness Bridge',
    notes: 'Parked up in the little layby — sunrise over the fells was worth the early start.',
    latitude: DEMO_LAT + 0.018,
    longitude: DEMO_LON + 0.02,
    arrived_at: Date.now() / 1000 - 3 * 86400,
    departed_at: Date.now() / 1000 - 3 * 86400 + 14 * 3600,
    created_at: Date.now() / 1000 - 3 * 86400,
  },
  {
    id: 2,
    name: 'Fellside Farm Shop',
    notes: 'Filled up on water and picked up local cheese. Opens 09:00.',
    latitude: DEMO_LAT - 0.01,
    longitude: DEMO_LON + 0.035,
    arrived_at: Date.now() / 1000 - 1 * 86400,
    departed_at: Date.now() / 1000 - 1 * 86400 + 3600,
    created_at: Date.now() / 1000 - 1 * 86400,
  },
];

// --- simulation state ---
const sim = {
  soc: 82, // internal %, drives voltage; never shown as a % in the UI
  yieldWh: 0,
  peakW: 0,
  lastDay: new Date().getDate(),
  loads: { fridge: true, lights: false, water_pump: false, heater: false } as Record<string, boolean>,
  tick: 0,
};

function daylight(hour: number): number {
  // 0 at night, smooth bell peaking ~13:00 over a 06:00–20:00 day.
  if (hour < 6 || hour > 20) return 0;
  return Math.max(0, Math.sin((Math.PI * (hour - 6)) / 14));
}

function cloudFactor(): number {
  // Slowly wandering cloudiness in [0.05, 0.5].
  return 0.28 + 0.22 * Math.sin(sim.tick / 90) * Math.cos(sim.tick / 47);
}

/** Advance the simulation ~1s and return the fresh per-domain messages. */
export function demoTelemetryTick(): TelemetryMessage[] {
  sim.tick += 1;
  const now = new Date();
  if (now.getDate() !== sim.lastDay) {
    sim.lastDay = now.getDate();
    sim.yieldWh = 0;
    sim.peakW = 0;
  }
  const hour = now.getHours() + now.getMinutes() / 60;
  const solarW = Math.round(320 * daylight(hour) * (1 - cloudFactor()) * 10) / 10;
  sim.peakW = Math.max(sim.peakW, solarW);
  sim.yieldWh += (solarW * 1) / 3600; // 1s tick

  // Loads cycle occasionally so the numbers move.
  if (sim.tick % 20 === 0) sim.loads.lights = hour > 19 || hour < 7;
  if (sim.tick % 33 === 0) sim.loads.water_pump = Math.random() < 0.25;
  if (sim.tick % 51 === 0) sim.loads.heater = now.getMonth() >= 9 && Math.random() < 0.3;
  const wattage: Record<string, number> = { fridge: 45, lights: 18, water_pump: 60, heater: 120 };
  const loadW = Math.round(Object.entries(sim.loads).reduce((s, [k, on]) => s + (on ? wattage[k] : 0), 0));

  const netW = solarW - loadW;
  sim.soc = Math.max(20, Math.min(100, sim.soc + (netW / (100 * 12.8)) * (100 / 3600)));
  const voltage = Math.round((12.0 + (sim.soc / 100) * 1.55 + (netW > 0 ? 0.15 : 0)) * 100) / 100;
  const charging = netW > 0 && solarW > 5;

  const t = now.getTime() / 1000;
  const msg = (domain: TelemetryMessage['domain'], payload: unknown): TelemetryMessage => ({
    domain,
    source: 'simulation',
    timestamp: t,
    payload,
  });

  const chargeState = solarW < 5 ? 'off' : sim.soc > 95 ? 'float' : sim.soc > 85 ? 'absorption' : 'bulk';
  const extTemp = 8 + 5 * daylight(hour) + Math.sin(sim.tick / 120);
  const intTemp = 18 + 3 * daylight(hour) + Math.sin(sim.tick / 200);

  return [
    msg('battery', { soc_pct: null, voltage, charging, charging_power_w: charging ? solarW : 0 }),
    msg('solar', {
      watts: solarW,
      peak_today_watts: Math.round(sim.peakW * 10) / 10,
      yield_today_wh: Math.round(sim.yieldWh),
      charge_state: chargeState,
    }),
    msg('energy', { solar_watts: solarW, load_watts: loadW, net_watts: netW, loads: { ...sim.loads } }),
    msg('environment', {
      internal_temp_c: Math.round(intTemp * 10) / 10,
      external_temp_c: Math.round(extTemp * 10) / 10,
      humidity_pct: null,
    }),
    msg('connectivity', { online: true, ssid: 'Starlink-Roam', ip: '192.168.1.45', signal_dbm: -54 }),
    msg('system', { cpu_pct: 12 + Math.round(6 * Math.random()), ram_pct: 38, temperature_c: 44, uptime_s: 3600 * 26, version: '0.2.0-demo' }),
  ];
}

// --- REST simulation ---
const day = (d: number, code: number, desc: string, hi: number, lo: number, mj: number): unknown => {
  const date = new Date();
  date.setDate(date.getDate() + d);
  return {
    date: date.toISOString().slice(0, 10),
    weather_code: code,
    weather_description: desc,
    temp_max_c: hi,
    temp_min_c: lo,
    shortwave_radiation_sum_mj: mj,
    precipitation_probability_max_pct: code >= 51 ? 60 : 10,
    sunrise: '05:12',
    sunset: '21:34',
  };
};

// Categories MUST match the backend's POI_TAGS keys (poi_service.py) —
// same names the real /api/poi/nearby returns. Using the frontend's old
// display names here is exactly what hid the category-mismatch bug.
const POIS = [
  { id: 1, category: 'campsite', name: 'Lone Pine Campground', latitude: DEMO_LAT + 0.01, longitude: DEMO_LON + 0.012, opening_hours: null, fee: '£18', address: 'Fell Rd', phone: null, website: null },
  { id: 2, category: 'water', name: 'Crystal Spring (potable)', latitude: DEMO_LAT - 0.008, longitude: DEMO_LON + 0.02, opening_hours: '24/7', fee: null, address: null, phone: null, website: null },
  { id: 3, category: 'fuel', name: 'Keswick Filling Station', latitude: DEMO_LAT + 0.02, longitude: DEMO_LON - 0.015, opening_hours: '06:00–22:00', fee: null, address: 'Main St', phone: null, website: null },
  { id: 4, category: 'dump_station', name: 'Derwent Dump Point', latitude: DEMO_LAT - 0.02, longitude: DEMO_LON - 0.01, opening_hours: null, fee: 'Free', address: null, phone: null, website: null },
  { id: 5, category: 'supermarket', name: 'Fell Foot Stores', latitude: DEMO_LAT + 0.006, longitude: DEMO_LON + 0.028, opening_hours: '08:00–20:00', fee: null, address: 'Lake Rd', phone: null, website: null },
  { id: 6, category: 'caravan_site', name: 'Starlight Haven Aire', latitude: DEMO_LAT - 0.03, longitude: DEMO_LON + 0.008, opening_hours: null, fee: '£12', address: null, phone: null, website: null },
];

const plugins = [
  { name: 'victron_mppt', display_name: 'Victron SmartSolar MPPT', version: '1.0.0', status: 'running', device_name: 'SmartSolar HQ25 (demo)', last_heartbeat: Date.now() / 1000, last_error: null, enabled: true },
  { name: 'simulation', display_name: 'Simulation Engine', version: '1.0.0', status: 'running', last_heartbeat: Date.now() / 1000, last_error: null, enabled: true },
  { name: 'weather', display_name: 'Weather Forecast', version: '1.0.0', status: 'running', last_heartbeat: Date.now() / 1000, last_error: null, enabled: true },
  { name: 'onewire_temp', display_name: 'Temperature Sensors (1-Wire)', version: '1.0.0', status: 'running', last_heartbeat: Date.now() / 1000, last_error: null, enabled: true },
];

const relays = [
  { id: 1, gpio: 17, name: 'Water Pump', commanded_on: false },
  { id: 2, gpio: 27, name: 'Interior Lights', commanded_on: true },
  { id: 3, gpio: 22, name: 'Fridge', commanded_on: true },
  { id: 4, gpio: 23, name: 'Diesel Heater', commanded_on: false },
  // Roof channels 7/8 — present in the list (matches the real /relays
  // shape) but the Switches screen filters these out itself once
  // /roof reports up_channel/down_channel, same as production.
  { id: 7, gpio: 16, name: 'Roof up', commanded_on: false },
  { id: 8, gpio: 26, name: 'Roof down', commanded_on: false },
];

// --- Roof (hold-to-run) simulation ---
// Mirrors RoofService.status() closely enough for the showcase: a
// direction is "moving" while held, released on /roof/release. The
// safety edge cases (reversal refusal, 30s max-run cutoff) aren't
// worth replicating here — nothing physical is actually at risk in a
// browser tab — but the shape matches so the Roof screen renders for
// real instead of showing "not set up".
const roofSim: { active: 'up' | 'down' | null; startedAt: number; lastStoppedReason: string | null } = {
  active: null,
  startedAt: 0,
  lastStoppedReason: null,
};
function roofStatus() {
  const elapsed = roofSim.active ? Date.now() / 1000 - roofSim.startedAt : 0;
  return {
    configured: true,
    enabled: true,
    up_channel: 7,
    down_channel: 8,
    isolate_channels: [],
    moving: roofSim.active,
    elapsed_seconds: Math.round(elapsed * 10) / 10,
    max_run_seconds: 30,
    last_stopped_reason: roofSim.lastStoppedReason,
    position_is_unknown: true,
  };
}

const savedSnaps: { id: string; at: number }[] = [
  { id: 'snap-demo-1', at: Date.now() / 1000 - 3600 },
  { id: 'snap-demo-2', at: Date.now() / 1000 - 7200 },
];

// ---- Simulated camera: a day->night time-lapse "seen" from inside the van ----
// A self-contained SVG scene whose sky, sun/moon, aurora and interior lamp all
// depend on a time-of-day value, rendered fresh each poll so the live view
// rotates like a sped-up time-lapse. No server, no real image needed.
type RGB = [number, number, number];
const _hex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const _mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Sky keyframes by hour: [hour, topColor, bottomColor].
const SKY: [number, RGB, RGB][] = [
  [0, [6, 16, 31], [10, 26, 46]],
  [5.5, [16, 32, 58], [26, 42, 68]],
  [7, [36, 64, 107], [217, 138, 90]],
  [9, [42, 109, 176], [143, 192, 224]],
  [13, [47, 127, 196], [191, 224, 240]],
  [18, [58, 58, 122], [224, 122, 74]],
  [20, [20, 32, 74], [36, 26, 68]],
  [24, [6, 16, 31], [10, 26, 46]],
];
function skyAt(hour: number): [RGB, RGB] {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i];
    const [h1, t1, b1] = SKY[i + 1];
    if (hour >= h0 && hour <= h1) {
      const f = (hour - h0) / (h1 - h0);
      return [_mix(t0, t1, f), _mix(b0, b1, f)];
    }
  }
  return [SKY[0][1], SKY[0][2]];
}
function nightF(h: number): number {
  if (h >= 21 || h < 4) return 1;
  if (h >= 19) return (h - 19) / 2;
  if (h < 6) return (6 - h) / 2;
  return 0;
}

function vanFrame(hour: number): string {
  const w = 640, h = 360;
  const [top, bot] = skyAt(hour);
  const n = nightF(hour);

  const dayVisible = hour >= 6 && hour <= 19;
  const sx = 90 + ((hour - 6) / 13) * 460;
  const sy = 232 - Math.sin(Math.max(0, (hour - 6) / 13) * Math.PI) * 172;
  const sun = dayVisible ? `<circle cx='${sx.toFixed(0)}' cy='${sy.toFixed(0)}' r='26' fill='#ffe08a' opacity='0.9'/>` : '';

  const moonVisible = hour >= 20 || hour <= 5;
  const mh = hour >= 20 ? hour - 20 : hour + 4;
  const mx = 90 + (mh / 9) * 460;
  const my = 150 - Math.sin((mh / 9) * Math.PI) * 60;
  const moon = moonVisible ? `<circle cx='${mx.toFixed(0)}' cy='${my.toFixed(0)}' r='15' fill='#e8f0ff' opacity='0.9'/>` : '';

  const aurora = n > 0.05
    ? `<g opacity='${(n * 0.7).toFixed(2)}' filter='url(#blur)'>
         <path d='M-40 120 Q 200 70 340 120 T 700 110 L700 190 Q 400 150 200 190 T -40 180 Z' fill='#34d399'/>
         <path d='M-40 150 Q 260 100 420 150 T 700 150 L700 210 Q 420 180 220 210 T -40 210 Z' fill='#22d3ee'/>
       </g>`
    : '';

  const stars = n > 0.2
    ? `<g opacity='${n.toFixed(2)}' fill='#ffffff'>` +
      [[60, 60], [130, 80], [210, 55], [300, 70], [380, 50], [470, 76], [540, 58], [590, 90], [160, 110], [420, 100]]
        .map(([x, y]) => `<circle cx='${x}' cy='${y}' r='1.2'/>`)
        .join('') + '</g>'
    : '';

  const warm = n > 0.1 ? `<rect width='${w}' height='${h}' fill='url(#warm)' opacity='${(n * 0.5).toFixed(2)}'/>` : '';

  const H = Math.floor(hour);
  const M = Math.floor((hour - H) * 60);
  const ts = `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
    <defs>
      <linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${_hex(top)}'/><stop offset='1' stop-color='${_hex(bot)}'/></linearGradient>
      <radialGradient id='warm' cx='0.5' cy='1' r='0.9'><stop offset='0' stop-color='#ffb765'/><stop offset='1' stop-color='#ffb765' stop-opacity='0'/></radialGradient>
      <filter id='blur'><feGaussianBlur stdDeviation='9'/></filter>
    </defs>
    <rect width='${w}' height='${h}' fill='url(#sky)'/>
    ${aurora}${stars}${moon}${sun}
    <path d='M0 250 Q 160 220 320 246 T 640 240 L640 360 L0 360 Z' fill='#0b1a2b' opacity='0.92'/>
    <rect x='0' y='250' width='${w}' height='36' fill='#0e2740' opacity='0.5'/>
    ${warm}
    <path d='M0 0 H${w} V${h} H0 Z M42 46 H${w - 42} V${h - 72} H42 Z' fill='#060f1b' fill-rule='evenodd'/>
    <rect x='0' y='${h - 72}' width='${w}' height='72' fill='#0a1622'/>
    <rect x='72' y='${h - 72}' width='34' height='30' rx='4' fill='#12324e'/>
    <rect x='106' y='${h - 60}' width='8' height='8' fill='#12324e'/>
    <g transform='translate(150 ${h - 72})'><rect x='-8' y='0' width='16' height='16' rx='3' fill='#0f2a1e'/><path d='M0 0 C -6 -14 -2 -22 0 -26 C 2 -22 6 -14 0 0' fill='#2f7d5a'/></g>
    <circle cx='${w - 78}' cy='${h - 40}' r='6' fill='#f87171'/>
    <text x='${w - 66}' y='${h - 35}' fill='#cfe0ee' font-family='monospace' font-size='13'>REC</text>
    <text x='42' y='${h - 35}' fill='#9fb6cc' font-family='monospace' font-size='13'>VAN INTERIOR · ${ts}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Static evening frame for saved-snapshot thumbnails.
export const DEMO_CAM_IMAGE = vanFrame(20.8);

// Real-photo support: if the operator drops cam1.jpg .. cam5.jpg next to
// the site, the demo camera cycles through whichever ones actually load
// (a real time-lapse). Until then it falls back to the drawn scene, so
// nothing looks broken. Probed once; only successfully-loaded photos are
// used, so missing files never show as a broken image.
const CAM_PHOTOS = ['/cam1.jpg', '/cam2.jpg', '/cam3.jpg', '/cam4.jpg', '/cam5.jpg'];
let _photos: string[] = [];
let _probed = false;
function _probePhotos() {
  if (_probed) return;
  _probed = true;
  CAM_PHOTOS.forEach((url) => {
    const img = new Image();
    img.onload = () => {
      _photos.push(url);
      _photos.sort((a, b) => CAM_PHOTOS.indexOf(a) - CAM_PHOTOS.indexOf(b));
    };
    img.src = url;
  });
}

// Live view. If real photos are present, cycle them (~5s each) as a
// time-lapse; otherwise sweep the drawn day/night scene (~48s cycle).
export function demoCameraFrame(): string {
  _probePhotos();
  if (_photos.length) {
    return _photos[Math.floor(Date.now() / 5000) % _photos.length];
  }
  const CYCLE_MS = 48000;
  return vanFrame(((Date.now() % CYCLE_MS) / CYCLE_MS) * 24);
}

function missionBrief() {
  const yieldWh = Math.round(sim.yieldWh);
  return {
    status: 'green',
    summary: 'Everything looks good.',
    recommendations: [],
    predictions: [
      { key: 'estimated_runtime_hours', label: 'Estimated runtime', value: 52, unit: 'hours', confidence: null },
    ],
    signals: [
      { source: 'battery', severity: 'ok', message: 'Battery healthy and holding.', weight: 1 },
      {
        source: 'solar_verdict',
        severity: 'ok',
        message: 'Good solar day for the season — bright skies, about 89% of the most a clear day could give right now. A clear day now tops out near 27 MJ/m².',
        weight: 1,
        detail: { verdict: 'good', ratio_pct: 89, today_mj: 24.1, clearsky_mj: 27.0, yield_today_wh: yieldWh },
      },
      {
        source: 'solar_history',
        severity: 'ok',
        message: 'Solar harvest steady.',
        weight: 1,
        detail: { today_wh: yieldWh, avg_wh: 2100, best_wh: 2640, days: 7 },
      },
    ],
    computed_at: Date.now() / 1000,
  };
}

function history(domain: string, hours: number) {
  const points = Math.min(240, Math.max(30, Math.round(hours * 4)));
  const now = Date.now() / 1000;
  const out = [];
  for (let i = 0; i < points; i++) {
    const ts = now - (points - 1 - i) * ((hours * 3600) / points);
    const d = new Date(ts * 1000);
    const h = d.getHours() + d.getMinutes() / 60;
    const light = daylight(h);
    let payload: Record<string, unknown> = {};
    if (domain === 'battery') payload = { voltage: 12.4 + light * 1.2 + 0.1 * Math.sin(i / 6), soc_pct: null };
    else if (domain === 'solar') payload = { watts: Math.round(320 * light * (0.75 + 0.2 * Math.sin(i / 5))) };
    else if (domain === 'environment') payload = { internal_temp_c: 18 + 3 * light + Math.sin(i / 8) };
    else if (domain === 'energy') payload = { net_watts: Math.round(320 * light - 70 + 30 * Math.sin(i / 4)) };
    out.push({ domain, source: 'simulation', timestamp: ts, payload });
  }
  return out;
}

/** REST responder for demo mode. Mutations update the in-memory state. */
// Ofcom's four operator prefixes (TF is Telefónica, i.e. O2).
const DEMO_COVERAGE_OPERATORS = [
  { key: 'EE', name: 'EE' },
  { key: 'H3', name: 'Three' },
  { key: 'TF', name: 'O2' },
  { key: 'VO', name: 'Vodafone' },
];

/** Ofcom's 0/3/4 scale wrapped in the same rating object the backend
 *  emits, so the Coverage screen exercises exactly one code path. */
const rating = (value: number, varies = false, without4g = value) => ({
  value,
  label: value === 4 ? 'likely' : value === 0 ? 'none' : 'limited',
  varies,
  best: varies ? Math.min(4, value + 1) : value,
  worst: varies ? Math.max(0, value - 1) : value,
  relies_on_4g: value > without4g,
  without_4g: without4g,
});

/** A deliberately mixed rural result — good outdoors on two networks,
 *  patchy indoors, one network with nothing. That's the realistic
 *  Lake District picture and it shows every visual state at once. */
function demoCoverage(
  postcode: string,
  label: string,
  opts: { lat?: number; lon?: number; home?: number; agoHours?: number } = {},
) {
  // `home` overrides Three's outdoor rating so the demo map can show all
  // three pin colours - a single-colour map wouldn't demonstrate the
  // legend at all.
  const values: Record<string, [number, number, number, number]> = {
    // [data outdoor, data indoor, voice outdoor, voice indoor]
    EE: [4, 3, 4, 3],
    H3: [opts.home ?? 3, 0, 3, 0],
    TF: [4, 4, 4, 4],
    VO: [0, 0, 3, 0],
  };
  return {
    postcode,
    address_count: 14,
    operators: DEMO_COVERAGE_OPERATORS.map(({ key, name }) => {
      const [dOut, dIn, vOut, vIn] = values[key];
      return {
        key,
        name,
        data_outdoor: rating(dOut, key === 'EE', key === 'EE' ? 3 : dOut),
        data_indoor: rating(dIn),
        voice_outdoor: rating(vOut),
        voice_indoor: rating(vIn),
      };
    }),
    place: {
      label,
      postcode,
      latitude: opts.lat ?? DEMO_LAT,
      longitude: opts.lon ?? DEMO_LON,
      source: 'demo',
    },
    from_cache: false,
    cached_at: Date.now() / 1000 - (opts.agoHours ?? 0) * 3600,
    stale: false,
  };
}

export async function demoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 120)); // a touch of latency for realism
  const [p, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : {};

  const R = (v: unknown) => v as T;

  if (p === '/health') return R({ status: 'ok', plugins: [], version: '0.2.0-demo' });
  if (p === '/auth/status') return R({ required: false });
  if (p === '/settings') return R({ theme: 'dark', nearby_radius_m: 15000 });
  if (p === '/intelligence/mission-brief') return R(missionBrief());
  if (p === '/location') return R({ latitude: DEMO_LAT, longitude: DEMO_LON, source: 'demo', satellites: 8, hdop: 0.9 });
  if (p === '/location/satellites') {
    // Plausible fixed constellation geometry for the demo/showcase build -
    // not live data, just enough to show what the real feature looks like.
    const demoSats = [
      { prn: 12, constellation: 'P', elevation: 68, azimuth: 42, snr: 43, quality: 'strong' as const },
      { prn: 24, constellation: 'P', elevation: 51, azimuth: 118, snr: 38, quality: 'good' as const },
      { prn: 7, constellation: 'P', elevation: 39, azimuth: 205, snr: 36, quality: 'good' as const },
      { prn: 3, constellation: 'G', elevation: 27, azimuth: 290, snr: 29, quality: 'fair' as const },
      { prn: 18, constellation: 'P', elevation: 22, azimuth: 155, snr: null, quality: 'not tracking' as const },
      { prn: 9, constellation: 'G', elevation: 60, azimuth: 320, snr: 40, quality: 'strong' as const },
    ];
    return R({ satellites: demoSats, count: demoSats.length });
  }
  if (p === '/location/history' && method === 'DELETE') return R({ deleted: 0 });
  if (p === '/location/history') {
    // A gentle sample trail around the demo location so the Trips view has
    // something to show in the static showcase build.
    const points = Array.from({ length: 24 }, (_, i) => ({
      timestamp: Date.now() / 1000 - (24 - i) * 3600,
      latitude: DEMO_LAT + Math.sin(i / 3) * 0.03 + i * 0.004,
      longitude: DEMO_LON + Math.cos(i / 4) * 0.03 + i * 0.006,
      source: 'demo',
    }));
    return R({ points, count: points.length });
  }
  if (p === '/places' && method === 'POST') {
    const place = {
      id: nextPlaceId++,
      name: String(body.name || 'Unnamed stop'),
      notes: body.notes ?? null,
      latitude: body.latitude,
      longitude: body.longitude,
      arrived_at: body.arrived_at,
      departed_at: body.departed_at ?? null,
      created_at: Date.now() / 1000,
    };
    demoPlaces.unshift(place);
    return R(place);
  }
  if (p === '/places') return R({ places: demoPlaces });
  if (p === '/places/detected')
    return R({
      candidates: [
        {
          latitude: DEMO_LAT + Math.sin(20 / 3) * 0.03 + 20 * 0.004,
          longitude: DEMO_LON + Math.cos(20 / 4) * 0.03 + 20 * 0.006,
          arrived_at: Date.now() / 1000 - 4 * 3600,
          departed_at: Date.now() / 1000 - 3 * 3600,
          point_count: 6,
        },
      ],
    });
  if (p.startsWith('/places/') && method === 'PUT') {
    const id = Number(p.split('/')[2]);
    const place = demoPlaces.find((x) => x.id === id);
    if (place) {
      if (body.name !== undefined) place.name = body.name;
      if (body.notes !== undefined) place.notes = body.notes;
    }
    return R(place ?? {});
  }
  if (p.startsWith('/places/') && method === 'DELETE') {
    const id = Number(p.split('/')[2]);
    const idx = demoPlaces.findIndex((x) => x.id === id);
    if (idx >= 0) demoPlaces.splice(idx, 1);
    return R({ ok: true });
  }
  if (p === '/backup/restore') return R({ ok: true, message: "Backups aren't available in the browser demo — this is real on your Pi." });
  if (p === '/poi/nearby') {
    const cats = params.get('categories');
    const results = cats ? POIS.filter((x) => cats.split(',').includes(x.category)) : POIS;
    const forced = params.get('force_refresh') === 'true';
    return R(forced ? { results, from_cache: false, cached_at: null } : { results, from_cache: true, cached_at: Date.now() / 1000 - 86400 });
  }
  // Coverage — Ofcom's real API is key-gated and can't ship in a public
  // static build, so the demo synthesises a plausible rural result. The
  // shape matches coverage_service.py exactly; the numbers do not come
  // from Ofcom and the demo build is banner-marked as simulated.
  if (p === '/coverage/status') return R({ configured: true, home_network: 'H3', operators: DEMO_COVERAGE_OPERATORS });
  // Modem diagnostics — the public demo has no real router to reach, so
  // this simulates what a reachable B525 would answer with.
  if (p === '/modem/signal') {
    return R({ reachable: true, host: '192.168.8.1', raw: { rsrp: '-92dBm', rsrq: '-9dB', sinr: '11dB', band: 'LTE B20', mode: '7' } });
  }

  // Several places, deliberately spread out and deliberately disagreeing,
  // so the map view shows real pins in all three colours rather than one
  // dot in the middle of Cumbria.
  if (p === '/coverage/recent') {
    const results = [
      demoCoverage('CA12 5UY', 'Borrowdale, Cumbria', { home: 3 }),
      demoCoverage('CA20 1EX', 'Wasdale Head, Cumbria', { lat: 54.4675, lon: -3.2947, home: 0, agoHours: 20 }),
      demoCoverage('LA22 9AN', 'Ambleside, Cumbria', { lat: 54.4287, lon: -2.9615, home: 4, agoHours: 52 }),
      demoCoverage('LA20 6BN', 'Broughton-in-Furness', { lat: 54.2778, lon: -3.2117, home: 3, agoHours: 96 }),
    ];
    return R({ results, count: results.length });
  }
  if (p === '/coverage/search' || p === '/coverage/at' || p === '/coverage/here') {
    const q = params.get('q') || 'Borrowdale, Cumbria';
    return R(demoCoverage('CA12 5UY', q));
  }
  // A scattered grid around whatever point was asked for - demonstrates
  // "any location", not just the fixed Cumbria spot the other demo
  // endpoints use, and mixes all three rating colours like /recent does.
  if (p === '/coverage/area') {
    const lat = Number(params.get('lat')) || DEMO_LAT;
    const lon = Number(params.get('lon')) || DEMO_LON;
    const jitter = [
      [0.006, 0.01, 4], [-0.008, 0.014, 0], [0.012, -0.006, 3], [-0.004, -0.012, 4],
      [0.016, 0.004, 0], [-0.014, 0.008, 3], [0.002, 0.018, 4], [0.009, -0.016, 3],
    ] as const;
    const results = jitter.map(([dLat, dLon, home], i) =>
      demoCoverage(`DM${i} 0AA`, `Sample point ${i + 1}`, { lat: lat + dLat, lon: lon + dLon, home }),
    );
    return R({ centre: { latitude: lat, longitude: lon }, radius_m: 1500, results });
  }

  if (p === '/ai/status') return R({ configured: true });
  if (p === '/ai/nearby-recommendations')
    return R({
      place_name: 'the Lake District',
      recommendations: [
        { name: 'Aurora Viewpoint', description: 'High chance of clear skies tonight — secluded, level parking.', category: 'camping' },
        { name: 'Ashness Bridge', description: 'Iconic packhorse bridge, great sunrise spot 2 mi away.', category: 'camping' },
        { name: 'Fellside Farm Shop', description: 'Local produce and fresh water fill, opens 09:00.', category: 'food' },
      ],
      from_cache: false,
      cached_at: null,
    });
  if (p.startsWith('/plugins/') && p.endsWith('/enable')) {
    const name = p.split('/')[2];
    const plg = plugins.find((x) => x.name === name);
    if (plg) { plg.enabled = true; plg.status = 'running'; }
    return R({ name, enabled: true });
  }
  if (p.startsWith('/plugins/') && p.endsWith('/disable')) {
    const name = p.split('/')[2];
    const plg = plugins.find((x) => x.name === name);
    if (plg) { plg.enabled = false; plg.status = 'disabled'; }
    return R({ name, enabled: false });
  }

  if (p === '/plugins') return R(plugins);
  if (p === '/wifi/status') return R({ connected: true, ssid: 'Starlink-Roam', ip: '192.168.1.45' });
  if (p === '/wifi/scan')
    return R({
      networks: [
        { ssid: 'Starlink-Roam', signal: -48, secured: true, current: true },
        { ssid: 'Campground-WiFi-5G', signal: -63, secured: true, current: false },
        { ssid: 'VanLife-Hotspot', signal: -70, secured: false, current: false },
        { ssid: 'Marina-Guest', signal: -78, secured: true, current: false },
      ],
    });
  if (p === '/wifi/connect') return R({ ok: true, connected_to: body.ssid, ip: '192.168.1.45' });

  if (p.startsWith('/config/')) {
    if (method === 'PUT') return R(body.value || {});
    return R({ contact_email: 'demo@vanos.example', ai_model: '', anthropic_api_key_set: true });
  }

  if (p.startsWith('/history/')) return R(history(p.split('/')[2], parseFloat(params.get('hours') || '24')));

  if (p === '/roof') return R(roofStatus());
  if (p === '/roof/hold') {
    const direction = body.direction === 'down' ? 'down' : 'up';
    if (roofSim.active !== direction) {
      roofSim.active = direction;
      roofSim.startedAt = Date.now() / 1000;
    }
    return R(roofStatus());
  }
  if (p === '/roof/release') {
    if (roofSim.active) roofSim.lastStoppedReason = 'released';
    roofSim.active = null;
    return R(roofStatus());
  }

  if (p === '/relays') return R({ available: true, reason: null, state_is_commanded_only: true, channels: relays });
  if (p.startsWith('/relays/') && p.endsWith('/set')) {
    const id = Number(p.split('/')[2]);
    const r = relays.find((x) => x.id === id);
    if (r) r.commanded_on = !!body.on;
    return R({ available: true, reason: null, state_is_commanded_only: true, channels: relays });
  }
  if (p.startsWith('/relays/') && p.endsWith('/toggle')) {
    const id = Number(p.split('/')[2]);
    const r = relays.find((x) => x.id === id);
    if (r) r.commanded_on = !r.commanded_on;
    return R({ available: true, reason: null, state_is_commanded_only: true, channels: relays });
  }
  if (p === '/relays/all-off') {
    relays.forEach((r) => (r.commanded_on = false));
    return R({ ok: true });
  }
  if (p === '/relays/events') {
    // Realistic sample sequence for the showcase build - a roof
    // hold+release (full isolate/direction detail, matching what the
    // real audit trail actually records), a watchdog auto-release, and
    // an ordinary switch toggle. Not live data, just enough to show
    // what the real feature looks like.
    const now = Date.now() / 1000;
    const demoEvents = [
      { id: 9, timestamp: now - 40, channel_id: null, channel_name: 'Roof', action: 'release', detail: 'released', source: 'roof:stop-released' },
      { id: 8, timestamp: now - 41, channel_id: 6, channel_name: 'Roof switch isolate B', action: 'off', detail: null, source: 'roof:stop-released' },
      { id: 7, timestamp: now - 41, channel_id: 5, channel_name: 'Roof switch isolate A', action: 'off', detail: null, source: 'roof:stop-released' },
      { id: 6, timestamp: now - 41, channel_id: 7, channel_name: 'Roof up', action: 'off', detail: null, source: 'roof:stop-released' },
      { id: 5, timestamp: now - 75, channel_id: null, channel_name: 'Roof', action: 'hold_up', detail: null, source: 'app:roof-hold' },
      { id: 4, timestamp: now - 75, channel_id: 7, channel_name: 'Roof up', action: 'on', detail: null, source: 'roof:up-hold' },
      { id: 3, timestamp: now - 75, channel_id: 5, channel_name: 'Roof switch isolate A', action: 'on', detail: null, source: 'roof:up-isolate' },
      { id: 2, timestamp: now - 610, channel_id: 2, channel_name: 'Lights', action: 'off', detail: null, source: 'app:switches' },
      { id: 1, timestamp: now - 615, channel_id: 2, channel_name: 'Lights', action: 'on', detail: null, source: 'app:switches' },
    ];
    return R({ events: demoEvents, count: demoEvents.length });
  }

  if (p === '/camera/snapshots' && method === 'POST') {
    const id = `snap-demo-${savedSnaps.length + 1}-${Math.round(sim.tick)}`;
    const rec = { id, at: Date.now() / 1000 };
    savedSnaps.unshift(rec);
    return R(rec);
  }
  if (p === '/camera/snapshots') return R({ snapshots: savedSnaps });
  if (p.startsWith('/camera/snapshots/') && method === 'DELETE') {
    const id = p.split('/')[3];
    const i = savedSnaps.findIndex((s) => s.id === id);
    if (i >= 0) savedSnaps.splice(i, 1);
    return R(undefined);
  }

  // Weather comes through telemetry in the real app, but a couple of
  // screens read it via the store which we seed from the tick; nothing
  // else calls REST for it. Default: empty object so callers don't crash.
  return R({});
}

/** Weather is a telemetry domain — seed it once so the Weather screen fills. */
export function demoWeatherMessage(): TelemetryMessage {
  return {
    domain: 'weather',
    source: 'simulation',
    timestamp: Date.now() / 1000,
    payload: {
      current_temp_c: 14,
      current_cloud_cover_pct: 40,
      current_weather_code: 2,
      current_weather_description: 'Partly cloudy',
      today: day(0, 2, 'Partly cloudy', 16, 9, 24.1),
      tomorrow: day(1, 3, 'Overcast', 15, 8, 19.8),
      forecast: [
        day(0, 2, 'Partly cloudy', 16, 9, 24.1),
        day(1, 3, 'Overcast', 15, 8, 19.8),
        day(2, 1, 'Mainly clear', 18, 10, 26.4),
        day(3, 61, 'Light rain', 12, 6, 9.2),
        day(4, 80, 'Showers', 11, 5, 8.1),
        day(5, 2, 'Partly cloudy', 14, 7, 21.0),
        day(6, 0, 'Clear', 17, 9, 27.3),
      ],
      tomorrow_vs_today_radiation_ratio: 0.82,
    },
  };
}
