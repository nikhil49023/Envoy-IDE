# Envoy IDE

Envoy IDE is now rebuilt cleanly on top of VS Code OSS.

The primary app target in this repository is `apps/vscode-oss`, which:

- bootstraps upstream VS Code OSS from Microsoft
- applies Envoy product overrides
- loads the Envoy ML extension layer
- runs with isolated user-data and extension directories

## Monorepo Layout

- `apps/vscode-oss`: VS Code OSS bootstrap, sync, run, and build pipeline
- `apps/vscode-oss/extensions/envoy-ml`: first-party Envoy extension for ML commands/dashboard
- `apps/desktop`: legacy custom Electron shell (kept for reference)
- `python/axiom_engine`: workflow engine and local run metadata support
- `packages`: shared types and domain modules

## Quick Start

1. Install Python 3.10+.
2. Install the Node version required by upstream VS Code OSS (see `apps/vscode-oss/.upstream/vscode/.nvmrc` after first bootstrap; currently Node 22.22.1+).
3. Bootstrap VS Code OSS and dependencies:
   - `npm run bootstrap -w apps/vscode-oss`
4. Launch Envoy on VS Code OSS:
   - `npm run dev`

## Root Scripts

- `npm run dev`: runs the VS Code OSS Envoy entrypoint
- `npm run build`: builds the VS Code OSS Linux target
- `npm run dev:legacy`: runs the old custom Electron shell
- `npm run build:legacy`: builds the old custom Electron shell

## Extension Commands

After launch, use the command palette:

- `Envoy: Open Workflow Dashboard`
- `Envoy: Run Python Tests`
- `Envoy: Run Inspection Workflow`

## Notes

- Upstream VS Code OSS source is materialized under `apps/vscode-oss/.upstream/vscode` and ignored by git.
- Envoy runtime metadata remains project-local under `.axiom`.
