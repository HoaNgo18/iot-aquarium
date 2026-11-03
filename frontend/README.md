# AquaSense frontend

Vue 3, TypeScript và Vite. Khung ứng dụng gồm đăng nhập, Tổng quan, Bể của tôi, Nhắc việc, Thông báo và Cài đặt. Trang chi tiết bể nhúng dashboard đo trực tiếp hiện có.

## Chạy thử

Từ thư mục gốc repo:

```powershell
docker compose up -d --build backend frontend
docker compose exec backend python -m app.cli pairing-code tank-ds18b20-001
```

Mở http://localhost:5173, tạo tài khoản rồi chọn **Bể của tôi → Thêm bể**. Nhập mã thiết bị và mã ghép nối vừa lấy. Xoá bể chỉ bỏ ghép nối, giữ dữ liệu đo và xoá nhắc việc thuộc bể đó.

Để phát triển frontend, chạy trong `frontend/`:

```powershell
npm ci
npm run dev
npm test
npm run build
```

Vite/Nginx chuyển `/api` và `/ws` tới backend. Phiên đăng nhập dùng cookie httpOnly cùng origin. Không lưu mật khẩu hoặc token trong localStorage; chỉ lưu lựa chọn giao diện, trạng thái thanh bên và bể đang chọn (`aquasense-overview-tank`).

Tổng quan hiển thị bể đang chọn, ba số đo, biểu đồ 24 giờ, cảnh báo và việc đến hạn. Biểu đồ tải riêng mỗi 60 giây, huỷ yêu cầu khi đổi bể. Phần giới thiệu dự án nằm trên trang đăng nhập.

## Cấu trúc

- `src/App.vue`: khung trang, điều hướng bằng hash, kiểm tra phiên.
- `src/main.ts`, `index.html`: khởi tạo theme trước khi mount, mô tả trang.
- `src/app/api.ts`, `session.ts`, `types.ts`: gọi API, phiên, tải dữ liệu và tổng hợp thông báo. Danh sách tự làm mới mỗi 10 giây khi tab hiển thị.
- `src/app/route.ts`, `format.ts`, `reminders.ts`, `tanks.ts`, `theme.ts`: route, định dạng, ngày Việt Nam, trạng thái và theme.
- `src/app/shell.css`: bố cục desktop/mobile, tái sử dụng biến màu hiện có.
- `src/components/AppSidebar.vue`, `AppIcon.vue`, `AppDialog.vue`, `ConfirmDialog.vue`, `PasswordField.vue`, `TankCard.vue`: điều hướng, biểu tượng và form dùng chung.
- `src/components/AquariumScene.vue`: mô hình SVG có dữ liệu thật, trạng thái mất kết nối và reduced motion. Chỉ dùng số minh hoạ khi chưa có bể, có ghi nhãn rõ.
- `src/views/AuthView.vue`, `OverviewView.vue`, `TanksView.vue`, `TankDetailView.vue`, `RemindersView.vue`, `NotificationsView.vue`, `SettingsView.vue`: các trang mới.
- `src/views/DashboardView.vue`, `src/dashboard/`: dashboard cũ được nhúng nguyên trạng, giữ công thức và bộ lọc cảm biến.
- `src/composables/useRealtime.ts`: WebSocket; mã đóng 4401 đưa người dùng về đăng nhập.
- `tests/app-shell.test.mjs`: kiểm tra route, ngày, trạng thái, theme và API.
- `tests/browser/app-shell-browser-qa.js`: kiểm tra luồng giao diện với API giả lập, không ghi tài khoản/bể/nhắc việc vào backend thật.

Các route: `#/`, `#/tanks`, `#/tank/<device_id>`, `#/reminders`, `#/notifications`, `#/settings`.

## Kiểm tra trình duyệt

Từ thư mục gốc repo, khi frontend chạy trên cổng 5173:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=aquasense-shell open http://localhost:5173/
npx --yes --package @playwright/cli playwright-cli -s=aquasense-shell run-code --filename frontend/tests/browser/app-shell-browser-qa.js
npx --yes --package @playwright/cli playwright-cli -s=aquasense-shell run-code --filename frontend/tests/browser/overview-dashboard-qa.js
```

Ảnh kiểm tra lưu tại `output/playwright/`. Kiểm tra gồm form, CRUD, nhắc việc lặp, thông báo, theme, màn hình 360px, phiên hết hạn và thử lại API lỗi. Luồng ghép nối thiết bị thật cần tài khoản và mã ghép nối của người dùng; kiểm tra tự động không tạo dữ liệu thật.
