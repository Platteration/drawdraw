/**
 * REVIEW.md keeps the review as it was written, file names of the day and all,
 * but its two status blocks say what the tree is now, and a reader goes looking
 * for the files they name. After the TypeScript conversion those blocks still
 * sent them to storage.js, EditorScreen.js and two tests' .js names that no
 * longer existed. Every file a status block names is held to a tracked file: a
 * path to that path, a bare name to some tracked file of that name.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const review = fs.readFileSync(path.join(root, 'REVIEW.md'), 'utf8');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const basenames = new Set(tracked.map((f) => path.posix.basename(f)));

/** The text from the line `start` to the next heading of `level` or fewer #s. */
function section(start: string, level: number): string {
  const lines = review.split('\n');
  const from = lines.indexOf(start);
  if (from < 0) throw new Error(`REVIEW.md has no line ${JSON.stringify(start)}`);
  const end = lines.findIndex((line, i) => i > from && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(from, end < 0 ? undefined : end).join('\n');
}

const status = [
  section('## Status — what has been fixed', 2),
  section('### Status of the shared items (2026-09-21)', 3),
].join('\n');

it('names only files the tree holds in its status blocks', () => {
  const names = [...new Set(status.match(/[\w./-]*\w\.(?:jsx?|tsx?|mjs|cjs|json|md|ya?ml)\b/g) ?? [])];
  // The scan has to find something for the check to mean anything.
  expect(names).toEqual(expect.arrayContaining(['app.json', 'ci.yml', 'CONVENTIONS.md']));
  const missing = names.filter((name) => (name.includes('/') ? !tracked.includes(name) : !basenames.has(name)));
  expect(missing).toEqual([]);
});
