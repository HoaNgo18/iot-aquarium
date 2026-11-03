async page => {
  const settings = await (await page.request.get('http://127.0.0.1:8000/api/v1/devices/tank-ds18b20-001/settings')).json();
  let online = false, invalid = false;
  await page.route('**/api/v1/devices/**', async route => {
    const path = new URL(route.request().url()).pathname, now = Date.now(), lastAt = now - 7260000;
    const old = { measured_at: new Date(lastAt).toISOString(), temperature_c: null, ph: null, turbidity_pct: null,
      turbidity_mv: 247, turbidity_reference_mv: 294, clarity_mv: 247, clarity_pct: 84, clarity_state: 'slight', signal_strength_dbm: -58,
      sensor_health: { temperature: false, ph: false, clarity: true } };
    const latest = online ? { ...old, measured_at: new Date(now).toISOString(), temperature_c: 27.4,
      ...(invalid ? { turbidity_mv: null, clarity_pct: null, clarity_state: null } : {}) } : { ...old };
    let body;
    if (path.endsWith('/settings')) body = settings;
    else if (path.endsWith('/settings/history') || path.endsWith('/clarity/baselines')) body = [];
    else if (path.endsWith('/clarity/config')) body = settings.values;
    else if (path.endsWith('/thresholds')) body = { ...settings.values, turbidity_warning_pct: 60, turbidity_critical_pct: 80 };
    else if (path.endsWith('/telemetry/latest')) body = latest;
    else if (path.endsWith('/telemetry/last-valid')) body = { clarity: online && !invalid ? latest : old,
      temperature: online ? latest : { ...old, temperature_c: 27.4, measured_at: new Date(now - 28800000).toISOString() }, ph: null };
    else if (path.endsWith('/telemetry/series')) body = Array.from({ length: 233 }, (_, i) => ({ ...old,
      clarity_pct: 82 + i / 116, measured_at: new Date(lastAt - (232-i)*180000).toISOString() }));
    else if (path.endsWith('/alerts')) body = [
      ...(!online ? [{ id: 1, alert_type: 'offline', severity: 'warning', message: 'Thiết bị mất kết nối. Không có số đo mới từ các cảm biến.', started_at: new Date(lastAt + 60000).toISOString(), ended_at: null }] : []),
      ...(!online || invalid ? [{ id: 2, alert_type: 'sensor_error_clarity', severity: 'critical', message: 'Không có số đo hợp lệ: độ trong.', started_at: new Date(lastAt + 60000).toISOString(), ended_at: null }] : [])
    ];
    else body = { id: 'offline-fixture', connectivity: online ? 'online' : 'offline', last_seen_at: online ? new Date(now).toISOString() : old.measured_at };
    await route.fulfill({ json: body });
  });
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('http://127.0.0.1:5173/?device_id=offline-fixture');
  const card = page.locator('#turbidity-card');
  await card.getByText('HƠI ĐỤC', { exact: true }).waitFor();
  check(await card.locator('.kpi-card__value small').textContent() === '84%', 'Last clarity value disappeared');
  check(await card.evaluate(el => el.classList.contains('is-stale')), 'Old value must be marked stale');
  check((await card.locator('[data-trend]').innerText()).includes('Giá trị lúc'), 'Missing measurement timestamp');
  check((await card.locator('[data-trend]').innerText()).includes('mất kết nối 2 giờ'), 'Missing offline duration');
  await page.locator('#temperature-card [data-value]').getByText('27,4', { exact: true }).waitFor();
  check(await page.locator('#ph-card').evaluate(el => el.classList.contains('is-empty')), 'Never-connected pH must be compact');
  await page.locator('#ph-card').getByText('Chưa có cảm biến', { exact: true }).waitFor();
  check(await page.locator('#alert-content .alert-item').count() === 1, 'Offline duplicated sensor alerts');
  check(!(await page.locator('#alert-content').innerText()).includes('Nguy hiểm'), 'Offline must not imply broken sensor');
  check(await page.locator('#refresh-button').isVisible(), 'Offline refresh button missing');
  check(await page.locator('#set-clean-reference').isDisabled(), 'Cannot set reference offline');
  check((await card.locator('[data-baseline-control]').getAttribute('title')).includes('mất kết nối'), 'Missing disabled reason');
  check(await card.locator('.sparkline').count() === 1, 'Consistent metric sparkline missing');
  await card.getByText('Đang dùng mốc thử 294 mV', { exact: true }).waitFor();
  check((await page.locator('#chart-gaps').innerText()).includes('hiện tại'), 'Missing trailing no-data area');
  check(await page.locator('#device-select option').last().textContent() === '+ Thêm thiết bị', 'Add device must be inside dropdown');
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    const geometry = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight,
      left: document.querySelector('#temperature-card').getBoundingClientRect().bottom,
      right: document.querySelector('#turbidity-card').getBoundingClientRect().bottom }));
    check(geometry.h <= geometry.vh + 2, `Desktop overflow at ${width}`);
    check(Math.abs(geometry.left - geometry.right) < 3, 'Unbalanced top cards');
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: 'output/playwright/offline-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/offline-mobile.png', fullPage: true });
  online = true; await page.reload();
  await card.getByText('HƠI ĐỤC', { exact: true }).waitFor();
  check(!await card.evaluate(el => el.classList.contains('is-stale')), 'Fresh value should not stay stale');
  check(!await page.locator('#refresh-button').isVisible(), 'Refresh should hide online');
  check(!await page.locator('#set-clean-reference').isDisabled(), 'Reference should enable with fresh data');
  invalid = true; await page.reload();
  await card.getByText('HƠI ĐỤC', { exact: true }).waitFor();
  check((await card.locator('[data-trend]').innerText()).includes('mất tín hiệu'), 'Online sensor failure must differ from disconnect');
  await page.locator('#alert-content').getByText('Lỗi cảm biến độ trong', { exact: true }).waitFor();
  return 'PASS: historical readings, never-connected sensors, offline root alert, online refresh, gap tail, balanced desktop/mobile';
}
