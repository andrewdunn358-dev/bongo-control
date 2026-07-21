import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

export const wsUrl = (path) => {
  const base = BACKEND_URL.replace(/^http/, 'ws');
  return `${base}${path}`;
};

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 12000,
});

// Auth token helpers (used by camera gate)
const TOKEN_KEY = 'bongo.unlock.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const endpoints = {
  telemetrySnapshot: () => api.get('/telemetry/snapshot').then((r) => r.data),
  missionBrief: () => api.get('/intelligence/mission-brief').then((r) => r.data),
  poiNearby: (lat, lng) =>
    api.get('/poi/nearby', { params: { lat, lng } }).then((r) => r.data),
  aiNearby: (lat, lng) =>
    api.get('/ai/nearby-recommendations', { params: { lat, lng } }).then((r) => r.data),
  weather: (lat, lng) =>
    api.get('/weather/forecast', { params: { lat, lng } }).then((r) => r.data),
  history: (domain, range) =>
    api.get(`/history/${domain}`, { params: { range } }).then((r) => r.data),
  authUnlock: (password) =>
    api.post('/auth/unlock', { password }).then((r) => r.data),
  cameraSnapshotUrl: (token) => `${API_BASE}/camera/snapshot?token=${encodeURIComponent(token)}&_=${Date.now()}`,
  wifiStatus: () => api.get('/wifi/status').then((r) => r.data),
  wifiScan: () => api.get('/wifi/scan').then((r) => r.data),
  wifiConnect: (ssid, password) =>
    api.post('/wifi/connect', { ssid, password }).then((r) => r.data),
  plugins: () => api.get('/plugins').then((r) => r.data),
  tunnelStatus: () => api.get('/tunnel/status').then((r) => r.data),
  settings: () => api.get('/settings').then((r) => r.data),
  updateSettings: (patch) => api.post('/settings', patch).then((r) => r.data),
};
