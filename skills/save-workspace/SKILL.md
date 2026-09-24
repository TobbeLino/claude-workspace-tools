---
name: save-workspace
description: Save the repos currently attached in WebStorm (or given explicitly) as an "umbrella" workspace folder for Claude Code + WebStorm + Cursor / VS Code — like Cursor's "Save Workspace As". Use when the user says /save-workspace, "save this workspace", "save these attached projects", or "make an umbrella for these repos".
---

# /save-workspace

Turn the set of repos in the current WebStorm session into an umbrella
workspace folder (`<name>.code-workspace` + `Workspace/` with CLAUDE.md,
`.claude/settings.json`, `.idea/`).

All tooling is one Node CLI (Node ≥ 18, no dependencies). `<skill-dir>` below is
the "Base directory for this skill" shown at the top of this prompt:

```
node "<skill-dir>/cli.mjs" <command> ...
```

## Steps

0. **Already in an umbrella?** If the cwd is an umbrella's `Workspace/` folder
   (`../<parent-name>.code-workspace` beside it), the user most likely wants to
   sync it: run the `/update-workspace` steps instead. Save a new umbrella only if
   they ask for a copy.

1. **Collect the repos.**
   - If `$ARGUMENTS` contains paths, use those.
   - Otherwise call the `webstorm` MCP tool `get_repositories` (pass the cwd as
     `projectPath`). Resolve each `pathRelativeToProject` against the cwd
     (`""` = the cwd itself) to an absolute path.
   - If the MCP server isn't available and no paths were given, ask the user
     for the list of repo folders.

2. **Choose repos.** If more than one was found, use AskUserQuestion
   (multiSelect, all pre-listed with their absolute paths) so the user can drop
   anything attached ad hoc. Skip the question if only one.

3. **Pick the folder with a native Save-As dialog.** Don't ask for the name in
   chat first — pop the dialog (it blocks; use a 300000 ms timeout):
   ```
   node "<skill-dir>/cli.mjs" select-folder --suggest <suggestion>
   ```
   - `<suggestion>`: a sensible default from the repo names (shared prefix like
     `my-app`, else `<cwd-name>-ws`).
   - exit 0 → stdout is the chosen `<parent>/<name>` (not created yet).
     `--name` is its leaf, `--out` is the full path.
   - exit 1 → cancelled: stop and say so.
   - exit 2 → no dialog toolkit on this machine (headless/SSH): fall back to
     AskUserQuestion for the name; the folder goes under the workspaces root
     shown by `node "<skill-dir>/cli.mjs" info`.
   - If the target already exists, ask (AskUserQuestion) whether to overwrite
     (`--force`) before proceeding — never overwrite silently.

4. **Generate.**
   ```
   node "<skill-dir>/cli.mjs" generate --name <name> --out <dir> [--force] --folders <p1> <p2> ...
   ```
   It creates a minimal `.idea/<repo>.iml` inside any repo that has never been
   opened in WebStorm and prints `Created <path>.iml` — mention it if it happens.

   Layout produced: `<dir>/<name>.code-workspace` (Cursor / VS Code) and
   `<dir>/Workspace/` (WebStorm project + Claude cwd — named "Workspace" so
   WebStorm's project view reads `Workspace [<name>]`).

5. **Offer to open it.** Ask (AskUserQuestion) whether to open the umbrella in
   WebStorm now. If yes:
   ```
   node "<skill-dir>/cli.mjs" open-ide "<dir>/Workspace"
   ```
   exit 2 = no launcher found; tell the user to open it via *File → Open*.

6. **Report.** Show the folder path and the ways to use it:
   - WebStorm: *File → Open →* `<dir>/Workspace` (all repos attached, git per repo)
   - Claude Code: `cd <dir>/Workspace && claude`
   - Cursor / VS Code: `<dir>/<name>.code-workspace`
   Keep it short; don't dump the generated files.
