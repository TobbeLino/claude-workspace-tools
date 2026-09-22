---
name: save-workspace
description: Save the repos currently attached in WebStorm (or given explicitly) as an "umbrella" workspace folder for Claude Code + WebStorm + Cursor — like Cursor's "Save Workspace As". Use when the user says /save-workspace, "save this workspace", "save these attached projects", or "make an umbrella for these repos".
---

# /save-workspace

Turn the set of repos in the current WebStorm session into an umbrella
workspace folder (CLAUDE.md + `.claude/settings.json` + `.idea/` +
`<name>.code-workspace`) using `D:\projects\claude-workspace-tools\scripts\New-ClaudeWorkspace.ps1`.

## Steps

1. **Collect the repos.**
   - If `$ARGUMENTS` contains paths, use those.
   - Otherwise call the `webstorm` MCP tool `get_repositories` (pass the cwd as
     `projectPath`). Resolve each `pathRelativeToProject` against the cwd
     (`""` = the cwd itself) to an absolute path.
   - If the MCP server isn't available and no paths were given, ask the user
     for the list of repo folders.

2. **Choose repos.** If more than one was found, use AskUserQuestion
   (multiSelect, all pre-listed with their absolute paths) so the user can drop
   anything attached ad hoc (like `pixi`). Skip the question if only one.

3. **Pick the folder with a native Save-As dialog.** Do NOT ask for the name
   in chat — pop the Windows dialog:
   ```powershell
   $dir = & D:\projects\claude-workspace-tools\scripts\Select-WorkspaceFolder.ps1 -SuggestedName <suggestion>
   ```
   - Run it with a long timeout (300000 ms) — it blocks until the user picks.
   - `<suggestion>`: a sensible default from the repo names (shared prefix like
     `stugan-pi`, else `<cwd-name>-ws`).
   - It prints the chosen `<parent>\<name>` path, or nothing if cancelled →
     stop and say the save was cancelled.
   - `-Name` is the leaf of `$dir`, `-OutDir` is `$dir`.
   - If `$dir` already exists, ask (AskUserQuestion) whether to overwrite
     (`-Force`) before proceeding — never overwrite silently.

4. **Generate.**
   ```powershell
   & D:\projects\claude-workspace-tools\scripts\New-ClaudeWorkspace.ps1 -Name <name> -Folders <p1>, <p2>, ... -OutDir <dir> [-Force]
   ```
   The script creates a minimal `.idea/<repo>.iml` inside any repo that has
   never been opened in WebStorm — mention this if it happens (it prints
   `Created <path>.iml`).

   Layout produced: `<dir>\<name>.code-workspace` (Cursor) and
   `<dir>\Workspace\` (WebStorm project + Claude cwd — named "Workspace" so
   WebStorm's project view reads `Workspace [<name>]`).

5. **Offer to open it.** Ask (AskUserQuestion) whether to open the umbrella in
   WebStorm now. If yes:
   ```powershell
   Start-Process webstorm.exe -ArgumentList "`"<dir>\Workspace`""
   ```

6. **Report.** Show the folder path and the ways to use it:
   - WebStorm: *File → Open →* `<dir>\Workspace` (all repos attached, git per repo)
   - Claude Code: `cd <dir>\Workspace; claude`
   - Cursor: `<dir>\<name>.code-workspace`
   Keep it short; don't dump the generated files.
