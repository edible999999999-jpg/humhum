param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [ValidateRange(-10, 10)]
    [int]$Rate = 0,

    [string]$Voice = ""
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
Add-Type -AssemblyName System.Speech

$text = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($text)) {
    throw "No text was provided for speech synthesis"
}

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
    $synthesizer.Speak($text)
} finally {
    $synthesizer.Dispose()
}
