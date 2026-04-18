# VS Code OSS Rebuild Guide

This document describes how Envoy IDE is rebuilt on top of VS Code OSS.

## Architecture

1. Upstream source of truth: Microsoft VS Code OSS repository.
2. Local integration layer: `apps/vscode-oss`.
3. Product branding: `apps/vscode-oss/product.overrides.json` merged into upstream `product.json`.
4. Envoy features: extension at `apps/vscode-oss/extensions/envoy-ml`.

## Pipeline

Prerequisite: use the Node version required by upstream VS Code OSS (`.upstream/vscode/.nvmrc`).

1. `npm run bootstrap -w apps/vscode-oss`
   - Clones or updates VS Code OSS under `.upstream/vscode`.
   - Installs upstream dependencies when missing.
2. `npm run sync -w apps/vscode-oss`
   - Applies product overrides.
3. `npm run run -w apps/vscode-oss`
   - Compiles upstream sources.
   - Runs VS Code OSS with Envoy extension development path.
4. `npm run build -w apps/vscode-oss`
   - Executes upstream Linux build target (`vscode-linux-x64-min`).

## Local State

- User data directory: `apps/vscode-oss/.build/user-data`
- Extensions directory: `apps/vscode-oss/.build/extensions`

Both directories are ignored by git.
