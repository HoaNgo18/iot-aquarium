import test from 'node:test';
import assert from 'node:assert/strict';
import { durationLabel, clarityRuleText, sensorSummary, clarityPresentation, temperaturePresentation, CLARITY_DISPLAY_MAX_PCT } from '../src/dashboard/presentation.js';
import { decodeReading } from '../src/dashboard/api.js';

test('duration uses hours and minutes', () => {
  assert.equal(durationLabel(792), '13 giờ 12 phút');
  assert.equal(durationLabel(60), '1 giờ 0 phút');
  assert.equal(durationLabel(59), '59 phút');
});

test('out-of-range clarity never claims clear or changes raw percent', () => {
  const row = { clarity: 445, clarityState: 'clear', clarityMv: 1308.3, turbidityReference: 294 };
  assert.equal(clarityPresentation(row).label, 'Ngoài dải đo');
  assert.equal(clarityPresentation(row).state, 'outside');
  assert.match(clarityPresentation(row).note, /4,5 lần/);
  assert.equal(row.clarity, 445);
  assert.equal(clarityPresentation({ clarity: CLARITY_DISPLAY_MAX_PCT }).outside, false);
  assert.equal(clarityPresentation({ clarity: CLARITY_DISPLAY_MAX_PCT + .01 }).outside, true);
  assert.equal(clarityPresentation(null).label, '--');
  assert.match(clarityPresentation({ clarity: 100, clarityState: 'clear' }).note, /mốc thử/);
  assert.doesNotMatch(clarityPresentation({ clarity: 110, clarityState: 'clear', clarityBaselineAt: 'set' }).note, /Gần mốc/);
  assert.equal(clarityPresentation({ clarity: 84, clarityState: 'slight' }).label, 'HƠI ĐỤC');
});

test('temperature explains the actual configured limit without inventing a critical threshold', () => {
  const thresholds = { tempMin: 22, tempMax: 30 };
  assert.equal(temperaturePresentation(32.6, thresholds).badge, 'Cao hơn ngưỡng 30 °C');
  assert.match(temperaturePresentation(32.6, thresholds).note, /22–30/);
  assert.equal(temperaturePresentation(30, thresholds).badge, 'Trong khoảng đã đặt');
  assert.match(temperaturePresentation(20, thresholds).badge, /Thấp hơn ngưỡng 22/);
  assert.match(temperaturePresentation(32.6, { ...thresholds, tempMax: 32 }).badge, /32 °C/);
});

test('all labels follow server configuration, including recovery boundaries', () => {
  const rules = { clear_min_pct: 90, cloudy_below_pct: 70,
    clear_recovery_above_pct: 93, cloudy_recovery_above_pct: 75 };
  assert.equal(clarityRuleText(rules).zones, 'Trong ≥90% · Hơi đục 70–<90% · Đục <70%');
  assert.match(clarityRuleText(rules).recovery, />75%/);
  assert.match(clarityRuleText(rules).recovery, />93%/);
  assert.match(clarityRuleText({ ...rules, clear_min_pct: 85 }).zones, /≥85%/);
});

test('header reads independent health, not connectivity or legacy percent', () => {
  const now = Date.now();
  const row = decodeReading({ measured_at: new Date(now).toISOString(), turbidity_pct: null,
    sensor_health: { temperature: false, ph: false, clarity: true } });
  assert.equal(sensorSummary(row, true, now).count, 1);
  assert.equal(sensorSummary(row, false, now).count, null);
  assert.equal(sensorSummary(row, true, now + 60000).count, null);
  assert.equal(sensorSummary({ ...row, sensorHealth: { temperature: true, ph: true, clarity: true } }, true, now).count, 3);
});
