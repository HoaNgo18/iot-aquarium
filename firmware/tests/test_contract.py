"""Compile the actual C++ payload code on the host, then ingest its JSON in FastAPI's domain.

Requires g++ on PATH (or CXX=/absolute/path/to/g++) and backend/requirements-test.txt.
Run from repository root: python -m unittest discover -s firmware/tests -v
Does not connect to MQTT, a board or the production database.
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.ingest import IngestResult, ingest_message
from app.models import Alert, Telemetry
from app.schemas import StatusPayload, TelemetryPayload


class FirmwareContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = os.environ.get("CXX") or shutil.which("g++")
        if not compiler:
            raise RuntimeError("Install a host C++ compiler or set CXX to g++ before running firmware tests")
        cls.directory = tempfile.TemporaryDirectory(prefix="aquarium-firmware-")
        cls.addClassCleanup(cls.directory.cleanup)
        cls.binary = Path(cls.directory.name) / ("core_test.exe" if os.name == "nt" else "core_test")
        result = subprocess.run([
            compiler, "-std=c++11", "-Wall", "-Wextra", "-Werror",
            "-I", "lib/AquariumCore/src", "tests/core_test.cpp", "-o", str(cls.binary),
        ], cwd=ROOT / "firmware", capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(f"C++ compilation failed:\n{result.stdout}\n{result.stderr}")
        generated = subprocess.run([str(cls.binary), "--emit"], check=True,
                                   capture_output=True, text=True, timeout=10)
        cls.documents = [json.loads(line) for line in generated.stdout.splitlines()]

    def test_cpp_guards_scenarios_and_retry_rollover(self):
        result = subprocess.run([str(self.binary)], check=True, capture_output=True, text=True, timeout=10)
        self.assertIn("Firmware core checks passed", result.stdout)

    def test_generated_payloads_match_backend_schema(self):
        self.assertEqual(len(self.documents), 69)
        for document in self.documents:
            with self.subTest(device=document["device_id"], sequence=document.get("sequence")):
                model = TelemetryPayload if "sequence" in document else StatusPayload
                model.model_validate(document)
                self.assertEqual(document["schema_version"], 2)

    def test_unconfigured_and_invalid_probes_are_null(self):
        for device in ("fw-pending", "fw-invalid-values"):
            document = next(item for item in self.documents if item["device_id"] == device)
            self.assertEqual(document["sensor_status"], "error")
            for field in ("temperature_c", "ph", "turbidity_pct"):
                self.assertIsNone(document[field])
        failures = [item for item in self.documents if item["device_id"] == "fw-sensor-error"
                    and item["sensor_status"] == "error"]
        self.assertEqual(len(failures), 3)
        for document, failed in zip(failures, ("ph", "temperature_c", "turbidity_pct")):
            self.assertIsNone(document[failed])
            self.assertEqual(sum(document[field] is None for field in ("temperature_c", "ph", "turbidity_pct")), 1)

    def test_cpp_payloads_store_deduplicate_and_trigger_expected_alerts(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine)
        for document in self.documents:
            kind = "telemetry" if "sequence" in document else "status"
            topic = f"aquarium-monitoring/devices/{document['device_id']}/{kind}"
            raw = json.dumps(document).encode()
            self.assertEqual(ingest_message(topic, raw, sessions), IngestResult.STORED)
            if kind == "telemetry":
                self.assertEqual(ingest_message(topic, raw, sessions), IngestResult.DUPLICATE)
        expected = {
            "fw-normal": set(), "fw-temperature-low": {"temperature"},
            "fw-temperature-high": {"temperature"}, "fw-ph-low": {"ph"},
            "fw-ph-high": {"ph"}, "fw-turbidity-high": {"turbidity"},
            # Same-timestamp later samples do not replace current health. The
            # first fw-sensor-error row is healthy; individual errors cover nulls.
            "fw-sensor-error": set(), "fw-pending": {"sensor_error_temperature", "sensor_error_ph", "sensor_error_clarity"},
            "fw-invalid-values": {"sensor_error_temperature", "sensor_error_ph", "sensor_error_clarity"}, "fw-status": set(),
            "fw-calibrated": set(), "fw-nocalibration": {"sensor_error_ph", "sensor_error_clarity"},
        }
        with sessions() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Telemetry)), 67)
            for device, kinds in expected.items():
                active = list(session.scalars(select(Alert).where(Alert.device_id == device, Alert.ended_at.is_(None))))
                self.assertEqual({alert.alert_type for alert in active}, kinds, device)
                if device == "fw-turbidity-high":
                    self.assertEqual(active[0].severity, "critical")


if __name__ == "__main__":
    unittest.main()
