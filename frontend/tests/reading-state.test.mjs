import test from 'node:test';
import assert from 'node:assert/strict';
import { lastKnownReading, readingState, elapsedLabel } from '../src/dashboard/reading-state.js';
import { compressedTimeline } from '../src/dashboard/chart-layout.js';
test('disconnect preserves the last valid reading, never becomes a live reading', () => {
  const now = Date.now(), row = { time: new Date(now - 7200000), clarity: 84, clarityState: 'slight' };
  const known = lastKnownReading('clarity', [null, row, { time: new Date(now), clarity: null }]);
  assert.equal(readingState('clarity', null, known, false, now).kind, 'stale');
  assert.equal(readingState('clarity', null, known, false, now).row.clarity, 84);
  assert.equal(readingState('ph', null, null, false, now).kind, 'never');
  assert.equal(readingState('clarity', { ...row, time: new Date(now) }, known, true, now).kind, 'live');
  assert.equal(elapsedLabel(row.time, now), '2 giờ');
});
test('the newest valid sensor value wins across historical sources', () => {
  const one = { time: new Date(1000), ph: 7 }, two = { time: new Date(2000), ph: 0 };
  assert.equal(lastKnownReading('ph', [one, two]).ph, 0);
});
test('chart leaves an explicit trailing no-data interval without adding measurements', () => {
  const rows = [{ time: new Date(1000), clarity: 84 }, { time: new Date(2000), clarity: 83 }];
  const result = compressedTimeline(rows, 'clarity', 5000, 50000);
  assert.equal(result.data.length, 2);
  assert.equal(+result.tail.from, 2000);
  assert.ok(result.positions.at(-1) < result.span);
  assert.equal(result.position(new Date(50000)), result.span);
});
