async page => {
  // All writes stay inside this isolated browser fixture.
  const defaults = { temperature_min_c: 22, temperature_max_c: 30, temperature_preset: 'custom', ph_min: 6.5, ph_max: 8.5,
    clear_min_pct: 90, cloudy_below_pct: 70, clear_recovery_above_pct: 93, cloudy_recovery_above_pct: 75,
    auto_hysteresis: true, alert_after_seconds: 1800, sensor_timeout_minutes: 0,
    sensitivity: 'standard', median_window: 15, ema_seconds: 20 };
  const documents = new Map(), histories = new Map(), baselines = new Map();
  let settingsWrites = 0, baselineWrites = 0;
  const doc = id => {
    if (!documents.has(id)) { documents.set(id, { device_id: id, revision: 0, values: { ...defaults }, defaults }); histories.set(id, []); baselines.set(id, []); }
    return documents.get(id);
  };
  await page.route('**/api/v1/devices/**', async route => {
    const url = new URL(route.request().url()), parts = url.pathname.split('/'), id = parts[4], suffix = parts.slice(5).join('/');
    const settings = doc(id), stamp = new Date().toISOString();
    const reading = { id: 1, measured_at: stamp, temperature_c: 27, ph: 7, turbidity_pct: null,
      turbidity_mv: 244.9, turbidity_reference_mv: baselines.get(id)[0]?.reference_mv ?? 294,
      clarity_pct: 83.3, clarity_mv: 244.9, clarity_state: 'slight', sensor_health: { temperature: true, ph: true, clarity: true },
      signal_strength_dbm: -55, sensor_status: 'normal' };
    let data;
    if (suffix === 'settings') {
      if (route.request().method() === 'PUT') {
        settingsWrites++;
        const body = route.request().postDataJSON();
        if (body.revision !== settings.revision) return route.fulfill({ status: 409, json: { detail: 'Cài đặt đã thay đổi ở nơi khác.' } });
        histories.get(id).unshift({ id: `settings-${settingsWrites}`, action: 'settings', before: { ...settings.values }, after: { ...body.values }, changed_at: stamp });
        settings.values = body.values; settings.revision++;
      }
      data = settings;
    } else if (suffix === 'settings/history') data = histories.get(id);
    else if (suffix === 'clarity/config') data = settings.values;
    else if (suffix === 'clarity/baselines') {
      if (route.request().method() === 'POST') {
        baselineWrites++;
        if (!route.request().postDataJSON().water_changed) throw new Error('Missing water-change mark');
        const event = { id: baselineWrites, reference_mv: 280, created_at: stamp, water_changed: true };
        histories.get(id).unshift({ id: `baseline-${baselineWrites}`, action: 'baseline', before: { reference_mv: 294 }, after: { reference_mv: 280, water_changed: true }, changed_at: stamp });
        baselines.get(id).unshift(event);
        return route.fulfill({ status: 201, json: event });
      }
      data = baselines.get(id);
    } else if (suffix === 'telemetry/latest') data = reading;
    else if (suffix === 'telemetry/series') data = Array.from({ length: 100 }, (_, i) => ({ ...reading, id: i, clarity_pct: 98 - i / 7, measured_at: new Date(Date.now() - (99 - i) * 600000).toISOString() }));
    else if (suffix === 'thresholds') data = { ...settings.values, turbidity_warning_pct: 60, turbidity_critical_pct: 80 };
    else if (suffix === 'alerts') data = [];
    else data = { id, connectivity: 'online', last_seen_at: stamp };
    await route.fulfill({ json: data });
  });
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5173/?device_id=settings-ui-a');
  await page.getByText('HƠI ĐỤC', { exact: true }).waitFor();
  check(await page.locator('#threshold-form').count() === 0, 'Old bottom panel remains');
  await page.locator('#open-settings').click();
  const drawer = page.locator('#settings-drawer');
  await drawer.getByRole('heading', { name: 'Cài đặt bể cá' }).waitFor();
  await drawer.locator('[name="temperature_preset"]').selectOption('tropical');
  check(await drawer.locator('[name="temperature_min_c"]').inputValue() === '24', 'Preset did not fill minimum');
  check(await drawer.locator('[name="temperature_max_c"]').inputValue() === '26', 'Preset did not fill maximum');
  await drawer.locator('[name="temperature_min_c"]').fill('25');
  check(await drawer.locator('[name="temperature_preset"]').inputValue() === 'custom', 'Manual edit must select custom');
  await drawer.locator('[name="temperature_max_c"]').fill('24');
  check(await drawer.locator('#settings-save').isDisabled(), 'Invalid temperature saved');
  await drawer.locator('#error-temperature_max_c').getByText('Tối đa phải lớn hơn tối thiểu.', { exact: true }).waitFor();
  await drawer.locator('[name="temperature_max_c"]').fill('28');
  await drawer.getByRole('tab', { name: 'pH', exact: true }).click();
  await drawer.locator('[name="ph_min"]').fill('9');
  check(await drawer.locator('#settings-save').isDisabled(), 'Invalid pH saved');
  await drawer.locator('[name="ph_min"]').fill('6.8');
  await drawer.getByRole('tab', { name: 'Độ trong', exact: true }).click();
  check(await drawer.locator('#settings-clarity-preview').isVisible(), 'Inline preview is missing');
  const beforeChart = await page.locator('#history-chart').evaluate(canvas => canvas.toDataURL());
  await drawer.locator('[name="clear_min_pct"]').focus();
  await page.keyboard.press('End');
  for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowLeft');
  await drawer.getByText('Hơi đục khi độ trong dưới 88%', { exact: true }).waitFor();
  check((await page.locator('#clarity-zones').textContent()).includes('88%'), 'Preview annotation not updated');
  check(await page.locator('#history-chart').evaluate(canvas => canvas.toDataURL()) !== beforeChart, 'Preview colors did not redraw');
  check(settingsWrites === 0, 'Preview wrote settings before save');
  await drawer.locator('#settings-panel-clarity summary').click();
  check(await drawer.locator('[name="clear_recovery_above_pct"]').inputValue() === '91', 'Automatic recovery offset is wrong');
  await drawer.locator('[name="auto_hysteresis"]').uncheck();
  await drawer.locator('[name="clear_recovery_above_pct"]').fill('80');
  check(await drawer.locator('#settings-save').isDisabled(), 'Invalid recovery saved');
  await drawer.locator('[name="clear_recovery_above_pct"]').fill('91');
  await page.screenshot({ path: 'output/playwright/settings-desktop.png', fullPage: true });
  await drawer.getByRole('tab', { name: 'Cảnh báo', exact: true }).click();
  await drawer.locator('[name="sensor_timeout_minutes"]').fill('2');
  await drawer.locator('[name="sensitivity"][value="sensitive"]').check();
  await drawer.locator('#settings-panel-alerts summary').click();
  check(await drawer.locator('[name="median_window"]').inputValue() === '5', 'Sensitivity window not filled');
  await drawer.locator('[name="median_window"]').fill('4');
  check(await drawer.locator('#settings-save').isDisabled(), 'Even median size accepted');
  await drawer.locator('[name="median_window"]').fill('5');
  await drawer.locator('[name="ema_seconds"]').fill('7');
  await drawer.locator('#settings-save').click();
  await drawer.getByText('Đã lưu cài đặt cho thiết bị này.', { exact: true }).waitFor();
  check(settingsWrites === 1, 'Settings were not saved once');
  check(doc('settings-ui-a').values.clear_min_pct === 88, 'Clarity threshold not persisted');
  check(doc('settings-ui-a').values.median_window === 5 && doc('settings-ui-a').values.ema_seconds === 7, 'Advanced filter not persisted');
  await drawer.locator('.settings-history summary').click();
  await drawer.getByText('Cập nhật cài đặt', { exact: true }).waitFor();
  check((await drawer.locator('#settings-history-content').innerText()).includes('22 °C → 25 °C'), 'History lacks old → new');
  await drawer.getByRole('tab', { name: 'Độ trong', exact: true }).click();
  await drawer.locator('#settings-reset-baseline').click();
  await page.locator('#clarity-cancel').click();
  check(baselineWrites === 0, 'Cancel saved baseline');
  await drawer.locator('#settings-reset-baseline').click();
  await page.locator('#clarity-save').click();
  await drawer.locator('#settings-baseline-value').getByText('280,0 mV', { exact: true }).waitFor();
  await drawer.getByText('Đặt mốc nước sạch', { exact: true }).waitFor();
  check(baselineWrites === 1 && baselines.get('settings-ui-a')[0].water_changed, 'Baseline event missing');
  await drawer.locator('#settings-defaults').click();
  check(doc('settings-ui-a').values.clear_min_pct === 88, 'Restore defaults saved immediately');
  await drawer.locator('#settings-cancel').click();
  await drawer.getByText('Đã hủy thay đổi.', { exact: true }).waitFor();
  check(await drawer.locator('[name="clear_min_pct"]').inputValue() === '88', 'Cancel did not restore saved settings');
  await drawer.locator('#settings-close').click();
  check(!await page.locator('#settings-preview-note').isVisible(), 'Preview remains after close');
  await page.reload();
  await page.locator('#open-settings').click();
  check(await drawer.locator('[name="temperature_min_c"]').inputValue() === '25', 'Reload lost settings');
  await drawer.locator('#settings-close').click();
  await page.locator('#device-select').selectOption('tank-preview-001');
  await page.waitForResponse(response => response.url().includes('tank-preview-001/settings'));
  await page.locator('#open-settings').click();
  check(await drawer.locator('[name="temperature_min_c"]').inputValue() === '22', 'Settings leaked across devices');
  await drawer.locator('#settings-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#open-settings').click();
  await drawer.getByRole('tab', { name: 'Độ trong', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/settings-mobile.png' });
  await page.setViewportSize({ width: 320, height: 700 });
  check(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'Drawer overflows at 320px');
  await page.keyboard.press('Tab');
  check(await drawer.evaluate(el => el.contains(el.ownerDocument.activeElement)), 'Focus escaped modal');
  await page.keyboard.press('Escape');
  check(!await drawer.isVisible(), 'Escape did not close drawer');
  check(!await page.locator('body').evaluate(el => el.classList.contains('settings-open')), 'Body scroll stayed locked');
  return 'PASS: presets, validation, preview, per-device save/reload, audit, baseline cancel/save, mobile and keyboard';
}
