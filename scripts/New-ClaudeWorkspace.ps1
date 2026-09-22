<#
.SYNOPSIS
  Create an "umbrella" workspace folder for Claude Code + WebStorm (+ Cursor).

.DESCRIPTION
  Claude Code has no workspace-file concept, but it does have additional
  directories (permissions.additionalDirectories). WebStorm has "attached
  projects" (.idea/modules.xml). This script creates a folder containing only
  configuration that references a set of repos:
    CLAUDE.md, .claude/settings.json      -> Claude Code
    .idea/*                               -> WebStorm (all repos attached)
    <name>.code-workspace                 -> Cursor / VS Code
  Open the folder in WebStorm, or launch `claude` from it, to work across all
  repos at once.

  Input is either an existing *.code-workspace file, or an explicit list of
  folders plus a name.

.EXAMPLE
  .\New-ClaudeWorkspace.ps1 -Workspace D:\projects\stugan-pi.code-workspace
  # creates D:\projects\Workspaces\stugan-pi\

.EXAMPLE
  .\New-ClaudeWorkspace.ps1 -Name stugan-pi -Folders D:\projects\stugan-pi-cam, D:\projects\stugan-pi-web

.EXAMPLE
  .\New-ClaudeWorkspace.ps1 -Workspace ..\stugan-pi.code-workspace -OutDir D:\tmp\stugan -Force
#>
[CmdletBinding(DefaultParameterSetName = 'FromFile')]
param(
    [Parameter(Mandatory, ParameterSetName = 'FromFile')]  [string]   $Workspace,
    [Parameter(Mandatory, ParameterSetName = 'FromList')]  [string]   $Name,
    [Parameter(Mandatory, ParameterSetName = 'FromList')]  [string[]] $Folders,
    [string] $OutDir,
    [string] $WorkspacesRoot = 'D:\projects\Workspaces',
    [switch] $Force
)

function New-FolderEntry([string] $p, [string] $name) {
    if (-not (Test-Path $p)) { Write-Warning "Folder not found, skipping: $p"; return $null }
    $full = (Resolve-Path $p).Path -replace '\\', '/'
    [pscustomobject]@{
        name  = if ($name) { $name } else { Split-Path $full -Leaf }
        path  = $full
        isGit = Test-Path (Join-Path $full '.git')
    }
}

$folderList = @()
if ($PSCmdlet.ParameterSetName -eq 'FromFile') {
    $Workspace = (Resolve-Path $Workspace).Path
    $wsDir     = Split-Path $Workspace -Parent
    $wsName    = [IO.Path]::GetFileNameWithoutExtension($Workspace)
    $source    = $Workspace -replace '\\', '/'

    # .code-workspace is JSONC (comments/trailing commas allowed); strip comments before parsing.
    $raw  = Get-Content $Workspace -Raw
    $raw  = [regex]::Replace($raw, '//.*?$|/\*.*?\*/', '', 'Multiline, Singleline')
    $json = $raw | ConvertFrom-Json
    foreach ($f in $json.folders) {
        $p = $f.path
        if (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path $wsDir $p }
        $folderList += New-FolderEntry $p $f.name
    }
} else {
    $wsName = $Name
    $source = 'an explicit folder list'
    foreach ($p in $Folders) { $folderList += New-FolderEntry $p $null }
}
$repos = @($folderList | Where-Object { $_ })
if (-not $repos) { throw "No usable folders from $source" }

if ($OutDir) { $wsName = Split-Path $OutDir -Leaf }   # folder name wins over file name
else         { $OutDir = Join-Path $WorkspacesRoot $wsName }
if ((Test-Path $OutDir) -and -not $Force) {
    throw "$OutDir already exists. Use -Force to overwrite the generated files."
}

# Layout:
#   <OutDir>\<name>.code-workspace   Cursor / VS Code
#   <OutDir>\Workspace\              WebStorm project + Claude Code cwd
# The inner folder is literally named "Workspace" so WebStorm's project view
# (always "<folder> [<module>]") reads "Workspace [<name>]".
$projDir  = Join-Path $OutDir 'Workspace'
New-Item -ItemType Directory -Force (Join-Path $projDir '.claude') | Out-Null
$outFull  = (Resolve-Path $OutDir).Path.TrimEnd('\') + '\'
$projFull = (Resolve-Path $projDir).Path.TrimEnd('\') + '\'

# The umbrella's own folder may appear in a re-imported .code-workspace; it is not a repo.
$repos = @($repos | Where-Object { ($_.path -replace '/', '\') + '\' -ne $projFull })
if (-not $repos) { throw "No usable folders from $source" }

# --- <name>.code-workspace (Cursor / VS Code) ---
$wsFile = Join-Path $OutDir "$wsName.code-workspace"
if ($PSCmdlet.ParameterSetName -eq 'FromFile' -and (Resolve-Path $Workspace).Path -eq $wsFile) {
    # Source file already lives in the umbrella folder; leave it alone.
} else {
    $wsJson = [ordered]@{
        folders  = @(
            [ordered]@{ name = "Workspace ($wsName)"; path = 'Workspace' }
            $repos | ForEach-Object {
                [ordered]@{ path = ([IO.Path]::GetRelativePath($outFull, $_.path) -replace '\\', '/') }
            }
        )
        settings = [ordered]@{}
    }
    $wsJson | ConvertTo-Json -Depth 5 | Set-Content $wsFile -Encoding utf8
}

# --- .claude/settings.json ---
$settings = [ordered]@{
    permissions = [ordered]@{
        additionalDirectories = @($repos.path)
    }
}
$settings | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $projDir '.claude/settings.json') -Encoding utf8

# --- CLAUDE.md ---
$rows = $repos | ForEach-Object {
    $vcs = if ($_.isGit) { 'git' } else { '-' }
    "| $($_.name) | ``$($_.path)`` | $vcs |"
}
$md = @"
# Workspace: $wsName

Umbrella project generated from $source by ``New-ClaudeWorkspace.ps1``.
This folder holds no code — it only references the repos below (via
``.claude/settings.json`` → ``permissions.additionalDirectories`` and ``.idea/``
for WebStorm; ``../$wsName.code-workspace`` is the same set for Cursor).
Treat all of them as one workspace.

| Repo | Path | VCS |
|---|---|---|
$($rows -join "`n")

## Working here
- Always state which repo a file belongs to.
- Run git per repo: ``git -C <path> ...``. Each repo has its own branch/status.
- Search across all repos (pass the paths to Glob/Grep), not just this folder.
- To change the repo set: edit ``../$wsName.code-workspace`` and run
  ``/import-workspace`` on it (or ``/save-workspace`` from WebStorm). Tooling
  lives in ``D:\projects\claude-workspace-tools``.
"@
$md | Set-Content (Join-Path $projDir 'CLAUDE.md') -Encoding utf8

# --- .idea (WebStorm project with all repos attached) ---
# "Attach project" in WebStorm = extra <module> entries in modules.xml pointing at
# each repo's own .idea/<name>.iml, plus git mappings in vcs.xml.
$ideaDir = Join-Path $projDir '.idea'
New-Item -ItemType Directory -Force $ideaDir | Out-Null
# Stale module files from a previous generation / IDE rename would otherwise linger.
Get-ChildItem (Join-Path $ideaDir '*.iml') | Remove-Item -Force

$rel = {
    param($target)   # path of $target relative to the WebStorm project dir, IntelliJ style
    $r = [IO.Path]::GetRelativePath($projFull, $target) -replace '\\', '/'
    if ([IO.Path]::IsPathRooted($r)) { $r } else { "`$PROJECT_DIR`$/$r" }   # other drive: absolute
}

$moduleXml = @()
$vcsXml    = @()
$orderXml  = @()
foreach ($f in $repos) {
    $imlPath = Join-Path $f.path ".idea/$($f.name).iml"
    $existing = Get-ChildItem (Join-Path $f.path '.idea/*.iml') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
        $imlPath = $existing.FullName
    } elseif (-not (Test-Path $imlPath)) {
        # Repo has never been opened in WebStorm: create the same minimal module it would.
        New-Item -ItemType Directory -Force (Join-Path $f.path '.idea') | Out-Null
        @"
<?xml version="1.0" encoding="UTF-8"?>
<module type="WEB_MODULE" version="4">
  <component name="NewModuleRootManager">
    <content url="file://`$MODULE_DIR`$">
      <excludeFolder url="file://`$MODULE_DIR`$/.tmp" />
      <excludeFolder url="file://`$MODULE_DIR`$/temp" />
      <excludeFolder url="file://`$MODULE_DIR`$/tmp" />
    </content>
    <orderEntry type="inheritedJdk" />
    <orderEntry type="sourceFolder" forTests="false" />
  </component>
</module>
"@ | Set-Content $imlPath -Encoding utf8
        Write-Host "Created $imlPath"
    }
    $imlRel = & $rel $imlPath
    $moduleXml += "      <module fileurl=`"file://$imlRel`" filepath=`"$imlRel`" />"
    $orderXml  += "    <orderEntry type=`"module`" module-name=`"$([IO.Path]::GetFileNameWithoutExtension($imlPath))`" />"
    if ($f.isGit) {
        $vcsXml += "    <mapping directory=`"$(& $rel $f.path)`" vcs=`"Git`" />"
    }
}

$umbrellaIml = "$wsName.iml"
@"
<?xml version="1.0" encoding="UTF-8"?>
<module type="WEB_MODULE" version="4">
  <component name="NewModuleRootManager">
    <content url="file://`$MODULE_DIR`$" />
    <orderEntry type="inheritedJdk" />
    <orderEntry type="sourceFolder" forTests="false" />
$($orderXml -join "`n")
  </component>
</module>
"@ | Set-Content (Join-Path $ideaDir $umbrellaIml) -Encoding utf8

@"
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectModuleManager">
    <modules>
      <module fileurl="file://`$PROJECT_DIR`$/.idea/$umbrellaIml" filepath="`$PROJECT_DIR`$/.idea/$umbrellaIml" />
$($moduleXml -join "`n")
    </modules>
  </component>
</project>
"@ | Set-Content (Join-Path $ideaDir 'modules.xml') -Encoding utf8

@"
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="VcsDirectoryMappings">
$($vcsXml -join "`n")
  </component>
</project>
"@ | Set-Content (Join-Path $ideaDir 'vcs.xml') -Encoding utf8

@"
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectRootManager">
    <output url="file://`$PROJECT_DIR`$/out" />
  </component>
</project>
"@ | Set-Content (Join-Path $ideaDir 'misc.xml') -Encoding utf8

"# WebStorm user-specific state`nworkspace.xml`nshelf/`n" | Set-Content (Join-Path $ideaDir '.gitignore') -Encoding utf8

# Window title / project name (the folder is "Workspace", so without this every umbrella would be titled the same).
$wsName | Set-Content (Join-Path $ideaDir '.name') -Encoding utf8 -NoNewline

Write-Host "Created $OutDir with $($repos.Count) repos:"
$repos | ForEach-Object { Write-Host "  - $($_.path)" }
Write-Host "`nClaude Code:  cd `"$projDir`"; claude"
Write-Host "WebStorm:     File > Open > $projDir   (all repos attached)"
Write-Host "Cursor:       $wsFile"
