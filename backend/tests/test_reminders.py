from datetime import date
import unittest
from unittest import mock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import auth as auth_api
from app.database import Base, get_db
from app.domain.recurrence import next_due
from app.main import create_app
from app.security import pairing_code


class RecurrenceTests(unittest.TestCase):
    def test_steps_and_skips_past_dates(self):
        today = date(2026, 11, 4)
        self.assertEqual(next_due(date(2026, 11, 4), "daily", today), date(2026, 11, 5))
        self.assertEqual(next_due(date(2026, 11, 4), "weekly", today), date(2026, 11, 11))
        self.assertEqual(next_due(date(2026, 11, 4), "biweekly", today), date(2026, 11, 18))
        self.assertEqual(next_due(date(2026, 10, 1), "weekly", today), date(2026, 11, 5))  # quá hạn lâu: nhảy tới tương lai
        self.assertEqual(next_due(date(2026, 1, 31), "monthly", date(2026, 1, 31)), date(2026, 2, 28))
        self.assertEqual(next_due(date(2026, 12, 15), "monthly", today), date(2027, 1, 15))


class ReminderApiTests(unittest.TestCase):
    def setUp(self):
        auth_api._FAILURES.clear()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.app = create_app(start_background_services=False)

        def db_override():
            with self.sessions() as session:
                yield session

        self.app.dependency_overrides[get_db] = db_override
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.client.post("/api/v1/auth/register", json={"username": "hoa", "display_name": "Hòa", "password": "matkhau-123"})
        self.tank = self.client.post("/api/v1/tanks", json={"name": "Bể chính", "device_id": "tank-a", "pairing_code": pairing_code("tank-a")}).json()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.engine.dispose()

    def create(self, **extra):
        body = {"title": "Thay 30% nước", "tank_id": self.tank["id"], "repeat": "weekly", "due_date": "2026-11-04", **extra}
        return self.client.post("/api/v1/reminders", json=body)

    def test_requires_login(self):
        anon = TestClient(self.app)
        self.assertEqual(anon.get("/api/v1/reminders").status_code, 401)

    def test_crud_and_validation(self):
        created = self.create(note=" dùng nước đã khử clo ")
        self.assertEqual(created.status_code, 201)
        item = created.json()
        self.assertEqual(item["tank_name"], "Bể chính")
        self.assertEqual(item["note"], "dùng nước đã khử clo")
        self.assertEqual(self.create(title="  ").status_code, 422)
        self.assertEqual(self.create(repeat="yearly").status_code, 422)
        self.assertEqual(self.create(tank_id=9999).status_code, 404)
        updated = self.client.patch(f"/api/v1/reminders/{item['id']}", json={"title": "Thay 50% nước", "repeat": "biweekly"})
        self.assertEqual(updated.json()["title"], "Thay 50% nước")
        self.assertEqual(updated.json()["repeat"], "biweekly")
        general = self.create(tank_id=None, title="Mua thức ăn", repeat="none")
        self.assertIsNone(general.json()["tank_name"])
        self.assertEqual(len(self.client.get("/api/v1/reminders").json()), 2)
        self.assertEqual(self.client.delete(f"/api/v1/reminders/{item['id']}").status_code, 204)
        self.assertEqual(len(self.client.get("/api/v1/reminders").json()), 1)

    def test_complete_repeating_and_one_off(self):
        weekly = self.create().json()
        with mock.patch("app.api.reminders.today_vn", return_value=date(2026, 11, 4)):
            done = self.client.post(f"/api/v1/reminders/{weekly['id']}/complete").json()
        self.assertEqual(done["due_date"], "2026-11-11")
        self.assertIsNone(done["done_at"])
        self.assertIsNotNone(done["last_done_at"])
        once = self.create(repeat="none").json()
        finished = self.client.post(f"/api/v1/reminders/{once['id']}/complete").json()
        self.assertIsNotNone(finished["done_at"])
        reopened = self.client.post(f"/api/v1/reminders/{once['id']}/reopen").json()
        self.assertIsNone(reopened["done_at"])

    def test_other_users_cannot_touch_reminders(self):
        item = self.create().json()
        other = TestClient(self.app)
        other.post("/api/v1/auth/register", json={"username": "lan", "display_name": "Lan", "password": "matkhau-123"})
        self.assertEqual(other.get("/api/v1/reminders").json(), [])
        self.assertEqual(other.patch(f"/api/v1/reminders/{item['id']}", json={"title": "x"}).status_code, 404)
        self.assertEqual(other.post(f"/api/v1/reminders/{item['id']}/complete").status_code, 404)
        self.assertEqual(other.delete(f"/api/v1/reminders/{item['id']}").status_code, 404)
        self.assertEqual(other.post("/api/v1/reminders", json={"title": "x", "tank_id": self.tank["id"], "due_date": "2026-11-04"}).status_code, 404)

    def test_deleting_tank_removes_its_reminders(self):
        self.create()
        self.create(tank_id=None, title="Việc chung")
        self.client.delete(f"/api/v1/tanks/{self.tank['id']}")
        titles = [item["title"] for item in self.client.get("/api/v1/reminders").json()]
        self.assertEqual(titles, ["Việc chung"])


if __name__ == "__main__":
    unittest.main()
