import { snapshot, request as apiRequest, metricStatus } from './api.js';
import { durationLabel, clarityRuleText, sensorSummary, clarityPresentation, temperaturePresentation, CLARITY_DISPLAY_MAX_PCT } from './presentation.js';
import { mountSettingsDrawer } from './settings-drawer.js';
import { clarityScale, compressedTimeline } from './chart-layout.js';
import { lastKnownReading, readingState, elapsedLabel, phReading } from './reading-state.js';

export function mountDashboard(root, onDeviceChange, realtimeLabel) {
const lifetime = new AbortController();
const request = (id, suffix, options = {}) => apiRequest(id, suffix, { ...options, signal: lifetime.signal });
const listeners = [];
const listen = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
const METRICS = {
  clarity: { label: 'Độ trong tương đối · chưa hiệu chuẩn NTU', unit: '%', color: '#4fa8ff', decimals: 1 },
  temperature: { label: 'Nhiệt độ', unit: '°C', color: '#4fa8ff', decimals: 1 },
  ph: { label: 'Độ pH', unit: '', color: '#b488ff', decimals: 1 },
  phVoltage: { label: 'pH · điện áp GPIO34 · chưa hiệu chuẩn', unit: 'mV', color: '#b488ff', decimals: 0 },
  turbidity: { label: 'Độ trong · dữ liệu cũ', unit: '%', color: '#f0b85c', decimals: 0 },
  turbidityVoltage: { label: 'Độ trong · điện áp GPIO35', unit: 'mV', color: '#4fa8ff', decimals: 0 },
  turbidityChange: { label: 'Độ trong · mức giảm tín hiệu', unit: '%', color: '#4fa8ff', decimals: 1 },
};

const DEFAULT_THRESHOLDS = {
  tempMin: 22,
  tempMax: 30,
  phMin: 6.5,
  phMax: 8.5,
  turbidityWarn: 45,
  turbidityDanger: 70,
};

const state = {
  deviceId: 'tank-demo-001',
  metric: 'clarity',
  range: 1440,
  baselines: [], baselineSaving: false, clarityHistory: [], clarityConfig: null, previewConfig: null, settings: null,
  thresholdsByDevice: {}, lastValid: {},
  data: [],
  lastUpdatedAt: new Date(),
  alertTab: 'active',
  loading: false,
  device: null, latest: null, alerts: [], error: '', saving: false,
};
const profileForDevice = () => ({ online: !state.error && state.device?.connectivity === 'online', rssi: !state.error && state.device?.connectivity === 'online' ? state.latest?.rssi : null, name: state.deviceId });
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function age(timestamp) {
  if (!timestamp) return 'Chưa có dữ liệu';
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < -30) return 'Giờ mẫu ở tương lai';
  return seconds < 60 ? `${Math.max(0, seconds)} giây trước` : seconds < 3600 ? `${Math.floor(seconds / 60)} phút trước` : `${Math.floor(seconds / 3600)} giờ trước`;
}

const dashboardRoot = root;
const $ = (selector, root = dashboardRoot) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const vnTime = (date, withSeconds = false) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false,
}).format(date);

function getThresholds() {
  return state.thresholdsByDevice[state.deviceId] || { ...DEFAULT_THRESHOLDS };
}

function getMetricThreshold(metric, thresholds = getThresholds()) {
  if (metric === 'temperature') return { min: thresholds.tempMin, max: thresholds.tempMax, warningOnly: false };
  if (metric === 'ph') return { min: thresholds.phMin, max: thresholds.phMax, warningOnly: false };
  return { min: 0, max: thresholds.turbidityWarn, danger: thresholds.turbidityDanger, warningOnly: true };
}

function evaluateMetric(metric, value) {
  if (metric === 'clarity' && value > CLARITY_DISPLAY_MAX_PCT) return 'outside';
  return metricStatus(metric, value, state.thresholdsByDevice[state.deviceId]);
}

function statusLabel(status) {
  return {
    normal: '✓ Bình thường', warning: '△ Cảnh báo', danger: '! Nguy hiểm', neutral: '— Chưa có dữ liệu',
    uncalibrated: 'Chưa hiệu chuẩn',
    outside: 'Ngoài dải đo',
  }[status];
}

function currentData() {
  return state.data.filter(row => row.time >= Date.now() - state.range * 60000).slice(-500);
}

function updateHeader() {
  const profile = profileForDevice();
  const pill = $('#connection-pill');
  pill.classList.toggle('is-offline', !profile.online);
  const health = sensorSummary(state.latest, profile.online);
  pill.innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>${state.error ? 'Không kết nối được máy chủ' : profile.online ? 'Thiết bị online' : 'Thiết bị mất kết nối'} · cập nhật ${age(state.device?.last_seen_at)}</span>`;
  $('#sensor-health').textContent = `${health.label}. ${health.detail}`;
  $('#rssi-value').textContent = profile.rssi == null ? 'Chưa nhận được tín hiệu' : `${profile.rssi} dBm`;
  $('#refresh-button').hidden = profile.online;
  const count = getActiveAlerts().length;
  $('#alerts-toggle').textContent = `⚠ ${count} cảnh báo`;
  $('#alerts-toggle').classList.toggle('has-alerts', count > 0);
  if (!profile.online) $('.status-dot', pill).style.background = 'var(--neutral)';
}

function drawSparkline(canvas, values, color) {
  values = values.filter(Number.isFinite);
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  if (values.length < 2) return;
  const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
  const x = (i) => i / (values.length - 1) * rect.width;
  const y = (v) => rect.height - 3 - ((v - min) / span) * (rect.height - 6);
  const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
  gradient.addColorStop(0, `${color}20`); gradient.addColorStop(1, `${color}00`);
  ctx.beginPath(); ctx.moveTo(x(0), y(values[0]));
  values.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(rect.width, rect.height); ctx.lineTo(0, rect.height); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); ctx.moveTo(x(0), y(values[0])); values.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
}

function updateKpis() {
  const profile = profileForDevice();
  const historicalCaption = row => {
    const measured = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
      ...(Date.now() - row.time >= 86400000 ? { day: '2-digit', month: '2-digit' } : {}), hour12: false }).format(row.time);
    const offline = state.alerts.find(alert => alert.alert_type === 'offline' && !alert.ended_at);
    const since = profile.online ? row.time : new Date(offline?.started_at ?? state.device?.last_seen_at ?? row.time);
    return `Giá trị lúc ${measured} · ${profile.online ? 'mất tín hiệu' : 'mất kết nối'} ${elapsedLabel(since)}`;
  };
  ['temperature', 'ph', 'clarity'].forEach(metric => {
    const card = $(`#${metric === 'clarity' ? 'turbidity' : metric}-card`);
    const candidates = [state.lastValid[metric], state.latest, ...state.data, ...state.clarityHistory];
    const ph = metric === 'ph' ? phReading(candidates) : null;
    const displayMetric = ph?.metric ?? metric;
    const known = ph?.row ?? lastKnownReading(metric, candidates);
    const display = readingState(displayMetric, state.latest, known, profile.online);
    const row = display.row, value = row?.[displayMetric], config = METRICS[displayMetric];
    const status = display.kind === 'live' ? evaluateMetric(displayMetric, value) : 'neutral';
    card.dataset.status = status;
    card.dataset.readingState = display.kind;
    card.classList.toggle('is-stale', display.kind === 'stale');
    $('[data-value]', card).textContent = value == null ? '--' : value.toFixed(config.decimals).replace('.', ',');
    const badge = $('.status-badge', card);
    badge.className = `status-badge status-badge--${status}`;
    badge.textContent = display.kind === 'stale' ? 'Giá trị cuối' : statusLabel(status);
    const trend = $('[data-trend]', card);
    trend.className = 'trend';
    trend.textContent = display.kind === 'stale' ? historicalCaption(row) : 'Hoạt động';
    if (metric !== 'clarity') {
      const empty = display.kind === 'never';
      card.classList.toggle('is-empty', empty);
      const reason = $('[data-missing-reason]', card);
      reason.hidden = !empty;
      reason.textContent = 'Chưa có cảm biến';
      reason.title = 'Chưa từng nhận được số đo hợp lệ từ cảm biến này.';
      badge.textContent = display.kind === 'stale' ? 'Giá trị cuối' : status === 'normal' ? 'Hoạt động' : statusLabel(status);
      if (metric === 'temperature' && display.kind === 'live') {
        const text = temperaturePresentation(value, getThresholds());
        badge.textContent = text.badge;
        trend.textContent = `${text.note} · cập nhật ${vnTime(row.time)}`;
      }
      if (metric === 'ph') {
        const raw = displayMetric === 'phVoltage' && row;
        $('.kpi-card__label', card).textContent = 'Độ pH';
        card.classList.toggle('is-uncalibrated', Boolean(raw));
        $('[data-ph-pending]', card).hidden = !raw;
        $('[data-ph-unit]', card).textContent = raw ? 'mV' : '';
        $('[data-ph-note]', card).hidden = !raw;
        $('[data-ph-note]', card).textContent = raw ? 'Điện áp GPIO34 · chưa phải số pH' : '';
        if (raw) {
          badge.textContent = 'Chưa hiệu chuẩn';
          badge.className = 'status-badge status-badge--uncalibrated';
          if (display.kind === 'live') trend.textContent = `Đã nhận tín hiệu · cập nhật ${vnTime(row.time)}`;
        }
      }
      drawSparkline($('.sparkline', card), state.data.slice(-22).map(item => item[displayMetric]), config.color);
    }
    if (metric === 'clarity') {
      $('.kpi-card__label', card).textContent = 'Độ trong của nước';
      card.classList.add('clarity-card');
      $('[data-probe-details]', card).hidden = $('#clarity-details-toggle').getAttribute('aria-expanded') !== 'true';
      $('[data-clarity-controls]', card).hidden = false;
      const text = clarityPresentation(row);
      card.classList.toggle('is-outside', text.outside);
      $('[data-value]', card).textContent = text.label;
      $('[data-value]', card).dataset.clarity = text.state;
      $('.kpi-card__value small', card).textContent = row && !text.outside ? `${value.toFixed(0)}%` : '';
      badge.className = 'status-badge status-badge--uncalibrated'; badge.textContent = 'Chưa hiệu chuẩn';
      if (display.kind === 'live') trend.textContent = `${text.note} · cập nhật ${vnTime(row.time)}`;
      $('[data-clarity-warning]', card).hidden = !text.outside;
      drawSparkline($('.sparkline', card), state.data.slice(-22).map(item => item.clarity), text.outside ? '#aebdcb' : config.color);
      if (display.kind === 'never') trend.textContent = 'Chưa từng có số đo hợp lệ';
      $('[data-probe-voltage]', card).textContent = Number.isFinite(row?.turbidityVoltage) ? `${row.turbidityVoltage.toFixed(1).replace('.', ',')} mV` : 'Chưa có mẫu';
      $('#clarity-filtered-voltage').textContent = Number.isFinite(row?.clarityMv) ? `${row.clarityMv.toFixed(1).replace('.', ',')} mV` : 'Chưa có mẫu';
      $('#clarity-detail-value').textContent = row ? `${value.toFixed(0)}%` : '—';
      $('#clarity-reference-time').textContent = Number.isFinite(row?.turbidityReference) ? `${row.turbidityReference.toFixed(1).replace('.', ',')} mV · ${row.clarityBaselineAt ? `đặt lúc ${new Date(row.clarityBaselineAt).toLocaleString('vi-VN')}` : 'mốc mặc định'}` : 'Chưa có mốc';
      const rules = clarityRuleText(state.clarityConfig);
      $('#clarity-detail-rules').textContent = `${rules.zones}. ${rules.recovery}`;
      $('#clarity-filter-details').textContent = `Trung vị ${state.settings?.values.median_window ?? 15} mẫu, EMA ${state.settings?.values.ema_seconds ?? 20} giây`;
      const freshMv = profile.online && state.latest && Date.now() - state.latest.time < 60000 && Number.isFinite(state.latest.turbidityVoltage);
      const reason = state.baselineSaving ? 'Đang lưu mốc nước sạch' : !profile.online ? 'Thiết bị mất kết nối. Cần mẫu mới để đặt mốc nước sạch.' : !freshMv ? 'Chờ số đo độ trong hợp lệ mới để đặt mốc.' : '';
      $('#set-clean-reference').disabled = Boolean(reason);
      $('[data-baseline-control]', card).title = reason || 'Đặt mốc từ nước sạch hiện tại';
      $('[data-baseline-control]', card).setAttribute('aria-label', reason || 'Đặt mốc nước sạch');
      const baseline = state.baselines[0];
      $('#clarity-baseline-note').textContent = text.outside ? 'Đặt mốc khi nước trong và tín hiệu ổn định'
        : baseline ? `Mốc đặt lúc ${vnTime(new Date(baseline.created_at))}`
        : Number.isFinite(row?.turbidityReference) ? `Đang dùng mốc thử ${row.turbidityReference.toFixed(0)} mV` : 'Chưa đặt mốc nước sạch';
    }
  });

}

class HistoryChart {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hoverIndex = null;
    this.resizeObserver = new ResizeObserver(() => this.draw()); this.resizeObserver.observe(canvas.parentElement);
    listen(canvas, 'pointermove', (event) => this.onPointer(event));
    listen(canvas, 'pointerleave', () => { this.hoverIndex = null; $('#chart-tooltip').setAttribute('aria-hidden', 'true'); this.draw(); });
  }

  dimensions() {
    const rect = this.canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(rect.width * dpr) || this.canvas.height !== Math.round(rect.height * dpr)) {
      this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { width: rect.width, height: rect.height, dpr };
  }

  getScale(data, metric) {
    const threshold = getMetricThreshold(metric); const values = data.map((item) => item[metric]).filter(Number.isFinite);
    if (metric === 'clarity') return clarityScale(values, state.previewConfig ?? state.clarityConfig ?? { cloudy_below_pct: 70, clear_min_pct: 90 });
    if (metric === 'phVoltage' || metric === 'turbidityVoltage' || metric === 'turbidityChange') {
      const low = values.length ? Math.min(...values) : 150;
      const high = values.length ? Math.max(...values) : 300;
      const padding = Math.max(10, (high - low) * .16);
      return { min: metric !== 'turbidityChange' ? Math.max(0, low - padding) : low - padding, max: high + padding };
    }
    const anchors = metric === 'turbidity' ? [threshold.max, threshold.danger] : [threshold.min, threshold.max];
    const rawMin = Math.min(...values, ...anchors); const rawMax = Math.max(...values, ...anchors); const padding = Math.max((rawMax - rawMin) * .16, metric === 'ph' ? .25 : 1);
    return { min: metric === 'turbidity' ? Math.max(0, rawMin - padding) : rawMin - padding, max: rawMax + padding };
  }

  draw() {
    const metric = state.metric;
    const timeline = compressedTimeline(currentData(), metric, Math.max(300000, state.range * 60000 / 480 * 3), Date.now());
    const data = timeline.data; const { width, height } = this.dimensions(); const ctx = this.ctx;
    const gaps = [...(timeline.tail ? [timeline.tail] : []), ...timeline.gaps];
    $('#chart-gaps').hidden = !gaps.length;
    $('#chart-gaps').textContent = gaps.slice(0, 2).map(gap => `Không có dữ liệu ${vnTime(gap.from)}–${gap === timeline.tail ? 'hiện tại' : vnTime(gap.to)}`).join(' · ') + (gaps.length > 2 ? ` · và ${gaps.length - 2} khoảng khác` : '');
    ctx.clearRect(0, 0, width, height); this.geometry = null; if (!data.length) return;
    const pad = { left: 50, right: 18, top: 18, bottom: 34 }; const plotW = width - pad.left - pad.right; const plotH = height - pad.top - pad.bottom;
    const scale = this.getScale(data, metric); const threshold = getMetricThreshold(metric); const config = METRICS[metric];
    const x = (i) => pad.left + (data.length === 1 && !timeline.tail ? .5 : timeline.positions[i] / timeline.span) * plotW;
    const y = (value) => pad.top + (1 - (value - scale.min) / (scale.max - scale.min)) * plotH;

    if (metric === 'clarity' && (state.previewConfig ?? state.clarityConfig)) {
      const { clear_min_pct: clear, cloudy_below_pct: cloudy } = state.previewConfig ?? state.clarityConfig;
      [[clear, Math.min(scale.max, CLARITY_DISPLAY_MAX_PCT), 'rgba(68,190,128,.22)'], [cloudy, clear, 'rgba(240,184,92,.22)'], [scale.min, cloudy, 'rgba(255,107,114,.20)']].forEach(([low, high, color]) => {
        ctx.fillStyle = color; ctx.fillRect(pad.left, y(Math.min(scale.max, high)), plotW, y(Math.max(scale.min, low)) - y(Math.min(scale.max, high)));
      });
      if (scale.max > CLARITY_DISPLAY_MAX_PCT) {
        ctx.fillStyle = 'rgba(160,176,191,.16)';
        ctx.fillRect(pad.left, pad.top, plotW, y(CLARITY_DISPLAY_MAX_PCT) - pad.top);
      }
      state.baselines.forEach(event => {
        const stamp = new Date(event.created_at);
        if (stamp < data[0].time || stamp > data.at(-1).time) return;
        const px = pad.left + timeline.position(stamp) / timeline.span * plotW;
        ctx.strokeStyle = '#8fa7b0'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#bacad2'; ctx.font = '12px sans-serif'; ctx.fillText(event.water_changed ? 'Thay nước / đặt mốc' : 'Đặt mốc', Math.min(px + 3, width - 150), pad.top + 12);
      });
    }
    if (!['clarity', 'phVoltage', 'turbidityVoltage', 'turbidityChange'].includes(metric)) {
    const safeTop = clamp(y(threshold.max), pad.top, pad.top + plotH); const safeBottom = clamp(y(threshold.min), pad.top, pad.top + plotH);
    ctx.fillStyle = 'rgba(96,165,250,.065)'; ctx.fillRect(pad.left, safeTop, plotW, safeBottom - safeTop);
    ctx.fillStyle = 'rgba(255,107,114,.035)'; ctx.fillRect(pad.left, pad.top, plotW, Math.max(0, safeTop - pad.top));
    if (metric !== 'turbidity') ctx.fillRect(pad.left, safeBottom, plotW, pad.top + plotH - safeBottom);
    if (metric === 'turbidity' && threshold.danger < scale.max) { ctx.fillStyle = 'rgba(255,107,114,.06)'; ctx.fillRect(pad.left, pad.top, plotW, y(threshold.danger) - pad.top); }
    }

    if (timeline.tail) {
      const edge = x(data.length - 1);
      ctx.fillStyle = '#8292a43b'; ctx.fillRect(edge, pad.top, width - pad.right - edge, plotH);
    }
    ctx.font = '13px "Be Vietnam Pro"'; ctx.textBaseline = 'middle';
    for (const value of scale.ticks ?? Array.from({ length: 5 }, (_, i) => scale.max - i * (scale.max - scale.min) / 4)) {
      const py = y(value);
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.strokeStyle = 'rgba(49,87,100,.24)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#d5dfe6'; ctx.textAlign = 'right'; ctx.fillText(value.toFixed(metric === 'ph' ? 1 : 0), pad.left - 9, py);
    }
    const tickCount = width < 600 ? 4 : 6;
    const ticks = [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (data.length - 1) / (tickCount - 1))))];
    for (const index of ticks) {
      ctx.fillStyle = '#d5dfe6'; ctx.textAlign = index === 0 ? 'left' : index === data.length - 1 ? 'right' : 'center'; ctx.fillText(state.range > 1440 ? data[index].time.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : vnTime(data[index].time), x(index), height - 13);
    }
    if (timeline.tail) { ctx.textAlign = 'right'; ctx.fillText('Hiện tại', width - pad.right, height - 13); }

    const lines = (['clarity', 'phVoltage', 'turbidityVoltage', 'turbidityChange'].includes(metric)) ? [] : metric === 'turbidity'
      ? [{ value: threshold.max, label: `Cảnh báo ${threshold.max}%`, color: '#f6b94d' }, { value: threshold.danger, label: `Nguy hiểm ${threshold.danger}%`, color: '#ff6b72' }]
      : [{ value: threshold.min, label: `Tối thiểu ${threshold.min}`, color: '#f6b94d' }, { value: threshold.max, label: `Tối đa ${threshold.max}`, color: '#f6b94d' }];
    lines.forEach((line) => {
      const py = y(line.value); ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.strokeStyle = line.color; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      const labelWidth = ctx.measureText(line.label).width + 12; ctx.fillStyle = '#0d1d24'; ctx.fillRect(width - pad.right - labelWidth, py - 8, labelWidth, 15); ctx.fillStyle = line.color; ctx.textAlign = 'right'; ctx.fillText(line.label, width - pad.right - 5, py);
    });

    let connected = false;
    ctx.beginPath(); data.forEach((item, index) => {
      if (!Number.isFinite(item[metric])) { connected = false; return; }
      if (index && (item.time - data[index - 1].time > Math.max(60000, state.range * 60000 / 480 * 2) || metric === 'clarity' && item.clarityBaselineAt !== data[index - 1].clarityBaselineAt)) connected = false;
      if (connected) ctx.lineTo(x(index), y(item[metric])); else ctx.moveTo(x(index), y(item[metric]));
      connected = true;
    }); ctx.strokeStyle = config.color; ctx.lineWidth = 1.75; ctx.stroke();
    if (metric === 'clarity') data.forEach((item, index) => {
      if (!Number.isFinite(item.clarity)) return;
      ctx.beginPath(); ctx.arc(x(index), y(item.clarity), 1.5, 0, Math.PI * 2); ctx.fillStyle = item.clarity > CLARITY_DISPLAY_MAX_PCT ? '#aebdcb' : config.color; ctx.fill();
    });

    data.forEach((item, index) => { if (evaluateMetric(metric, item[metric]) === 'danger') { ctx.beginPath(); ctx.arc(x(index), y(item[metric]), 3, 0, Math.PI * 2); ctx.fillStyle = '#ff6b72'; ctx.fill(); } });
    if (this.hoverIndex != null && Number.isFinite(data[this.hoverIndex]?.[metric])) {
      const item = data[this.hoverIndex]; const px = x(this.hoverIndex); const py = y(item[metric]);
      ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, pad.top + plotH); ctx.strokeStyle = 'rgba(181,200,207,.45)'; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = '#071116'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = config.color; ctx.stroke();
    }
    this.geometry = { data, pad, plotW, plotH, x, y, tailStart: timeline.tail ? x(data.length - 1) : null };
  }

  onPointer(event) {
    if (!this.geometry?.data.length) return;
    const rect = this.canvas.getBoundingClientRect(); const localX = event.clientX - rect.left; const { data, pad, plotW, x, y } = this.geometry;
    if (this.geometry.tailStart !== null && localX > this.geometry.tailStart) { this.hoverIndex = null; $('#chart-tooltip').setAttribute('aria-hidden', 'true'); this.draw(); return; }
    this.hoverIndex = data.reduce((best, item, index) => Math.abs(x(index) - localX) < Math.abs(x(best) - localX) ? index : best, 0);
    const item = data[this.hoverIndex]; const metric = state.metric; const config = METRICS[metric]; const status = evaluateMetric(metric, item[metric]); const tooltip = $('#chart-tooltip');
    tooltip.innerHTML = `${vnTime(item.time, true)}<strong>${item[metric] == null ? '--' : item[metric].toFixed(config.decimals).replace('.', ',')} ${config.unit}</strong>${statusLabel(status).replace(/[✓△!—]\s*/, '')}`;
    tooltip.style.left = `${clamp(x(this.hoverIndex), 8, rect.width - 175)}px`; tooltip.style.top = `${clamp(item[metric] == null ? 50 : y(item[metric]), 42, rect.height - 42)}px`; tooltip.setAttribute('aria-hidden', 'false'); this.draw();
  }
}

const chart = new HistoryChart($('#history-chart'));

function updateChart() {
  const options = [...$('#metric-select').options];
  options.forEach(option => { option.disabled = !currentData().some(row => Number.isFinite(row[option.value])); });
  if (options.find(option => option.value === state.metric)?.disabled && options.some(option => !option.disabled)) state.metric = options.find(option => !option.disabled).value;
  $('#metric-select').value = state.metric;
  chart.hoverIndex = null; $('#chart-tooltip').setAttribute('aria-hidden', 'true');
  const config = METRICS[state.metric]; const data = currentData(); const chartState = $('#chart-state');
  $$('.chart-legend > span, .chart-legend > a', dashboardRoot).forEach(el => { if (el.querySelector('#metric-legend')) return; el.hidden = ['clarity', 'phVoltage', 'turbidityVoltage', 'turbidityChange'].includes(state.metric); });
  $('#clarity-zones').hidden = state.metric !== 'clarity';
  $('#clarity-zones').textContent = `${clarityRuleText(state.previewConfig ?? state.clarityConfig).zones} · >${CLARITY_DISPLAY_MAX_PCT}%: Ngoài dải đo`;
  $('#settings-preview-note').hidden = !state.previewConfig;
  $('#metric-legend').textContent = config.label; $('#metric-legend-line').style.background = config.color;
  $('#history-chart').setAttribute('aria-label', `Biểu đồ lịch sử ${config.label.toLowerCase()} trong ${state.range < 60 ? state.range + ' phút' : state.range / 60 + ' giờ'} qua`);
  $('#chart-summary').textContent = data.length ? `${data.filter(row => Number.isFinite(row[state.metric])).length} điểm · ${state.range === 10080 ? '7 ngày' : state.range < 60 ? state.range + ' phút' : state.range / 60 + ' giờ'} · Giờ Việt Nam` : 'Không có mẫu trong khoảng đã chọn';
  if (state.loading && !state.data.length) { chartState.hidden = false; chartState.className = 'chart-state loading'; chartState.innerHTML = '<span class="sr-only">Đang tải dữ liệu</span>'; }
  else if (state.error) { chartState.hidden = false; chartState.className = 'chart-state'; chartState.textContent = state.error; }
  else if (!data.some(row => Number.isFinite(row[state.metric]))) { chartState.hidden = false; chartState.className = 'chart-state'; chartState.innerHTML = '<div><div class="chart-state__icon">∿</div><strong>Chưa có dữ liệu</strong><p>Thiết bị chưa gửi mẫu đo hợp lệ trong khoảng thời gian này.</p></div>'; }
  else { chartState.hidden = true; }
  chart.draw();
}

function getActiveAlerts() {
  return state.alerts.filter(row => !row.ended_at && (profileForDevice().online || row.alert_type === 'offline'));
}

function renderAlerts(content = $('#alert-content'), all = false) {
  const active = getActiveAlerts(); $('#alert-count').textContent = active.length;
  const visible = state.alerts.filter(row => row.ended_at || profileForDevice().online || row.alert_type === 'offline');
  const sorted = [...(all || state.alertTab === 'recent' ? visible : active)].sort((a,b) => new Date(b.started_at) - new Date(a.started_at));
  const rows = all ? sorted : sorted.slice(0, window.innerWidth >= 1024 && window.innerHeight < 820 ? 2 : 3);
  if (state.error || state.loading && !state.device) { content.textContent = state.error || 'Đang tải cảnh báo…'; return; }
  if (!rows.length) {
    const known = sensorSummary(state.latest, profileForDevice().online).count === 3;
    content.innerHTML = `<div class="empty-state"><h3>${state.alertTab === 'recent' ? 'Chưa có lịch sử cảnh báo' : known ? 'Không có cảnh báo đang xảy ra' : 'Chưa đủ dữ liệu để đánh giá'}</h3><p>${known ? 'Theo bản ghi cảnh báo từ máy chủ.' : 'Kiểm tra kết nối và tuổi mẫu đo.'}</p><span class="checked-time">Kiểm tra lúc ${vnTime(state.lastUpdatedAt)}</span></div>`; return;
  }
  const labels = { clarity: 'Độ trong', temperature: 'Nhiệt độ', ph: 'Độ pH', turbidity: 'Độ trong · dữ liệu cũ', offline: 'Mất kết nối', sensor_error: 'Lỗi cảm biến (cũ)', sensor_error_temperature: 'Lỗi cảm biến nhiệt độ', sensor_error_ph: 'Lỗi cảm biến pH', sensor_error_clarity: 'Lỗi cảm biến độ trong' };
  content.innerHTML = `<div class="alert-list">${rows.map(row => {
    const level = row.ended_at ? 'resolved' : row.severity === 'critical' ? 'danger' : 'warning';
    const duration = Math.max(0, Math.floor(((row.ended_at ? new Date(row.ended_at).getTime() : Date.now()) - new Date(row.started_at).getTime()) / 60000));
    const status = row.ended_at ? row.message === 'Không có số đo vì thiết bị mất kết nối.' ? 'Đã gộp vào mất kết nối' : row.alert_type === 'sensor_error' ? 'Đã chuyển theo dõi' : 'Đã khắc phục' : row.severity === 'critical' ? 'Nguy hiểm' : 'Cảnh báo';
    return `<article class="alert-item ${level}"><span class="alert-item__icon">${row.ended_at ? '✓' : '!'}</span><div><div class="alert-item__title"><strong>${escapeHtml(labels[row.alert_type] || 'Cảnh báo thiết bị')}</strong><span>${status}</span></div><p>${escapeHtml(row.message)}</p><p>${new Date(row.started_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · ${durationLabel(duration)}</p>${row.acknowledged_at ? '<p>Đã xác nhận</p>' : `<button type="button" class="button button--secondary" data-ack="${Number(row.id)}">Xác nhận</button>`}</div></article>`;
  }).join('')}</div>`;
}

function showToast(title, message, type = 'success') {
  const toast = document.createElement('div'); toast.className = `toast ${type === 'error' ? 'toast--error' : ''}`; toast.setAttribute('role', 'status'); toast.innerHTML = `<span class="toast__icon">${type === 'error' ? '!' : '✓'}</span><div><strong>${title}</strong><small>${message}</small></div>`; $('#toast-region').append(toast); setTimeout(() => toast.remove(), 4000);
}

function renderAll() { updateHeader(); updateKpis(); updateChart(); renderAlerts(); if ($('#all-alerts').open) renderAlerts($('#all-alerts-content'), true); }

let refreshController;
async function refreshData(quiet = false) {
  if (state.saving || quiet && state.loading) return;
  refreshController?.abort();
  const controller = new AbortController(); refreshController = controller;
  const deviceId = state.deviceId;
  state.loading = true;
  const button = $('#refresh-button'); button.classList.add('is-loading'); button.disabled = true; updateChart();
  try {
    const result = await snapshot(deviceId, state.range, controller.signal);
    if (controller.signal.aborted || deviceId !== state.deviceId) return;
    state.device = result.device; state.latest = result.latest; state.lastValid = result.lastValid; state.data = result.history; state.clarityHistory = result.clarityHistory; state.alerts = result.alerts; state.baselines = result.baselines;
    state.thresholdsByDevice[deviceId] = result.thresholds; state.clarityConfig = result.clarityConfig; state.error = ''; state.lastUpdatedAt = new Date();
    state.settings = result.settings;
    settingsDrawer.accept(result.settings, deviceId);
  } catch (error) {
    if (controller.signal.aborted) return;
    state.error = error.message || 'Không tải được dữ liệu. Nhấn Làm mới để thử lại.';
  } finally {
    if (refreshController === controller) { state.loading = false; button.classList.remove('is-loading'); button.disabled = false; renderAll(); }
  }
}

listen($('#device-select'), 'change', async (event) => {
  if (settingsDrawer.dirty() && !window.confirm('Bạn có cài đặt chưa lưu. Chuyển thiết bị và bỏ thay đổi?')) { event.target.value = state.deviceId; return; }
  if (event.target.value === '__add__') { event.target.value = state.deviceId; $('#add-device').click(); return; }
  state.deviceId = event.target.value; onDeviceChange(state.deviceId); const url = new URL(location.href); url.searchParams.set('device_id', state.deviceId); history.replaceState(null, '', url); state.device = null; state.latest = null; state.lastValid = {}; state.alerts = []; state.data = []; state.clarityHistory = []; state.baselines = []; state.settings = null; state.clarityConfig = null; state.previewConfig = null; state.error = ''; settingsDrawer.accept(null, state.deviceId); renderAll(); await refreshData();
});

listen($('#refresh-button'), 'click', () => refreshData());
listen($('#connection-pill'), 'click', () => $('#device-info').showModal());
const openAlerts = () => { renderAlerts($('#all-alerts-content'), true); $('#all-alerts').showModal(); };
listen($('#alerts-toggle'), 'click', openAlerts);
listen($('#all-alerts-button'), 'click', openAlerts);
listen($('#chart-settings'), 'click', () => $('#open-settings').click());
const clarityCard = $('#turbidity-card');
// Every card uses the same icon / title / badge header.
$$('.kpi-grid > .kpi-card', dashboardRoot).forEach(card => {
  $('.kpi-card__head', card).insertBefore($('.kpi-card__label', card), $('.status-badge', card));
});
const clarityBadge = $('.status-badge', clarityCard);
clarityBadge.setAttribute('role', 'button'); clarityBadge.tabIndex = 0;
clarityBadge.setAttribute('aria-describedby', 'clarity-tooltip');
const showClarityTip = show => {
  const tip = $('#clarity-tooltip');
  tip.style.top = `${clarityBadge.offsetTop + clarityBadge.offsetHeight + 8}px`;
  tip.hidden = !show; clarityBadge.setAttribute('aria-expanded', String(show));
};
listen(clarityBadge, 'mouseenter', () => showClarityTip(true));
listen(clarityBadge, 'mouseleave', () => showClarityTip(false));
listen(clarityBadge, 'focus', () => showClarityTip(true));
listen(clarityBadge, 'blur', () => showClarityTip(false));
listen(clarityBadge, 'click', () => showClarityTip(true));
listen(clarityBadge, 'keydown', event => {
  if (event.key === 'Escape') showClarityTip(false);
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showClarityTip($('#clarity-tooltip').hidden); }
});
listen($('#clarity-details-toggle'), 'click', event => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  event.currentTarget.setAttribute('aria-expanded', String(open)); $('#clarity-details').hidden = !open;
});
listen($('#set-clean-reference'), 'click', () => {
  $('#clarity-confirm-time').textContent = vnTime(new Date()); $('#clarity-confirm').showModal();
});
listen($('#clarity-cancel'), 'click', () => $('#clarity-confirm').close());
listen($('#clarity-save'), 'click', async () => {
  if (state.baselineSaving) return;
  $('#clarity-confirm').close();
  const id = state.deviceId;
  state.baselineSaving = true; $('#device-select').disabled = true; updateKpis();
  settingsDrawer.accept(state.settings, state.deviceId);
  try {
    await request(id, '/clarity/baselines', { method: 'POST', body: JSON.stringify({ water_changed: true }) });
    showToast('Đã lưu mốc nước sạch', 'Áp dụng cho các mẫu mới; lịch sử cũ giữ nguyên.');
    await refreshData();
    await settingsDrawer.refreshHistory();
  } catch (error) { showToast('Chưa đặt được mốc', escapeHtml(error.message), 'error'); }
  finally { state.baselineSaving = false; $('#device-select').disabled = state.saving; settingsDrawer.accept(state.settings, state.deviceId); updateKpis(); }
});
listen($('#metric-select'), 'change', (event) => { state.metric = event.target.value; updateChart(); });
$$('[data-range]').forEach((button) => listen(button, 'click', () => {
  $$('[data-range]').forEach((item) => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-pressed', String(active)); });
  state.range = Number(button.dataset.range); updateChart(); refreshData();
}));
$$('[data-tab]').forEach((button) => listen(button, 'click', () => {
  state.alertTab = button.dataset.tab; $$('[data-tab]').forEach((item) => item.setAttribute('aria-selected', String(item === button))); renderAlerts();
}));

listen(root, 'click', async event => {
  const button = event.target.closest('[data-ack]'); if (!button) return;
  const deviceId = state.deviceId; button.disabled = true;
  try { await request(deviceId, `/alerts/${button.dataset.ack}/acknowledge`, { method: 'POST' }); if (deviceId === state.deviceId) await refreshData(); }
  catch (error) { showToast('Không xác nhận được', escapeHtml(error.message), 'error'); button.disabled = false; }
});
listen(window, 'beforeunload', (event) => { if (!settingsDrawer.dirty()) return; event.preventDefault(); event.returnValue = ''; });
listen(window, 'resize', () => { updateKpis(); chart.draw(); renderAlerts(); });

const requestedDevice = new URLSearchParams(location.search).get('device_id');
const validId = value => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
if (requestedDevice && validId(requestedDevice)) state.deviceId = requestedDevice;
$('#device-select').replaceChildren(...[...new Set([state.deviceId, 'tank-demo-001', 'tank-preview-001'])].map(id => new Option(id, id)));
$('#device-select').add(new Option('+ Thêm thiết bị', '__add__'));
$('#device-select').value = state.deviceId;
listen($('#add-device'), 'click', () => {
  if (state.saving) return;
  const id = prompt('Nhập mã thiết bị đã đăng ký (tối đa 64 ký tự):');
  if (!id) return;
  if (!validId(id)) { showToast('Mã không hợp lệ', 'Chỉ dùng chữ, số, dấu gạch ngang hoặc gạch dưới.', 'error'); return; }
  const select = $('#device-select'); if (![...select.options].some(option => option.value === id)) select.add(new Option(id, id), select.querySelector('option[value="__add__"]'));
  select.value = id; select.dispatchEvent(new Event('change'));
});
$$('[data-range]').forEach(button => { const active = Number(button.dataset.range) === state.range; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active)); });
onDeviceChange(state.deviceId);
const settingsDrawer = mountSettingsDrawer(root, {
  request, getDeviceId: () => state.deviceId,
  getCurrent: () => ({ latest: state.latest, baselines: state.baselines, clarityHistory: state.clarityHistory, baselineSaving: state.baselineSaving,
    canSetBaseline: !state.baselineSaving && profileForDevice().online && state.latest && Date.now() - state.latest.time < 60000 && Number.isFinite(state.latest.turbidityVoltage) }),
  onPreview: values => { state.previewConfig = values; updateChart(); updateKpis(); },
  onBusy: busy => { state.saving = busy; $('#device-select').disabled = busy || state.baselineSaving; },
  onSaved: async () => { await refreshData(); },
  onBaseline: () => $('#set-clean-reference').click(),
});
settingsDrawer.accept(null, state.deviceId);
renderAll(); refreshData();
const pollTimer = setInterval(() => { if (!document.hidden && realtimeLabel() !== 'Live') refreshData(true); }, 5000);
let lastChartClock = Date.now();
const ageTimer = setInterval(() => { updateHeader(); updateKpis(); if (Date.now() - lastChartClock >= 30000) { chart.draw(); lastChartClock = Date.now(); } }, 1000);

return { refresh: () => refreshData(true), dispose() {
  lifetime.abort(); refreshController?.abort(); clearInterval(pollTimer); clearInterval(ageTimer);
  settingsDrawer.dispose(); chart.resizeObserver.disconnect(); listeners.forEach(remove => remove());
} };
}
