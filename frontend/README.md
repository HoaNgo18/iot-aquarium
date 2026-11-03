# Frontend duy nhất — AquaSense
Vue 3/TypeScript/Vite. Chạy npm ci, npm test, npm run build hoặc npm run dev.
Docker phục vụ bản production ở http://localhost:5173. Vite/Nginx proxy /api và /ws đến backend.
Dashboard mặc định tank-demo-001; chọn mã đã biết, Thêm mã hoặc query device_id.
src/views/DashboardView.vue quản lý vòng đời; src/dashboard chứa template, renderer, API adapter.
useRealtime.ts giữ WebSocket heartbeat/reconnect; polling 5 giây chỉ dự phòng.
KPI null/offline/lỗi API hiển thị --; biểu đồ vẫn đọc lịch sử thật, ngắt tại null, tối đa 500 mẫu.
Ngưỡng lưu qua PUT; xác nhận cảnh báo qua POST không đóng cảnh báo.
Màu xanh biển, không có vạch bên trái KPI. Thời gian hiển thị Asia/Ho_Chi_Minh.
11 unit test; tests/browser/browser-qa.js chạy với Playwright CLI run-code (mock API, không ghi thử vào backend thật).
Không chạy server.mjs hay Python http.server; không còn frontend standalone.
