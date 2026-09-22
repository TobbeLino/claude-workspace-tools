---
name: import-workspace
description: Import a Cursor / VS Code *.code-workspace file and create a WebStorm + Claude Code "umbrella" folder from it. Use when the user says /import-workspace, "import this workspace", "convert this code-workspace", or "open this Cursor workspace in WebStorm".
---

# /import-workspace

Turn a `*.code-workspace` file into an umbrella workspace folder (CLAUDE.md +
`.claude/settings.json` + `.idea/` + a copy of the `.code-workspace`) using
`D:\projects\claude-workspace-tools\scripts\New-ClaudeWorkspace.ps1`.

## Steps

1. **Pick the file.**
   - If `$ARGUMENTS` is a path to a `.code-workspace` file, use it.
   - Otherwise pop the native Open dialog (blocks until chosen; use a
     300000 ms timeout):
     ```powershell
     $file = & D:\projects\claude-workspace-tools\scripts\Select-WorkspaceFile.ps1
     ```
     Empty output = cancelled → stop and say so.

2. **Decide the target folder.** Default is
   `D:\projects\Workspaces\<file-basename>\`.
   - If the chosen file already lives *inside* an umbrella folder
     (`<dir>\<dir-name>.code-workspace` with `<dir>\Workspace\.claude\settings.json`
     beside it), this is a **refresh**: target = that folder, use `-Force`
     without asking.
   - Otherwise, if the default target already exists, ask (AskUserQuestion)
     whether to overwrite (`-Force`) or pick another name — never overwrite
     silently.

3. **Generate.**
   ```powershell
   & D:\projects\claude-workspace-tools\scripts\New-ClaudeWorkspace.ps1 -Workspace <file> -OutDir <dir> [-Force]
   ```
   - It warns and skips folders in the file that don't exist — relay those.
   - It creates a minimal `.idea/<repo>.iml` in any repo never opened in
     WebStorm (prints `Created <path>.iml`) — mention if it happens.

   Layout produced: `<dir>\<name>.code-workspace` (Cursor) and
   `<dir>\Workspace\` (WebStorm project + Claude cwd — named "Workspace" so
   WebStorm's project view reads `Workspace [<name>]`).

4. **Offer to open it.** Ask (AskUserQuestion) whether to open the umbrella in
   WebStorm now. If yes:
   ```powershell
   Start-Process webstorm.exe -ArgumentList "`"<dir>\Workspace`""
   ```

5. **Report** briefly: `<dir>\Workspace` for WebStorm / `claude`, and that the
   umbrella's own `<dir>\<name>.code-workspace` is now the file to open in
   Cursor (so both IDEs share one definition; re-run `/import-workspace` on it
   to refresh WebStorm after editing).
