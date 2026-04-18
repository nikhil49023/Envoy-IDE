# Runbook

## 1. Install desktop dependencies

- cd apps/desktop
- npm install

## 2. Run desktop app

- npm run dev

## 3. Python workflow engine

The desktop runtime calls Python workflows with:

- python3 -m axiom_engine.cli.main run --project-root <path> --workflow <name> --run-id <id> --config-json <json>

For local shell testing:

- cd python
- python3 -m pip install -e .
- python3 -m axiom_engine.cli.main run --project-root .. --workflow evaluation --run-id demo-1 --config-json '{}'

## 4. Typical workflow

1. Open project folder in IDE.
2. Open and edit files in Monaco.
3. Trigger Evaluate/Export/Simulate from command bar.
4. Watch logs and events in bottom panel.
5. Inspect generated artifacts under .axiom/.

## 5. Integrated terminal

1. Open a project folder to auto-create a terminal session.
2. Use the bottom panel input to send commands to the terminal.
3. Use Stop to terminate the current terminal session.

Terminal backend behavior:

- Preferred mode: node-pty for shell-like terminal behavior.
- Fallback mode: child process streaming when PTY is not available.
