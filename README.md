# Cytos IDE

Cytos IDE is built directly on top of VS Code OSS. There is no custom Electron shell — Cytos is VS Code with product overrides applied and a first-party extension loaded.

## Repository Layout

```
cytos-ide/
├── apps/
│   └── vscode-oss/                  # VS Code OSS integration layer
│       ├── scripts/
│       │   ├── bootstrap-vscode.mjs # Clone/update upstream VS Code OSS
│       │   ├── sync-cytos-layer.mjs # Apply product.overrides.json
│       │   ├── run-vscode.mjs       # Compile + launch with Cytos extension
│       │   └── build-vscode.mjs     # Produce distributable Linux build
│       ├── extensions/
│       │   └── cytos-ml/            # First-party VS Code extension
│       │       └── src/extension.ts # Commands, dashboard, ML metadata
│       ├── product.overrides.json   # Branding & extension gallery config
│       └── package.json
├── packages/
│   └── core-types/                  # Shared TypeScript types
├── python/
│   └── cytos_engine/                # Local ML workflow engine (Python)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RUNBOOK.md
│   └── VSCODE_OSS_REBUILD.md
└── package.json                     # Monorepo root
```

## Quick Start

### Prerequisites
- **Node.js**: same major version as upstream VS Code OSS (see `.upstream/vscode/.nvmrc` after first bootstrap)
- **Python 3.10+**: for `cytos_engine` workflows

### 1. Bootstrap VS Code OSS

```bash
npm run bootstrap
```

This clones (or updates) `microsoft/vscode` into `apps/vscode-oss/.upstream/vscode` and installs all upstream dependencies. Playwright browser downloads are skipped.

### 2. Launch Cytos IDE

```bash
npm run dev
```

This syncs product overrides, compiles upstream VS Code, and launches VS Code OSS with the `cytos-ml` extension loaded in development mode.

### 3. Build for distribution

```bash
npm run build
```

Produces a distributable Linux x64 build via the upstream VS Code gulp pipeline.

## Root Scripts

| Command | Description |
|---|---|
| `npm run bootstrap` | Clone/update VS Code OSS upstream and install all deps |
| `npm run dev` | Launch Cytos IDE (VS Code OSS + Cytos extension) |
| `npm run build` | Build distributable Linux x64 binary |
| `npm run sync` | Re-apply product overrides only (no recompile) |

## Command Palette (inside Cytos IDE)

| Command | Description |
|---|---|
| `Cytos: Open Workflow Dashboard` | Open the ML experiment/dataset dashboard |
| `Cytos: Run Python Tests` | Run `pytest` in an integrated terminal |
| `Cytos: Run Inspection Workflow` | Run the model inspection workflow |

## Notes

- Upstream VS Code OSS source lives at `apps/vscode-oss/.upstream/vscode` — excluded from git (large, auto-fetched).
- Runtime user data and extensions are isolated to `apps/vscode-oss/.build/` — also excluded from git.
- Cytos project metadata is stored under `.cytos/` in each project root — excluded from git.
