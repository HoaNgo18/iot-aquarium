export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export const SESSION_EVENT = 'aquasense:unauthorized'

// The existing dashboard also uses fetch. Observe its 401s without changing its renderer.
export function installSessionGuard() {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    const localApi = url.origin === location.origin && url.pathname.startsWith('/api/')
    const response = await original(input, localApi ? { ...init, credentials: 'same-origin' } : init)
    if (localApi && response.status === 401) window.dispatchEvent(new Event(SESSION_EVENT))
    return response
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options, credentials: 'same-origin',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ApiError('Không kết nối được máy chủ. Kiểm tra kết nối rồi thử lại.', 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const fallback = response.status === 422 ? 'Thông tin chưa hợp lệ. Kiểm tra các ô nhập.' : `Không thực hiện được yêu cầu (mã ${response.status}). Vui lòng thử lại.`
    throw new ApiError(typeof body.detail === 'string' ? body.detail : fallback, response.status)
  }
  return response.status === 204 ? undefined as T : response.json()
}
export const jsonBody = (value: unknown) => JSON.stringify(value)
