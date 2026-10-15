import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const workflowPath = path.resolve(__dirname, '../../.github/workflows/ci.yml');
const source = fs.readFileSync(workflowPath, 'utf8');
const workflow = yaml.load(source);
const jobs = Object.entries(workflow.jobs);

it('requires immutable commit references for every external action in every CI job', () => {
  const actionSteps = jobs.flatMap(([, job]) => job.steps.filter((step) => step.uses));
  expect(actionSteps.length).toBeGreaterThan(0);
  for (const step of actionSteps) {
    // A major/version tag can be moved after review. A complete commit hash
    // keeps the reviewed Action code fixed until the workflow is changed.
    expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[a-f\d]{40}$/);
  }
});

it.each(jobs)('%s removes checkout credentials before running repository code', (_name, job) => {
  const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
  expect(checkouts.length).toBeGreaterThan(0);
  for (const checkout of checkouts) expect(checkout.with?.['persist-credentials']).toBe(false);
});

it('runs untrusted pull requests in the pull_request context rather than a privileged event', () => {
  expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push']);
  expect(Object.prototype.hasOwnProperty.call(workflow.on, 'pull_request')).toBe(true);
  expect(JSON.stringify(workflow)).not.toMatch(/\bsecrets(?:\s*\.|\s*\[)/);
});

it.each(jobs)('%s keeps a hosted Ubuntu runner and a read-only repository token', (_name, job) => {
  expect(job['runs-on']).toMatch(/^ubuntu-(?:latest|\d+\.\d+)$/);
  const permissions = job.permissions ?? workflow.permissions;
  expect(typeof permissions).toBe('object');
  expect(permissions.contents).toBe('read');
  for (const [scope, level] of Object.entries(permissions)) {
    if (scope !== 'contents') expect(level).toBe('none');
  }
});

it('keeps automated update proposals limited to the pinned GitHub Actions', () => {
  const dependabotPath = path.resolve(__dirname, '../../.github/dependabot.yml');
  expect(fs.existsSync(dependabotPath)).toBe(true);
  const dependabot = yaml.load(fs.readFileSync(dependabotPath, 'utf8'));
  expect(dependabot.version).toBe(2);
  expect(dependabot.updates.length).toBeGreaterThan(0);
  for (const update of dependabot.updates) {
    expect(update['package-ecosystem']).toBe('github-actions');
    expect(update.directory).toBe('/');
    expect(update.schedule.interval).toBe('weekly');
  }
});
