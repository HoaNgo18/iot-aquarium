import { formatDate, todayVN, validDate } from './format.ts'
import type { Reminder, Repeat } from './types.ts'
export type ReminderGroup = 'overdue' | 'today' | 'upcoming' | 'done'
export const GROUPS: { key: ReminderGroup; label: string }[] = [
  { key: 'overdue', label: 'Quá hạn' }, { key: 'today', label: 'Hôm nay' },
  { key: 'upcoming', label: 'Sắp tới' }, { key: 'done', label: 'Đã xong' },
]
export const REPEAT_LABELS: Record<Repeat, string> = { none: 'Một lần', daily: 'Hằng ngày', weekly: 'Mỗi tuần', biweekly: 'Mỗi 2 tuần', monthly: 'Mỗi tháng' }
export function reminderGroup(item: Pick<Reminder, 'done_at' | 'due_date'>, now = new Date()): ReminderGroup {
  if (item.done_at) return 'done'
  if (!validDate(item.due_date)) return 'upcoming'
  const today = todayVN(now)
  return item.due_date < today ? 'overdue' : item.due_date === today ? 'today' : 'upcoming'
}
export function dueLabel(value: string, now = new Date()): string {
  if (!validDate(value)) return 'Ngày không hợp lệ'
  const days = Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${todayVN(now)}T00:00:00Z`)) / 86400000)
  return days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Hôm nay' : days === 1 ? 'Ngày mai' : formatDate(value)
}
export function groupReminders(items: Reminder[], now = new Date()) {
  return GROUPS.map(group => ({ ...group, items: items.filter(item => reminderGroup(item, now) === group.key)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id) }))
}
