"""Relative signal indicator, not NTU or proof of water safety."""
from datetime import timezone
import math
from statistics import median
from sqlalchemy import select
from app.models import Telemetry, ClarityBaseline
from app.domain.alert_rules import AlertDecision
from app.repositories.alerts import apply_decision
from app.domain.clarity_config import CLARITY_CONFIG
from app.services.device_settings import effective_settings, clarity_revision

def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

def classify(clarity_pct, previous=None, rules=None):
    rules = rules or CLARITY_CONFIG
    if clarity_pct < rules.cloudy_below_pct or previous == "cloudy" and clarity_pct <= rules.cloudy_recovery_above_pct:
        return "cloudy"
    if clarity_pct < rules.clear_min_pct or previous in ("slight", "cloudy") and clarity_pct <= rules.clear_recovery_above_pct:
        return "slight"
    return "clear"

def process(session, row):
    rules, _ = effective_settings(session, row.device_id)
    row.settings_revision = clarity_revision(session, row.device_id)
    with session.no_autoflush:
        previous = session.scalar(select(Telemetry).where(Telemetry.device_id == row.device_id)
            .order_by(Telemetry.measured_at.desc(), Telemetry.id.desc()).limit(1))
        baseline = session.scalar(select(ClarityBaseline).where(
            ClarityBaseline.device_id == row.device_id, ClarityBaseline.created_at <= row.measured_at)
            .order_by(ClarityBaseline.created_at.desc(), ClarityBaseline.id.desc()).limit(1))
    if baseline:
        row.turbidity_reference_mv = baseline.reference_mv
        row.clarity_baseline_at = baseline.created_at
    if previous and utc(row.measured_at) <= utc(previous.measured_at):
        return  # Never rewind persistent state/alerts on delayed samples.
    mv, ref = row.turbidity_mv, row.turbidity_reference_mv
    if mv is None or ref is None or not (150 <= mv <= 3000 and 150 <= ref <= 3000):
        return  # Unknown breaks the continuity timer; do not resolve an existing alert.
    gap = (utc(row.measured_at) - utc(previous.measured_at)).total_seconds() if previous else None
    continuous = (previous is not None and gap is not None and 0 < gap <= 30
        and previous.clarity_mv is not None and previous.turbidity_reference_mv == ref
        and previous.settings_revision == row.settings_revision
        and previous.clarity_baseline_at == row.clarity_baseline_at)
    window = [mv]
    if continuous and rules.median_window > 1:
        with session.no_autoflush:
            recent = list(session.scalars(select(Telemetry).where(Telemetry.device_id == row.device_id)
                .order_by(Telemetry.measured_at.desc(), Telemetry.id.desc()).limit(rules.median_window - 1)))
        newer_at = utc(row.measured_at)
        for sample in recent:
            if (sample.turbidity_mv is None or sample.turbidity_reference_mv != ref
                or sample.clarity_baseline_at != row.clarity_baseline_at
                or not 0 < (newer_at - utc(sample.measured_at)).total_seconds() <= 30):
                break
            window.append(sample.turbidity_mv)
            newer_at = utc(sample.measured_at)
    filtered = median(window)
    alpha = 1 - math.exp(-gap / rules.ema_seconds) if continuous else 1
    row.clarity_mv = alpha * filtered + (1 - alpha) * previous.clarity_mv if continuous else filtered
    # Do not clip above 100: values above reference remain visible for diagnostics.
    row.clarity_pct = 100 * row.clarity_mv / ref
    row.clarity_state = classify(row.clarity_pct, previous.clarity_state if continuous else None, rules)
    row.clarity_since = previous.clarity_since if continuous and previous.clarity_state == row.clarity_state else row.measured_at
    duration = (utc(row.measured_at) - utc(row.clarity_since)).total_seconds()
    if row.clarity_state == "cloudy" and duration < rules.alert_after_seconds:
        return
    apply_decision(session, row.device_id, AlertDecision("clarity", row.clarity_state == "cloudy", "warning",
        f"Độ trong thấp kéo dài ít nhất {rules.alert_after_seconds // 60} phút. Kiểm tra đầu dò, bọt khí và lọc; cân nhắc thay nước phù hợp."), row.measured_at)
