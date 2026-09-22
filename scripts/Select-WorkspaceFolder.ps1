<#
.SYNOPSIS
  Show a native Windows "Save As" dialog and print the chosen umbrella folder path.

.DESCRIPTION
  Used by the /save-workspace Claude Code skill. The user navigates to a parent
  folder and types a workspace name; the script prints "<parent>\<name>" (the
  folder is NOT created here). Prints nothing and exits 1 if cancelled.

.EXAMPLE
  $dir = & .\Select-WorkspaceFolder.ps1 -SuggestedName stugan-pi
#>
param(
    [string] $SuggestedName = 'my-workspace',
    [string] $InitialDirectory = 'D:\projects\Workspaces'
)

Add-Type -AssemblyName System.Windows.Forms

# A topmost dummy owner so the dialog appears in front of the terminal/IDE.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()

$dlg = New-Object System.Windows.Forms.SaveFileDialog
$dlg.Title            = 'Save workspace as — a folder with this name will be created'
$dlg.InitialDirectory = $InitialDirectory
$dlg.FileName         = $SuggestedName
$dlg.Filter           = 'Workspace folder|*.'
$dlg.DefaultExt       = ''
$dlg.AddExtension     = $false
$dlg.OverwritePrompt  = $false
$dlg.CheckPathExists  = $true

$result = $dlg.ShowDialog($owner)
$owner.Close()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }

# The dialog may append the filter extension; strip any trailing "." or ext.
$path = $dlg.FileName -replace '\.$', ''
Write-Output $path
