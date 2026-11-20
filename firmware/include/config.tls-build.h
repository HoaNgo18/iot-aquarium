#pragma once

#include "mqtt_transport.h"

// Compile-only configuration used by the *-tls PlatformIO environments.
// Never flash this file: all values are deliberately non-secret placeholders.
namespace config {
constexpr char WIFI_SSID[] = "build-test-only";
constexpr char WIFI_PASSWORD[] = "build-test-only";
constexpr char MQTT_HOST[] = "aquasense.example.com";
constexpr unsigned short MQTT_PORT = 8883;
constexpr char MQTT_USERNAME[] = "build-test-device";
constexpr char MQTT_PASSWORD[] = "build-test-only";
#define AQUARIUM_CONFIG_HAS_MQTT_TRANSPORT 1
constexpr MqttTransport MQTT_TRANSPORT = MqttTransport::Tls;

#if AQUARIUM_FAKE_SENSORS
constexpr char DEVICE_ID[] = "tank-demo-001";
#else
constexpr char DEVICE_ID[] = "tank-001";
#endif

constexpr char NTP_PRIMARY[] = "pool.ntp.org";
constexpr char NTP_SECONDARY[] = "time.google.com";
constexpr unsigned long SAMPLE_INTERVAL_MS = 5000;
constexpr unsigned long WIFI_RETRY_MS = 15000;
constexpr int MQTT_KEEPALIVE_SECONDS = 30;
constexpr unsigned char FAKE_SCENARIO = 0;
}
