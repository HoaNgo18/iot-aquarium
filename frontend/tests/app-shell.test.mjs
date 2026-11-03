import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, tankHref } from '../src/app/route.ts'
import { reminderGroup, dueLabel, groupReminders } from '../src/app/reminders.ts'
import { todayVN, validDate, numberText } from '../src/app/format.ts'
import { tankStatus, clarityLabel } from '../src/app/tanks.ts'
import { resolveTheme, themePreference } from '../src/app/theme.ts'
import { api, ApiError } from '../src/app/api.ts'

test('hash routes decode only valid pages and device ids', () => {
  for (const route of ['', '#/', '#/overview', '#/overview/']) assert.deepEqual(parseRoute(route), { page: 'overview' })
  for (const page of ['tanks', 'reminders', 'settings', 'notifications']) assert.deepEqual(parseRoute(`#/${page}`), { page })
  assert.deepEqual(parseRoute('#/tanks?add=1'), { page: 'tanks' })
  assert.deepEqual(parseRoute('#/tank/tank%2D001'), { page: 'tank', deviceId: 'tank-001' })
  assert.equal(tankHref('tank-001'), '#/tank/tank-001')
  for (const hash of ['#/tank/%', '#/tank/%2Fetc', '#/tank/a/b', '#/tank/', '#/missing', '#/tank/<script>']) assert.equal(parseRoute(hash).page, 'not-found')
})

test('reminder dates roll over at Vietnamese midnight, not UTC midnight', () => {
  const before = new Date('2026-11-03T16:59:59Z'), after = new Date('2026-11-03T17:00:00Z')
  assert.equal(todayVN(before), '2026-11-03')
  assert.equal(todayVN(after), '2026-11-04')
  assert.equal(reminderGroup({ due_date: '2026-11-03', done_at: null }, before), 'today')
  assert.equal(reminderGroup({ due_date: '2026-11-03', done_at: null }, after), 'overdue')
  assert.equal(dueLabel('2026-11-04', before), 'Ngày mai')
  assert.equal(dueLabel('2026-11-04', after), 'Hôm nay')
  assert.equal(dueLabel('2026-10-31', after), 'Quá hạn 4 ngày')
})

test('completed reminders stay done and scheduled repeats belong to the next date', () => {
  const now = new Date('2026-11-04T01:00:00Z')
  const items = [
    { id: 1, due_date: '2026-11-03', done_at: null },
    { id: 2, due_date: '2026-11-04', done_at: null },
    { id: 3, due_date: '2026-11-05', done_at: null, last_done_at: '2026-11-04T01:00:00Z' },
    { id: 4, due_date: '2026-11-01', done_at: '2026-11-02T01:00:00Z' },
  ]
  assert.deepEqual(groupReminders(items, now).map(group => group.items.map(item => item.id)), [[1], [2], [3], [4]])
  assert.equal(dueLabel('2026-12-01', now), '01/12/2026')
  assert.equal(validDate('2026-02-30'), false)
  assert.equal(validDate('2028-02-29'), true)
  assert.equal(dueLabel('not-a-date', now), 'Ngày không hợp lệ')
})

test('tank status does not label offline historical readings as normal', () => {
  const tank = { latest: {}, connectivity: 'online', open_alerts: 0 }
  assert.equal(tankStatus(tank).label, 'Bình thường')
  assert.equal(tankStatus({ ...tank, open_alerts: 3 }).label, '3 cảnh báo')
  assert.equal(tankStatus({ ...tank, connectivity: 'offline', open_alerts: 3 }).label, 'Mất kết nối')
  assert.equal(tankStatus({ ...tank, latest: null }).label, 'Chưa có dữ liệu')
  assert.equal(clarityLabel(445, 'clear'), 'Ngoài dải đo')
  assert.equal(clarityLabel(null, 'clear'), 'Chưa có số đo')
  assert.equal(clarityLabel(91, 'slight'), 'Hơi đục') // Server hysteresis wins over nominal bands.
  assert.equal(numberText(null), '—')
  assert.equal(numberText(NaN), '—')
})

test('theme honors explicit preference and follows system only in system mode', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(themePreference(null), 'system')
  assert.equal(themePreference('unknown'), 'system')
})

test('API keeps session credentials, handles 204 and hides Pydantic internals', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.credentials, 'same-origin')
      return new Response(null, { status: 204 })
    }
    assert.equal(await api('/auth/logout', { method: 'POST' }), undefined)
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: [{ loc: ['body', 'title'], msg: 'internal' }] }), { status: 422 })
    await assert.rejects(api('/reminders'), error => error instanceof ApiError && error.status === 422 && !error.message.includes('internal') && error.message.includes('Thông tin chưa hợp lệ'))
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Tên đăng nhập đã được dùng' }), { status: 409 })
    await assert.rejects(api('/auth/register'), { message: 'Tên đăng nhập đã được dùng' })
  } finally { globalThis.fetch = original }
})
