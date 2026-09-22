# claude-workspace-tools

Multi-root "workspaces" for Claude Code + WebStorm + Cursor. Windows, macOS, Linux.

Cursor has `.code-workspace` files; WebStorm has "attached projects"; Claude Code
has `permissions.additionalDirectories`. This repo makes one **umbrella folder**
that serves all three:

```
<workspaces-root>/<name>/
├── <name>.code-workspace      ← open in Cursor / VS Code
└── Workspace/                 ← open in WebStorm; `cd` here and run `claude`
    ├── CLAUDE.md              ← lists the repos, tells Claude to treat them as one workspace
    ├── .claude/settings.json  ← additionalDirectories = the repos
    └── .idea/                 ← modules.xml attaches every repo, vcs.xml maps their git roots
```

The inner folder is literally named `Workspace` so WebStorm's project view
(always `<folder> [<module>]`) reads `Workspace [<name>]`.

## Skills (Claude Code slash commands)

| Command | What it does |
|---|---|
| `/save-workspace` | Reads the repos attached in the current WebStorm session (via the WebStorm MCP server), lets you deselect ad-hoc ones, pops a native Save-As dialog for the folder, generates the umbrella. Cursor's "Save Workspace As". |
| `/import-workspace` | Pops an Open dialog for a `.code-workspace` file (or takes a path), generates the umbrella. Re-running it on an umbrella's own `.code-workspace` refreshes it in place. |

Both offer to launch WebStorm on the result.

## Requirements

- Node ≥ 18 (no npm dependencies)
- Claude Code; the WebStorm MCP server (bundled with the JetBrains Claude plugin)
  for `/save-workspace` to discover attached repos
- For the native dialogs: PowerShell (Windows), `osascript` (macOS, built in),
  `zenity` or `kdialog` (Linux). Without one, the skills fall back to asking in chat.

## Install

Clone, then link the two skill folders into `~/.claude/skills/`:

```bash
git clone <this repo> ~/projects/claude-workspace-tools
cd ~/projects/claude-workspace-tools
# macOS / Linux
ln -s "$PWD/skills/save-workspace"   ~/.claude/skills/save-workspace
ln -s "$PWD/skills/import-workspace" ~/.claude/skills/import-workspace
```

```powershell
# Windows (junctions need no admin rights)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\save-workspace"   -Target "$PWD\skills\save-workspace"
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\import-workspace" -Target "$PWD\skills\import-workspace"
```

Each skill folder holds a `cli.mjs` shim that resolves its own real location
(through the symlink/junction) and runs `scripts/workspace-tools.mjs`, so the
repo can live anywhere.

### Workspaces root

Umbrellas are created under `~/projects/Workspaces` by default. Override with the
`CLAUDE_WORKSPACES_ROOT` environment variable — easiest in `~/.claude/settings.json`
so it applies to every Claude session:

```json
{ "env": { "CLAUDE_WORKSPACES_ROOT": "D:/projects/Workspaces" } }
```

### Optional: global CLAUDE.md hint

Adding a note like this to `~/.claude/CLAUDE.md` makes Claude treat the attached
repos as one workspace in every session:

```markdown
# Multi-repo workspaces
If `permissions.additionalDirectories` is set, those directories are the workspace.
If the `webstorm` MCP server is available, call `get_repositories` at session
start — every VCS root is part of the workspace. Search and reason across all of
them, say which repo a file belongs to, and run git per repo (`git -C <repo> ...`).
```

## CLI

```
node scripts/workspace-tools.mjs generate --workspace <file.code-workspace> [--out <dir>] [--force]
node scripts/workspace-tools.mjs generate --name <n> --folders <p1> <p2> ... [--out <dir>] [--force]
node scripts/workspace-tools.mjs select-folder [--suggest <name>] [--initial <dir>]   # Save-As dialog → <parent>/<name>
node scripts/workspace-tools.mjs select-file   [--initial <dir>]                      # Open dialog → chosen file
node scripts/workspace-tools.mjs open-ide <dir>                                       # launch WebStorm
node scripts/workspace-tools.mjs info
```

Dialog exit codes: `0` chosen (path on stdout), `1` cancelled, `2` no dialog
toolkit available. `generate` creates a minimal `.idea/<repo>.iml` inside any
repo that has never been opened in WebStorm.

## Notes

- Regenerating (`--force`) rewrites `CLAUDE.md`, `.claude/settings.json`,
  `<name>.code-workspace` and all of `.idea/` except `workspace.xml` — so
  attach/detach done in the WebStorm UI is lost unless you `/save-workspace` first.
- Repos on a different drive than the umbrella get absolute paths in `.idea`.
- Open only one dialog at a time: on Windows a second dialog launched right after
  the first closes can come up without focus and hide behind other windows.
- macOS and Linux dialog/launcher paths are implemented but were not tested on
  real machines yet — reports welcome.
