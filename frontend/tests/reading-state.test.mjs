import test from 'node:test';
import assert from 'node:assert/strict';
import { lastKnownReading, readingState, elapsedLabel, phReading, metricCardStatus } from '../src/dashboard/reading-state.js';
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

test('sensor health overrides numeric values for all sensor cards',()=>{
 const now=Date.now(),time=new Date(now),latest={time,temperature:27,ph:7,phVoltage:1250,clarity:90,sensorHealth:{temperature:false,ph:false,clarity:false}},known={...latest,time:new Date(now-120000),sensorHealth:{temperature:true,ph:true,clarity:true}};
 for(const metric of ['temperature','ph','phVoltage','clarity']){
  assert.equal(readingState(metric,latest,known,true,now).kind,'stale');
  assert.equal(lastKnownReading(metric,[latest,known]),known);
 }
 assert.equal(phReading([latest,known]).row,known);
});

test('all metric cards use the same five user-facing statuses', () => {
  const cases = [
    [{ readingKind: 'live', sensorHealthy: true, calibrated: true, thresholdStatus: 'normal' }, 'Bình thường'],
    [{ readingKind: 'live', sensorHealthy: true, calibrated: true, thresholdStatus: 'warning' }, 'Cần chú ý'],
    [{ readingKind: 'stale', sensorHealthy: true, calibrated: true, thresholdStatus: 'normal' }, 'Mất kết nối'],
    [{ readingKind: 'live', sensorHealthy: false, calibrated: true, thresholdStatus: 'normal' }, 'Lỗi cảm biến'],
    [{ readingKind: 'live', sensorHealthy: true, calibrated: false, thresholdStatus: 'normal' }, 'Chưa hiệu chỉnh'],
  ];
  for (const metric of ['temperature', 'ph', 'clarity']) {
    for (const [input, expected] of cases) {
      assert.equal(metricCardStatus({ metric, ...input }).label, expected, `${metric}: ${expected}`);
    }
  }
});
