param(
    [string]$UserHome = $HOME
)

$ErrorActionPreference = "Stop"
$claudeSettings = Join-Path (Join-Path $UserHome ".claude") "settings.json"

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
        [System.IO.File]::Replace($temporary, $Path, $backup)
    } finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $claudeSettings)) {
    Write-Host "No Claude Code settings found at $claudeSettings"
    exit 0
}

$settings = Get-Content -LiteralPath $claudeSettings -Raw -Encoding UTF8 | ConvertFrom-Json
if ($settings -isnot [pscustomobject]) {
    throw "Claude Code settings root must be a JSON object: $claudeSettings"
}
$hooksProperty = $settings.PSObject.Properties["hooks"]
if ($null -ne $hooksProperty -and $hooksProperty.Value -isnot [pscustomobject]) {
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

if ($null -ne $settings.hooks) {
    foreach ($eventProperty in @($settings.hooks.PSObject.Properties)) {
        $remaining = @(
            Remove-HumHumHookEntries -Groups @($eventProperty.Value)
        )
        if ($remaining.Count -eq 0) {
            $settings.hooks.PSObject.Properties.Remove($eventProperty.Name)
        } else {
            $eventProperty.Value = $remaining
        }
    }
}

$json = $settings | ConvertTo-Json -Depth 20
Write-Utf8FileAtomically -Path $claudeSettings -Content $json
Write-Host "HumHum hooks removed from Claude Code settings"
