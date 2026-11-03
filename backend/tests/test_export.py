from datetime import datetime, timedelta, timezone
import csv
import io
import json
from pathlib import Path
import sys
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.api.deps import authorize_device
from app.ingest import ingest_message
from app.main import create_app

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "simulator"))
from telemetry import TelemetryGenerator


class ExportCsvTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.app = create_app(start_background_services=False)

        def db_override():
            with self.sessions() as session:
                yield session

        self.app.dependency_overrides[get_db] = db_override
        self.app.dependency_overrides[authorize_device] = lambda: None
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.start = datetime(2026, 11, 3, 1, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.engine.dispose()

    def send(self, count, device="tank-export", scenario="normal"):
        step = iter(range(count))
        generator = TelemetryGenerator(device, scenario, seed=7,
            clock=lambda: (self.start + timedelta(seconds=5 * next(step))).isoformat())
        documents = []
        for _ in range(count):
            document = generator.next_payload()
            ingest_message(f"aquarium-monitoring/devices/{device}/telemetry", json.dumps(document).encode(), self.sessions)
            documents.append(document)
        return documents

    def export(self, device="tank-export", start=None, end=None):
        start = start or self.start - timedelta(minutes=1)
        end = end or self.start + timedelta(hours=1)
        return self.client.get(f"/api/v1/devices/{device}/telemetry/export.csv",
                               params={"from": start.isoformat(), "to": end.isoformat()})

    def rows(self, response):
        text = response.content.decode("utf-8")
        self.assertTrue(text.startswith("﻿"))
        return list(csv.DictReader(io.StringIO(text[1:])))

    def test_exports_every_sample_in_range_in_time_order(self):
        documents = self.send(12)
        response = self.export()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/csv"))
        self.assertIn('filename="tank-export_20261103-0759_20261103-0900.csv"', response.headers["content-disposition"])
        rows = self.rows(response)
        self.assertEqual(len(rows), 12)
        self.assertEqual(response.headers["x-row-count"], "12")
        self.assertEqual([int(row["sequence"]) for row in rows], [d["sequence"] for d in documents])
        self.assertEqual(rows[0]["measured_at_utc"], "2026-11-03T01:00:00.000+00:00")
        self.assertEqual(rows[0]["measured_at_vn"], "2026-11-03T08:00:00.000+07:00")
        self.assertAlmostEqual(float(rows[0]["temperature_c"]), documents[0]["temperature_c"], places=3)

    def test_range_filter_is_inclusive_and_excludes_outside_samples(self):
        self.send(10)
        response = self.export(start=self.start + timedelta(seconds=10), end=self.start + timedelta(seconds=20))
        self.assertEqual(len(self.rows(response)), 3)

    def test_null_values_become_empty_cells(self):
        documents = self.send(3, device="tank-null", scenario="sensor-error")
        rows = self.rows(self.export(device="tank-null"))
        checked = 0
        for row, document in zip(rows, documents):
            for field in ("temperature_c", "ph"):
                if document.get(field) is None:
                    self.assertEqual(row[field], "")
                    checked += 1
        self.assertGreater(checked, 0)

    def test_empty_range_returns_header_only(self):
        self.send(2)
        response = self.export(start=self.start + timedelta(days=1), end=self.start + timedelta(days=2))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.rows(response), [])

    def test_rejects_invalid_ranges_and_unknown_device(self):
        self.send(1)
        self.assertEqual(self.export(start=self.start, end=self.start).status_code, 422)
        self.assertEqual(self.export(end=self.start + timedelta(days=40)).status_code, 422)
        naive = self.client.get("/api/v1/devices/tank-export/telemetry/export.csv",
                                params={"from": "2026-11-03T00:00:00", "to": "2026-11-03T01:00:00"})
        self.assertEqual(naive.status_code, 422)
        self.assertEqual(self.export(device="tank-missing").status_code, 404)


if __name__ == "__main__":
    unittest.main()
