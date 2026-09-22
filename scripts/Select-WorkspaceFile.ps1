<#
.SYNOPSIS
  Show a native Windows "Open" dialog for a *.code-workspace file and print its path.

.DESCRIPTION
  Used by the /import-workspace Claude Code skill. Prints the chosen file path,
  or nothing (exit 1) if cancelled.

.EXAMPLE
  $file = & .\Select-WorkspaceFile.ps1
#>
param(
    [string] $InitialDirectory = 'D:\projects'
)

Add-Type -AssemblyName System.Windows.Forms

# A topmost dummy owner so the dialog appears in front of the terminal/IDE.
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()

$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title            = 'Import Cursor / VS Code workspace'
$dlg.InitialDirectory = $InitialDirectory
$dlg.Filter           = 'Workspace files (*.code-workspace)|*.code-workspace|All files (*.*)|*.*'
$dlg.CheckFileExists  = $true
$dlg.Multiselect      = $false

$result = $dlg.ShowDialog($owner)
$owner.Close()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
Write-Output $dlg.FileName
