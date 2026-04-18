from __future__ import annotations

from pathlib import Path

from axiom_engine.schemas.events import RuntimeEvent, now_iso


def run_inspection_workflow(project_root: Path, run_id: str, config: dict):
    yield RuntimeEvent(event="step_started", run_id=run_id, step="inspect_model", timestamp=now_iso())
    yield RuntimeEvent(event="metric", run_id=run_id, name="params_million", value=7.2, timestamp=now_iso())
    yield RuntimeEvent(event="metric", run_id=run_id, name="flops_giga", value=15.4, timestamp=now_iso())

    report = project_root / ".axiom" / "artifacts" / f"inspection-{run_id}.md"
    report.write_text("# Model Inspection\n\nParams: 7.2M\nFLOPs: 15.4G\n", encoding="utf-8")
    yield RuntimeEvent(event="artifact", run_id=run_id, type="inspection", path=str(report), timestamp=now_iso())
