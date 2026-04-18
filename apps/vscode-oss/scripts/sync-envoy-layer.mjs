import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const upstreamRoot = resolve(root, ".upstream", "vscode");
const productPath = resolve(upstreamRoot, "product.json");
const overridesPath = resolve(root, "product.overrides.json");

if (!existsSync(productPath)) {
  console.error("VS Code upstream is missing. Run npm run bootstrap -w apps/vscode-oss first.");
  process.exit(1);
}

const product = JSON.parse(readFileSync(productPath, "utf-8"));
const overrides = JSON.parse(readFileSync(overridesPath, "utf-8"));

const next = {
  ...product,
  ...overrides,
};

writeFileSync(productPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
console.log("Applied Envoy product overrides to VS Code OSS.");
