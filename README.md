# IoT Aquarium

Hệ thống theo dõi nhiệt độ, pH và độ đục tương đối của nước trong bể cá. ESP32 gửi dữ liệu qua MQTT về server; giao diện web hiển thị số đo, lịch sử và cảnh báo khi vượt ngưỡng cấu hình.

## Chức năng

- Theo dõi số đo và trạng thái kết nối của thiết bị.
- Xem biểu đồ lịch sử theo từng chỉ số.
- Cấu hình ngưỡng và xác nhận cảnh báo.
- Giả lập dữ liệu để thử hệ thống khi chưa kết nối cảm biến.

## Công nghệ

- **Thiết bị:** ESP32, DS18B20, PH-4502C, cảm biến độ đục MJKDZ.
- **Backend:** Python, FastAPI, PostgreSQL, Mosquitto MQTT.
- **Frontend:** Vue 3, TypeScript, Vite; cập nhật dữ liệu qua WebSocket.
- **Triển khai:** Docker Compose; firmware quản lý bằng PlatformIO.

## Chạy local

Cần Docker Compose. Tạo `.env` từ `.env.example` nếu chưa có, điều chỉnh cấu hình rồi khởi động:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build
```

- Giao diện: http://localhost:5173
- API: http://localhost:8000/docs

## Cấu trúc thư mục

```text
backend/         FastAPI: api -> services/domain -> repositories, migration Alembic
firmware/        ESP32 (PlatformIO), test host, sketch chẩn đoán
frontend/        Dashboard Vue; tests/ là unit test, tests/browser/ là kịch bản Playwright
simulator/       Bộ phát telemetry giả lập qua MQTT
infrastructure/  Cấu hình Mosquitto
scripts/         Smoke test toàn hệ thống; uart/ là công cụ thu và phân tích log Serial
```

## Tài liệu

- [Cấu hình và nạp firmware](firmware/README.md)
- [Chạy dữ liệu giả lập](simulator/README.md)
