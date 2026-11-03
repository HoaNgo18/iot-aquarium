#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>

namespace aquarium {

constexpr std::size_t PAYLOAD_CAPACITY = 512;
constexpr std::uint32_t MAX_SEQUENCE = 2147483647;  // PostgreSQL INTEGER

inline float missing() { return std::numeric_limits<float>::quiet_NaN(); }

struct Sample {
    float temperatureC;
    float ph;
    float turbidityPct;
    float turbidityMv;
    float turbidityReferenceMv;
    float phMv;
    Sample(float t, float p, float turbidity, float mv = missing(), float reference = missing(), float phVoltage = missing())
        : temperatureC(t), ph(p), turbidityPct(turbidity), turbidityMv(mv), turbidityReferenceMv(reference), phMv(phVoltage) {}
};

enum class Scenario : unsigned char {
    Normal, TemperatureLow, TemperatureHigh, PhLow, PhHigh, TurbidityHigh, SensorError
};

inline const char* scenarioName(Scenario scenario) {
    switch (scenario) {
        case Scenario::Normal: return "normal";
        case Scenario::TemperatureLow: return "temperature-low";
        case Scenario::TemperatureHigh: return "temperature-high";
        case Scenario::PhLow: return "ph-low";
        case Scenario::PhHigh: return "ph-high";
        case Scenario::TurbidityHigh: return "turbidity-high";
        case Scenario::SensorError: return "sensor-error";
    }
    return "invalid";
}

inline Sample fakeSample(Scenario scenario, std::uint32_t sequence) {
    const float offset = static_cast<float>(sequence % 11) / 10.0f;
    Sample value{26.5f + offset, 6.9f + offset * 0.4f, 12.0f + offset * 10.0f};
    switch (scenario) {
        case Scenario::TemperatureLow: value.temperatureC = 18.0f + offset; break;
        case Scenario::TemperatureHigh: value.temperatureC = 33.0f + offset; break;
        case Scenario::PhLow: value.ph = 5.0f + offset * 0.5f; break;
        case Scenario::PhHigh: value.ph = 9.0f + offset * 0.5f; break;
        case Scenario::TurbidityHigh: value.turbidityPct = 85.0f + offset * 5.0f; break;
        case Scenario::SensorError:
            if (sequence != 0 && sequence % 3 == 0) {
                switch ((sequence / 3 - 1) % 3) {
                    case 0: value.ph = missing(); break;
                    case 1: value.temperatureC = missing(); break;
                    case 2: value.turbidityPct = missing(); break;
                }
            }
            break;
        default: break;
    }
    return value;
}

inline float validOrMissing(float value, float minimum, float maximum) {
    return std::isfinite(value) && value >= minimum && value <= maximum ? value : missing();
}

inline Sample normalize(Sample value) {
    return {validOrMissing(value.temperatureC, -55, 125),
            validOrMissing(value.ph, 0, 14), validOrMissing(value.turbidityPct, 0, 100),
            validOrMissing(value.turbidityMv, 150, 3000),
            validOrMissing(value.turbidityReferenceMv, 150, 3000),
            validOrMissing(value.phMv, 150, 3000)};
}

inline bool hasError(Sample value) {
    return !std::isfinite(value.temperatureC) || (!std::isfinite(value.ph) && !std::isfinite(value.phMv)) ||
           (!std::isfinite(value.turbidityPct) && !(std::isfinite(value.turbidityMv) && std::isfinite(value.turbidityReferenceMv)));
}

inline bool alphanumeric(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
}

inline bool validDeviceId(const char* value) {
    if (!value || !alphanumeric(value[0])) return false;
    const auto length = std::strlen(value);
    if (length > 64) return false;
    for (std::size_t i = 1; i < length; ++i) {
        if (!alphanumeric(value[i]) && value[i] != '-' && value[i] != '_') return false;
    }
    return true;
}

// Internal UTC formatter supplies YYYY-MM-DDTHH:MM:SSZ; exclude quotes/escapes.
inline bool validTimestampShape(const char* value) {
    if (!value || std::strlen(value) != 20) return false;
    for (std::size_t i = 0; i < 20; ++i) {
        char expected = 0;
        if (i == 4 || i == 7) expected = '-';
        else if (i == 10) expected = 'T';
        else if (i == 13 || i == 16) expected = ':';
        else if (i == 19) expected = 'Z';
        if (expected ? value[i] != expected : (value[i] < '0' || value[i] > '9')) return false;
    }
    return true;
}

inline void numberOrNull(float value, char (&buffer)[16]) {
    if (std::isfinite(value)) std::snprintf(buffer, sizeof(buffer), "%.2f", static_cast<double>(value));
    else std::snprintf(buffer, sizeof(buffer), "null");
}

inline bool serializeTelemetry(char* buffer, std::size_t capacity, const char* device,
                               const char* timestamp, std::uint32_t sequence,
                               Sample sample, int rssi) {
    if (!buffer || capacity == 0) return false;
    buffer[0] = '\0';
    if (!validDeviceId(device) || !validTimestampShape(timestamp) || sequence == 0 ||
        sequence > MAX_SEQUENCE || rssi < -127 || rssi > 0) return false;
    sample = normalize(sample);
    char temperature[16], ph[16], turbidity[16];
    numberOrNull(sample.temperatureC, temperature);
    numberOrNull(sample.ph, ph);
    numberOrNull(sample.turbidityPct, turbidity);
    char mv[16], reference[16], phMv[16];
    numberOrNull(sample.phMv, phMv);
    numberOrNull(sample.turbidityMv, mv);
    numberOrNull(sample.turbidityReferenceMv, reference);
    const int written = std::snprintf(buffer, capacity,
        "{\"schema_version\":2,\"device_id\":\"%s\",\"timestamp\":\"%s\",\"sequence\":%lu,"
        "\"temperature_c\":%s,\"ph\":%s,\"turbidity_pct\":%s,\"signal_strength_dbm\":%d,"
        "\"sensor_status\":\"%s\",\"turbidity_mv\":%s,\"turbidity_reference_mv\":%s,\"ph_mv\":%s}",
        device, timestamp, static_cast<unsigned long>(sequence), temperature, ph, turbidity,
        rssi, hasError(sample) ? "error" : "normal", mv, reference, phMv);
    if (written < 0 || static_cast<std::size_t>(written) >= capacity) {
        buffer[0] = '\0';
        return false;
    }
    return true;
}

inline bool serializeStatus(char* buffer, std::size_t capacity, const char* device,
                            const char* timestamp, bool online) {
    if (!buffer || capacity == 0) return false;
    buffer[0] = '\0';
    if (!validDeviceId(device) || !validTimestampShape(timestamp)) return false;
    const int written = std::snprintf(buffer, capacity,
        "{\"schema_version\":2,\"device_id\":\"%s\",\"timestamp\":\"%s\",\"connectivity\":\"%s\"}",
        device, timestamp, online ? "online" : "offline");
    if (written < 0 || static_cast<std::size_t>(written) >= capacity) {
        buffer[0] = '\0';
        return false;
    }
    return true;
}

inline bool elapsed(std::uint32_t now, std::uint32_t since, std::uint32_t interval) {
    return static_cast<std::uint32_t>(now - since) >= interval;
}

class RetryBackoff {
public:
    bool ready(std::uint32_t now) const { return elapsed(now, since_, wait_); }
    void failed(std::uint32_t now) {
        since_ = now;
        wait_ = wait_ == 0 ? 1000 : (wait_ >= 15000 ? 30000 : wait_ * 2);
    }
    void reset() { wait_ = 0; }
private:
    std::uint32_t since_ = 0;
    std::uint32_t wait_ = 0;
};
}
