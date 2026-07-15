param(
    [ValidateRange(1, 65535)]
    [int]$Port = 31275,

    [string]$UserHome = $HOME
)

$ErrorActionPreference = "Stop"
$humhumHome = Join-Path $UserHome ".humhum"
$hookDir = Join-Path $humhumHome "hooks"
$claudeDir = Join-Path $UserHome ".claude"
$claudeSettings = Join-Path $claudeDir "settings.json"
$sourceHook = Join-Path $PSScriptRoot "humhum-hook.ps1"
$installedHook = Join-Path $hookDir "humhum-hook.ps1"

function Write-Utf8FileAtomically {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    $nonce = [Guid]::NewGuid().ToString("N")
    $temporary = "$Path.$nonce.tmp"
    $backup = "$Path.$nonce.bak"
    try {
        [System.IO.File]::WriteAllText($temporary, $Content, (New-Object System.Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $Path) {
            [System.IO.File]::Replace($temporary, $Path, $backup)
        } else {
            [System.IO.File]::Move($temporary, $Path)
        }
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Force -Path $hookDir, $claudeDir | Out-Null
Copy-Item -LiteralPath $sourceHook -Destination $installedHook -Force

if (Test-Path -LiteralPath $claudeSettings) {
    try {
        $settings = Get-Content -LiteralPath $claudeSettings -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "Claude Code settings are not valid JSON: $claudeSettings"
    }
} else {
    $settings = [pscustomobject]@{}
}

if ($settings -isnot [pscustomobject]) {
    throw "Claude Code settings root must be a JSON object: $claudeSettings"
}
$hooksProperty = $settings.PSObject.Properties["hooks"]
if ($null -eq $hooksProperty) {
    $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
} elseif ($hooksProperty.Value -isnot [pscustomobject]) {
    throw "Claude Code hooks must be a JSON object: $claudeSettings"
}

function Test-HumHumHookEntry {
    param([object]$HookEntry)

    if ($null -eq $HookEntry) {
        return $false
    }

    foreach ($propertyName in @("command", "commandWindows")) {
        $property = $HookEntry.PSObject.Properties[$propertyName]
        if ($null -ne $property -and $null -ne $property.Value) {
            $commandValue = [string]$property.Value
            if ($commandValue.IndexOf("humhum-hook", [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }
    }

    return $false
}

function Remove-HumHumHookEntries {
    param([object[]]$Groups)

    $cleanedGroups = @()
    foreach ($group in @($Groups)) {
        if ($null -eq $group) {
            continue
        }

        $hooksProperty = $group.PSObject.Properties["hooks"]
        if ($null -eq $hooksProperty) {
            $cleanedGroups += $group
            continue
        }

        $remainingHooks = @(
            $hooksProperty.Value | Where-Object { -not (Test-HumHumHookEntry $_) }
        )
        if ($remainingHooks.Count -gt 0) {
            $hooksProperty.Value = $remainingHooks
            $cleanedGroups += $group
        }
    }

    return $cleanedGroups
}

# Remove entries emitted by older HumHum versions from every event before
# adding the current supported set, while preserving third-party handlers,
# including handlers in the same matcher group.
foreach ($eventProperty in @($settings.hooks.PSObject.Properties)) {
    $remaining = @(Remove-HumHumHookEntries -Groups @($eventProperty.Value))
    if ($remaining.Count -eq 0) {
        $settings.hooks.PSObject.Properties.Remove($eventProperty.Name)
    } else {
        $eventProperty.Value = $remaining
    }
}

$command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installedHook`" -Port $Port -Client `"claude-code`""
$events = @(
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Stop",
    "TaskCompleted",
    "SubagentStart",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
    "PreCompact"
)

foreach ($eventName in $events) {
    $hook = [ordered]@{
        type = "command"
        command = $command
    }
    if ($eventName -eq "PermissionRequest") {
        # Claude Code expresses command-hook timeouts in seconds.
        $hook["timeout"] = 130
    }
    $hookDefinition = [pscustomobject]@{
        matcher = "*"
        hooks = @([pscustomobject]$hook)
    }

    $eventProperty = $settings.hooks.PSObject.Properties[$eventName]
    $existingGroups = if ($null -eq $eventProperty) {
        @()
    } else {
        @($eventProperty.Value)
    }
    $mergedGroups = @(Remove-HumHumHookEntries -Groups $existingGroups)
    $mergedGroups += $hookDefinition

    if ($null -eq $eventProperty) {
        $settings.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue $mergedGroups
    } else {
        $eventProperty.Value = $mergedGroups
    }
}

$json = $settings | ConvertTo-Json -Depth 20
Write-Utf8FileAtomically -Path $claudeSettings -Content $json
Write-Host "HumHum hooks installed for Claude Code at $claudeSettings"
