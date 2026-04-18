# Envoy IDE

Envoy IDE is a desktop-first ML workbench built with Electron + Monaco + React + a Python workflow engine.

## Stack

- Desktop shell: Electron
- UI: React + TypeScript
- Editor core: Monaco
- Runtime bridge: Electron IPC and process streaming
- Workflow engine: Python (`python/axiom_engine`)
- Local metadata: SQLite in project-local `.axiom/` folder

## Monorepo Layout

- apps/desktop: Electron app and renderer
- packages: shared domain services and core types
- python/axiom_engine: dataset/evaluation/export/simulation engine and CLI
- docs: architecture and runbook docs

## Quick Start

1. Install Node 20+ and Python 3.10+.
2. Install desktop dependencies:
   - cd apps/desktop
   - npm install
3. Run desktop app:
   - npm run dev

Python workflow runs are launched by the desktop runtime using `python3 -m axiom_engine.cli`.

## Desktop Scope Implemented

- Multi-pane IDE shell (left explorer, center Monaco, right inspector, bottom terminal/logs, top command bar)
- Folder open, file read/write, tabs, dirty tracking hooks
- Integrated run command execution with live stdout/stderr events
- Integrated terminal sessions with PTY support (node-pty) and fallback shell mode
- Workflow run execution with event-streamed lifecycle and artifact metadata
- Project-local `.axiom/metadata.db` run registry

## Terminal Notes

- Terminal sessions are created when a project folder is opened.
- The bottom panel accepts interactive commands and streams output live.
- If PTY support is unavailable on a host, Envoy falls back to a standard shell process.

## Next Steps

- Add debugger and richer diagnostics
- Add dataset/eval/export/simulation panel forms and validations
- Add packaging pipelines for Windows and Linux installers
# Envoy IDE: Code Review Graph Integration

This repository boots the first implementation layer for an IDE that is powered by `code-review-graph`.

Current milestone:
- FastAPI adapter service that exposes IDE-friendly endpoints
- Process-isolated CLI execution wrappers
- Graph bootstrap and diagnostics workflows
- Implementation documentation bundle

## Quick Start

1. Install Python 3.10+.
2. Create a virtual environment inside `apps/api`.
3. Install backend dependencies.
4. Install `code-review-graph` in the same environment.
5. Start the API server.

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .
pip install code-review-graph
uvicorn app.main:app --reload --port 8080
```

API root: `http://localhost:8080`

## What Is Implemented

- `POST /api/v1/graph/install`
- `POST /api/v1/graph/build`
- `POST /api/v1/graph/update`
- `POST /api/v1/graph/detect-changes`
- `GET /api/v1/graph/status`
- `GET /api/v1/health`

The backend calls the `code-review-graph` CLI through isolated subprocess execution and returns structured responses suitable for IDE UI consumption.
