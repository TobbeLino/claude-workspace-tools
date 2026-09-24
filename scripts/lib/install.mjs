// One-shot, idempotent install into ~/.claude:
//   - link skills/* into ~/.claude/skills/ (symlink on POSIX, junction on Windows — no admin needed)
//   - set env.CLAUDE_WORKSPACES_ROOT in ~/.claude/settings.json (if requested)
//   - maintain a marked block in ~/.claude/CLAUDE.md so Claude treats attached repos as one workspace
//   - add a SessionStart hook to ~/.claude/settings.json that reports umbrella drift
// Re-running updates the block and relinks; `uninstall` reverses all of it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fs.realpathSync.native(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SKILLS = ['save-workspace', 'import-workspace', 'update-workspace'];
// Forward slashes work in cmd, PowerShell and bash alike. The marker finds our entry again.
const HOOK_MARKER = 'workspace-tools.mjs" check --hook';
const HOOK_COMMAND = `node "${REPO_ROOT.split(path.sep).join('/')}/scripts/${HOOK_MARKER}`;
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
2. If the \`webstorm\` MCP server is available, call \`get_repositories\` with the
   cwd as \`projectPath\`. Every VCS root it returns is part of the workspace. If it
   errors or doesn't know the cwd, WebStorm has another project open (or you run
   in VS Code or a terminal): ignore it and rely on step 1.
3. \`/save-workspace\` saves the currently attached WebStorm repos as a new
   umbrella (Cursor's "Save Workspace As"); \`/import-workspace\` builds an
   umbrella from an existing \`.code-workspace\` file; \`/update-workspace\` syncs an
   umbrella after repos were added or removed in WebStorm, Cursor / VS Code or with
   \`/add-dir\`. When a session-start message says an umbrella is out of sync,
   suggest \`/update-workspace\` once.

## How to behave
- Search, read and reason across all workspace repos when a task could touch
  shared features, APIs, protocols or contracts between them. Don't restrict
  Glob/Grep to the cwd by default — pass the other repo paths too.
- Always say which repo a file belongs to when reporting or referencing code.
- Run git commands per repo (\`git -C <repo> ...\`); never assume one repo's
  branch or status applies to another.
- If a discovered repo is not in \`additionalDirectories\`, suggest
  \`/add-dir <path>\` once rather than prompting for permission on every file.
- Claude Code does not load a workspace repo's own instruction files. An umbrella
  \`CLAUDE.md\` imports or lists them. Without an umbrella, check a repo you touch
  for \`AGENTS.md\`, \`CLAUDE.md\` and \`.cursor/rules/\` (plain \`ls\` hides dot-folders).
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

const isOurs = (h) => h.command?.includes(HOOK_MARKER);

// Drops our SessionStart hook (any checkout path); true if anything was removed.
function removeHook(settings) {
  const groups = settings.hooks?.SessionStart;
  if (!groups?.some((g) => g.hooks?.some(isOurs))) return false;
  settings.hooks.SessionStart = groups
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length);
  if (!settings.hooks.SessionStart.length) delete settings.hooks.SessionStart;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return true;
}

export function install({ workspacesRoot, claudeMd = true, hook = true, log = console.log } = {}) {
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

  if (hook) {
    const s = readSettings(settingsFile);
    const cmds = (s.hooks?.SessionStart || []).flatMap((g) => g.hooks || []).filter(isOurs).map((h) => h.command);
    if (cmds.length === 1 && cmds[0] === HOOK_COMMAND) {
      log('settings.json: drift hook already installed');
    } else {
      removeHook(s); // a stale path from a moved checkout
      s.hooks = s.hooks || {};
      s.hooks.SessionStart = [...(s.hooks.SessionStart || []),
        { matcher: 'startup|resume|clear', hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] }];
      writeSettings(settingsFile, s);
      log(`settings.json: SessionStart hook -> ${HOOK_COMMAND}`);
    }
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
  const h = readSettings(settingsFile);
  if (removeHook(h)) {
    writeSettings(settingsFile, h);
    log('settings.json: removed drift hook');
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
