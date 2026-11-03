import { onScopeDispose, ref, watch, type Ref } from 'vue'

export type RealtimeState = 'connecting' | 'connected' | 'reconnecting' | 'offline'

/** WebSocket invalidates REST snapshots; coalesce bursts into bounded refreshes. */
export function useRealtime(deviceId: Ref<string>, sync: () => Promise<void>) {
  const state = ref<RealtimeState>('connecting')
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let attempts = 0
  let disposed = false
  let dirty = false
  let syncing = false
  let nextSyncAt = 0

  function clearHeartbeat() {
    clearInterval(heartbeat)
    clearTimeout(pongTimer)
    heartbeat = undefined
    pongTimer = undefined
  }

  function closeSocket() {
    clearHeartbeat()
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
      socket.close()
      socket = null
    }
  }

  function scheduleSync(delay = 100) {
    dirty = true
    if (disposed || syncing || syncTimer !== undefined) return
    const currentGeneration = generation
    syncTimer = setTimeout(async () => {
      syncTimer = undefined
      dirty = false
      syncing = true
      nextSyncAt = Date.now() + 1000
      try {
        await sync()
      } finally {
        if (disposed || currentGeneration !== generation) return
        syncing = false
        if (dirty) scheduleSync(1000)
      }
    }, Math.max(delay, nextSyncAt - Date.now()))
  }

  function scheduleReconnect() {
    if (disposed || retryTimer !== undefined) return
    state.value = navigator.onLine ? 'reconnecting' : 'offline'
    if (!navigator.onLine) return
    const delay = Math.min(1000 * 2 ** Math.min(attempts++, 4), 15000)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      connect()
    }, delay)
  }

  function connect() {
    if (disposed) return
    closeSocket()
    if (!navigator.onLine) {
      state.value = 'offline'
      return
    }
    const targetDevice = deviceId.value
    const url = new URL('/ws', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('device_id', targetDevice)
    let connection: WebSocket
    try {
      connection = new WebSocket(url)
    } catch {
      scheduleReconnect()
      return
    }
    socket = connection

    connection.onopen = () => {
      if (disposed || socket !== connection) return
      attempts = 0
      state.value = 'connected'
      scheduleSync()
      heartbeat = setInterval(() => {
        if (connection.readyState !== WebSocket.OPEN) return
        connection.send('ping')
        pongTimer = setTimeout(() => connection.close(), 10000)
      }, 15000)
    }
    connection.onmessage = (message) => {
      if (disposed || socket !== connection || targetDevice !== deviceId.value) return
      let event: unknown
      try { event = JSON.parse(message.data) } catch { return }
      if (!event || typeof event !== 'object') return
      const envelope = event as Record<string, unknown>
      if (envelope.type === 'pong') {
        clearTimeout(pongTimer)
        pongTimer = undefined
        return
      }
      if (envelope.device_id !== targetDevice) return
      if (envelope.type === 'telemetry' || envelope.type === 'status' || envelope.type === 'alerts') {
        scheduleSync()
      }
    }
    connection.onerror = () => connection.close()
    connection.onclose = (event) => {
      if (disposed || socket !== connection) return
      clearHeartbeat()
      socket = null
      if (event.code === 4401) {
        state.value = 'offline'
        window.dispatchEvent(new Event('aquasense:unauthorized'))
        return
      }
      scheduleReconnect()
    }
  }

  function restart() {
    generation++
    clearTimeout(retryTimer)
    clearTimeout(syncTimer)
    retryTimer = syncTimer = undefined
    dirty = syncing = false
    nextSyncAt = 0
    attempts = 0
    state.value = 'connecting'
    connect()
  }

  function offline() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    clearTimeout(syncTimer)
    syncTimer = undefined
    dirty = false
    closeSocket()
    state.value = 'offline'
  }
  function online() { restart() }
  function visible() {
    if (document.visibilityState !== 'visible') return
    if (socket?.readyState === WebSocket.OPEN) scheduleSync()
    else restart()
  }

  window.addEventListener('offline', offline)
  window.addEventListener('online', online)
  document.addEventListener('visibilitychange', visible)
  watch(deviceId, restart, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    generation++
    clearTimeout(retryTimer)
    clearTimeout(syncTimer)
    closeSocket()
    window.removeEventListener('offline', offline)
    window.removeEventListener('online', online)
    document.removeEventListener('visibilitychange', visible)
  })

  return { state }
}
