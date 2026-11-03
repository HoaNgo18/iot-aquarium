import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, autoRecovery } from '../src/dashboard/settings-domain.js';
const defaults = { temperature_min_c: 22, temperature_max_c: 30, ph_min: 6.5, ph_max: 8.5,
  clear_min_pct: 90, cloudy_below_pct: 70, clear_recovery_above_pct: 93, cloudy_recovery_above_pct: 75,
  sensor_timeout_minutes: 0, median_window: 15, ema_seconds: 20, alert_after_seconds: 1800 };
test('settings reject crossed ranges and recovery boundaries', () => {
  assert.deepEqual(validateSettings(defaults), {});
  for (const [key, value] of [['temperature_min_c', 30], ['ph_max', 6], ['cloudy_below_pct', 91],
    ['cloudy_recovery_above_pct', 95], ['clear_recovery_above_pct', 90], ['median_window', 14], ['ema_seconds', NaN]]) {
    assert.ok(Object.keys(validateSettings({ ...defaults, [key]: value })).length, key);
  }
});
test('automatic recovery maintains ordered thresholds near limits', () => {
  assert.equal(autoRecovery(defaults).cloudy_recovery_above_pct, 75);
  const high = autoRecovery({ ...defaults, clear_min_pct: 97, cloudy_below_pct: 94 });
  assert.equal(high.clear_recovery_above_pct, 100);
  assert.equal(high.cloudy_recovery_above_pct, 96);
  assert.deepEqual(validateSettings(high), {});
});
