[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [ValidateRange(-10, 10)]
    [int]$Rate = 0,

    [string]$Voice = "",

    [Parameter(ValueFromPipeline = $true)]
    [AllowEmptyString()]
    [string]$Text = ""
)

begin {
    $ErrorActionPreference = "Stop"
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
    $textChunks = New-Object 'System.Collections.Generic.List[string]'
    $pipelineTextReceived = $false
}

process {
    if ($PSBoundParameters.ContainsKey("Text")) {
        $pipelineTextReceived = $true
        $textChunks.Add($Text)
    }
}

end {
    $speechText = if ($pipelineTextReceived) {
        $textChunks -join [Environment]::NewLine
    } else {
        [Console]::In.ReadToEnd()
    }
    $speechText = $speechText.TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($speechText)) {
        throw "No text was provided for speech synthesis"
    }

    Add-Type -AssemblyName System.Speech
    $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        if (-not [string]::IsNullOrWhiteSpace($Voice)) {
            $voices = @($synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled })
            $exact = $voices | Where-Object { $_.VoiceInfo.Name -eq $Voice } | Select-Object -First 1
            if ($null -eq $exact) {
                $language = if ($Voice -match '^([a-z]{2})-') { $Matches[1] } else { "" }
                if ($language) {
                    $exact = $voices | Where-Object {
                        $_.VoiceInfo.Culture.Name.StartsWith($language, [System.StringComparison]::OrdinalIgnoreCase)
                    } | Select-Object -First 1
                }
            }
            if ($null -ne $exact) {
                $synthesizer.SelectVoice($exact.VoiceInfo.Name)
            }
        }

        $synthesizer.Rate = $Rate
        $synthesizer.SetOutputToWaveFile($OutputPath)
        $synthesizer.Speak($speechText)
    } finally {
        $synthesizer.Dispose()
    }
}
