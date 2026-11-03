async page => {
  const checks = [];
  const ensure = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  let failure = false, saveFailure = false, pendingPut = null, acknowledged = false;
  let limits = { temperature_min_c: 22, temperature_max_c: 30, ph_min: 6.5, ph_max: 8.5, turbidity_warning_pct: 60, turbidity_critical_pct: 80 };
  const stamp = new Date().toISOString();
  const reading = { id: 2, measured_at: stamp, temperature_c: 27, ph: null, turbidity_pct: 85, signal_strength_dbm: -57 };
  await page.route('**/api/v1/devices/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (failure || req.method() === 'PUT' && saveFailure) return route.fulfill({ status: 503, json: {} });
    if (path.includes('tank-preview-001')) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ status: path.endsWith('/telemetry') || path.endsWith('/alerts') ? 200 : 404, json: [] });
    }
    let data;
    if (path.endsWith('/thresholds')) {
      if (req.method() === 'PUT') { pendingPut = req.postDataJSON(); limits = pendingPut; }
      data = limits;
    } else if (path.endsWith('/telemetry/latest')) data = reading;
    else if (path.endsWith('/telemetry')) data = [{ ...reading, id: 1, measured_at: new Date(Date.now() - 30000).toISOString(), temperature_c: 26 }, reading];
    else if (path.endsWith('/acknowledge')) { acknowledged = true; data = {}; }
    else if (path.endsWith('/alerts')) data = [{ id: 42, alert_type: 'turbidity', severity: 'critical', message: 'Độ đục 85%', started_at: stamp, ended_at: null, acknowledged_at: acknowledged ? stamp : null }];
    else data = { id: 'tank-demo-001', connectivity: 'online', last_seen_at: stamp };
    await route.fulfill({ status: 200, json: data });
  });
  try {
    await page.reload();
    await page.locator('#temperature-card [data-value]').filter({ hasText: '27,0' }).waitFor();
    ensure(await page.locator('#ph-card [data-value]').innerText() === '--', 'null sensor stays --');
    ensure(await page.locator('#turbidity-card').getAttribute('data-status') === 'danger', 'critical KPI uses server thresholds');
    await page.locator('[name=tempMin]').fill('');
    ensure(await page.locator('#save-thresholds').isDisabled(), 'empty field cannot save');
    await page.locator('[name=tempMin]').fill('23');
    saveFailure = true;
    await page.locator('#save-thresholds').click();
    await page.getByText('Không lưu được ngưỡng', { exact: true }).waitFor();
    ensure(await page.locator('#unsaved-badge').isVisible(), 'save failure retains draft');
    saveFailure = false;
    await page.locator('#save-thresholds').click();
    await page.getByText('Đã lưu ngưỡng', { exact: true }).waitFor();
    ensure(pendingPut?.temperature_min_c === 23 && Object.keys(pendingPut).length === 6, 'PUT sends exact six backend fields');
    await page.locator('[data-ack]').click();
    await page.getByText('Đã xác nhận', { exact: true }).waitFor();
    ensure(acknowledged, 'ack uses server endpoint');
    failure = true;
    await page.locator('#refresh-button').click();
    await page.locator('#chart-state').filter({ hasText: '503' }).waitFor();
    ensure(await page.locator('#temperature-card [data-value]').innerText() === '--', 'API error clears live KPI');
    failure = false;
    await page.locator('#refresh-button').click();
    await page.locator('#temperature-card [data-value]').filter({ hasText: '27,0' }).waitFor();
    await page.locator('#device-select').selectOption('tank-preview-001');
    await page.locator('#device-select').selectOption('tank-demo-001');
    await page.locator('#temperature-card [data-value]').filter({ hasText: '27,0' }).waitFor();
    await page.waitForTimeout(800);
    ensure(await page.locator('#temperature-card [data-value]').innerText() === '27,0', 'late old-device responses ignored');
    await page.setViewportSize({ width: 390, height: 844 });
    ensure(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile has no horizontal overflow');
    await page.locator('#save-thresholds').scrollIntoViewIfNeeded();
    ensure(await page.locator('#save-thresholds').isVisible(), 'bottom form reachable');
    return checks;
  } finally {
    await page.unroute('**/api/v1/devices/**');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
  }
}
