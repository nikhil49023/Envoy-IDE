from __future__ import annotations

import json
from pathlib import Path

from .dataset.run import run_dataset_workflow
from .evaluation.run import run_evaluation_workflow
from .export.run import run_export_workflow
from .inspection.run import run_inspection_workflow
from .simulation.run import run_simulation_workflow
from .schemas.events import RuntimeEvent, now_iso
from .store import open_db, register_run_end, register_run_start


def _workflow_iterator(workflow: str, project_root: Path, run_id: str, config: dict):
    if workflow == "dataset_creation":
        return run_dataset_workflow(project_root, run_id, config)
    if workflow == "evaluation":
        return run_evaluation_workflow(project_root, run_id, config)
    if workflow == "export":
        return run_export_workflow(project_root, run_id, config)
    if workflow == "simulation":
        return run_simulation_workflow(project_root, run_id, config)
    return run_inspection_workflow(project_root, run_id, config)


def run_workflow(project_root: Path, workflow: str, run_id: str, config: dict) -> int:
    conn = open_db(project_root)
    start_ts = now_iso()
    register_run_start(conn, run_id, workflow, start_ts)

    print(
        RuntimeEvent(
            event="run_started",
            run_id=run_id,
            workflow=workflow,
            timestamp=start_ts,
        ).model_dump_json()
    )

    status = "success"
    summary = "completed"
    try:
        for event in _workflow_iterator(workflow, project_root, run_id, config):
            if isinstance(event, RuntimeEvent):
                print(event.model_dump_json())
            else:
                print(json.dumps(event))
    except Exception as exc:  # pragma: no cover
        status = "failed"
        summary = str(exc)
        print(
            RuntimeEvent(
                event="log",
                run_id=run_id,
                level="error",
                message=f"Workflow failed: {exc}",
                timestamp=now_iso(),
            ).model_dump_json()
        )

    end_ts = now_iso()
    print(
        RuntimeEvent(
            event="run_completed",
            run_id=run_id,
            status=status,
            message=summary,
            timestamp=end_ts,
        ).model_dump_json()
    )
    register_run_end(conn, run_id, end_ts, status, summary)
    conn.close()

    return 0 if status == "success" else 1
