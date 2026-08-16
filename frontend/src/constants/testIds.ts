// Centralised test IDs. Prefer these over inline strings so E2E tests and
// design/dev never drift.

export const NAV = {
  root: 'nav-shell',
  brand: 'nav-brand',
  wsIndicator: 'nav-ws-indicator',
  home: 'nav-home',
  power: 'nav-power',
  weather: 'nav-weather',
  nearby: 'nav-nearby',
  coverage: 'nav-coverage',
  switches: 'nav-switches',
  roof: 'nav-roof',
  camera: 'nav-camera',
  history: 'nav-history',
  trips: 'nav-trips',
  chat: 'nav-chat',
  radio: 'nav-radio',
  settings: 'nav-settings',
} as const;

export const CHAT = {
  root: 'chat-screen',
  input: 'chat-input',
  send: 'chat-send',
  message: (i: number) => `chat-message-${i}`,
  newChat: 'chat-new',
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

export const POWER = {
  root: 'power-screen',
  batteryVoltage: 'power-battery-voltage',
  batteryCharging: 'power-battery-charging',
  solarWatts: 'power-solar-watts',
  solarChargeState: 'power-solar-charge-state',
  net: 'power-net',
  loads: 'power-loads',
} as const;

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
  signalCard: 'nearby-signal-card',
  offlineBadge: 'nearby-offline-badge',
  filter: (cat: string) => `nearby-filter-${cat}`,
  spotCard: 'nearby-spot-card',
  spotProvider: (key: string) => `nearby-spot-${key}`,
  poiProvider: (key: string) => `nearby-poi-${key}`,
} as const;

/** Shared map controls, used on every MapLibre map (Trips, Coverage). */
export const MAPS = {
  saveArea: 'map-save-area',
  missingTiles: 'map-missing-tiles',
} as const;

export const COVERAGE = {
  root: 'coverage-screen',
  search: 'coverage-search',
  submit: 'coverage-submit',
  result: 'coverage-result',
  map: 'coverage-map',
  here: 'coverage-here',
  recent: 'coverage-recent',
  operator: (key: string) => `coverage-operator-${key}`,
  viewSearch: 'coverage-view-search',
  viewMap: 'coverage-view-map',
  overlayMap: 'coverage-overlay-map',
} as const;

export const SWITCH = {
  root: 'switches-screen',
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
  internetRadio: 'settings-internet-radio',
  updateBanner: 'settings-update-banner',
  location: 'settings-location',
  backup: 'settings-backup',
} as const;

export const TRIPS = {
  root: 'trips-screen',
  map: 'trips-map',
  places: 'trips-places',
} as const;

export const OVERVIEW = {
  root: 'overview-screen',
  statusPill: 'overview-status-pill',
  recommendations: 'overview-recommendations',
  predictions: 'overview-predictions',
  signals: 'overview-signals',
} as const;

export const RADIO = {
  root: 'radio-screen',
  player: 'radio-player',
  stationList: 'radio-station-list',
  searchInput: 'radio-search-input',
  favorites: 'radio-favorites',
} as const;

export const APP = {
  simBanner: 'app-sim-banner',
  updateBanner: 'app-update-banner',
} as const;
