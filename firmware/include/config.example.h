#pragma once

#include "mqtt_transport.h"

// Copy to config.local.h and fill in locally. Never commit credentials.
namespace config {
constexpr char WIFI_SSID[] = "";
constexpr char WIFI_PASSWORD[] = "";
// LAN IPv4 address of the computer running Mosquitto, NOT localhost or "mqtt".
constexpr char MQTT_HOST[] = "";
constexpr unsigned short MQTT_PORT = 1884; // Current Docker host mapping; verify MQTT_HOST_PORT
constexpr char MQTT_USERNAME[] = "";
constexpr char MQTT_PASSWORD[] = "";
// Tcp: LAN broker (normally port 1883/1884).
// Tls: direct VPS broker with a DNS hostname and port 8883.
// Wss: Cloudflare Tunnel with mqtt.dreamer02.id.vn and port 443.
// TLS/WSS credentials are created by deploy/mqtt-user.sh. Never use an IP for
// TLS/WSS because certificate hostname verification remains enabled.
#define AQUARIUM_CONFIG_HAS_MQTT_TRANSPORT 1
constexpr MqttTransport MQTT_TRANSPORT = MqttTransport::Tcp;

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
// Serial keys 0..6 can change this at runtime; see README.
constexpr unsigned char FAKE_SCENARIO = 0;
}
