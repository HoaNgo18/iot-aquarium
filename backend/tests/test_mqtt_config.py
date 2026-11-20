import unittest
from unittest import mock

from app.config import Settings
from app.mqtt_consumer import MqttConsumer


class MqttConfigurationTests(unittest.TestCase):
    def test_credentials_are_optional_for_development(self):
        settings = Settings(_env_file=None)
        self.assertIsNone(settings.mqtt_username)
        self.assertIsNone(settings.mqtt_password)

        with mock.patch("app.mqtt_consumer.mqtt.Client") as client_factory:
            MqttConsumer(settings)

        client_factory.return_value.username_pw_set.assert_not_called()

    def test_consumer_sets_configured_credentials(self):
        settings = Settings(
            _env_file=None,
            mqtt_username="backend",
            mqtt_password="secret-value",
        )

        with mock.patch("app.mqtt_consumer.mqtt.Client") as client_factory:
            MqttConsumer(settings)

        client_factory.return_value.username_pw_set.assert_called_once_with(
            "backend", "secret-value"
        )


if __name__ == "__main__":
    unittest.main()
