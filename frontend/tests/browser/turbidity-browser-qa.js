async page => {
  // Browser-only fixtures: never publish fabricated readings to the live database.
  const stamp = new Date().toISOString();
  let online = true, mv = 291;
  await page.route('**/api/v1/devices/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const row = { id: 1, measured_at: stamp, temperature_c: null, ph: null,
      turbidity_pct: null, turbidity_mv: mv, turbidity_reference_mv: 294,
      signal_strength_dbm: -60, sensor_status: 'error' };
    let data;
    if (path.endsWith('/telemetry/latest')) data = row;
    else if (path.endsWith('/telemetry')) data = [row, { ...row, id: 2, measured_at: new Date(Date.now() + 1000).toISOString() }];
    else if (path.endsWith('/alerts')) data = [];
    else if (path.endsWith('/thresholds')) data = { temperature_min_c: 22, temperature_max_c: 30, ph_min: 6.5, ph_max: 8.5, turbidity_warning_pct: 60, turbidity_critical_pct: 80 };
    else data = { id: 'voltage-browser-fixture', connectivity: online ? 'online' : 'offline', last_seen_at: stamp };
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5173/?device_id=voltage-browser-fixture');
  const card = page.locator('#turbidity-card');
  await card.getByText('Tín hiệu giảm 1,0% so với mẫu nước', { exact: true }).waitFor();
  if (await card.locator('[data-value]').textContent() !== '1,0') throw new Error('Wrong signal reduction');
  if (await card.locator('[data-probe-voltage]').isVisible()) throw new Error('Technical voltage should be collapsed');
  await card.getByText('Chưa hiệu chuẩn', { exact: true }).waitFor();
  await page.locator('#metric-select').selectOption('turbidityChange');
  if (await page.getByText('Vùng an toàn', { exact: true }).isVisible()) throw new Error('Raw voltage must not have safe zone');
  await page.screenshot({ path: 'output/playwright/turbidity-voltage.png', fullPage: true });
  mv = null;
  await page.reload();
  await card.getByText('Ngoài dải đo hoặc chưa có mẫu hợp lệ', { exact: true }).waitFor();
  if (await card.locator('[data-value]').textContent() !== '--') throw new Error('Invalid voltage rendered as number');
  online = false;
  await page.reload();
  await card.getByText('Offline · Không có số đo trực tiếp', { exact: true }).waitFor();
  return 'PASS: mV, reference/delta, uncalibrated badge, raw chart without safety thresholds, missing and offline';
}
