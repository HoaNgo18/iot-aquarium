import type { Tank } from './types.ts'
export function tankStatus(tank: Pick<Tank, 'latest' | 'connectivity' | 'open_alerts'>) {
  if (!tank.latest) return { label: 'Chưa có dữ liệu', tone: 'neutral' }
  if (tank.connectivity !== 'online') return { label: 'Mất kết nối', tone: 'neutral' }
  if (tank.open_alerts > 0) return { label: `${tank.open_alerts} cảnh báo`, tone: 'warning' }
  return { label: 'Bình thường', tone: 'normal' }
}
export function clarityLabel(value: number | null | undefined, state: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Chưa có số đo'
  if (value > 120) return 'Ngoài dải đo'
  return ({ clear: 'Trong', slight: 'Hơi đục', cloudy: 'Đục' } as Record<string, string>)[state ?? ''] ?? 'Chờ đánh giá'
}
