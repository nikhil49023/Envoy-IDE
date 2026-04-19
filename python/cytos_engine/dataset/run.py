from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from cytos_engine.schemas.events import RuntimeEvent, now_iso
from cytos_engine.store import project_state_dir


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower()).strip("-")
    return slug or "dataset"


def _read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _extract_pdf_with_python(path: Path) -> tuple[str, int | None]:
    for module_name in ("pypdf", "PyPDF2"):
        try:
            if module_name == "pypdf":
                from pypdf import PdfReader  # type: ignore
            else:
                from PyPDF2 import PdfReader  # type: ignore
        except Exception:
            continue

        reader = PdfReader(str(path))
        pages: list[str] = []
        for index, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"\n\n[page {index}]\n{text}")
        return "\n".join(pages).strip(), len(reader.pages)

    return "", None


def _extract_pdf_with_pdftotext(path: Path) -> str:
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=90,
        )
    except Exception:
        return ""
    return result.stdout.strip()


def _extract_pdf_with_byte_fallback(path: Path) -> str:
    raw = path.read_bytes()
    fragments = re.findall(rb"[\x20-\x7E]{18,}", raw)
    decoded = [fragment.decode("utf-8", errors="ignore") for fragment in fragments]
    return "\n".join(decoded).strip()


def _extract_source_text(path: Path) -> tuple[str, int | None, str]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        text, page_count = _extract_pdf_with_python(path)
        if text:
            return text, page_count, "python-pdf"

        text = _extract_pdf_with_pdftotext(path)
        if text:
            return text, page_count, "pdftotext"

        return _extract_pdf_with_byte_fallback(path), page_count, "byte-fallback"

    if suffix in {".txt", ".md", ".json", ".jsonl", ".csv", ".log"}:
        return _read_text_file(path), None, "text"

    return _read_text_file(path), None, "text-fallback"


def _chunk_text(text: str, chunk_chars: int, overlap_chars: int) -> list[str]:
    normalized = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + chunk_chars)
        window = normalized[start:end]
        if end < len(normalized):
            split_at = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if split_at > chunk_chars * 0.55:
                end = start + split_at + 1
                window = normalized[start:end]
        chunks.append(window.strip())
        next_start = end - overlap_chars
        start = next_start if next_start > start else end
    return [chunk for chunk in chunks if chunk]


def _heuristic_local_inference(chunk: str, index: int, source_path: Path) -> dict[str, Any]:
    words = re.findall(r"[A-Za-z0-9_'-]+", chunk)
    first_sentence = re.split(r"(?<=[.!?])\s+", chunk.strip(), maxsplit=1)[0]
    summary = first_sentence[:220].strip() if first_sentence else chunk[:220].strip()
    quality_flags: list[str] = []
    if len(words) < 24:
        quality_flags.append("short_context")
    if len(chunk) > 2400:
        quality_flags.append("long_context")
    if not re.search(r"[A-Za-z]", chunk):
        quality_flags.append("low_text_signal")

    return {
        "id": f"{source_path.stem}-{index:04d}",
        "text": chunk,
        "summary": summary,
        "record_type": "pdf_chunk",
        "quality_flags": quality_flags,
        "token_estimate": max(1, round(len(words) * 1.33)),
        "local_inference": {
            "engine": "cytos-heuristic",
            "cloud": False,
        },
    }


def _command_local_inference(command: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    try:
        result = subprocess.run(
            command,
            input=json.dumps(payload),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True,
            timeout=120,
        )
    except Exception:
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return output if isinstance(output, dict) else None


def _infer_row(chunk: str, index: int, source_path: Path, config: dict) -> dict[str, Any]:
    base = _heuristic_local_inference(chunk, index, source_path)
    command = str(config.get("local_inference_command") or os.environ.get("CYTOS_LOCAL_INFERENCE_CMD") or "").strip()
    if command:
        inferred = _command_local_inference(command, {"chunk": chunk, "index": index, "source_path": str(source_path)})
        if inferred:
            base.update(inferred)
            base["local_inference"] = {"engine": command, "cloud": False}
    return base


def run_dataset_workflow(project_root: Path, run_id: str, config: dict):
    source_value = str(config.get("source_path") or "").strip()
    if not source_value:
        raise ValueError("dataset_creation requires config.source_path")

    source_path = Path(source_value).expanduser()
    if not source_path.is_absolute():
        source_path = project_root / source_path
    source_path = source_path.resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Source file not found: {source_path}")

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
        message=f"Loading local source: {source_path.name}",
        timestamp=now_iso(),
    )

    text, page_count, extractor = _extract_source_text(source_path)
    if not text.strip():
        raise ValueError(f"No extractable text found in {source_path.name}")

    yield RuntimeEvent(
        event="step_started",
        run_id=run_id,
        step="local_inference",
        timestamp=now_iso(),
    )
    yield RuntimeEvent(
        event="log",
        run_id=run_id,
        level="info",
        message=f"Extracted {len(text):,} characters with {extractor}; building supervised rows locally.",
        timestamp=now_iso(),
    )

    chunk_chars = int(config.get("chunk_chars") or 1800)
    overlap_chars = int(config.get("overlap_chars") or 160)
    chunks = _chunk_text(text, max(500, chunk_chars), max(0, min(overlap_chars, 400)))
    if not chunks:
        raise ValueError("Source text did not produce dataset chunks")

    dataset_name = _slug(str(config.get("dataset_name") or source_path.stem))
    cytos_dir = project_state_dir(project_root)
    dataset_dir = cytos_dir / "datasets" / f"{dataset_name}-{run_id}"
    dataset_dir.mkdir(parents=True, exist_ok=True)

    target = dataset_dir / "records.jsonl"
    manifest_path = dataset_dir / "manifest.json"
    report_path = dataset_dir / "README.md"
    source_digest = hashlib.sha256(source_path.read_bytes()).hexdigest()

    rows = []
    for index, chunk in enumerate(chunks, start=1):
        row = _infer_row(chunk, index, source_path, config)
        row.update(
            {
                "source": {
                    "path": str(source_path),
                    "name": source_path.name,
                    "sha256": source_digest,
                    "page_count": page_count,
                    "extractor": extractor,
                },
                "chunk_index": index,
                "dataset_name": dataset_name,
                "run_id": run_id,
            }
        )
        rows.append(row)

    with target.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    manifest = {
        "dataset_name": dataset_name,
        "run_id": run_id,
        "source_path": str(source_path),
        "source_sha256": source_digest,
        "source_type": source_path.suffix.lower().lstrip(".") or "file",
        "extractor": extractor,
        "page_count": page_count,
        "record_count": len(rows),
        "artifact": str(target),
        "created_at": now_iso(),
        "local_inference": True,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    report_path.write_text(
        "\n".join(
            [
                f"# {dataset_name}",
                "",
                f"- Run: `{run_id}`",
                f"- Source: `{source_path.name}`",
                f"- Extractor: `{extractor}`",
                f"- Records: `{len(rows)}`",
                f"- Local inference: `true`",
                "",
                "This dataset was created locally by Cytos from a source document.",
            ]
        ),
        encoding="utf-8",
    )

    yield RuntimeEvent(
        event="artifact",
        run_id=run_id,
        type="dataset",
        path=str(target),
        timestamp=now_iso(),
    )
    yield RuntimeEvent(
        event="artifact",
        run_id=run_id,
        type="dataset_manifest",
        path=str(manifest_path),
        timestamp=now_iso(),
    )
