import { mkdirSync, existsSync, readFileSync } from "node:fs";
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

function parseVersion(raw) {
  const normalized = raw.trim().replace(/^v/, "");
  const [major = "0", minor = "0", patch = "0"] = normalized.split(".");
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

function isVersionAtLeast(currentRaw, requiredRaw) {
  const current = parseVersion(currentRaw);
  const required = parseVersion(requiredRaw);

  if (current.major !== required.major) {
    return current.major > required.major;
  }
  if (current.minor !== required.minor) {
    return current.minor > required.minor;
  }
  return current.patch >= required.patch;
}

function hasSameMajor(currentRaw, requiredRaw) {
  const current = parseVersion(currentRaw);
  const required = parseVersion(requiredRaw);
  return current.major === required.major;
}

mkdirSync(resolve(root, ".upstream"), { recursive: true });

if (!existsSync(upstreamRoot)) {
  run("git", ["clone", "--depth", "1", "https://github.com/microsoft/vscode.git", upstreamRoot]);
} else {
  // Discard local changes (e.g. product.json/css modifications from sync script) before updating
  run("git", ["-C", upstreamRoot, "restore", "."]);
  run("git", ["-C", upstreamRoot, "clean", "-fd"]);
  run("git", ["-C", upstreamRoot, "fetch", "--depth", "1", "origin", "main"]);
  run("git", ["-C", upstreamRoot, "checkout", "-B", "main", "FETCH_HEAD"]);
}

const requiredNodeVersion = readFileSync(resolve(upstreamRoot, ".nvmrc"), "utf-8").trim();
const currentNodeVersion = process.version;
const isCurrentAtLeastRequired = isVersionAtLeast(currentNodeVersion, requiredNodeVersion);
const sameMajor = hasSameMajor(currentNodeVersion, requiredNodeVersion);
const shouldBypassNodePatchCheck = !isCurrentAtLeastRequired && sameMajor;

if (!isCurrentAtLeastRequired && !sameMajor) {
  console.error(
    [
      "VS Code OSS requires a newer Node runtime for bootstrap.",
      `Required: ${requiredNodeVersion}`,
      `Current: ${currentNodeVersion}`,
      "Use nvm/asdf to switch Node, then re-run: npm run bootstrap -w apps/vscode-oss",
    ].join("\n"),
  );
  process.exit(1);
}

if (shouldBypassNodePatchCheck) {
  console.warn(
    [
      "Proceeding with a Node patch-version mismatch for VS Code OSS bootstrap.",
      `Required: ${requiredNodeVersion}`,
      `Current: ${currentNodeVersion}`,
      "Using VSCODE_SKIP_NODE_VERSION_CHECK=1 for npm install.",
    ].join("\n"),
  );
}

// Always run upstream install so stale or partial checkouts are repaired.
// VS Code's postinstall is state-aware and exits quickly when already up to date.
const env = {
  ...process.env,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
};
if (shouldBypassNodePatchCheck) {
  env.VSCODE_SKIP_NODE_VERSION_CHECK = "1";
}
const result = spawnSync("npm", ["install"], {
  cwd: upstreamRoot,
  stdio: "inherit",
  shell: false,
  env,
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(resolve(root, ".build", "user-data"), { recursive: true });
mkdirSync(resolve(root, ".build", "extensions"), { recursive: true });
