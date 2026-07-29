import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const nodeModulesDir = resolve(root, "node_modules");
const electronPkg = resolve(nodeModulesDir, "electron/package.json");
if (!existsSync(electronPkg)) {
  process.exit(0);
}

const electronVersion = JSON.parse(readFileSync(electronPkg, "utf-8")).version;

const betterSqlite3Dir = resolve(nodeModulesDir, "better-sqlite3");
if (!existsSync(betterSqlite3Dir)) {
  process.exit(0);
}

const targetArch = process.env.BUILD_TARGET_ARCH?.trim() || process.arch;

function tryPrebuildInstall() {
  const prebuildInstallBin = resolve(nodeModulesDir, "prebuild-install/bin.js");
  if (!existsSync(prebuildInstallBin)) return false;
  console.log(`Fetching better-sqlite3 prebuild for Electron ${electronVersion} (${process.platform}/${targetArch})...`);
  try {
    execFileSync(
      process.execPath,
      [
        prebuildInstallBin,
        "--runtime=electron",
        `--target=${electronVersion}`,
        `--arch=${targetArch}`,
        "--path=" + betterSqlite3Dir,
      ],
      { cwd: betterSqlite3Dir, stdio: "inherit" },
    );
    return true;
  } catch {
    console.warn(
      "better-sqlite3 prebuild fetch failed for Electron, falling back to source build.",
    );
    return false;
  }
}

async function rebuildFromSource() {
  const { rebuild } = await import("@electron/rebuild");
  console.log(
    `Building better-sqlite3 from source for Electron ${electronVersion} (${process.platform}/${targetArch})...`,
  );
  await rebuild({
    buildPath: root,
    electronVersion,
    arch: targetArch,
    onlyModules: ["better-sqlite3"],
    force: true,
    buildFromSource: true,
    projectRootPath: root,
  });
}

if (tryPrebuildInstall()) {
  console.log("better-sqlite3 prebuild installed for Electron.");
} else {
  try {
    await rebuildFromSource();
    console.log("better-sqlite3 built from source for Electron.");
  } catch (err) {
    console.error("Failed to build better-sqlite3 for Electron from source:", err);
    process.exit(1);
  }
}
