# Cytos IDE — Runbook

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js | Same major version as `.upstream/vscode/.nvmrc` (fetched after bootstrap). Use `nvm` or `asdf` to switch. |
| Python 3.10+ | Required for `cytos_engine` workflows. |
| Git | Required for upstream vscode clone. |
| ~3 GB disk space | Upstream VS Code checkout + dependencies. |

---

## 1. First-time setup

```bash
# Install root monorepo dependencies
npm install

# Clone upstream VS Code OSS and install its dependencies
npm run bootstrap
```

`bootstrap` handles:
- Cloning `microsoft/vscode` (shallow) into `apps/vscode-oss/.upstream/vscode`
- Running `npm install` inside the upstream repository (incremental — fast on repeat runs)
- Creating isolated `.build/user-data` and `.build/extensions` directories
- Automatically sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
- Automatically sets `VSCODE_SKIP_NODE_VERSION_CHECK=1` for same-major Node patch mismatches

---

## 2. Launch Cytos IDE (development)

```bash
npm run dev
```

This:
1. Syncs `product.overrides.json` into upstream `product.json`
2. Compiles upstream VS Code (`npm run compile` in upstream)
3. Launches VS Code via `bash ./scripts/code.sh` with:
   - `--user-data-dir` pointing to `.build/user-data` (isolated from your personal VS Code profile)
   - `--extensions-dir` pointing to `.build/extensions`
   - `--extensionDevelopmentPath` loading `extensions/cytos-ml` in dev mode

---

## 3. Build the Cytos ML extension only

If you only changed the extension and want to skip a full VS Code recompile:

```bash
# From repo root:
npm install --prefix apps/vscode-oss/extensions/cytos-ml
npm run build --prefix apps/vscode-oss/extensions/cytos-ml
```

Or equivalently:

```bash
npm run build:extension -w apps/vscode-oss
```

---

## 4. Re-apply product overrides without recompiling

```bash
npm run sync
```

Use this after editing `product.overrides.json` if you don't want to recompile the full VS Code source.

---

## 5. Build a distributable binary (Linux x64)

```bash
npm run build
```

Calls the upstream `gulp vscode-linux-x64-min` target. Output appears under `apps/vscode-oss/.upstream/vscode/../VSCode-linux-x64/`.

---

## 6. Python workflow engine

Install `cytos_engine` locally for CLI testing:

```bash
cd python
pip install -e .
```

Run a workflow manually:

```bash
python3 -m cytos_engine.cli run \
  --project-root /path/to/your/project \
  --workflow evaluation \
  --run-id test-run-1 \
  --config-json '{}'
```

Supported `--workflow` values: `dataset_creation`, `evaluation`, `export`, `simulation`, `inspection`.

---

## 7. Using Cytos commands inside the IDE

Open a project folder in Cytos, then via the command palette (`Ctrl+Shift+P`):

| Command | Action |
|---|---|
| `Cytos: Open Workflow Dashboard` | Opens a webview with experiment tracker, dataset registry, artifact counts, reproducibility info |
| `Cytos: Run Python Tests` | Runs `python3 -m pytest -q` in an integrated terminal |
| `Cytos: Run Inspection Workflow` | Runs `python3 -m cytos_engine.cli run --workflow inspection` |

The **Workflow Dashboard** reads `.cytos/metadata.db` in the open workspace folder. No sidecar server is needed — metadata is queried inline via a Python subprocess call from the extension.

---

## 8. Updating upstream VS Code

```bash
npm run bootstrap
```

`bootstrap` always fetches latest `main` from `microsoft/vscode` and runs `npm install` incrementally. Re-run `npm run dev` afterward to recompile.

---

## 9. Troubleshooting

### Node version mismatch

If bootstrap fails on a Node version error:

```
VS Code OSS requires a newer Node runtime for bootstrap.
Required: 22.x.x
Current: 20.x.x
```

Switch Node version with `nvm`:

```bash
nvm install 22
nvm use 22
npm run bootstrap
```

Same-major patch mismatches (e.g. 22.22.0 vs 22.22.1) are automatically bypassed.

### Extension build failure

```bash
cd apps/vscode-oss/extensions/cytos-ml
npm install
npx tsc -p . --noEmit   # type-check only, no output
npx tsc -p .             # full build
```

### Dashboard shows "No runs yet"

The dashboard reads `.cytos/metadata.db` in the workspace root. This file is created automatically when you run a workflow. Run `Cytos: Run Inspection Workflow` to generate your first run record.

### Python not found

The extension tries `python3`, then `python`, then `py -3`. Ensure at least one is on your `$PATH` and resolves to Python 3.10+.
