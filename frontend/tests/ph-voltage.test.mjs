import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReading, metricStatus } from '../src/dashboard/api.js';
import { phReading, readingState } from '../src/dashboard/reading-state.js';
import { sensorSummary } from '../src/dashboard/presentation.js';

test('raw pH signal never becomes a pH number or a pH threshold warning', () => {
  const row = decodeReading({ measured_at: new Date().toISOString(), ph: null, ph_mv: 1275,
    sensor_health: { temperature: false, ph: true, clarity: false } });
  assert.equal(row.ph, null);
  assert.equal(row.phVoltage, 1275);
  assert.equal(metricStatus('phVoltage', row.phVoltage, { phMin: 6.5, phMax: 8.5 }), 'uncalibrated');
  assert.match(sensorSummary(row, true).detail, /pH đã nhận tín hiệu, chưa hiệu chuẩn/);
});

test('new raw pH replaces old calibrated value, retains timestamp while offline', () => {
  const old = { time: new Date(Date.now() - 10000), ph: 7, phVoltage: 1250 };
  const fresh = { time: new Date(), ph: null, phVoltage: 1275 };
  const selected = phReading([old, fresh, null]);
  assert.equal(selected.row, fresh);
  assert.equal(selected.metric, 'phVoltage');
  assert.equal(readingState(selected.metric, fresh, selected.row, false).kind, 'stale');
  assert.equal(phReading([{ ...fresh, ph: 7.2 }]).metric, 'ph');
  assert.equal(phReading([null]).row, null);
});
