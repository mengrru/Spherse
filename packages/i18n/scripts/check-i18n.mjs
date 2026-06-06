#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, "../src/locales");

const localeFiles = ["zh-CN.ts", "zh-TW.ts", "en.ts"];
const locales = {};

function extractKeys(content) {
  const keys = [];
  const regex = /^\s*"([^"]+)":\s*"/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

function extractInterpolationVars(content, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`"${escaped}"\\s*:\\s*"([^"]*)"`);
  const match = content.match(regex);
  if (!match) return [];
  const vars = [];
  const varRegex = /\{(\w+)\}/g;
  let v;
  while ((v = varRegex.exec(match[1])) !== null) {
    vars.push(v[1]);
  }
  return vars.sort();
}

let hasErrors = false;

for (const file of localeFiles) {
  const filePath = resolve(localesDir, file);
  const content = readFileSync(filePath, "utf-8");
  locales[file] = { content, keys: extractKeys(content) };
}

const canonical = locales["zh-CN.ts"].keys;
for (const file of localeFiles.slice(1)) {
  const keys = locales[file].keys;
  const missing = canonical.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !canonical.includes(k));
  if (missing.length > 0) {
    console.error(`❌ ${file}: missing keys: ${missing.join(", ")}`);
    hasErrors = true;
  }
  if (extra.length > 0) {
    console.error(`❌ ${file}: extra keys: ${extra.join(", ")}`);
    hasErrors = true;
  }
}

for (const key of canonical) {
  const canonicalVars = extractInterpolationVars(
    locales["zh-CN.ts"].content,
    key,
  );
  for (const file of localeFiles.slice(1)) {
    const fileVars = extractInterpolationVars(locales[file].content, key);
    if (canonicalVars.join(",") !== fileVars.join(",")) {
      console.error(
        `❌ Key "${key}": interpolation vars mismatch between zh-CN [${canonicalVars}] and ${file} [${fileVars}]`,
      );
      hasErrors = true;
    }
  }
}

if (!hasErrors) {
  console.log("✅ All locale checks passed");
}
process.exit(hasErrors ? 1 : 0);
