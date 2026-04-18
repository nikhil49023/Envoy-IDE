from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel


class RuntimeEvent(BaseModel):
    event: Literal[
        "run_started",
        "step_started",
        "log",
        "metric",
        "artifact",
        "run_completed",
    ]
    run_id: str
    workflow: str | None = None
    step: str | None = None
    level: Literal["info", "warning", "error"] | None = None
    message: str | None = None
    name: str | None = None
    value: float | str | None = None
    type: str | None = None
    path: str | None = None
    status: Literal["success", "failed", "cancelled"] | None = None
    timestamp: str


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()
