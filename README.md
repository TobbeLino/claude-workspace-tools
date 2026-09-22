# claude-workspace-tools

Multi-root "workspaces" for Claude Code + WebStorm + Cursor on Windows.

Cursor has `.code-workspace` files; WebStorm has "attached projects"; Claude Code
has `permissions.additionalDirectories`. This repo makes one **umbrella folder**
that serves all three:

```
D:\projects\Workspaces\<name>\
├── <name>.code-workspace      ← open in Cursor / VS Code
└── Workspace\                 ← open in WebStorm; `cd` here and run `claude`
    ├── CLAUDE.md              ← lists the repos, tells Claude to treat them as one workspace
    ├── .claude\settings.json  ← additionalDirectories = the repos
    └── .idea\                 ← modules.xml attaches every repo, vcs.xml maps their git roots
```

The inner folder is literally named `Workspace` so WebStorm's project view
(always `<folder> [<module>]`) reads `Workspace [<name>]`.

## Skills (Claude Code slash commands)

| Command | What it does |
|---|---|
| `/save-workspace` | Reads the repos attached in the current WebStorm session (via the WebStorm MCP), lets you deselect ad-hoc ones, pops a native Save-As dialog for the folder, generates the umbrella. Cursor's "Save Workspace As". |
| `/import-workspace` | Pops an Open dialog for a `.code-workspace` file (or takes a path), generates the umbrella. Re-running it on an umbrella's own `.code-workspace` refreshes it in place. |

Both offer to launch WebStorm on the result.

## Install

```powershell
git clone <this repo> D:\projects\claude-workspace-tools
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\save-workspace"   -Target D:\projects\claude-workspace-tools\skills\save-workspace
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\import-workspace" -Target D:\projects\claude-workspace-tools\skills\import-workspace
```

The skills reference the scripts by absolute path (`D:\projects\claude-workspace-tools\scripts\...`);
adjust `skills\*\SKILL.md` if you clone elsewhere. Native dialogs need a desktop
session (they block until answered).

## Scripts

- `scripts\New-ClaudeWorkspace.ps1` — the generator.
  `-Workspace <file.code-workspace>` **or** `-Name <n> -Folders <p1>, <p2>, …`;
  optional `-OutDir`, `-WorkspacesRoot` (default `D:\projects\Workspaces`), `-Force`.
  Creates a minimal `.idea\<repo>.iml` inside any repo never opened in WebStorm.
- `scripts\Select-WorkspaceFolder.ps1` — Save-As dialog, prints `<parent>\<name>`.
- `scripts\Select-WorkspaceFile.ps1` — Open dialog filtered to `*.code-workspace`.

## Notes

- Regenerating (`-Force`) rewrites `CLAUDE.md`, `.claude\settings.json`,
  `<name>.code-workspace` and all of `.idea\` except `workspace.xml` — so
  attach/detach done in the WebStorm UI is lost unless you `/save-workspace` first.
- Repos on a different drive than the umbrella get absolute paths in `.idea`.
