import type { ThresholdValues } from '../types/monitoring'

export const STALE_AFTER_SECONDS = 60
export const CLOCK_SKEW_TOLERANCE_SECONDS = 30
export const thresholdFields = [
  'temperature_min_c', 'temperature_max_c', 'ph_min', 'ph_max',
  'turbidity_warning_pct', 'turbidity_critical_pct',
] as const
export type ThresholdDraft = Record<keyof ThresholdValues, string>

export function parseThresholds(draft: ThresholdDraft): { values: ThresholdValues | null; error: string } {
  const values = {} as ThresholdValues
  for (const field of thresholdFields) {
    if (!draft[field].trim() || !Number.isFinite(Number(draft[field]))) {
      return { values: null, error: 'Điền đủ sáu ngưỡng bằng số hợp lệ.' }
    }
    values[field] = Number(draft[field])
  }
  if (values.temperature_min_c < -55 || values.temperature_max_c > 125 || values.temperature_min_c >= values.temperature_max_c) {
    return { values: null, error: 'Nhiệt độ: tối thiểu phải nhỏ hơn tối đa, trong khoảng -55 đến 125 °C.' }
  }
  if (values.ph_min < 0 || values.ph_max > 14 || values.ph_min >= values.ph_max) {
    return { values: null, error: 'pH: tối thiểu phải nhỏ hơn tối đa, trong khoảng 0 đến 14.' }
  }
  if (values.turbidity_warning_pct < 0 || values.turbidity_critical_pct > 100 || values.turbidity_warning_pct >= values.turbidity_critical_pct) {
    return { values: null, error: 'Độ trong: cấu hình cũ chưa hợp lệ; ngưỡng thứ nhất phải nhỏ hơn ngưỡng thứ hai, trong khoảng 0 đến 100%.' }
  }
  return { values, error: '' }
}

export function sampleFreshness(timestamp: string | null, now: number) {
  const measured = timestamp === null ? NaN : Date.parse(timestamp)
  const age = Number.isFinite(measured) ? (now - measured) / 1000 : null
  const ageSeconds = age === null ? null : Math.max(0, Math.floor(age))
  const clockSkew = age !== null && age < -CLOCK_SKEW_TOLERANCE_SECONDS
  const stale = age !== null && age >= STALE_AFTER_SECONDS
  const label = ageSeconds === null ? 'Chưa có mẫu'
    : clockSkew ? 'Giờ mẫu ở tương lai'
    : ageSeconds < 10 ? 'vừa xong'
    : ageSeconds < 60 ? `${ageSeconds} giây trước`
    : ageSeconds < 3600 ? `${Math.floor(ageSeconds / 60)} phút trước`
    : ageSeconds < 86400 ? `${Math.floor(ageSeconds / 3600)} giờ trước`
    : `${Math.floor(ageSeconds / 86400)} ngày trước`
  return { ageSeconds, stale, clockSkew, label }
}
