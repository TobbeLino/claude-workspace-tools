#!/usr/bin/env node
// CLI used by the /save-workspace, /import-workspace and /update-workspace Claude Code skills.
//
//   workspace-tools generate --workspace <file.code-workspace> [--out <dir>] [--force] [--no-import]
//   workspace-tools generate --name <n> --folders <p1> <p2> ... [--out <dir>] [--force] [--no-import]
//   workspace-tools update [--dir <umbrella>] [--dry-run] [--folders <p1> ...]   -> sync the three repo lists
//   workspace-tools check [<umbrella>] [--hook]                            -> report drift (SessionStart hook)
//   workspace-tools select-folder [--suggest <name>] [--initial <dir>]   -> prints <parent>/<name>
//   workspace-tools select-file   [--initial <dir>]                      -> prints chosen file
//   workspace-tools open-ide <dir>
//   workspace-tools info
//   workspace-tools install [--workspaces-root <dir>] [--no-claude-md] [--no-hook]   -> link skills, CLAUDE.md block, drift hook
//   workspace-tools uninstall
//
// Exit codes for the dialogs: 0 chosen, 1 cancelled, 2 no dialog toolkit available (ask the user instead).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultWorkspacesRoot, generate } from './lib/generate.mjs';
import { selectOpenFile, selectSaveFolder } from './lib/dialogs.mjs';
import { openInWebStorm } from './lib/ide.mjs';
import { install, uninstall } from './lib/install.mjs';
import { docChanges, findUmbrella, formatPlan, plan } from './lib/sync.mjs';

const toSlash = (p) => p.split(path.sep).join('/');

const [cmd, ...rest] = process.argv.slice(2);

function fail(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function dialogExit(r) {
  if (r.status === 'ok') { console.log(r.path); process.exit(0); }
  if (r.status === 'cancelled') process.exit(1);
  fail('No native dialog available on this system (need PowerShell, osascript, zenity or kdialog).', 2);
}

switch (cmd) {
  case 'generate': {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        workspace: { type: 'string' },
        name: { type: 'string' },
        folders: { type: 'string', multiple: true },
        out: { type: 'string' },
        force: { type: 'boolean', default: false },
        'no-import': { type: 'boolean', default: false },
      },
    });
    // `--folders a b c` is also accepted: extra positionals are folders.
    const folders = [...(values.folders || []), ...positionals];
    let res;
    try {
      res = generate({ workspaceFile: values.workspace, name: values.name, folders, outDir: values.out, force: values.force, imports: !values['no-import'] });
    } catch (e) {
      fail(e.message);
    }
    for (const iml of res.createdImls) console.log(`Created ${iml}`);
    console.log(`Created ${res.outDir} with ${res.repos.length} repos:`);
    for (const r of res.repos) console.log(`  - ${r.path}`);
    console.log('');
    console.log(`Claude Code:  cd "${res.projDir}" && claude`);
    console.log(`WebStorm:     File > Open > ${res.projDir}   (all repos attached)`);
    console.log(`Cursor:       ${res.wsFile}`);
    break;
  }

  case 'update': {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { dir: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, folders: { type: 'string', multiple: true } },
    });
    const start = values.dir || process.cwd();
    const outDir = findUmbrella(start);
    if (!outDir) fail(`No umbrella at or above ${start} (need <dir>/<dir-name>.code-workspace and <dir>/Workspace/).`);
    // As in generate, `--folders a b c` works: extra positionals are folders.
    values.folders = [...(values.folders || []), ...positionals];
    const p = plan(outDir);
    console.log(`Umbrella: ${toSlash(outDir)}`);
    for (const l of formatPlan(p)) console.log(l);
    // With --folders the caller has already reviewed the plan and picked the final set.
    const folders = values.folders?.length ? values.folders : p.result;
    const docs = docChanges(p.baseline?.docs, folders);
    if (docs.length) { console.log('Agent doc changes:'); for (const d of docs) console.log(`  ${d}`); }
    console.log('Repos after update:');
    for (const f of folders) console.log(`  ${f}${fs.existsSync(f) ? '' : '  (not found on disk: skipped)'}`);
    if (!p.changes.length && !docs.length && !values.folders?.length && p.baseline?.from === 'snapshot') console.log('In sync.');
    if (values['dry-run']) break;
    let res;
    try {
      res = generate({ name: path.basename(outDir), outDir, folders, force: true, imports: p.baseline?.imports ?? true });
    } catch (e) {
      fail(e.message);
    }
    for (const iml of res.createdImls) console.log(`Created ${iml}`);
    console.log(`Updated ${res.outDir}: ${res.repos.length} repos in all three lists.`);
    break;
  }

  case 'check': {
    // SessionStart hook: tell Claude (and the user) when an umbrella's repo lists have drifted.
    // Silent outside an umbrella, when in sync, and on any error — a hook must never get in the way.
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { hook: { type: 'boolean', default: false } } });
    try {
      let start = positionals[0] || process.cwd();
      if (values.hook) {
        try { start = JSON.parse(fs.readFileSync(0, 'utf8')).cwd || start; } catch { /* no stdin */ }
      }
      const outDir = findUmbrella(start);
      if (!outDir) { if (!values.hook) console.log('Not inside an umbrella.'); break; }
      const p = plan(outDir);
      const docs = docChanges(p.baseline?.docs, p.result);
      const drift = [...formatPlan(p), ...(docs.length ? ['Agent doc changes:', ...docs.map((d) => `  ${d}`)] : [])];
      if (!p.changes.length && !docs.length && !p.errors.length) { if (!values.hook) console.log('In sync.'); break; }
      const msg = `Umbrella "${path.basename(outDir)}" is out of sync:\n${drift.join('\n')}`;
      if (!values.hook) { console.log(msg); break; }
      console.log(JSON.stringify({
        systemMessage: `claude-workspace-tools: ${msg}\nRun /update-workspace to sync.`,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `${msg}\nUntil /update-workspace runs, the three lists disagree: additionalDirectories may miss repos the user added elsewhere. Suggest /update-workspace once; don't run it unasked.`,
        },
      }));
    } catch (e) {
      if (!values.hook) fail(e.message);
    }
    break;
  }

  case 'select-folder': {
    const { values } = parseArgs({ args: rest, options: { suggest: { type: 'string' }, initial: { type: 'string' } } });
    const initialDir = values.initial || defaultWorkspacesRoot();
    // The dialog can only start in an existing folder; otherwise OK would save somewhere else.
    fs.mkdirSync(initialDir, { recursive: true });
    dialogExit(selectSaveFolder({ suggestedName: values.suggest || 'my-workspace', initialDir }));
    break;
  }

  case 'select-file': {
    const { values } = parseArgs({ args: rest, options: { initial: { type: 'string' } } });
    dialogExit(selectOpenFile({ initialDir: values.initial || path.dirname(defaultWorkspacesRoot()) }));
    break;
  }

  case 'open-ide': {
    const dir = rest[0];
    if (!dir) fail('Usage: open-ide <dir>');
    const launcher = openInWebStorm(path.resolve(dir));
    if (!launcher) fail(`WebStorm launcher not found; open ${dir} manually (File > Open).`, 2);
    console.log(`Opened ${dir} with ${launcher}`);
    break;
  }

  case 'info': {
    console.log(`platform:        ${process.platform}`);
    console.log(`node:            ${process.version}`);
    console.log(`workspaces root: ${defaultWorkspacesRoot()}  (override with CLAUDE_WORKSPACES_ROOT)`);
    break;
  }

  case 'install': {
    const { values } = parseArgs({
      args: rest,
      options: {
        'workspaces-root': { type: 'string' },
        'no-claude-md': { type: 'boolean', default: false },
        'no-hook': { type: 'boolean', default: false },
      },
    });
    try {
      install({ workspacesRoot: values['workspaces-root'], claudeMd: !values['no-claude-md'], hook: !values['no-hook'] });
    } catch (e) {
      fail(e.message);
    }
    console.log('Done. Start a new Claude Code session to pick up the skills.');
    break;
  }

  case 'uninstall':
    uninstall();
    break;

  default:
    fail(`Usage: workspace-tools <generate|update|check|select-folder|select-file|open-ide|info|install|uninstall> ...`);
}
