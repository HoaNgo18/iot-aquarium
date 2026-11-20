#pragma once

#include "mqtt_transport.h"

// Compile-only placeholders. Never flash this file as a real configuration.
namespace config {
constexpr char WIFI_SSID[] = "build-test";
constexpr char WIFI_PASSWORD[] = "build-test-only";
constexpr char MQTT_HOST[] = "mqtt.dreamer02.id.vn";
constexpr unsigned short MQTT_PORT = 443;
constexpr char MQTT_USERNAME[] = "build-test-device";
constexpr char MQTT_PASSWORD[] = "build-test-only";
#define AQUARIUM_CONFIG_HAS_MQTT_TRANSPORT 1
constexpr MqttTransport MQTT_TRANSPORT = MqttTransport::Wss;
constexpr char DEVICE_ID[] = "build-test-device";
constexpr char NTP_PRIMARY[] = "pool.ntp.org";
constexpr char NTP_SECONDARY[] = "time.google.com";
constexpr unsigned long SAMPLE_INTERVAL_MS = 5000;
constexpr unsigned long WIFI_RETRY_MS = 15000;
constexpr int MQTT_KEEPALIVE_SECONDS = 30;
constexpr unsigned char FAKE_SCENARIO = 0;
}

