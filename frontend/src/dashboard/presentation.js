// Display validity guard only: never clamp or rewrite stored clarity values.
export const CLARITY_DISPLAY_MAX_PCT = 120;

export function clarityPresentation(row) {
  const value = row?.clarity;
  if (!Number.isFinite(value)) return { label: '--', state: 'unknown', note: 'Chưa từng có số đo hợp lệ', outside: false };
  if (value > CLARITY_DISPLAY_MAX_PCT) return {
    label: 'Ngoài dải đo', state: 'outside', outside: true,
    note: `Tín hiệu vượt mốc ${(value / 100).toFixed(1).replace('.', ',')} lần`,
  };
  const note = !row.clarityBaselineAt ? 'So với mốc thử, chưa đặt mốc nước sạch'
    : value > 100 ? 'Tín hiệu cao hơn mốc nước sạch'
    : row.clarityState === 'cloudy' ? 'Giảm rõ so với mốc · kiểm tra lọc'
    : row.clarityState === 'slight' ? 'Giảm nhẹ so với mốc nước sạch' : 'Gần mốc nước sạch';
  return { label: { clear: 'TRONG', slight: 'HƠI ĐỤC', cloudy: 'ĐỤC' }[row.clarityState] ?? 'ĐỘ TRONG',
    state: row.clarityState ?? 'unknown', note, outside: false };
}

export function temperaturePresentation(value, { tempMin, tempMax }) {
  const number = value => String(value).replace('.', ',');
  if (value > tempMax) return { badge: `Cao hơn ngưỡng ${number(tempMax)} °C`,
    note: `Cao hơn khoảng đã đặt ${number(tempMin)}–${number(tempMax)} °C` };
  if (value < tempMin) return { badge: `Thấp hơn ngưỡng ${number(tempMin)} °C`,
    note: `Thấp hơn khoảng đã đặt ${number(tempMin)}–${number(tempMax)} °C` };
  return { badge: 'Trong khoảng đã đặt', note: `Trong khoảng ${number(tempMin)}–${number(tempMax)} °C` };
}

export function durationLabel(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  return total < 60 ? `${total} phút` : `${Math.floor(total / 60)} giờ ${total % 60} phút`;
}

export function clarityRuleText(rules) {
  if (!rules) return { zones: 'Đang tải ngưỡng độ trong…', recovery: '' };
  const { clear_min_pct: clear, cloudy_below_pct: cloudy,
    clear_recovery_above_pct: clearRecovery, cloudy_recovery_above_pct: cloudyRecovery } = rules;
  return {
    zones: `Trong ≥${clear}% · Hơi đục ${cloudy}–<${clear}% · Đục <${cloudy}%`,
    recovery: `Phục hồi: Đục → Hơi đục khi >${cloudyRecovery}%; Hơi đục → Trong khi >${clearRecovery}%.`,
  };
}

export function sensorSummary(reading, online, now = Date.now()) {
  if (!online || !reading || now - reading.time >= 60000 || reading.time - now > 30000 || !reading.sensorHealth) {
    return { count: null, label: 'Cảm biến: chưa có mẫu mới', detail: 'Chờ dữ liệu mới để xác định trạng thái cảm biến.' };
  }
  const names = { temperature: 'nhiệt độ', ph: 'pH', clarity: 'độ trong' };
  const healthy = Object.keys(names).filter(key => reading.sensorHealth[key] === true);
  const failed = Object.keys(names).filter(key => reading.sensorHealth[key] !== true);
  const phPending = Number.isFinite(reading.phVoltage) && !Number.isFinite(reading.ph);
  return { count: healthy.length, label: `Cảm biến ${healthy.length}/3 hoạt động`,
    detail: (failed.length ? `Chưa có số đo hợp lệ: ${failed.map(key => names[key]).join(', ')}.` : 'Cả 3 cảm biến có tín hiệu.') +
      (phPending ? ' pH đã nhận tín hiệu, chưa hiệu chuẩn.' : '') };
}
