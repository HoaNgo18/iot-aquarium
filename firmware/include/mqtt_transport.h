#pragma once

namespace config {
enum class MqttTransport : unsigned char {
    Tcp,
    Tls,
    Wss,
};
}

