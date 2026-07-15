param(
    [string]$Client = "",

    [ValidateRange(1, 65535)]
    [int]$Port = 31275,

    [Alias("event")]
    [string]$EventName = ""
)

# HumHum hook bridge for Windows PowerShell 5.1+.
# The only stdout produced is a blocking permission response expected by the
# calling Agent. Diagnostics are written to the user's temporary directory.
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$debugLog = Join-Path ([System.IO.Path]::GetTempPath()) "humhum-hook-debug.log"
$tokenFile = if ($env:HUMHUM_TOKEN_FILE) {
    $env:HUMHUM_TOKEN_FILE
} else {
    Join-Path (Join-Path $HOME ".humhum") "local-api-token"
}

function Write-HumHumDebug {
    param([string]$Message)
    try {
        Add-Content -LiteralPath $debugLog -Value "[$(Get-Date -Format 'HH:mm:ss')] $Message" -Encoding UTF8
    } catch {
        # Hook delivery must never fail because diagnostic logging is unavailable.
    }
}

$payload = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($payload)) {
    [Console]::Error.WriteLine("Error: No payload received on stdin")
    exit 1
}

if (-not (Test-Path -LiteralPath $tokenFile)) {
    Write-HumHumDebug "Hook token is missing: $tokenFile"
    [Console]::Error.WriteLine("Warning: Start HumHum once before using its hooks")
    exit 0
}
$token = (Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-HumHumDebug "Hook token file is empty"
    exit 0
}

$hookEvent = "unknown"
try {
    $parsedPayload = $payload | ConvertFrom-Json

    if ($null -eq $parsedPayload.PSObject.Properties["hook_event_name"] -and
        -not [string]::IsNullOrWhiteSpace($EventName)) {
        $parsedPayload | Add-Member -NotePropertyName hook_event_name -NotePropertyValue $EventName
    }

    foreach ($mapping in @(
        @("sessionId", "session_id"),
        @("conversation_id", "session_id"),
        @("conversationId", "session_id"),
        @("task_id", "session_id"),
        @("generation_id", "session_id"),
        @("toolName", "tool_name"),
        @("toolArgs", "tool_input")
    )) {
        $sourceProperty = $parsedPayload.PSObject.Properties[$mapping[0]]
        $targetProperty = $parsedPayload.PSObject.Properties[$mapping[1]]
        if ($null -eq $targetProperty -and $null -ne $sourceProperty) {
            $parsedPayload | Add-Member -NotePropertyName $mapping[1] -NotePropertyValue $sourceProperty.Value
        }
    }

    if ($null -eq $parsedPayload.PSObject.Properties["cwd"]) {
        $rootsProperty = $parsedPayload.PSObject.Properties["workspace_roots"]
        if ($null -eq $rootsProperty) {
            $rootsProperty = $parsedPayload.PSObject.Properties["workspaceRoots"]
        }
        if ($null -ne $rootsProperty -and @($rootsProperty.Value).Count -gt 0) {
            $parsedPayload | Add-Member -NotePropertyName cwd -NotePropertyValue ([string]@($rootsProperty.Value)[0])
        }
    }

    $routeProperty = $parsedPayload.PSObject.Properties["route"]
    $route = if ($null -ne $routeProperty -and $routeProperty.Value -is [pscustomobject]) {
        $routeProperty.Value
    } else {
        [pscustomobject]@{}
    }
    if ($null -eq $route.PSObject.Properties["parent_pid"]) {
        try {
            $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop
            if ($null -ne $parentProcess.ParentProcessId) {
                $route | Add-Member -NotePropertyName parent_pid -NotePropertyValue ([int]$parentProcess.ParentProcessId)
            }
        } catch {
            Write-HumHumDebug "Could not inspect parent process: $($_.Exception.Message)"
        }
    }
    if ($null -eq $route.PSObject.Properties["term_program"]) {
        $termProgram = if (-not [string]::IsNullOrWhiteSpace($env:TERM_PROGRAM)) {
            $env:TERM_PROGRAM
        } elseif (-not [string]::IsNullOrWhiteSpace($env:WT_SESSION)) {
            "Windows Terminal"
        } else {
            ""
        }
        if (-not [string]::IsNullOrWhiteSpace($termProgram)) {
            $route | Add-Member -NotePropertyName term_program -NotePropertyValue $termProgram
        }
    }
    if ($route.PSObject.Properties.Count -gt 0) {
        if ($null -eq $routeProperty) {
            $parsedPayload | Add-Member -NotePropertyName route -NotePropertyValue $route
        } else {
            $routeProperty.Value = $route
        }
    }

    if ($null -ne $parsedPayload.hook_event_name) {
        $hookEvent = [string]$parsedPayload.hook_event_name
    }
    $payload = $parsedPayload | ConvertTo-Json -Depth 30 -Compress
} catch {
    Write-HumHumDebug "Could not normalize hook payload: $($_.Exception.Message)"
}

$url = "http://127.0.0.1:$Port/event"
if (-not [string]::IsNullOrWhiteSpace($Client)) {
    $url += "?client=$([System.Uri]::EscapeDataString($Client))"
}

Write-HumHumDebug "=== Hook invoked: $hookEvent ==="
Write-HumHumDebug "Client: $Client"
Write-HumHumDebug "Endpoint: $url"

$http = $null
$handler = $null
$content = $null
$response = $null
try {
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object System.Net.Http.HttpClientHandler
    # This endpoint is always loopback. Never expose the bearer token or hook
    # payload to a user-configured HTTP proxy.
    $handler.UseProxy = $false
    $http = New-Object System.Net.Http.HttpClient -ArgumentList (,$handler)
    # The server waits up to 120 seconds. Leave five seconds for its timeout
    # response while staying below the 130-second client hook deadline.
    $http.Timeout = [TimeSpan]::FromSeconds(125)
    $http.DefaultRequestHeaders.Add("X-HumHum-Token", $token)
    $content = New-Object System.Net.Http.StringContent(
        $payload,
        [System.Text.Encoding]::UTF8,
        "application/json"
    )
    $response = $http.PostAsync($url, $content).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $statusCode = [int]$response.StatusCode

    Write-HumHumDebug "HTTP_CODE=$statusCode"
    if ($statusCode -eq 200 -and $hookEvent -eq "PermissionRequest" -and
        -not [string]::IsNullOrWhiteSpace($body)) {
        Write-HumHumDebug "Writing blocking hook response to stdout"
        [Console]::Out.WriteLine($body)
    } elseif ($statusCode -eq 504) {
        [Console]::Error.WriteLine("Warning: HumHum confirmation timed out")
    } elseif ($statusCode -ne 200 -and $statusCode -ne 204) {
        [Console]::Error.WriteLine("Warning: HumHum returned HTTP $statusCode")
    }
} catch {
    Write-HumHumDebug "Request failed: $($_.Exception.Message)"
    if ($hookEvent -eq "PermissionRequest") {
        [Console]::Error.WriteLine("Warning: HumHum is not running; handle this permission manually")
    }
    # Agent hooks should not block the client when HumHum is closed.
    exit 0
} finally {
    if ($null -ne $response) { $response.Dispose() }
    if ($null -ne $content) { $content.Dispose() }
    if ($null -ne $http) {
        $http.Dispose()
    } elseif ($null -ne $handler) {
        $handler.Dispose()
    }
}

exit 0
