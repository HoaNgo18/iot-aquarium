#include <aquarium_core.h>
#include <sensor_math.h>
#include <cassert>
#include <iostream>
#include <string>

using namespace aquarium;
constexpr char STAMP[] = "2026-10-19T10:00:00Z";

void checkAcquisition() {
    char phPayload[PAYLOAD_CAPACITY];
    Sample phRaw{27, missing(), 20, missing(), missing(), 1275};
    assert(!hasError(normalize(phRaw)));
    assert(serializeTelemetry(phPayload, sizeof(phPayload), "ph-test", STAMP, 1, phRaw, -60));
    assert(std::string(phPayload).find("\"ph_mv\":1275.00") != std::string::npos);
    assert(std::string(phPayload).find("\"ph\":null") != std::string::npos);
    assert(std::isnan(normalize({27, missing(), 20, missing(), missing(), 3300}).phMv));
    const Sample raw = normalize({27, missing(), missing(), 291, 294});
    assert(raw.turbidityMv == 291 && raw.turbidityReferenceMv == 294);
    assert(std::isnan(raw.turbidityPct));
    assert(std::isnan(normalize({27, 7, missing(), 142, 294}).turbidityMv));
    char rawPayload[PAYLOAD_CAPACITY];
    assert(serializeTelemetry(rawPayload, sizeof(rawPayload), "raw-test", STAMP, 1, raw, -60));
    assert(std::string(rawPayload).find("\"turbidity_mv\":291.00") != std::string::npos);
    assert(std::string(rawPayload).find("\"turbidity_pct\":null") != std::string::npos);
    Calibration ph{2500, 7, 2000, 4};
    assert(std::fabs(calibrate(2250, ph, 0, 14) - 5.5f) < 0.001f);
    assert(std::fabs(calibrate(2500, ph, 0, 14) - 7) < 0.001f);
    assert(std::isnan(calibrate(2250, {missing(), 7, 2000, 4}, 0, 14)));
    assert(std::isnan(calibrate(2250, {2000, 7, 2001, 4}, 0, 14)));
    assert(std::isnan(calibrate(2250, {2500, 15, 2000, 4}, 0, 14)));
    assert(std::isnan(calibrate(0, ph, 0, 14)));
    assert(std::isnan(calibrate(3300, ph, 0, 14)));
    assert(std::isnan(calibrate(300, ph, 0, 14))); // extrapolates below pH zero
    Calibration turbidity{2800, 0, 1800, 100};
    assert(std::fabs(calibrate(2400, turbidity, 0, 100, true) - 40) < 0.001f);
    assert(calibrate(2900, turbidity, 0, 100, true) == 0);
    assert(calibrate(1700, turbidity, 0, 100, true) == 100);
    assert(std::isnan(calibratedTemperature(-127, 0)));
    assert(std::isnan(calibratedTemperature(27, 6)));
    assert(calibratedTemperature(27, -0.5f) == 26.5f);

    AnalogFilter filter;
    for (unsigned i = 0; i < 14; ++i) filter.push(2000, i * 10);
    assert(std::isnan(filter.value(140)));
    filter.push(2000, 140);
    assert(filter.value(140) == 2000);
    filter.push(3000, 150);
    filter.push(200, 160);
    assert(filter.value(160) == 2000); // reject spikes at either end
    assert(std::isnan(filter.value(1160)));
    filter.push(missing(), 170);
    assert(std::isnan(filter.value(170)));
    for (unsigned i = 0; i < 15; ++i) filter.push(2100, UINT32_MAX - 10);
    assert(filter.value(10) == 2100); // millis rollover

    MotionLight light;
    light.begin(0);
    assert(!light.update(59999, true, 60000, 15000));
    assert(light.update(60000, true, 60000, 15000));
    assert(light.update(74999, false, 60000, 15000));
    assert(light.update(74000, true, 60000, 15000));
    assert(!light.update(89000, false, 60000, 15000));
    light.begin(UINT32_MAX - 100);
    assert(light.update(UINT32_MAX - 50, true, 0, 1000));
    assert(light.update(948, false, 0, 1000));
    assert(!light.update(949, false, 0, 1000));
}

void checkCore() {
    assert(validDeviceId("tank-demo_001"));
    assert(validDeviceId(std::string(64, 'a').c_str()));
    for (const auto id : {"", "_tank", "tank/a", "tank\"1", "tank 1"}) assert(!validDeviceId(id));
    assert(!validDeviceId(std::string(65, 'a').c_str()));
    assert(!validDeviceId(nullptr));

    assert(validTimestampShape(STAMP));
    assert(!validTimestampShape("1970"));
    assert(!validTimestampShape("2026-10-19T10:00:00\""));

    auto invalid = normalize({-56, std::numeric_limits<float>::infinity(), 101});
    assert(std::isnan(invalid.temperatureC) && std::isnan(invalid.ph) && std::isnan(invalid.turbidityPct));
    assert(!hasError(normalize({-55, 0, 0})));
    assert(!hasError(normalize({125, 14, 100})));
    assert(!hasError(fakeSample(Scenario::Normal, 1)));
    assert(fakeSample(Scenario::TemperatureLow, 1).temperatureC < 22);
    assert(fakeSample(Scenario::TemperatureHigh, 1).temperatureC > 30);
    assert(fakeSample(Scenario::PhLow, 1).ph < 6.5);
    assert(fakeSample(Scenario::PhHigh, 1).ph > 8.5);
    assert(fakeSample(Scenario::TurbidityHigh, 1).turbidityPct >= 80);
    assert(std::isnan(fakeSample(Scenario::SensorError, 3).ph));
    assert(std::isnan(fakeSample(Scenario::SensorError, 6).temperatureC));
    assert(std::isnan(fakeSample(Scenario::SensorError, 9).turbidityPct));
    assert(!hasError(fakeSample(Scenario::SensorError, 10)));

    char buffer[PAYLOAD_CAPACITY];
    assert(serializeTelemetry(buffer, sizeof(buffer), "tank", STAMP, MAX_SEQUENCE, {27, 7, 20}, -127));
    assert(std::strstr(buffer, "\"sequence\":2147483647"));
    assert(serializeTelemetry(buffer, sizeof(buffer), "tank", STAMP, 1, invalid, 0));
    assert(std::strstr(buffer, "\"temperature_c\":null"));
    assert(std::strstr(buffer, "\"sensor_status\":\"error\""));
    assert(!serializeTelemetry(buffer, sizeof(buffer), "tank", STAMP, 0, {27, 7, 20}, -50));
    assert(!serializeTelemetry(buffer, sizeof(buffer), "tank", STAMP, MAX_SEQUENCE + 1, {27, 7, 20}, -50));
    assert(!serializeTelemetry(buffer, sizeof(buffer), "tank", STAMP, 1, {27, 7, 20}, -128));
    assert(!serializeTelemetry(buffer, sizeof(buffer), "tank", STAMP, 1, {27, 7, 20}, 1));
    assert(!serializeTelemetry(buffer, sizeof(buffer), "tank/other", STAMP, 1, {27, 7, 20}, -50));
    assert(buffer[0] == '\0');
    char tiny[8];
    assert(!serializeTelemetry(tiny, sizeof(tiny), "tank", STAMP, 1, {27, 7, 20}, -50));
    assert(tiny[0] == '\0');
    assert(!serializeStatus(tiny, sizeof(tiny), "tank", STAMP, true));
    assert(tiny[0] == '\0');
    assert(serializeStatus(buffer, sizeof(buffer), "tank", STAMP, false));
    assert(std::strstr(buffer, "\"connectivity\":\"offline\""));

    RetryBackoff retry;
    assert(retry.ready(0));
    std::uint32_t now = 0;
    for (const auto wait : {1000U, 2000U, 4000U, 8000U, 16000U, 30000U, 30000U}) {
        retry.failed(now);
        assert(!retry.ready(now + wait - 1));
        assert(retry.ready(now + wait));
        now += wait;
    }
    retry.reset();
    const std::uint32_t nearWrap = UINT32_MAX - 500;
    retry.failed(nearWrap);
    assert(!retry.ready(498));
    assert(retry.ready(499));
    assert(elapsed(499, nearWrap, 1000));
}

void emitPayloads() {
    char buffer[PAYLOAD_CAPACITY];
    for (unsigned char scenario = 0; scenario <= 6; ++scenario) {
        const auto selected = static_cast<Scenario>(scenario);
        const std::string device = std::string("fw-") + scenarioName(selected);
        for (std::uint32_t seq = 1; seq <= 9; ++seq) {
            assert(serializeTelemetry(buffer, sizeof(buffer), device.c_str(), STAMP, seq,
                                      fakeSample(selected, seq), -55));
            std::cout << buffer << '\n';
        }
    }
    assert(serializeTelemetry(buffer, sizeof(buffer), "fw-pending", STAMP, 1,
                              {missing(), missing(), missing()}, -60));
    std::cout << buffer << '\n';
    assert(serializeTelemetry(buffer, sizeof(buffer), "fw-invalid-values", STAMP, 1,
                              {std::numeric_limits<float>::infinity(), -1, 101}, -60));
    std::cout << buffer << '\n';
    for (const bool online : {false, true}) {
        assert(serializeStatus(buffer, sizeof(buffer), "fw-status", STAMP, online));
        std::cout << buffer << '\n';
    }
    assert(serializeTelemetry(buffer, sizeof(buffer), "fw-calibrated", STAMP, 1,
        {calibratedTemperature(27, 0), calibrate(2500, {2500, 7, 2000, 4}, 0, 14),
         calibrate(2400, {2800, 0, 1800, 100}, 0, 100, true)}, -55));
    std::cout << buffer << '\n';
    assert(serializeTelemetry(buffer, sizeof(buffer), "fw-nocalibration", STAMP, 1,
        {27, calibrate(2500, {missing(), 7, missing(), 4}, 0, 14),
         calibrate(2400, {missing(), 0, missing(), 100}, 0, 100, true)}, -55));
    std::cout << buffer << '\n';
}

int main(int argc, char**) {
    if (argc > 1) emitPayloads();
    else { checkCore(); checkAcquisition(); std::cout << "Firmware core checks passed\n"; }
}
