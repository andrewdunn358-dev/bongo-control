// Centralised test IDs. Prefer these over inline strings so E2E tests and
// design/dev never drift.

export const NAV = {
  root: 'nav-shell',
  brand: 'nav-brand',
  wsIndicator: 'nav-ws-indicator',
  home: 'nav-home',
  energy: 'nav-energy',
  battery: 'nav-battery',
  solar: 'nav-solar',
  weather: 'nav-weather',
  nearby: 'nav-nearby',
  switches: 'nav-switches',
  roof: 'nav-roof',
  camera: 'nav-camera',
  history: 'nav-history',
  settings: 'nav-settings',
} as const;

export const HOME = {
  root: 'home-screen',
  sitrepBadge: 'home-sitrep-badge',
  solarVerdict: 'home-solar-verdict',
  batteryVoltage: 'home-battery-voltage',
  solarWatts: 'home-solar-watts',
  interiorTemp: 'home-interior-temp',
  externalTemp: 'home-external-temp',
  netEnergy: 'home-net-energy',
} as const;

export const BATTERY = { root: 'battery-screen', voltage: 'battery-voltage', charging: 'battery-charging' } as const;
export const SOLAR = { root: 'solar-screen', watts: 'solar-watts', chargeState: 'solar-charge-state' } as const;
export const ENERGY = { root: 'energy-screen', net: 'energy-net', loads: 'energy-loads' } as const;

export const WEATHER = {
  root: 'weather-screen',
  currentTemp: 'weather-current-temp',
  currentDesc: 'weather-current-desc',
  todayCard: 'weather-today',
  tomorrowCard: 'weather-tomorrow',
  forecastList: 'weather-forecast-list',
  irradianceRatio: 'weather-irradiance-ratio',
} as const;

export const NEARBY = {
  root: 'nearby-screen',
  map: 'nearby-map',
  list: 'nearby-list',
  refresh: 'nearby-refresh',
  aiCard: 'nearby-ai-card',
  offlineBadge: 'nearby-offline-badge',
  filter: (cat: string) => `nearby-filter-${cat}`,
} as const;

export const SWITCH = {
  root: 'switches-screen',
  caveat: 'switches-caveat',
  allOff: 'switches-all-off',
  relay: (id: number | string) => `switches-relay-${id}`,
} as const;

export const CAM = {
  root: 'camera-screen',
  gate: 'camera-lock-gate',
  passwordInput: 'camera-password-input',
  unlockBtn: 'camera-unlock-btn',
  frame: 'camera-frame',
  liveBadge: 'camera-live-badge',
  lockBtn: 'camera-lock-btn',
} as const;

export const HIST = {
  root: 'history-screen',
  domain: (d: string) => `history-domain-${d}`,
  range: (h: string) => `history-range-${h}`,
  chart: (d: string) => `history-chart-${d}`,
} as const;

export const SET = {
  root: 'settings-screen',
  themeToggle: 'settings-theme-toggle',
  wifiScan: 'settings-wifi-scan',
  wifiList: 'settings-wifi-list',
  pluginsList: 'settings-plugins-list',
  updateBanner: 'settings-update-banner',
} as const;

export const APP = {
  simBanner: 'app-sim-banner',
  updateBanner: 'app-update-banner',
} as const;
