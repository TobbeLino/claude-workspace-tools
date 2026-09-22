// Native file dialogs without dependencies.
//   Windows: WinForms via an inline PowerShell snippet
//   macOS:   osascript (AppleScript "choose file name" / "choose file")
//   Linux:   zenity, falling back to kdialog
//
// Every function resolves to { status: 'ok', path } | { status: 'cancelled' } | { status: 'unavailable' }.
// 'unavailable' means no dialog toolkit could be found (headless, SSH, ...) — callers should fall back to asking.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SAVE_TITLE = 'Save workspace as — a folder with this name will be created';
const OPEN_TITLE = 'Import Cursor / VS Code workspace (*.code-workspace)';

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, windowsHide: true });
  if (r.error?.code === 'ENOENT') return { missing: true };
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function result(r) {
  if (r.missing) return { status: 'unavailable' };
  if (r.status === 0 && r.stdout) return { status: 'ok', path: r.stdout.split(/\r?\n/).pop() };
  return { status: 'cancelled' };
}

// --- Windows -------------------------------------------------------------

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function runPowerShell(script) {
  // pwsh (PowerShell 7) if present, else Windows PowerShell 5. -STA is required for WinForms.
  for (const exe of ['pwsh', 'powershell']) {
    const r = run(exe, ['-NoProfile', '-NonInteractive', '-STA', '-Command', script]);
    if (!r.missing) return r;
  }
  return { missing: true };
}

// A topmost invisible owner form makes the dialog appear in front of the terminal/IDE.
const PS_OWNER = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0
$owner.Show(); $owner.Activate()
`;

function winSaveFolder(suggestedName, initialDir) {
  return result(runPowerShell(`${PS_OWNER}
$dlg = New-Object System.Windows.Forms.SaveFileDialog
$dlg.Title = ${psQuote(SAVE_TITLE)}
$dlg.InitialDirectory = ${psQuote(initialDir)}
$dlg.FileName = ${psQuote(suggestedName)}
$dlg.Filter = 'Workspace folder|*.'
$dlg.AddExtension = $false; $dlg.OverwritePrompt = $false; $dlg.CheckPathExists = $true
$r = $dlg.ShowDialog($owner); $owner.Close()
if ($r -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
Write-Output ($dlg.FileName -replace '\\.$', '')
`));
}

function winOpenFile(initialDir) {
  return result(runPowerShell(`${PS_OWNER}
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = ${psQuote(OPEN_TITLE)}
$dlg.InitialDirectory = ${psQuote(initialDir)}
$dlg.Filter = 'Workspace files (*.code-workspace)|*.code-workspace|All files (*.*)|*.*'
$dlg.CheckFileExists = $true; $dlg.Multiselect = $false
$r = $dlg.ShowDialog($owner); $owner.Close()
if ($r -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
Write-Output $dlg.FileName
`));
}

// --- macOS ---------------------------------------------------------------

function asQuote(s) {
  return '"' + String(s).replace(/["\\]/g, '\\$&') + '"';
}

function macSaveFolder(suggestedName, initialDir) {
  const script = `POSIX path of (choose file name with prompt ${asQuote(SAVE_TITLE)} default name ${asQuote(suggestedName)} default location POSIX file ${asQuote(initialDir)})`;
  const r = run('osascript', ['-e', script]);
  if (!r.missing && r.status === 0) r.stdout = r.stdout.replace(/\/$/, '');
  return result(r);
}

function macOpenFile(initialDir) {
  const script = `POSIX path of (choose file with prompt ${asQuote(OPEN_TITLE)} default location POSIX file ${asQuote(initialDir)})`;
  return result(run('osascript', ['-e', script]));
}

// --- Linux ---------------------------------------------------------------

function linuxSaveFolder(suggestedName, initialDir) {
  const start = path.join(initialDir, suggestedName);
  let r = run('zenity', ['--file-selection', '--save', `--title=${SAVE_TITLE}`, `--filename=${start}`]);
  if (r.missing) r = run('kdialog', ['--title', SAVE_TITLE, '--getsavefilename', start]);
  return result(r);
}

function linuxOpenFile(initialDir) {
  let r = run('zenity', ['--file-selection', `--title=${OPEN_TITLE}`, `--filename=${initialDir}${path.sep}`,
    '--file-filter=Workspace files | *.code-workspace', '--file-filter=All files | *']);
  if (r.missing) r = run('kdialog', ['--title', OPEN_TITLE, '--getopenfilename', initialDir, '*.code-workspace']);
  return result(r);
}

// --- public --------------------------------------------------------------

/** "Save As" style: user picks a parent folder and types a name; returns <parent>/<name> (not created). */
export function selectSaveFolder({ suggestedName = 'my-workspace', initialDir = process.cwd() } = {}) {
  switch (process.platform) {
    case 'win32': return winSaveFolder(suggestedName, initialDir);
    case 'darwin': return macSaveFolder(suggestedName, initialDir);
    default: return linuxSaveFolder(suggestedName, initialDir);
  }
}

/** "Open" style: user picks an existing *.code-workspace file. */
export function selectOpenFile({ initialDir = process.cwd() } = {}) {
  switch (process.platform) {
    case 'win32': return winOpenFile(initialDir);
    case 'darwin': return macOpenFile(initialDir);
    default: return linuxOpenFile(initialDir);
  }
}
