const fields = { tempMin: 'temperature_min_c', tempMax: 'temperature_max_c', phMin: 'ph_min', phMax: 'ph_max', turbidityWarn: 'turbidity_warning_pct', turbidityDanger: 'turbidity_critical_pct' };
export function decodeThresholds(row) {
  return row && Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, row[field]]));
}
export function encodeThresholds(row) {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [field, row[key]]));
}
export function decodeReading(row) {
  return row && { id: row.id, time: new Date(row.measured_at), temperature: row.temperature_c, ph: row.ph, phVoltage: row.ph_mv ?? null, turbidity: row.turbidity_pct, turbidityVoltage: row.turbidity_mv ?? null, turbidityReference: row.turbidity_reference_mv ?? null, turbidityChange: signalReduction(row.turbidity_mv, row.turbidity_reference_mv), clarity: row.clarity_pct ?? null, clarityState: row.clarity_state ?? null, claritySince: row.clarity_since, clarityBaselineAt: row.clarity_baseline_at, clarityMv: row.clarity_mv, sensorHealth: row.sensor_health ?? null, rssi: row.signal_strength_dbm };
}
// A signal comparison only: not NTU, optical transmittance or percent turbidity.
export function signalReduction(mv, reference) {
  if (!Number.isFinite(mv) || !Number.isFinite(reference) || mv < 150 || mv > 3000 || reference < 150 || reference > 3000) return null;
  return 100 * (reference - mv) / reference;
}
export function metricStatus(metric, value, thresholds) {
  if (metric === 'clarity') return Number.isFinite(value) ? 'uncalibrated' : 'neutral';
  if (metric === 'phVoltage' || metric === 'turbidityVoltage' || metric === 'turbidityChange') return Number.isFinite(value) ? 'uncalibrated' : 'neutral';
  if (!Number.isFinite(value) || !thresholds) return 'neutral';
  if (metric === 'turbidity') return value >= thresholds.turbidityDanger ? 'danger' : value >= thresholds.turbidityWarn ? 'warning' : 'normal';
  const [min, max] = metric === 'ph' ? [thresholds.phMin, thresholds.phMax] : [thresholds.tempMin, thresholds.tempMax];
  return value < min || value > max ? 'warning' : 'normal';
}
export async function request(deviceId, suffix = '', options = {}) {
  const { nullable = false, signal, ...init } = options;
  const response = await fetch(`/api/v1/devices/${encodeURIComponent(deviceId)}${suffix}`, {
    ...init, headers: { 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
  });
  if (nullable && response.status === 404) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Yêu cầu thất bại (HTTP ${response.status}). Vui lòng thử lại.`);
  }
  return response.json();
}
export async function snapshot(deviceId, minutes, signal) {
  const [device, latest, history, thresholds, alerts, baselines, clarityHistory, clarityConfig, settings, lastValid] = await Promise.all([
    request(deviceId, '', { signal, nullable: true }),
    request(deviceId, '/telemetry/latest', { signal, nullable: true }),
    request(deviceId, `/telemetry/series?minutes=${minutes}`, { signal }),
    request(deviceId, '/thresholds', { signal, nullable: true }),
    request(deviceId, '/alerts?limit=50', { signal }),
    request(deviceId, '/clarity/baselines', { signal }),
    minutes === 1440 ? Promise.resolve(null) : request(deviceId, '/telemetry/series?minutes=1440', { signal }),
    request(deviceId, '/clarity/config', { signal }),
    request(deviceId, '/settings', { signal, nullable: true }),
    request(deviceId, '/telemetry/last-valid', { signal }),
  ]);
  return { device, latest: decodeReading(latest), history: history.map(decodeReading).sort((a,b) => a.time - b.time), clarityHistory: (clarityHistory ?? history).map(decodeReading).sort((a,b) => a.time - b.time), thresholds: decodeThresholds(thresholds), alerts, baselines, clarityConfig, settings,
    lastValid: Object.fromEntries(['temperature', 'ph', 'clarity'].map(key => [key, decodeReading(lastValid[key])])) };
}
