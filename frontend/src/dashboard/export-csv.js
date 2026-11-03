// Xuất toàn bộ mẫu thô (không rút gọn như biểu đồ) qua /telemetry/export.csv.
export const EXPORT_MAX_DAYS = 31;
const MAX_MS = EXPORT_MAX_DAYS * 86400000;

const pad = value => String(value).padStart(2, '0');

// Giá trị cho <input type="datetime-local"> theo giờ máy người dùng.
export function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function presetRange(minutes, now = new Date()) {
  return { from: new Date(now.getTime() - minutes * 60000), to: now };
}

export function exportRange(fromValue, toValue, now = new Date()) {
  if (!fromValue || !toValue) return { error: 'Chọn đủ thời điểm bắt đầu và kết thúc.' };
  const from = new Date(fromValue), to = new Date(toValue);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'Thời gian không hợp lệ.' };
  if (from >= to) return { error: 'Thời điểm bắt đầu phải trước thời điểm kết thúc.' };
  if (to - from > MAX_MS) return { error: `Chỉ xuất tối đa ${EXPORT_MAX_DAYS} ngày mỗi lần.` };
  if (from > now) return { error: 'Khoảng thời gian nằm hoàn toàn trong tương lai.' };
  return { from, to };
}

export function exportUrl(deviceId, from, to) {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return `/api/v1/devices/${encodeURIComponent(deviceId)}/telemetry/export.csv?${query}`;
}

export function filenameFrom(header, fallback) {
  const match = /filename="([^"]+)"/.exec(header || '');
  return match ? match[1] : fallback;
}

export async function downloadCsv(deviceId, from, to, signal) {
  const timeout = AbortSignal.timeout(60000);
  const response = await fetch(exportUrl(deviceId, from, to), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Xuất dữ liệu thất bại (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  const rows = Number(response.headers.get('X-Row-Count'));
  return { blob, rows: Number.isFinite(rows) ? rows : null, filename: filenameFrom(response.headers.get('Content-Disposition'), `${deviceId}.csv`) };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
