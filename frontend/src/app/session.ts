import { computed, inject, reactive, type InjectionKey } from 'vue'
import { api, ApiError, SESSION_EVENT } from './api'
import { reminderGroup } from './reminders'
import type { User, Tank, Reminder, TankAlert } from './types'
import type { AlertRecord } from '../types/monitoring'

export function createSession() {
  const state = reactive({
    user: null as User | null, checking: true, authError: '', expired: false,
    tanks: [] as Tank[], reminders: [] as Reminder[], alerts: [] as TankAlert[],
    loadingTanks: false, loadingReminders: false, loadingAlerts: false,
    tanksError: '', remindersError: '', alertsError: '', loadedTanks: false, loadedReminders: false,
    now: new Date(), notice: '',
  })
  let generation = 0
  let refreshing: Promise<void> | null = null
  let controller = new AbortController()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  function notify(message: string) {
    state.notice = message; clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { state.notice = '' }, 6000)
  }
  function clear() {
    generation++; controller.abort(); controller = new AbortController(); refreshing = null
    state.user = null; state.tanks = []; state.reminders = []; state.alerts = []
    state.tanksError = state.remindersError = state.alertsError = state.notice = ''
    state.loadingTanks = state.loadingReminders = state.loadingAlerts = false
    state.loadedTanks = state.loadedReminders = false
    clearTimeout(noticeTimer)
  }
  function expire() {
    const hadUser = Boolean(state.user)
    clear(); state.expired = hadUser || state.expired; state.checking = false
  }
  async function refresh(force = false): Promise<void> {
    if (!state.user) return
    if (refreshing && !force) return refreshing
    if (force) { controller.abort(); controller = new AbortController(); generation++ }
    const current = generation, signal = controller.signal
    const valid = () => current === generation && Boolean(state.user) && !signal.aborted
    state.loadingTanks = state.loadingReminders = true
    const work = async () => {
      await Promise.all([
        (async () => {
          try {
            const tanks = await api<Tank[]>('/tanks', { signal })
            if (!valid()) return
            state.tanks = tanks; state.tanksError = ''; state.loadedTanks = true; state.loadingAlerts = true
            const alerts = await Promise.allSettled(tanks.map(async tank => {
              const rows = await api<AlertRecord[]>(`/devices/${encodeURIComponent(tank.device_id)}/alerts?limit=50`, { signal })
              return rows.filter(row => !row.ended_at).map(row => ({ ...row, tank_name: tank.name }))
            }))
            if (!valid()) return
            state.alerts = alerts.flatMap(result => result.status === 'fulfilled' ? result.value : [])
            state.alertsError = alerts.some(result => result.status === 'rejected') ? 'Chưa tải được cảnh báo của một số bể. Vui lòng thử lại.' : ''
          } catch (error) {
            if (valid()) state.tanksError = (error as Error).message
          } finally {
            if (valid()) state.loadingTanks = state.loadingAlerts = false
          }
        })(),
        (async () => {
          try {
            const rows = await api<Reminder[]>('/reminders', { signal })
            if (!valid()) return
            state.reminders = rows; state.remindersError = ''; state.loadedReminders = true
          } catch (error) {
            if (valid()) state.remindersError = (error as Error).message
          } finally { if (valid()) state.loadingReminders = false }
        })(),
      ])
    }
    const pending = work()
    refreshing = pending
    await pending
    if (refreshing === pending) refreshing = null
  }
  async function authenticated(user: User) {
    clear(); state.user = user; state.expired = false; state.authError = ''; state.checking = false
    await refresh()
  }
  async function initialize() {
    state.checking = true; state.authError = ''
    try { await authenticated(await api<User>('/auth/me')) }
    catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) state.authError = (error as Error).message
    } finally { state.checking = false }
  }
  async function logout() {
    await api<void>('/auth/logout', { method: 'POST' })
    clear(); state.expired = false
  }
  const dueReminders = computed(() => state.reminders.filter(item => ['overdue', 'today'].includes(reminderGroup(item, state.now))))
  const notificationCount = computed(() => state.tanks.reduce((total, tank) => total + tank.open_alerts, 0) + dueReminders.value.length)
  const tick = setInterval(() => {
    state.now = new Date()
    if (!document.hidden) void refresh()
  }, 10000)
  const visible = () => { state.now = new Date(); if (!document.hidden) void refresh() }
  window.addEventListener(SESSION_EVENT, expire)
  document.addEventListener('visibilitychange', visible)
  return { state, dueReminders, notificationCount, initialize, authenticated, refresh, notify, logout,
    dispose() { clear(); clearInterval(tick); window.removeEventListener(SESSION_EVENT, expire); document.removeEventListener('visibilitychange', visible) } }
}
export type Session = ReturnType<typeof createSession>
export const SessionKey: InjectionKey<Session> = Symbol('aquasense-session')
export function useSession(): Session {
  const session = inject(SessionKey)
  if (!session) throw new Error('Ứng dụng chưa được khởi tạo')
  return session
}
