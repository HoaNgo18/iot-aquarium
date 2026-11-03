export const VN_ZONE = 'Asia/Ho_Chi_Minh'
export function todayVN(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: VN_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export function formatDate(value: string, short = false): string {
  if (!validDate(value)) return 'Ngày không hợp lệ'
  const [year, month, day] = value.split('-')
  return short ? `${day}/${month}` : `${day}/${month}/${year}`
}
export function formatStamp(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Chưa có thời điểm đo'
  return new Intl.DateTimeFormat('vi-VN', { timeZone: VN_ZONE, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
}
export function relativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'chưa có mẫu'
  const age = Math.floor((now - Date.parse(value)) / 1000)
  if (age < -30) return 'giờ mẫu ở tương lai'
  if (age < 10) return 'vừa xong'
  if (age < 60) return `${age} giây trước`
  if (age < 3600) return `${Math.floor(age / 60)} phút trước`
  if (age < 86400) return `${Math.floor(age / 3600)} giờ trước`
  return `${Math.floor(age / 86400)} ngày trước`
}
export function numberText(value: number | null | undefined, decimals = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—'
}
