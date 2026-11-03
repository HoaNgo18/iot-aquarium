export const TEMPERATURE_PRESETS = {
  custom: { label: 'Tùy chỉnh' },
  tropical: { label: 'Cá cảnh nhiệt đới', min: 24, max: 26,
    source: 'https://www.aquariumindustries.com.au/wp-content/uploads/2015/05/IntroductoryTopics.pdf' },
  goldfish: { label: 'Cá vàng', min: 18, max: 24,
    source: 'https://extension.rwfm.tamu.edu/wp-content/uploads/sites/8/2013/09/SRAC-Publication-No.-7201-Species-Profile-Koi-and-Goldfish.pdf' },
  koi: { label: 'Cá koi', min: 18, max: 24,
    source: 'https://extension.rwfm.tamu.edu/wp-content/uploads/sites/8/2013/09/SRAC-Publication-No.-7201-Species-Profile-Koi-and-Goldfish.pdf' },
};
export const SENSITIVITY = {
  sensitive: { label: 'Nhạy', median_window: 5, ema_seconds: 5 },
  standard: { label: 'Chuẩn', median_window: 15, ema_seconds: 20 },
  low: { label: 'Ít nhạy', median_window: 31, ema_seconds: 60 },
};
export const SETTING_LABELS = {
  temperature_min_c: 'Nhiệt độ tối thiểu', temperature_max_c: 'Nhiệt độ tối đa', temperature_preset: 'Nhóm cá',
  ph_min: 'pH tối thiểu', ph_max: 'pH tối đa', clear_min_pct: 'Ngưỡng Hơi đục', cloudy_below_pct: 'Ngưỡng Đục',
  clear_recovery_above_pct: 'Ngưỡng về Trong', cloudy_recovery_above_pct: 'Ngưỡng thoát Đục', auto_hysteresis: 'Tự đặt ngưỡng thoát',
  alert_after_seconds: 'Thời gian cảnh báo độ trong', sensor_timeout_minutes: 'Thời gian chờ cảm biến',
  sensitivity: 'Độ nhạy', median_window: 'Số mẫu trung vị', ema_seconds: 'Thời gian EMA',
  reference_mv: 'Mốc nước sạch', water_changed: 'Thay nước',
};
export function autoRecovery(values) {
  return { ...values, clear_recovery_above_pct: Math.min(100, values.clear_min_pct + 3),
    cloudy_recovery_above_pct: Math.min(values.clear_min_pct - 1, values.cloudy_below_pct + 5) };
}
export function validateSettings(values) {
  const errors = {};
  const limits = {
    temperature_min_c: [-55, 125], temperature_max_c: [-55, 125], ph_min: [0, 14], ph_max: [0, 14],
    clear_min_pct: [1, 99], cloudy_below_pct: [0, 98], clear_recovery_above_pct: [0, 100],
    cloudy_recovery_above_pct: [0, 100], sensor_timeout_minutes: [0, 60], median_window: [1, 61],
    ema_seconds: [1, 300], alert_after_seconds: [60, 86400],
  };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isFinite(values[key]) || values[key] < min || values[key] > max) errors[key] = `Nhập số từ ${key === 'alert_after_seconds' ? min / 60 : min} đến ${key === 'alert_after_seconds' ? max / 60 : max}.`;
  }
  for (const [min, max] of [['temperature_min_c', 'temperature_max_c'], ['ph_min', 'ph_max']]) {
    if (values[min] >= values[max]) { errors[min] = 'Tối thiểu phải nhỏ hơn tối đa.'; errors[max] = 'Tối đa phải lớn hơn tối thiểu.'; }
  }
  if (values.cloudy_below_pct >= values.clear_min_pct) {
    errors.cloudy_below_pct = 'Ngưỡng Đục phải thấp hơn ngưỡng Hơi đục.';
    errors.clear_min_pct = errors.cloudy_below_pct;
  }
  if (!(values.cloudy_below_pct < values.cloudy_recovery_above_pct && values.cloudy_recovery_above_pct < values.clear_min_pct)) {
    errors.cloudy_recovery_above_pct = 'Ngưỡng thoát Đục phải nằm giữa ngưỡng Đục và Hơi đục.';
  }
  if (!(values.clear_min_pct < values.clear_recovery_above_pct && values.clear_recovery_above_pct <= 100)) {
    errors.clear_recovery_above_pct = 'Ngưỡng về Trong phải cao hơn ngưỡng Hơi đục, tối đa 100%.';
  }
  if (!Number.isInteger(values.median_window) || values.median_window % 2 !== 1) errors.median_window = 'Nhập số lẻ từ 1 đến 61.';
  if (!Number.isInteger(values.alert_after_seconds)) errors.alert_after_seconds = 'Nhập thời gian hợp lệ.';
  return errors;
}
