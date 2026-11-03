export type Page = 'overview' | 'tanks' | 'tank' | 'reminders' | 'notifications' | 'settings' | 'not-found'
export interface Route { page: Page; deviceId?: string }
export const PAGE_TITLES: Record<Page, string> = {
  overview: 'Tổng quan', tanks: 'Bể của tôi', tank: 'Chi tiết bể', reminders: 'Nhắc việc',
  notifications: 'Thông báo', settings: 'Cài đặt', 'not-found': 'Không tìm thấy trang',
}
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0].replace(/\/$/, '') || '/'
  if (path === '/' || path === '/overview') return { page: 'overview' }
  for (const page of ['tanks', 'reminders', 'notifications', 'settings'] as const) {
    if (path === `/${page}`) return { page }
  }
  const match = /^\/tank\/([^/]+)$/.exec(path)
  if (match) {
    try {
      const deviceId = decodeURIComponent(match[1])
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(deviceId)) return { page: 'tank', deviceId }
    } catch { /* Malformed URL is a not-found route. */ }
  }
  return { page: 'not-found' }
}
export const tankHref = (deviceId: string) => `#/tank/${encodeURIComponent(deviceId)}`
