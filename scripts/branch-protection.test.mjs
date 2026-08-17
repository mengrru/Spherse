import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const payloadPath = path.join(here, 'branch-protection.json');
const scriptPath = path.join(here, 'enforce-branch-protection.sh');

const REQUIRED_CHECK = 'PR Build / verify';

test('branch-protection.json parses and requires the PR build check', () => {
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));

  assert.ok(payload.required_status_checks, 'required_status_checks must be configured');
  const { contexts } = payload.required_status_checks;
  assert.ok(Array.isArray(contexts), 'contexts must be an array');
  assert.ok(contexts.length > 0, 'contexts must not be empty');
  assert.ok(contexts.includes(REQUIRED_CHECK), `must require "${REQUIRED_CHECK}"`);
});

test('branch protection settings are explicit and merge-safe', () => {
  const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));

  assert.equal(payload.enforce_admins, true, 'required check must apply to admins too');
  assert.equal(payload.allow_deletions, false, 'protected branch must not be deletable');
  assert.equal(payload.allow_force_pushes, false, 'protected branch must not allow force pushes');
  assert.equal(payload.required_linear_history, false, 'squash merges are allowed (PR workflow)');
  assert.equal(payload.required_pull_request_reviews, null, 'no separate review requirement (PR flow)');
  assert.equal(payload.restrictions, null, 'no push restrictions (private team repo)');
});

test('enforce script exists and targets the same required check', () => {
  assert.ok(existsSync(scriptPath), 'enforce-branch-protection.sh must exist');
  const script = readFileSync(scriptPath, 'utf8');
  assert.match(script, /REQUIRED_CHECK=/, 'script must define the required check name');
  assert.ok(script.includes(REQUIRED_CHECK), 'script must reference the same check name');
  assert.match(script, /BRANCH="\$\{BRANCH:-dev\}"/, 'script must default to the dev branch');
});
