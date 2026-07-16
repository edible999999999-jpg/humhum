use http_body_util::{BodyExt, Full};
use hyper::body::{Body, Bytes};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::convert::Infallible;
use std::fmt;
use std::io::BufReader;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{Listener, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Notify, Semaphore};
use tokio_rustls::rustls;
use tokio_rustls::TlsAcceptor;

const PAIRING_TTL_SECONDS: i64 = 300;
const MAX_PAIRING_ATTEMPTS: u8 = 5;
const MAX_EVENT_WAITERS: usize = 16;
const EVENT_WAIT_SECONDS: usize = 20;
pub const DEFAULT_MOBILE_PORT: u16 = 31_276;
const MAX_CONVERSATION_REQUEST_BYTES: usize = 4 * 1024;
const MAX_CONVERSATION_ID_CHARS: usize = 256;
const MAX_CONVERSATION_TEXT_CHARS: usize = 500;
const MAX_CONVERSATION_RESPONSE_BYTES: usize = 64 * 1024;

type HttpBody = Full<Bytes>;

#[derive(Debug, Clone, Serialize)]
pub struct MobileBridgeStatus {
    pub enabled: bool,
    pub url: Option<String>,
    pub lan_url: Option<String>,
    pub tailnet_url: Option<String>,
    pub certificate_fingerprint: Option<String>,
    pub pairing_active: bool,
    pub paired_devices: usize,
    pub devices: Vec<MobileDeviceSummary>,
    pub relay_status: String,
    pub relay_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MobilePairingInfo {
    pub code: String,
    pub expires_at: i64,
    pub url: String,
    pub certificate_fingerprint: String,
    pub scope: MobileDeviceScope,
    pub network: MobileNetwork,
    pub android_setup: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobileDeviceScope {
    Read,
    Control,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobileNetwork {
    #[default]
    Lan,
    Tailnet,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileDeviceSummary {
    pub id: String,
    pub name: String,
    pub paired_at: String,
    pub scope: MobileDeviceScope,
    pub presence_mode: Option<MobilePresenceMode>,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobilePresenceMode {
    Foreground,
    Monitoring,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MobileDeviceAuth {
    id: String,
    scope: MobileDeviceScope,
}

#[derive(Debug, Clone, Copy)]
struct MobilePresence {
    mode: MobilePresenceMode,
    recorded_at: i64,
}

#[derive(Default)]
struct MobilePresenceStore {
    entries: HashMap<String, MobilePresence>,
}

impl MobilePresenceStore {
    const FRESH_SECONDS: i64 = 90;

    fn report(&mut self, device_id: &str, mode: MobilePresenceMode, now: i64) {
        self.entries.insert(
            device_id.to_string(),
            MobilePresence {
                mode,
                recorded_at: now,
            },
        );
    }

    fn fresh(&self, device_id: &str, now: i64) -> Option<MobilePresence> {
        self.entries.get(device_id).copied().filter(|presence| {
            now >= presence.recorded_at
                && now.saturating_sub(presence.recorded_at) <= Self::FRESH_SECONDS
        })
    }

    fn remove(&mut self, device_id: &str) {
        self.entries.remove(device_id);
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

impl MobileDeviceScope {
    fn allows_control(self) -> bool {
        self == Self::Control
    }
}

fn default_mobile_scope() -> MobileDeviceScope {
    MobileDeviceScope::Read
}

struct MobileRuntime {
    enabled: bool,
    enabling: bool,
    generation: u64,
    url: Option<String>,
    tailnet_url: Option<String>,
    certificate_fingerprint: Option<String>,
    pairing: Option<PairingChallenge>,
    shutdown: Option<oneshot::Sender<()>>,
    observer_shutdown: Option<oneshot::Sender<()>>,
    relay_base_url: Option<crate::mobile_relay::RelayBaseUrl>,
    relay_invite_code: Option<String>,
    relay_status: crate::mobile_relay::RelayPublisherStatus,
    publisher: Option<Arc<crate::mobile_relay::WakePublisher>>,
}

pub struct MobileBridgeState {
    humhum_dir: PathBuf,
    devices: Arc<Mutex<MobileDeviceStore>>,
    presence: Mutex<MobilePresenceStore>,
    relay_secrets: Arc<Mutex<crate::mobile_relay::MobileRelaySecretStore>>,
    relay_changes: Arc<Notify>,
    publisher_stopping: Mutex<bool>,
    publisher_stopped: Condvar,
    event_waiters: Arc<Semaphore>,
    runtime: Mutex<MobileRuntime>,
}

impl MobileBridgeState {
    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        Ok(Self {
            humhum_dir: humhum_dir.to_path_buf(),
            devices: Arc::new(Mutex::new(MobileDeviceStore::load_or_create(humhum_dir)?)),
            presence: Mutex::new(MobilePresenceStore::default()),
            relay_secrets: Arc::new(Mutex::new(
                crate::mobile_relay::MobileRelaySecretStore::load_or_create(humhum_dir)?,
            )),
            relay_changes: Arc::new(Notify::new()),
            publisher_stopping: Mutex::new(false),
            publisher_stopped: Condvar::new(),
            event_waiters: Arc::new(Semaphore::new(MAX_EVENT_WAITERS)),
            runtime: Mutex::new(MobileRuntime {
                enabled: false,
                enabling: false,
                generation: 0,
                url: None,
                tailnet_url: None,
                certificate_fingerprint: None,
                pairing: None,
                shutdown: None,
                observer_shutdown: None,
                relay_base_url: None,
                relay_invite_code: None,
                relay_status: crate::mobile_relay::RelayPublisherStatus::Connected,
                publisher: None,
            }),
        })
    }

    pub fn status(&self) -> MobileBridgeStatus {
        let now = chrono::Utc::now().timestamp();
        let runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let devices = self
            .devices
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .summaries_with_presence(
                &self
                    .presence
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()),
                now,
            );
        MobileBridgeStatus {
            enabled: runtime.enabled,
            url: runtime.url.clone(),
            lan_url: runtime.url.clone(),
            tailnet_url: runtime.tailnet_url.clone(),
            certificate_fingerprint: runtime.certificate_fingerprint.clone(),
            pairing_active: runtime
                .pairing
                .as_ref()
                .is_some_and(|pairing| pairing.is_active(now)),
            paired_devices: devices.len(),
            devices,
            relay_status: if runtime.relay_base_url.is_some() {
                runtime
                    .publisher
                    .as_ref()
                    .map(|publisher| publisher.status())
                    .unwrap_or(runtime.relay_status)
                    .as_str()
                    .into()
            } else {
                "disabled".into()
            },
            relay_url: runtime
                .relay_base_url
                .as_ref()
                .map(|url| url.as_str().to_string()),
        }
    }

    fn begin_enable(&self) -> Result<u64, String> {
        if *self
            .publisher_stopping
            .lock()
            .map_err(|error| error.to_string())?
        {
            return Err("Mobile access is still disabling".into());
        }
        let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        if runtime.enabled {
            return Err("Mobile access is already enabled".into());
        }
        if runtime.enabling {
            return Err("Mobile access is already enabling".into());
        }
        runtime.generation = runtime.generation.wrapping_add(1);
        runtime.enabling = true;
        Ok(runtime.generation)
    }

    fn enable_generation_is_current(&self, generation: u64) -> bool {
        let runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        runtime.enabling && runtime.generation == generation
    }

    fn abandon_enable(&self, generation: u64) {
        let mut runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if runtime.generation == generation {
            runtime.enabling = false;
        }
    }

    fn generation_is_enabled(&self, generation: u64) -> bool {
        let runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        runtime.enabled && runtime.generation == generation
    }

    pub async fn enable(
        self: &Arc<Self>,
        app: tauri::AppHandle,
    ) -> Result<MobileBridgeStatus, String> {
        if self.status().enabled {
            return Ok(self.status());
        }
        let generation = self.begin_enable()?;
        let setup = async {
            let relay_config = app
                .state::<Arc<std::sync::Mutex<crate::config::AppConfig>>>()
                .lock()
                .map_err(|error| error.to_string())?
                .mobile_relay
                .clone();
            let relay_base_url = relay_base_from_config(&relay_config)?;
            let relay_invite_code = relay_invite_from_config(&relay_config)?;
            if let Some(base_url) = relay_base_url.clone() {
                crate::mobile_relay::RelayClient::new(base_url)?
                    .health()
                    .await?;
            }
            if !self.enable_generation_is_current(generation) {
                return Err("Mobile enable was cancelled".to_string());
            }

            let local_host = local_lan_host()?;
            let tailnet_ip = crate::tailnet::discover_tailnet_ipv4().await;
            if !self.enable_generation_is_current(generation) {
                return Err("Mobile enable was cancelled".to_string());
            }
            let cert = ensure_certificate(&self.humhum_dir)?;
            let tls_config = load_tls_config(&cert.cert_path, &cert.key_path)?;
            let listener = TcpListener::bind(SocketAddr::new(
                IpAddr::V4(Ipv4Addr::UNSPECIFIED),
                DEFAULT_MOBILE_PORT,
            ))
            .await
            .map_err(|error| format!("Could not open mobile HTTPS port: {error}"))?;
            if !self.enable_generation_is_current(generation) {
                return Err("Mobile enable was cancelled".to_string());
            }
            Ok((
                relay_base_url,
                relay_invite_code,
                local_host,
                tailnet_ip,
                cert,
                tls_config,
                listener,
            ))
        }
        .await;
        let (
            relay_base_url,
            relay_invite_code,
            local_host,
            tailnet_ip,
            cert,
            tls_config,
            listener,
        ) = match setup {
            Ok(setup) => setup,
            Err(error) => {
                self.abandon_enable(generation);
                return Err(error);
            }
        };
        let url = format!("https://{local_host}:{DEFAULT_MOBILE_PORT}");
        let tailnet_url = tailnet_ip.map(|ip| format!("https://{ip}:{DEFAULT_MOBILE_PORT}"));
        let relay_enabled = relay_base_url.is_some();
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        let (observer_shutdown_tx, observer_shutdown_rx) = oneshot::channel();
        let publisher = relay_enabled.then(|| {
            crate::mobile_relay::WakePublisher::start(
                Arc::clone(&self.relay_secrets),
                crate::mobile_relay::PublisherTiming::default(),
            )
        });
        {
            let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
            if !runtime.enabling || runtime.generation != generation {
                drop(runtime);
                if let Some(publisher) = publisher {
                    publisher.stop();
                }
                return Err("Mobile enable was cancelled".into());
            }
            runtime.enabled = true;
            runtime.enabling = false;
            runtime.url = Some(url);
            runtime.tailnet_url = tailnet_url;
            runtime.certificate_fingerprint = Some(cert.fingerprint);
            runtime.shutdown = Some(shutdown_tx);
            runtime.observer_shutdown = Some(observer_shutdown_tx);
            runtime.relay_base_url = relay_base_url;
            runtime.relay_invite_code = relay_invite_code;
            runtime.relay_status = if relay_enabled {
                crate::mobile_relay::RelayPublisherStatus::Connected
            } else {
                crate::mobile_relay::RelayPublisherStatus::Disabled
            };
            runtime.publisher = publisher.clone();
        }

        let bridge = Arc::clone(self);
        let publisher_app = app.clone();
        let acceptor = TlsAcceptor::from(Arc::new(tls_config));
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { continue };
                        let acceptor = acceptor.clone();
                        let app = app.clone();
                        let bridge = Arc::clone(&bridge);
                        tokio::spawn(async move {
                            let Ok(stream) = acceptor.accept(stream).await else { return };
                            let service = service_fn(move |request| {
                                handle_mobile_request(request, app.clone(), Arc::clone(&bridge))
                            });
                            let _ = http1::Builder::new()
                                .serve_connection(TokioIo::new(stream), service)
                                .await;
                        });
                    }
                }
            }
        });
        if let Some(publisher) = publisher {
            spawn_wake_observer(
                Arc::clone(self),
                publisher_app,
                publisher,
                generation,
                observer_shutdown_rx,
            );
        }
        if !self.generation_is_enabled(generation) {
            return Err("Mobile enable was cancelled".into());
        }
        Ok(self.status())
    }

    pub fn disable(&self) -> Result<MobileBridgeStatus, String> {
        let mut stopping = self
            .publisher_stopping
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while *stopping {
            stopping = self
                .publisher_stopped
                .wait(stopping)
                .unwrap_or_else(|error| error.into_inner());
        }
        *stopping = true;
        drop(stopping);
        let (shutdown, observer_shutdown, publisher) = {
            let mut runtime = self
                .runtime
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            runtime.generation = runtime.generation.wrapping_add(1);
            runtime.enabled = false;
            runtime.enabling = false;
            runtime.pairing = None;
            runtime.url = None;
            runtime.tailnet_url = None;
            runtime.certificate_fingerprint = None;
            runtime.relay_base_url = None;
            runtime.relay_invite_code = None;
            runtime.relay_status = crate::mobile_relay::RelayPublisherStatus::Disabled;
            (
                runtime.shutdown.take(),
                runtime.observer_shutdown.take(),
                runtime.publisher.take(),
            )
        };
        if let Some(shutdown) = observer_shutdown {
            let _ = shutdown.send(());
        }
        if let Some(shutdown) = shutdown {
            let _ = shutdown.send(());
        }
        self.relay_changes.notify_one();
        if let Some(publisher) = publisher {
            publisher.stop();
        }
        *self
            .publisher_stopping
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = false;
        self.publisher_stopped.notify_all();
        self.presence
            .lock()
            .map_err(|error| error.to_string())?
            .clear();
        Ok(self.status())
    }

    #[allow(dead_code)]
    pub fn create_pairing(&self, scope: MobileDeviceScope) -> Result<MobilePairingInfo, String> {
        self.create_pairing_on(scope, MobileNetwork::Lan)
    }

    pub fn create_pairing_on(
        &self,
        scope: MobileDeviceScope,
        network: MobileNetwork,
    ) -> Result<MobilePairingInfo, String> {
        let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        if !runtime.enabled {
            return Err("Enable mobile access before pairing a device".into());
        }
        let now = chrono::Utc::now().timestamp();
        let code = uuid::Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase();
        let challenge = PairingChallenge::new(&code, now, scope);
        let lan_url = runtime.url.as_deref().ok_or("Mobile URL is unavailable")?;
        let url = select_mobile_url(lan_url, runtime.tailnet_url.as_deref(), network)?.to_string();
        let fingerprint = runtime
            .certificate_fingerprint
            .clone()
            .ok_or("Mobile certificate fingerprint is unavailable")?;
        let android_setup = android_setup_payload(&url, &code, scope, &fingerprint);
        let info = MobilePairingInfo {
            code,
            expires_at: challenge.expires_at,
            url,
            certificate_fingerprint: fingerprint,
            scope,
            network,
            android_setup,
        };
        runtime.pairing = Some(challenge);
        Ok(info)
    }

    pub fn revoke_devices(&self) -> Result<MobileBridgeStatus, String> {
        let publisher = self
            .runtime
            .lock()
            .map_err(|error| error.to_string())?
            .publisher
            .clone();
        if let Some(publisher) = publisher {
            let _ = publisher.clear();
        }
        self.devices
            .lock()
            .map_err(|error| error.to_string())?
            .revoke_all()?;
        let relay_secrets = self
            .relay_secrets
            .lock()
            .map_err(|error| error.to_string())?
            .take_all()?;
        self.relay_changes.notify_one();
        schedule_relay_deletions(relay_secrets);
        self.presence
            .lock()
            .map_err(|error| error.to_string())?
            .clear();
        Ok(self.status())
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<MobileBridgeStatus, String> {
        let publisher = self
            .runtime
            .lock()
            .map_err(|error| error.to_string())?
            .publisher
            .clone();
        if let Some(publisher) = publisher {
            let _ = publisher.revoke(device_id);
        }
        self.devices
            .lock()
            .map_err(|error| error.to_string())?
            .revoke_device(device_id)?;
        let relay_secret = self
            .relay_secrets
            .lock()
            .map_err(|error| error.to_string())?
            .take(device_id)?;
        self.relay_changes.notify_one();
        schedule_relay_deletions(relay_secret.into_iter().collect());
        self.presence
            .lock()
            .map_err(|error| error.to_string())?
            .remove(device_id);
        Ok(self.status())
    }
}

#[allow(dead_code)]
fn wake_envelope_for_secret(
    secret: &crate::mobile_relay::RelayDeviceSecret,
    issued_at: i64,
    nonce_hex: &str,
) -> Result<crate::wake_crypto::WakeEnvelope, String> {
    crate::wake_crypto::encrypt_wake(
        &secret.wake_key,
        &secret.channel_id,
        secret.next_sequence,
        issued_at,
        nonce_hex,
    )
    .map_err(|_| "Could not encrypt wake signal".to_string())
}

fn spawn_wake_observer(
    bridge: Arc<MobileBridgeState>,
    app: tauri::AppHandle,
    publisher: Arc<crate::mobile_relay::WakePublisher>,
    generation: u64,
    shutdown: oneshot::Receiver<()>,
) {
    tokio::spawn(run_wake_observer(
        bridge, app, publisher, generation, shutdown,
    ));
}

async fn run_wake_observer(
    bridge: Arc<MobileBridgeState>,
    app: tauri::AppHandle,
    publisher: Arc<crate::mobile_relay::WakePublisher>,
    generation: u64,
    mut shutdown: oneshot::Receiver<()>,
) {
    let changes = Arc::clone(&bridge.relay_changes);
    let event_changes = Arc::clone(&changes);
    let listener = app.listen("humhum://hook-event", move |_| event_changes.notify_one());
    let mut poll = tokio::time::interval(std::time::Duration::from_secs(1));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            _ = changes.notified() => {},
            _ = poll.tick() => {},
        }
        let active_base_url = {
            let runtime = bridge
                .runtime
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if !runtime.enabled || runtime.generation != generation {
                break;
            }
            runtime.relay_base_url.clone()
        };
        let Some(active_base_url) = active_base_url else {
            break;
        };
        let secrets = bridge
            .relay_secrets
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .all()
            .into_iter()
            .filter(|secret| secret.base_url == active_base_url.as_str())
            .collect::<Vec<_>>();
        let scopes = bridge
            .devices
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .devices
            .iter()
            .map(|device| (device.id.clone(), device.scope))
            .collect::<HashMap<_, _>>();
        for secret in &secrets {
            let Some(scope) = scopes.get(&secret.device_id).copied() else {
                continue;
            };
            let page = with_mobile_cursor(mobile_session_page(&app, scope).await);
            if let Some(cursor) = page["cursor"].as_str() {
                publisher.observe(&secret.device_id, cursor);
            }
        }
    }
    app.unlisten(listener);
}

fn select_mobile_url<'a>(
    lan_url: &'a str,
    tailnet_url: Option<&'a str>,
    network: MobileNetwork,
) -> Result<&'a str, String> {
    match network {
        MobileNetwork::Lan => Ok(lan_url),
        MobileNetwork::Tailnet => tailnet_url.ok_or_else(|| "Tailnet access is unavailable".into()),
    }
}

fn relay_base_from_config(
    config: &crate::config::MobileRelayConfig,
) -> Result<Option<crate::mobile_relay::RelayBaseUrl>, String> {
    if !config.enabled {
        return Ok(None);
    }
    let value = config
        .base_url
        .as_deref()
        .ok_or("Wake relay URL is required")?;
    crate::mobile_relay::RelayBaseUrl::parse(value).map(Some)
}

fn relay_invite_from_config(
    config: &crate::config::MobileRelayConfig,
) -> Result<Option<String>, String> {
    if !config.enabled {
        return Ok(None);
    }
    let value = config
        .invite_code
        .as_deref()
        .map(str::trim)
        .filter(|value| {
            (16..=256).contains(&value.len())
                && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
        })
        .ok_or("Anywhere beta invite code is required")?;
    Ok(Some(value.to_string()))
}

fn pair_success_value(
    token: &str,
    scope: MobileDeviceScope,
    wake_relay: Option<crate::mobile_relay::WakeRelayBundle>,
) -> serde_json::Value {
    let mut value = serde_json::json!({ "token": token, "scope": scope });
    if let (Some(object), Some(bundle)) = (value.as_object_mut(), wake_relay) {
        object.insert(
            "wake_relay".into(),
            serde_json::to_value(bundle).unwrap_or_default(),
        );
    }
    value
}

fn rollback_paired_device(bridge: &MobileBridgeState, device_id: &str) {
    let _ = bridge
        .devices
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .revoke_device(device_id);
    let _ = bridge
        .relay_secrets
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(device_id);
    bridge
        .presence
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(device_id);
    bridge.relay_changes.notify_one();
}

fn schedule_relay_deletions(secrets: Vec<crate::mobile_relay::RelayDeviceSecret>) {
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        return;
    };
    for secret in secrets {
        runtime.spawn(async move {
            let deleted = crate::mobile_relay::RelayBaseUrl::parse(&secret.base_url)
                .and_then(crate::mobile_relay::RelayClient::new);
            if let Ok(client) = deleted {
                if client.delete(&secret).await.is_err() {
                    log::warn!("Could not delete a wake relay channel");
                }
            }
        });
    }
}

fn android_setup_payload(
    url: &str,
    code: &str,
    scope: MobileDeviceScope,
    fingerprint: &str,
) -> String {
    let normalized_fingerprint: String = fingerprint
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .flat_map(char::to_uppercase)
        .collect();
    serde_json::json!({
        "version": 1,
        "url": url,
        "code": code,
        "scope": scope,
        "fingerprint": normalized_fingerprint,
    })
    .to_string()
}

struct MobileCertificate {
    cert_path: PathBuf,
    key_path: PathBuf,
    fingerprint: String,
}

fn ensure_certificate(humhum_dir: &Path) -> Result<MobileCertificate, String> {
    let cert_path = humhum_dir.join("mobile-cert.pem");
    let key_path = humhum_dir.join("mobile-key.pem");
    match (cert_path.exists(), key_path.exists()) {
        (true, false) | (false, true) => {
            return Err("Mobile TLS identity is incomplete; restore both certificate files".into())
        }
        _ => {}
    }
    if !cert_path.exists() {
        let output = std::process::Command::new("/usr/bin/openssl")
            .args([
                "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "3650", "-nodes",
                "-keyout",
            ])
            .arg(&key_path)
            .arg("-out")
            .arg(&cert_path)
            .args([
                "-subj",
                "/CN=HumHum Mobile",
                "-addext",
                "subjectAltName=DNS:humhum.local",
            ])
            .output()
            .map_err(|error| format!("Could not start OpenSSL: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not generate mobile TLS certificate: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
    }
    set_owner_only(&key_path)?;
    set_owner_only(&cert_path)?;
    let fingerprint_output = std::process::Command::new("/usr/bin/openssl")
        .args(["x509", "-in"])
        .arg(&cert_path)
        .args(["-noout", "-fingerprint", "-sha256"])
        .output()
        .map_err(|error| format!("Could not inspect mobile certificate: {error}"))?;
    if !fingerprint_output.status.success() {
        return Err("Could not calculate mobile certificate fingerprint".into());
    }
    let fingerprint = String::from_utf8_lossy(&fingerprint_output.stdout)
        .trim()
        .split_once('=')
        .map(|(_, value)| value.to_string())
        .ok_or("OpenSSL returned an invalid certificate fingerprint")?;
    Ok(MobileCertificate {
        cert_path,
        key_path,
        fingerprint,
    })
}

fn load_tls_config(cert_path: &Path, key_path: &Path) -> Result<rustls::ServerConfig, String> {
    let cert_file = std::fs::File::open(cert_path)
        .map_err(|error| format!("Could not open mobile certificate: {error}"))?;
    let key_file = std::fs::File::open(key_path)
        .map_err(|error| format!("Could not open mobile private key: {error}"))?;
    let certs = rustls_pemfile::certs(&mut BufReader::new(cert_file))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not parse mobile certificate: {error}"))?;
    let key = rustls_pemfile::private_key(&mut BufReader::new(key_file))
        .map_err(|error| format!("Could not parse mobile private key: {error}"))?
        .ok_or("Mobile private key is missing")?;
    rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|error| format!("Could not configure mobile TLS: {error}"))
}

fn local_lan_ip() -> Result<Ipv4Addr, String> {
    #[cfg(target_os = "macos")]
    for interface in ["en0", "en1"] {
        if let Ok(output) = std::process::Command::new("/usr/sbin/ipconfig")
            .args(["getifaddr", interface])
            .output()
        {
            if output.status.success() {
                if let Ok(ip) = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<Ipv4Addr>()
                {
                    if !ip.is_loopback() {
                        return Ok(ip);
                    }
                }
            }
        }
    }
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|error| format!("Could not inspect LAN address: {error}"))?;
    socket
        .connect((Ipv4Addr::new(8, 8, 8, 8), 80))
        .map_err(|error| format!("Could not resolve LAN address: {error}"))?;
    match socket.local_addr().map_err(|error| error.to_string())?.ip() {
        IpAddr::V4(ip) if !ip.is_loopback() => Ok(ip),
        _ => Err("No usable IPv4 LAN address was found".into()),
    }
}

fn local_lan_host() -> Result<String, String> {
    Ok(mobile_lan_host(local_lan_ip()?))
}

fn mobile_lan_host(ip: Ipv4Addr) -> String {
    ip.to_string()
}

async fn handle_mobile_request(
    request: Request<hyper::body::Incoming>,
    app: tauri::AppHandle,
    bridge: Arc<MobileBridgeState>,
) -> Result<Response<HttpBody>, Infallible> {
    let response = match (request.method(), request.uri().path()) {
        (&Method::GET, "/") => html_response(MOBILE_HTML),
        (&Method::POST, "/api/pair") => pair_device(request, &bridge).await,
        (&Method::DELETE, "/api/device") => revoke_mobile_device(&request, &bridge),
        (&Method::POST, "/api/presence") => report_mobile_presence(request, &bridge).await,
        (&Method::GET, "/api/events") => wait_for_mobile_event(&request, &app, &bridge).await,
        (&Method::GET, "/api/sessions") => {
            if let Some(scope) = request_scope(&request, &bridge) {
                json_response(
                    StatusCode::OK,
                    &with_mobile_cursor(mobile_session_page(&app, scope).await),
                )
            } else {
                json_error(StatusCode::UNAUTHORIZED, "Pair this device first")
            }
        }
        (&Method::POST, "/api/session/conversation") => {
            read_mobile_session_conversation(request, &app, &bridge).await
        }
        (&Method::POST, "/api/codex/approval") => {
            if !request_scope(&request, &bridge).is_some_and(MobileDeviceScope::allows_control) {
                json_error(StatusCode::FORBIDDEN, "This device is paired read-only")
            } else {
                resolve_mobile_codex_approval(request, &app).await
            }
        }
        (&Method::POST, "/api/codex/message") => {
            if !request_scope(&request, &bridge).is_some_and(MobileDeviceScope::allows_control) {
                json_error(StatusCode::FORBIDDEN, "This device is paired read-only")
            } else {
                send_mobile_codex_message(request, &app).await
            }
        }
        (&Method::POST, "/api/session/message") => {
            if !request_scope(&request, &bridge).is_some_and(MobileDeviceScope::allows_control) {
                json_error(StatusCode::FORBIDDEN, "This device is paired read-only")
            } else {
                send_mobile_agent_message(request, &app).await
            }
        }
        (&Method::POST, "/api/claude/permission") => {
            if !request_scope(&request, &bridge).is_some_and(MobileDeviceScope::allows_control) {
                json_error(StatusCode::FORBIDDEN, "This device is paired read-only")
            } else {
                resolve_mobile_claude_permission(request, &app).await
            }
        }
        (&Method::POST, "/api/hook/permission") => {
            if !request_scope(&request, &bridge).is_some_and(MobileDeviceScope::allows_control) {
                json_error(StatusCode::FORBIDDEN, "This device is paired read-only")
            } else {
                resolve_mobile_claude_permission(request, &app).await
            }
        }
        _ => json_error(StatusCode::NOT_FOUND, "Not found"),
    };
    Ok(with_security_headers(response))
}

async fn mobile_session_page(
    app: &tauri::AppHandle,
    scope: MobileDeviceScope,
) -> serde_json::Value {
    let mut hook_actions = std::collections::HashMap::<String, Vec<MobileApprovalSummary>>::new();
    if scope.allows_control() {
        if let Some(pending) = app.try_state::<crate::hook_server::PendingMap>() {
            for request in pending.lock().await.values() {
                if let Some(action) = mobile_hook_approval(&request.event) {
                    hook_actions
                        .entry(request.event.session_id.clone())
                        .or_default()
                        .push(action);
                }
            }
        }
    }
    let store = app.state::<Arc<Mutex<crate::session_store::SessionStore>>>();
    let codex = app.state::<Arc<crate::codex_bridge::CodexBridgeState>>();
    let home_dir = dirs::home_dir();
    let store = store.lock().unwrap_or_else(|error| error.into_inner());
    let mut sessions = codex
        .sessions()
        .iter()
        .map(|session| {
            let can_read_conversation = home_dir
                .as_deref()
                .zip(store.get_session_with_history(&session.session_id))
                .is_some_and(|(home, stored)| session_supports_mobile_conversation(stored, home));
            MobileSessionSummary::from_codex(session, scope.allows_control(), can_read_conversation)
        })
        .collect::<Vec<_>>();
    let known_ids = sessions
        .iter()
        .map(|session| session.id.clone())
        .collect::<std::collections::HashSet<_>>();
    sessions.extend(
        store
            .get_all_sessions_with_history()
            .into_iter()
            .filter(|session| !known_ids.contains(&session.session_id))
            .map(|session| {
                let can_read_conversation = home_dir
                    .as_deref()
                    .is_some_and(|home| session_supports_mobile_conversation(session, home));
                let mut summary = MobileSessionSummary::from_hook(
                    session,
                    scope.allows_control(),
                    can_read_conversation,
                );
                summary.pending_actions =
                    hook_actions.remove(&session.session_id).unwrap_or_default();
                summary.needs_attention |= !summary.pending_actions.is_empty();
                summary
            }),
    );
    sessions.sort_by(|left, right| {
        right
            .last_activity_at
            .cmp(&left.last_activity_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    sessions.truncate(30);
    serde_json::json!({ "scope": scope, "sessions": sessions })
}

fn with_mobile_cursor(mut page: serde_json::Value) -> serde_json::Value {
    let digest = Sha256::digest(serde_json::to_vec(&page).unwrap_or_default());
    let cursor = format!("{digest:x}");
    if let Some(object) = page.as_object_mut() {
        object.insert("cursor".into(), serde_json::Value::String(cursor));
    }
    page
}

async fn wait_for_mobile_event(
    request: &Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
    bridge: &Arc<MobileBridgeState>,
) -> Response<HttpBody> {
    let Some(token) = request_token(request).map(str::to_owned) else {
        return json_error(StatusCode::UNAUTHORIZED, "Pair this device first");
    };
    let Some(scope) = token_scope(&token, bridge) else {
        return json_error(StatusCode::UNAUTHORIZED, "Pair this device first");
    };
    let Some(expected_cursor) = event_cursor(request.uri().query()).map(str::to_owned) else {
        return json_error(StatusCode::BAD_REQUEST, "Event cursor is invalid");
    };
    let Ok(_permit) = Arc::clone(&bridge.event_waiters).try_acquire_owned() else {
        let mut response = json_error(StatusCode::TOO_MANY_REQUESTS, "Too many event waits");
        response
            .headers_mut()
            .insert(hyper::header::RETRY_AFTER, "1".parse().unwrap());
        return response;
    };

    for second in 0..=EVENT_WAIT_SECONDS {
        if token_scope(&token, bridge).is_none() {
            return json_error(StatusCode::UNAUTHORIZED, "Pair this device first");
        }
        let page = with_mobile_cursor(mobile_session_page(app, scope).await);
        let current_cursor = page["cursor"].as_str().unwrap_or_default();
        if current_cursor != expected_cursor {
            return json_response(StatusCode::OK, &event_signal(current_cursor, true));
        }
        if second == EVENT_WAIT_SECONDS {
            return json_response(StatusCode::OK, &event_signal(current_cursor, false));
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    unreachable!()
}

fn event_cursor(query: Option<&str>) -> Option<&str> {
    let mut cursors = query
        .unwrap_or_default()
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .filter_map(|(key, value)| (key == "cursor").then_some(value));
    let cursor = cursors.next()?;
    if cursors.next().is_some()
        || cursor.len() != 64
        || !cursor
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return None;
    }
    Some(cursor)
}

fn event_signal(cursor: &str, changed: bool) -> serde_json::Value {
    serde_json::json!({
        "cursor": cursor,
        "changed": changed,
        "retry_after_ms": 0
    })
}

fn revoke_mobile_device(
    request: &Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Response<HttpBody> {
    let Some(token) = request_token(request) else {
        return json_error(StatusCode::UNAUTHORIZED, "Pair this device first");
    };
    let device_id = bridge
        .devices
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .authorize_device(token)
        .map(|device| device.id);
    if let Some(device_id) = device_id.as_deref() {
        let publisher = bridge
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .publisher
            .clone();
        if let Some(publisher) = publisher {
            let _ = publisher.revoke(device_id);
        }
    }
    match bridge
        .devices
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .revoke_token(token)
    {
        Ok(()) => {
            if let Some(device_id) = device_id {
                let relay_secret = bridge
                    .relay_secrets
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .take(&device_id)
                    .ok()
                    .flatten();
                bridge.relay_changes.notify_one();
                schedule_relay_deletions(relay_secret.into_iter().collect());
                bridge
                    .presence
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .remove(&device_id);
            }
            json_response(StatusCode::OK, &serde_json::json!({ "status": "revoked" }))
        }
        Err(error) if error == "Paired mobile device not found" => {
            json_error(StatusCode::UNAUTHORIZED, "Pair this device first")
        }
        Err(_) => json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not revoke this device",
        ),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MobilePresenceRequest {
    mode: MobilePresenceMode,
}

async fn report_mobile_presence(
    request: Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Response<HttpBody> {
    let token = request_token(&request).map(str::to_owned);
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid presence report"),
    };
    match record_mobile_presence(
        token.as_deref(),
        &body,
        bridge,
        chrono::Utc::now().timestamp(),
    ) {
        Ok(value) => json_response(StatusCode::OK, &value),
        Err(StatusCode::UNAUTHORIZED) => {
            json_error(StatusCode::UNAUTHORIZED, "Pair this device first")
        }
        Err(_) => json_error(StatusCode::BAD_REQUEST, "Invalid presence report"),
    }
}

fn record_mobile_presence(
    token: Option<&str>,
    body: &[u8],
    bridge: &MobileBridgeState,
    now: i64,
) -> Result<serde_json::Value, StatusCode> {
    if body.len() > 256 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let token = token.ok_or(StatusCode::UNAUTHORIZED)?;
    let device = bridge
        .devices
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .authorize_device(token)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let input: MobilePresenceRequest =
        serde_json::from_slice(body).map_err(|_| StatusCode::BAD_REQUEST)?;
    bridge
        .presence
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .report(&device.id, input.mode, now);
    Ok(serde_json::json!({"status": "recorded"}))
}

#[derive(Deserialize)]
struct PairRequest {
    code: String,
    device_name: Option<String>,
}

async fn pair_device(
    request: Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Response<HttpBody> {
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid pairing request"),
    };
    if body.len() > 4096 {
        return json_error(StatusCode::BAD_REQUEST, "Invalid pairing request");
    }
    let input: PairRequest = match serde_json::from_slice(&body) {
        Ok(input) => input,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid pairing request"),
    };
    let challenge_scope = {
        let mut runtime = match bridge.runtime.lock() {
            Ok(runtime) => runtime,
            Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Pairing unavailable"),
        };
        let Some(challenge) = runtime.pairing.as_mut() else {
            return json_error(StatusCode::UNAUTHORIZED, "Start pairing on the Mac first");
        };
        if let Err(error) = challenge.verify(&input.code, chrono::Utc::now().timestamp()) {
            return json_error(StatusCode::UNAUTHORIZED, &error);
        }
        let scope = challenge.scope;
        runtime.pairing = None;
        scope
    };
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let name = input.device_name.as_deref().unwrap_or("Mobile browser");
    let device = match bridge
        .devices
        .lock()
        .map_err(|error| error.to_string())
        .and_then(|mut devices| devices.add_device(name, &token, challenge_scope))
    {
        Ok(device) => device,
        Err(_) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not save this device",
            )
        }
    };
    let (relay_base_url, relay_invite_code) = {
        let runtime = bridge
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        (runtime.relay_base_url.clone(), runtime.relay_invite_code.clone())
    };
    let wake_relay = if let (Some(base_url), Some(invite_code)) =
        (relay_base_url, relay_invite_code)
    {
        let client = match crate::mobile_relay::RelayClient::new(base_url) {
            Ok(client) => client,
            Err(_) => {
                rollback_paired_device(bridge, &device.id);
                return json_error(StatusCode::BAD_GATEWAY, "Wake relay pairing failed");
            }
        };
        let provision = match client.register(&device.id, &invite_code).await {
            Ok(provision) => provision,
            Err(_) => {
                rollback_paired_device(bridge, &device.id);
                return json_error(StatusCode::BAD_GATEWAY, "Wake relay pairing failed");
            }
        };
        if bridge
            .relay_secrets
            .lock()
            .map_err(|error| error.to_string())
            .and_then(|mut secrets| secrets.put(provision.desktop.clone()))
            .is_err()
        {
            let _ = client.delete(&provision.desktop).await;
            rollback_paired_device(bridge, &device.id);
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Wake relay pairing failed",
            );
        }
        bridge.relay_changes.notify_one();
        Some(provision.android)
    } else {
        None
    };
    json_response(
        StatusCode::OK,
        &pair_success_value(&token, challenge_scope, wake_relay),
    )
}

fn request_scope(
    request: &Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Option<MobileDeviceScope> {
    request_token(request).and_then(|token| token_scope(token, bridge))
}

fn token_scope(token: &str, bridge: &MobileBridgeState) -> Option<MobileDeviceScope> {
    bridge
        .devices
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .authorize(token)
}

fn request_token(request: &Request<hyper::body::Incoming>) -> Option<&str> {
    request
        .headers()
        .get(hyper::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| !token.is_empty())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MobileConversationError {
    Unauthorized,
    BadRequest,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct MobileConversationMessage {
    role: crate::transcript_reader::TranscriptRole,
    text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct MobileConversationResponse {
    session_id: String,
    messages: Vec<MobileConversationMessage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MobileConversationRequest {
    session_id: String,
}

impl<'de> Deserialize<'de> for MobileConversationRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RequestVisitor;

        impl<'de> Visitor<'de> for RequestVisitor {
            type Value = MobileConversationRequest;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(r#"{"session_id":"..."}"#)
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut session_id = None;
                while let Some(key) = map.next_key::<String>()? {
                    match key.as_str() {
                        "session_id" => {
                            if session_id.is_some() {
                                return Err(de::Error::duplicate_field("session_id"));
                            }
                            session_id = Some(map.next_value::<String>()?);
                        }
                        _ => return Err(de::Error::unknown_field(&key, &["session_id"])),
                    }
                }
                Ok(MobileConversationRequest {
                    session_id: session_id.ok_or_else(|| de::Error::missing_field("session_id"))?,
                })
            }
        }

        deserializer.deserialize_map(RequestVisitor)
    }
}

async fn read_mobile_session_conversation(
    request: Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
    bridge: &Arc<MobileBridgeState>,
) -> Response<HttpBody> {
    let Some(scope) = request_scope(&request, bridge) else {
        return json_error(StatusCode::UNAUTHORIZED, "Pair this device first");
    };
    let body = match collect_bounded_body(request.into_body(), MAX_CONVERSATION_REQUEST_BYTES).await
    {
        Ok(body) => body,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid conversation request"),
    };
    let Some(home_dir) = dirs::home_dir() else {
        return json_error(StatusCode::NOT_FOUND, "Conversation unavailable");
    };
    let store = app.state::<Arc<std::sync::Mutex<crate::session_store::SessionStore>>>();
    let store = store.lock().unwrap_or_else(|error| error.into_inner());
    match mobile_conversation_from_request(Some(scope), &body, &store, &home_dir) {
        Ok(response) => json_response(
            StatusCode::OK,
            &serde_json::to_value(response).unwrap_or_default(),
        ),
        Err(MobileConversationError::Unauthorized) => {
            json_error(StatusCode::UNAUTHORIZED, "Pair this device first")
        }
        Err(MobileConversationError::BadRequest) => {
            json_error(StatusCode::BAD_REQUEST, "Invalid conversation request")
        }
        Err(MobileConversationError::Unavailable) => {
            json_error(StatusCode::NOT_FOUND, "Conversation unavailable")
        }
    }
}

async fn collect_bounded_body<B>(mut body: B, max_bytes: usize) -> Result<Bytes, ()>
where
    B: Body<Data = Bytes> + Unpin,
{
    if body.size_hint().lower() > max_bytes as u64 {
        return Err(());
    }
    let mut output = Vec::with_capacity(
        usize::try_from(body.size_hint().lower())
            .unwrap_or(max_bytes)
            .min(max_bytes),
    );
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|_| ())?;
        let Ok(data) = frame.into_data() else {
            continue;
        };
        let remaining = max_bytes.checked_sub(output.len()).ok_or(())?;
        if data.len() > remaining {
            return Err(());
        }
        output.extend_from_slice(&data);
    }
    Ok(Bytes::from(output))
}

fn mobile_conversation_from_request(
    scope: Option<MobileDeviceScope>,
    body: &[u8],
    store: &crate::session_store::SessionStore,
    home_dir: &Path,
) -> Result<MobileConversationResponse, MobileConversationError> {
    if scope.is_none() {
        return Err(MobileConversationError::Unauthorized);
    }
    let request = parse_mobile_conversation_request(body)?;
    let session = store
        .get_session_with_history(&request.session_id)
        .ok_or(MobileConversationError::Unavailable)?;
    let transcript_path = canonical_transcript_for_session(session, home_dir)
        .ok_or(MobileConversationError::Unavailable)?;
    let signals = crate::transcript_reader::parse_transcript_signals(&transcript_path)
        .map_err(|_| MobileConversationError::Unavailable)?;
    Ok(bound_mobile_conversation_response(
        MobileConversationResponse {
            session_id: request.session_id,
            messages: signals
                .messages
                .iter()
                .filter_map(project_mobile_conversation_message)
                .collect(),
        },
    ))
}

fn parse_mobile_conversation_request(
    body: &[u8],
) -> Result<MobileConversationRequest, MobileConversationError> {
    if body.len() > MAX_CONVERSATION_REQUEST_BYTES {
        return Err(MobileConversationError::BadRequest);
    }
    let request: MobileConversationRequest =
        serde_json::from_slice(body).map_err(|_| MobileConversationError::BadRequest)?;
    let session_id_len = request.session_id.chars().count();
    if request.session_id.trim().is_empty() || session_id_len > MAX_CONVERSATION_ID_CHARS {
        return Err(MobileConversationError::BadRequest);
    }
    Ok(request)
}

fn session_supports_mobile_conversation(
    session: &crate::session_store::Session,
    home_dir: &Path,
) -> bool {
    canonical_transcript_for_session(session, home_dir).is_some()
}

fn canonical_transcript_for_session(
    session: &crate::session_store::Session,
    home_dir: &Path,
) -> Option<PathBuf> {
    let transcript_path = Path::new(session.transcript_path.as_deref()?);
    if !transcript_path.is_absolute() {
        return None;
    }
    let canonical_root = std::fs::canonicalize(provider_transcript_root(
        session.client_type.as_str(),
        home_dir,
    )?)
    .ok()?;
    let canonical_path = std::fs::canonicalize(transcript_path).ok()?;
    if !canonical_path.starts_with(&canonical_root) {
        return None;
    }
    std::fs::metadata(&canonical_path)
        .ok()
        .filter(|metadata| metadata.is_file())?;
    Some(canonical_path)
}

fn provider_transcript_root(provider: &str, home_dir: &Path) -> Option<PathBuf> {
    match provider {
        "codex" => Some(home_dir.join(".codex/sessions")),
        "claude" | "claude-code" => Some(home_dir.join(".claude/projects")),
        "openclaw" => Some(home_dir.join(".openclaw/agents")),
        _ => None,
    }
}

fn project_mobile_conversation_message(
    message: &crate::transcript_reader::TranscriptMessage,
) -> Option<MobileConversationMessage> {
    let compacted = crate::user_safe_text::project_user_safe_text(&message.text);
    if compacted.is_empty() || compacted == "[本机路径]" {
        return None;
    }
    Some(MobileConversationMessage {
        role: message.role,
        text: truncate_scalar_value(&compacted, MAX_CONVERSATION_TEXT_CHARS),
    })
}

fn bound_mobile_conversation_response(
    mut response: MobileConversationResponse,
) -> MobileConversationResponse {
    while serde_json::to_vec(&response)
        .map(|bytes| bytes.len() > MAX_CONVERSATION_RESPONSE_BYTES)
        .unwrap_or(false)
        && !response.messages.is_empty()
    {
        response.messages.remove(0);
    }
    response
}

fn truncate_scalar_value(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[derive(Deserialize)]
struct MobileApprovalRequest {
    approval_id: String,
    decision: String,
}

async fn resolve_mobile_codex_approval(
    request: Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
) -> Response<HttpBody> {
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid approval request"),
    };
    if body.len() > 4096 {
        return json_error(StatusCode::BAD_REQUEST, "Invalid approval request");
    }
    let input: MobileApprovalRequest = match serde_json::from_slice(&body) {
        Ok(input) => input,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid approval request"),
    };
    let decision = match input.decision.as_str() {
        "allow_once" => crate::codex_bridge::ApprovalDecision::AllowOnce,
        "deny" => crate::codex_bridge::ApprovalDecision::Deny,
        _ => return json_error(StatusCode::BAD_REQUEST, "Unsupported approval decision"),
    };
    let codex = app.state::<Arc<crate::codex_bridge::CodexBridgeState>>();
    match codex.resolve_approval(&input.approval_id, decision).await {
        Ok(()) => json_response(StatusCode::OK, &serde_json::json!({ "status": "resolved" })),
        Err(error) => json_error(StatusCode::CONFLICT, &error.to_string()),
    }
}

#[derive(Deserialize)]
struct MobileMessageRequest {
    thread_id: String,
    message: String,
}

async fn send_mobile_codex_message(
    request: Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
) -> Response<HttpBody> {
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid message request"),
    };
    if body.len() > 24_000 {
        return json_error(StatusCode::BAD_REQUEST, "Invalid message request");
    }
    let input: MobileMessageRequest = match serde_json::from_slice(&body) {
        Ok(input) => input,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid message request"),
    };
    let codex = app
        .state::<Arc<crate::codex_bridge::CodexBridgeState>>()
        .inner()
        .clone();
    let queue = app
        .state::<Arc<std::sync::Mutex<crate::intervention_queue::InterventionQueue>>>()
        .inner()
        .clone();
    match crate::commands::enqueue_and_deliver_codex_message(
        &codex,
        &queue,
        &input.thread_id,
        &input.message,
    )
    .await
    {
        Ok(receipt) => json_response(
            StatusCode::OK,
            &serde_json::to_value(receipt).unwrap_or_default(),
        ),
        Err(error) => json_error(StatusCode::BAD_REQUEST, &error),
    }
}

#[derive(Deserialize)]
struct MobileAgentMessageRequest {
    session_id: String,
    provider: String,
    message: String,
}

async fn send_mobile_agent_message(
    request: Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
) -> Response<HttpBody> {
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid message request"),
    };
    if body.len() > 24_000 {
        return json_error(StatusCode::BAD_REQUEST, "Invalid message request");
    }
    let input: MobileAgentMessageRequest = match serde_json::from_slice(&body) {
        Ok(input) => input,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid message request"),
    };
    if input.provider == "codex" {
        let codex = app
            .state::<Arc<crate::codex_bridge::CodexBridgeState>>()
            .inner()
            .clone();
        let queue = app
            .state::<Arc<std::sync::Mutex<crate::intervention_queue::InterventionQueue>>>()
            .inner()
            .clone();
        return match crate::commands::enqueue_and_deliver_codex_message(
            &codex,
            &queue,
            &input.session_id,
            &input.message,
        )
        .await
        {
            Ok(receipt) => json_response(
                StatusCode::OK,
                &serde_json::to_value(receipt).unwrap_or_default(),
            ),
            Err(error) => json_error(StatusCode::BAD_REQUEST, &error),
        };
    }

    let provider = match input.provider.as_str() {
        "claude" | "claude-code" => crate::intervention_queue::InterventionProvider::Claude,
        "opencode" => crate::intervention_queue::InterventionProvider::OpenCode,
        _ => return json_error(StatusCode::BAD_REQUEST, "Unsupported Agent provider"),
    };
    let store = app
        .state::<Arc<std::sync::Mutex<crate::session_store::SessionStore>>>()
        .inner()
        .clone();
    let queue = app
        .state::<Arc<std::sync::Mutex<crate::intervention_queue::InterventionQueue>>>()
        .inner()
        .clone();
    match crate::commands::enqueue_and_deliver_cli_message(
        &store,
        &queue,
        provider,
        &input.session_id,
        &input.message,
    )
    .await
    {
        Ok(receipt) => json_response(
            StatusCode::OK,
            &serde_json::to_value(receipt).unwrap_or_default(),
        ),
        Err(error) => json_error(StatusCode::BAD_REQUEST, &error),
    }
}

#[derive(Deserialize)]
struct MobileClaudePermissionRequest {
    event_id: String,
    decision: String,
}

async fn resolve_mobile_claude_permission(
    request: Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
) -> Response<HttpBody> {
    let body = match request.into_body().collect().await {
        Ok(body) => body.to_bytes(),
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid permission request"),
    };
    if body.len() > 4096 {
        return json_error(StatusCode::BAD_REQUEST, "Invalid permission request");
    }
    let input: MobileClaudePermissionRequest = match serde_json::from_slice(&body) {
        Ok(input) => input,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid permission request"),
    };
    let behavior = match input.decision.as_str() {
        "allow_once" => "allow",
        "deny" => "deny",
        _ => return json_error(StatusCode::BAD_REQUEST, "Unsupported permission decision"),
    };
    let Some(pending) = app.try_state::<crate::hook_server::PendingMap>() else {
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Claude permission bridge is starting",
        );
    };
    match crate::commands::resolve_hook_permission(
        pending.inner(),
        &input.event_id,
        behavior,
        None,
        None,
    )
    .await
    {
        Ok(()) => json_response(StatusCode::OK, &serde_json::json!({ "status": "resolved" })),
        Err(error) => json_error(StatusCode::CONFLICT, &error),
    }
}

fn json_response(status: StatusCode, value: &serde_json::Value) -> Response<HttpBody> {
    let mut response = Response::new(Full::new(Bytes::from(value.to_string())));
    *response.status_mut() = status;
    response.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        "application/json; charset=utf-8".parse().unwrap(),
    );
    response
}

fn json_error(status: StatusCode, message: &str) -> Response<HttpBody> {
    json_response(status, &serde_json::json!({ "error": message }))
}

fn html_response(html: &'static str) -> Response<HttpBody> {
    let mut response = Response::new(Full::new(Bytes::from_static(html.as_bytes())));
    response.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        "text/html; charset=utf-8".parse().unwrap(),
    );
    response
}

fn with_security_headers(mut response: Response<HttpBody>) -> Response<HttpBody> {
    let headers = response.headers_mut();
    headers.insert("cache-control", "no-store".parse().unwrap());
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("x-frame-options", "DENY".parse().unwrap());
    headers.insert(
        "content-security-policy",
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
            .parse()
            .unwrap(),
    );
    response
}

const MOBILE_HTML: &str = include_str!("mobile/index.html");

#[derive(Debug, Clone)]
struct PairingChallenge {
    code: String,
    expires_at: i64,
    failed_attempts: u8,
    scope: MobileDeviceScope,
}

impl PairingChallenge {
    fn new(code: &str, now: i64, scope: MobileDeviceScope) -> Self {
        Self {
            code: code.to_ascii_uppercase(),
            expires_at: now + PAIRING_TTL_SECONDS,
            failed_attempts: 0,
            scope,
        }
    }

    fn verify(&mut self, candidate: &str, now: i64) -> Result<(), String> {
        if now >= self.expires_at {
            return Err("Pairing code expired".into());
        }
        if self.failed_attempts >= MAX_PAIRING_ATTEMPTS {
            return Err("Pairing code locked after too many attempts".into());
        }
        if !constant_time_eq(
            self.code.as_bytes(),
            candidate.trim().to_ascii_uppercase().as_bytes(),
        ) {
            self.failed_attempts = self.failed_attempts.saturating_add(1);
            return Err("Pairing code is invalid".into());
        }
        Ok(())
    }

    fn is_active(&self, now: i64) -> bool {
        now < self.expires_at && self.failed_attempts < MAX_PAIRING_ATTEMPTS
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MobileDevice {
    id: String,
    name: String,
    token_digest: String,
    paired_at: String,
    #[serde(default = "default_mobile_scope")]
    scope: MobileDeviceScope,
}

struct MobileDeviceStore {
    path: PathBuf,
    devices: Vec<MobileDevice>,
}

impl MobileDeviceStore {
    fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(humhum_dir)
            .map_err(|error| format!("Could not create HUMHUM directory: {error}"))?;
        let path = humhum_dir.join("mobile-devices.json");
        let devices = if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|error| format!("Could not read mobile devices: {error}"))?;
            if content.trim().is_empty() {
                Vec::new()
            } else {
                serde_json::from_str(&content)
                    .map_err(|error| format!("Could not parse mobile devices: {error}"))?
            }
        } else {
            Vec::new()
        };
        Ok(Self { path, devices })
    }

    fn add_device(
        &mut self,
        name: &str,
        raw_token: &str,
        scope: MobileDeviceScope,
    ) -> Result<MobileDevice, String> {
        let device = MobileDevice {
            id: uuid::Uuid::new_v4().to_string(),
            name: sanitize_device_name(name),
            token_digest: digest_token(raw_token),
            paired_at: chrono::Utc::now().to_rfc3339(),
            scope,
        };
        self.devices.push(device.clone());
        self.persist()?;
        Ok(device)
    }

    fn authorize(&self, raw_token: &str) -> Option<MobileDeviceScope> {
        self.authorize_device(raw_token).map(|device| device.scope)
    }

    fn authorize_device(&self, raw_token: &str) -> Option<MobileDeviceAuth> {
        let candidate = digest_token(raw_token);
        self.devices
            .iter()
            .find(|device| constant_time_eq(device.token_digest.as_bytes(), candidate.as_bytes()))
            .map(|device| MobileDeviceAuth {
                id: device.id.clone(),
                scope: device.scope,
            })
    }

    #[allow(dead_code)]
    fn summaries(&self) -> Vec<MobileDeviceSummary> {
        self.devices
            .iter()
            .map(|device| MobileDeviceSummary {
                id: device.id.clone(),
                name: device.name.clone(),
                paired_at: device.paired_at.clone(),
                scope: device.scope,
                presence_mode: None,
                last_seen_at: None,
            })
            .collect()
    }

    fn summaries_with_presence(
        &self,
        presence: &MobilePresenceStore,
        now: i64,
    ) -> Vec<MobileDeviceSummary> {
        self.devices
            .iter()
            .map(|device| {
                let fresh = presence.fresh(&device.id, now);
                MobileDeviceSummary {
                    id: device.id.clone(),
                    name: device.name.clone(),
                    paired_at: device.paired_at.clone(),
                    scope: device.scope,
                    presence_mode: fresh.map(|value| value.mode),
                    last_seen_at: fresh.and_then(|value| {
                        chrono::DateTime::from_timestamp(value.recorded_at, 0)
                            .map(|timestamp| timestamp.to_rfc3339())
                    }),
                }
            })
            .collect()
    }

    fn revoke_device(&mut self, device_id: &str) -> Result<(), String> {
        let before = self.devices.len();
        self.devices.retain(|device| device.id != device_id);
        if self.devices.len() == before {
            return Err("Paired mobile device not found".into());
        }
        self.persist()
    }

    fn revoke_token(&mut self, raw_token: &str) -> Result<(), String> {
        let candidate = digest_token(raw_token);
        let before = self.devices.len();
        self.devices.retain(|device| {
            !constant_time_eq(device.token_digest.as_bytes(), candidate.as_bytes())
        });
        if self.devices.len() == before {
            return Err("Paired mobile device not found".into());
        }
        self.persist()
    }

    fn revoke_all(&mut self) -> Result<(), String> {
        self.devices.clear();
        self.persist()
    }

    fn persist(&self) -> Result<(), String> {
        let content = serde_json::to_vec_pretty(&self.devices)
            .map_err(|error| format!("Could not serialize mobile devices: {error}"))?;
        let temp_path = self.path.with_extension("json.tmp");
        std::fs::write(&temp_path, content)
            .map_err(|error| format!("Could not write mobile devices: {error}"))?;
        set_owner_only(&temp_path)?;
        std::fs::rename(&temp_path, &self.path)
            .map_err(|error| format!("Could not replace mobile devices: {error}"))?;
        set_owner_only(&self.path)
    }
}

#[derive(Debug, Clone, Serialize)]
struct MobileSessionSummary {
    id: String,
    agent: String,
    project: String,
    status: String,
    last_activity_at: String,
    needs_attention: bool,
    pending_actions: Vec<MobileApprovalSummary>,
    can_message: bool,
    can_read_conversation: bool,
}

#[derive(Debug, Clone, Serialize)]
struct MobileApprovalSummary {
    id: String,
    provider: String,
    operation: String,
    summary: String,
}

impl MobileSessionSummary {
    fn from_hook(
        session: &crate::session_store::Session,
        include_actions: bool,
        can_read_conversation: bool,
    ) -> Self {
        Self {
            id: session.session_id.clone(),
            agent: session.client_type.clone(),
            project: session
                .project_name
                .clone()
                .unwrap_or_else(|| "未命名项目".into()),
            status: format!("{:?}", session.status).to_ascii_lowercase(),
            last_activity_at: session.last_event_at.clone(),
            needs_attention: session.has_pending_permission,
            pending_actions: Vec::new(),
            can_message: include_actions
                && matches!(session.client_type.as_str(), "claude-code" | "opencode")
                && session.status != crate::session_store::SessionStatus::Completed,
            can_read_conversation,
        }
    }

    fn from_codex(
        session: &crate::hexa_protocol::HexaSessionProjection,
        include_actions: bool,
        can_read_conversation: bool,
    ) -> Self {
        Self {
            id: session.session_id.clone(),
            agent: session.provider.clone(),
            project: session
                .project_name
                .clone()
                .unwrap_or_else(|| "未命名项目".into()),
            status: format!("{:?}", session.status).to_ascii_lowercase(),
            last_activity_at: session.last_activity_at.clone(),
            needs_attention: !session.pending_approvals.is_empty(),
            pending_actions: if include_actions {
                session
                    .pending_approvals
                    .iter()
                    .map(|approval| MobileApprovalSummary {
                        id: approval.approval_id.clone(),
                        provider: "codex".into(),
                        operation: format!("{:?}", approval.operation).to_ascii_lowercase(),
                        summary: approval.summary.chars().take(240).collect(),
                    })
                    .collect()
            } else {
                Vec::new()
            },
            can_message: include_actions,
            can_read_conversation,
        }
    }
}

fn mobile_hook_approval(event: &crate::event_bus::HookEvent) -> Option<MobileApprovalSummary> {
    if event.hook_event_name != "PermissionRequest" {
        return None;
    }
    let tool = event
        .payload
        .get("tool_name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Agent action");
    let input = event.payload.get("tool_input");
    let detail = match tool {
        "Bash" => input
            .and_then(|value| value.get("command"))
            .and_then(serde_json::Value::as_str)
            .map(|command| command.chars().take(180).collect::<String>()),
        "Write" | "Edit" | "Read" => input
            .and_then(|value| value.get("file_path"))
            .and_then(serde_json::Value::as_str)
            .and_then(|path| std::path::Path::new(path).file_name())
            .map(|name| name.to_string_lossy().to_string()),
        _ => None,
    };
    Some(MobileApprovalSummary {
        id: event.id.clone(),
        provider: match event.client_type.as_str() {
            "claude-code" => "claude".into(),
            other => other.to_string(),
        },
        operation: tool.to_string(),
        summary: detail
            .map(|detail| format!("{tool} · {detail}"))
            .unwrap_or_else(|| tool.to_string()),
    })
}

fn digest_token(raw_token: &str) -> String {
    format!("{:x}", Sha256::digest(raw_token.as_bytes()))
}

fn sanitize_device_name(name: &str) -> String {
    let name: String = name.trim().chars().take(80).collect();
    if name.is_empty() {
        "Mobile browser".into()
    } else {
        name
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn set_owner_only(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path)
            .map_err(|error| format!("Could not inspect mobile device store: {error}"))?
            .permissions();
        permissions.set_mode(0o600);
        std::fs::set_permissions(path, permissions)
            .map_err(|error| format!("Could not protect mobile device store: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::HookEvent;
    use hyper::body::{Body, Frame, SizeHint};
    use serde_json::json;
    use std::collections::VecDeque;
    use std::pin::Pin;
    use std::task::{Context, Poll};

    struct ChunkedBody {
        chunks: VecDeque<Bytes>,
    }

    impl Body for ChunkedBody {
        type Data = Bytes;
        type Error = Infallible;

        fn poll_frame(
            mut self: Pin<&mut Self>,
            _context: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
            Poll::Ready(self.chunks.pop_front().map(|chunk| Ok(Frame::data(chunk))))
        }

        fn size_hint(&self) -> SizeHint {
            SizeHint::default()
        }
    }

    fn hook_session(
        session_id: &str,
        client_type: &str,
        transcript_path: Option<&Path>,
    ) -> crate::session_store::Session {
        crate::session_store::Session {
            session_id: session_id.into(),
            client_type: client_type.into(),
            transcript_path: transcript_path.map(|path| path.to_string_lossy().into_owned()),
            cwd: Some("/tmp/humhum".into()),
            project_name: Some("humhum".into()),
            started_at: "2026-07-12T00:00:00Z".into(),
            last_event_at: "2026-07-12T00:01:00Z".into(),
            event_count: 2,
            status: crate::session_store::SessionStatus::Active,
            last_hook_message: None,
            last_tool_name: None,
            recent_tools: Vec::new(),
            event_names: vec!["Notification".into()],
            has_pending_permission: false,
            route: None,
        }
    }

    fn insert_hook_session(
        store: &mut crate::session_store::SessionStore,
        session_id: &str,
        client_type: &str,
        transcript_path: Option<&Path>,
    ) {
        store.update_from_event(&HookEvent {
            id: format!("event-{session_id}"),
            hook_event_name: "Notification".into(),
            session_id: session_id.into(),
            transcript_path: transcript_path.map(|path| path.to_string_lossy().into_owned()),
            cwd: Some("/tmp/humhum".into()),
            client_type: client_type.into(),
            payload: json!({}),
            timestamp: "2026-07-12T00:00:00Z".into(),
        });
    }

    fn write_lines(path: &Path, lines: &[String]) {
        let body = lines.join("\n");
        std::fs::write(path, format!("{body}\n")).unwrap();
    }

    #[tokio::test]
    async fn bounded_body_reader_rejects_chunked_overflow_before_collecting_the_rest() {
        let body = ChunkedBody {
            chunks: VecDeque::from([
                Bytes::from(vec![b'a'; 3_000]),
                Bytes::from(vec![b'b'; 1_097]),
                Bytes::from_static(b"not-consumed"),
            ]),
        };

        assert!(collect_bounded_body(body, MAX_CONVERSATION_REQUEST_BYTES)
            .await
            .is_err());
    }

    #[test]
    fn scoped_mobile_cursor_is_stable_and_changes_with_visible_state() {
        let first = serde_json::json!({
            "scope": "read",
            "sessions": [{
                "id": "session-1",
                "agent": "codex",
                "project": "humhum",
                "status": "idle"
            }]
        });
        let identical = first.clone();
        let changed = serde_json::json!({
            "scope": "read",
            "sessions": [{
                "id": "session-1",
                "agent": "codex",
                "project": "humhum",
                "status": "active"
            }]
        });

        let first = with_mobile_cursor(first);
        let identical = with_mobile_cursor(identical);
        let changed = with_mobile_cursor(changed);

        let cursor = first["cursor"].as_str().unwrap();
        assert!(cursor
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
        assert_eq!(cursor.len(), 64);
        assert_eq!(first["cursor"], identical["cursor"]);
        assert_ne!(first["cursor"], changed["cursor"]);
    }

    #[test]
    fn scoped_mobile_cursor_response_contains_no_private_source_fields() {
        let page = with_mobile_cursor(serde_json::json!({
            "scope": "control",
            "sessions": [{
                "id": "session-1",
                "agent": "claude-code",
                "project": "humhum",
                "status": "waiting"
            }]
        }));
        let serialized = page.to_string();

        assert!(!serialized.contains("/Users/private/project"));
        assert!(!serialized.contains("transcript_path"));
        assert!(!serialized.contains("private-message-sentinel"));
        assert_eq!(page["cursor"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn event_cursor_accepts_only_exact_lowercase_sha256_query_values() {
        let cursor = "ab".repeat(32);
        let query = format!("cursor={cursor}");

        assert_eq!(event_cursor(Some(&query)), Some(cursor.as_str()));
        assert_eq!(
            event_cursor(Some(&format!("mode=wait&{query}"))),
            Some(cursor.as_str())
        );
        assert_eq!(event_cursor(None), None);
        assert_eq!(event_cursor(Some("")), None);
        assert_eq!(event_cursor(Some("cursor=abc")), None);
        assert_eq!(
            event_cursor(Some(&format!("cursor={}", cursor.to_uppercase()))),
            None
        );
        assert_eq!(
            event_cursor(Some(&format!("cursor={cursor}&cursor={cursor}"))),
            None
        );
    }

    #[test]
    fn event_signal_contains_only_wake_metadata() {
        let cursor = "cd".repeat(32);
        let signal = event_signal(&cursor, true);
        let object = signal.as_object().unwrap();

        assert_eq!(object.len(), 3);
        assert_eq!(signal["cursor"], cursor);
        assert_eq!(signal["changed"], true);
        assert_eq!(signal["retry_after_ms"], 0);
        assert!(!signal.to_string().contains("session"));
        assert!(!signal.to_string().contains("message"));
    }

    #[tokio::test]
    async fn event_waiter_limit_is_exactly_sixteen() {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(MAX_EVENT_WAITERS));
        let mut permits = Vec::new();
        for _ in 0..MAX_EVENT_WAITERS {
            permits.push(Arc::clone(&semaphore).try_acquire_owned().unwrap());
        }

        assert!(Arc::clone(&semaphore).try_acquire_owned().is_err());
        drop(permits.pop());
        assert!(Arc::clone(&semaphore).try_acquire_owned().is_ok());
    }

    #[test]
    fn pairing_code_expires_and_locks_after_five_failures() {
        let now = 1_800_000_000;
        let mut pairing = PairingChallenge::new("ABCD1234", now, MobileDeviceScope::Read);

        assert!(pairing.verify("ABCD1234", now + 299).is_ok());
        assert!(pairing.verify("ABCD1234", now + 301).is_err());

        let mut locked = PairingChallenge::new("ABCD1234", now, MobileDeviceScope::Read);
        for _ in 0..5 {
            assert!(locked.verify("WRONG", now + 1).is_err());
        }
        assert!(locked.verify("ABCD1234", now + 1).is_err());
    }

    #[test]
    fn status_marks_only_a_live_unlocked_pairing_challenge_active() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let now = chrono::Utc::now().timestamp();

        bridge.runtime.lock().unwrap().pairing = Some(PairingChallenge::new(
            "ABCD1234",
            now,
            MobileDeviceScope::Read,
        ));
        assert!(bridge.status().pairing_active);

        bridge
            .runtime
            .lock()
            .unwrap()
            .pairing
            .as_mut()
            .unwrap()
            .failed_attempts = MAX_PAIRING_ATTEMPTS;
        assert!(!bridge.status().pairing_active);

        bridge.runtime.lock().unwrap().pairing = None;
        assert!(!bridge.status().pairing_active);
    }

    #[test]
    fn android_setup_contains_only_expiring_pairing_material() {
        let setup = android_setup_payload(
            "https://192.168.1.20:31276",
            "ABCD1234",
            MobileDeviceScope::Control,
            "AA:BB:CC",
        );
        let value: serde_json::Value = serde_json::from_str(&setup).unwrap();

        assert_eq!(value["version"], 1);
        assert_eq!(value["url"], "https://192.168.1.20:31276");
        assert_eq!(value["code"], "ABCD1234");
        assert_eq!(value["scope"], "control");
        assert_eq!(value["fingerprint"], "AABBCC");
        assert_eq!(value.as_object().unwrap().len(), 5);
    }

    #[test]
    fn pairing_transport_defaults_to_lan_and_requires_available_tailnet() {
        let lan = "https://192.168.1.20:31276";
        let tailnet = "https://100.101.2.3:31276";

        assert_eq!(
            select_mobile_url(lan, Some(tailnet), MobileNetwork::Lan).unwrap(),
            lan
        );
        assert_eq!(
            select_mobile_url(lan, Some(tailnet), MobileNetwork::Tailnet).unwrap(),
            tailnet
        );
        assert_eq!(
            select_mobile_url(lan, None, MobileNetwork::Tailnet).unwrap_err(),
            "Tailnet access is unavailable"
        );
        assert_eq!(MobileNetwork::default(), MobileNetwork::Lan);
    }

    #[test]
    fn public_looking_wifi_keeps_numeric_host_for_android_on_link_validation() {
        assert_eq!(
            mobile_lan_host(Ipv4Addr::new(30, 169, 112, 215)),
            "30.169.112.215"
        );
        assert_eq!(
            mobile_lan_host(Ipv4Addr::new(192, 168, 1, 20)),
            "192.168.1.20"
        );
    }

    #[test]
    fn relay_pair_response_is_backward_compatible_and_subscriber_only() {
        let plain = pair_success_value("aa", MobileDeviceScope::Read, None);
        assert_eq!(plain.as_object().unwrap().len(), 2);
        assert_eq!(plain["token"], "aa");
        assert_eq!(plain["scope"], "read");

        let bundle = crate::mobile_relay::WakeRelayBundle {
            version: 1,
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            subscriber_token: "22".repeat(32),
            wake_key: "33".repeat(32),
            command: None,
        };
        let relayed = pair_success_value("aa", MobileDeviceScope::Control, Some(bundle));
        assert_eq!(relayed.as_object().unwrap().len(), 3);
        assert_eq!(relayed["wake_relay"]["subscriber_token"], "22".repeat(32));
        let serialized = serde_json::to_string(&relayed).unwrap();
        assert!(!serialized.contains("publisher_token"));
    }

    #[test]
    fn failed_relay_pairing_rolls_back_device_and_secret() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let device = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Phone", "phone-token", MobileDeviceScope::Control)
            .unwrap();
        bridge
            .relay_secrets
            .lock()
            .unwrap()
            .put(crate::mobile_relay::RelayDeviceSecret {
                device_id: device.id.clone(),
                base_url: "https://relay.example.com".into(),
                channel_id: "11".repeat(32),
                wake_key: "22".repeat(32),
                publisher_token: "33".repeat(32),
                next_sequence: 1,
                command: None,
            })
            .unwrap();

        rollback_paired_device(&bridge, &device.id);

        assert!(bridge
            .devices
            .lock()
            .unwrap()
            .authorize("phone-token")
            .is_none());
        assert!(bridge
            .relay_secrets
            .lock()
            .unwrap()
            .get(&device.id)
            .is_none());
    }

    #[test]
    fn relay_secrets_follow_one_and_all_device_revocation() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let first = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Phone", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        let second = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Tablet", "tablet-token", MobileDeviceScope::Control)
            .unwrap();
        for (device, byte) in [(&first, "11"), (&second, "44")] {
            bridge
                .relay_secrets
                .lock()
                .unwrap()
                .put(crate::mobile_relay::RelayDeviceSecret {
                    device_id: device.id.clone(),
                    base_url: "https://relay.example.com".into(),
                    channel_id: byte.repeat(32),
                    wake_key: "22".repeat(32),
                    publisher_token: "33".repeat(32),
                    next_sequence: 1,
                    command: None,
                })
                .unwrap();
        }

        bridge.revoke_device(&first.id).unwrap();
        assert!(bridge
            .relay_secrets
            .lock()
            .unwrap()
            .get(&first.id)
            .is_none());
        assert!(bridge
            .relay_secrets
            .lock()
            .unwrap()
            .get(&second.id)
            .is_some());

        bridge.revoke_devices().unwrap();
        assert!(bridge
            .relay_secrets
            .lock()
            .unwrap()
            .get(&second.id)
            .is_none());
    }

    #[test]
    fn relay_configuration_is_explicit_and_status_is_credential_free() {
        let disabled = crate::config::MobileRelayConfig {
            enabled: false,
            base_url: Some("http://public.example.com".into()),
            invite_code: None,
        };
        assert!(relay_base_from_config(&disabled).unwrap().is_none());
        assert!(relay_base_from_config(&crate::config::MobileRelayConfig {
            enabled: true,
            base_url: None,
            invite_code: Some("beta-invite-secret".into()),
        })
        .is_err());
        let enabled = relay_base_from_config(&crate::config::MobileRelayConfig {
            enabled: true,
            base_url: Some("https://relay.example.com".into()),
            invite_code: Some("beta-invite-secret".into()),
        })
        .unwrap()
        .unwrap();

        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        bridge.runtime.lock().unwrap().relay_base_url = Some(enabled);
        bridge.runtime.lock().unwrap().relay_invite_code = Some("beta-invite-secret".into());
        let status = serde_json::to_string(&bridge.status()).unwrap();
        assert!(status.contains(r#""relay_status":"connected""#));
        assert!(status.contains(r#""relay_url":"https://relay.example.com""#));
        assert!(!status.contains("publisher_token"));
        assert!(!status.contains("subscriber_token"));
        assert!(!status.contains("wake_key"));
        assert!(!status.contains("beta-invite-secret"));
    }

    #[test]
    fn relay_status_reports_retrying_and_errored_without_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let mut runtime = bridge.runtime.lock().unwrap();
        runtime.relay_base_url =
            Some(crate::mobile_relay::RelayBaseUrl::parse("https://relay.example.com").unwrap());
        for (state, expected) in [
            (
                crate::mobile_relay::RelayPublisherStatus::Retrying,
                "retrying",
            ),
            (
                crate::mobile_relay::RelayPublisherStatus::Errored,
                "errored",
            ),
        ] {
            runtime.relay_status = state;
            drop(runtime);
            let serialized = serde_json::to_string(&bridge.status()).unwrap();
            assert!(serialized.contains(&format!(r#""relay_status":"{expected}""#)));
            assert!(!serialized.contains("publisher_token"));
            assert!(!serialized.contains("wake_key"));
            runtime = bridge.runtime.lock().unwrap();
        }
    }

    #[test]
    fn disable_invalidates_an_enable_generation_before_health_can_finish() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let generation = bridge.begin_enable().unwrap();
        assert!(bridge.enable_generation_is_current(generation));
        assert!(bridge.begin_enable().is_err());

        bridge.disable().unwrap();

        assert!(!bridge.enable_generation_is_current(generation));
        assert!(!bridge.runtime.lock().unwrap().enabling);
        assert!(bridge.begin_enable().is_ok());
    }

    #[test]
    fn concurrent_disable_and_reenable_wait_for_the_stop_barrier() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = Arc::new(MobileBridgeState::load_or_create(temp.path()).unwrap());
        *bridge.publisher_stopping.lock().unwrap() = true;
        assert!(bridge.begin_enable().is_err());

        let disabling = Arc::clone(&bridge);
        let disabled = std::thread::spawn(move || disabling.disable());
        std::thread::sleep(std::time::Duration::from_millis(30));
        assert!(!disabled.is_finished());

        *bridge.publisher_stopping.lock().unwrap() = false;
        bridge.publisher_stopped.notify_all();
        disabled.join().unwrap().unwrap();
    }

    #[test]
    fn desktop_wake_envelope_encrypts_only_minimal_wake_signal() {
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: "private-device-name".into(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 7,
            command: None,
        };
        let envelope =
            wake_envelope_for_secret(&secret, 1_783_836_000, "000102030405060708090a0b").unwrap();
        let signal = crate::wake_crypto::decrypt_wake(
            &secret.wake_key,
            &secret.channel_id,
            &envelope,
            1_783_836_001,
            0,
        )
        .unwrap();

        let plaintext = serde_json::to_value(&signal).unwrap();
        assert_eq!(
            plaintext,
            serde_json::json!({
                "kind": "wake",
                "issued_at": 1_783_836_000,
            })
        );
        let serialized = serde_json::to_string(&envelope).unwrap();
        for forbidden in [
            "session", "project", "scope", "device", "approval", "message",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn device_store_persists_only_token_digest() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let raw_token = "private-mobile-token";

        store
            .add_device("My phone", raw_token, MobileDeviceScope::Read)
            .unwrap();

        let content = std::fs::read_to_string(temp.path().join("mobile-devices.json")).unwrap();
        assert!(!content.contains(raw_token));
        assert_eq!(store.authorize(raw_token), Some(MobileDeviceScope::Read));
        assert_eq!(store.authorize("wrong-token"), None);
    }

    #[test]
    fn mobile_presence_authorizes_to_an_opaque_device_identity() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let paired = store
            .add_device("Xiaomi 14", "phone-token", MobileDeviceScope::Control)
            .unwrap();

        let authorized = store.authorize_device("phone-token").unwrap();

        assert_eq!(authorized.id, paired.id);
        assert_eq!(authorized.scope, MobileDeviceScope::Control);
        assert!(store.authorize_device("wrong-token").is_none());
    }

    #[test]
    fn mobile_presence_is_fresh_through_ninety_seconds_then_expires() {
        let mut presence = MobilePresenceStore::default();
        presence.report("device-1", MobilePresenceMode::Monitoring, 1_000);

        assert_eq!(
            presence.fresh("device-1", 1_090).unwrap().mode,
            MobilePresenceMode::Monitoring
        );
        assert!(presence.fresh("device-1", 1_091).is_none());
        assert!(presence.fresh("unknown", 1_000).is_none());
    }

    #[test]
    fn mobile_presence_summaries_hide_stale_timestamps_and_cleanup_on_revoke() {
        let temp = tempfile::tempdir().unwrap();
        let mut devices = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let device = devices
            .add_device("Xiaomi 14", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        let mut presence = MobilePresenceStore::default();
        presence.report(&device.id, MobilePresenceMode::Foreground, 1_000);

        let fresh = devices.summaries_with_presence(&presence, 1_090);
        assert_eq!(fresh[0].presence_mode, Some(MobilePresenceMode::Foreground));
        assert_eq!(
            fresh[0].last_seen_at.as_deref(),
            Some("1970-01-01T00:16:40+00:00")
        );

        let stale = devices.summaries_with_presence(&presence, 1_091);
        assert_eq!(stale[0].presence_mode, None);
        assert_eq!(stale[0].last_seen_at, None);

        presence.remove(&device.id);
        assert!(presence.fresh(&device.id, 1_000).is_none());
        presence.report(&device.id, MobilePresenceMode::Monitoring, 1_000);
        presence.clear();
        assert!(presence.fresh(&device.id, 1_000).is_none());
    }

    #[test]
    fn mobile_presence_is_cleared_by_every_bridge_revocation_boundary() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let first = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Phone", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        bridge
            .presence
            .lock()
            .unwrap()
            .report(&first.id, MobilePresenceMode::Foreground, 1_000);

        bridge.revoke_device(&first.id).unwrap();
        assert!(bridge
            .presence
            .lock()
            .unwrap()
            .fresh(&first.id, 1_000)
            .is_none());

        let second = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Tablet", "tablet-token", MobileDeviceScope::Control)
            .unwrap();
        bridge
            .presence
            .lock()
            .unwrap()
            .report(&second.id, MobilePresenceMode::Monitoring, 1_000);
        bridge.revoke_devices().unwrap();
        assert!(bridge
            .presence
            .lock()
            .unwrap()
            .fresh(&second.id, 1_000)
            .is_none());

        bridge
            .presence
            .lock()
            .unwrap()
            .report("ephemeral", MobilePresenceMode::Monitoring, 1_000);
        bridge.disable().unwrap();
        assert!(bridge
            .presence
            .lock()
            .unwrap()
            .fresh("ephemeral", 1_000)
            .is_none());
    }

    #[test]
    fn mobile_presence_endpoint_records_only_the_authenticated_device() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let device = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Xiaomi 14", "phone-token", MobileDeviceScope::Control)
            .unwrap();

        let response = record_mobile_presence(
            Some("phone-token"),
            br#"{"mode":"foreground"}"#,
            &bridge,
            2_000,
        );

        assert_eq!(response, Ok(serde_json::json!({"status": "recorded"})));
        assert_eq!(
            bridge
                .presence
                .lock()
                .unwrap()
                .fresh(&device.id, 2_000)
                .unwrap()
                .mode,
            MobilePresenceMode::Foreground
        );
    }

    #[test]
    fn mobile_presence_endpoint_rejects_missing_or_revoked_credentials() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();

        assert_eq!(
            record_mobile_presence(None, br#"{"mode":"monitoring"}"#, &bridge, 2_000),
            Err(StatusCode::UNAUTHORIZED)
        );
        assert_eq!(
            record_mobile_presence(
                Some("revoked-token"),
                br#"{"mode":"monitoring"}"#,
                &bridge,
                2_000,
            ),
            Err(StatusCode::UNAUTHORIZED)
        );
    }

    #[test]
    fn mobile_presence_endpoint_rejects_unbounded_or_ambiguous_bodies() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Xiaomi 14", "phone-token", MobileDeviceScope::Read)
            .unwrap();

        for body in [
            br#"{"mode":"offline"}"#.as_slice(),
            br#"{"mode":"foreground","device_id":"other"}"#.as_slice(),
            br#"{"mode":"foreground","extra":true}"#.as_slice(),
            br#"not-json"#.as_slice(),
        ] {
            assert_eq!(
                record_mobile_presence(Some("phone-token"), body, &bridge, 2_000),
                Err(StatusCode::BAD_REQUEST)
            );
        }
        assert_eq!(
            record_mobile_presence(Some("phone-token"), &[b'x'; 257], &bridge, 2_000),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn read_only_devices_cannot_use_control_routes() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        store
            .add_device("Reader", "read-token", MobileDeviceScope::Read)
            .unwrap();
        store
            .add_device("Controller", "control-token", MobileDeviceScope::Control)
            .unwrap();

        assert!(!store
            .authorize("read-token")
            .is_some_and(MobileDeviceScope::allows_control));
        assert!(store
            .authorize("control-token")
            .is_some_and(MobileDeviceScope::allows_control));
    }

    #[test]
    fn one_device_can_be_revoked_without_affecting_others() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let first = store
            .add_device("Phone", "phone-token", MobileDeviceScope::Control)
            .unwrap();
        store
            .add_device("Tablet", "tablet-token", MobileDeviceScope::Read)
            .unwrap();

        store.revoke_device(&first.id).unwrap();

        assert_eq!(store.authorize("phone-token"), None);
        assert_eq!(
            store.authorize("tablet-token"),
            Some(MobileDeviceScope::Read)
        );
        assert_eq!(store.summaries().len(), 1);
        assert_eq!(store.summaries()[0].name, "Tablet");
    }

    #[test]
    fn device_can_revoke_itself_with_its_raw_token() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        store
            .add_device("Phone", "phone-token", MobileDeviceScope::Control)
            .unwrap();
        store
            .add_device("Tablet", "tablet-token", MobileDeviceScope::Read)
            .unwrap();

        store.revoke_token("phone-token").unwrap();

        assert_eq!(store.authorize("phone-token"), None);
        assert_eq!(
            store.authorize("tablet-token"),
            Some(MobileDeviceScope::Read)
        );
        assert_eq!(store.summaries().len(), 1);
        assert_eq!(store.summaries()[0].name, "Tablet");
    }

    #[test]
    fn revoking_devices_invalidates_existing_tokens() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        store
            .add_device("My phone", "token-1", MobileDeviceScope::Read)
            .unwrap();

        store.revoke_all().unwrap();

        assert_eq!(store.authorize("token-1"), None);
        assert_eq!(store.devices.len(), 0);
    }

    #[test]
    fn certificate_identity_is_reused_across_private_address_changes() {
        let temp = tempfile::tempdir().unwrap();

        let first = ensure_certificate(temp.path()).unwrap();
        let cert_before = std::fs::read(&first.cert_path).unwrap();
        let key_before = std::fs::read(&first.key_path).unwrap();
        let second = ensure_certificate(temp.path()).unwrap();

        assert_eq!(first.fingerprint, second.fingerprint);
        assert_eq!(cert_before, std::fs::read(&second.cert_path).unwrap());
        assert_eq!(key_before, std::fs::read(&second.key_path).unwrap());
    }

    #[test]
    fn mobile_responses_disable_embedding_and_storage() {
        let response = with_security_headers(html_response(MOBILE_HTML));

        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["x-frame-options"], "DENY");
        assert!(response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
    }

    #[test]
    fn mobile_session_summary_does_not_expose_paths_or_transcripts() {
        let session = crate::session_store::Session {
            session_id: "session-1".into(),
            client_type: "codex".into(),
            transcript_path: Some("/Users/me/.codex/private.jsonl".into()),
            cwd: Some("/Users/me/secret/project".into()),
            project_name: Some("project".into()),
            started_at: "2026-07-12T00:00:00Z".into(),
            last_event_at: "2026-07-12T00:01:00Z".into(),
            event_count: 2,
            status: crate::session_store::SessionStatus::Active,
            last_hook_message: Some("private transcript text".into()),
            last_tool_name: Some("Read".into()),
            recent_tools: vec!["Read".into()],
            event_names: vec!["Notification".into()],
            has_pending_permission: false,
            route: None,
        };

        let json = serde_json::to_string(&MobileSessionSummary::from_hook(&session, false, false))
            .unwrap();
        assert!(json.contains("project"));
        assert!(!json.contains("/Users"));
        assert!(!json.contains("private transcript text"));
        assert!(!MobileSessionSummary::from_hook(&session, false, false).can_read_conversation);
        assert!(!MobileSessionSummary::from_hook(&session, false, false).can_message);

        let mut opencode = session.clone();
        opencode.client_type = "opencode".into();
        assert!(!MobileSessionSummary::from_hook(&opencode, false, false).can_message);
        assert!(MobileSessionSummary::from_hook(&opencode, true, false).can_message);
    }

    #[test]
    fn only_control_summaries_expose_codex_actions() {
        let session = crate::hexa_protocol::HexaSessionProjection {
            session_id: "thread-1".into(),
            provider: "codex".into(),
            provider_thread_id: Some("thread-1".into()),
            workspace: None,
            project_name: Some("Mobile control".into()),
            status: crate::hexa_protocol::HexaSessionStatus::Waiting,
            current_turn_id: None,
            current_activity: None,
            pending_approvals: vec![crate::hexa_protocol::HexaApproval {
                approval_id: "approval-1".into(),
                operation: crate::hexa_protocol::HexaApprovalOperation::Command,
                summary: "Run tests".into(),
                reason: None,
                expires_at: None,
            }],
            started_at: "2026-07-12T00:00:00Z".into(),
            last_activity_at: "2026-07-12T00:01:00Z".into(),
        };

        let read = MobileSessionSummary::from_codex(&session, false, false);
        let control = MobileSessionSummary::from_codex(&session, true, false);

        assert!(!read.can_read_conversation);
        assert!(!read.can_message);
        assert!(read.pending_actions.is_empty());
        assert!(!control.can_read_conversation);
        assert!(control.can_message);
        assert_eq!(control.pending_actions.len(), 1);
    }

    #[test]
    fn mobile_conversation_request_requires_exact_json_and_allows_read_or_control_scope() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let transcript = home.join(".claude/projects/demo/transcript.jsonl");
        std::fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        write_lines(
            &transcript,
            &[
                r#"{"role":"user","content":"hello"}"#.into(),
                r#"{"role":"assistant","content":"world"}"#.into(),
            ],
        );
        let mut store = crate::session_store::SessionStore::new();
        insert_hook_session(&mut store, "session-1", "claude-code", Some(&transcript));

        assert_eq!(
            mobile_conversation_from_request(None, br#"{"session_id":"session-1"}"#, &store, home),
            Err(MobileConversationError::Unauthorized)
        );

        let read = mobile_conversation_from_request(
            Some(MobileDeviceScope::Read),
            br#"{"session_id":"session-1"}"#,
            &store,
            home,
        )
        .unwrap();
        let control = mobile_conversation_from_request(
            Some(MobileDeviceScope::Control),
            br#"{"session_id":"session-1"}"#,
            &store,
            home,
        )
        .unwrap();

        assert_eq!(
            serde_json::to_value(&read).unwrap(),
            serde_json::to_value(&control).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&read).unwrap(),
            json!({
                "session_id": "session-1",
                "messages": [
                    { "role": "user", "text": "hello" },
                    { "role": "assistant", "text": "world" }
                ]
            })
        );
        assert_eq!(
            serde_json::to_value(&read)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            2
        );
        for message in serde_json::to_value(&read).unwrap()["messages"]
            .as_array()
            .unwrap()
        {
            assert_eq!(message.as_object().unwrap().len(), 2);
        }

        let duplicate = br#"{"session_id":"session-1","session_id":"session-2"}"#;
        let too_long = format!(r#"{{"session_id":"{}"}}"#, "s".repeat(257));
        for body in [
            br#"{"session_id":"session-1","path":"/tmp/nope"}"#.as_slice(),
            br#"{"session_id":""}"#.as_slice(),
            duplicate,
            too_long.as_bytes(),
            &[b'x'; 4097],
        ] {
            assert_eq!(
                mobile_conversation_from_request(Some(MobileDeviceScope::Read), body, &store, home),
                Err(MobileConversationError::BadRequest)
            );
        }
    }

    #[test]
    fn mobile_conversation_requires_supported_provider_roots_and_blocks_escape_paths() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();

        let codex_transcript = home.join(".codex/sessions/project/transcript.jsonl");
        std::fs::create_dir_all(codex_transcript.parent().unwrap()).unwrap();
        write_lines(
            &codex_transcript,
            &[r#"{"role":"user","content":"codex"}"#.into()],
        );
        assert!(session_supports_mobile_conversation(
            &hook_session("codex-1", "codex", Some(&codex_transcript)),
            home
        ));

        let openclaw_transcript = home.join(".openclaw/agents/demo/transcript.jsonl");
        std::fs::create_dir_all(openclaw_transcript.parent().unwrap()).unwrap();
        write_lines(
            &openclaw_transcript,
            &[r#"{"role":"assistant","content":"openclaw"}"#.into()],
        );
        assert!(session_supports_mobile_conversation(
            &hook_session("openclaw-1", "openclaw", Some(&openclaw_transcript)),
            home
        ));

        let wrong_root = home.join(".claude/projects/demo/transcript.jsonl");
        std::fs::create_dir_all(wrong_root.parent().unwrap()).unwrap();
        write_lines(
            &wrong_root,
            &[r#"{"role":"assistant","content":"wrong"}"#.into()],
        );
        assert!(!session_supports_mobile_conversation(
            &hook_session("codex-2", "codex", Some(&wrong_root)),
            home
        ));
        assert!(!session_supports_mobile_conversation(
            &hook_session("other-1", "qoderwork", Some(&codex_transcript)),
            home
        ));

        let directory_path = home.join(".claude/projects/directory-only");
        std::fs::create_dir_all(&directory_path).unwrap();
        assert!(!session_supports_mobile_conversation(
            &hook_session("claude-1", "claude-code", Some(&directory_path)),
            home
        ));

        #[cfg(unix)]
        {
            let outside = home.join("outside.jsonl");
            write_lines(
                &outside,
                &[r#"{"role":"assistant","content":"outside"}"#.into()],
            );
            let escaped = home.join(".claude/projects/demo/escape.jsonl");
            std::os::unix::fs::symlink(&outside, &escaped).unwrap();
            assert!(!session_supports_mobile_conversation(
                &hook_session("claude-2", "claude-code", Some(&escaped)),
                home
            ));
        }
    }

    #[test]
    fn mobile_conversation_collapses_unknown_and_unreadable_sessions_to_unavailable() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let mut store = crate::session_store::SessionStore::new();

        assert_eq!(
            mobile_conversation_from_request(
                Some(MobileDeviceScope::Read),
                br#"{"session_id":"missing"}"#,
                &store,
                home,
            ),
            Err(MobileConversationError::Unavailable)
        );

        let missing_file = home.join(".claude/projects/demo/missing.jsonl");
        insert_hook_session(
            &mut store,
            "missing-file",
            "claude-code",
            Some(&missing_file),
        );
        assert_eq!(
            mobile_conversation_from_request(
                Some(MobileDeviceScope::Read),
                br#"{"session_id":"missing-file"}"#,
                &store,
                home,
            ),
            Err(MobileConversationError::Unavailable)
        );

        let unsupported = home.join(".qoder/sessions/demo.jsonl");
        std::fs::create_dir_all(unsupported.parent().unwrap()).unwrap();
        write_lines(
            &unsupported,
            &[r#"{"role":"assistant","content":"unsupported"}"#.into()],
        );
        insert_hook_session(&mut store, "unsupported", "qoderwork", Some(&unsupported));
        assert_eq!(
            mobile_conversation_from_request(
                Some(MobileDeviceScope::Read),
                br#"{"session_id":"unsupported"}"#,
                &store,
                home,
            ),
            Err(MobileConversationError::Unavailable)
        );
    }

    #[test]
    fn mobile_conversation_projects_redacted_recent_messages_from_reader_tail() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let transcript = home.join(".codex/sessions/project/transcript.jsonl");
        std::fs::create_dir_all(transcript.parent().unwrap()).unwrap();

        let mut lines = vec![r#"{"role":"user","content":"outside-window"}"#.to_string()];
        let filler = format!(
            r#"{{"role":"assistant","content":[{{"type":"thinking","text":"{}"}}]}}"#,
            "a".repeat(58_500)
        );
        for _ in 0..18 {
            lines.push(filler.clone());
        }
        lines.push(
            r#"{"message":{"role":"assistant","content":[{"type":"tool_use","name":"Read"}]}}"#
                .into(),
        );
        for idx in 0..16 {
            let role = if idx % 2 == 0 { "user" } else { "assistant" };
            let text = match idx {
                5 => "open /Users/me/private/project/src/main.rs".to_string(),
                6 => "check ~/todo.md and file:///Users/me/private/project/readme.md".to_string(),
                7 => r#"done at C:\\Users\\me\\Desktop\\notes.txt"#.to_string(),
                _ => format!("turn-{idx}"),
            };
            lines.push(format!(r#"{{"role":"{role}","content":"{text}"}}"#));
        }
        write_lines(&transcript, &lines);

        let mut store = crate::session_store::SessionStore::new();
        insert_hook_session(&mut store, "session-2", "codex", Some(&transcript));

        let response = mobile_conversation_from_request(
            Some(MobileDeviceScope::Read),
            br#"{"session_id":"session-2"}"#,
            &store,
            home,
        )
        .unwrap();
        let value = serde_json::to_value(&response).unwrap();
        let messages = value["messages"].as_array().unwrap();

        assert_eq!(messages.len(), 12);
        assert_eq!(messages.first().unwrap()["role"], "user");
        assert_eq!(messages.first().unwrap()["text"], "turn-4");
        assert_eq!(messages.last().unwrap()["role"], "assistant");
        assert_eq!(messages.last().unwrap()["text"], "turn-15");

        let serialized = serde_json::to_vec(&response).unwrap();
        assert!(serialized.len() <= 64 * 1024);
        let joined = String::from_utf8(serialized).unwrap();
        assert!(!joined.contains("outside-window"));
        assert!(!joined.contains("/Users/me"));
        assert!(!joined.contains("file:///Users"));
        assert!(!joined.contains(r#"C:\Users\me"#));
        assert!(!joined.contains("Read"));
        assert!(joined.contains("[本机路径]"));
        for message in &response.messages {
            assert!(message.text.chars().count() <= 500);
        }
    }

    #[test]
    fn claude_mobile_approval_hides_full_file_paths() {
        let event = crate::event_bus::HookEvent {
            id: "permission-1".into(),
            hook_event_name: "PermissionRequest".into(),
            session_id: "claude-1".into(),
            transcript_path: None,
            cwd: None,
            client_type: "claude-code".into(),
            payload: serde_json::json!({
                "tool_name": "Edit",
                "tool_input": { "file_path": "/Users/me/private/project/secret.txt" }
            }),
            timestamp: "2026-07-12T00:00:00Z".into(),
        };

        let approval = mobile_hook_approval(&event).unwrap();

        assert_eq!(approval.provider, "claude");
        assert!(approval.summary.contains("secret.txt"));
        assert!(!approval.summary.contains("/Users"));
    }

    #[tokio::test]
    async fn mobile_claude_decision_uses_the_existing_pending_channel() {
        let pending: crate::hook_server::PendingMap =
            Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
        let (sender, receiver) = tokio::sync::oneshot::channel();
        pending.lock().await.insert(
            "permission-1".into(),
            crate::hook_server::PendingRequest {
                sender: Some(sender),
                event: crate::event_bus::HookEvent {
                    id: "permission-1".into(),
                    hook_event_name: "PermissionRequest".into(),
                    session_id: "claude-1".into(),
                    transcript_path: None,
                    cwd: None,
                    client_type: "claude-code".into(),
                    payload: serde_json::json!({ "tool_name": "Bash" }),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            },
        );

        crate::commands::resolve_hook_permission(&pending, "permission-1", "allow", None, None)
            .await
            .unwrap();

        assert_eq!(receiver.await.unwrap().behavior, "allow");
        assert!(pending.lock().await.is_empty());
    }
}
