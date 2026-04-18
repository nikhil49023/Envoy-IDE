from __future__ import annotations

from pathlib import Path

from axiom_engine.schemas.events import RuntimeEvent, now_iso


def run_simulation_workflow(project_root: Path, run_id: str, config: dict):
    target = str(config.get("hardware", "jetson_nano"))
    yield RuntimeEvent(event="step_started", run_id=run_id, step="simulate_hardware", timestamp=now_iso())
    yield RuntimeEvent(event="log", run_id=run_id, level="info", message=f"Simulating fit for {target}", timestamp=now_iso())
    yield RuntimeEvent(event="metric", run_id=run_id, name="estimated_memory_mb", value=1870, timestamp=now_iso())
    yield RuntimeEvent(event="metric", run_id=run_id, name="estimated_latency_ms", value=63, timestamp=now_iso())

    summary = project_root / ".axiom" / "artifacts" / f"simulation-{run_id}.json"
    summary.write_text('{"fit":"warning","headroom_mb":178}', encoding="utf-8")
    yield RuntimeEvent(event="artifact", run_id=run_id, type="simulation", path=str(summary), timestamp=now_iso())
