from __future__ import annotations

from pathlib import Path

from axiom_engine.schemas.events import RuntimeEvent, now_iso


def run_evaluation_workflow(project_root: Path, run_id: str, config: dict):
    yield RuntimeEvent(event="step_started", run_id=run_id, step="load_model", timestamp=now_iso())
    yield RuntimeEvent(event="log", run_id=run_id, level="info", message="Loading evaluation model", timestamp=now_iso())

    yield RuntimeEvent(event="step_started", run_id=run_id, step="evaluate", timestamp=now_iso())
    yield RuntimeEvent(event="metric", run_id=run_id, name="accuracy", value=0.91, timestamp=now_iso())
    yield RuntimeEvent(event="metric", run_id=run_id, name="f1", value=0.88, timestamp=now_iso())

    report_path = project_root / ".axiom" / "artifacts" / f"eval-{run_id}.md"
    report_path.write_text("# Evaluation Report\n\nAccuracy: 0.91\nF1: 0.88\n", encoding="utf-8")
    yield RuntimeEvent(event="artifact", run_id=run_id, type="report", path=str(report_path), timestamp=now_iso())
