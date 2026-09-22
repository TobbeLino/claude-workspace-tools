#!/usr/bin/env node
// CLI used by the /save-workspace and /import-workspace Claude Code skills.
//
//   workspace-tools generate --workspace <file.code-workspace> [--out <dir>] [--force]
//   workspace-tools generate --name <n> --folders <p1> <p2> ... [--out <dir>] [--force]
//   workspace-tools select-folder [--suggest <name>] [--initial <dir>]   -> prints <parent>/<name>
//   workspace-tools select-file   [--initial <dir>]                      -> prints chosen file
//   workspace-tools open-ide <dir>
//   workspace-tools info
//   workspace-tools install [--workspaces-root <dir>] [--no-claude-md]   -> link skills into ~/.claude, add CLAUDE.md block
//   workspace-tools uninstall
//
// Exit codes for the dialogs: 0 chosen, 1 cancelled, 2 no dialog toolkit available (ask the user instead).

import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultWorkspacesRoot, generate } from './lib/generate.mjs';
import { selectOpenFile, selectSaveFolder } from './lib/dialogs.mjs';
import { openInWebStorm } from './lib/ide.mjs';
import { install, uninstall } from './lib/install.mjs';

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
      },
    });
    // `--folders a b c` is also accepted: extra positionals are folders.
    const folders = [...(values.folders || []), ...positionals];
    let res;
    try {
      res = generate({ workspaceFile: values.workspace, name: values.name, folders, outDir: values.out, force: values.force });
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

  case 'select-folder': {
    const { values } = parseArgs({ args: rest, options: { suggest: { type: 'string' }, initial: { type: 'string' } } });
    dialogExit(selectSaveFolder({ suggestedName: values.suggest || 'my-workspace', initialDir: values.initial || defaultWorkspacesRoot() }));
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
      options: { 'workspaces-root': { type: 'string' }, 'no-claude-md': { type: 'boolean', default: false } },
    });
    try {
      install({ workspacesRoot: values['workspaces-root'], claudeMd: !values['no-claude-md'] });
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
    fail(`Usage: workspace-tools <generate|select-folder|select-file|open-ide|info|install|uninstall> ...`);
}
