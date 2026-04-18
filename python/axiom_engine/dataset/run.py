from __future__ import annotations

from pathlib import Path

from axiom_engine.schemas.events import RuntimeEvent, now_iso


def run_dataset_workflow(project_root: Path, run_id: str, config: dict):
    yield RuntimeEvent(
        event="step_started",
        run_id=run_id,
        step="load_sources",
        timestamp=now_iso(),
    )
    yield RuntimeEvent(
        event="log",
        run_id=run_id,
        level="info",
        message="Collecting PDF/Text/JSONL sources",
        timestamp=now_iso(),
    )

    target = project_root / ".axiom" / "datasets" / f"dataset-{run_id}.jsonl"
    target.write_text('{"sample":"row"}\n', encoding="utf-8")

    yield RuntimeEvent(
        event="artifact",
        run_id=run_id,
        type="dataset",
        path=str(target),
        timestamp=now_iso(),
    )
