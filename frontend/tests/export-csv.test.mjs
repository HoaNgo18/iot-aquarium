import test from 'node:test';
import assert from 'node:assert/strict';
import { exportRange, exportUrl, filenameFrom, presetRange, toLocalInput } from '../src/dashboard/export-csv.js';

const now = new Date('2026-11-03T15:00:00Z');

test('toLocalInput formats for datetime-local without seconds', () => {
  const value = toLocalInput(new Date(2026, 10, 3, 8, 5, 59));
  assert.equal(value, '2026-11-03T08:05');
});

test('presetRange ends now and spans the given minutes', () => {
  const { from, to } = presetRange(60, now);
  assert.equal(to, now);
  assert.equal(to - from, 3600000);
});

test('exportRange accepts a valid range and rejects bad ones', () => {
  const ok = exportRange('2026-11-03T08:00', '2026-11-03T09:00', now);
  assert.ok(!ok.error);
  assert.equal(ok.to - ok.from, 3600000);
  assert.match(exportRange('', '2026-11-03T09:00', now).error, /Chọn đủ/);
  assert.match(exportRange('2026-11-03T09:00', '2026-11-03T09:00', now).error, /trước/);
  assert.match(exportRange('2026-09-01T00:00', '2026-11-03T00:00', now).error, /31 ngày/);
  assert.match(exportRange('2026-12-01T00:00', '2026-12-02T00:00', now).error, /tương lai/);
  assert.match(exportRange('abc', '2026-11-03T09:00', now).error, /không hợp lệ/);
});

test('exportUrl sends timezone-aware ISO times and encodes device id', () => {
  const url = exportUrl('tank 1', new Date('2026-11-03T01:00:00Z'), new Date('2026-11-03T02:00:00Z'));
  assert.equal(url, '/api/v1/devices/tank%201/telemetry/export.csv?from=2026-11-03T01%3A00%3A00.000Z&to=2026-11-03T02%3A00%3A00.000Z');
});

test('filenameFrom reads Content-Disposition with fallback', () => {
  assert.equal(filenameFrom('attachment; filename="tank_20261103-0800_20261103-0900.csv"', 'x.csv'), 'tank_20261103-0800_20261103-0900.csv');
  assert.equal(filenameFrom(null, 'x.csv'), 'x.csv');
});
