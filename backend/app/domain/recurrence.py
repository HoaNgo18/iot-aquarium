"""Tính hạn kế tiếp của việc lặp lại; luôn trả về một ngày sau `today`."""
import calendar
from datetime import date, timedelta

REPEATS = ("none", "daily", "weekly", "biweekly", "monthly")


def _add_month(value: date) -> date:
    year, month = (value.year + 1, 1) if value.month == 12 else (value.year, value.month + 1)
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def step(value: date, repeat: str) -> date:
    if repeat == "daily":
        return value + timedelta(days=1)
    if repeat == "weekly":
        return value + timedelta(weeks=1)
    if repeat == "biweekly":
        return value + timedelta(weeks=2)
    if repeat == "monthly":
        return _add_month(value)
    raise ValueError(f"Không lặp: {repeat}")


def next_due(due: date, repeat: str, today: date) -> date:
    following = step(due, repeat)
    while following <= today:
        following = step(following, repeat)
    return following
