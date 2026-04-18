import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const upstreamRoot = resolve(root, ".upstream", "vscode");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node", ["./scripts/sync-envoy-layer.mjs"], root);
run("npm", ["run", "gulp", "--", "vscode-linux-x64-min"], upstreamRoot);
