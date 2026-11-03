#pragma once
#include <Arduino.h>
#include <aquarium_core.h>
#include <sensor_math.h>
#if __has_include("sensors_config.local.h")
#include "sensors_config.local.h"
#else
#include "sensors_config.example.h"
#endif
#if !AQUARIUM_FAKE_SENSORS
#include <OneWire.h>
#include <DallasTemperature.h>
#endif

namespace sensor_runtime {
constexpr bool adc1(int pin) { return pin == 32 || pin == 33 || pin == 34 || pin == 35 || pin == 36 || pin == 39; }
static_assert(adc1(sensor_config::PH_PIN) && adc1(sensor_config::TURBIDITY_PIN), "Analog probes require classic ESP32 ADC1 pins");
static_assert(sensor_config::PH_PIN != sensor_config::TURBIDITY_PIN, "Analog pins must be distinct");
static_assert(sensor_config::ADC_MIN_MV >= 150 && sensor_config::ADC_MAX_MV <= 3000 && sensor_config::ADC_MIN_MV < sensor_config::ADC_MAX_MV, "ADC measurement window must stay within 150..3000 mV");
static_assert(sensor_config::TEMPERATURE_PIN >= 0 && sensor_config::TEMPERATURE_PIN <= 33 && !(sensor_config::TEMPERATURE_PIN >= 6 && sensor_config::TEMPERATURE_PIN <= 11), "Select a bidirectional non-flash GPIO for DS18B20");
static_assert(sensor_config::LED_HOLD_MS >= 100 && sensor_config::LED_HOLD_MS <= 3600000 && sensor_config::PIR_WARMUP_MS <= 3600000, "PIR/LED timing is out of range");
static_assert(!sensor_config::ENABLE_PIR_LED || (sensor_config::PIR_PIN == 27 && sensor_config::LED_PIN == 26), "This board profile reserves GPIO27/26 for PIR/LED");
static_assert(!sensor_config::ENABLE_TEMPERATURE || ((!sensor_config::ENABLE_PH || sensor_config::TEMPERATURE_PIN != sensor_config::PH_PIN) && (!sensor_config::ENABLE_TURBIDITY || sensor_config::TEMPERATURE_PIN != sensor_config::TURBIDITY_PIN)), "Sensor GPIO conflict");
static_assert(!sensor_config::ENABLE_PIR_LED || !sensor_config::ENABLE_TEMPERATURE || (sensor_config::TEMPERATURE_PIN != sensor_config::PIR_PIN && sensor_config::TEMPERATURE_PIN != sensor_config::LED_PIN), "PIR/LED and temperature GPIO conflict");
aquarium::MotionLight light;
aquarium::Calibration phCalibration{sensor_config::PH_POINT_A_MV, sensor_config::PH_POINT_A_VALUE, sensor_config::PH_POINT_B_MV, sensor_config::PH_POINT_B_VALUE};
aquarium::Calibration turbidityCalibration{sensor_config::TURBIDITY_CLEAR_MV, 0, sensor_config::TURBIDITY_CLOUDY_REFERENCE_MV, 100};

#if !AQUARIUM_FAKE_SENSORS
OneWire bus;
DallasTemperature temperature(&bus);
DeviceAddress address{};
bool found = false, converting = false;
float temperatureC = aquarium::missing();
std::uint32_t conversionStarted = 0, temperatureAt = 0, discoveryAt = 0, analogAt = 0;
aquarium::AnalogFilter phFilter, turbidityFilter;

void discoverTemperature(std::uint32_t now) {
    discoveryAt = now;
    temperature.begin();
    found = temperature.getAddress(address, 0) && !temperature.isParasitePowerMode();
    if (found) {
        temperature.setResolution(address, 12);
        temperature.setWaitForConversion(false);
    }
    Serial.printf("[DS18B20] %s (requires 3-wire powered probe)\n", found ? "found" : "not found/unsupported power mode");
}

float sampleMv(int pin) {
    return aquarium::validOrMissing(static_cast<float>(analogReadMilliVolts(pin)), sensor_config::ADC_MIN_MV, sensor_config::ADC_MAX_MV);
}

void pollTemperature(std::uint32_t now) {
    if (!sensor_config::ENABLE_TEMPERATURE) return;
    if (!found && aquarium::elapsed(now, discoveryAt, 5000)) discoverTemperature(now);
    if (!found) return;
    if (converting && aquarium::elapsed(now, conversionStarted, 800)) {
        temperatureC = aquarium::calibratedTemperature(temperature.getTempC(address), sensor_config::TEMPERATURE_OFFSET_C);
        temperatureAt = conversionStarted + 800;
        converting = false;
        if (!std::isfinite(temperatureC)) { found = false; discoveryAt = now; }
    }
    if (found && !converting) {
        temperature.requestTemperatures();
        conversionStarted = now;
        converting = true;
    }
}
#endif
}

inline void initializeSensors() {
    sensor_runtime::light.begin(millis());
    if (sensor_config::ENABLE_PIR_LED) {
        pinMode(sensor_config::PIR_PIN, INPUT);
        pinMode(sensor_config::LED_PIN, OUTPUT);
        digitalWrite(sensor_config::LED_PIN, sensor_config::LED_ACTIVE_HIGH ? LOW : HIGH);
    }
#if !AQUARIUM_FAKE_SENSORS
    if (sensor_config::ENABLE_TEMPERATURE) {
        sensor_runtime::bus.begin(sensor_config::TEMPERATURE_PIN);
        sensor_runtime::discoverTemperature(millis());
    }
    analogReadResolution(12);
    if (sensor_config::ENABLE_PH) analogSetPinAttenuation(sensor_config::PH_PIN, ADC_11db);
    if (sensor_config::ENABLE_TURBIDITY) analogSetPinAttenuation(sensor_config::TURBIDITY_PIN, ADC_11db);
    Serial.println("[SENSORS] real acquisition; unset/disabled calibration publishes null; serial v prints mV");
#endif
}

inline void pollSensors(std::uint32_t now) {
    if (sensor_config::ENABLE_PIR_LED) {
        const bool lit = sensor_runtime::light.update(now, digitalRead(sensor_config::PIR_PIN) == HIGH, sensor_config::PIR_WARMUP_MS, sensor_config::LED_HOLD_MS);
        digitalWrite(sensor_config::LED_PIN, lit == sensor_config::LED_ACTIVE_HIGH ? HIGH : LOW);
    }
#if !AQUARIUM_FAKE_SENSORS
    sensor_runtime::pollTemperature(now);
    if (aquarium::elapsed(now, sensor_runtime::analogAt, 10)) {
        sensor_runtime::analogAt = now;
        if (sensor_config::ENABLE_PH) sensor_runtime::phFilter.push(sensor_runtime::sampleMv(sensor_config::PH_PIN), now);
        if (sensor_config::ENABLE_TURBIDITY) sensor_runtime::turbidityFilter.push(sensor_runtime::sampleMv(sensor_config::TURBIDITY_PIN), now);
    }
#endif
}

inline aquarium::Sample readSensors(aquarium::Scenario scenario, std::uint32_t sequence) {
#if AQUARIUM_FAKE_SENSORS
    return aquarium::fakeSample(scenario, sequence);
#else
    (void)scenario; (void)sequence;
    const auto now = millis();
    return {
        sensor_config::ENABLE_TEMPERATURE && !aquarium::elapsed(now, sensor_runtime::temperatureAt, 2500) ? sensor_runtime::temperatureC : aquarium::missing(),
        sensor_config::ENABLE_PH ? aquarium::calibrate(sensor_runtime::phFilter.value(now), sensor_runtime::phCalibration, 0, 14, false, sensor_config::ADC_MIN_MV, sensor_config::ADC_MAX_MV) : aquarium::missing(),
        sensor_config::ENABLE_TURBIDITY ? aquarium::calibrate(sensor_runtime::turbidityFilter.value(now), sensor_runtime::turbidityCalibration, 0, 100, true, sensor_config::ADC_MIN_MV, sensor_config::ADC_MAX_MV) : aquarium::missing(),
        sensor_config::ENABLE_TURBIDITY ? sensor_runtime::turbidityFilter.value(now) : aquarium::missing(),
        sensor_config::ENABLE_TURBIDITY ? sensor_config::TURBIDITY_CLEAR_MV : aquarium::missing(),
        sensor_config::ENABLE_PH ? sensor_runtime::phFilter.value(now) : aquarium::missing()
    };
#endif
}

inline void printSensorDiagnostics() {
#if AQUARIUM_FAKE_SENSORS
    Serial.println("[SENSORS] fake mode; no real ADC readings");
#else
    const auto now = millis();
    const auto value = readSensors(aquarium::Scenario::Normal, 0);
    Serial.printf("[RAW] temp_C=%.2f ph_pin_mV=%.2f turbidity_pin_mV=%.2f ph=%.2f turbidity_pct=%.2f\n",
        value.temperatureC, sensor_runtime::phFilter.value(now), sensor_runtime::turbidityFilter.value(now), value.ph, value.turbidityPct);
#endif
}
