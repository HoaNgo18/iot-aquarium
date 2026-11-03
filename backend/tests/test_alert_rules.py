import unittest

from app.domain.alert_rules import ThresholdValues, evaluate_connectivity, evaluate_telemetry


class PureAlertRuleTests(unittest.TestCase):
    def evaluate(self, **changes):
        values = dict(temperature_c=27.0, ph=7.0, turbidity_pct=20.0,
                      sensor_status="normal", thresholds=ThresholdValues(22, 30, 6.5, 8.5, 60, 80))
        values.update(changes)
        return {d.alert_type: d for d in evaluate_telemetry(**values)}

    def test_normal_and_boundary_measurements(self):
        for values in ({}, {"temperature_c": 22, "ph": 8.5}, {"temperature_c": 30, "ph": 6.5}):
            self.assertFalse(any(d.active for d in self.evaluate(**values).values()))

    def test_high_and_low_temperature(self):
        for value in (18, 34):
            self.assertTrue(self.evaluate(temperature_c=value)["temperature"].active)

    def test_high_and_low_ph(self):
        for value in (5, 10):
            self.assertTrue(self.evaluate(ph=value)["ph"].active)

    def test_turbidity_severity_and_boundaries(self):
        self.assertFalse(self.evaluate(turbidity_pct=59.9)["turbidity"].active)
        self.assertEqual(self.evaluate(turbidity_pct=60)["turbidity"].severity, "warning")
        self.assertEqual(self.evaluate(turbidity_pct=80)["turbidity"].severity, "critical")

    def test_failed_probe_does_not_invent_a_normal_value(self):
        decisions = self.evaluate(ph=None, sensor_status="error", temperature_c=34)
        self.assertNotIn("ph", decisions)
        self.assertTrue(decisions["sensor_error_ph"].active)
        self.assertTrue(decisions["temperature"].active)
        self.assertIn("pH", decisions["sensor_error_ph"].message)
        self.assertFalse(decisions["sensor_error_temperature"].active)

    def test_raw_clarity_is_valid_without_legacy_percent(self):
        decisions = self.evaluate(turbidity_pct=None, turbidity_mv=244.9,
                                  turbidity_reference_mv=294, sensor_status="error")
        self.assertFalse(any(d.active for d in decisions.values()))
        decisions = self.evaluate(turbidity_pct=None, turbidity_mv=None,
                                  turbidity_reference_mv=294, sensor_status="error")
        self.assertTrue(decisions["sensor_error_clarity"].active)

    def test_telemetry_is_evidence_device_is_online(self):
        self.assertFalse(self.evaluate()["offline"].active)
        self.assertTrue(evaluate_connectivity("offline")[0].active)


if __name__ == "__main__":
    unittest.main()
