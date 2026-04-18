import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const upstreamRoot = resolve(root, ".upstream", "vscode");
const extensionDevPath = resolve(root, "extensions", "envoy-ml");
const userDataDir = resolve(root, ".build", "user-data");
const extensionsDir = resolve(root, ".build", "extensions");

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
run("npm", ["run", "compile"], upstreamRoot);
run(
  "bash",
  [
    "./scripts/code.sh",
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${extensionDevPath}`
  ],
  upstreamRoot,
);
