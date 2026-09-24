// Keeps an umbrella's three repo lists in step:
//   WebStorm         Workspace/.idea/modules.xml
//   Cursor / VS Code <name>.code-workspace
//   Claude Code      Workspace/.claude/settings.json + settings.local.json (additionalDirectories)
//
// Each list is diffed against the snapshot the last generate wrote (a three-way merge), so
// the order of edits across IDEs doesn't matter: a repo gone from any list was removed
// there, a repo new in any list was added there.

import fs from 'node:fs';
import path from 'node:path';
import { SNAPSHOT_FILE, docList, parseJsonc } from './generate.mjs';

const toSlash = (p) => p.split(path.sep).join('/');

export const SOURCES = {
  webstorm: 'WebStorm (.idea/modules.xml)',
  cursor: 'Cursor / VS Code (.code-workspace)',
  claude: 'Claude Code (.claude/settings*.json)',
};

// Display path: real path when it exists (fixes case on Windows/macOS), else just resolved.
function display(p) {
  const abs = path.resolve(p);
  try { return toSlash(fs.realpathSync.native(abs)); } catch { return toSlash(abs).replace(/\/+$/, ''); }
}

// Comparison key: Windows paths are case-insensitive.
const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

function add(map, p) {
  const d = display(p);
  map.set(key(d), d);
}

/** Umbrella root (`<dir>` holding `<dir-name>.code-workspace` and `Workspace/`) at or above `start`, or null. */
export function findUmbrella(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, `${path.basename(dir)}.code-workspace`))
      && fs.existsSync(path.join(dir, 'Workspace', '.claude', 'settings.json'))) return fs.realpathSync.native(dir);
    if (path.dirname(dir) === dir) return null;
  }
}

const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function fromModulesXml(projDir) {
  const file = path.join(projDir, '.idea', 'modules.xml');
  if (!fs.existsSync(file)) return null;
  const out = new Map();
  const own = key(display(path.join(projDir, '.idea')));
  for (const [, fp] of fs.readFileSync(file, 'utf8').matchAll(/<module\b[^>]*\bfilepath="([^"]+)"/g)) {
    const iml = path.resolve(projDir, unxml(fp).replace('$PROJECT_DIR$', projDir));
    const imlDir = path.dirname(iml);
    if (key(display(imlDir)) === own) continue; // the umbrella's own module
    add(out, path.basename(imlDir) === '.idea' ? path.dirname(imlDir) : imlDir);
  }
  return out;
}

function fromCodeWorkspace(file, projDir) {
  if (!fs.existsSync(file)) return null;
  const out = new Map();
  const own = key(display(projDir));
  for (const f of parseJsonc(fs.readFileSync(file, 'utf8')).folders || []) {
    const p = path.resolve(path.dirname(file), f.path);
    if (key(display(p)) !== own) add(out, p);
  }
  return out;
}

function fromClaudeSettings(projDir) {
  const out = new Map();
  for (const f of ['settings.json', 'settings.local.json']) {
    const file = path.join(projDir, '.claude', f);
    if (!fs.existsSync(file)) continue;
    for (const p of JSON.parse(fs.readFileSync(file, 'utf8')).permissions?.additionalDirectories || []) {
      add(out, path.resolve(projDir, p));
    }
  }
  return out;
}

/** The three repo lists; a list is null when its file is missing, `{ error }` when unreadable. */
export function readSources(outDir) {
  const projDir = path.join(outDir, 'Workspace');
  const wsFile = path.join(outDir, `${path.basename(outDir)}.code-workspace`);
  const tryRead = (fn) => { try { return fn(); } catch (e) { return { error: e.message }; } };
  return {
    webstorm: tryRead(() => fromModulesXml(projDir)),
    cursor: tryRead(() => fromCodeWorkspace(wsFile, projDir)),
    claude: tryRead(() => fromClaudeSettings(projDir)),
  };
}

/**
 * What the umbrella held when it was last generated. Umbrellas from before snapshots fall
 * back to the repo table in their CLAUDE.md, which only generate writes.
 */
export function readBaseline(projDir) {
  const snap = path.join(projDir, '.claude', SNAPSHOT_FILE);
  if (fs.existsSync(snap)) {
    const s = JSON.parse(fs.readFileSync(snap, 'utf8'));
    const repos = new Map();
    for (const p of s.repos) add(repos, p);
    return { from: 'snapshot', repos, imports: s.imports !== false, docs: s.docs };
  }
  const md = path.join(projDir, 'CLAUDE.md');
  if (!fs.existsSync(md)) return null;
  const text = fs.readFileSync(md, 'utf8');
  const repos = new Map();
  for (const [, p] of text.matchAll(/^\| .+? \| `([^`]+)` \| (?:git|-) \|$/gm)) add(repos, p);
  if (!repos.size) return null;
  return { from: 'CLAUDE.md', repos, imports: !text.includes("Read a repo's always-on files"), docs: null };
}

/**
 * Three-way merge of the lists against the baseline.
 * @returns {{ baseline, sources, errors: string[], changes: { path: string, change: 'added'|'removed', in: string[] }[],
 *             result: string[], missing: string[] }}
 */
export function plan(outDir) {
  const projDir = path.join(outDir, 'Workspace');
  const baseline = readBaseline(projDir);
  const sources = readSources(outDir);
  const errors = [];
  const lists = {};
  for (const [src, v] of Object.entries(sources)) {
    if (v?.error) errors.push(`${SOURCES[src]}: ${v.error}`);
    else if (v) lists[src] = v;
  }

  // No baseline to diff against: every listed repo counts as added, so the result is the union.
  const base = baseline?.repos || new Map();
  const found = new Map(); // key -> { path, change, in }
  const note = (k, p, change, src) => {
    const c = found.get(k) || { path: p, change, in: [] };
    c.in.push(SOURCES[src]);
    found.set(k, c);
  };
  for (const [src, m] of Object.entries(lists)) {
    for (const [k, p] of m) if (!base.has(k)) note(k, p, 'added', src);
    for (const [k, p] of base) if (!m.has(k)) note(k, p, 'removed', src);
  }

  const result = new Map(base);
  for (const [k, c] of found) {
    if (c.change === 'removed') result.delete(k);
    else result.set(k, c.path);
  }
  const paths = [...result.values()];
  return {
    baseline,
    sources,
    errors,
    changes: [...found.values()],
    result: paths,
    missing: paths.filter((p) => !fs.existsSync(p)),
  };
}

/** Agent docs added/removed/changed since the snapshot, for the given repos. */
export function docChanges(baselineDocs, repoPaths) {
  if (!baselineDocs) return [];
  const now = docList(repoPaths.filter((p) => fs.existsSync(p)).map((p) => ({ path: p })));
  const before = new Map(baselineDocs.map((d) => [key(d.file), d]));
  const after = new Map(now.map((d) => [key(d.file), d]));
  const out = [];
  for (const [k, d] of after) {
    const b = before.get(k);
    if (!b) out.push(`new: ${d.file}`);
    else if (b.always !== d.always) out.push(`${d.always ? 'now always-on' : 'now scoped'}: ${d.file}`);
  }
  for (const [k, d] of before) if (!after.has(k)) out.push(`removed: ${d.file}`);
  return out;
}

export function formatPlan(p) {
  const lines = [];
  if (!p.baseline) lines.push('No snapshot or repo table found: keeping every repo any list has.');
  else if (p.baseline.from === 'CLAUDE.md') lines.push('No snapshot yet (older umbrella): using the repo table in CLAUDE.md as the baseline.');
  for (const e of p.errors) lines.push(`Could not read ${e}`);
  for (const [src, v] of Object.entries(p.sources)) if (v === null) lines.push(`Missing: ${SOURCES[src]}`);
  if (p.changes.length) {
    lines.push('Changes since last sync:');
    for (const c of p.changes) lines.push(`  ${c.change === 'added' ? '+' : '-'} ${c.path}  (${c.change} in ${c.in.join(', ')})`);
  }
  return lines;
}
