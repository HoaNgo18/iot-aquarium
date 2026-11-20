#include <Arduino.h>
#include <WiFi.h>
#include <atomic>
#include <ctime>
#include <esp_crt_bundle.h>
#include <esp_sntp.h>
#include <mqtt_client.h>
#include <aquarium_core.h>
#include "mqtt_transport.h"
#include "mqtt_ca.h"

#if defined(AQUARIUM_WSS_BUILD_TEST)
#include "config.wss-build.h"
#elif defined(AQUARIUM_TLS_BUILD_TEST)
#include "config.tls-build.h"
#elif __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif
#include "sensors.h"

#if defined(AQUARIUM_CONFIG_HAS_MQTT_TRANSPORT)
constexpr config::MqttTransport MQTT_TRANSPORT = config::MQTT_TRANSPORT;
#else
// Compatibility for existing config.local.h files from task 07.
constexpr config::MqttTransport MQTT_TRANSPORT =
    config::MQTT_USE_TLS ? config::MqttTransport::Tls : config::MqttTransport::Tcp;
#endif

static_assert(config::SAMPLE_INTERVAL_MS >= 1000 && config::SAMPLE_INTERVAL_MS <= 3600000,
              "Sample interval must be 1 second to 1 hour");
static_assert(config::WIFI_RETRY_MS >= 1000 && config::WIFI_RETRY_MS <= 60000,
              "Wi-Fi retry must be 1 to 60 seconds");
static_assert(config::MQTT_PORT > 0, "MQTT port must not be zero");
static_assert(MQTT_TRANSPORT == config::MqttTransport::Tcp ||
                  (config::MQTT_PORT != 1883 && config::MQTT_PORT != 1884),
              "MQTT TLS must use a dedicated TLS port such as 8883");
static_assert(MQTT_TRANSPORT == config::MqttTransport::Tcp || config::MQTT_HOST[0] != '\0',
              "MQTT TLS/WSS requires a non-empty DNS hostname");
static_assert(MQTT_TRANSPORT != config::MqttTransport::Wss || config::MQTT_PORT == 443,
              "Cloudflare Tunnel WSS must use port 443");
static_assert(config::MQTT_KEEPALIVE_SECONDS > 0 && config::MQTT_KEEPALIVE_SECONDS < 100,
              "MQTT keepalive must stay below Cloudflare's idle WebSocket timeout");
static_assert(config::FAKE_SCENARIO <= 6, "Fake scenario must be 0..6");

namespace {
std::atomic<bool> clockSynchronized{false};
std::atomic<bool> mqttConnected{false};
std::atomic<bool> mqttEnded{false};
esp_mqtt_client_handle_t mqtt = nullptr;
aquarium::RetryBackoff mqttRetry;
aquarium::Scenario scenario = static_cast<aquarium::Scenario>(config::FAKE_SCENARIO);
std::uint32_t sequence = 0;
std::uint32_t lastWifiAttempt = 0;
std::uint32_t lastSample = 0;
std::uint32_t lastClockLog = 0;
std::uint32_t mqttStartedAt = 0;
bool configured = false;
bool ntpStarted = false;
bool onlineSent = false;
char telemetryTopic[128];
char statusTopic[128];
char clientId[96];
char willPayload[aquarium::PAYLOAD_CAPACITY];

bool timestampUtc(char (&buffer)[21]) {
    if (!clockSynchronized.load()) return false;
    const time_t now = time(nullptr);
    if (now < 1704067200) return false; // Reject unset/obviously invalid clock.
    tm utc{};
    return gmtime_r(&now, &utc) && strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc) == 20;
}

void mqttEvent(void*, esp_event_base_t, int32_t eventId, void* eventData) {
    const auto event = static_cast<esp_mqtt_event_handle_t>(eventData);
    switch (eventId) {
        case MQTT_EVENT_CONNECTED:
            mqttConnected.store(true);
            Serial.println("[MQTT] connected");
            if (MQTT_TRANSPORT != config::MqttTransport::Tcp) {
                Serial.printf("[TLS/WSS] free heap after MQTT connect: %u bytes\n", ESP.getFreeHeap());
            }
            break;
        case MQTT_EVENT_DISCONNECTED:
            mqttConnected.store(false);
            mqttEnded.store(true);
            Serial.println("[MQTT] disconnected; reconnect scheduled");
            break;
        case MQTT_EVENT_PUBLISHED:
            Serial.printf("[MQTT] PUBACK id=%d\n", event->msg_id);
            break;
        case MQTT_EVENT_ERROR:
            Serial.println("[MQTT] connection error; check broker address/port/network");
            break;
        default: break;
    }
}

void disposeMqtt() {
    if (mqtt) {
        // Run from Arduino loop, never from the MQTT callback.
        esp_mqtt_client_stop(mqtt);
        esp_mqtt_client_destroy(mqtt);
        mqtt = nullptr;
    }
    mqttConnected.store(false);
    mqttEnded.store(false);
    onlineSent = false;
}

void startMqtt() {
    char timestamp[21];
    if (!timestampUtc(timestamp) ||
        !aquarium::serializeStatus(willPayload, sizeof(willPayload), config::DEVICE_ID, timestamp, false)) return;
    esp_mqtt_client_config_t options{};
    options.host = config::MQTT_HOST;
    options.port = config::MQTT_PORT;
    switch (MQTT_TRANSPORT) {
        case config::MqttTransport::Tls:
            options.transport = MQTT_TRANSPORT_OVER_SSL;
            options.cert_pem = MQTT_CA_PEM;
            break;
        case config::MqttTransport::Wss:
            options.transport = MQTT_TRANSPORT_OVER_WSS;
            options.path = "/";
            // The full ESP-IDF bundle follows Cloudflare Universal SSL CA changes.
            options.crt_bundle_attach = arduino_esp_crt_bundle_attach;
            break;
        case config::MqttTransport::Tcp:
        default:
            options.transport = MQTT_TRANSPORT_OVER_TCP;
            break;
    }
    options.client_id = clientId;
    options.username = config::MQTT_USERNAME[0] ? config::MQTT_USERNAME : nullptr;
    options.password = config::MQTT_PASSWORD[0] ? config::MQTT_PASSWORD : nullptr;
    options.lwt_topic = statusTopic;
    options.lwt_msg = willPayload;
    options.lwt_qos = 1;
    options.lwt_retain = 1;
    options.keepalive = config::MQTT_KEEPALIVE_SECONDS;
    options.disable_auto_reconnect = true; // Recreate with a fresh LWT timestamp on every attempt.
    options.network_timeout_ms = 5000;
    options.buffer_size = 1024;
    mqtt = esp_mqtt_client_init(&options);
    if (!mqtt || esp_mqtt_client_register_event(mqtt, MQTT_EVENT_ANY, mqttEvent, nullptr) != ESP_OK ||
        esp_mqtt_client_start(mqtt) != ESP_OK) {
        Serial.println("[MQTT] could not start client");
        disposeMqtt();
        mqttRetry.failed(millis());
        return;
    }
    mqttStartedAt = millis();
}

void serialCommands() {
    // Bound work per loop so serial input cannot starve network/sampling.
    for (int i = 0; i < 16 && Serial.available(); ++i) {
        const char input = static_cast<char>(Serial.read());
        if (input == 'v') printSensorDiagnostics();
#if AQUARIUM_FAKE_SENSORS
        if (input >= '0' && input <= '6') {
            scenario = static_cast<aquarium::Scenario>(input - '0');
            Serial.printf("[FAKE] scenario=%s\n", aquarium::scenarioName(scenario));
        }
#endif
        if (input == '?') {
            Serial.println("[SENSORS] v = raw mV/temperature diagnostics; PIR/LED runs locally if enabled");
            Serial.println("[FAKE keys] 0 normal; 1 temp-low; 2 temp-high; 3 ph-low; 4 ph-high; 5 cloudy; 6 probe-error");
        }
    }
}

void publishSample() {
    if (sequence == aquarium::MAX_SEQUENCE) {
        Serial.println("[DATA] sequence limit reached; reboot required");
        return;
    }
    char timestamp[21];
    char payload[aquarium::PAYLOAD_CAPACITY];
    if (!timestampUtc(timestamp)) return;
    const auto nextSequence = sequence + 1;
    int rssi = WiFi.RSSI();
    rssi = rssi < -127 ? -127 : (rssi > 0 ? 0 : rssi);
    if (!aquarium::serializeTelemetry(payload, sizeof(payload), config::DEVICE_ID, timestamp,
                                      nextSequence, readSensors(scenario, nextSequence), rssi)) {
        Serial.println("[DATA] invalid payload; not sent");
        return;
    }
    const int id = esp_mqtt_client_enqueue(mqtt, telemetryTopic, payload, 0, 1, 0, true);
    if (id < 0) {
        Serial.println("[MQTT] enqueue failed; sample skipped");
        return;
    }
    sequence = nextSequence;
    Serial.printf("[DATA queued id=%d] %s\n", id, payload);
}
}

void setup() {
    Serial.begin(115200);
    Serial.println();
    Serial.printf("[BOOT] aquarium v2; mode=%s; device=%s\n",
                  AQUARIUM_FAKE_SENSORS ? "FAKE" : "REAL_SENSORS", config::DEVICE_ID);
    initializeSensors();
    configured = config::WIFI_SSID[0] && config::MQTT_HOST[0] && aquarium::validDeviceId(config::DEVICE_ID);
    if (!configured) {
        Serial.println("[CONFIG] fill include/config.local.h: WIFI_SSID, MQTT_HOST, valid DEVICE_ID");
        return;
    }
    snprintf(telemetryTopic, sizeof(telemetryTopic), "aquarium-monitoring/devices/%s/telemetry", config::DEVICE_ID);
    snprintf(statusTopic, sizeof(statusTopic), "aquarium-monitoring/devices/%s/status", config::DEVICE_ID);
    snprintf(clientId, sizeof(clientId), "aquarium-esp32-%s", config::DEVICE_ID);
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(config::WIFI_SSID, config::WIFI_PASSWORD);
    lastWifiAttempt = millis();
    Serial.println("[WiFi] connecting; serial '?' shows scenario keys");
}

void loop() {
    pollSensors(millis());
    serialCommands();
    if (!configured) { delay(20); return; }
    const std::uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
        if (mqtt) {
            disposeMqtt();
            mqttRetry.failed(millis());
        }
        if (aquarium::elapsed(now, lastWifiAttempt, config::WIFI_RETRY_MS)) {
            lastWifiAttempt = now;
            WiFi.disconnect();
            WiFi.begin(config::WIFI_SSID, config::WIFI_PASSWORD);
            Serial.println("[WiFi] retrying");
        }
        delay(10);
        return;
    }
    if (!ntpStarted) {
        sntp_set_time_sync_notification_cb([](timeval*) { clockSynchronized.store(true); });
        configTime(0, 0, config::NTP_PRIMARY, config::NTP_SECONDARY);
        ntpStarted = true;
        Serial.println("[TIME] waiting for NTP; no telemetry until UTC is synchronized");
    }
    char timestamp[21];
    if (!timestampUtc(timestamp)) {
        if (aquarium::elapsed(now, lastClockLog, 10000)) {
            lastClockLog = now;
            Serial.println("[TIME] still waiting; check NTP/internet access");
        }
        delay(10);
        return;
    }
    if (mqtt && (mqttEnded.load() || (!mqttConnected.load() && aquarium::elapsed(now, mqttStartedAt, 20000)))) {
        disposeMqtt();
        mqttRetry.failed(millis());
        delay(10);
        return;
    }
    if (!mqtt && mqttRetry.ready(now)) startMqtt();
    if (!mqttConnected.load()) { delay(10); return; }

    mqttRetry.reset();
    // Bound RAM if the broker stops acknowledging; offline samples are not buffered.
    if (esp_mqtt_client_get_outbox_size(mqtt) >= 4096) {
        if (aquarium::elapsed(now, lastSample, config::SAMPLE_INTERVAL_MS)) {
            lastSample = now;
            Serial.println("[MQTT] outbox full; sample skipped until PUBACK/reconnect");
        }
        delay(10);
        return;
    }
    if (!onlineSent) {
        char payload[aquarium::PAYLOAD_CAPACITY];
        if (aquarium::serializeStatus(payload, sizeof(payload), config::DEVICE_ID, timestamp, true) &&
            esp_mqtt_client_enqueue(mqtt, statusTopic, payload, 0, 1, 1, true) >= 0) {
            onlineSent = true;
            lastSample = now - config::SAMPLE_INTERVAL_MS;
            Serial.println("[MQTT] online status queued (QoS 1, retained)");
        }
    }
    if (onlineSent && aquarium::elapsed(now, lastSample, config::SAMPLE_INTERVAL_MS)) {
        lastSample = now;
        publishSample();
    }
    delay(10);
}
