async page => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // All requests are mocked in this browser; do not change the real tank reference.
  let online = true, mv = 246.56, clarity = 83.2, state = 'slight', old = false, saves = 0;
  let events = [], requestedWindows = [], recovered = false;
  await page.route('**/api/v1/devices/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const stamp = new Date(Date.now() - (old ? 120000 : 0)).toISOString();
    const row = { id: 1, measured_at: stamp, temperature_c: recovered ? 27 : null, ph: recovered ? 7 : null,
      turbidity_pct: null, turbidity_mv: mv, turbidity_reference_mv: 294,
      clarity_pct: clarity, clarity_state: state, clarity_mv: mv, clarity_baseline_at: events[0]?.created_at,
      signal_strength_dbm: -60, sensor_status: recovered ? 'normal' : 'error', sensor_health: { temperature: recovered, ph: recovered, clarity: mv !== null } };
    let data;
    if (path.endsWith('/settings')) {
      const values = { temperature_min_c: 22, temperature_max_c: 30, temperature_preset: 'custom', ph_min: 6.5, ph_max: 8.5,
        clear_min_pct: 90, cloudy_below_pct: 70, clear_recovery_above_pct: 93, cloudy_recovery_above_pct: 75,
        auto_hysteresis: true, alert_after_seconds: 1800, sensor_timeout_minutes: 0, sensitivity: 'standard', median_window: 15, ema_seconds: 20 };
      data = { device_id: 'clarity-browser-fixture', revision: 0, values, defaults: values };
    } else if (path.endsWith('/clarity/config')) {
      data = { clear_min_pct: 90, cloudy_below_pct: 70, clear_recovery_above_pct: 93, cloudy_recovery_above_pct: 75, alert_after_seconds: 1800 };
    } else if (path.endsWith('/clarity/baselines')) {
      if (route.request().method() === 'POST') {
        saves++;
        if (!route.request().postDataJSON().water_changed) throw new Error('Missing water-change flag');
        events = [{ id: 1, reference_mv: 294, created_at: stamp, water_changed: true }];
        return route.fulfill({ status: 201, json: events[0] });
      }
      data = events;
    } else if (path.endsWith('/telemetry/latest')) data = row;
    else if (path.endsWith('/telemetry/series')) {
      requestedWindows.push(new URL(route.request().url()).searchParams.get('minutes'));
      data = Array.from({ length: 481 }, (_, index) => ({ ...row, id: index,
        measured_at: new Date(Date.now() - (480 - index) * 180000).toISOString(),
        clarity_pct: clarity == null ? null : clarity + 10 * (480 - index) / 480 }));
    }
    else if (path.endsWith('/alerts')) data = recovered ? [] : [
      { id: 1, alert_type: 'sensor_error_temperature', severity: 'critical', message: 'Không có số đo hợp lệ: nhiệt độ.', started_at: new Date(Date.now() - 792 * 60000).toISOString(), ended_at: null },
      { id: 2, alert_type: 'sensor_error_ph', severity: 'critical', message: 'Không có số đo hợp lệ: pH.', started_at: stamp, ended_at: null },
    ];
    else if (path.endsWith('/thresholds')) data = { temperature_min_c: 22, temperature_max_c: 30, ph_min: 6.5, ph_max: 8.5, turbidity_warning_pct: 60, turbidity_critical_pct: 80 };
    else data = { id: 'clarity-browser-fixture', connectivity: online ? 'online' : 'offline', last_seen_at: stamp };
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5173/?device_id=clarity-browser-fixture');
  const card = page.locator('#turbidity-card');
  await card.getByText('HƠI ĐỤC', { exact: true }).waitFor();
  await page.getByText('⚠ Cảm biến 1/3 hoạt động', { exact: true }).waitFor();
  if (!(await page.locator('#alert-content').innerText()).includes('13 giờ 12 phút')) throw new Error('Duration must show hours and minutes');
  if (/độ đục/i.test(await page.locator('body').innerText())) throw new Error('Old terminology visible');
  if (!(await page.locator('#clarity-zones').textContent()).includes('≥90%')) throw new Error('Threshold text differs');
  if (await card.locator('.kpi-card__value small').textContent() !== '83%') throw new Error('Wrong clarity %');
  if (await card.locator('[data-probe-voltage]').isVisible()) throw new Error('Technical detail must collapse');
  await page.locator('#clarity-details-toggle').click();
  if (!await card.locator('[data-probe-voltage]').isVisible()) throw new Error('Details did not expand');
  await page.locator('#clarity-details-toggle').click();
  await card.locator('.status-badge').hover();
  if (!await page.locator('#clarity-tooltip').isVisible()) throw new Error('Missing tooltip');
  await page.locator('#set-clean-reference').click();
  await page.locator('#clarity-cancel').click();
  if (saves !== 0) throw new Error('Cancel saved a baseline');
  await page.locator('#set-clean-reference').click();
  await page.locator('#clarity-save').click();
  await page.getByText('Đã lưu mốc nước sạch', { exact: true }).waitFor();
  if (saves !== 1) throw new Error('Reference not saved exactly once');
  await page.locator('[data-range="10080"]').click();
  await page.waitForResponse(response => response.url().includes('series?minutes=1440'));
  if (!requestedWindows.includes('10080') || !requestedWindows.includes('1440')) throw new Error('Mini chart must keep its own 24-hour window');
  await page.screenshot({ path: 'output/playwright/clarity-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/clarity-mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) throw new Error('Mobile horizontal overflow');
  await page.getByText('Đã lưu mốc nước sạch', { exact: true }).waitFor({ state: 'hidden' });
  await card.screenshot({ path: 'output/playwright/clarity-card-mobile.png' });
  await page.locator('#clarity-details-toggle').click();
  await card.screenshot({ path: 'output/playwright/clarity-card-details.png' });
  const smallText = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el =>
    el.getClientRects().length && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())
    && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => el.textContent.slice(0, 60)));
  if (smallText.length) throw new Error(`Text below 12px: ${smallText.join(', ')}`);
  await page.setViewportSize({ width: 320, height: 700 });
  if (await card.evaluate(el => el.scrollWidth > el.clientWidth + 2)) throw new Error('Card overflow at 320px');
  await page.setViewportSize({ width: 390, height: 844 });
  recovered = true; await page.reload();
  await page.getByText('✓ Cảm biến 3/3 hoạt động', { exact: true }).waitFor();
  await page.getByText('Không có cảnh báo đang xảy ra', { exact: true }).waitFor();
  recovered = false;
  clarity = 96; state = 'clear'; await page.reload();
  await card.getByText('TRONG', { exact: true }).waitFor();
  clarity = 65; state = 'cloudy'; await page.reload();
  await card.getByText('ĐỤC', { exact: true }).waitFor();
  old = true; await page.reload();
  await card.getByText('Dữ liệu cũ · Chờ mẫu mới', { exact: true }).waitFor();
  if (!await page.locator('#set-clean-reference').isDisabled()) throw new Error('Stale reference button enabled');
  old = false; mv = clarity = null; await page.reload();
  await card.getByText('Độ trong chưa có mẫu hợp lệ', { exact: true }).waitFor();
  online = false; await page.reload();
  await card.getByText('Mất kết nối · Chờ mẫu mới', { exact: true }).waitFor();
  console.log('CLARITY_QA_PASS: states, relative %, baseline/save + event, 7 days, mobile, stale, missing, offline');
  return 'PASS: states, relative %, baseline/save + event, 7 days, mobile, stale, missing, offline';
}
