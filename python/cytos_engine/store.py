from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path


CYTOS_DIR = ".cytos"
LEGACY_AXIOM_DIR = ".axiom"
PROJECT_SUBDIRS = ("runs", "artifacts", "datasets", "exports", "cache", "assistant")


def ensure_project_layout(project_root: Path) -> Path:
    cytos = project_root / CYTOS_DIR
    legacy = project_root / LEGACY_AXIOM_DIR

    if not cytos.exists() and legacy.exists():
        shutil.copytree(legacy, cytos)

    for subdir in PROJECT_SUBDIRS:
        (cytos / subdir).mkdir(parents=True, exist_ok=True)
    return cytos


def project_state_dir(project_root: Path) -> Path:
    return ensure_project_layout(project_root)


def open_db(project_root: Path) -> sqlite3.Connection:
    cytos = ensure_project_layout(project_root)
    db_path = cytos / "metadata.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            workflow TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            summary TEXT
        )
        """
    )
    conn.commit()
    return conn


def register_run_start(
    conn: sqlite3.Connection,
    run_id: str,
    workflow: str,
    started_at: str,
) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO runs (run_id, workflow, status, started_at) VALUES (?, ?, ?, ?)",
        (run_id, workflow, "running", started_at),
    )
    conn.commit()


def register_run_end(
    conn: sqlite3.Connection,
    run_id: str,
    completed_at: str,
    status: str,
    summary: str,
) -> None:
    conn.execute(
        "UPDATE runs SET status = ?, completed_at = ?, summary = ? WHERE run_id = ?",
        (status, completed_at, summary, run_id),
    )
    conn.commit()
