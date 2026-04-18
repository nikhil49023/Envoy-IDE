# Envoy IDE Architecture

## Subsystems

1. IDE shell: Electron main process and renderer window layout.
2. Editor system: Monaco-based editing, tabs, file explorer, and save cycle.
3. Project runtime: process execution bridge over IPC with live event streaming.
4. Workflow engine: Python domain workflows for dataset, evaluation, export, simulation, and inspection.
5. Insight panels: inspector and bottom log panel, with room for metrics/artifact dashboards.
6. Assistant layer: constrained guidance surface bound to context and run artifacts.
7. Center work modes: script production mode, notebook exploration mode, and workflow lifecycle mode.

## Event Model

Runtime and workflow processes emit JSON event objects:

- run_started
- step_started
- log
- metric
- artifact
- run_completed
- process_exit
- process_error

These events are pushed from Electron main to renderer via the envoy:runtime-event IPC channel.

Inline notebook/script execution uses a dedicated envoy:execute-python IPC entrypoint, which returns structured outputs including stdout/stderr, variable summaries, dataframe previews, plot images, and HTML/widget-like rich output.

## Local Project State

Each project uses a hidden .axiom folder:

- .axiom/runs
- .axiom/artifacts
- .axiom/datasets
- .axiom/exports
- .axiom/cache
- .axiom/assistant
- .axiom/metadata.db

## Desktop-First Notes

This implementation is not a VS Code fork. It is a custom Electron IDE using Monaco for the editing core and a Python engine for ML workflows.
# Architecture

## High-Level Components

1. IDE Frontend (planned)
2. Envoy API Adapter (implemented)
3. `code-review-graph` CLI and MCP server (upstream dependency)
4. Repository-local graph storage (`.code-review-graph/graph.db`)

## Data Flow

1. User triggers action from IDE (install/build/update/status/detect-changes)
2. Frontend calls Envoy API endpoint
3. API validates request and launches process-isolated command
4. `code-review-graph` performs parse/query/update work
5. API returns structured result with stdout/stderr/timing/exit code
6. Frontend renders command status and diagnostics

## Adapter Boundary

The adapter does not reimplement parsing, graph storage, or impact logic. It only:
- normalizes request/response contracts
- handles process execution, timeout, and error mapping
- provides a stable integration point for IDE UI and assistant workflows

## Why This Boundary

- Faster delivery
- Lower maintenance cost
- Easy upstream upgrades
- Clear ownership split between platform and graph engine

## Future Extension Points

1. Job queue for long-running operations
2. SSE or WebSocket progress streaming
3. Command history persistence
4. Selective advanced queries via MCP tool invocation layer
