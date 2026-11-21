export default async page => {
  const values = { temperature_min_c: 22, temperature_max_c: 30, temperature_preset: 'custom', ph_min: 6.5, ph_max: 8.5,
    clear_min_pct: 90, cloudy_below_pct: 70, clear_recovery_above_pct: 93, cloudy_recovery_above_pct: 75, auto_hysteresis: true,
    alert_after_seconds: 1800, sensor_timeout_minutes: 0, sensitivity: 'standard', median_window: 15, ema_seconds: 20 };
  let mode = 'normal';
  const stamp = (minutes = 0) => new Date(Date.now() - minutes * 60000).toISOString();
  const reading = (minutes = 0, healthy = true) => ({ id: 1, device_id: 'tank-metric', sequence: 1, measured_at: stamp(minutes), received_at: stamp(minutes),
    temperature_c: 24.1, ph: 7.8, ph_mv: 1280, turbidity_mv: 1475, turbidity_reference_mv: 1608,
    clarity_mv: 1475, clarity_pct: 92, clarity_state: 'clear', clarity_baseline_at: mode === 'uncalibrated' ? null : stamp(120),
    signal_strength_dbm: -51, sensor_status: healthy ? 'normal' : 'error',
    sensor_health: { temperature: healthy, ph: healthy, clarity: healthy } });
  await page.routeWebSocket('**/ws*', socket => socket.onMessage(message => { if (message === 'ping') socket.send('{"type":"pong"}'); }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const reply = json => route.fulfill({ status: 200, json });
    if (path === '/auth/me') return reply({ id: 1, username: 'qa', display_name: 'Kiểm tra' });
    if (path === '/reminders') return reply([]);
    if (path === '/tanks') return reply([{ id: 1, name: 'Bể kiểm tra', device_id: 'tank-metric', connectivity: mode === 'offline' ? 'offline' : 'online',
      last_seen_at: mode === 'offline' ? stamp(10) : stamp(), open_alerts: 0, latest: reading(mode === 'offline' ? 10 : 0, mode !== 'error') }]);
    const match = /^\/devices\/tank-metric(.*)$/.exec(path);
    if (!match) return route.fulfill({ status: 404, json: { detail: `Unexpected ${path}` } });
    const suffix = match[1];
    const current = reading(mode === 'offline' ? 10 : 0, mode !== 'error');
    const known = reading(mode === 'offline' ? 10 : 2, true);
    if (!suffix) return reply({ id: 'tank-metric', connectivity: mode === 'offline' ? 'offline' : 'online', sensor_status: mode === 'error' ? 'error' : 'normal', last_seen_at: mode === 'offline' ? stamp(10) : stamp() });
    if (suffix.startsWith('/alerts')) return reply([]);
    if (suffix === '/telemetry/latest') return reply(current);
    if (suffix === '/telemetry/last-valid') return reply({ temperature: known, ph: known, clarity: known });
    if (suffix.startsWith('/telemetry/series')) return reply(Array.from({ length: 24 }, (_, index) => ({ ...known, id: index + 1, measured_at: stamp(25 - index) })));
    if (suffix === '/thresholds') return reply({ ...values, turbidity_warning_pct: 45, turbidity_critical_pct: 70 });
    if (suffix === '/clarity/config') return reply(values);
    if (suffix === '/clarity/baselines') return reply(mode === 'uncalibrated' ? [] : [{ id: 1, reference_mv: 1608, created_at: stamp(120) }]);
    if (suffix === '/settings/history') return reply([]);
    if (suffix === '/settings') return reply({ device_id: 'tank-metric', revision: 1, values, defaults: values });
    return route.fulfill({ status: 404, json: { detail: `Unexpected ${path}` } });
  });

  const open = async (nextMode, theme, width, height, file) => {
    mode = nextMode;
    await page.setViewportSize({ width, height });
    if (page.url() === 'about:blank') await page.goto('http://127.0.0.1:5173/#/tank/tank-metric');
    await page.evaluate(preference => localStorage.setItem('aquasense-theme', preference), theme);
    await page.reload();
    await page.locator('#turbidity-card [data-value]').waitFor();
    const expected = { normal: 'Bình thường', uncalibrated: 'Chưa hiệu chỉnh', offline: 'Mất kết nối', error: 'Lỗi cảm biến' }[nextMode];
    for (const id of ['temperature', 'ph', 'turbidity']) {
      const badge = page.locator(`#${id}-card .status-badge`);
      await badge.filter({ hasText: nextMode === 'uncalibrated' && id !== 'turbidity' ? 'Bình thường' : expected }).waitFor();
    }
    const cards = await page.locator('.kpi-grid > .kpi-card').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    if (width >= 1024 && Math.max(...cards) - Math.min(...cards) > 1) throw new Error(`Metric cards have unequal heights: ${cards}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error(`Horizontal overflow at ${width}px`);
    await page.screenshot({ path: `output/playwright/task-11/${file}`, fullPage: width < 1024 });
  };

  await open('normal', 'light', 1366, 768, 'normal-light-desktop.png');
  await open('uncalibrated', 'light', 1366, 768, 'uncalibrated-light-desktop.png');
  await page.locator('[data-calibrate-clarity]').click();
  await page.locator('#settings-panel-clarity:not([hidden])').waitFor();
  await page.locator('#settings-probe-voltage').filter({ hasText: 'mV' }).waitFor();
  await page.locator('#settings-close').click();
  await open('offline', 'dark', 1366, 768, 'offline-dark-desktop.png');
  await open('error', 'dark', 1366, 768, 'sensor-error-dark-desktop.png');
  await open('normal', 'dark', 390, 844, 'normal-dark-mobile.png');
  await open('uncalibrated', 'dark', 390, 844, 'uncalibrated-dark-mobile.png');
  await open('offline', 'light', 390, 844, 'offline-light-mobile.png');
  await open('error', 'light', 390, 844, 'sensor-error-light-mobile.png');
  return { passed: true, screenshots: 8, states: ['normal', 'uncalibrated', 'offline', 'error'], viewports: ['1366x768', '390x844'], themes: ['light', 'dark'] };
}
