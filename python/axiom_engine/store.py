from __future__ import annotations

import sqlite3
from pathlib import Path


AXIOM_DIR = ".axiom"


def ensure_project_layout(project_root: Path) -> Path:
    axiom = project_root / AXIOM_DIR
    (axiom / "runs").mkdir(parents=True, exist_ok=True)
    (axiom / "artifacts").mkdir(parents=True, exist_ok=True)
    (axiom / "datasets").mkdir(parents=True, exist_ok=True)
    (axiom / "exports").mkdir(parents=True, exist_ok=True)
    (axiom / "cache").mkdir(parents=True, exist_ok=True)
    (axiom / "assistant").mkdir(parents=True, exist_ok=True)
    return axiom


def open_db(project_root: Path) -> sqlite3.Connection:
    axiom = ensure_project_layout(project_root)
    db_path = axiom / "metadata.db"
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
