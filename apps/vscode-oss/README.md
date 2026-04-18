# Envoy VS Code OSS Rebuild

This workspace rebuilds Envoy IDE on top of VS Code OSS instead of the custom Electron shell.

## What this layer does

- Clones upstream VS Code OSS into `.upstream/vscode`
- Applies Envoy product branding overrides
- Builds and loads the bundled Envoy extension
- Runs VS Code OSS with isolated user-data and extension directories

## Commands

- `npm run bootstrap -w apps/vscode-oss`
- `npm run run -w apps/vscode-oss`
- `npm run build -w apps/vscode-oss`

## Output

VS Code build artifacts are produced by upstream gulp targets inside `.upstream/vscode`.
