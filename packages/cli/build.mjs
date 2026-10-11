import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliDir, "../..");

const WORKSPACE_ALIASES = {
  "@spherse/server": "packages/server/dist/index.js",
  "@spherse/core": "packages/core/dist/index.js",
  "@spherse/contracts": "packages/contracts/dist/index.js",
  "@spherse/sdk": "packages/sdk/dist/index.js",
  "@spherse/sdk/source": "packages/sdk/dist/source.js",
  "@spherse/presets": "packages/presets/dist/index.js",
};

for (const [specifier, relPath] of Object.entries(WORKSPACE_ALIASES)) {
  try {
    statSync(join(repoRoot, relPath));
  } catch {
    console.error(`Missing build output for alias ${specifier}: ${relPath} — run the workspace build first.`);
    process.exit(1);
  }
}

const alias = Object.fromEntries(
  Object.entries(WORKSPACE_ALIASES).map(([specifier, relPath]) => [specifier, join(repoRoot, relPath)]),
);

await build({
  entryPoints: [join(cliDir, "src/main.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  alias,
  outfile: join(cliDir, "dist/cli.mjs"),
  logLevel: "info",
});

const bundleSource = readFileSync(join(cliDir, "dist/cli.mjs"), "utf-8");
const leaked = bundleSource.match(/(?:from|import|require)\s*\(?\s*"@spherse\//);
if (leaked) {
  console.error("Bundle still references @spherse/* imports — add the missing workspace alias to build.mjs.");
  console.error(leaked[0]);
  process.exit(1);
}

assertDependenciesInSync();

function readPackage(relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), "utf-8"));
}

function assertDependenciesInSync() {
  const cliPkg = readPackage("packages/cli/package.json");
  const expected = new Map();
  for (const relPath of ["packages/core/package.json", "packages/server/package.json"]) {
    const deps = readPackage(relPath).dependencies ?? {};
    for (const [name, spec] of Object.entries(deps)) {
      if (name.startsWith("@spherse/")) continue;
      expected.set(name, spec);
    }
  }
  const actual = new Map(Object.entries(cliPkg.dependencies ?? {}));
  for (const name of actual.keys()) {
    if (name.startsWith("@spherse/")) actual.delete(name);
  }
  const missing = [...expected.keys()].filter((name) => !actual.has(name));
  const extra = [...actual.keys()].filter((name) => !expected.has(name));
  const drifted = [...expected.keys()].filter(
    (name) => actual.has(name) && actual.get(name) !== expected.get(name),
  );
  if (missing.length || extra.length || drifted.length) {
    console.error("packages/cli dependencies out of sync with @spherse/core + @spherse/server:");
    for (const name of missing) console.error(`  missing: ${name}@${expected.get(name)}`);
    for (const name of extra) console.error(`  extra: ${actual.get(name) ? name : name}`);
    for (const name of drifted) console.error(`  drifted: ${name} cli=${actual.get(name)} expected=${expected.get(name)}`);
    process.exit(1);
  }
  console.log("packages/cli dependencies in sync with core + server.");
}
