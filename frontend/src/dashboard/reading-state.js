const healthKey = metric => metric === 'phVoltage' ? 'ph' : metric;
const usable = (row, metric) => row && row.sensorHealth?.[healthKey(metric)] !== false && Number.isFinite(row[metric]);

export function lastKnownReading(metric, candidates) {
  return candidates.filter(row => usable(row, metric) && Number.isFinite(+row.time))
    .sort((a, b) => b.time - a.time)[0] ?? null;
}

export function phReading(candidates) {
  const row = candidates.filter(row => row && Number.isFinite(+row.time) &&
    (usable(row, 'ph') || usable(row, 'phVoltage'))).sort((a, b) => b.time - a.time)[0] ?? null;
  return { row, metric: Number.isFinite(row?.ph) ? 'ph' : 'phVoltage' };
}

export function readingState(metric, latest, known, online, now = Date.now()) {
  const fresh = online && usable(latest, metric) && now - latest.time < 60000 && latest.time - now < 30000;
  if (fresh) return { kind: 'live', row: latest };
  return known ? { kind: 'stale', row: known } : { kind: 'never', row: null };
}

export function elapsedLabel(time, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return 'dưới 1 phút';
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.floor(minutes / 60)} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ''}`;
}

export const METRIC_CARD_STATUSES = {
  normal: { label: 'Bình thường', tone: 'normal' },
  attention: { label: 'Cần chú ý', tone: 'warning' },
  offline: { label: 'Mất kết nối', tone: 'neutral' },
  error: { label: 'Lỗi cảm biến', tone: 'danger' },
  uncalibrated: { label: 'Chưa hiệu chỉnh', tone: 'uncalibrated' },
};

// Status priority is shared by all metric cards so their badges always mean the
// same thing to the user. A current sensor fault is more actionable than a
// missing calibration; an old sample is treated as a connection problem.
export function metricCardStatus({ readingKind, sensorHealthy = true, calibrated = true, thresholdStatus = 'normal' }) {
  if (readingKind !== 'live') return METRIC_CARD_STATUSES.offline;
  if (sensorHealthy === false) return METRIC_CARD_STATUSES.error;
  if (!calibrated) return METRIC_CARD_STATUSES.uncalibrated;
  if (thresholdStatus !== 'normal') return METRIC_CARD_STATUSES.attention;
  return METRIC_CARD_STATUSES.normal;
}
