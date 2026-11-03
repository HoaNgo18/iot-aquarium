async page => {
  const response = await page.request.get('http://127.0.0.1:8000/api/v1/devices/tank-ds18b20-001/settings');
  const settings = await response.json();
  let sparse = false;
  await page.route('**/api/v1/devices/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const now = Date.now();
    const reading = { measured_at: new Date(now).toISOString(), temperature_c: null, ph: null, turbidity_pct: null,
      turbidity_mv: 244, turbidity_reference_mv: 294, clarity_pct: 83, clarity_mv: 244, clarity_state: 'slight',
      sensor_health: { temperature: false, ph: false, clarity: true }, signal_strength_dbm: -58 };
    let body;
    if (path.endsWith('/settings')) body = settings;
    else if (path.endsWith('/clarity/config')) body = settings.values;
    else if (path.endsWith('/settings/history') || path.endsWith('/clarity/baselines')) body = [];
    else if (path.endsWith('/thresholds')) body = { ...settings.values, turbidity_warning_pct: 60, turbidity_critical_pct: 80 };
    else if (path.endsWith('/telemetry/latest')) body = reading;
    else if (path.endsWith('/telemetry/series')) body = (sparse ? [0] : [-12*3600000, -12*3600000+180000, -180000, 0]).map(offset => ({ ...reading, measured_at: new Date(now + offset).toISOString() }));
    else if (path.endsWith('/alerts')) body = Array.from({ length: 5 }, (_, id) => ({ id, alert_type: 'sensor_error_ph', severity: 'critical', message: `Lỗi cảm biến số ${id + 1}`, started_at: new Date(now - id*60000).toISOString(), ended_at: null }));
    else body = { id: 'layout-fixture', connectivity: 'online', last_seen_at: reading.measured_at };
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('http://127.0.0.1:5173/?device_id=layout-fixture');
  await page.getByText('HƠI ĐỤC', { exact: true }).waitFor();
  for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, vh: innerHeight, vw: innerWidth }));
    if (size.h > size.vh + 2 || size.w > size.vw + 2) throw new Error(`Desktop overflow ${width}: ${JSON.stringify(size)}`);
  }
  if (await page.locator('#device-card').count()) throw new Error('Device card remains');
  if (await page.locator('#alert-content .alert-item').count() !== 2) throw new Error('Compact screen should show two alerts');
  if (!await page.locator('#metric-select option[value="temperature"]').evaluate(option => option.disabled)) throw new Error('Empty metric enabled');
  if (!(await page.locator('#chart-gaps').innerText()).includes('Không có dữ liệu')) throw new Error('Gap not annotated');
  await page.locator('#connection-pill').click();
  await page.getByText('-58 dBm', { exact: true }).waitFor();
  await page.locator('#device-info').getByRole('button', { name: 'Đóng' }).click();
  await page.locator('#alerts-toggle').click();
  if (await page.locator('#all-alerts-content .alert-item').count() !== 5) throw new Error('All alerts missing');
  await page.locator('#all-alerts').getByRole('button', { name: 'Đóng' }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'output/playwright/layout-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (!await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)) throw new Error('Mobile should scroll');
  await page.screenshot({ path: 'output/playwright/layout-mobile.png', fullPage: true });
  sparse = true; await page.reload();
  await page.getByText('Đang thu thập dữ liệu', { exact: true }).waitFor();
  return 'PASS: desktop fits at 1024/1366/1440, mobile scrolls, gap annotation, alerts and WiFi details, sparse data';
}
