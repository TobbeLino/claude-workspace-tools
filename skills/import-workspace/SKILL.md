---
name: import-workspace
description: Import a Cursor / VS Code *.code-workspace file and create a WebStorm + Claude Code "umbrella" folder from it. Use when the user says /import-workspace, "import this workspace", "convert this code-workspace", or "open this Cursor workspace in WebStorm".
---

# /import-workspace

Turn a `*.code-workspace` file into an umbrella workspace folder
(`<name>.code-workspace` + `Workspace/` with CLAUDE.md, `.claude/settings.json`,
`.idea/`).

All tooling is one Node CLI (Node ≥ 18, no dependencies). `<skill-dir>` below is
the "Base directory for this skill" shown at the top of this prompt:

```
node "<skill-dir>/cli.mjs" <command> ...
```

## Steps

1. **Pick the file.**
   - If `$ARGUMENTS` is a path to a `.code-workspace` file, use it.
   - Otherwise pop the native Open dialog (it blocks; use a 300000 ms timeout):
     ```
     node "<skill-dir>/cli.mjs" select-file
     ```
     exit 0 → stdout is the file. exit 1 → cancelled: stop and say so.
     exit 2 → no dialog toolkit (headless/SSH): ask for the path in chat.

2. **Decide the target folder.**
   - If the chosen file is an umbrella's own (`<dir>/<dir-name>.code-workspace`
     with `<dir>/Workspace/.claude/settings.json` beside it), don't import it:
     that would drop repos attached in WebStorm or added with `/add-dir` since.
     Run the `/update-workspace` steps on `<dir>` instead.
   - Otherwise pop the native Save-As dialog. Don't ask in chat first. It opens
     in the workspaces root with the file's basename pre-filled, so clicking
     OK keeps the default `<workspaces-root>/<file-basename>/` (blocks; use a
     300000 ms timeout):
     ```
     node "<skill-dir>/cli.mjs" select-folder --suggest <file-basename>
     ```
     exit 0 → stdout is the chosen `<parent>/<name>` (not created yet); use it
     as `--out`. exit 1 → cancelled: stop and say so. exit 2 → no dialog
     toolkit: use the default `<workspaces-root>/<file-basename>/` (root shown
     by `node "<skill-dir>/cli.mjs" info`).
   - If the target already exists, ask (AskUserQuestion) whether to overwrite
     (`--force`) or pick another folder (re-run `select-folder`) — never
     overwrite silently.

3. **Generate.**
   ```
   node "<skill-dir>/cli.mjs" generate --workspace <file> --out <dir> [--force]
   ```
   - It warns and skips folders in the file that don't exist — relay those.
   - It creates a minimal `.idea/<repo>.iml` in any repo never opened in
     WebStorm (prints `Created <path>.iml`) — mention if it happens.

   Layout produced: `<dir>/<name>.code-workspace` (Cursor / VS Code) and
   `<dir>/Workspace/` (WebStorm project + Claude cwd — named "Workspace" so
   WebStorm's project view reads `Workspace [<name>]`).

4. **Offer to open it.** Ask (AskUserQuestion) whether to open the umbrella in
   WebStorm now. If yes:
   ```
   node "<skill-dir>/cli.mjs" open-ide "<dir>/Workspace"
   ```
   exit 2 = no launcher found; tell the user to open it via *File → Open*.

5. **Report** briefly: `<dir>/Workspace` for WebStorm / `claude`, and that the
   umbrella's own `<dir>/<name>.code-workspace` is now the file to open in
   Cursor / VS Code (so all IDEs share one definition; after adding or removing
   repos in any IDE, run `/update-workspace` to sync the others).
