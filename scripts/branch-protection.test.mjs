import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const payloadPath = path.join(here, 'branch-protection.json');
const scriptPath = path.join(here, 'enforce-branch-protection.sh');
const workflowPath = path.join(here, '..', '.github', 'workflows', 'pr-build.yml');

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

  assert.equal(payload.required_status_checks.strict, false, 'only head must be checked, not up-to-date with base');
  assert.equal(payload.enforce_admins, true, 'required check must apply to admins too');
  assert.equal(payload.allow_deletions, false, 'protected branch must not be deletable');
  assert.equal(payload.allow_force_pushes, false, 'protected branch must not allow force pushes');
  assert.equal(payload.required_linear_history, false, 'squash merges are allowed (PR workflow)');
  assert.equal(payload.required_conversation_resolution, false, 'no conversation resolution requirement');
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

test('enforce script applies the checked-in payload and checks it drift-free', () => {
  const script = readFileSync(scriptPath, 'utf8');
  assert.ok(script.includes('branch-protection.json'), 'apply mode must PUT the checked-in payload file');
  assert.ok(script.includes('grep -qxF'), 'check mode must exact-match contexts line by line');
  assert.ok(script.includes('enforce_admins'), 'check mode must verify enforce_admins');
  assert.ok(script.includes('allow_force_pushes'), 'check mode must verify allow_force_pushes');
  assert.ok(script.includes('allow_deletions'), 'check mode must verify allow_deletions');
  assert.ok(script.includes('HTTP 404'), 'check mode must distinguish "not protected" from API errors');
});

test('PR build workflow always reports the required check name', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^name: PR Build$/m, 'workflow name must combine with job name into "PR Build / verify"');
  assert.match(workflow, /^ {2}verify:$/m, 'job must be named verify so the check context is exactly "PR Build / verify"');
  assert.ok(!workflow.includes('paths-ignore'), 'path filtering would leave filtered PRs without the required check, blocking merge forever');
  assert.ok(!/^\s+paths:/m.test(workflow), 'workflow must run on every pull_request so the required check always reports');
});
