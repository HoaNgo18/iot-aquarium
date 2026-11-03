import { TEMPERATURE_PRESETS, SENSITIVITY, SETTING_LABELS, autoRecovery, validateSettings } from './settings-domain.js';
import { drawClaritySparkline } from './clarity-card.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const field = (key, label, min, max, unit = '', step = '0.1', type = 'number') => `
  <label class="settings-field" data-setting="${key}"><span>${label}</span>
    <span class="settings-input"><input name="${key}" type="${type}" min="${min}" max="${max}" step="${step}" aria-describedby="error-${key}" ${type === 'number' ? 'inputmode="decimal"' : ''}/>${unit ? `<span>${unit}</span>` : ''}</span>
    <small id="error-${key}" class="settings-error"></small></label>`;

export function mountSettingsDrawer(root, options) {
  root.insertAdjacentHTML('beforeend', `
    <dialog id="settings-drawer" class="settings-drawer" aria-labelledby="settings-title">
      <form id="settings-form" novalidate>
        <header class="settings-header"><div><h2 id="settings-title">Cài đặt bể cá</h2><p id="settings-device"></p></div><button type="button" id="settings-close" class="settings-icon-button" aria-label="Đóng cài đặt">×</button></header>
        <div class="settings-tabs" role="tablist" aria-label="Nhóm cài đặt">
          ${[['temperature', 'Nhiệt độ'], ['ph', 'pH'], ['clarity', 'Độ trong'], ['alerts', 'Cảnh báo']].map(([key, label], index) => `<button type="button" role="tab" id="settings-tab-${key}" data-settings-tab="${key}" aria-controls="settings-panel-${key}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${label}</button>`).join('')}
        </div>
        <div class="settings-scroll">
          <p id="settings-status" role="status"></p>
          <section id="settings-panel-temperature" role="tabpanel" aria-labelledby="settings-tab-temperature">
            <h3>Nhiệt độ nước</h3>
            <label class="settings-field"><span>Chọn nhanh theo nhóm cá</span><select name="temperature_preset">${Object.entries(TEMPERATURE_PRESETS).map(([key, value]) => `<option value="${key}">${value.label}${value.min != null ? ` · ${value.min}–${value.max} °C` : ''}</option>`).join('')}</select></label>
            <p class="settings-hint">Khoảng gợi ý. Có thể sửa theo loài cá. <a id="preset-source" target="_blank" rel="noreferrer" hidden>Nguồn tham khảo</a></p>
            <div class="settings-pair">${field('temperature_min_c', 'Tối thiểu', -55, 125, '°C')}${field('temperature_max_c', 'Tối đa', -55, 125, '°C')}</div>
          </section>
          <section id="settings-panel-ph" role="tabpanel" aria-labelledby="settings-tab-ph" hidden><h3>Độ pH</h3><div class="settings-pair">${field('ph_min', 'Tối thiểu', 0, 14)}${field('ph_max', 'Tối đa', 0, 14)}</div></section>
          <section id="settings-panel-clarity" role="tabpanel" aria-labelledby="settings-tab-clarity" hidden>
            <h3>Độ trong của nước</h3>
            <div class="settings-baseline"><span>Mốc nước sạch</span><strong id="settings-baseline-value">Chưa có mốc</strong><span id="settings-baseline-time"></span><button type="button" class="button button--secondary" id="settings-reset-baseline">Đặt lại mốc nước sạch</button></div>
            <p class="settings-hint">Mốc được lưu ngay sau khi xác nhận.</p>
            ${field('clear_min_pct', '<span id="clear-slider-label">Ngưỡng Hơi đục</span>', 1, 99, '', 1, 'range')}
            ${field('cloudy_below_pct', '<span id="cloudy-slider-label">Ngưỡng Đục</span>', 0, 98, '', 1, 'range')}
            <p class="settings-hint">Kéo thanh trượt để xem trước dải màu trên biểu đồ. Bấm Lưu để áp dụng.</p>
            <div class="settings-chart-preview"><span>Xem trước · 24 giờ qua</span><canvas id="settings-clarity-preview" role="img" aria-label="Xem trước dải màu độ trong trong 24 giờ"></canvas></div>
            <details class="settings-advanced"><summary>Nâng cao</summary>
              <label class="settings-check"><input type="checkbox" name="auto_hysteresis"/> Tự đặt ngưỡng thoát</label><p class="settings-hint">Cách ngưỡng vào khoảng 3–5 điểm %, thu hẹp khi hai ngưỡng gần nhau.</p>
              ${field('cloudy_recovery_above_pct', 'Thoát Đục khi độ trong trên', 0, 100, '%')}
              ${field('clear_recovery_above_pct', 'Về Trong khi độ trong trên', 0, 100, '%')}
            </details>
          </section>
          <section id="settings-panel-alerts" role="tabpanel" aria-labelledby="settings-tab-alerts" hidden>
            <h3>Cảnh báo và độ nhạy</h3>
            ${field('sensor_timeout_minutes', 'Báo lỗi cảm biến sau khi mất dữ liệu', 0, 60, 'phút', 0.5)}
            <p class="settings-hint">0: báo ngay khi mẫu lỗi. Nếu ngừng nhận mẫu hoàn toàn, chờ ít nhất 1 phút.</p>
            ${field('alert_after_seconds', 'Cảnh báo khi độ trong thấp liên tục', 1, 1440, 'phút', 1)}
            <fieldset class="settings-sensitivity"><legend>Độ nhạy</legend>${Object.entries(SENSITIVITY).map(([key, value]) => `<label><input type="radio" name="sensitivity" value="${key}"/> ${value.label}</label>`).join('')}</fieldset>
            <details class="settings-advanced"><summary>Nâng cao</summary><p id="settings-filter-summary" class="settings-hint"></p><div class="settings-pair">${field('median_window', 'Số mẫu trung vị', 1, 61, 'mẫu', 2)}${field('ema_seconds', 'Thời gian EMA', 1, 300, 'giây', 1)}</div></details>
          </section>
          <details class="settings-history"><summary>Lịch sử thay đổi</summary><div id="settings-history-content"></div><button type="button" id="settings-history-retry" class="settings-text-button">Tải lại lịch sử</button></details>
        </div>
        <footer class="settings-footer"><p id="settings-dirty" role="status"></p><div><button type="button" id="settings-defaults" class="settings-text-button">Khôi phục mặc định</button><button type="button" id="settings-cancel" class="button button--secondary">Hủy thay đổi</button><button type="submit" id="settings-save" class="button button--primary">Lưu</button></div></footer>
      </form>
    </dialog>`);
  const $ = selector => root.querySelector(selector);
  const drawer = $('#settings-drawer'), form = $('#settings-form');
  const lifetime = new AbortController();
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal: lifetime.signal });
  let document = null, draft = null, deviceId = null, busy = false, loadGeneration = 0, requestGeneration = 0;
  const dirty = () => document && draft && JSON.stringify(draft) !== JSON.stringify(document.values);
  const tabFields = { temperature: ['temperature_min_c', 'temperature_max_c'], ph: ['ph_min', 'ph_max'],
    clarity: ['clear_min_pct', 'cloudy_below_pct', 'clear_recovery_above_pct', 'cloudy_recovery_above_pct'],
    alerts: ['sensor_timeout_minutes', 'median_window', 'ema_seconds', 'alert_after_seconds'] };
  function selectTab(key, focus = false) {
    for (const tab of form.querySelectorAll('[data-settings-tab]')) {
      const active = tab.dataset.settingsTab === key; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(`#settings-panel-${tab.dataset.settingsTab}`).hidden = !active;
      if (active && focus) tab.focus();
    }
    render();
  }
  function updateInputs() {
    if (!draft) return;
    for (const control of form.querySelectorAll('[name]')) {
      if (control.type === 'checkbox') control.checked = draft[control.name];
      else if (control.type === 'radio') control.checked = draft[control.name] === control.value;
      else control.value = control.name === 'alert_after_seconds' ? draft[control.name] / 60 : draft[control.name];
    }
    const source = TEMPERATURE_PRESETS[draft.temperature_preset]?.source;
    $('#preset-source').hidden = !source;
    if (source) $('#preset-source').href = source;
  }
  function render() {
    const current = options.getCurrent();
    const locked = busy || current.baselineSaving;
    const errors = draft ? validateSettings(draft) : {};
    for (const control of form.querySelectorAll('[name]')) control.disabled = locked || !draft || draft.auto_hysteresis && ['clear_recovery_above_pct', 'cloudy_recovery_above_pct'].includes(control.name);
    for (const field of form.querySelectorAll('[data-setting]')) {
      const key = field.dataset.setting, error = errors[key] || '';
      field.querySelector('.settings-error').textContent = error;
      field.querySelector('input').setAttribute('aria-invalid', String(Boolean(error)));
    }
    for (const [tab, fields] of Object.entries(tabFields)) $(`#settings-tab-${tab}`).classList.toggle('has-error', fields.some(key => errors[key]));
    $('#settings-save').disabled = locked || !dirty() || Object.keys(errors).length > 0;
    $('#settings-defaults').disabled = locked || !document;
    $('#settings-cancel').disabled = locked || !document;
    $('#settings-close').disabled = locked;
    $('#settings-dirty').textContent = !document ? 'Chưa tải được cài đặt' : dirty() ? 'Có thay đổi chưa lưu' : 'Cài đặt đã lưu theo thiết bị';
    if (draft) {
      $('#clear-slider-label').textContent = `Hơi đục khi độ trong dưới ${draft.clear_min_pct}%`;
      $('#cloudy-slider-label').textContent = `Đục khi độ trong dưới ${draft.cloudy_below_pct}%`;
      $('#settings-filter-summary').textContent = `${draft.sensitivity === 'custom' ? 'Tùy chỉnh · ' : ''}Trung vị ${draft.median_window} mẫu · EMA ${draft.ema_seconds} giây`;
    }
    const baseline = current.baselines?.[0];
    const mv = baseline?.reference_mv ?? current.latest?.turbidityReference;
    $('#settings-baseline-value').textContent = Number.isFinite(mv) ? `${mv.toFixed(1).replace('.', ',')} mV` : 'Chưa có mốc';
    $('#settings-baseline-time').textContent = baseline ? `Đặt lúc ${new Date(baseline.created_at).toLocaleString('vi-VN')}` : 'Mốc mặc định';
    $('#settings-reset-baseline').disabled = locked || !current.canSetBaseline;
    const changedClarity = document && draft && tabFields.clarity.some(key => draft[key] !== document.values[key]);
    if (drawer.open && draft && !$('#settings-panel-clarity').hidden) {
      drawClaritySparkline($('#settings-clarity-preview'), current.clarityHistory ?? [], current.baselines ?? [],
        Object.keys(errors).some(key => tabFields.clarity.includes(key)) ? document.values : draft);
    }
    if (drawer.open) options.onPreview(changedClarity && !Object.keys(errors).some(key => tabFields.clarity.includes(key)) ? draft : null);
  }
  function accept(next, id) {
    if (id !== deviceId) { deviceId = id; document = null; draft = null; loadGeneration++; requestGeneration++; $('#settings-history-content').replaceChildren(); }
    if (next && (!document || !dirty() && next.revision >= document.revision)) { document = structuredClone(next); draft = { ...next.values }; updateInputs(); }
    $('#settings-device').textContent = id;
    render();
  }
  function displayValue(key, value) {
    if (value == null) return 'Chưa có';
    if (key === 'temperature_preset') return TEMPERATURE_PRESETS[value]?.label ?? 'Tùy chỉnh';
    if (key === 'sensitivity') return SENSITIVITY[value]?.label ?? 'Tùy chỉnh';
    if (typeof value === 'boolean') return value ? 'Có' : 'Không';
    const number = Number.isFinite(value) ? value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : value;
    if (key.endsWith('_pct')) return `${number}%`;
    if (key === 'reference_mv') return `${number} mV`;
    if (key.startsWith('temperature_')) return `${number} °C`;
    if (key === 'sensor_timeout_minutes') return `${number} phút`;
    if (key === 'alert_after_seconds') return `${value / 60} phút`;
    if (key === 'ema_seconds') return `${number} giây`;
    return String(number);
  }
  async function loadHistory() {
    const id = deviceId, generation = ++loadGeneration;
    $('#settings-history-content').textContent = 'Đang tải lịch sử…';
    try {
      const rows = await options.request(id, '/settings/history');
      if (generation !== loadGeneration || id !== deviceId) return;
      $('#settings-history-content').innerHTML = rows.length ? rows.map(row => {
        const changes = Object.keys(row.after).filter(key => SETTING_LABELS[key] && (row.action === 'baseline' && key === 'reference_mv' || JSON.stringify(row.before[key]) !== JSON.stringify(row.after[key])));
        return `<article class="settings-change"><strong>${row.action === 'baseline' ? 'Đặt mốc nước sạch' : 'Cập nhật cài đặt'}</strong><time>${escape(new Date(row.changed_at).toLocaleString('vi-VN'))}</time><dl>${changes.map(key => `<div><dt>${SETTING_LABELS[key]}</dt><dd>${escape(displayValue(key, row.before[key]))} → ${escape(displayValue(key, row.after[key]))}</dd></div>`).join('')}</dl></article>`;
      }).join('') : '<p>Chưa có thay đổi được lưu.</p>';
    } catch (error) { if (id === deviceId && generation === loadGeneration) $('#settings-history-content').textContent = `Không tải được lịch sử. ${error.message}`; }
  }
  function setBusy(value) { busy = value; options.onBusy(value); render(); }
  listen($('#open-settings'), 'click', async () => {
    drawer.showModal(); root.ownerDocument.body.classList.add('settings-open'); render();
    if (!document) {
      const id = options.getDeviceId(), generation = ++requestGeneration;
      $('#settings-status').textContent = 'Đang tải cài đặt…';
      try { const next = await options.request(id, '/settings'); if (id === deviceId && generation === requestGeneration) { accept(next, id); $('#settings-status').textContent = ''; } }
      catch (error) { if (id === deviceId) $('#settings-status').textContent = error.message; }
    }
    await loadHistory();
  });
  listen($('#settings-close'), 'click', () => drawer.close());
  listen(drawer, 'cancel', event => { if (busy || options.getCurrent().baselineSaving) event.preventDefault(); });
  listen(drawer, 'close', () => { root.ownerDocument.body.classList.remove('settings-open'); options.onPreview(null); });
  listen(form, 'keydown', event => {
    const tab = event.target.closest('[data-settings-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const keys = Object.keys(tabFields), index = keys.indexOf(tab.dataset.settingsTab);
    selectTab(keys[event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length], true);
  });
  for (const tab of form.querySelectorAll('[data-settings-tab]')) listen(tab, 'click', () => selectTab(tab.dataset.settingsTab));
  listen(form, 'input', event => {
    const control = event.target;
    if (!control.name || !draft || busy) return;
    const key = control.name;
    let value = control.type === 'checkbox' ? control.checked : control.type === 'radio' || control.tagName === 'SELECT' ? control.value : control.value.trim() ? Number(control.value) : NaN;
    if (key === 'alert_after_seconds') value *= 60;
    draft = { ...draft, [key]: value };
    if (key === 'temperature_preset' && TEMPERATURE_PRESETS[value]?.min != null) {
      draft.temperature_min_c = TEMPERATURE_PRESETS[value].min; draft.temperature_max_c = TEMPERATURE_PRESETS[value].max;
    }
    if (['temperature_min_c', 'temperature_max_c'].includes(key)) draft.temperature_preset = 'custom';
    if (key === 'sensitivity') Object.assign(draft, SENSITIVITY[value] && { median_window: SENSITIVITY[value].median_window, ema_seconds: SENSITIVITY[value].ema_seconds });
    if (['median_window', 'ema_seconds'].includes(key)) draft.sensitivity = 'custom';
    if (draft.auto_hysteresis && ['auto_hysteresis', 'clear_min_pct', 'cloudy_below_pct'].includes(key)) draft = autoRecovery(draft);
    // Keep a partially entered number intact; sync only controls changed indirectly.
    for (const element of form.querySelectorAll('[name]')) {
      if (element === control) continue;
      if (element.type === 'checkbox') element.checked = draft[element.name];
      else if (element.type === 'radio') element.checked = draft[element.name] === element.value;
      else element.value = element.name === 'alert_after_seconds' ? draft[element.name] / 60 : draft[element.name];
    }
    const source = TEMPERATURE_PRESETS[draft.temperature_preset]?.source; $('#preset-source').hidden = !source; if (source) $('#preset-source').href = source;
    render();
  });
  listen($('#settings-defaults'), 'click', () => { draft = { ...document.defaults }; updateInputs(); $('#settings-status').textContent = 'Đã đưa về mặc định. Bấm Lưu để áp dụng.'; render(); });
  listen($('#settings-cancel'), 'click', async () => {
    const id = deviceId;
    draft = { ...document.values }; updateInputs(); setBusy(true);
    try { const next = await options.request(id, '/settings'); document = next; draft = { ...next.values }; updateInputs(); $('#settings-status').textContent = 'Đã hủy thay đổi.'; await loadHistory(); }
    catch (error) { $('#settings-status').textContent = `Đã hủy bản nháp. Chưa tải được cài đặt mới: ${error.message}`; }
    finally { setBusy(false); }
  });
  listen(form, 'submit', async event => {
    event.preventDefault(); if (busy || !dirty() || Object.keys(validateSettings(draft)).length) return;
    const id = deviceId; setBusy(true); $('#settings-status').textContent = 'Đang lưu…';
    try {
      const saved = await options.request(id, '/settings', { method: 'PUT', body: JSON.stringify({ revision: document.revision, values: draft }) });
      document = saved; draft = { ...saved.values }; updateInputs(); $('#settings-status').textContent = 'Đã lưu cài đặt cho thiết bị này.';
      await loadHistory(); setBusy(false); await options.onSaved(saved);
    } catch (error) { $('#settings-status').textContent = error.message; }
    finally { if (busy) setBusy(false); render(); }
  });
  listen($('#settings-reset-baseline'), 'click', () => options.onBaseline());
  listen($('#settings-history-retry'), 'click', loadHistory);
  listen(root.ownerDocument.defaultView, 'resize', render);
  return { accept, dirty, refreshHistory: () => drawer.open ? loadHistory() : Promise.resolve(),
    dispose() { lifetime.abort(); loadGeneration++; requestGeneration++; drawer.remove(); root.ownerDocument.body.classList.remove('settings-open'); } };
}
