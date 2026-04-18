from __future__ import annotations

import json
from pathlib import Path

from axiom_engine.inspection.model_inspector import inspect_models, render_markdown_report
from axiom_engine.schemas.events import RuntimeEvent, now_iso


def run_inspection_workflow(project_root: Path, run_id: str, config: dict):
    active_file = config.get("active_file")
    active_file_path = active_file if isinstance(active_file, str) else None

    yield RuntimeEvent(event="step_started", run_id=run_id, step="discover_models", timestamp=now_iso())
    payload = inspect_models(project_root=project_root, active_file=active_file_path)
    model_count = int(payload.get("model_count", 0))

    if model_count == 0:
        yield RuntimeEvent(
            event="log",
            run_id=run_id,
            level="warning",
            message="No supported model files were discovered in this project.",
            timestamp=now_iso(),
        )
    else:
        yield RuntimeEvent(
            event="log",
            run_id=run_id,
            level="info",
            message=f"Discovered {model_count} model file(s) for inspection.",
            timestamp=now_iso(),
        )

    yield RuntimeEvent(
        event="metric",
        run_id=run_id,
        name="model_count",
        value=float(model_count),
        timestamp=now_iso(),
    )

    format_counts = payload.get("formats", {})
    for model_format, count in sorted(format_counts.items()):
        metric_name = f"format_{str(model_format).replace('-', '_')}_count"
        yield RuntimeEvent(
            event="metric",
            run_id=run_id,
            name=metric_name,
            value=float(count),
            timestamp=now_iso(),
        )

    first_model_with_params = next(
        (
            model
            for model in payload.get("models", [])
            if isinstance(model.get("parameter_count"), int)
        ),
        None,
    )
    if first_model_with_params:
        params = int(first_model_with_params["parameter_count"])
        yield RuntimeEvent(
            event="metric",
            run_id=run_id,
            name="params_million",
            value=round(params / 1_000_000.0, 4),
            timestamp=now_iso(),
        )

    artifacts_dir = project_root / ".axiom" / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    json_report = artifacts_dir / f"inspection-{run_id}.json"
    markdown_report = artifacts_dir / f"inspection-{run_id}.md"

    json_report.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    markdown_report.write_text(render_markdown_report(payload, run_id=run_id), encoding="utf-8")

    yield RuntimeEvent(event="artifact", run_id=run_id, type="inspection_json", path=str(json_report), timestamp=now_iso())
    yield RuntimeEvent(event="artifact", run_id=run_id, type="inspection", path=str(markdown_report), timestamp=now_iso())
