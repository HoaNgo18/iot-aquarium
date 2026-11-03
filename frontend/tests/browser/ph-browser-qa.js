async page => {
  const settings = await (await page.request.get('http://127.0.0.1:8000/api/v1/devices/tank-ds18b20-001/settings')).json();
  let online = true, calibrated = false, missing = false;
  await page.route('**/api/v1/devices/**', async route => {
    const path = new URL(route.request().url()).pathname, now = Date.now();
    const reading = { measured_at: new Date(now - (online ? 0 : 7200000)).toISOString(),
      ph: calibrated ? 7.1 : null, ph_mv: 1275, temperature_c: null, turbidity_pct: null,
      signal_strength_dbm: -55, sensor_health: { temperature: false, ph: true, clarity: false } };
    let body;
    if (path.endsWith('/settings')) body = settings;
    else if (path.endsWith('/clarity/config')) body = settings.values;
    else if (path.endsWith('/settings/history') || path.endsWith('/clarity/baselines') || path.endsWith('/alerts')) body = [];
    else if (path.endsWith('/thresholds')) body = { ...settings.values };
    else if (path.endsWith('/telemetry/latest')) body = missing ? { ...reading, ph: null, ph_mv: null } : reading;
    else if (path.endsWith('/telemetry/last-valid')) body = { temperature: null, clarity: null, ph: reading };
    else if (path.endsWith('/telemetry/series')) body = Array.from({ length: 24 }, (_, i) => ({ ...reading,
      measured_at: new Date(+new Date(reading.measured_at) - (23-i)*5000).toISOString(), ph_mv: 1270 + i % 6 }));
    else body = { id: 'ph-fixture', connectivity: online ? 'online' : 'offline', last_seen_at: reading.measured_at };
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('http://127.0.0.1:5173/?device_id=ph-fixture');
  const card = page.locator('#ph-card');
  await card.getByText('1275', { exact: true }).waitFor();
  await card.getByText('Chưa hiệu chuẩn', { exact: true }).waitFor();
  if (await card.locator('[data-ph-unit]').textContent() !== 'mV') throw new Error('Missing mV unit');
  if (!(await card.innerText()).includes('chưa phải số pH')) throw new Error('Voltage presented as pH');
  await page.locator('#metric-select').selectOption('phVoltage');
  if (!(await page.locator('#metric-legend').innerText()).includes('GPIO34')) throw new Error('Wrong chart unit');
  if (!await page.locator('#metric-select option[value="ph"]').evaluate(el => el.disabled)) throw new Error('Uncalibrated pH chart enabled');
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2 || document.documentElement.scrollHeight > innerHeight + 2)) throw new Error('Desktop overflow');
  }
  await page.screenshot({ path: 'output/playwright/ph-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('Mobile overflow');
  await page.screenshot({ path: 'output/playwright/ph-mobile.png', fullPage: true });
  online = false; await page.reload();
  await card.getByText('1275', { exact: true }).waitFor();
  if (!(await card.locator('[data-trend]').innerText()).includes('mất kết nối')) throw new Error('Offline pH lost timestamp');
  online = true; missing = true; await page.reload();
  await card.getByText('1275', { exact: true }).waitFor();
  if (!(await card.locator('[data-trend]').innerText()).includes('mất tín hiệu')) throw new Error('Signal failure not distinguished');
  missing = false; calibrated = true; await page.reload();
  await card.getByText('7,1', { exact: true }).waitFor();
  if (await card.locator('[data-ph-note]').isVisible()) throw new Error('Calibration note left on calibrated pH');
  return 'PASS: raw mV, no invented pH, voltage chart, offline/invalid retention, calibrated mode, desktop/mobile';
}
