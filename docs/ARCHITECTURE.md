# Cytos IDE — Architecture

## Overview

Cytos IDE is VS Code OSS with:
1. **Product overrides** applied at build time (branding, extension gallery endpoint)
2. **A first-party extension** (`cytos-ml`) loaded via `--extensionDevelopmentPath`
3. **A local Python engine** (`cytos_engine`) for ML workflow execution

There is no custom Electron shell, no embedded Monaco renderer, and no separate IPC bridge. All editor functionality is inherited from upstream VS Code.

## Repository Layout

```
cytos-ide/
├── apps/vscode-oss/          # VS Code OSS integration layer
│   ├── scripts/              # Bootstrap, sync, run, build scripts
│   ├── extensions/cytos-ml/  # First-party VS Code extension
│   ├── product.overrides.json
│   └── .upstream/vscode/     # Upstream VS Code OSS (git-ignored, auto-fetched)
├── packages/core-types/      # Shared TypeScript type definitions
└── python/cytos_engine/      # ML workflow engine (Python)
```

## Component Responsibilities

### `apps/vscode-oss/`

The integration layer. Does not modify upstream VS Code source directly. Instead it:

- Clones/updates upstream from `github.com/microsoft/vscode` (shallow, tracking `main`)
- Merges `product.overrides.json` into upstream `product.json` before compile/run
- Compiles upstream VS Code and launches it with isolated `--user-data-dir` and `--extensions-dir`
- Loads `extensions/cytos-ml` via `--extensionDevelopmentPath`

### `extensions/cytos-ml/`

The first-party Cytos extension contributes:

- **`cytos.openWorkflowCanvas`**: Cytos Studio webview for Home, Workflows, and Monitoring routes (backed by `cytos_engine` metadata via inline Python subprocess)
- **`cytos.openWorkflowDashboard`**: compatibility alias for the Cytos Studio home route
- **`cytos.runPytest`**: runs `python3 -m pytest -q` in an integrated terminal
- **`cytos.runInspectionWorkflow`**: runs `python3 -m cytos_engine.cli run --workflow inspection`

Extension reads ML metadata by executing a short Python script inline (no separate server process required). Supports `python3`, `python`, and `py -3` fallback chain.

### `python/cytos_engine/`

Local ML workflow engine. Provides:

- `dataset` — data prep workflows
- `evaluation` — model evaluation
- `export` — artifact export
- `simulation` — inference simulation
- `inspection` — multi-format model scanning (ONNX, PyTorch, safetensors, GGUF, TFLite, Keras, CoreML)
- `cli` — command-line entrypoint consumed by the VS Code extension
- `store.py` — SQLite-backed run metadata store
- `engine.py` — orchestrator

### `packages/core-types/`

Shared TypeScript types (`WorkflowType`, `RuntimeEvent`, `FileNode`, `OpenTab`). Imported by the extension and any future tooling that needs Cytos domain types.

## Local Project State (`.cytos/`)

Each workspace folder that Cytos opens stores local ML run state in `.cytos/`:

```
.cytos/
├── runs/           # Persisted run output directories
├── artifacts/      # Models, reports, checkpoints, embeddings
├── datasets/       # Dataset files indexed by the extension
├── exports/        # Export outputs
├── cache/          # Intermediate caches
├── assistant/      # Assistant context
└── metadata.db     # SQLite run log (queried by Cytos Studio)
```

This directory is excluded from git per `.gitignore`. Legacy `.axiom/` project state is auto-migrated to `.cytos/` by `cytos_engine` and remains readable during the migration window.

## Extension Gallery

Cytos redirects the VS Code extension marketplace to Open VSX (`open-vsx.org`) via `product.overrides.json`. This avoids dependency on Microsoft's proprietary marketplace for a VS Code OSS build.

## Build Pipeline Summary

```
npm run bootstrap    →  git clone/pull upstream vscode
                     →  npm install (upstream, incremental)
                     →  mkdir .build/{user-data,extensions}

npm run dev          →  sync product overrides
                     →  npm run compile (upstream)
                     →  bash ./scripts/code.sh \
                          --user-data-dir=.build/user-data \
                          --extensions-dir=.build/extensions \
                          --extensionDevelopmentPath=extensions/cytos-ml

npm run build        →  sync product overrides
                     →  npm run gulp -- vscode-linux-x64-min (upstream)
```
