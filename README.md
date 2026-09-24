# claude-workspace-tools

Multi-root "workspaces" for Claude Code + WebStorm + Cursor / VS Code. Windows, macOS, Linux.

Cursor and VS Code have `.code-workspace` files; WebStorm has "attached projects"; Claude Code
has `permissions.additionalDirectories`. This repo makes one **umbrella folder**
that serves all three:

```
<workspaces-root>/<name>/
├── <name>.code-workspace      ← open in Cursor / VS Code
└── Workspace/                 ← open in WebStorm; `cd` here and run `claude`
    ├── CLAUDE.md              ← lists the repos, imports their agent rules (AGENTS.md, .cursor/rules, ...)
    ├── .claude/settings.json  ← additionalDirectories = the repos
    └── .idea/                 ← modules.xml attaches every repo, vcs.xml maps their git roots
```

The inner folder is literally named `Workspace` so WebStorm's project view
(always `<folder> [<module>]`) reads `Workspace [<name>]`.

## Skills (Claude Code slash commands)

| Command | What it does |
|---|---|
| `/save-workspace` | Reads the repos attached in the current WebStorm session (via the WebStorm MCP server), lets you deselect ad-hoc ones, pops a native Save-As dialog for the folder, generates the umbrella. Cursor's "Save Workspace As". |
| `/import-workspace` | Pops an Open dialog for a `.code-workspace` file (or takes a path), then a Save-As dialog for the umbrella folder (defaults to `<workspaces-root>/<file-basename>`), generates the umbrella. |
| `/update-workspace` | Run inside an umbrella after adding or removing repos in any IDE. Merges the three repo lists (see [Keeping the lists in sync](#keeping-the-lists-in-sync)), shows the changes, then rewrites all of them and re-scans the repos for agent rule files. |

`/save-workspace` and `/import-workspace` offer to launch WebStorm on the result.

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

Then start a new Claude Code session. `install` is idempotent and does four things:

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
   search across all of them, and run git per repo. Skip with `--no-claude-md`.
   Re-running `install` after a `git pull` refreshes the block.
4. Adds a `SessionStart` hook to `~/.claude/settings.json` that runs `check --hook`.
   Started inside an umbrella whose lists have drifted, a session shows what
   changed and suggests `/update-workspace`. Elsewhere it prints nothing. Skip
   with `--no-hook`.

`node scripts/workspace-tools.mjs uninstall` reverses all four.

## CLI

```
node scripts/workspace-tools.mjs generate --workspace <file.code-workspace> [--out <dir>] [--force] [--no-import]
node scripts/workspace-tools.mjs generate --name <n> --folders <p1> <p2> ... [--out <dir>] [--force] [--no-import]
node scripts/workspace-tools.mjs update [--dir <umbrella>] [--dry-run] [--folders <p1> ...]    # sync the three repo lists
node scripts/workspace-tools.mjs check [<umbrella>] [--hook]                                   # report drift
node scripts/workspace-tools.mjs select-folder [--suggest <name>] [--initial <dir>]   # Save-As dialog → <parent>/<name>
node scripts/workspace-tools.mjs select-file   [--initial <dir>]                      # Open dialog → chosen file
node scripts/workspace-tools.mjs open-ide <dir>                                       # launch WebStorm
node scripts/workspace-tools.mjs info
node scripts/workspace-tools.mjs install [--workspaces-root <dir>] [--no-claude-md] [--no-hook]
node scripts/workspace-tools.mjs uninstall
```

Dialog exit codes: `0` chosen (path on stdout), `1` cancelled, `2` no dialog
toolkit available. `generate` creates a minimal `.idea/<repo>.iml` inside any
repo that has never been opened in WebStorm.

## Repo rules for AI agents

Claude Code does not load instruction files from `additionalDirectories`. That
covers each repo's `CLAUDE.md` (unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`)
and its `AGENTS.md` (never). `generate` scans every repo and writes a
"Repo docs for AI tools" section into the umbrella `CLAUDE.md`. Nothing inside
the repos is changed.

- **Imported with `@path`** (loaded at every session start): `AGENTS.md`,
  `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
  `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, and rule
  files that always apply: `.cursor/rules` with `alwaysApply: true`,
  `.claude/rules` without `paths`, `.windsurf/rules` with `trigger: always_on`,
  and everything in a `.clinerules/` folder.
- **Listed by path** with their `globs` / `paths` / `applyTo` / `description`:
  the other rule files, plus `.github/instructions/**/*.instructions.md` and
  `.devin/rules/**`. Claude reads them when the task matches.

The imports point outside the umbrella, so the first session asks once to approve
external imports. Imported files load in full every session. Pass `--no-import`
to list them by path instead. Paths with spaces are always listed, as `@path`
stops at whitespace. File contents are read live; new or removed files need
`/update-workspace` (the drift hook reports them).

## Keeping the lists in sync

An umbrella keeps its repo list in three places, and each tool edits only its own:

| List | Edited by |
|---|---|
| `Workspace/.idea/modules.xml` | WebStorm attach / detach |
| `<name>.code-workspace` `folders` | Cursor / VS Code "Add Folder to Workspace" |
| `Workspace/.claude/settings.json` + `settings.local.json` `additionalDirectories` | `/add-dir` |

Every generate writes a snapshot of the repo list to
`Workspace/.claude/workspace-tools.json`. `update` diffs each list against it: a
repo missing from a list was removed there, a repo new in a list was added there.
So the order of edits across tools doesn't matter, and file timestamps play no
part. Detaching a repo in WebStorm removes it, even though Cursor and Claude Code
still list it. Then all three lists and the snapshot are rewritten to the result.
Umbrellas from before snapshots use the repo table in their `CLAUDE.md` as the
baseline.

`update` reads the files directly, so it works from WebStorm, VS Code or a plain
terminal, without the WebStorm MCP server.

After `update` the three lists are identical. They drift again as soon as a
tool changes one:

- WebStorm with the umbrella open reloads changed `.idea` files. If it asks,
  choose reload. Keeping its in-memory state writes the old module list back.
- A running Claude Code session keeps the `additionalDirectories` it started with.
  Restart it, or `/add-dir` the added repos.
- `/add-dir` for the session only writes no file, so no list sees it.
- `additionalDirectories` in `~/.claude/settings.json` apply to every project and
  are not part of any umbrella list.

## Notes

- Regenerating (`--force`, or `update`) rewrites `CLAUDE.md`, `.claude/settings.json`,
  `<name>.code-workspace` and all of `.idea/` except `workspace.xml`. `update` merges
  the three lists first. `generate --force` uses only the repos you pass.
- Everything in the source `.code-workspace` besides `folders` (`settings`,
  `launch`, `tasks`, `extensions`, ...) is copied into the umbrella's
  `<name>.code-workspace` as-is; comments in it are not kept. Folder `name`s that
  differ from the folder's basename are kept too, so `${workspaceFolder:<name>}`
  references still resolve.
- Repos on a different drive than the umbrella get absolute paths in `.idea`.
- Open only one dialog at a time: on Windows a second dialog launched right after
  the first closes can come up without focus and hide behind other windows.
- macOS and Linux dialog/launcher paths are implemented but were not tested on
  real machines yet — reports welcome.
