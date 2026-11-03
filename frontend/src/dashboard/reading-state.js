export function lastKnownReading(metric, candidates) {
  return candidates.filter(row => row && Number.isFinite(row[metric]) && Number.isFinite(+row.time))
    .sort((a, b) => b.time - a.time)[0] ?? null;
}

export function phReading(candidates) {
  const row = candidates.filter(row => row && Number.isFinite(+row.time) &&
    (Number.isFinite(row.ph) || Number.isFinite(row.phVoltage))).sort((a, b) => b.time - a.time)[0] ?? null;
  return { row, metric: Number.isFinite(row?.ph) ? 'ph' : 'phVoltage' };
}

export function readingState(metric, latest, known, online, now = Date.now()) {
  const fresh = online && latest && Number.isFinite(latest[metric]) && now - latest.time < 60000 && latest.time - now < 30000;
  if (fresh) return { kind: 'live', row: latest };
  return known ? { kind: 'stale', row: known } : { kind: 'never', row: null };
}

export function elapsedLabel(time, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return 'dưới 1 phút';
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.floor(minutes / 60)} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ''}`;
}
