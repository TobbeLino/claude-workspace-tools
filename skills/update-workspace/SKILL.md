---
name: update-workspace
description: Sync an existing umbrella workspace after repos were added or removed in WebStorm, Cursor / VS Code or with /add-dir — merges the three repo lists, regenerates CLAUDE.md, .claude/settings.json, .idea/ and the .code-workspace, and re-scans the repos for agent rule files. Use when the user says /update-workspace, "update this workspace", "sync the umbrella", "I added a repo to the workspace", or a session-start message says an umbrella is out of sync.
---

# /update-workspace

An umbrella keeps its repo list in three places, and each IDE edits only its own:

| List | Edited by |
|---|---|
| `Workspace/.idea/modules.xml` | WebStorm attach / detach |
| `<name>.code-workspace` `folders` | Cursor / VS Code "Add Folder to Workspace" |
| `Workspace/.claude/settings.json` + `settings.local.json` `additionalDirectories` | `/add-dir` |

This skill diffs each list against the snapshot the last generate wrote
(`Workspace/.claude/workspace-tools.json`): a repo gone from a list was removed
there, a repo new in a list was added there. Then it writes the result to all
three. It reads the files directly, so it works the same from WebStorm, VS Code
or a plain terminal, and it needs no WebStorm MCP.

All tooling is one Node CLI (Node ≥ 18, no dependencies). `<skill-dir>` below is
the "Base directory for this skill" shown at the top of this prompt:

```
node "<skill-dir>/cli.mjs" <command> ...
```

## Steps

1. **Find the umbrella.** Use `$ARGUMENTS` if it is a path, else the cwd. The CLI
   walks up to the folder holding `<name>.code-workspace` and `Workspace/`.

2. **Preview.**
   ```
   node "<skill-dir>/cli.mjs" update [--dir <path>] --dry-run
   ```
   - It prints the changes per list (`+` added / `-` removed, and in which list),
     agent doc changes, and the repo set after the update.
   - "In sync." with no agent doc changes → tell the user and stop.
   - Exits non-zero with "No umbrella at or above ..." → not in an umbrella: say
     so and point to `/save-workspace` or `/import-workspace`.
   - "No snapshot yet (older umbrella)" → the baseline is the repo table in the
     umbrella's CLAUDE.md. Mention it; the result is the same kind of merge.

3. **Confirm the changes.** Only the `+`/`-` repos are in question; unchanged
   repos stay. Skip this step when there are only agent doc changes.
   - Up to 4 changes: AskUserQuestion (multiSelect), one option per change
     labelled with the repo name and what applying it does ("add X — new in
     Cursor / VS Code", "remove Y — detached in WebStorm"). Recommend applying all.
   - More than 4: list them in chat and ask (AskUserQuestion) "Apply all" or
     "Pick in chat".
   - A change the user rejects is reverted: a rejected `+` repo leaves the set, a
     rejected `-` repo stays in it.
   Repos marked "not found on disk" are skipped by the generator: say so.

4. **Apply.** If the user applied every change:
   ```
   node "<skill-dir>/cli.mjs" update [--dir <path>]
   ```
   If they changed it, pass the final set explicitly:
   ```
   node "<skill-dir>/cli.mjs" update [--dir <path>] --folders <p1> <p2> ...
   ```
   It keeps the `.code-workspace` settings, custom folder names and the
   import / list choice for agent docs, clears `additionalDirectories` from
   `settings.local.json` (settings.json now holds the full list), and writes a new
   snapshot. It prints `Created <path>.iml` for repos never opened in WebStorm —
   mention it if it happens.

5. **Report** briefly: repos added and removed, agent doc changes, and:
   - WebStorm: if the umbrella is open, it reloads the changed `.idea` files. If it
     asks, choose reload, not "keep in-memory".
   - Claude Code: a running session keeps the old `additionalDirectories` until it
     restarts. If this session runs inside the umbrella, suggest a restart, or
     `/add-dir` for each added repo to use them now.
   - Cursor / VS Code picks up the `.code-workspace` change on its own.
