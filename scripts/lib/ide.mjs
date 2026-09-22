// Launch WebStorm on a directory, cross-platform. Returns the launcher used, or null if none was found.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function onPath(cmd) {
  const probe = process.platform === 'win32' ? ['where', [cmd]] : ['which', [cmd]];
  const r = spawnSync(probe[0], probe[1], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? (r.stdout.split(/\r?\n/)[0] || '').trim() : null;
}

function glob1(dir, prefix, rest) {
  // First match of <dir>/<prefix>*/<rest>, newest version last in sort order so pick the last.
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter((n) => n.startsWith(prefix)).sort();
  for (const n of hits.reverse()) {
    const p = path.join(dir, n, rest);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findLauncher() {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return onPath('webstorm64.exe') || onPath('webstorm.exe') || onPath('webstorm.cmd')
        || glob1(path.join(home, 'AppData', 'Local', 'JetBrains', 'Toolbox', 'scripts'), 'webstorm', '')
        || glob1(process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'JetBrains') : 'C:\\Program Files\\JetBrains', 'WebStorm', path.join('bin', 'webstorm64.exe'))
        || glob1(path.join(home, 'AppData', 'Local', 'Programs'), 'WebStorm', path.join('bin', 'webstorm64.exe'));
    case 'darwin':
      return onPath('webstorm') || 'open'; // `open -na WebStorm` works whenever the app is installed
    default:
      return onPath('webstorm') || onPath('webstorm.sh')
        || glob1(path.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts'), 'webstorm', '')
        || glob1('/opt', 'webstorm', path.join('bin', 'webstorm.sh'))
        || (fs.existsSync('/snap/bin/webstorm') ? '/snap/bin/webstorm' : null);
  }
}

export function openInWebStorm(dir) {
  const launcher = findLauncher();
  if (!launcher) return null;
  const args = launcher === 'open' ? ['-na', 'WebStorm', '--args', dir] : [dir];
  const child = spawn(launcher, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return launcher;
}
