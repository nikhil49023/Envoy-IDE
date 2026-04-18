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

mkdirSync(resolve(root, ".upstream"), { recursive: true });

if (!existsSync(upstreamRoot)) {
  run("git", ["clone", "--depth", "1", "https://github.com/microsoft/vscode.git", upstreamRoot]);
} else {
  run("git", ["-C", upstreamRoot, "fetch", "--depth", "1", "origin", "main"]);
  run("git", ["-C", upstreamRoot, "checkout", "main"]);
  run("git", ["-C", upstreamRoot, "pull", "--ff-only", "origin", "main"]);
}

const requiredNodeVersion = readFileSync(resolve(upstreamRoot, ".nvmrc"), "utf-8").trim();
const currentNodeVersion = process.version;

if (!isVersionAtLeast(currentNodeVersion, requiredNodeVersion)) {
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

if (!existsSync(resolve(upstreamRoot, "node_modules"))) {
  run("npm", ["install"], upstreamRoot);
}

mkdirSync(resolve(root, ".build", "user-data"), { recursive: true });
mkdirSync(resolve(root, ".build", "extensions"), { recursive: true });
