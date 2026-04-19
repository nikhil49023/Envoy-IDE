import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const upstreamRoot = resolve(root, ".upstream", "vscode");
const extensionDevPath = resolve(root, "extensions", "cytos-ml");
const userDataDir = resolve(root, ".build", "user-data");
const extensionsDir = resolve(root, ".build", "extensions");

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node", ["./scripts/sync-cytos-layer.mjs"], root);
run("npm", ["run", "compile"], upstreamRoot);

const launchEnv = { ...process.env };
for (const key of Object.keys(launchEnv)) {
  if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("VSCODE_")) {
    delete launchEnv[key];
  }
}

run(
  "bash",
  [
    "./scripts/code.sh",
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${extensionDevPath}`,
    "--no-sandbox"
  ],
  upstreamRoot,
  launchEnv,
);
