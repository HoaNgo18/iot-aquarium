# Triển khai AquaSense

Hai chế độ production dùng chung database, backend, frontend, ACL và tài khoản MQTT:

- **VPS:** HTTPS qua Caddy; ESP32 dùng MQTT TLS cổng 8883.
- **Server tại nhà:** web và MQTT WSS qua Cloudflare Tunnel; không mở cổng router.

`compose.prod.yaml` chỉ chứa phần chung. `compose.vps.yaml` chứa Caddy/MQTT TLS;
`compose.tunnel.yaml` chứa cloudflared. Development vẫn chỉ dùng `compose.yaml`.

## Server tại nhà qua Cloudflare Tunnel

### 1. Điều kiện

- `dreamer02.id.vn` phải **Active** trên Cloudflare; gói Free đủ dùng.
- Máy ảo Ubuntu 24.04 dùng IP LAN tĩnh/DHCP reservation `192.168.1.8` và được bật Start at boot.
- Docker tự khởi động: `sudo systemctl enable --now docker`.
- Không mở 80, 443, 1883 hoặc 8883 trên router. Tunnel chỉ kết nối đi ra.

### 2. Tạo Tunnel và lấy token

Vào **Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**.
Đặt tên, ví dụ `aquasense-home`. Ở bước connector, chỉ sao chép chuỗi nằm sau
`--token`; không chạy lệnh Docker do dashboard đưa ra vì cloudflared đã nằm trong Compose.

```bash
cp .env.prod.example .env.prod
openssl rand -hex 32
openssl rand -base64 36
openssl rand -base64 32
```

Điền ba bí mật khác nhau và token thật vào `.env.prod`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.prod.yaml:compose.tunnel.yaml
CLOUDFLARE_TUNNEL_TOKEN=token-vua-sao-chep
APP_DOMAIN=app.dreamer02.id.vn
MQTT_DOMAIN=mqtt.dreamer02.id.vn
POSTGRES_PASSWORD=...
SECRET_KEY=...
MQTT_BACKEND_PASSWORD=...
```

Không commit hoặc gửi công khai `.env.prod`.

### 3. Khai báo Public Hostnames

Trong tunnel vừa tạo, thêm hai route:

| Public hostname | Type | URL nội bộ |
|---|---|---|
| `app.dreamer02.id.vn` | HTTP | `frontend:80` |
| `mqtt.dreamer02.id.vn` | HTTP | `mqtt:8080` |

Không chọn HTTPS cho URL nội bộ: Cloudflare kết thúc TLS ở biên. Trong **SSL/TLS →
Edge Certificates**, bật **Always Use HTTPS**. WebSockets được bật mặc định.

### 4. Tạo user backend và khởi động

```bash
chmod +x deploy/*.sh
./deploy/mqtt-user.sh backend 'gia-tri-MQTT_BACKEND_PASSWORD-trong-env'
docker compose --env-file .env.prod config >/dev/null
docker compose --env-file .env.prod up -d --build
docker compose --env-file .env.prod ps
docker compose --env-file .env.prod logs --tail=100 cloudflared mqtt backend
```

Cloudflared chỉ ở mạng `edge` cùng frontend/MQTT; PostgreSQL/backend chỉ ở mạng
`core`. `sudo ss -lntp` không được hiển thị cổng nào của stack. Khi dashboard báo
Tunnel **Healthy**, mở `https://app.dreamer02.id.vn/health` bằng mạng 4G.

### 5. Tạo thiết bị và cấu hình ESP32 WSS

```bash
./deploy/mqtt-user.sh tank-ds18b20-001
```

Trong namespace `config` của `firmware/include/config.local.h`, đặt:

```cpp
#define AQUARIUM_CONFIG_HAS_MQTT_TRANSPORT 1
constexpr char MQTT_HOST[] = "mqtt.dreamer02.id.vn";
constexpr unsigned short MQTT_PORT = 443;
constexpr char MQTT_USERNAME[] = "tank-ds18b20-001";
constexpr char MQTT_PASSWORD[] = "mat-khau-vua-sinh";
constexpr MqttTransport MQTT_TRANSPORT = MqttTransport::Wss;
```

Username phải trùng `DEVICE_ID`. Firmware dùng path `/`, keepalive 30 giây, kiểm
tra hostname và certificate bundle đầy đủ của ESP-IDF. Serial phải có `[MQTT]
connected`, `[TLS/WSS] free heap`, `[DATA queued]` và `PUBACK`.

### 6. Kiểm tra WSS và ACL từ ngoài mạng nhà

```bash
python3 -m venv .venv-mqtt-check
. .venv-mqtt-check/bin/activate
pip install paho-mqtt==2.1.0
python deploy/mqtt-ws-check.py --tls \
  --host mqtt.dreamer02.id.vn --port 443 \
  --username tank-ds18b20-001 --password 'MAT_KHAU_THIET_BI'
docker compose --env-file .env.prod logs --tail=100 backend
```

Script kiểm tra publish hợp lệ, từ chối ẩn danh, sai mật khẩu và ghi sang topic
thiết bị khác. Log backend xác nhận bản tin hợp lệ đã được xử lý/lưu.

### 7. Xử lý sự cố

- Tunnel không Healthy: xem `docker compose --env-file .env.prod logs cloudflared`, kiểm tra token và outbound 7844/443.
- HTTP 502: route phải là `frontend:80` hoặc `mqtt:8080`, không dùng `localhost`.
- ESP32 lỗi TLS: chờ NTP, kiểm tra hostname và xem chuỗi chứng chỉ bằng:

```bash
openssl s_client -connect mqtt.dreamer02.id.vn:443 \
  -servername mqtt.dreamer02.id.vn -showcerts </dev/null
```

- Web chạy nhưng MQTT lỗi: xem `docker compose --env-file .env.prod logs mqtt`.

### So sánh để đưa vào báo cáo

| Tiêu chí | VPS + Caddy | Server nhà + Tunnel |
|---|---|---|
| Cổng Internet | 80, 443, 8883 | Không mở cổng router |
| TLS web | Caddy/Let's Encrypt | Cloudflare Universal SSL |
| MQTT ESP32 | MQTT TLS 8883 | MQTT over WSS 443 |
| Phụ thuộc | Nhà cung cấp VPS | Điện, mạng nhà, máy chủ vật lý |
| CGNAT | Không liên quan | Vẫn hoạt động |

## VPS công khai qua Caddy

## 1. Chuẩn bị VPS và tên miền

Cấu hình tối thiểu phù hợp cho một hệ thống nhỏ là 1 vCPU, 1–2 GB RAM, Ubuntu 24.04 và khoảng 15 GB đĩa. Tạo một bản ghi DNS `A`, ví dụ `aquasense.example.com`, trỏ tới IPv4 công khai của VPS. Chờ lệnh sau trả về đúng IP VPS:

```bash
getent ahostsv4 aquasense.example.com
```

Caddy cần cổng 80 và 443 truy cập được từ Internet để cấp chứng chỉ. MQTT TLS dùng cổng 8883. Docker Compose tối thiểu là **2.24.4** vì file production dùng `!reset` và `!override`.

## 2. Khóa SSH và tường lửa

Đăng nhập lần đầu bằng tài khoản do nhà cung cấp cấp, tạo user thường và chép khóa SSH của bạn:

```bash
sudo adduser aquasense
sudo usermod -aG sudo aquasense
sudo install -d -m 700 -o aquasense -g aquasense /home/aquasense/.ssh
sudo cp ~/.ssh/authorized_keys /home/aquasense/.ssh/authorized_keys
sudo chown aquasense:aquasense /home/aquasense/.ssh/authorized_keys
sudo chmod 600 /home/aquasense/.ssh/authorized_keys
```

Mở một terminal khác và xác nhận đăng nhập bằng khóa hoạt động trước khi tắt mật khẩu. Sau đó tạo `/etc/ssh/sshd_config.d/99-aquasense.conf`:

```text
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
```

Kiểm tra và nạp lại SSH, rồi bật UFW:

```bash
sudo sshd -t
sudo systemctl reload ssh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 8883/tcp
sudo ufw enable
sudo ufw status verbose
```

Không mở 1883, 5432, 8000 hoặc cổng frontend ra Internet.

## 3. Cài Docker chính thức

Cài Docker Engine và Compose plugin từ repository chính thức của Docker, không dùng gói `docker.io` cũ của Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo ${UBUNTU_CODENAME:-$VERSION_CODENAME}) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Đăng xuất/đăng nhập lại, rồi kiểm tra `docker run --rm hello-world` và `docker compose version`. Việc vào group `docker` tương đương quyền quản trị máy; chỉ thêm user vận hành tin cậy.

## 4. Lấy mã nguồn và tạo bí mật

```bash
git clone <URL_REPOSITORY> iot-aquarium
cd iot-aquarium
cp .env.prod.example .env.prod
openssl rand -hex 32
openssl rand -base64 36
openssl rand -base64 32
```

Điền ba giá trị khác nhau vào `SECRET_KEY`, `POSTGRES_PASSWORD`, `MQTT_BACKEND_PASSWORD`; sửa `DOMAIN` và `ACME_EMAIL`. Không thêm `.env.prod` vào Git. Tên DB mặc định production là `aquasense`; mặc định development trong `compose.yaml` vẫn là `flood_monitoring` để không ảnh hưởng volume trên laptop.

Đổi chế độ trong `.env.prod`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.prod.yaml:compose.vps.yaml
```

Tạo file mật khẩu và user backend **trước lần khởi động đầu**. Truyền đúng giá trị `MQTT_BACKEND_PASSWORD` trong `.env.prod`:

```bash
chmod +x deploy/*.sh
./deploy/mqtt-user.sh backend 'gia-tri-MQTT_BACKEND_PASSWORD'
```

Script chạy `mosquitto_passwd` trong container, không cần cài Mosquitto trên host. Nếu bỏ đối số thứ hai, script sinh mật khẩu ngẫu nhiên và chỉ in một lần. File `infrastructure/mosquitto/secrets/passwd` không được commit.

## 5. Khởi động production

Kiểm tra model Compose trước khi chạy:

```bash
docker compose --env-file .env.prod config >/dev/null
docker compose --env-file .env.prod up -d --build
docker compose --env-file .env.prod ps
docker compose --env-file .env.prod logs -f caddy mqtt-cert-init mqtt backend
```

Caddy chạy trước và lấy chứng chỉ. `mqtt-cert-init` chờ tối đa 10 phút, tìm cặp `.crt`/`.key` đúng tên miền trong volume Caddy, sao chép sang volume `mqtt_certs`, đặt quyền đọc cho user không-root của Mosquitto rồi mới cho broker khởi động. Private key không được bind ra filesystem host và Mosquitto không được quyền ghi kho dữ liệu Caddy.

Nếu cấp chứng chỉ thất bại, kiểm tra DNS, thời gian hệ thống, firewall và việc cổng 80/443 có bị nhà cung cấp chặn hay không. Không lặp `up` liên tục trước khi đọc log Caddy.

Mở `https://aquasense.example.com` và kiểm tra:

```bash
curl --fail https://aquasense.example.com/health
```

WebSocket `/ws` tự được Caddy reverse proxy qua nginx; không cần cấu hình Upgrade riêng trong Caddy.

## 6. Tạo user thiết bị và cấu hình ESP32

Username của mỗi thiết bị phải đúng `device_id`. Mỗi thiết bị dùng mật khẩu riêng:

```bash
./deploy/mqtt-user.sh tank-ds18b20-001
```

Không dùng `backend` làm device ID; đây là tài khoản dành riêng cho consumer và ACL chặn tài khoản này ghi topic.

Ghi lại mật khẩu vừa in và sửa `firmware/include/config.local.h`:

```cpp
constexpr char MQTT_HOST[] = "aquasense.example.com";
constexpr unsigned short MQTT_PORT = 8883;
constexpr char MQTT_USERNAME[] = "tank-ds18b20-001";
constexpr char MQTT_PASSWORD[] = "mat-khau-vua-sinh";
#define AQUARIUM_CONFIG_HAS_MQTT_TRANSPORT 1
constexpr MqttTransport MQTT_TRANSPORT = MqttTransport::Tls;
```

`MQTT_HOST` bắt buộc là tên DNS có trong chứng chỉ, không dùng IP. Firmware giữ kiểm tra tên chứng chỉ và dùng bundle ISRG Root X1/X2; không bật tùy chọn bỏ qua xác minh. Nạp firmware như hướng dẫn trong `firmware/README.md`, mở Serial Monitor và xác nhận có `[MQTT] connected`, `[TLS/WSS] free heap...`, `[DATA queued]` và `PUBACK`.

## 7. Kiểm tra MQTT TLS và ACL

Cài client trên máy kiểm thử: `sudo apt-get install mosquitto-clients`. Với user `tank-a`, lệnh đúng phải thành công:

```bash
mosquitto_pub -h aquasense.example.com -p 8883 \
  --capath /etc/ssl/certs -u tank-a -P 'MAT_KHAU_TANK_A' -q 1 \
  -t aquarium-monitoring/devices/tank-a/telemetry \
  -m '{"device_id":"tank-a","measured_at":"2026-11-15T00:00:00Z","sequence":1,"temperature_c":25,"ph":7,"turbidity_pct":10,"signal_strength_dbm":-60,"sensor_status":"normal"}'
```

Sau đó xem `docker compose --env-file .env.prod logs backend`. Ba phép thử sau phải thất bại:

```bash
# Không username/password
mosquitto_pub -h aquasense.example.com -p 8883 --capath /etc/ssl/certs -t test -m test
# Sai mật khẩu
mosquitto_pub -h aquasense.example.com -p 8883 --capath /etc/ssl/certs -u tank-a -P sai -t aquarium-monitoring/devices/tank-a/status -m test
# tank-a giả mạo topic của tank-b
mosquitto_pub -h aquasense.example.com -p 8883 --capath /etc/ssl/certs -u tank-a -P 'MAT_KHAU_TANK_A' -t aquarium-monitoring/devices/tank-b/status -m test
```

Kiểm tra host chỉ lắng nghe 22, 80, 443, 8883 bằng `sudo ss -lntup`. Các cổng 1883, 5432, 8000 và 5173 không được xuất hiện trên địa chỉ host.

## 8. Gia hạn chứng chỉ, cập nhật và log

Caddy tự gia hạn chứng chỉ. Cron sau chạy mỗi ngày, chỉ copy và gửi `SIGHUP` cho Mosquitto khi nội dung chứng chỉ thay đổi:

```bash
(crontab -l 2>/dev/null; echo '17 3 * * * cd /home/aquasense/iot-aquarium && ./deploy/reload-mqtt-cert.sh >> /home/aquasense/mqtt-cert-reload.log 2>&1') | crontab -
```

Cập nhật ứng dụng:

```bash
git pull --ff-only
docker compose --env-file .env.prod up -d --build
docker compose --env-file .env.prod ps
```

Xem log bằng `docker compose ... logs --tail=200 <service>`; không dán `.env.prod`, file password hoặc private key vào báo lỗi công khai.

## 9. Sao lưu và khôi phục PostgreSQL

Chạy thử:

```bash
./deploy/backup-db.sh
gzip -t backups/*.sql.gz
```

Script tạo bản dump gzip trong `backups/` và chỉ giữ 7 bản mới nhất. Chạy hằng ngày:

```bash
(crontab -l 2>/dev/null; echo '25 2 * * * cd /home/aquasense/iot-aquarium && ./deploy/backup-db.sh >> /home/aquasense/db-backup.log 2>&1') | crontab -
```

Nên sao chép backup sang một máy hoặc object storage khác. Khôi phục vào DB trống trong cửa sổ bảo trì:

```bash
docker compose --env-file .env.prod stop backend
gunzip -c backups/aquasense-YYYYMMDDTHHMMSSZ.sql.gz | \
  docker compose --env-file .env.prod exec -T db \
  psql -U aquasense -d aquasense
docker compose --env-file .env.prod start backend
```

Muốn chuyển dữ liệu cũ từ laptop, chạy `pg_dump --no-owner --no-acl` ở laptop, chép file gzip lên VPS và khôi phục theo cách trên. Dừng ghi dữ liệu trong lúc dump để có ảnh chụp nhất quán.

## 10. Chạy thử production trên máy local

Docker Desktop phải đang chạy. Tạo `.env.prod` từ file mẫu, đặt `DOMAIN=localhost`, `ACME_EMAIL=local@example.com`, `CADDY_TLS_MODE=tls internal` và các bí mật mẫu. Tạo user `backend` và `tank-local-001`, rồi chạy stack production như mục 5.

Xuất CA nội bộ để client tin cậy:

```bash
docker compose --env-file .env.prod exec -T caddy \
  cat /data/caddy/pki/authorities/local/root.crt > .local-caddy-root.crt
curl --cacert .local-caddy-root.crt https://localhost/health
```

Dùng `mosquitto_pub --cafile .local-caddy-root.crt ...` để lặp các phép thử ACL ở mục 7. Mở web bằng `https://localhost`; có thể dùng `backend/scripts/websocket_probe.py` sau khi trỏ URL tới `wss://localhost/ws`.

Xác nhận cổng nội bộ không publish:

```bash
for port in 1883 5432 8000 5173; do
  if timeout 1 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null; then echo "UNEXPECTED OPEN: $port"; else echo "closed: $port"; fi
done
```

Kết thúc test bằng `docker compose --env-file .env.prod down`. Không thêm `-v` trừ khi chủ ý xóa toàn bộ dữ liệu thử. Xóa `.local-caddy-root.crt` sau khi kiểm tra.

## 11. Chế độ development không đổi

Trên laptop vẫn dùng lệnh cũ:

```bash
docker compose up -d --build
```

Lệnh này chỉ đọc `compose.yaml`: MQTT development vẫn ẩn danh/LAN, các port local vẫn được publish và simulator vẫn là profile tùy chọn. Không dùng `compose.prod.yaml` nếu muốn chạy chế độ LAN cũ.
