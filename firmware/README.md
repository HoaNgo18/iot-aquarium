# Firmware ESP32 — giám sát bể cá

Ngày 24/10 đã nạp esp32-sensors, chỉ bật DS18B20 GPIO4, ID local tank-ds18b20-001.
8/8 mẫu UART khớp REST; web hiển thị nhiệt độ thật. pH/độ đục vẫn null, PIR tắt.
[Kết quả DS18B20 và giới hạn kiểm chứng](../docs/logs/ds18b20-bringup-2026-10-24.md).

Firmware nền đã build được cho **ESP32 Dev Module / ESP32-WROOM thông thường** (`esp32dev`).
Ngày 22/10 nhận diện ESP32-D0WD-V3 rev3.1, flash 4 MB, CP210x/COM3; esp32-fake đã nạp và boot thành công.
Không dùng nguyên cấu hình này cho ESP32-C3/S3. Đã kiểm tra mạng 2.4 GHz/NTP/MQTT,
12 mẫu khớp PostgreSQL/REST và web realtime; cảnh báo độ đục cao đã mở rồi đóng khi về normal.
Còn kiểm tra reconnect/Last Will, chạy dài và hiện tượng UART lặp/lỗi khi mở lại COM; cảm biến thật chưa kiểm chứng.
[Kết quả và giới hạn kiểm thử](../docs/logs/esp32-bringup-2026-10-22.md).

## Chế độ build

| Environment | Mã thiết bị mặc định | Dữ liệu |
| --- | --- | --- |
| esp32-fake | tank-demo-001 | Dữ liệu giả, bảy kịch bản để thử dashboard/cảnh báo |
| esp32-sensors | tank-001 | Đọc DS18B20 và hai kênh analog theo cấu hình; chưa cấu hình/hiệu chuẩn thì null |
| esp32-pending-sensors | tank-001 | Alias tương thích của esp32-sensors, không còn là stub |

Không chạy simulator và ESP32 cùng `device_id` trên một broker.
Giữ thiết bị demo riêng để không trộn số liệu giả vào thực nghiệm.
PIR HC-SR501 → LED có code tùy chọn, mặc định tắt và chưa kiểm chứng trên board.
Chức năng chạy cục bộ, không thêm trường vào telemetry v2; ba cảm biến nước vẫn là MVP.

## Cấu hình và build

Cài PlatformIO vào môi trường Python riêng, tránh xung đột với dependencies của backend:

```powershell
python -m venv .venv-firmware
.\.venv-firmware\Scripts\python.exe -m pip install platformio==6.1.18
```

Tại thư mục repository, tạo cấu hình cục bộ một lần:

```powershell
if (-not (Test-Path firmware/include/config.local.h)) {
    Copy-Item firmware/include/config.example.h firmware/include/config.local.h
}
```

Điền `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_HOST` và `MQTT_PORT`.
`MQTT_HOST` là IP LAN của máy chạy Mosquitto; không dùng `localhost` hoặc tên service `mqtt`.
Cổng phải khớp `MQTT_HOST_PORT` trong Compose. ESP32 và máy tính cần kết nối được qua LAN.
Wi-Fi dùng mạng 2.4 GHz. Không commit `config.local.h`; file đã được Git bỏ qua.
Không có cấu hình local vẫn build được nhưng firmware sẽ dừng ở thông báo `[CONFIG]`.
Phần thu thập cảm biến/PIR và phím chẩn đoán vẫn chạy khi chưa cấu hình mạng.

Tạo `firmware/include/sensors_config.local.h` từ `sensors_config.example.h` để cấu hình đầu dò.
DS18B20 mặc định bật trên GPIO4; pH/độ đục và PIR/LED mặc định tắt.
pH đã chốt PH-4502C; độ đục MJKDZ có ngõ analog 0–4.5 V, nhãn VCC/OUT/GND; chưa thử hai kênh analog thật.
Xem [hướng dẫn nhận hàng và hiệu chuẩn](../docs/hardware/hardware-bringup.md) trước khi bật từng kênh.

Build từ repository:

```powershell
.\.venv-firmware\Scripts\python.exe -m platformio run -d firmware -e esp32-fake -e esp32-sensors
```

Nếu đường dẫn có ký tự tiếng Việt và Xtensa GCC báo không tìm thấy file, dùng:

```powershell
.\firmware\build.ps1 -Python "$PWD\.venv-firmware\Scripts\python.exe"
```

Script dùng hai ổ đĩa ánh xạ tạm cho source/cache rồi gỡ ánh xạ khi kết thúc;
không di chuyển hoặc xóa file. Có thể truyền `-CoreDirectory` để dùng cache PlatformIO sẵn có.
Platform ghim `espressif32@6.9.0`, Arduino core 2.0.17; MQTT dùng ESP-MQTT đi kèm SDK.
Không cần thư viện JSON/MQTT bên thứ ba. Chế độ sensors ghim OneWire 2.3.8 và DallasTemperature 3.11.0.

Sau khi xác nhận đúng board và cổng COM, mới upload (thay COM5 bằng cổng thật):

```powershell
.\.venv-firmware\Scripts\python.exe -m platformio device list
.\.venv-firmware\Scripts\python.exe -m platformio run -d firmware -e esp32-fake -t upload --upload-port COM5
.\.venv-firmware\Scripts\python.exe -m platformio device monitor --port COM5 --baud 115200
```

Các lệnh upload trực tiếp yêu cầu đường dẫn không có ký tự gây lỗi compiler.
Mở web tại `http://localhost:5173/?device_id=tank-demo-001` sau khi Compose chạy.

## Vận hành và giới hạn

- Wi-Fi thử lại mỗi 15 giây; MQTT thử lại theo khoảng 1/2/4/8/16/30 giây, tối đa 30 giây.
- Đợi NTP đồng bộ UTC trước khi kết nối MQTT/gửi telemetry; không lấy uptime làm ngày giờ.
  Lần khởi động đầu cần truy cập được một NTP server; có thể cấu hình server trong LAN.
- Telemetry v2 mỗi 5 giây, QoS 1, không retained. Status online và Last Will offline retained, QoS 1.
- `[DATA queued]` chỉ xác nhận đưa vào hàng đợi. `[MQTT] PUBACK` xác nhận broker nhận,
  chưa chứng minh backend đã lưu hoặc web đã hiển thị.
- Mất mạng không lưu mẫu mới; hàng đợi RAM được giới hạn khoảng 4 KB và xóa khi tạo lại kết nối.
  Có thể mất mẫu chưa ACK lúc reconnect/reboot; chưa có lưu bù flash.
- Sequence tăng trong một lần chạy, bắt đầu lại sau reboot. Backend chống trùng bằng thiết bị + sequence + timestamp.
- Last Will được tạo lúc kết nối nên timestamp trong đó không phải thời điểm mất mạng.
  Backend ghi cảnh báo offline theo giờ tiếp nhận, giữ `last_seen_at` của lần thực sự thấy thiết bị.
  Replay retained status sau khi backend khởi động không xác định được chính xác lúc sự cố bắt đầu.
- DS18B20 chuyển đổi không chặn vòng lặp, đọc sau 800 ms; phát hiện mất đầu dò, tìm lại sau 5 giây.
  Yêu cầu cấp nguồn ba dây; không dùng parasite power. Cache nhiệt độ quá 2.5 giây không được phát như số đo mới.
- Analog dùng ADC1 GPIO34/35, đọc mV, lọc 15 mẫu (bỏ ba mẫu thấp/cao, trung bình chín mẫu giữa).
  Chưa đủ mẫu, quá 1 giây không đọc mới, ngoài cửa sổ 150–3000 mV hoặc calibration không hợp lệ đều thành null.
  Bộ lọc lấy mẫu ngay cả lúc mất mạng. Đây là kiểm tra phần mềm, không bảo vệ GPIO trước quá áp.
- PH-4502C dùng hai điểm mV/buffer, chưa bù nhiệt pH. Giá trị mV phải đo tại chân ESP32 sau phần chia áp/đệm thực tế.
  Độ đục dùng hai mốc trong/đục tương đối, giới hạn 0–100; hỗ trợ cả tín hiệu tăng hoặc giảm theo độ đục.
- PIR/LED khi bật dùng GPIO27/26, đợi ổn định 60 giây; LED sáng khi OUT cao và tắt sau 15 giây không còn tín hiệu cao.
- Độ đục là chỉ số tương đối 0–100, chưa phải NTU; ngưỡng backend chỉ phục vụ demo.

Serial monitor nhận các phím sau trong chế độ fake:

| Phím | Kịch bản | Kết quả mong đợi với ngưỡng mặc định |
| --- | --- | --- |
| 0 | Bình thường | Đóng cảnh báo thông số đã phục hồi |
| 1 / 2 | Nhiệt độ thấp / cao | Cảnh báo temperature |
| 3 / 4 | pH thấp / cao | Cảnh báo ph |
| 5 | Đục cao | Cảnh báo turbidity critical |
| 6 | Lỗi đầu dò | Mỗi ba mẫu, lần lượt pH/nhiệt độ/độ đục null; hai số còn lại hợp lệ |
| ? | Trợ giúp | In danh sách phím |
| v | Chẩn đoán | In nhiệt độ, pH-pin-mV, turbidity-pin-mV và giá trị đã hiệu chuẩn; dùng được khi chưa có mạng |

Muốn kiểm tra Last Will phải ngắt nguồn/Wi-Fi thật; không dùng một số đo giả để mô phỏng mất mạng.

## Kiểm thử

Dùng Python đã cài `backend/requirements-test.txt`, có `g++` trong PATH hoặc đặt biến `CXX`:

```powershell
python -m unittest discover -s firmware/tests -v
```

Test biên dịch chính mã C++ trong `lib/AquariumCore`, kiểm tra giới hạn/buffer/null/retry, hiệu chuẩn,
lọc nhiễu, offset nhiệt độ, warmup/hold PIR và vòng quay millis;
sau đó đưa 69 JSON thật từ C++ qua schema backend và ingestion SQLite, kiểm tra chống trùng/cảnh báo.
Không mô phỏng Wi-Fi, NTP hoặc MQTT task; các phần đó phải thử trên board.
Xem [test plan](../docs/hardware/firmware-test-plan.md).

Tham khảo API: [ESP-MQTT 4.4](https://docs.espressif.com/projects/esp-idf/en/v4.4/esp32/api-reference/protocols/mqtt.html),
[PlatformIO ESP32 Dev Module](https://docs.platformio.org/en/stable/boards/espressif32/esp32dev.html).
API ADC: [Arduino-ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/adc.html).
