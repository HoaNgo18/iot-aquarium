async page => {
  const settings = await (await page.request.get('http://127.0.0.1:8000/api/v1/devices/tank-ds18b20-001/settings')).json();
  let online = true, clarity = 445, baseline = false, ph = null;
  await page.route('**/api/v1/devices/**', async route => {
    const path = new URL(route.request().url()).pathname, now = Date.now();
    const row = { measured_at: new Date(now - (online ? 0 : 7200000)).toISOString(), temperature_c: 32.6,
      ph, ph_mv: 1231, turbidity_pct: null, turbidity_mv: 1310, turbidity_reference_mv: 294,
      clarity_mv: clarity * 2.94, clarity_pct: clarity, clarity_state: clarity >= 90 ? 'clear' : 'slight',
      clarity_baseline_at: baseline ? new Date(now-86400000).toISOString() : null,
      signal_strength_dbm: -55, sensor_health: { temperature: true, ph: true, clarity: true } };
    let body;
    if (path.endsWith('/settings')) body = settings;
    else if (path.endsWith('/clarity/config')) body = settings.values;
    else if (path.endsWith('/clarity/baselines')) body = baseline ? [{ created_at: row.clarity_baseline_at, reference_mv: 294, water_changed: true }] : [];
    else if (path.endsWith('/settings/history') || path.endsWith('/alerts')) body = [];
    else if (path.endsWith('/thresholds')) body = settings.values;
    else if (path.endsWith('/telemetry/latest')) body = row;
    else if (path.endsWith('/telemetry/last-valid')) body = { temperature: row, ph: row, clarity: row };
    else if (path.endsWith('/telemetry/series')) body = Array.from({ length: 24 }, (_, i) => ({ ...row,
      measured_at: new Date(+new Date(row.measured_at) - (23-i)*5000).toISOString() }));
    else body = { id: 'card-safety', connectivity: online ? 'online' : 'offline', last_seen_at: row.measured_at };
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('http://127.0.0.1:5173/?device_id=card-safety');
  const clarityCard = page.locator('#turbidity-card'), phCard = page.locator('#ph-card');
  await clarityCard.locator('[data-value]').getByText('Ngoài dải đo', { exact: true }).waitFor();
  if ((await clarityCard.innerText()).includes('Gần mốc')) throw new Error('Outlier says near reference');
  if ((await clarityCard.locator('.kpi-card__value').innerText()).includes('445')) throw new Error('Outlier percent remains primary');
  await page.locator('#temperature-card .status-badge').getByText('Cao hơn ngưỡng 30 °C', { exact: true }).waitFor();
  if ((await page.locator('#temperature-card [data-trend]').innerText()).includes('Hoạt động')) throw new Error('Warning says working');
  await phCard.getByText('Chưa hiệu chuẩn, chưa có số pH', { exact: true }).waitFor();
  const badgeStyles = await page.locator('#ph-card .status-badge, #turbidity-card .status-badge').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).backgroundColor));
  if (badgeStyles[0] !== badgeStyles[1]) throw new Error('Calibration badges differ');
  await page.locator('#clarity-details-toggle').click();
  await page.locator('#clarity-detail-value').getByText('445%', { exact: true }).waitFor();
  if (!(await page.locator('#clarity-filtered-voltage').innerText()).includes('1308,3')) throw new Error('Filtered voltage missing');
  await page.locator('#clarity-details-toggle').click();
  const desktopResults = [];
  for (const width of [1920, 1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    const boxes = await page.locator('.kpi-grid > .kpi-card').evaluateAll(nodes => nodes.map(el => {
      const r = el.getBoundingClientRect(); return { width: r.width, height: r.height, y: r.y, overflow: el.scrollWidth > el.clientWidth + 2 };
    }));
    if (boxes.some(b => b.overflow)) throw new Error(`Card overflow ${width}`);
    for (const key of ['width', 'height', 'y']) if (Math.max(...boxes.map(b => b[key])) - Math.min(...boxes.map(b => b[key])) > 1) throw new Error(`Unequal ${key}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+2)) throw new Error('Horizontal overflow');
    desktopResults.push({ width, boxes });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'output/playwright/card-safety-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+2)) throw new Error('Mobile overflow');
  await page.screenshot({ path: 'output/playwright/card-safety-mobile.png', fullPage: true });
  online = false; await page.reload();
  await clarityCard.locator('[data-value]').getByText('Ngoài dải đo', { exact: true }).waitFor();
  if (!(await clarityCard.locator('[data-trend]').innerText()).includes('mất kết nối')) throw new Error('Missing stale timestamp');
  online = true; clarity = 84; baseline = true; await page.reload();
  await clarityCard.locator('[data-value]').getByText('HƠI ĐỤC', { exact: true }).waitFor();
  if (await clarityCard.locator('[data-clarity-warning]').isVisible()) throw new Error('Warning did not clear');
  ph = 7.1; await page.reload();
  await phCard.locator('[data-value]').getByText('7,1', { exact: true }).waitFor();
  if (await phCard.locator('[data-ph-pending]').isVisible()) throw new Error('Calibrated pH still pending');
  return { status: 'PASS', desktopResults };
}
