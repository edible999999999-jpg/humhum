use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static AUDIO_QUEUE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

fn audio_queue() -> &'static tokio::sync::Mutex<()> {
    AUDIO_QUEUE.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Play one file at a time and wait until it ends. Holding the queue guard
/// gives the frontend's AudioQueue the same sequencing guarantee on every OS.
pub(crate) async fn play_file(path: &Path) -> Result<(), String> {
    let _queue_guard = audio_queue().lock().await;
    STOP_REQUESTED.store(false, Ordering::Release);
    platform::play(path).await
}

/// Interrupt the active file without waiting for the playback queue lock.
pub(crate) async fn stop() -> Result<(), String> {
    STOP_REQUESTED.store(true, Ordering::Release);
    platform::stop().await
}

fn stop_requested() -> bool {
    STOP_REQUESTED.load(Ordering::Acquire)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::stop_requested;
    use std::path::Path;
    use std::sync::Mutex;

    static ACTIVE_PROCESS: Mutex<Option<u32>> = Mutex::new(None);

    extern "C" {
        fn kill(process_id: i32, signal: i32) -> i32;
    }

    pub(super) async fn play(path: &Path) -> Result<(), String> {
        let mut child = tokio::process::Command::new("afplay")
            .arg(path)
            .spawn()
            .map_err(|e| format!("afplay spawn failed: {e}"))?;
        let process_id = child
            .id()
            .ok_or_else(|| "afplay did not expose a process id".to_string())?;

        *ACTIVE_PROCESS.lock().unwrap_or_else(|e| e.into_inner()) = Some(process_id);
        let status = child.wait().await;
        let mut active = ACTIVE_PROCESS.lock().unwrap_or_else(|e| e.into_inner());
        if *active == Some(process_id) {
            *active = None;
        }
        drop(active);

        let status = status.map_err(|e| format!("afplay wait failed: {e}"))?;
        if status.success() || stop_requested() {
            Ok(())
        } else {
            Err(format!("afplay exited with: {status}"))
        }
    }

    pub(super) async fn stop() -> Result<(), String> {
        let process_id = *ACTIVE_PROCESS.lock().unwrap_or_else(|e| e.into_inner());
        let Some(process_id) = process_id else {
            return Ok(());
        };

        // Signal only HumHum's player instead of terminating every afplay
        // process owned by the user.
        let result = unsafe { kill(process_id as i32, 15) }; // SIGTERM
        if result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(3) {
            Ok(())
        } else {
            Err(format!(
                "Failed to stop afplay process {process_id}: {}",
                std::io::Error::last_os_error()
            ))
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::stop_requested;
    use std::ffi::c_void;
    use std::iter::once;
    use std::path::{Path, PathBuf};
    use std::ptr::null_mut;
    use std::time::Duration;

    const AUDIO_ALIAS: &str = "humhum_audio";

    #[link(name = "winmm")]
    extern "system" {
        fn mciGetErrorStringW(error: u32, text: *mut u16, text_length: u32) -> i32;
        fn mciSendStringW(
            command: *const u16,
            result: *mut u16,
            result_length: u32,
            callback: *mut c_void,
        ) -> u32;
    }

    pub(super) async fn play(path: &Path) -> Result<(), String> {
        let path = path.to_path_buf();
        tokio::task::spawn_blocking(move || play_blocking(path))
            .await
            .map_err(|e| format!("Windows audio task failed: {e}"))?
    }

    pub(super) async fn stop() -> Result<(), String> {
        // The playback worker polls this flag and calls MCI itself. Keeping all
        // alias commands on one thread avoids driver-specific MCI thread scope.
        Ok(())
    }

    fn play_blocking(path: PathBuf) -> Result<(), String> {
        // Clear an alias left behind if a media driver failed during an earlier
        // playback attempt.
        let _ = send_command(&format!("close {AUDIO_ALIAS}"));

        let path = path
            .to_str()
            .ok_or_else(|| "Windows audio path is not valid Unicode".to_string())?;
        let media_type = if path.to_ascii_lowercase().ends_with(".wav") {
            "waveaudio"
        } else {
            "mpegvideo"
        };
        send_command(&format!(
            "open \"{path}\" type {media_type} alias {AUDIO_ALIAS}"
        ))?;

        let playback = (|| {
            send_command(&format!("play {AUDIO_ALIAS}"))?;
            loop {
                if stop_requested() {
                    let _ = send_command(&format!("stop {AUDIO_ALIAS}"));
                    return Ok(());
                }

                match query_command(&format!("status {AUDIO_ALIAS} mode")) {
                    Ok(mode) if mode.eq_ignore_ascii_case("stopped") => return Ok(()),
                    Ok(_) => std::thread::sleep(Duration::from_millis(25)),
                    Err(_error) if stop_requested() => return Ok(()),
                    Err(error) => return Err(error),
                }
            }
        })();

        let _ = send_command(&format!("close {AUDIO_ALIAS}"));
        playback
    }

    fn send_command(command: &str) -> Result<(), String> {
        let command = wide_null(command);
        let result = unsafe { mciSendStringW(command.as_ptr(), null_mut(), 0, null_mut()) };
        if result == 0 {
            Ok(())
        } else {
            Err(mci_error(result))
        }
    }

    fn query_command(command: &str) -> Result<String, String> {
        let command = wide_null(command);
        let mut output = [0_u16; 128];
        let result = unsafe {
            mciSendStringW(
                command.as_ptr(),
                output.as_mut_ptr(),
                output.len() as u32,
                null_mut(),
            )
        };
        if result != 0 {
            return Err(mci_error(result));
        }

        let length = output
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(output.len());
        Ok(String::from_utf16_lossy(&output[..length])
            .trim()
            .to_string())
    }

    fn mci_error(error: u32) -> String {
        let mut output = [0_u16; 256];
        let found = unsafe { mciGetErrorStringW(error, output.as_mut_ptr(), output.len() as u32) };
        if found == 0 {
            return format!("Windows MCI audio error {error}");
        }
        let length = output
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(output.len());
        format!(
            "Windows MCI audio error {error}: {}",
            String::from_utf16_lossy(&output[..length])
        )
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(once(0)).collect()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use std::path::Path;

    pub(super) async fn play(_path: &Path) -> Result<(), String> {
        Err("Native MP3 playback is only supported on macOS and Windows".to_string())
    }

    pub(super) async fn stop() -> Result<(), String> {
        Ok(())
    }
}
