#!/usr/bin/env node
const { checkNodeVersion } = await import("../dist/version-guard.mjs");
const versionError = checkNodeVersion(process.versions.node);
if (versionError) {
  console.error(versionError);
  process.exit(1);
}
const { runCli } = await import("../dist/cli.mjs");
process.exitCode = await runCli(process.argv.slice(2));
