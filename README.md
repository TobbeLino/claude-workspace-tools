# claude-workspace-tools

Multi-root "workspaces" for Claude Code + WebStorm + Cursor / VS Code. Windows, macOS, Linux.

Cursor and VS Code have `.code-workspace` files; WebStorm has "attached projects"; Claude Code
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
| `/import-workspace` | Pops an Open dialog for a `.code-workspace` file (or takes a path), then a Save-As dialog for the umbrella folder (defaults to `<workspaces-root>/<file-basename>`), generates the umbrella. Re-running it on an umbrella's own `.code-workspace` refreshes it in place. |

Both offer to launch WebStorm on the result.

## Requirements

- Node ≥ 18 (no npm dependencies)
- Claude Code; the WebStorm MCP server (bundled with the JetBrains Claude plugin)
  for `/save-workspace` to discover attached repos
- For the native dialogs: PowerShell (Windows), `osascript` (macOS, built in),
  `zenity` or `kdialog` (Linux). Without one, the skills fall back to asking in chat.

## Install

```bash
git clone https://github.com/TobbeLino/claude-workspace-tools.git ~/projects/claude-workspace-tools
node ~/projects/claude-workspace-tools/scripts/workspace-tools.mjs install --workspaces-root ~/projects/Workspaces
```

Then start a new Claude Code session. `install` is idempotent and does three things:

1. Links `skills/save-workspace` and `skills/import-workspace` into
   `~/.claude/skills/` (symlink on macOS/Linux, junction on Windows — no admin).
   Each skill folder holds a `cli.mjs` shim that resolves its real location
   through the link, so the repo can live anywhere.
2. Sets `env.CLAUDE_WORKSPACES_ROOT` in `~/.claude/settings.json` (where
   umbrellas are created; omit `--workspaces-root` to keep the default
   `~/projects/Workspaces`).
3. Adds a managed block to `~/.claude/CLAUDE.md` (between
   `<!-- claude-workspace-tools:start/end -->` markers) that tells Claude to
   treat attached WebStorm repos / `additionalDirectories` as one workspace,
   search across all of them, run git per repo, and read each repo's docs for
   other AI tools (`.cursor/rules/`, `.cursorrules`, `AGENTS.md`), which Claude
   Code does not load on its own. Skip with `--no-claude-md`.
   Re-running `install` after a `git pull` refreshes the block.

`node scripts/workspace-tools.mjs uninstall` reverses all three.

## CLI

```
node scripts/workspace-tools.mjs generate --workspace <file.code-workspace> [--out <dir>] [--force]
node scripts/workspace-tools.mjs generate --name <n> --folders <p1> <p2> ... [--out <dir>] [--force]
node scripts/workspace-tools.mjs select-folder [--suggest <name>] [--initial <dir>]   # Save-As dialog → <parent>/<name>
node scripts/workspace-tools.mjs select-file   [--initial <dir>]                      # Open dialog → chosen file
node scripts/workspace-tools.mjs open-ide <dir>                                       # launch WebStorm
node scripts/workspace-tools.mjs info
node scripts/workspace-tools.mjs install [--workspaces-root <dir>] [--no-claude-md]
node scripts/workspace-tools.mjs uninstall
```

Dialog exit codes: `0` chosen (path on stdout), `1` cancelled, `2` no dialog
toolkit available. `generate` creates a minimal `.idea/<repo>.iml` inside any
repo that has never been opened in WebStorm.

## Notes

- Regenerating (`--force`) rewrites `CLAUDE.md`, `.claude/settings.json`,
  `<name>.code-workspace` and all of `.idea/` except `workspace.xml` — so
  attach/detach done in the WebStorm UI is lost unless you `/save-workspace` first.
- Everything in the source `.code-workspace` besides `folders` (`settings`,
  `launch`, `tasks`, `extensions`, ...) is copied into the umbrella's
  `<name>.code-workspace` as-is; comments in it are not kept.
- Repos on a different drive than the umbrella get absolute paths in `.idea`.
- Open only one dialog at a time: on Windows a second dialog launched right after
  the first closes can come up without focus and hide behind other windows.
- macOS and Linux dialog/launcher paths are implemented but were not tested on
  real machines yet — reports welcome.
