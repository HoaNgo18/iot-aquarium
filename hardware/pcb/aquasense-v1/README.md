# AquaSense v1.0 — mạch đế ESP32

Mạch hai lớp **80 × 60 mm**, FR-4 1,6 mm, đồng 1 oz. Cắm ESP32 DevKit 30 chân qua hai header cái 1×15; bốn đầu cảm biến dùng ổ khóa JST-XH để cắm/rút gọn gàng. Không phải mạch ESP32 rời và không thay thế module PH-4502C/MJKDZ.

**Trạng thái:** đã đi dây; KiCad 9.0.2 chạy trong Docker. ERC: 0 lỗi/0 cảnh báo. DRC kèm đối chiếu schematic: 0 vi phạm, 0 kết nối hở, 0 sai khác footprint/net. Chưa sản xuất hay thử điện trên PCB thật.

## Mở và xem

Mở `aquasense-v1.kicad_pro` bằng KiCad 9 trở lên. File sử dụng định dạng KiCad 9, thuộc yêu cầu “KiCad 8 trở lên”. Cần cài bộ thư viện symbol/footprint chuẩn KiCad. Thư viện riêng `aquasense.kicad_sym`, `aquasense.pretty/` được khai báo qua hai bảng thư viện trong project.

- `preview/top-3d.png`, `bottom-3d.png`: ảnh bo trần, chưa lắp linh kiện; máy dựng ảnh không cài gói mô hình 3D linh kiện.
- `preview/pcb-top.svg`: đường đồng và lụa mặt trên.
- `preview/print-1to1.pdf`: mặt trên khổ A4 tỉ lệ 1:1, kèm thước chuẩn 50 mm; khi in phải chọn 100%/Actual size.
- `preview/schematic.pdf`, `schematic.png`, `aquasense-v1.svg`: sơ đồ nguyên lý.
- `reports/erc.rpt`, `drc.rpt`: báo cáo KiCad cuối cùng, không có mục loại trừ lỗi.
- `reports/design-audit.json`: toàn bộ gán net, thứ tự chân JST-XH, ba GPIO, khoảng cách socket và vùng anten đã được kiểm tra.
- `bom.csv`: một hàng cho mỗi reference. U1 tính **1 bộ gồm 2 socket cái 1×15**, không phải hai board ESP32.
- `fab/aquasense-v1-gerber.zip`: Gerber, PTH/NPTH Excellon drill, dùng đặt PCB trần.

## Kích thước socket đã xác nhận

Khoảng cách tâm hai hàng socket **đã đo được 25,4 mm trên board ESP32 thật ngày 18/11/2026**. Board được xác nhận là module ESP-WROOM-32S 30 chân, nhãn chân kiểu DOIT DevKit V1. Giữ `row_spacing_mm = 25.4`. Vẫn nên in `preview/print-1to1.pdf` ở 100% và đặt board thật lên trước khi đặt gia công để đối chiếu vị trí USB, anten và chiều dài module.

Thông số nằm ở `parameters.json`, khóa `row_spacing_mm`. `pitch_mm` = 2,54 mm; 15 chân/hàng. Sau khi đổi tham số, phải chạy lại toàn bộ pipeline để tạo footprint, vị trí pad, đường mạch, keepout, ERC/DRC và Gerber. Không kéo giãn footprint bằng scale.

Nhìn mặt trên, USB hướng xuống: hàng trái từ EN đến VIN; hàng phải từ D23 đến 3V3. Cắm lệch/đảo chiều có thể đưa 5 V vào chân 3,3 V. Hai pad vuông là đầu trên của hai hàng, **không phải vị trí USB**.

| U1 | Chân | Net |
|---|---|---|
| 4, hàng trái thứ 4 | D34 / GPIO34 | PH_ADC |
| 5, hàng trái thứ 5 | D35 / GPIO35 | TURB_ADC |
| 26, hàng phải thứ 11 | D4 / GPIO4 | TEMP_DQ |
| 9, hàng trái thứ 9 | D26 / GPIO26 | LED_OUT, tùy chọn |
| 10, hàng trái thứ 10 | D27 / GPIO27 | PIR_OUT, tùy chọn |
| 14 và 29 | GND | GND chung |
| 15 | VIN | +5V_RAW từ USB |
| 30 | 3V3 | +3V3 từ bộ ổn áp DevKit |

Toàn bộ thứ tự 30 chân nằm trong symbol riêng và `design-manifest.json`; các GPIO không dùng được đánh dấu NC trên sơ đồ, không nối đồng sang chân khác.

## Đầu nối cảm biến

Pin 1 là pad vuông. J1–J4 dùng ổ JST-XH chính hãng bước **2,50 mm**: J1/J3/J4 là `B3B-XH-A`, J2 là `B4B-XH-A`. Tất cả mặt khóa quay về cạnh trái; tên module và từng chân được in ngay cạnh ổ.

| Đầu nối | Pin 1 | Pin 2 | Pin 3 | Pin 4 |
|---|---|---|---|---|
| J1 — DS18B20, XH 3P | VDD, đỏ, 3V3 | GND, đen | DQ, vàng, GPIO4 | — |
| J2 — PH-4502C, XH 4P | PO, qua chia áp | GND | GND | V+, 5V sau F1 |
| J3 — MJKDZ, XH 3P | VCC, 5V sau F1 | OUT, qua chia áp | GND | — |
| J4 — HC-SR501, XH 3P | VCC, 5V sau F1 | OUT, GPIO27 | GND | — |

DS18B20 sử dụng **3 dây cấp nguồn**, không dùng chế độ parasite. R1 = 4,7 kΩ nối DQ lên 3V3. J2 khớp bốn chân cuối `PO G G V+` trong dãy sáu chân `TO DO PO G G V+` của PH-4502C; TO và DO để hở.

### Dây cần mua

- 3 sợi **JST-XH 3P sang Dupont cái 3P**, dài 20–30 cm, cho J1/J3/J4.
- 1 sợi **JST-XH 4P sang Dupont cái 4P**, dài 20–30 cm, cho J2.
- Dây phải đi thẳng `1→1`, `2→2`, `3→3`, và với J2 thêm `4→4`; không dùng dây đảo thứ tự.
- Với đầu dò DS18B20 chưa có đầu XH: hàn hoặc bấm dây đỏ–đen–vàng vào vỏ XH 3P theo đúng `VDD–GND–DQ`, bọc co nhiệt từng mối.

**Cảnh báo:** thứ tự chân trên module thật có thể khác ảnh hoặc lô hàng khác. Trước khi cấp nguồn, phải đối chiếu nhãn in trên module với lụa `PO/G/G/V+`, `VCC/OUT/GND` hoặc `VDD/GND/DQ` trên PCB. Không dựa riêng vào màu dây.

PIR/LED là phần dự phòng, firmware hiện chưa bật. Xác nhận OUT của PIR đúng mức logic 3,3 V trước khi nối.

## Nguồn và chia áp

Nguồn duy nhất là USB của DevKit. U1.VIN nối **+5V_RAW**, qua F1 mới tới **+5V** cấp J2/J3/J4. Không gắn nguồn 5 V ngoài vào cầu đấu; các đầu này là đầu ra nguồn. Đo thực tế VIN và 3V3 của DevKit trước khi cắm cảm biến vì các bản DevKit clone có thể khác đường USB/VIN.

F1 dùng **Bourns MF-RHT050, Ihold 0,5 A**, footprint chuẩn `Fuse_Bourns_MF-RHT050`, chân cách 5,1 mm và lệch 1,2 mm theo thư viện. Không thay bằng MF-RG500: mã đó là loại 5 A. Giá trị hold có derating theo nhiệt độ; xem datasheet Bourns.

- pH: J2.1 (PO) → R2 10 kΩ → PH_ADC → R3 10 kΩ → GND; PH_ADC tới GPIO34 và C3 100 nF xuống GND.
- Độ trong: J3.2 → R4 10 kΩ → TURB_ADC → R5 10 kΩ → GND; TURB_ADC tới GPIO35 và C4 100 nF xuống GND.
- Hai cầu chia áp độc lập. **Không nối PO/OUT trực tiếp vào ESP32.**
- Công thức: V_ADC = V_OUT × 10k/(10k+10k). PO = 5 V → 2,50 V; OUT = 4,5 V → 2,25 V. Hai điện trở 1% lệch bất lợi cho PO 5 V vẫn chỉ khoảng 2,525 V.
- Điện trở đều 1%, 1/4 W. Hằng số RC danh định tại ADC: (10k || 10k) × 100 nF = 0,5 ms.
- C1 100 µF/16 V và C2 100 nF lọc nguồn 5 V; C5 10 µF/16 V và C6 100 nF lọc 3V3. C1/C5 có phân cực, chân + là pad vuông; không đảo.
- LED dự phòng: GPIO26 → R6 330 Ω → anode D1 → cathode GND. Pad 1 D1 là cathode.

| Test point | Đo so với TP3 GND |
|---|---|
| TP1 | +5V sau cầu chì |
| TP2 | +3V3 |
| TP3 | GND |
| TP4 | PH_ADC, điện áp đã chia đôi |
| TP5 | TURB_ADC, điện áp đã chia đôi |
| TP6 | TEMP_DQ |

## Layout và anten

Đường tín hiệu ≥0,3 mm; ba rail nguồn ≥0,7 mm; clearance ≥0,2 mm; via 0,6/0,3 mm. PCB có hai mặt GND và via khâu quanh mép/nhóm analog. Bốn lỗ NPTH 3,2 mm, tâm cách mép 3,5 mm, dành cho vít M3 và trụ đỡ cách điện.

Vùng rule-area **x=32..64 mm, y=5..18 mm** cấm đồng, tracks, vias và pads trên cả F.Cu/B.Cu. Bo bắt đầu tại y=5 mm. Không đặt linh kiện carrier trong vùng anten này; chú thích nằm trên lụa, không phải đồng. DRC kiểm tra keepout; audit cũng dò nội vùng trên hai mặt ở bước 0,25 mm, không phát hiện đồng.

Anten ở đầu trên, USB ở đầu dưới. Outline thân DevKit trên F.Fab là giả định cơ khí, chưa xác nhận kích thước board thật. Bản này giữ một phần substrate không đồng bên dưới anten; **chưa giả định chắc anten nhô hẳn ngoài bo**. Cổng USB được hướng về mép dưới, vị trí thực tế cần kiểm bằng board thật cùng cáp.

C3/C4 nằm gần header ADC; đường analog được đi trước. Nhóm analog ở bên trái U1, tách vùng anten và LED/PIR. J1–J4 xếp thành một dãy ở `x=11,5 mm`, cùng xoay `90°`: J2 tại `y=16,0`, J3 tại `27,5`, J1 tại `38,5`, J4 tại `49,5 mm`. Mặt khóa đều hướng ra cạnh trái và mép trước ổ cách cạnh bo khoảng 8,65 mm, đủ vùng thao tác đầu dây. C1/C2, R2–R5, C5 và TP1/TP4/TP5 được dời sang phải để nhường thân ổ và lụa chân; khối analog vẫn ở gần GPIO34/35.

## Hàn và thử lần đầu

1. Nếu đặt **PCB trần**, vẫn phải hàn điện trở, tụ, PTC, bốn ổ JST-XH và socket ESP32. Muốn nhận về chỉ cắm dây, cần đặt **PCBA có lắp THT** theo `bom.csv`.
2. Khi lắp thủ công, hàn socket ESP32 sau cùng và dùng DevKit chưa cấp điện làm dưỡng để giữ hai hàng song song; không hàn chân DevKit vào carrier.
3. Kiểm tra thông mạch GND, cầu chia áp và kiểm tra không chập +5V/3V3/GND. Đo R2/R3/R4/R5 trước khi cấp nguồn; tụ có thể khiến số đo thay đổi lúc đầu.
4. Cắm ESP32 đúng chiều, cấp USB; đo TP1/TP2. Sau đó ngắt nguồn trước khi cắm lần lượt từng module.
5. Đối chiếu TP4/TP5 với PO/OUT bằng đồng hồ, phải gần tỷ lệ 1/2. Sau đó thử DS18B20 và dữ liệu dashboard.
6. **Đặt lại mốc nước sạch**: PCB cấp module độ trong bằng 5 V, khác cấu hình breadboard 3,3 V trước đó. Không tái dùng mốc 294/1608 mV một cách máy móc. Giữ đầu dò trong nước sạch ổn định, không bọt khí, rồi đặt mốc mới.
7. Kiểm tra/hiệu chuẩn lại pH bằng buffer 4,01 / 6,86 / 9,18 theo nhiệt độ và hướng dẫn pha của gói. Giá trị hiệu chuẩn phải là điện áp GPIO34 sau chia áp. PCB thêm tụ lọc và thay dây nên cần kiểm chứng lại.

Chưa thay firmware, chưa thay dữ liệu hiệu chuẩn và chưa đặt hàng sản xuất.

## Tái tạo thiết kế

Các script bổ sung để dễ kiểm tra, không cần chạy để mở file KiCad:

1. `generate.py`: tham số, symbol riêng, footprint riêng, schematic, BOM và PCB placement.
2. `route.py`: đi dây hai lớp, phủ GND, via khâu.
3. `polish.py`: bố trí lụa tránh pad/mask và chữ khác.
4. `finish_schematic.py`: bố trí nhãn trên sơ đồ.
5. Xuất netlist bằng `kicad-cli sch export netlist ... -o reports/netlist.net`.
6. `verify.py`: đồng bộ tên net Eeschema/PCB và kiểm bảng nối, bề rộng đường, anten.
7. `fabricate.py`: xuất Gerber, drill, ảnh 3D, SVG mặt trên, PDF 1:1, zip và SHA-256.

Chạy toàn bộ từ đầu trong môi trường KiCad bằng một lệnh:

```bash
python3 build.py
```

`build.py` dừng ngay nếu ERC/DRC có vi phạm; không sử dụng lại zip cũ sau khi thay layout.

Môi trường đã dùng: Debian trixie, KiCad 9.0.2, `/usr/bin/python3` với `pcbnew`, `sexpdata`, `cairosvg`. Docker chỉ dùng làm công cụ; không cài KiCad vào Windows. Các footprint chuẩn vẫn trỏ tới thư viện KiCad, không sao chép thư viện chuẩn vào repo.

Nguồn đối chiếu: [KiCad](https://www.kicad.org/), [datasheet MF-RHT](https://www.bourns.com/docs/product-datasheets/mf-rht.pdf). Lựa chọn PCB trần ở JLCPCB: 2 lớp, FR-4, 1,6 mm, 1 oz; kiểm tra preview của nhà sản xuất trước khi thanh toán. BOM đã ghi mã ổ XH nhưng vẫn cần bổ sung mã đặt hàng/nhà sản xuất cho toàn bộ linh kiện nếu dùng dịch vụ PCBA tự động.
