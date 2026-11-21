#!/usr/bin/env python3
"""Reject unsafe use of the production self-hosted runner."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
UNSAFE_TRIGGERS = ("pull_request", "pull_request_target", "issue_comment")
REQUIRED_DEPLOY_CONDITIONS = (
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.event == 'push'",
)


def main() -> int:
    errors: list[str] = []
    files = sorted([*WORKFLOWS.glob("*.yml"), *WORKFLOWS.glob("*.yaml")])
    if not files:
        errors.append("No workflow files found")

    for path in files:
        text = path.read_text(encoding="utf-8")
        if re.search(r"runs-on\s*:\s*.*self-hosted", text):
            if path.name != "deploy.yml":
                errors.append(f"{path.name}: self-hosted runner is only allowed in deploy.yml")
            for trigger in UNSAFE_TRIGGERS:
                if re.search(rf"^\s*{re.escape(trigger)}\s*:", text, re.MULTILINE):
                    errors.append(f"{path.name}: unsafe trigger {trigger!r} may reach self-hosted runner")

    deploy = WORKFLOWS / "deploy.yml"
    if not deploy.exists():
        errors.append("deploy.yml is missing")
    else:
        text = deploy.read_text(encoding="utf-8")
        for condition in REQUIRED_DEPLOY_CONDITIONS:
            if condition not in text:
                errors.append(f"deploy.yml: missing guard {condition}")
        if "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'" not in text:
            errors.append("deploy.yml: manual deploy must be restricted to main")
        if "actions/checkout" in text:
            errors.append("deploy.yml: must not checkout over the production directory")

    if errors:
        print("Workflow security check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Workflow security check passed ({len(files)} workflows).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
