use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_BATCH_SIGNALS: usize = 31;
const MAX_BATCH_BYTES: usize = 64 * 1024;
const MAX_SIGNAL_AGE: Duration = Duration::days(370);
const MAX_FUTURE_SKEW: Duration = Duration::hours(48);
const MIN_DAILY_INTERVAL: Duration = Duration::hours(20);
const MAX_DAILY_INTERVAL: Duration = Duration::hours(28);
const ALLOWED: &[(&str, &str)] = &[
    ("health.steps.daily", "count"),
    ("health.resting_heart_rate.daily", "bpm"),
    ("health.sleep.daily", "minutes"),
];
const ALLOWED_SOURCES: &[&str] = &["health_connect", "phone_step_counter"];
const ALLOWED_QUALITIES: &[&str] = &["trusted", "device_estimate"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HushSignalInput {
    pub source_id: String,
    pub kind: String,
    pub started_at: String,
    pub ended_at: String,
    pub value: f64,
    pub unit: String,
    pub source: String,
    pub captured_at: String,
    pub quality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HushSignalBatch {
    pub signals: Vec<HushSignalInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HushSignalSummary {
    pub device_id: String,
    pub source_id: String,
    pub kind: String,
    pub started_at: String,
    pub ended_at: String,
    pub value: f64,
    pub unit: String,
    pub source: String,
    pub captured_at: String,
    pub quality: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct HushSignalIngestReport {
    pub imported: usize,
    pub duplicates: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedSignalPayload {
    value: f64,
    source: String,
    quality: String,
}

#[derive(Debug)]
pub struct HushSignalStore {
    connection: Connection,
    key: [u8; 32],
    database_path: PathBuf,
}

impl HushSignalStore {
    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        let hush_dir = humhum_dir.join("hush");
        ensure_private_directory(&hush_dir)?;

        let key_path = hush_dir.join("structured-signals.key");
        let database_path = hush_dir.join("structured-signals.sqlite3");
        let key = load_or_create_key(&key_path)?;
        ensure_private_database_file(&database_path)?;

        let connection = Connection::open(&database_path)
            .map_err(|error| format!("Could not open Hush structured signal vault: {error}"))?;
        crate::local_api_auth::protect_owner_only(&database_path)
            .map_err(|error| format!("Could not protect Hush structured signal vault: {error}"))?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS health_signals (
                    device_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT NOT NULL,
                    unit TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    nonce BLOB NOT NULL,
                    payload BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (device_id, source_id)
                );",
            )
            .map_err(|error| {
                format!("Could not initialize Hush structured signal vault: {error}")
            })?;

        Ok(Self {
            connection,
            key,
            database_path,
        })
    }

    pub fn ingest(
        &mut self,
        device_id: &str,
        batch: HushSignalBatch,
    ) -> Result<HushSignalIngestReport, String> {
        validate_batch(device_id, &batch)?;

        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("Could not begin Hush signal ingest: {error}"))?;
        let now = Utc::now().to_rfc3339();
        let mut imported = 0;
        let mut duplicates = 0;

        for signal in batch.signals {
            let nonce = random_nonce()?;
            let encrypted_payload = encrypt_payload(&self.key, device_id, &signal, &nonce)?;
            let changed = transaction
                .execute(
                    "INSERT INTO health_signals (
                        device_id, source_id, kind, started_at, ended_at, unit, captured_at,
                        nonce, payload, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                    ON CONFLICT(device_id, source_id) DO NOTHING",
                    params![
                        device_id,
                        signal.source_id,
                        signal.kind,
                        signal.started_at,
                        signal.ended_at,
                        signal.unit,
                        signal.captured_at,
                        nonce.as_slice(),
                        encrypted_payload,
                        now,
                        now,
                    ],
                )
                .map_err(|error| format!("Could not persist Hush health signal: {error}"))?;
            if changed == 0 {
                duplicates += 1;
            } else {
                imported += 1;
            }
        }

        transaction
            .commit()
            .map_err(|error| format!("Could not commit Hush health signals: {error}"))?;
        crate::local_api_auth::protect_owner_only(&self.database_path)
            .map_err(|error| format!("Could not protect Hush structured signal vault: {error}"))?;

        Ok(HushSignalIngestReport {
            imported,
            duplicates,
        })
    }

    pub fn latest_health(&self) -> Result<Vec<HushSignalSummary>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT device_id, source_id, kind, started_at, ended_at, unit, captured_at, nonce, payload
                 FROM health_signals
                 ORDER BY captured_at DESC, device_id ASC, source_id ASC",
            )
            .map_err(|error| format!("Could not read Hush health signals: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(StoredSignal {
                    device_id: row.get(0)?,
                    source_id: row.get(1)?,
                    kind: row.get(2)?,
                    started_at: row.get(3)?,
                    ended_at: row.get(4)?,
                    unit: row.get(5)?,
                    captured_at: row.get(6)?,
                    nonce: row.get(7)?,
                    payload: row.get(8)?,
                })
            })
            .map_err(|error| format!("Could not query Hush health signals: {error}"))?;

        rows.map(|row| {
            let stored =
                row.map_err(|error| format!("Could not read Hush health signal: {error}"))?;
            decrypt_summary(&self.key, stored)
        })
        .collect()
    }

    pub fn clear_health(&mut self) -> Result<usize, String> {
        self.connection
            .execute("DELETE FROM health_signals", [])
            .map_err(|error| format!("Could not clear Hush health signals: {error}"))
    }
}

struct StoredSignal {
    device_id: String,
    source_id: String,
    kind: String,
    started_at: String,
    ended_at: String,
    unit: String,
    captured_at: String,
    nonce: Vec<u8>,
    payload: Vec<u8>,
}

fn validate_batch(device_id: &str, batch: &HushSignalBatch) -> Result<(), String> {
    if device_id.trim().is_empty() {
        return Err("Hush signal device id cannot be empty".into());
    }
    if batch.signals.len() > MAX_BATCH_SIGNALS {
        return Err(format!(
            "Hush signal batch cannot contain more than {MAX_BATCH_SIGNALS} signals"
        ));
    }

    let now = Utc::now();
    for signal in &batch.signals {
        validate_signal(signal, now)?;
    }
    let bytes = serde_json::to_vec(batch)
        .map_err(|error| format!("Could not encode Hush signal batch: {error}"))?;
    if bytes.len() > MAX_BATCH_BYTES {
        return Err("Hush signal batch exceeds 64 KiB".into());
    }
    Ok(())
}

fn validate_signal(signal: &HushSignalInput, now: DateTime<Utc>) -> Result<(), String> {
    if signal.source_id.trim().is_empty() {
        return Err("Hush signal source id cannot be empty".into());
    }
    if !ALLOWED
        .iter()
        .any(|(kind, unit)| signal.kind == *kind && signal.unit == *unit)
    {
        if ALLOWED.iter().any(|(kind, _)| signal.kind == *kind) {
            return Err("Hush signal unit is invalid for its kind".into());
        }
        return Err("Hush signal kind is not supported".into());
    }
    if !signal.value.is_finite() {
        return Err("Hush signal value must be finite".into());
    }
    validate_numeric_bounds(signal)?;
    if !ALLOWED_SOURCES.contains(&signal.source.as_str()) {
        return Err("Hush signal source is not supported".into());
    }
    if !ALLOWED_QUALITIES.contains(&signal.quality.as_str()) {
        return Err("Hush signal quality is not supported".into());
    }

    let started_at = parse_bounded_timestamp("start", &signal.started_at, now)?;
    let ended_at = parse_bounded_timestamp("end", &signal.ended_at, now)?;
    parse_bounded_timestamp("capture", &signal.captured_at, now)?;
    if ended_at <= started_at {
        return Err("Hush signal end timestamp must be after its start timestamp".into());
    }
    let interval = ended_at - started_at;
    if interval < MIN_DAILY_INTERVAL || interval > MAX_DAILY_INTERVAL {
        return Err("Hush signal daily interval must be between 20 and 28 hours".into());
    }
    Ok(())
}

fn validate_numeric_bounds(signal: &HushSignalInput) -> Result<(), String> {
    let valid = match signal.kind.as_str() {
        "health.steps.daily" => (0.0..=1_000_000.0).contains(&signal.value),
        "health.resting_heart_rate.daily" => (20.0..=300.0).contains(&signal.value),
        "health.sleep.daily" => (0.0..=1_440.0).contains(&signal.value),
        _ => false,
    };
    valid
        .then_some(())
        .ok_or_else(|| "Hush signal value is outside its accepted range".into())
}

fn parse_bounded_timestamp(
    name: &str,
    value: &str,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| format!("Hush signal {name} timestamp is invalid"))?
        .with_timezone(&Utc);
    if timestamp < now - MAX_SIGNAL_AGE || timestamp > now + MAX_FUTURE_SKEW {
        return Err(format!(
            "Hush signal {name} timestamp is outside the accepted range"
        ));
    }
    Ok(timestamp)
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Hush structured signal directory cannot be a symbolic link".into())
        }
        Ok(metadata) if !metadata.is_dir() => {
            Err("Hush structured signal path is not a directory".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => std::fs::create_dir_all(path)
            .map_err(|error| format!("Could not create Hush signal directory: {error}")),
        Err(error) => Err(format!("Could not inspect Hush signal directory: {error}")),
    }
}

fn load_or_create_key(path: &Path) -> Result<[u8; 32], String> {
    reject_symbolic_link(path, "Hush structured signal key")?;
    if path.exists() {
        crate::local_api_auth::protect_owner_only(path)
            .map_err(|error| format!("Could not protect Hush structured signal key: {error}"))?;
        let bytes = std::fs::read(path)
            .map_err(|error| format!("Could not read Hush structured signal key: {error}"))?;
        return bytes
            .try_into()
            .map_err(|_| "Hush structured signal key is invalid".into());
    }

    let mut key = [0_u8; 32];
    getrandom::fill(&mut key)
        .map_err(|_| "Could not create Hush signal encryption key".to_string())?;
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Could not create Hush structured signal key: {error}"))?;
    if let Err(error) = crate::local_api_auth::protect_owner_only(path) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "Could not protect Hush structured signal key: {error}"
        ));
    }
    if let Err(error) = file.write_all(&key).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "Could not write Hush structured signal key: {error}"
        ));
    }
    Ok(key)
}

fn ensure_private_database_file(path: &Path) -> Result<(), String> {
    reject_symbolic_link(path, "Hush structured signal vault")?;
    if path.exists() {
        return crate::local_api_auth::protect_owner_only(path)
            .map_err(|error| format!("Could not protect Hush structured signal vault: {error}"));
    }

    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("Could not create Hush structured signal vault: {error}"))?;
    crate::local_api_auth::protect_owner_only(path)
        .map_err(|error| format!("Could not protect Hush structured signal vault: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not initialize Hush structured signal vault: {error}"))
}

fn reject_symbolic_link(path: &Path, label: &str) -> Result<(), String> {
    if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        Err(format!("{label} cannot be a symbolic link"))
    } else {
        Ok(())
    }
}

fn random_nonce() -> Result<[u8; 12], String> {
    let mut nonce = [0_u8; 12];
    getrandom::fill(&mut nonce)
        .map_err(|_| "Could not create Hush signal encryption nonce".to_string())?;
    Ok(nonce)
}

fn encrypt_payload(
    key: &[u8; 32],
    device_id: &str,
    signal: &HushSignalInput,
    nonce: &[u8; 12],
) -> Result<Vec<u8>, String> {
    let payload = serde_json::to_vec(&EncryptedSignalPayload {
        value: signal.value,
        source: signal.source.clone(),
        quality: signal.quality.clone(),
    })
    .map_err(|error| format!("Could not encode Hush health signal payload: {error}"))?;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Could not configure Hush signal encryption".to_string())?;
    let aad = metadata_aad(device_id, signal)?;
    cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: &payload,
                aad: &aad,
            },
        )
        .map_err(|_| "Could not encrypt Hush health signal".to_string())
}

fn decrypt_summary(key: &[u8; 32], stored: StoredSignal) -> Result<HushSignalSummary, String> {
    let signal = HushSignalInput {
        source_id: stored.source_id.clone(),
        kind: stored.kind.clone(),
        started_at: stored.started_at.clone(),
        ended_at: stored.ended_at.clone(),
        value: 0.0,
        unit: stored.unit.clone(),
        source: String::new(),
        captured_at: stored.captured_at.clone(),
        quality: String::new(),
    };
    let nonce: [u8; 12] = stored
        .nonce
        .as_slice()
        .try_into()
        .map_err(|_| "Hush health signal nonce is invalid".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Could not configure Hush signal decryption".to_string())?;
    let aad = metadata_aad(&stored.device_id, &signal)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &stored.payload,
                aad: &aad,
            },
        )
        .map_err(|_| "Could not decrypt Hush health signal".to_string())?;
    let payload: EncryptedSignalPayload = serde_json::from_slice(&plaintext)
        .map_err(|_| "Hush health signal payload is invalid".to_string())?;

    Ok(HushSignalSummary {
        device_id: stored.device_id,
        source_id: stored.source_id,
        kind: stored.kind,
        started_at: stored.started_at,
        ended_at: stored.ended_at,
        value: payload.value,
        unit: stored.unit,
        source: payload.source,
        captured_at: stored.captured_at,
        quality: payload.quality,
    })
}

fn metadata_aad(device_id: &str, signal: &HushSignalInput) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&(
        "humhum-hush-signal-v1",
        device_id,
        &signal.source_id,
        &signal.kind,
        &signal.started_at,
        &signal.ended_at,
        &signal.unit,
        &signal.captured_at,
    ))
    .map_err(|error| format!("Could not encode Hush signal metadata: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    fn steps_signal(source_id: &str, value: f64) -> HushSignalInput {
        let started_at = Utc::now() - Duration::hours(8);
        HushSignalInput {
            source_id: source_id.into(),
            kind: "health.steps.daily".into(),
            started_at: started_at.to_rfc3339(),
            ended_at: (started_at + Duration::days(1)).to_rfc3339(),
            value,
            unit: "count".into(),
            source: "health_connect".into(),
            captured_at: Utc::now().to_rfc3339(),
            quality: "trusted".into(),
        }
    }

    fn same_batch() -> HushSignalBatch {
        HushSignalBatch {
            signals: vec![steps_signal("health-connect:steps:today", 6_342.0)],
        }
    }

    #[test]
    fn encrypts_health_values_and_deduplicates_by_device_and_source() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let report = store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![steps_signal("health-connect:steps:today", 6_342.0)],
                },
            )
            .unwrap();

        assert_eq!(report.imported, 1);
        assert_eq!(report.duplicates, 0);
        assert_eq!(store.latest_health().unwrap()[0].value, 6_342.0);

        let duplicate = store.ingest("phone-1", same_batch()).unwrap();
        assert_eq!(duplicate.imported, 0);
        assert_eq!(duplicate.duplicates, 1);

        let database = std::fs::read(temp.path().join("hush/structured-signals.sqlite3")).unwrap();
        assert!(!database
            .windows(b"6342".len())
            .any(|window| window == b"6342"));
    }

    #[test]
    fn rejects_batches_with_more_than_thirty_one_signals() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let signals = (0..32)
            .map(|index| steps_signal(&format!("health-connect:steps:{index}"), index as f64))
            .collect();

        let error = store
            .ingest("phone-1", HushSignalBatch { signals })
            .unwrap_err();

        assert!(error.contains("31"));
        assert!(store.latest_health().unwrap().is_empty());
    }

    #[test]
    fn rejects_batches_larger_than_sixty_four_kib() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let mut signal = steps_signal("health-connect:steps:today", 1.0);
        signal.source_id = "s".repeat(65_536);

        let error = store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![signal],
                },
            )
            .unwrap_err();

        assert!(error.contains("64 KiB"));
        assert!(store.latest_health().unwrap().is_empty());
    }

    #[test]
    fn rejects_unsupported_kinds_and_units() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let mut unsupported_kind = steps_signal("health-connect:steps:today", 1.0);
        unsupported_kind.kind = "health.steps.hourly".into();
        assert!(store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![unsupported_kind],
                },
            )
            .unwrap_err()
            .contains("kind"));

        let mut invalid_unit = steps_signal("health-connect:steps:tomorrow", 1.0);
        invalid_unit.unit = "steps".into();
        assert!(store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![invalid_unit],
                },
            )
            .unwrap_err()
            .contains("unit"));
        assert!(store.latest_health().unwrap().is_empty());
    }

    #[test]
    fn rejects_non_finite_values() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();

        let error = store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![steps_signal("health-connect:steps:today", f64::NAN)],
                },
            )
            .unwrap_err();

        assert!(error.contains("finite"));
    }

    #[test]
    fn rejects_invalid_time_ranges_and_out_of_range_timestamps() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let mut inverted = steps_signal("health-connect:steps:today", 1.0);
        inverted.ended_at = inverted.started_at.clone();
        assert!(store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![inverted],
                },
            )
            .unwrap_err()
            .contains("end"));

        let mut stale = steps_signal("health-connect:steps:old", 1.0);
        stale.started_at = "1970-01-01T00:00:00Z".into();
        stale.ended_at = "1970-01-02T00:00:00Z".into();
        stale.captured_at = "1970-01-02T00:00:00Z".into();
        assert!(store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![stale],
                },
            )
            .unwrap_err()
            .contains("range"));
    }

    #[test]
    fn rejects_raw_intervals_labeled_as_daily_health_summaries() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();

        for (kind, unit, value) in [
            ("health.steps.daily", "count", 1.0),
            ("health.resting_heart_rate.daily", "bpm", 70.0),
            ("health.sleep.daily", "minutes", 1.0),
        ] {
            let mut signal = steps_signal(&format!("health-connect:{kind}"), value);
            signal.kind = kind.into();
            signal.unit = unit.into();
            let started_at = chrono::DateTime::parse_from_rfc3339(&signal.started_at).unwrap();
            signal.ended_at = (started_at + Duration::seconds(1)).to_rfc3339();

            assert!(store
                .ingest(
                    "phone-1",
                    HushSignalBatch {
                        signals: vec![signal],
                    },
                )
                .unwrap_err()
                .contains("interval"));
        }
    }

    #[test]
    fn accepts_twenty_to_twenty_eight_hour_daily_intervals_inclusively() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();

        for (source_id, duration) in [
            ("health-connect:steps:short-day", Duration::hours(20)),
            ("health-connect:steps:long-day", Duration::hours(28)),
        ] {
            let mut signal = steps_signal(source_id, 1.0);
            let started_at = chrono::DateTime::parse_from_rfc3339(&signal.started_at).unwrap();
            signal.ended_at = (started_at + duration).to_rfc3339();
            assert_eq!(
                store
                    .ingest(
                        "phone-1",
                        HushSignalBatch {
                            signals: vec![signal],
                        },
                    )
                    .unwrap()
                    .imported,
                1
            );
        }
    }

    #[test]
    fn rejects_blank_unknown_and_free_form_signal_sources() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();

        for source in ["", "wearable_vendor", "heart rate from private clinic"] {
            let mut signal = steps_signal(&format!("health-connect:source:{source}"), 1.0);
            signal.source = source.into();
            assert!(store
                .ingest(
                    "phone-1",
                    HushSignalBatch {
                        signals: vec![signal],
                    },
                )
                .unwrap_err()
                .contains("source"));
        }
    }

    #[test]
    fn rejects_blank_unknown_and_free_form_signal_qualities() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();

        for quality in ["", "estimated", "patient says they slept badly"] {
            let mut signal = steps_signal(&format!("health-connect:quality:{quality}"), 1.0);
            signal.quality = quality.into();
            assert!(store
                .ingest(
                    "phone-1",
                    HushSignalBatch {
                        signals: vec![signal],
                    },
                )
                .unwrap_err()
                .contains("quality"));
        }
    }

    #[test]
    fn accepts_the_explicit_first_slice_source_and_quality_enums() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let mut signal = steps_signal("phone-step-counter:steps:today", 1.0);
        signal.source = "phone_step_counter".into();
        signal.quality = "device_estimate".into();

        assert_eq!(
            store
                .ingest(
                    "phone-1",
                    HushSignalBatch {
                        signals: vec![signal],
                    },
                )
                .unwrap()
                .imported,
            1
        );
    }

    #[test]
    fn accepts_the_same_source_id_from_different_devices() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        let batch = same_batch();

        assert_eq!(store.ingest("phone-1", batch.clone()).unwrap().imported, 1);
        assert_eq!(store.ingest("phone-2", batch).unwrap().imported, 1);
        assert_eq!(store.latest_health().unwrap().len(), 2);
    }

    #[cfg(unix)]
    #[test]
    fn creates_owner_only_key_and_database_files() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let _store = HushSignalStore::load_or_create(temp.path()).unwrap();
        for path in [
            temp.path().join("hush/structured-signals.key"),
            temp.path().join("hush/structured-signals.sqlite3"),
        ] {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symbolic_link_key_and_database_paths() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let hush = temp.path().join("hush");
        std::fs::create_dir_all(&hush).unwrap();
        let outside = temp.path().join("outside");
        std::fs::write(&outside, b"outside").unwrap();
        symlink(&outside, hush.join("structured-signals.key")).unwrap();
        assert!(HushSignalStore::load_or_create(temp.path())
            .unwrap_err()
            .contains("symbolic link"));

        std::fs::remove_file(hush.join("structured-signals.key")).unwrap();
        symlink(&outside, hush.join("structured-signals.sqlite3")).unwrap();
        assert!(HushSignalStore::load_or_create(temp.path())
            .unwrap_err()
            .contains("symbolic link"));
    }

    #[test]
    fn rolls_back_a_batch_when_persistence_fails() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_test_signal BEFORE INSERT ON health_signals
                 WHEN NEW.source_id = 'health-connect:steps:reject'
                 BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;",
            )
            .unwrap();

        let error = store
            .ingest(
                "phone-1",
                HushSignalBatch {
                    signals: vec![
                        steps_signal("health-connect:steps:first", 1.0),
                        steps_signal("health-connect:steps:reject", 2.0),
                    ],
                },
            )
            .unwrap_err();

        assert!(error.contains("injected persistence failure"));
        assert!(store.latest_health().unwrap().is_empty());
    }

    #[test]
    fn clears_all_health_signals() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = HushSignalStore::load_or_create(temp.path()).unwrap();
        store.ingest("phone-1", same_batch()).unwrap();
        store
            .ingest(
                "phone-2",
                HushSignalBatch {
                    signals: vec![steps_signal("health-connect:steps:other", 10.0)],
                },
            )
            .unwrap();

        assert_eq!(store.clear_health().unwrap(), 2);
        assert!(store.latest_health().unwrap().is_empty());
        assert_eq!(store.clear_health().unwrap(), 0);
    }
}
