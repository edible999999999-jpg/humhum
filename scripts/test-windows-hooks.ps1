$ErrorActionPreference = "Stop"
$fixtureHome = Join-Path ([System.IO.Path]::GetTempPath()) "humhum-hooks-$([Guid]::NewGuid().ToString('N'))"
$settingsPath = Join-Path (Join-Path $fixtureHome ".claude") "settings.json"
$installScript = Join-Path (Split-Path -Parent $PSScriptRoot) "hooks\install.ps1"
$uninstallScript = Join-Path (Split-Path -Parent $PSScriptRoot) "hooks\uninstall.ps1"
$windowsHookScript = Join-Path (Split-Path -Parent $PSScriptRoot) "hooks\humhum-hook.ps1"
$unixHookScript = Join-Path (Split-Path -Parent $PSScriptRoot) "hooks\humhum-hook.sh"
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-FixtureSettings {
    Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-EventCommands {
    param(
        [object]$Settings,
        [string]$EventName
    )

    $commands = @()
    $eventProperty = $Settings.hooks.PSObject.Properties[$EventName]
    if ($null -eq $eventProperty) {
        return $commands
    }

    foreach ($group in @($eventProperty.Value)) {
        if ($null -eq $group) {
            continue
        }
        $hooksProperty = $group.PSObject.Properties["hooks"]
        if ($null -eq $hooksProperty) {
            continue
        }
        foreach ($hook in @($hooksProperty.Value)) {
            if ($null -eq $hook) {
                continue
            }
            $commandProperty = $hook.PSObject.Properties["command"]
            if ($null -ne $commandProperty -and $null -ne $commandProperty.Value) {
                $commands += [string]$commandProperty.Value
            }
        }
    }

    return $commands
}

function Assert-Count {
    param(
        [object[]]$Values,
        [int]$Expected,
        [string]$Message
    )

    if (@($Values).Count -ne $Expected) {
        throw "$Message (expected $Expected, got $(@($Values).Count))"
    }
}

function Test-HookDelivery {
    $deliveryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "humhum-hook-delivery-$([Guid]::NewGuid().ToString('N'))"
    $readyPath = Join-Path $deliveryRoot "ready.txt"
    $capturePath = Join-Path $deliveryRoot "capture.json"
    $tokenPath = Join-Path $deliveryRoot "local-api-token"
    New-Item -ItemType Directory -Force -Path $deliveryRoot | Out-Null
    [System.IO.File]::WriteAllText($tokenPath, "e2e-token`n", $utf8)

    $server = Start-Job -ArgumentList $readyPath, $capturePath -ScriptBlock {
        param([string]$ReadyPath, [string]$CapturePath)
        $ErrorActionPreference = "Stop"
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
        [System.IO.File]::WriteAllText($ReadyPath, [string]$port, [System.Text.Encoding]::ASCII)
        $client = $null
        try {
            $client = $listener.AcceptTcpClient()
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new(
                $stream,
                [System.Text.Encoding]::UTF8,
                $false,
                1024,
                $true
            )
            $requestLine = $reader.ReadLine()
            $headers = @{}
            while ($true) {
                $line = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($line)) { break }
                $separator = $line.IndexOf(":")
                if ($separator -gt 0) {
                    $headers[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim()
                }
            }
            $contentLength = [int]$headers["Content-Length"]
            $buffer = New-Object char[] $contentLength
            $offset = 0
            while ($offset -lt $contentLength) {
                $read = $reader.Read($buffer, $offset, $contentLength - $offset)
                if ($read -le 0) { throw "Hook request body ended early" }
                $offset += $read
            }
            $body = -join $buffer
            [System.IO.File]::WriteAllText(
                $CapturePath,
                ([ordered]@{
                    request_line = $requestLine
                    token = $headers["X-HumHum-Token"]
                    body = $body
                } | ConvertTo-Json -Compress),
                (New-Object System.Text.UTF8Encoding($false))
            )

            $responseBody = '{"decision":{"behavior":"allow"}}'
            $responseBytes = [System.Text.Encoding]::UTF8.GetBytes($responseBody)
            $responseHead = [System.Text.Encoding]::ASCII.GetBytes(
                "HTTP/1.1 200 OK`r`nContent-Type: application/json`r`nContent-Length: $($responseBytes.Length)`r`nConnection: close`r`n`r`n"
            )
            $stream.Write($responseHead, 0, $responseHead.Length)
            $stream.Write($responseBytes, 0, $responseBytes.Length)
            $stream.Flush()
            $reader.Dispose()
        } finally {
            if ($null -ne $client) { $client.Dispose() }
            $listener.Stop()
        }
    }

    $previousTokenFile = $env:HUMHUM_TOKEN_FILE
    $previousHttpProxy = $env:HTTP_PROXY
    $previousHttpsProxy = $env:HTTPS_PROXY
    $previousNoProxy = $env:NO_PROXY
    try {
        for ($attempt = 0; $attempt -lt 100 -and -not (Test-Path -LiteralPath $readyPath); $attempt++) {
            Start-Sleep -Milliseconds 50
        }
        if (-not (Test-Path -LiteralPath $readyPath)) {
            throw "Hook delivery test server did not start"
        }
        $port = [int]([System.IO.File]::ReadAllText($readyPath))
        $env:HUMHUM_TOKEN_FILE = $tokenPath
        $env:HTTP_PROXY = "http://127.0.0.1:9"
        $env:HTTPS_PROXY = "http://127.0.0.1:9"
        $env:NO_PROXY = ""
        $payload = '{"hook_event_name":"PermissionRequest","session_id":"e2e-session","tool_name":"Read"}'
        $powerShellExecutable = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        $hookArguments = @(
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            $windowsHookScript,
            "-Client",
            "claude code",
            "-Port",
            [string]$port
        )
        $output = @($payload | & $powerShellExecutable @hookArguments)
        if ($LASTEXITCODE -ne 0) {
            throw "Windows hook delivery exited with $LASTEXITCODE"
        }
        $completed = Wait-Job -Job $server -Timeout 10
        if ($null -eq $completed) {
            throw "Hook delivery test server did not receive a request"
        }
        Receive-Job -Job $server -ErrorAction Stop | Out-Null
        if ((@($output) -join "`n").Trim() -ne '{"decision":{"behavior":"allow"}}') {
            throw "Windows hook did not return the blocking permission response"
        }
        $capture = [System.IO.File]::ReadAllText($capturePath) | ConvertFrom-Json
        if ($capture.request_line -ne "POST /event?client=claude%20code HTTP/1.1") {
            throw "Windows hook sent an unexpected request target: $($capture.request_line)"
        }
        if ($capture.token -ne "e2e-token") {
            throw "Windows hook sent an unexpected authentication token"
        }
        $delivered = $capture.body | ConvertFrom-Json
        if ($delivered.hook_event_name -ne "PermissionRequest" -or
            $delivered.session_id -ne "e2e-session" -or
            $delivered.tool_name -ne "Read") {
            throw "Windows hook changed required event fields during delivery"
        }
    } finally {
        $env:HUMHUM_TOKEN_FILE = $previousTokenFile
        $env:HTTP_PROXY = $previousHttpProxy
        $env:HTTPS_PROXY = $previousHttpsProxy
        $env:NO_PROXY = $previousNoProxy
        Stop-Job -Job $server -ErrorAction SilentlyContinue
        Remove-Job -Job $server -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $deliveryRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

try {
    $windowsHookSource = [System.IO.File]::ReadAllText($windowsHookScript)
    if ($windowsHookSource -notmatch '\$handler\.UseProxy\s*=\s*\$false') {
        throw "Windows hook does not explicitly disable HTTP proxies"
    }
    if ($windowsHookSource -notmatch '\.DefaultRequestHeaders\.ExpectContinue\s*=\s*\$false') {
        throw "Windows hook does not disable HTTP 100-Continue waiting"
    }
    $unixHookSource = [System.IO.File]::ReadAllText($unixHookScript)
    if (-not $unixHookSource.Contains('--noproxy "*"')) {
        throw "Unix hook does not explicitly disable HTTP proxies"
    }
    Test-HookDelivery

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsPath) | Out-Null
    $fixture = [ordered]@{
        theme = "keep-me"
        hooks = [ordered]@{
            PermissionRequest = @(
                [ordered]@{
                    matcher = "*"
                    hooks = @(
                        [ordered]@{ type = "command"; command = "third-party permission one" },
                        [ordered]@{ type = "command"; command = "old humhum-hook.ps1" }
                    )
                },
                [ordered]@{
                    matcher = "other"
                    hooks = @(
                        [ordered]@{ type = "command"; command = "third-party permission two" }
                    )
                }
            )
            Stop = @(
                [ordered]@{
                    matcher = "*"
                    hooks = @(
                        [ordered]@{ type = "command"; command = "third-party stop" }
                    )
                }
            )
            Notification = @()
            TaskCompleted = @(
                [ordered]@{
                    matcher = "*"
                    hooks = @(
                        [ordered]@{ type = "command"; command = "legacy humhum-hook.ps1" },
                        [ordered]@{ type = "command"; command = "third-party legacy completion" }
                    )
                }
            )
        }
    }
    [System.IO.File]::WriteAllText(
        $settingsPath,
        ($fixture | ConvertTo-Json -Depth 20),
        $utf8
    )

    & $installScript -Port 34567 -UserHome $fixtureHome | Out-Null
    & $installScript -Port 34567 -UserHome $fixtureHome | Out-Null

    $installed = Read-FixtureSettings
    if ($installed.theme -ne "keep-me") {
        throw "Install changed unrelated Claude settings"
    }
    $expectedEvents = @(
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
    foreach ($eventName in $expectedEvents) {
        $humhumCommands = @(
            Get-EventCommands $installed $eventName |
                Where-Object { $_ -match "humhum-hook" }
        )
        Assert-Count $humhumCommands 1 "Install is not idempotent for $eventName"
    }
    Assert-Count @(
        Get-EventCommands $installed "PermissionRequest" |
            Where-Object { $_ -match "^third-party permission" }
    ) 2 "Install removed a third-party hook from a mixed matcher group"
    Assert-Count @(
        Get-EventCommands $installed "Stop" |
            Where-Object { $_ -eq "third-party stop" }
    ) 1 "Install removed a third-party Stop hook"
    Assert-Count @(
        Get-EventCommands $installed "TaskCompleted" |
            Where-Object { $_ -match "humhum-hook" }
    ) 1 "Install did not replace the legacy TaskCompleted HumHum hook"
    Assert-Count @(
        Get-EventCommands $installed "TaskCompleted" |
            Where-Object { $_ -eq "third-party legacy completion" }
    ) 1 "Install removed a third-party legacy event hook"

    & $uninstallScript -UserHome $fixtureHome | Out-Null

    $uninstalled = Read-FixtureSettings
    if ($uninstalled.theme -ne "keep-me") {
        throw "Uninstall changed unrelated Claude settings"
    }
    $remainingHumHum = @(
        foreach ($eventProperty in @($uninstalled.hooks.PSObject.Properties)) {
            Get-EventCommands $uninstalled $eventProperty.Name |
                Where-Object { $_ -match "humhum-hook" }
        }
    )
    Assert-Count $remainingHumHum 0 "Uninstall left a HumHum hook behind"
    Assert-Count @(
        Get-EventCommands $uninstalled "PermissionRequest" |
            Where-Object { $_ -match "^third-party permission" }
    ) 2 "Uninstall removed a third-party hook from a mixed matcher group"
    Assert-Count @(
        Get-EventCommands $uninstalled "Stop" |
            Where-Object { $_ -eq "third-party stop" }
    ) 1 "Uninstall removed a third-party Stop hook"
    Assert-Count @(
        Get-EventCommands $uninstalled "TaskCompleted" |
            Where-Object { $_ -eq "third-party legacy completion" }
    ) 1 "Uninstall removed a third-party legacy event hook"

    foreach ($invalidSettings in @(
        '{"theme":"keep-me","hooks":[]}',
        '{"theme":"keep-me","hooks":null}'
    )) {
        [System.IO.File]::WriteAllText($settingsPath, $invalidSettings, $utf8)
        $rejectedInvalidHooks = $false
        try {
            & $installScript -Port 34567 -UserHome $fixtureHome | Out-Null
        } catch {
            $rejectedInvalidHooks = $true
        }
        if (-not $rejectedInvalidHooks) {
            throw "Install accepted a non-object hooks value: $invalidSettings"
        }
        if ([System.IO.File]::ReadAllText($settingsPath) -ne $invalidSettings) {
            throw "Install modified settings after rejecting a non-object hooks value"
        }
    }

    Write-Host "Windows hook merge smoke test passed"
} finally {
    Remove-Item -LiteralPath $fixtureHome -Recurse -Force -ErrorAction SilentlyContinue
}
