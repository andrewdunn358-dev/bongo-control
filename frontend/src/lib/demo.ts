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

const POIS = [
  { id: 1, category: 'camping', name: 'Lone Pine Campground', latitude: DEMO_LAT + 0.01, longitude: DEMO_LON + 0.012, opening_hours: null, fee: '£18', address: 'Fell Rd', phone: null, website: null },
  { id: 2, category: 'water', name: 'Crystal Spring (potable)', latitude: DEMO_LAT - 0.008, longitude: DEMO_LON + 0.02, opening_hours: '24/7', fee: null, address: null, phone: null, website: null },
  { id: 3, category: 'fuel', name: 'Keswick Filling Station', latitude: DEMO_LAT + 0.02, longitude: DEMO_LON - 0.015, opening_hours: '06:00–22:00', fee: null, address: 'Main St', phone: null, website: null },
  { id: 4, category: 'dump', name: 'Derwent Dump Point', latitude: DEMO_LAT - 0.02, longitude: DEMO_LON - 0.01, opening_hours: null, fee: 'Free', address: null, phone: null, website: null },
  { id: 5, category: 'food', name: 'The Wild Fell Cafe', latitude: DEMO_LAT + 0.006, longitude: DEMO_LON + 0.028, opening_hours: '08:00–17:00', fee: null, address: 'Lake Rd', phone: null, website: null },
  { id: 6, category: 'camping', name: 'Starlight Haven Aire', latitude: DEMO_LAT - 0.03, longitude: DEMO_LON + 0.008, opening_hours: null, fee: '£12', address: null, phone: null, website: null },
];

const relays = [
  { id: 1, gpio: 17, name: 'Water Pump', commanded_on: false },
  { id: 2, gpio: 27, name: 'Interior Lights', commanded_on: true },
  { id: 3, gpio: 22, name: 'Fridge', commanded_on: true },
  { id: 4, gpio: 23, name: 'Diesel Heater', commanded_on: false },
];

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
  if (p === '/location') return R({ latitude: DEMO_LAT, longitude: DEMO_LON, source: 'demo' });
  if (p === '/poi/nearby') {
    const cats = params.get('categories');
    const results = cats ? POIS.filter((x) => cats.split(',').includes(x.category)) : POIS;
    return R({ results, from_cache: true, cached_at: Date.now() / 1000 - 86400 });
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
  if (p === '/plugins')
    return R([
      { name: 'victron_mppt', display_name: 'Victron SmartSolar MPPT', version: '1.0.0', status: 'running', device_name: 'SmartSolar HQ25 (demo)', last_heartbeat: Date.now() / 1000, last_error: null },
      { name: 'simulation', display_name: 'Simulation Engine', version: '1.0.0', status: 'running', last_heartbeat: Date.now() / 1000, last_error: null },
      { name: 'weather', display_name: 'Weather Forecast', version: '1.0.0', status: 'running', last_heartbeat: Date.now() / 1000, last_error: null },
      { name: 'onewire_temp', display_name: 'Temperature Sensors (1-Wire)', version: '1.0.0', status: 'running', last_heartbeat: Date.now() / 1000, last_error: null },
    ]);
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
