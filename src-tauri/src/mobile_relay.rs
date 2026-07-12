use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::net::IpAddr;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayBaseUrl(String);

impl RelayBaseUrl {
    pub fn parse(value: &str) -> Result<Self, String> {
        let value = value.trim();
        if value.is_empty() || value.len() > 2048 {
            return Err("Relay URL is invalid".into());
        }
        let url = reqwest::Url::parse(value).map_err(|_| "Relay URL is invalid")?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || url.host_str().is_none()
        {
            return Err("Relay URL is invalid".into());
        }
        let loopback = url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        });
        if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
            return Err("Relay URL must use HTTPS".into());
        }
        Ok(Self(url.as_str().trim_end_matches('/').to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RelayDeviceSecret {
    pub device_id: String,
    pub base_url: String,
    pub channel_id: String,
    pub wake_key: String,
    pub publisher_token: String,
    pub next_sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WakeRelayBundle {
    pub version: u8,
    pub base_url: String,
    pub channel_id: String,
    pub subscriber_token: String,
    pub wake_key: String,
}

struct RelayProvision {
    desktop: RelayDeviceSecret,
    android: WakeRelayBundle,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RelayRegistrationResponse {
    channel_id: String,
    publisher_token: String,
    subscriber_token: String,
}

fn split_registration(
    device_id: &str,
    base_url: &RelayBaseUrl,
    response: &[u8],
    wake_key: &str,
) -> Result<RelayProvision, String> {
    if response.len() > 1024 || !is_secret(wake_key) {
        return Err("Relay registration is invalid".into());
    }
    let registration: RelayRegistrationResponse = serde_json::from_slice(response)
        .map_err(|_| "Relay registration is invalid".to_string())?;
    if !is_secret(&registration.channel_id)
        || !is_secret(&registration.publisher_token)
        || !is_secret(&registration.subscriber_token)
        || registration.publisher_token == registration.subscriber_token
    {
        return Err("Relay registration is invalid".into());
    }
    let desktop = RelayDeviceSecret {
        device_id: device_id.to_string(),
        base_url: base_url.as_str().to_string(),
        channel_id: registration.channel_id.clone(),
        wake_key: wake_key.to_string(),
        publisher_token: registration.publisher_token,
        next_sequence: 1,
    };
    desktop.validate()?;
    let android = WakeRelayBundle {
        version: 1,
        base_url: base_url.as_str().to_string(),
        channel_id: registration.channel_id,
        subscriber_token: registration.subscriber_token,
        wake_key: wake_key.to_string(),
    };
    Ok(RelayProvision { desktop, android })
}

impl RelayDeviceSecret {
    fn validate(&self) -> Result<(), String> {
        RelayBaseUrl::parse(&self.base_url)?;
        if self.device_id.is_empty()
            || self.device_id.len() > 128
            || !self
                .device_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || !is_secret(&self.channel_id)
            || !is_secret(&self.wake_key)
            || !is_secret(&self.publisher_token)
            || self.next_sequence == 0
        {
            return Err("Relay device secret is invalid".into());
        }
        Ok(())
    }
}

fn is_secret(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub struct MobileRelaySecretStore {
    path: PathBuf,
    devices: BTreeMap<String, RelayDeviceSecret>,
}

impl MobileRelaySecretStore {
    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(humhum_dir)
            .map_err(|error| format!("Could not create HUMHUM directory: {error}"))?;
        let path = humhum_dir.join("mobile-relay-secrets.json");
        if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err("Relay secret store cannot be a symbolic link".into());
        }
        let devices = if path.exists() {
            let bytes = std::fs::read(&path)
                .map_err(|error| format!("Could not read relay secrets: {error}"))?;
            if bytes.len() > 1_048_576 {
                return Err("Relay secret store is too large".into());
            }
            let values: Vec<RelayDeviceSecret> = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Could not parse relay secrets: {error}"))?;
            let mut devices = BTreeMap::new();
            for value in values {
                value.validate()?;
                if devices.insert(value.device_id.clone(), value).is_some() {
                    return Err("Relay secret store contains duplicate devices".into());
                }
            }
            devices
        } else {
            BTreeMap::new()
        };
        Ok(Self { path, devices })
    }

    pub fn get(&self, device_id: &str) -> Option<&RelayDeviceSecret> {
        self.devices.get(device_id)
    }

    pub fn put(&mut self, secret: RelayDeviceSecret) -> Result<(), String> {
        secret.validate()?;
        self.devices.insert(secret.device_id.clone(), secret);
        self.persist()
    }

    pub fn remove(&mut self, device_id: &str) -> Result<(), String> {
        self.devices.remove(device_id);
        self.persist()
    }

    pub fn clear(&mut self) -> Result<(), String> {
        self.devices.clear();
        self.persist()
    }

    fn persist(&self) -> Result<(), String> {
        let values = self.devices.values().collect::<Vec<_>>();
        let content = serde_json::to_vec_pretty(&values)
            .map_err(|error| format!("Could not serialize relay secrets: {error}"))?;
        let temp_path = self.path.with_extension("json.tmp");
        std::fs::write(&temp_path, content)
            .map_err(|error| format!("Could not write relay secrets: {error}"))?;
        set_owner_only(&temp_path)?;
        std::fs::rename(&temp_path, &self.path)
            .map_err(|error| format!("Could not replace relay secrets: {error}"))?;
        set_owner_only(&self.path)
    }
}

fn set_owner_only(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|error| format!("Could not inspect relay secret permissions: {error}"))?
            .permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(path, permissions)
            .map_err(|error| format!("Could not protect relay secrets: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn relay_base_url_requires_https_except_exact_loopback() {
        assert_eq!(
            RelayBaseUrl::parse("https://relay.example.com")
                .unwrap()
                .as_str(),
            "https://relay.example.com"
        );
        assert_eq!(
            RelayBaseUrl::parse("http://127.0.0.1:3005")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:3005"
        );
        assert_eq!(
            RelayBaseUrl::parse("http://localhost:3005")
                .unwrap()
                .as_str(),
            "http://localhost:3005"
        );
        for invalid in [
            "http://relay.example.com",
            "http://192.168.1.20:3005",
            "https://user:pass@relay.example.com",
            "https://relay.example.com/path",
            "https://relay.example.com?token=secret",
            "https://relay.example.com/#fragment",
            "ftp://relay.example.com",
        ] {
            assert!(RelayBaseUrl::parse(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn relay_secret_store_is_owner_only_isolated_and_removable() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        let phone = RelayDeviceSecret {
            device_id: "device-phone".into(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
        };
        let tablet = RelayDeviceSecret {
            device_id: "device-tablet".into(),
            base_url: "https://relay.example.com".into(),
            channel_id: "44".repeat(32),
            wake_key: "55".repeat(32),
            publisher_token: "66".repeat(32),
            next_sequence: 7,
        };

        store.put(phone.clone()).unwrap();
        store.put(tablet.clone()).unwrap();
        let path = temp.path().join("mobile-relay-secrets.json");
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let mut restored = MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        assert_eq!(restored.get("device-phone"), Some(&phone));
        assert_eq!(restored.get("device-tablet"), Some(&tablet));
        assert!(restored.get("unknown").is_none());
        restored.remove("device-phone").unwrap();
        assert!(restored.get("device-phone").is_none());
        assert_eq!(restored.get("device-tablet"), Some(&tablet));
        restored.clear().unwrap();
        assert!(MobileRelaySecretStore::load_or_create(temp.path())
            .unwrap()
            .get("device-tablet")
            .is_none());
    }

    #[test]
    fn relay_registration_splits_publisher_and_subscriber_material() {
        let base = RelayBaseUrl::parse("https://relay.example.com").unwrap();
        let response = serde_json::json!({
            "channel_id": "11".repeat(32),
            "publisher_token": "22".repeat(32),
            "subscriber_token": "33".repeat(32),
        });

        let provision = split_registration(
            "device-phone",
            &base,
            &serde_json::to_vec(&response).unwrap(),
            &"44".repeat(32),
        )
        .unwrap();

        assert_eq!(provision.desktop.publisher_token, "22".repeat(32));
        assert_eq!(provision.desktop.wake_key, "44".repeat(32));
        assert_eq!(provision.android.subscriber_token, "33".repeat(32));
        assert_eq!(provision.android.wake_key, "44".repeat(32));
        let desktop_json = serde_json::to_string(&provision.desktop).unwrap();
        let android_json = serde_json::to_string(&provision.android).unwrap();
        assert!(!desktop_json.contains(&"33".repeat(32)));
        assert!(!android_json.contains(&"22".repeat(32)));
    }

    #[test]
    fn relay_registration_rejects_unknown_fields_and_malformed_secrets() {
        let base = RelayBaseUrl::parse("https://relay.example.com").unwrap();
        let valid = serde_json::json!({
            "channel_id": "11".repeat(32),
            "publisher_token": "22".repeat(32),
            "subscriber_token": "33".repeat(32),
        });
        assert!(split_registration(
            "device-phone",
            &base,
            &serde_json::to_vec(&valid).unwrap(),
            "short",
        )
        .is_err());
        assert!(split_registration(
            "device-phone",
            &base,
            &serde_json::to_vec(&serde_json::json!({
                "channel_id": "11".repeat(32),
                "publisher_token": "22".repeat(32),
                "subscriber_token": "33".repeat(32),
                "plaintext": "not allowed",
            }))
            .unwrap(),
            &"44".repeat(32),
        )
        .is_err());
    }
}
