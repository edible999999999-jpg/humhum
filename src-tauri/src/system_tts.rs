use base64::Engine;

pub(crate) async fn synthesize(
    text: &str,
    voice: Option<&str>,
    speed: f64,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Cannot synthesize empty text".to_string());
    }
    if text.chars().count() > 4_000 {
        return Err("System speech input is limited to 4000 characters".to_string());
    }

    let bytes = platform::synthesize(text, voice, speed).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(target_os = "windows")]
mod platform {
    use std::path::PathBuf;
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    const WINDOWS_TTS_SCRIPT: &str = include_str!("../../scripts/system-tts-windows.ps1");

    pub(super) async fn synthesize(
        text: &str,
        voice: Option<&str>,
        speed: f64,
    ) -> Result<Vec<u8>, String> {
        use std::os::windows::process::CommandExt;

        let temp_dir = std::env::temp_dir().join("humhum-system-tts");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|error| format!("Failed to create system TTS directory: {error}"))?;
        let script_path = temp_dir.join("synthesize.ps1");
        let output_path = temp_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&script_path, WINDOWS_TTS_SCRIPT)
            .map_err(|error| format!("Failed to prepare Windows speech script: {error}"))?;

        let rate = ((speed.clamp(0.5, 2.0) - 1.0) * 5.0).round() as i32;
        let mut command = tokio::process::Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script_path)
            .arg("-OutputPath")
            .arg(&output_path)
            .arg("-Rate")
            .arg(rate.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(voice) = voice.filter(|value| !value.trim().is_empty()) {
            command.arg("-Voice").arg(voice);
        }
        command.as_std_mut().creation_flags(0x0800_0000);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start Windows speech synthesis: {error}"))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Windows speech synthesizer stdin was unavailable".to_string())?;
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|error| format!("Failed to send text to Windows speech: {error}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|error| format!("Failed to finish Windows speech input: {error}"))?;
        drop(stdin);

        let output = match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            child.wait_with_output(),
        )
        .await
        {
            Ok(result) => {
                result.map_err(|error| format!("Windows speech synthesis failed: {error}"))?
            }
            Err(_) => {
                let _ = std::fs::remove_file(&output_path);
                return Err("Windows speech synthesis timed out after 30 seconds".to_string());
            }
        };
        if !output.status.success() {
            let _ = std::fs::remove_file(&output_path);
            return Err(format!(
                "Windows speech synthesis failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        read_and_remove(output_path)
    }

    fn read_and_remove(path: PathBuf) -> Result<Vec<u8>, String> {
        let bytes = std::fs::read(&path)
            .map_err(|error| format!("Failed to read Windows speech audio: {error}"))?;
        let _ = std::fs::remove_file(path);
        if bytes.len() < 44 {
            return Err("Windows speech synthesis returned an empty WAV file".to_string());
        }
        Ok(bytes)
    }
}

#[cfg(target_os = "macos")]
mod platform {
    pub(super) async fn synthesize(
        text: &str,
        _voice: Option<&str>,
        speed: f64,
    ) -> Result<Vec<u8>, String> {
        let temp_dir = std::env::temp_dir().join("humhum-system-tts");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|error| format!("Failed to create system TTS directory: {error}"))?;
        let output_path = temp_dir.join(format!("{}.aiff", uuid::Uuid::new_v4()));
        let rate = (180.0 * speed.clamp(0.5, 2.0)).round() as u32;
        let output = tokio::process::Command::new("/usr/bin/say")
            .arg("--output-file")
            .arg(&output_path)
            .arg("--rate")
            .arg(rate.to_string())
            .arg(text)
            .output()
            .await
            .map_err(|error| format!("Failed to start macOS speech synthesis: {error}"))?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&output_path);
            return Err(format!(
                "macOS speech synthesis failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let bytes = std::fs::read(&output_path)
            .map_err(|error| format!("Failed to read macOS speech audio: {error}"))?;
        let _ = std::fs::remove_file(output_path);
        Ok(bytes)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    pub(super) async fn synthesize(
        _text: &str,
        _voice: Option<&str>,
        _speed: f64,
    ) -> Result<Vec<u8>, String> {
        Err("System speech synthesis is only supported on Windows and macOS".to_string())
    }
}
