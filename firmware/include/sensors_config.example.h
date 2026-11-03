#pragma once
#include <limits>

// Copy to sensors_config.local.h. Defaults target classic ESP32-WROOM/esp32dev only.
// ADC voltages below refer to the ESP32 pin AFTER a verified divider/buffer.
namespace sensor_config {
constexpr bool ENABLE_TEMPERATURE =
#ifdef AQUARIUM_PH_BENCH
    false;
#else
    true;
#endif
constexpr int TEMPERATURE_PIN = 4;
constexpr float TEMPERATURE_OFFSET_C = 0;

// Enable a channel only after checking module pinout, signal type and voltage.
// Without calibration, publish ph_mv only; ph remains null.
constexpr bool ENABLE_PH =
#ifdef AQUARIUM_PH_BENCH
    true;
#else
    false;
#endif
constexpr int PH_PIN = 34; // ADC1: works while Wi-Fi is active
constexpr bool ENABLE_TURBIDITY = false;
constexpr int TURBIDITY_PIN = 35; // ADC1
constexpr float ADC_MIN_MV = 150;
constexpr float ADC_MAX_MV = 3000;
constexpr float UNSET = std::numeric_limits<float>::quiet_NaN();
constexpr float PH_POINT_A_MV = UNSET;
constexpr float PH_POINT_A_VALUE = UNSET; // Exact value printed on your buffer
constexpr float PH_POINT_B_MV = UNSET;
constexpr float PH_POINT_B_VALUE = UNSET;
constexpr float TURBIDITY_CLEAR_MV = UNSET;
constexpr float TURBIDITY_CLOUDY_REFERENCE_MV = UNSET;

// Optional local person detection. No motion data is added to telemetry v2.
constexpr bool ENABLE_PIR_LED = false;
constexpr int PIR_PIN = 27;
constexpr int LED_PIN = 26;
constexpr bool LED_ACTIVE_HIGH = true;
constexpr unsigned long PIR_WARMUP_MS = 60000;
constexpr unsigned long LED_HOLD_MS = 15000;
}
