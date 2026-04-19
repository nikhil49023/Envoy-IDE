from __future__ import annotations

from pathlib import Path

from cytos_engine.schemas.events import RuntimeEvent, now_iso


def run_export_workflow(project_root: Path, run_id: str, config: dict):
    yield RuntimeEvent(event="step_started", run_id=run_id, step="export_onnx", timestamp=now_iso())
    onnx_path = project_root / ".cytos" / "exports" / f"model-{run_id}.onnx"
    onnx_path.write_text("mock_onnx", encoding="utf-8")
    yield RuntimeEvent(event="artifact", run_id=run_id, type="onnx", path=str(onnx_path), timestamp=now_iso())

    yield RuntimeEvent(event="step_started", run_id=run_id, step="export_gguf", timestamp=now_iso())
    gguf_path = project_root / ".cytos" / "exports" / f"model-{run_id}.gguf"
    gguf_path.write_text("mock_gguf", encoding="utf-8")
    yield RuntimeEvent(event="artifact", run_id=run_id, type="gguf", path=str(gguf_path), timestamp=now_iso())
