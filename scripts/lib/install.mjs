// One-shot, idempotent install into ~/.claude:
//   - link skills/* into ~/.claude/skills/ (symlink on POSIX, junction on Windows — no admin needed)
//   - set env.CLAUDE_WORKSPACES_ROOT in ~/.claude/settings.json (if requested)
//   - maintain a marked block in ~/.claude/CLAUDE.md so Claude treats attached repos as one workspace
// Re-running updates the block and relinks; `uninstall` reverses all of it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fs.realpathSync.native(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SKILLS = ['save-workspace', 'import-workspace'];
const START = '<!-- claude-workspace-tools:start -->';
const END = '<!-- claude-workspace-tools:end -->';

// Platform-neutral guidance; no machine-specific paths.
const CLAUDE_MD_BLOCK = `${START}
# Multi-repo workspaces (claude-workspace-tools)

I often work across several related Git repos at once (like a Cursor / VS Code
multi-root workspace). Treat the whole set as one workspace, not just the cwd.

## How to discover the workspace
1. If \`permissions.additionalDirectories\` is configured, those directories are
   the workspace. An "umbrella" folder (\`<workspaces-root>/<name>/Workspace/\`
   holding only \`CLAUDE.md\`, \`.claude/settings.json\` and \`.idea/\`, with
   \`<name>.code-workspace\` one level up for Cursor / VS Code) is the usual setup.
2. If the \`webstorm\` MCP server is available, call \`get_repositories\` at the
   start of a session — every VCS root it returns is part of the workspace.
3. \`/save-workspace\` saves the currently attached WebStorm repos as a new
   umbrella (Cursor's "Save Workspace As"); \`/import-workspace\` builds an
   umbrella from an existing \`.code-workspace\` file.

## How to behave
- Search, read and reason across all workspace repos when a task could touch
  shared features, APIs, protocols or contracts between them. Don't restrict
  Glob/Grep to the cwd by default — pass the other repo paths too.
- Always say which repo a file belongs to when reporting or referencing code.
- Run git commands per repo (\`git -C <repo> ...\`); never assume one repo's
  branch or status applies to another.
- If a discovered repo is not in \`additionalDirectories\`, suggest
  \`/add-dir <path>\` once rather than prompting for permission on every file.

## Repo docs written for other AI tools
Repos often carry project docs written for Cursor or other agents, which Claude
Code does not load automatically. Before working in a repo, check its root for
\`.cursor/rules/*.mdc\` (and \`.cursor/rules/**\`), \`.cursorrules\`, \`AGENTS.md\`
and \`CLAUDE.md\`, and read the ones relevant to the task. Treat them like that
repo's \`CLAUDE.md\`: they describe its architecture and conventions, and apply
only to that repo. In \`.mdc\` files, the \`description\`/\`globs\` frontmatter says
when a rule applies; \`alwaysApply: true\` means always read it.
${END}
`;

function linkType() {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

function currentTarget(link) {
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink()) return fs.realpathSync.native(link);
    return null; // a real directory
  } catch {
    return undefined; // does not exist
  }
}

function readSettings(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function writeSettings(file, settings) {
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

export function install({ workspacesRoot, claudeMd = true, log = console.log } = {}) {
  fs.mkdirSync(path.join(CLAUDE_DIR, 'skills'), { recursive: true });

  for (const name of SKILLS) {
    const target = path.join(REPO_ROOT, 'skills', name);
    const link = path.join(CLAUDE_DIR, 'skills', name);
    const cur = currentTarget(link);
    if (cur === target) { log(`skill ${name}: already linked`); continue; }
    if (cur === null) { log(`skill ${name}: ${link} is a real directory, not touching it — remove it and re-run`); continue; }
    if (cur !== undefined) fs.rmSync(link, { recursive: false }); // stale link
    fs.symlinkSync(target, link, linkType());
    log(`skill ${name}: linked ${link} -> ${target}`);
  }

  const settingsFile = path.join(CLAUDE_DIR, 'settings.json');
  if (workspacesRoot) {
    const s = readSettings(settingsFile);
    s.env = { ...(s.env || {}), CLAUDE_WORKSPACES_ROOT: workspacesRoot.split(path.sep).join('/') };
    writeSettings(settingsFile, s);
    log(`settings.json: env.CLAUDE_WORKSPACES_ROOT = ${s.env.CLAUDE_WORKSPACES_ROOT}`);
  }

  if (claudeMd) {
    const file = path.join(CLAUDE_DIR, 'CLAUDE.md');
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const re = new RegExp(`${START}[\\s\\S]*?${END}\\n?`);
    let next;
    if (re.test(existing)) {
      next = existing.replace(re, CLAUDE_MD_BLOCK);
      log(`CLAUDE.md: updated managed block`);
    } else {
      next = existing + (existing && !existing.endsWith('\n\n') ? (existing.endsWith('\n') ? '\n' : '\n\n') : '') + CLAUDE_MD_BLOCK;
      log(`CLAUDE.md: appended managed block`);
    }
    fs.writeFileSync(file, next);
  }
}

export function uninstall({ log = console.log } = {}) {
  for (const name of SKILLS) {
    const link = path.join(CLAUDE_DIR, 'skills', name);
    const cur = currentTarget(link);
    if (cur && cur === path.join(REPO_ROOT, 'skills', name)) {
      fs.rmSync(link, { recursive: false });
      log(`skill ${name}: unlinked`);
    }
  }
  const settingsFile = path.join(CLAUDE_DIR, 'settings.json');
  const s = readSettings(settingsFile);
  if (s.env?.CLAUDE_WORKSPACES_ROOT) {
    delete s.env.CLAUDE_WORKSPACES_ROOT;
    if (!Object.keys(s.env).length) delete s.env;
    writeSettings(settingsFile, s);
    log('settings.json: removed env.CLAUDE_WORKSPACES_ROOT');
  }
  const file = path.join(CLAUDE_DIR, 'CLAUDE.md');
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    const next = existing.replace(new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`), '\n').replace(/^\n+/, '');
    if (next !== existing) {
      if (next.trim()) fs.writeFileSync(file, next); else fs.rmSync(file);
      log('CLAUDE.md: removed managed block');
    }
  }
}
