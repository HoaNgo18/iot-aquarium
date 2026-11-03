import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReading, metricStatus, signalReduction } from '../src/dashboard/api.js';

test('signal reduction is not a calibrated turbidity percentage', () => {
  assert.equal(signalReduction(294, 294), 0);
  assert.ok(Math.abs(signalReduction(246.56, 294) - 16.136) < 0.001);
  assert.ok(signalReduction(300, 294) < 0);
  for (const mv of [null, undefined, NaN, 142, 3001]) assert.equal(signalReduction(mv, 294), null);
  for (const ref of [null, 0, 142, NaN, 3001]) assert.equal(signalReduction(291, ref), null);
  assert.equal(metricStatus('turbidityChange', 16, {}), 'uncalibrated');
});

test('raw voltage stays separate from percent and never labels water safe', () => {
  const row = decodeReading({ measured_at: '2026-10-25T00:00:00Z',
    turbidity_pct: null, turbidity_mv: 291, turbidity_reference_mv: 294 });
  assert.equal(row.turbidity, null);
  assert.equal(row.turbidityVoltage - row.turbidityReference, -3);
  assert.equal(metricStatus('turbidityVoltage', 291, {}), 'uncalibrated');
  assert.equal(metricStatus('turbidityVoltage', null, {}), 'neutral');
});

test('legacy payload has no invented voltage', () => {
  const row = decodeReading({ measured_at: '2026-10-25T00:00:00Z', turbidity_pct: 20 });
  assert.equal(row.turbidity, 20);
  assert.equal(row.turbidityVoltage, null);
  assert.equal(row.turbidityReference, null);
});
