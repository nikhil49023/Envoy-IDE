from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from axiom_engine.engine import run_workflow


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="axiom-engine")
    sub = parser.add_subparsers(dest="command", required=True)

    run_cmd = sub.add_parser("run", help="Run a workflow")
    run_cmd.add_argument("--project-root", required=True)
    run_cmd.add_argument("--workflow", required=True)
    run_cmd.add_argument("--run-id", required=True)
    run_cmd.add_argument("--config-json", default="{}")

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "run":
        config = json.loads(args.config_json)
        return run_workflow(
            project_root=Path(args.project_root),
            workflow=args.workflow,
            run_id=args.run_id,
            config=config,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
