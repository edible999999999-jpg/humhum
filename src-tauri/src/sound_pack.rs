use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SoundClip {
    pub path: PathBuf,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SoundPackInfo {
    pub path: String,
    pub name: String,
    pub display_name: String,
    pub available_events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SoundClipData {
    pub data_base64: String,
    pub mime_type: String,
    pub label: String,
}

const HUMHUM_EVENTS: [&str; 5] = [
    "attentionRequired",
    "error",
    "processingStarted",
    "resourceLimit",
    "taskCompleted",
];

#[derive(Debug, Deserialize)]
struct Manifest {
    #[serde(default)]
    name: String,
    #[serde(default)]
    display_name: String,
    categories: HashMap<String, Category>,
}

#[derive(Debug, Deserialize)]
struct Category {
    #[serde(default)]
    sounds: Vec<ManifestSound>,
}

#[derive(Debug, Deserialize)]
struct ManifestSound {
    file: String,
    #[serde(default)]
    label: String,
}

fn event_categories(event: &str) -> Option<&'static [&'static str]> {
    match event {
        "processingStarted" => Some(&["task.acknowledge", "session.start"]),
        "attentionRequired" => Some(&["input.required"]),
        "taskCompleted" => Some(&["task.complete"]),
        "error" => Some(&["task.error"]),
        "resourceLimit" => Some(&["resource.limit"]),
        _ => None,
    }
}

fn read_manifest(root: &Path) -> Result<Manifest, String> {
    let manifest_path = root
        .join("openpeon.json")
        .canonicalize()
        .map_err(|error| format!("Could not read openpeon.json: {error}"))?;
    if !manifest_path.starts_with(root) {
        return Err("Manifest must stay inside the sound pack directory".to_string());
    }
    let metadata = manifest_path
        .metadata()
        .map_err(|error| format!("Could not inspect openpeon.json: {error}"))?;
    if metadata.len() > 1_048_576 {
        return Err("openpeon.json is larger than 1 MB".to_string());
    }
    serde_json::from_slice(
        &std::fs::read(&manifest_path)
            .map_err(|error| format!("Could not read openpeon.json: {error}"))?,
    )
    .map_err(|error| format!("Invalid openpeon.json: {error}"))
}

pub fn inspect_pack(pack_root: &Path) -> Result<SoundPackInfo, String> {
    let root = pack_root
        .canonicalize()
        .map_err(|error| format!("Could not open sound pack: {error}"))?;
    let manifest = read_manifest(&root)?;
    let mut available_events = Vec::new();
    for event in HUMHUM_EVENTS {
        if resolve_clip(&root, event)?.is_some() {
            available_events.push(event.to_string());
        }
    }
    if available_events.is_empty() {
        return Err("Sound pack has no supported CESP event sounds".to_string());
    }
    let folder_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("sound-pack");
    let name = if manifest.name.trim().is_empty() {
        folder_name.to_string()
    } else {
        manifest.name
    };
    let display_name = if manifest.display_name.trim().is_empty() {
        name.clone()
    } else {
        manifest.display_name
    };
    Ok(SoundPackInfo {
        path: root.to_string_lossy().to_string(),
        name,
        display_name,
        available_events,
    })
}

pub fn discover_packs(home: &Path, selected_path: Option<&str>) -> Vec<SoundPackInfo> {
    let mut roots = Vec::new();
    for packs_dir in [
        home.join(".openpeon").join("packs"),
        home.join(".claude")
            .join("hooks")
            .join("peon-ping")
            .join("packs"),
    ] {
        if let Ok(entries) = std::fs::read_dir(packs_dir) {
            roots.extend(
                entries
                    .flatten()
                    .map(|entry| entry.path())
                    .filter(|path| path.is_dir()),
            );
        }
    }
    if let Some(path) = selected_path.filter(|path| !path.trim().is_empty()) {
        roots.push(PathBuf::from(path));
    }

    let mut packs: Vec<_> = roots
        .into_iter()
        .filter_map(|root| inspect_pack(&root).ok())
        .collect();
    packs.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    packs.dedup_by(|left, right| left.path == right.path);
    packs
}

pub fn read_clip(pack_root: &Path, event: &str) -> Result<Option<SoundClipData>, String> {
    use base64::Engine;

    let Some(clip) = resolve_clip(pack_root, event)? else {
        return Ok(None);
    };
    let extension = clip
        .path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mime_type = match extension.as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        _ => return Ok(None),
    };
    let bytes =
        std::fs::read(&clip.path).map_err(|error| format!("Could not read sound file: {error}"))?;
    Ok(Some(SoundClipData {
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        mime_type: mime_type.to_string(),
        label: clip.label,
    }))
}

pub fn resolve_clip(pack_root: &Path, event: &str) -> Result<Option<SoundClip>, String> {
    let categories =
        event_categories(event).ok_or_else(|| format!("Unknown sound event: {event}"))?;
    let root = pack_root
        .canonicalize()
        .map_err(|error| format!("Could not open sound pack: {error}"))?;
    let manifest = read_manifest(&root)?;

    for category_name in categories {
        let Some(category) = manifest.categories.get(*category_name) else {
            continue;
        };
        for sound in &category.sounds {
            let candidate = root.join(&sound.file);
            let extension = candidate
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "wav" | "mp3" | "ogg") {
                continue;
            }
            if !candidate.exists() {
                continue;
            }
            let resolved = candidate
                .canonicalize()
                .map_err(|error| format!("Could not open sound file: {error}"))?;
            if !resolved.starts_with(&root) {
                return Err("Sound files must stay inside the sound pack directory".to_string());
            }
            if !resolved.is_file() {
                continue;
            }
            let label = if sound.label.trim().is_empty() {
                resolved
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Sound")
                    .to_string()
            } else {
                sound.label.clone()
            };
            return Ok(Some(SoundClip {
                path: resolved,
                label,
            }));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{inspect_pack, resolve_clip};
    use std::fs;
    use tempfile::tempdir;

    fn write_pack(root: &std::path::Path, categories: serde_json::Value) {
        fs::write(
            root.join("openpeon.json"),
            serde_json::to_vec(&serde_json::json!({
                "cesp_version": "1.0",
                "name": "test-pack",
                "display_name": "Test Pack",
                "categories": categories
            }))
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn resolves_a_standard_cesp_event_to_a_supported_audio_file() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("complete.mp3"), b"audio").unwrap();
        write_pack(
            dir.path(),
            serde_json::json!({
                "task.complete": {
                    "sounds": [{ "file": "complete.mp3", "label": "Finished" }]
                }
            }),
        );

        let clip = resolve_clip(dir.path(), "taskCompleted")
            .unwrap()
            .expect("event should resolve");

        assert_eq!(
            clip.path,
            dir.path().join("complete.mp3").canonicalize().unwrap()
        );
        assert_eq!(clip.label, "Finished");
    }

    #[test]
    fn processing_started_falls_back_to_session_start() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("start.wav"), b"audio").unwrap();
        write_pack(
            dir.path(),
            serde_json::json!({
                "session.start": {
                    "sounds": [{ "file": "start.wav" }]
                }
            }),
        );

        let clip = resolve_clip(dir.path(), "processingStarted")
            .unwrap()
            .expect("fallback category should resolve");

        assert_eq!(
            clip.path,
            dir.path().join("start.wav").canonicalize().unwrap()
        );
    }

    #[test]
    fn rejects_manifest_paths_that_escape_the_pack_directory() {
        let parent = tempdir().unwrap();
        let pack = parent.path().join("pack");
        fs::create_dir(&pack).unwrap();
        fs::write(parent.path().join("outside.mp3"), b"private").unwrap();
        write_pack(
            &pack,
            serde_json::json!({
                "task.complete": {
                    "sounds": [{ "file": "../outside.mp3" }]
                }
            }),
        );

        let error = resolve_clip(&pack, "taskCompleted").unwrap_err();

        assert!(error.contains("inside the sound pack"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_manifest_symlink_that_escapes_the_pack_directory() {
        use std::os::unix::fs::symlink;

        let parent = tempdir().unwrap();
        let pack = parent.path().join("pack");
        fs::create_dir(&pack).unwrap();
        let outside_manifest = parent.path().join("private.json");
        fs::write(
            &outside_manifest,
            serde_json::to_vec(&serde_json::json!({
                "name": "private",
                "categories": {}
            }))
            .unwrap(),
        )
        .unwrap();
        symlink(&outside_manifest, pack.join("openpeon.json")).unwrap();

        let error = inspect_pack(&pack).unwrap_err();

        assert!(error.contains("inside the sound pack"));
    }

    #[test]
    fn inspects_pack_identity_and_available_humhum_events() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("complete.mp3"), b"audio").unwrap();
        fs::write(dir.path().join("attention.ogg"), b"audio").unwrap();
        write_pack(
            dir.path(),
            serde_json::json!({
                "task.complete": {
                    "sounds": [{ "file": "complete.mp3" }]
                },
                "input.required": {
                    "sounds": [{ "file": "attention.ogg" }]
                }
            }),
        );

        let info = inspect_pack(dir.path()).unwrap();

        assert_eq!(info.name, "test-pack");
        assert_eq!(info.display_name, "Test Pack");
        assert_eq!(
            info.available_events,
            vec!["attentionRequired".to_string(), "taskCompleted".to_string()]
        );
    }
}
