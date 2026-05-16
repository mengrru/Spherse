import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const electronPkg = resolve(root, "node_modules/electron/package.json");
if (!existsSync(electronPkg)) {
  process.exit(0);
}

const electronVersion = JSON.parse(
  await import("node:fs").then((m) => m.readFileSync(electronPkg, "utf-8"))
).version;

const betterSqlite3Dir = resolve(root, "node_modules/better-sqlite3");
if (!existsSync(betterSqlite3Dir)) {
  process.exit(0);
}

const prebuildInstallBin = resolve(
  root,
  "node_modules/prebuild-install/bin.js"
);

if (!existsSync(prebuildInstallBin)) {
  process.exit(0);
}

console.log(
  `Fetching better-sqlite3 prebuild for Electron ${electronVersion}...`
);

try {
  execFileSync(
    process.execPath,
    [
      prebuildInstallBin,
      "--runtime=electron",
      `--target=${electronVersion}`,
      "--path=" + betterSqlite3Dir,
    ],
    { cwd: betterSqlite3Dir, stdio: "inherit" }
  );
  console.log("better-sqlite3 prebuild installed for Electron.");
} catch {
  console.warn(
    "Failed to fetch better-sqlite3 prebuild for Electron. Falling back to Node.js build."
  );
}
