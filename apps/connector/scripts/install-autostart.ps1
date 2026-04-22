$StartupPath = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupPath "Codex Relay Connector.lnk"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PnpmCommand = "pnpm --filter @codex-relay/connector start"

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -WindowStyle Minimized -Command `"Set-Location '$ProjectRoot'; $PnpmCommand`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Save()

Write-Host "Autostart shortcut created at $ShortcutPath"
