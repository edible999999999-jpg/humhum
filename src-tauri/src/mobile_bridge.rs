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
const MAX_CONVERSATION_RESPONSE_BYTES: usize = 40 * 1024;
const MAX_HUSH_SIGNAL_REQUEST_BYTES: usize = 64 * 1024;
const MAX_HUSH_SIGNAL_BATCH: usize = 31;

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
        let (relay_base_url, relay_invite_code, local_host, tailnet_ip, cert, tls_config, listener) =
            match setup {
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

    pub async fn create_pairing_for_android(
        self: &Arc<Self>,
        scope: MobileDeviceScope,
        network: MobileNetwork,
    ) -> Result<MobilePairingInfo, String> {
        let relay = {
            let runtime = self.runtime.lock().map_err(|error| error.to_string())?;
            if !runtime.enabled {
                return Err("Enable mobile access before pairing a device".into());
            }
            match (
                runtime.relay_base_url.clone(),
                runtime.relay_invite_code.clone(),
            ) {
                (Some(base_url), Some(invite_code)) => Some((base_url, invite_code)),
                _ => None,
            }
        };
        let Some((base_url, invite_code)) = relay else {
            return self.create_pairing_on(scope, network);
        };

        let relay_id = format!("pairing-{}", uuid::Uuid::new_v4());
        let client = crate::mobile_relay::RelayClient::new(base_url.clone())?;
        let provision = client.register(&relay_id, &invite_code).await?;
        let temporary_secret = provision.desktop;
        let android_relay = provision.android;
        let created = (|| -> Result<Option<MobilePairingInfo>, String> {
            let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
            if !runtime.enabled
                || runtime.relay_base_url.as_ref() != Some(&base_url)
                || runtime.relay_invite_code.as_deref() != Some(invite_code.as_str())
            {
                Ok(None)
            } else {
                let now = chrono::Utc::now().timestamp();
                let code = uuid::Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase();
                let challenge = PairingChallenge::new(&code, now, scope)
                    .for_relay(&relay_id, Some(temporary_secret.clone()));
                let lan_url = runtime.url.as_deref().ok_or("Mobile URL is unavailable")?;
                let url = select_mobile_url(lan_url, runtime.tailnet_url.as_deref(), network)?
                    .to_string();
                let fingerprint = runtime
                    .certificate_fingerprint
                    .clone()
                    .ok_or("Mobile certificate fingerprint is unavailable")?;
                let android_setup = android_setup_payload_with_relay(
                    &url,
                    &code,
                    scope,
                    &fingerprint,
                    challenge.expires_at,
                    &android_relay,
                );
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
                Ok(Some(info))
            }
        })();
        let info = match created {
            Ok(Some(info)) => info,
            Ok(None) => {
                let _ = client.delete(&temporary_secret).await;
                return Err("Mobile pairing was cancelled".into());
            }
            Err(error) => {
                let _ = client.delete(&temporary_secret).await;
                return Err(error);
            }
        };
        let bridge = Arc::clone(self);
        let expires_at = info.expires_at;
        tokio::spawn(async move {
            run_temporary_relay_pairing(bridge, relay_id, temporary_secret, expires_at).await;
        });
        Ok(info)
    }

    pub fn revoke_devices(&self) -> Result<MobileBridgeStatus, String> {
        let relay_secrets = {
            let mut relay_secrets = self
                .relay_secrets
                .lock()
                .map_err(|error| error.to_string())?;
            let mut devices = self.devices.lock().map_err(|error| error.to_string())?;
            revoke_all_device_records(&mut devices, &mut relay_secrets)?
        };
        let publisher = self
            .runtime
            .lock()
            .map_err(|error| error.to_string())?
            .publisher
            .clone();
        let publisher_error = publisher.and_then(|publisher| {
            publisher.clear().err().map(|error| {
                publisher.stop();
                error
            })
        });
        self.relay_changes.notify_one();
        schedule_relay_deletions(relay_secrets);
        self.presence
            .lock()
            .map_err(|error| error.to_string())?
            .clear();
        if let Some(error) = publisher_error {
            return Err(format!(
                "Devices were revoked, but the wake publisher could not clear safely: {error}"
            ));
        }
        Ok(self.status())
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<MobileBridgeStatus, String> {
        let relay_secret = {
            let mut relay_secrets = self
                .relay_secrets
                .lock()
                .map_err(|error| error.to_string())?;
            let mut devices = self.devices.lock().map_err(|error| error.to_string())?;
            revoke_device_records(&mut devices, &mut relay_secrets, device_id)?
        };
        let publisher = self
            .runtime
            .lock()
            .map_err(|error| error.to_string())?
            .publisher
            .clone();
        let publisher_error = publisher.and_then(|publisher| {
            publisher.revoke(device_id).err().map(|error| {
                publisher.stop();
                error
            })
        });
        self.relay_changes.notify_one();
        schedule_relay_deletions(relay_secret.into_iter().collect());
        self.presence
            .lock()
            .map_err(|error| error.to_string())?
            .remove(device_id);
        if let Some(error) = publisher_error {
            return Err(format!(
                "The device was revoked, but the wake publisher could not stop safely: {error}"
            ));
        }
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

#[cfg(test)]
fn anywhere_snapshot_envelope(
    secret: &crate::mobile_relay::RelayDeviceSecret,
    page: &serde_json::Value,
    issued_at: i64,
    nonce_hex: &str,
    request_id: &str,
) -> Result<crate::anywhere_crypto::AnywhereEnvelope, String> {
    if secret.command.is_none() || !page.is_object() {
        return Err("Anywhere snapshot is unavailable".into());
    }
    crate::anywhere_crypto::encrypt_anywhere(
        &secret.wake_key,
        &secret.channel_id,
        crate::anywhere_crypto::AnywhereDirection::Downlink,
        secret.next_sequence,
        "snapshot",
        request_id,
        issued_at,
        issued_at.saturating_add(86_400),
        page,
        nonce_hex,
    )
    .map_err(|_| "Could not encrypt Anywhere snapshot".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum AnywhereRequest {
    Conversation {
        session_id: String,
    },
    Approval {
        provider: String,
        id: String,
        decision: String,
    },
    Message {
        session_id: String,
        provider: String,
        message: String,
    },
    SignalsUpload {
        #[serde(flatten)]
        batch: crate::hush_signal_store::HushSignalBatch,
    },
    Refresh,
}

fn valid_anywhere_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 256
}

fn parse_anywhere_request(
    scope: MobileDeviceScope,
    body: &serde_json::Value,
) -> Result<AnywhereRequest, String> {
    let request: AnywhereRequest =
        serde_json::from_value(body.clone()).map_err(|_| "Invalid Anywhere request".to_string())?;
    match &request {
        AnywhereRequest::Conversation { session_id } => {
            if !valid_anywhere_identifier(session_id) {
                return Err("Invalid Anywhere conversation request".into());
            }
        }
        AnywhereRequest::Approval {
            provider,
            id,
            decision,
        } => {
            if !scope.allows_control()
                || !matches!(provider.as_str(), "codex" | "claude" | "claude-code")
                || !valid_anywhere_identifier(id)
                || !matches!(decision.as_str(), "allow_once" | "deny")
            {
                return Err("Anywhere approval is not allowed".into());
            }
        }
        AnywhereRequest::Message {
            session_id,
            provider,
            message,
        } => {
            let message_chars = message.chars().count();
            if !scope.allows_control()
                || !valid_anywhere_identifier(session_id)
                || !matches!(
                    provider.as_str(),
                    "codex" | "claude" | "claude-code" | "opencode"
                )
                || message.trim().is_empty()
                || message_chars > 20_000
            {
                return Err("Anywhere follow-up is not allowed".into());
            }
        }
        AnywhereRequest::SignalsUpload { batch } => {
            if batch.signals.len() > MAX_HUSH_SIGNAL_BATCH {
                return Err("Anywhere health signal batch is too large".into());
            }
        }
        AnywhereRequest::Refresh => {}
    }
    Ok(request)
}

async fn execute_anywhere_request(
    app: &tauri::AppHandle,
    device_id: &str,
    scope: MobileDeviceScope,
    request: AnywhereRequest,
) -> Result<serde_json::Value, String> {
    match request {
        AnywhereRequest::Refresh => Ok(with_mobile_cursor(mobile_session_page(app, scope).await)),
        AnywhereRequest::Conversation { session_id } => {
            let home_dir = dirs::home_dir().ok_or("Conversation unavailable")?;
            let store = app.state::<Arc<std::sync::Mutex<crate::session_store::SessionStore>>>();
            let body = serde_json::to_vec(&serde_json::json!({"session_id": session_id}))
                .map_err(|_| "Invalid conversation request".to_string())?;
            let response = {
                let store = store.lock().unwrap_or_else(|error| error.into_inner());
                mobile_conversation_from_request(Some(scope), &body, &store, &home_dir)
            }
            .map_err(|error| match error {
                MobileConversationError::Unauthorized => "Pair this device first".to_string(),
                MobileConversationError::BadRequest => "Invalid conversation request".to_string(),
                MobileConversationError::Unavailable => "Conversation unavailable".to_string(),
            })?;
            serde_json::to_value(response).map_err(|_| "Conversation unavailable".to_string())
        }
        AnywhereRequest::Approval {
            provider,
            id,
            decision,
        } => {
            if provider == "codex" {
                let decision = match decision.as_str() {
                    "allow_once" => crate::codex_bridge::ApprovalDecision::AllowOnce,
                    "deny" => crate::codex_bridge::ApprovalDecision::Deny,
                    _ => return Err("Unsupported approval decision".into()),
                };
                let codex = app
                    .state::<Arc<crate::codex_bridge::CodexBridgeState>>()
                    .inner()
                    .clone();
                codex
                    .resolve_approval(&id, decision)
                    .await
                    .map_err(|error| error.to_string())?;
            } else {
                let behavior = match decision.as_str() {
                    "allow_once" => "allow",
                    "deny" => "deny",
                    _ => return Err("Unsupported permission decision".into()),
                };
                let pending = app
                    .try_state::<crate::hook_server::PendingMap>()
                    .ok_or("Claude permission bridge is starting")?;
                crate::commands::resolve_hook_permission(
                    pending.inner(),
                    &id,
                    behavior,
                    None,
                    None,
                )
                .await?;
            }
            Ok(serde_json::json!({"status": "resolved"}))
        }
        AnywhereRequest::Message {
            session_id,
            provider,
            message,
        } => {
            let queue = app
                .state::<Arc<std::sync::Mutex<crate::intervention_queue::InterventionQueue>>>()
                .inner()
                .clone();
            let receipt = if provider == "codex" {
                let codex = app
                    .state::<Arc<crate::codex_bridge::CodexBridgeState>>()
                    .inner()
                    .clone();
                crate::commands::enqueue_and_deliver_codex_message(
                    &codex,
                    &queue,
                    &session_id,
                    &message,
                )
                .await?
            } else {
                let provider = match provider.as_str() {
                    "claude" | "claude-code" => {
                        crate::intervention_queue::InterventionProvider::Claude
                    }
                    "opencode" => crate::intervention_queue::InterventionProvider::OpenCode,
                    _ => return Err("Unsupported Agent provider".into()),
                };
                let store = app
                    .state::<Arc<std::sync::Mutex<crate::session_store::SessionStore>>>()
                    .inner()
                    .clone();
                crate::commands::enqueue_and_deliver_cli_message(
                    &store,
                    &queue,
                    provider,
                    &session_id,
                    &message,
                )
                .await?
            };
            serde_json::to_value(receipt).map_err(|_| "Could not send follow-up".to_string())
        }
        AnywhereRequest::SignalsUpload { batch } => {
            let store =
                app.state::<Arc<std::sync::Mutex<crate::hush_signal_store::HushSignalStore>>>();
            let mut store = store.lock().unwrap_or_else(|error| error.into_inner());
            ingest_hush_signal_batch(device_id, batch, &mut store)
        }
    }
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
    let mut anywhere_states = HashMap::<String, AnywhereDeviceState>::new();
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
        let active_device_ids = secrets
            .iter()
            .map(|secret| secret.device_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        anywhere_states.retain(|device_id, _| active_device_ids.contains(device_id.as_str()));
        for secret in &secrets {
            let Some(scope) = scopes.get(&secret.device_id).copied() else {
                continue;
            };
            let page = with_mobile_cursor(mobile_session_page(&app, scope).await);
            if let Some(cursor) = page["cursor"].as_str() {
                if secret.command.is_some() {
                    let state = anywhere_states.entry(secret.device_id.clone()).or_default();
                    sync_anywhere_device(&bridge, &app, secret, scope, &page, cursor, state).await;
                } else {
                    publisher.observe(&secret.device_id, cursor);
                }
            }
        }
    }
    app.unlisten(listener);
}

#[derive(Default)]
struct AnywhereDeviceState {
    published_cursor: Option<String>,
}

async fn sync_anywhere_device(
    bridge: &MobileBridgeState,
    app: &tauri::AppHandle,
    secret: &crate::mobile_relay::RelayDeviceSecret,
    scope: MobileDeviceScope,
    page: &serde_json::Value,
    cursor: &str,
    state: &mut AnywhereDeviceState,
) {
    let current = bridge
        .relay_secrets
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(&secret.device_id)
        .cloned();
    let Some(mut current) = current else {
        return;
    };
    if current.pending_downlink.is_some() {
        if flush_anywhere_downlink(bridge, &current, state)
            .await
            .is_err()
        {
            return;
        }
        current = match bridge
            .relay_secrets
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&current.device_id)
            .cloned()
        {
            Some(secret) => secret,
            None => return,
        };
    }
    let Some(command) = current.command.as_ref() else {
        return;
    };
    if let Some(request_id) = command.pending_request_id.clone() {
        let response = serde_json::json!({
            "ok": false,
            "error": "The Mac restarted while recording this action's result. It may already have completed; check its state before retrying"
        });
        if let Ok(envelope) = command_response_envelope(&current, &request_id, &response) {
            let staged = bridge
                .relay_secrets
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .stage_command_response(&current.device_id, &request_id, envelope);
            if staged.is_ok() {
                let staged = {
                    bridge
                        .relay_secrets
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .get(&current.device_id)
                        .cloned()
                };
                if let Some(staged) = staged {
                    let _ = flush_anywhere_downlink(bridge, &staged, state).await;
                }
            }
        }
        return;
    }
    let client = match crate::mobile_relay::RelayBaseUrl::parse(&current.base_url)
        .and_then(crate::mobile_relay::RelayClient::new)
    {
        Ok(client) => client,
        Err(_) => return,
    };
    if let Ok(commands) = client.poll_commands(&current, 0).await {
        if let Some(envelope) = commands.first() {
            let message = crate::anywhere_crypto::decrypt_anywhere_authenticated(
                &command.key,
                &command.channel_id,
                crate::anywhere_crypto::AnywhereDirection::Uplink,
                envelope,
                command.last_sequence,
            );
            let Ok(message) = message else {
                return;
            };
            if bridge
                .relay_secrets
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .advance_command_sequence(
                    &current.device_id,
                    envelope.sequence,
                    &message.request_id,
                )
                .is_err()
            {
                return;
            }
            {
                let now = chrono::Utc::now().timestamp();
                let response =
                    if !crate::anywhere_crypto::anywhere_message_is_current(&message, now) {
                        Err("This remote action expired before the Mac received it".to_string())
                    } else {
                        match parse_anywhere_request(scope, &message.body) {
                            Ok(request) => {
                                execute_anywhere_request(app, &current.device_id, scope, request)
                                    .await
                                    .map(|data| serde_json::json!({"ok": true, "data": data}))
                            }
                            Err(error) => Err(error),
                        }
                    }
                    .unwrap_or_else(|error| {
                        let safe = crate::user_safe_text::project_user_safe_text(&error);
                        serde_json::json!({
                            "ok": false,
                            "error": truncate_scalar_value(&safe, 200)
                        })
                    });
                let latest = {
                    bridge
                        .relay_secrets
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .get(&current.device_id)
                        .cloned()
                };
                if let Some(latest) = latest {
                    if let Ok(envelope) =
                        command_response_envelope(&latest, &message.request_id, &response)
                    {
                        let staged = bridge
                            .relay_secrets
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .stage_command_response(
                                &latest.device_id,
                                &message.request_id,
                                envelope,
                            );
                        if staged.is_ok() {
                            let staged = {
                                bridge
                                    .relay_secrets
                                    .lock()
                                    .unwrap_or_else(|error| error.into_inner())
                                    .get(&latest.device_id)
                                    .cloned()
                            };
                            if let Some(staged) = staged {
                                let _ = flush_anywhere_downlink(bridge, &staged, state).await;
                            }
                        }
                    }
                }
            }
            return;
        }
    }
    if state.published_cursor.as_deref() == Some(cursor) {
        return;
    }
    if let Ok(envelope) = anywhere_downlink_envelope(
        &current,
        "snapshot",
        &random_anywhere_hex::<16>(),
        page,
        86_400,
    ) {
        let staged = bridge
            .relay_secrets
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .stage_downlink(&current.device_id, envelope, Some(cursor.to_string()));
        if staged.is_ok() {
            let staged = {
                bridge
                    .relay_secrets
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .get(&current.device_id)
                    .cloned()
            };
            if let Some(staged) = staged {
                let _ = flush_anywhere_downlink(bridge, &staged, state).await;
            }
        }
    }
}

async fn flush_anywhere_downlink(
    bridge: &MobileBridgeState,
    secret: &crate::mobile_relay::RelayDeviceSecret,
    state: &mut AnywhereDeviceState,
) -> Result<(), String> {
    let pending = secret
        .pending_downlink
        .as_ref()
        .ok_or_else(|| "Anywhere downlink is empty".to_string())?;
    if pending.envelope.sequence != secret.next_sequence {
        return Err("Anywhere downlink sequence changed".into());
    }
    let client = crate::mobile_relay::RelayClient::new(crate::mobile_relay::RelayBaseUrl::parse(
        &secret.base_url,
    )?)?;
    client.publish_anywhere(secret, &pending.envelope).await?;
    bridge
        .relay_secrets
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .complete_downlink(&secret.device_id, pending.envelope.sequence)?;
    if let Some(cursor) = pending.snapshot_cursor.clone() {
        state.published_cursor = Some(cursor);
    }
    Ok(())
}

fn random_anywhere_hex<const N: usize>() -> String {
    let mut bytes = [0_u8; N];
    if getrandom::fill(&mut bytes).is_err() {
        return String::new();
    }
    hex::encode(bytes)
}

fn anywhere_downlink_envelope(
    secret: &crate::mobile_relay::RelayDeviceSecret,
    kind: &str,
    request_id: &str,
    body: &serde_json::Value,
    lifetime_seconds: i64,
) -> Result<crate::anywhere_crypto::AnywhereEnvelope, String> {
    let now = chrono::Utc::now().timestamp();
    crate::anywhere_crypto::encrypt_anywhere(
        &secret.wake_key,
        &secret.channel_id,
        crate::anywhere_crypto::AnywhereDirection::Downlink,
        secret.next_sequence,
        kind,
        request_id,
        now,
        now.saturating_add(lifetime_seconds),
        body,
        &random_anywhere_hex::<12>(),
    )
    .map_err(|_| "Could not encrypt Anywhere downlink".to_string())
}

fn command_response_envelope(
    secret: &crate::mobile_relay::RelayDeviceSecret,
    request_id: &str,
    response: &serde_json::Value,
) -> Result<crate::anywhere_crypto::AnywhereEnvelope, String> {
    anywhere_downlink_envelope(secret, "response", request_id, response, 86_400).or_else(|_| {
        anywhere_downlink_envelope(
            secret,
            "response",
            request_id,
            &serde_json::json!({
                "ok": false,
                "error": "The remote result was too large to send safely"
            }),
            86_400,
        )
    })
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TemporaryPairRequestBody {
    operation: String,
    code: String,
    device_name: String,
    reply_key: String,
}

#[derive(Debug, PartialEq, Eq)]
struct TemporaryPairRequest {
    request_id: String,
    code: String,
    device_name: String,
    reply_key: String,
    sequence: u64,
}

fn parse_temporary_pair_request(
    secret: &crate::mobile_relay::RelayDeviceSecret,
    envelope: &crate::anywhere_crypto::AnywhereEnvelope,
    now: i64,
) -> Result<TemporaryPairRequest, String> {
    let command = secret
        .command
        .as_ref()
        .ok_or_else(|| "Temporary pairing uplink is unavailable".to_string())?;
    let message = crate::anywhere_crypto::decrypt_anywhere(
        &command.key,
        &command.channel_id,
        crate::anywhere_crypto::AnywhereDirection::Uplink,
        envelope,
        now,
        command.last_sequence,
    )
    .map_err(|_| "Temporary pairing request is invalid".to_string())?;
    let body: TemporaryPairRequestBody = serde_json::from_value(message.body)
        .map_err(|_| "Temporary pairing request is invalid".to_string())?;
    let code = body.code.trim().to_ascii_uppercase();
    let device_name = body.device_name.trim();
    if body.operation != "pair"
        || code.len() != 8
        || !code.bytes().all(|byte| byte.is_ascii_alphanumeric())
        || device_name.is_empty()
        || device_name.chars().count() > 80
        || device_name.chars().any(char::is_control)
        || body.reply_key.len() != 64
        || !body
            .reply_key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Temporary pairing request is invalid".into());
    }
    Ok(TemporaryPairRequest {
        request_id: message.request_id,
        code,
        device_name: device_name.to_string(),
        reply_key: body.reply_key,
        sequence: message.sequence,
    })
}

fn temporary_pair_response_channel(request_id: &str) -> String {
    let material = format!("humhum-pairing-response-v1:{request_id}");
    format!("{:x}", Sha256::digest(material.as_bytes()))
}

fn temporary_pairing_is_current(bridge: &MobileBridgeState, relay_id: &str, now: i64) -> bool {
    bridge
        .runtime
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .pairing
        .as_ref()
        .is_some_and(|pairing| {
            pairing.relay_id.as_deref() == Some(relay_id)
                && pairing
                    .relay_secret
                    .as_ref()
                    .is_some_and(|secret| secret.device_id == relay_id)
                && pairing.is_active(now)
        })
}

struct CompletedTemporaryPairing {
    value: serde_json::Value,
    device_id: String,
}

async fn complete_temporary_pairing(
    bridge: &MobileBridgeState,
    name: &str,
    scope: MobileDeviceScope,
) -> Result<CompletedTemporaryPairing, String> {
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let device = bridge
        .devices
        .lock()
        .map_err(|error| error.to_string())?
        .add_device(name, &token, scope)?;
    let relay = {
        let runtime = bridge
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        (
            runtime.relay_base_url.clone(),
            runtime.relay_invite_code.clone(),
        )
    };
    let (Some(base_url), Some(invite_code)) = relay else {
        let _ = rollback_paired_device(bridge, &device.id);
        return Err("Anywhere relay is no longer available".into());
    };
    let client = crate::mobile_relay::RelayClient::new(base_url)?;
    let provision = match client.register(&device.id, &invite_code).await {
        Ok(provision) => provision,
        Err(error) => {
            let _ = rollback_paired_device(bridge, &device.id);
            return Err(error);
        }
    };
    let value = commit_pairing_value(
        bridge,
        &device.id,
        &token,
        scope,
        Some(&provision.desktop),
        Some(provision.android.clone()),
    );
    match value {
        Ok(value) => {
            bridge.relay_changes.notify_one();
            Ok(CompletedTemporaryPairing {
                value,
                device_id: device.id,
            })
        }
        Err(error) => {
            let _ = rollback_paired_device(bridge, &device.id);
            if client.delete(&provision.desktop).await.is_err() {
                log::warn!("Could not delete a failed temporary pairing provision");
            }
            Err(match error {
                PairingCommitError::Cancelled => "Pairing was cancelled".into(),
                PairingCommitError::Store(error) => error,
            })
        }
    }
}

fn sealed_temporary_pairing_body(
    request: &TemporaryPairRequest,
    pairing: serde_json::Value,
    now: i64,
) -> Result<serde_json::Value, String> {
    let sealed = crate::anywhere_crypto::encrypt_anywhere(
        &request.reply_key,
        &temporary_pair_response_channel(&request.request_id),
        crate::anywhere_crypto::AnywhereDirection::Downlink,
        1,
        "response",
        &request.request_id,
        now,
        now.saturating_add(PAIRING_TTL_SECONDS),
        &serde_json::json!({ "pairing": pairing }),
        &random_anywhere_hex::<12>(),
    )
    .map_err(|_| "Could not seal temporary pairing response".to_string())?;
    Ok(serde_json::json!({ "ok": true, "sealed": sealed }))
}

async fn publish_temporary_pairing_body(
    client: &crate::mobile_relay::RelayClient,
    secret: &mut crate::mobile_relay::RelayDeviceSecret,
    request_id: &str,
    body: &serde_json::Value,
) -> Result<(), String> {
    let envelope =
        anywhere_downlink_envelope(secret, "response", request_id, body, PAIRING_TTL_SECONDS)?;
    client.publish_anywhere(secret, &envelope).await?;
    secret.next_sequence = secret.next_sequence.saturating_add(1);
    Ok(())
}

async fn run_temporary_relay_pairing(
    bridge: Arc<MobileBridgeState>,
    relay_id: String,
    mut secret: crate::mobile_relay::RelayDeviceSecret,
    expires_at: i64,
) {
    let client = crate::mobile_relay::RelayBaseUrl::parse(&secret.base_url)
        .and_then(crate::mobile_relay::RelayClient::new);
    let Ok(client) = client else {
        return;
    };
    let mut delivered = false;
    'polling: loop {
        let now = chrono::Utc::now().timestamp();
        if now >= expires_at || !temporary_pairing_is_current(&bridge, &relay_id, now) {
            break;
        }
        let wait_seconds = (expires_at - now).clamp(1, 20) as u8;
        let envelopes = match client.poll_commands(&secret, wait_seconds).await {
            Ok(envelopes) => envelopes,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        };
        for envelope in envelopes {
            let request = match parse_temporary_pair_request(&secret, &envelope, now) {
                Ok(request) => request,
                Err(_) => continue,
            };
            if let Some(command) = secret.command.as_mut() {
                command.last_sequence = request.sequence;
            }
            let scope = match claim_temporary_pairing(&bridge, &relay_id, &request.code, now) {
                Ok(scope) => scope,
                Err(error) => {
                    let body = serde_json::json!({
                        "ok": false,
                        "error": error
                    });
                    let _ = publish_temporary_pairing_body(
                        &client,
                        &mut secret,
                        &request.request_id,
                        &body,
                    )
                    .await;
                    continue;
                }
            };
            let completed = complete_temporary_pairing(&bridge, &request.device_name, scope).await;
            let (body, paired_device_id) = match completed {
                Ok(completed) => {
                    let body = sealed_temporary_pairing_body(&request, completed.value, now);
                    match body {
                        Ok(body) => (body, Some(completed.device_id)),
                        Err(error) => {
                            if rollback_paired_device(&bridge, &completed.device_id).is_err() {
                                log::error!("Could not roll back an unsealed temporary pairing");
                            }
                            (serde_json::json!({ "ok": false, "error": error }), None)
                        }
                    }
                }
                Err(_) => (
                    serde_json::json!({
                        "ok": false,
                        "error": "Could not finish secure pairing"
                    }),
                    None,
                ),
            };
            delivered =
                publish_temporary_pairing_body(&client, &mut secret, &request.request_id, &body)
                    .await
                    .is_ok();
            if !delivered {
                if let Some(device_id) = paired_device_id {
                    if rollback_paired_device(&bridge, &device_id).is_err() {
                        log::error!("Could not roll back an undelivered temporary pairing");
                    }
                }
            }
            break 'polling;
        }
    }

    if delivered {
        let remaining = expires_at.saturating_sub(chrono::Utc::now().timestamp());
        if remaining > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(remaining as u64)).await;
        }
    }
    if client.delete(&secret).await.is_err() {
        log::warn!("Could not delete an expired temporary pairing relay");
    }
}

#[derive(Debug, PartialEq, Eq)]
enum PairingCommitError {
    Cancelled,
    Store(String),
}

fn commit_pairing_response(
    bridge: &MobileBridgeState,
    device_id: &str,
    raw_token: &str,
    scope: MobileDeviceScope,
    relay_secret: Option<&crate::mobile_relay::RelayDeviceSecret>,
    wake_relay: Option<crate::mobile_relay::WakeRelayBundle>,
) -> Result<Response<HttpBody>, PairingCommitError> {
    commit_pairing_value(
        bridge,
        device_id,
        raw_token,
        scope,
        relay_secret,
        wake_relay,
    )
    .map(|value| json_response(StatusCode::OK, &value))
}

fn commit_pairing_value(
    bridge: &MobileBridgeState,
    device_id: &str,
    raw_token: &str,
    scope: MobileDeviceScope,
    relay_secret: Option<&crate::mobile_relay::RelayDeviceSecret>,
    wake_relay: Option<crate::mobile_relay::WakeRelayBundle>,
) -> Result<serde_json::Value, PairingCommitError> {
    // Pairing performs the remote registration without local locks. Finalize
    // only after re-entering the same relay -> devices boundary used by every
    // revocation path, so a revoke completed during that await cannot be
    // undone by a late relay-secret write.
    let mut relay_secrets = bridge
        .relay_secrets
        .lock()
        .map_err(|error| PairingCommitError::Store(error.to_string()))?;
    let devices = bridge
        .devices
        .lock()
        .map_err(|error| PairingCommitError::Store(error.to_string()))?;
    let still_paired = devices
        .authorize_device(raw_token)
        .is_some_and(|device| device.id == device_id);
    if !still_paired {
        return Err(PairingCommitError::Cancelled);
    }
    if let Some(secret) = relay_secret {
        if secret.device_id != device_id {
            return Err(PairingCommitError::Store(
                "Wake relay pairing belongs to another device".into(),
            ));
        }
        relay_secrets
            .put(secret.clone())
            .map_err(PairingCommitError::Store)?;
    }

    // Build the final response while revocation is still excluded from the
    // commit boundary. A revoke that starts afterwards is ordered after this
    // successful pairing instead of racing between validation and response.
    Ok(pair_success_value(raw_token, scope, wake_relay))
}

fn revoke_device_records(
    devices: &mut MobileDeviceStore,
    relay_secrets: &mut crate::mobile_relay::MobileRelaySecretStore,
    device_id: &str,
) -> Result<Option<crate::mobile_relay::RelayDeviceSecret>, String> {
    let relay_secret = relay_secrets.take(device_id)?;
    if let Err(error) = devices.revoke_device(device_id) {
        if let Some(secret) = relay_secret.as_ref() {
            if let Err(rollback_error) = relay_secrets.put(secret.clone()) {
                return Err(format!(
                    "{error}; restoring the relay secret also failed: {rollback_error}"
                ));
            }
        }
        return Err(error);
    }
    Ok(relay_secret)
}

fn revoke_token_records(
    devices: &mut MobileDeviceStore,
    relay_secrets: &mut crate::mobile_relay::MobileRelaySecretStore,
    token: &str,
) -> Result<(String, Option<crate::mobile_relay::RelayDeviceSecret>), String> {
    let device_id = devices
        .authorize_device(token)
        .map(|device| device.id)
        .ok_or_else(|| "Paired mobile device not found".to_string())?;
    let relay_secret = revoke_device_records(devices, relay_secrets, &device_id)?;
    Ok((device_id, relay_secret))
}

fn revoke_all_device_records(
    devices: &mut MobileDeviceStore,
    relay_secrets: &mut crate::mobile_relay::MobileRelaySecretStore,
) -> Result<Vec<crate::mobile_relay::RelayDeviceSecret>, String> {
    let removed = relay_secrets.take_all()?;
    if let Err(error) = devices.revoke_all() {
        if let Err(rollback_error) = relay_secrets.restore_all(&removed) {
            return Err(format!(
                "{error}; restoring relay secrets also failed: {rollback_error}"
            ));
        }
        return Err(error);
    }
    Ok(removed)
}

fn rollback_paired_device(bridge: &MobileBridgeState, device_id: &str) -> Result<(), String> {
    let mut relay_secrets = bridge
        .relay_secrets
        .lock()
        .map_err(|error| error.to_string())?;
    let mut devices = bridge.devices.lock().map_err(|error| error.to_string())?;
    let relay_secret = revoke_device_records(&mut devices, &mut relay_secrets, device_id)?;
    drop(devices);
    drop(relay_secrets);
    schedule_relay_deletions(relay_secret.into_iter().collect());
    bridge
        .presence
        .lock()
        .map_err(|error| error.to_string())?
        .remove(device_id);
    bridge.relay_changes.notify_one();
    Ok(())
}

fn rollback_pairing_response(
    bridge: &MobileBridgeState,
    device_id: &str,
    status: StatusCode,
    message: &str,
) -> Response<HttpBody> {
    match rollback_paired_device(bridge, device_id) {
        Ok(()) => json_error(status, message),
        Err(error) => {
            log::error!("Could not roll back failed mobile pairing: {error}");
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not roll back failed mobile pairing",
            )
        }
    }
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

fn android_setup_payload_with_relay(
    url: &str,
    code: &str,
    scope: MobileDeviceScope,
    fingerprint: &str,
    expires_at: i64,
    pairing_relay: &crate::mobile_relay::WakeRelayBundle,
) -> String {
    let normalized_fingerprint: String = fingerprint
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .flat_map(char::to_uppercase)
        .collect();
    serde_json::json!({
        "version": 2,
        "url": url,
        "code": code,
        "scope": scope,
        "fingerprint": normalized_fingerprint,
        "expires_at": expires_at,
        "pairing_relay": pairing_relay,
    })
    .to_string()
}

#[derive(Debug)]
struct MobileCertificate {
    cert_path: PathBuf,
    key_path: PathBuf,
    fingerprint: String,
}

fn ensure_certificate(humhum_dir: &Path) -> Result<MobileCertificate, String> {
    let cert_path = humhum_dir.join("mobile-cert.pem");
    let key_path = humhum_dir.join("mobile-key.pem");
    if [&cert_path, &key_path].iter().any(|path| {
        std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
    }) {
        return Err("Mobile TLS identity cannot use symbolic links".into());
    }
    match (cert_path.exists(), key_path.exists()) {
        (true, false) | (false, true) => {
            return Err("Mobile TLS identity is incomplete; restore both certificate files".into())
        }
        _ => {}
    }
    if !cert_path.exists() {
        let (certificate_pem, key_pem) = generate_certificate_pem()?;
        crate::local_api_auth::write_private_file_atomically(&key_path, key_pem.as_bytes())
            .map_err(|error| format!("Could not write mobile private key: {error}"))?;
        if let Err(error) = crate::local_api_auth::write_private_file_atomically(
            &cert_path,
            certificate_pem.as_bytes(),
        ) {
            let _ = std::fs::remove_file(&key_path);
            return Err(format!("Could not write mobile certificate: {error}"));
        }
    }
    set_owner_only(&key_path)?;
    set_owner_only(&cert_path)?;
    let fingerprint = certificate_fingerprint(&cert_path)?;
    Ok(MobileCertificate {
        cert_path,
        key_path,
        fingerprint,
    })
}

fn generate_certificate_pem() -> Result<(String, String), String> {
    let mut params = rcgen::CertificateParams::new(vec!["humhum.local".to_string()])
        .map_err(|error| format!("Could not configure mobile TLS certificate: {error}"))?;
    params.distinguished_name = rcgen::DistinguishedName::new();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "HumHum Mobile");
    let key_pair = rcgen::KeyPair::generate()
        .map_err(|error| format!("Could not generate mobile TLS private key: {error}"))?;
    let certificate = params
        .self_signed(&key_pair)
        .map_err(|error| format!("Could not generate mobile TLS certificate: {error}"))?;
    Ok((certificate.pem(), key_pair.serialize_pem()))
}

fn certificate_fingerprint(cert_path: &Path) -> Result<String, String> {
    let cert_file = std::fs::File::open(cert_path)
        .map_err(|error| format!("Could not open mobile certificate: {error}"))?;
    let certificate = rustls_pemfile::certs(&mut BufReader::new(cert_file))
        .next()
        .transpose()
        .map_err(|error| format!("Could not parse mobile certificate: {error}"))?
        .ok_or_else(|| "Mobile certificate does not contain a PEM certificate".to_string())?;
    let fingerprint_hex = hex::encode_upper(Sha256::digest(certificate.as_ref()));
    Ok(fingerprint_hex
        .as_bytes()
        .chunks(2)
        .map(|pair| std::str::from_utf8(pair).expect("hex output is ASCII"))
        .collect::<Vec<_>>()
        .join(":"))
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
                    if is_usable_lan_ipv4(ip) {
                        return Ok(ip);
                    }
                }
            }
        }
    }

    let routed = routed_lan_ip().ok();
    #[cfg(target_os = "windows")]
    match windows_lan_candidates() {
        Ok(candidates) => {
            if let Some(address) = select_lan_candidate(&candidates, routed) {
                return Ok(address);
            }
        }
        Err(error) => {
            log::warn!("[MobileBridge] could not enumerate Windows LAN adapters: {error}")
        }
    }

    routed
        .filter(|address| is_usable_lan_ipv4(*address))
        .ok_or_else(|| "No usable IPv4 LAN address was found".into())
}

fn routed_lan_ip() -> Result<Ipv4Addr, String> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .map_err(|error| format!("Could not inspect LAN address: {error}"))?;
    socket
        .connect((Ipv4Addr::new(8, 8, 8, 8), 80))
        .map_err(|error| format!("Could not resolve LAN address: {error}"))?;
    match socket.local_addr().map_err(|error| error.to_string())?.ip() {
        IpAddr::V4(ip) if is_usable_lan_ipv4(ip) => Ok(ip),
        _ => Err("No usable IPv4 LAN address was found".into()),
    }
}

fn is_usable_lan_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    !address.is_unspecified()
        && !address.is_loopback()
        && !address.is_link_local()
        && !address.is_multicast()
        && octets != [255, 255, 255, 255]
        && octets[0] != 0
        // 100.64.0.0/10 is commonly a Tailscale or carrier-grade-NAT adapter,
        // not the physical LAN the paired phone can reach directly.
        && !(octets[0] == 100 && (64..=127).contains(&octets[1]))
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LanAddressCandidate {
    address: Ipv4Addr,
    interface_type: u32,
    metric: u32,
    has_gateway: bool,
    virtual_adapter: bool,
}

#[cfg(any(target_os = "windows", test))]
fn select_lan_candidate(
    candidates: &[LanAddressCandidate],
    routed: Option<Ipv4Addr>,
) -> Option<Ipv4Addr> {
    candidates
        .iter()
        .filter(|candidate| is_usable_lan_ipv4(candidate.address))
        .max_by_key(|candidate| {
            let physical_type = matches!(candidate.interface_type, 6 | 71);
            (
                !candidate.virtual_adapter,
                physical_type,
                routed == Some(candidate.address),
                candidate.address.is_private(),
                candidate.has_gateway,
                std::cmp::Reverse(candidate.metric),
                std::cmp::Reverse(u32::from_be_bytes(candidate.address.octets())),
            )
        })
        .map(|candidate| candidate.address)
}

#[cfg(target_os = "windows")]
fn windows_lan_candidates() -> Result<Vec<LanAddressCandidate>, String> {
    use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST,
        GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IF_TYPE_SOFTWARE_LOOPBACK,
        IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows_sys::Win32::Networking::WinSock::{IpDadStatePreferred, AF_INET, SOCKADDR_IN};

    const INITIAL_BUFFER_BYTES: u32 = 15 * 1024;
    const MAX_BUFFER_RETRIES: usize = 3;
    const VIRTUAL_ADAPTER_HINTS: &[&str] = &[
        "tailscale",
        "wireguard",
        "vpn",
        "virtual",
        "hyper-v",
        "vmware",
        "virtualbox",
        "vbox",
        "docker",
        "wsl",
    ];

    let mut required_bytes = INITIAL_BUFFER_BYTES;
    for _ in 0..MAX_BUFFER_RETRIES {
        let word_size = std::mem::size_of::<usize>();
        let word_count = (required_bytes as usize).div_ceil(word_size);
        // usize gives the buffer sufficient alignment for IP_ADAPTER_ADDRESSES.
        let mut buffer = vec![0_usize; word_count];
        let status = unsafe {
            GetAdaptersAddresses(
                AF_INET as u32,
                GAA_FLAG_INCLUDE_GATEWAYS
                    | GAA_FLAG_SKIP_ANYCAST
                    | GAA_FLAG_SKIP_DNS_SERVER
                    | GAA_FLAG_SKIP_MULTICAST,
                std::ptr::null(),
                buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>(),
                &mut required_bytes,
            )
        };
        if status == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if status != ERROR_SUCCESS {
            return Err(format!(
                "GetAdaptersAddresses failed with Windows error {status}"
            ));
        }

        let mut candidates = Vec::new();
        let mut adapter = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        unsafe {
            while !adapter.is_null() {
                let current = &*adapter;
                if current.OperStatus == IfOperStatusUp
                    && current.IfType != IF_TYPE_SOFTWARE_LOOPBACK
                {
                    let adapter_name = format!(
                        "{} {}",
                        windows_wide_string(current.FriendlyName),
                        windows_wide_string(current.Description)
                    )
                    .to_ascii_lowercase();
                    let virtual_adapter = matches!(current.IfType, 23 | 131)
                        || VIRTUAL_ADAPTER_HINTS
                            .iter()
                            .any(|hint| adapter_name.contains(hint));
                    let mut unicast = current.FirstUnicastAddress;
                    while !unicast.is_null() {
                        let address = &*unicast;
                        let socket_address = address.Address;
                        if address.DadState == IpDadStatePreferred
                            && !socket_address.lpSockaddr.is_null()
                            && socket_address.iSockaddrLength
                                >= std::mem::size_of::<SOCKADDR_IN>() as i32
                        {
                            let socket = &*(socket_address.lpSockaddr.cast::<SOCKADDR_IN>());
                            if socket.sin_family == AF_INET {
                                let bytes = socket.sin_addr.S_un.S_un_b;
                                candidates.push(LanAddressCandidate {
                                    address: Ipv4Addr::new(
                                        bytes.s_b1, bytes.s_b2, bytes.s_b3, bytes.s_b4,
                                    ),
                                    interface_type: current.IfType,
                                    metric: current.Ipv4Metric,
                                    has_gateway: !current.FirstGatewayAddress.is_null(),
                                    virtual_adapter,
                                });
                            }
                        }
                        unicast = address.Next;
                    }
                }
                adapter = current.Next;
            }
        }
        return Ok(candidates);
    }

    Err("GetAdaptersAddresses buffer size changed repeatedly".into())
}

#[cfg(target_os = "windows")]
unsafe fn windows_wide_string(pointer: windows_sys::core::PCWSTR) -> String {
    if pointer.is_null() {
        return String::new();
    }
    let length = (0..512)
        .find(|offset| unsafe { *pointer.add(*offset) == 0 })
        .unwrap_or(512);
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
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
        (&Method::POST, "/api/hush/signals") => {
            ingest_mobile_hush_signals(request, &app, &bridge).await
        }
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
    let revoked = bridge
        .relay_secrets
        .lock()
        .map_err(|error| error.to_string())
        .and_then(|mut relay_secrets| {
            bridge
                .devices
                .lock()
                .map_err(|error| error.to_string())
                .and_then(|mut devices| {
                    revoke_token_records(&mut devices, &mut relay_secrets, token)
                })
        });
    match revoked {
        Ok((device_id, relay_secret)) => {
            let publisher = bridge
                .runtime
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .publisher
                .clone();
            let publisher_error = publisher.and_then(|publisher| {
                publisher.revoke(&device_id).err().map(|error| {
                    publisher.stop();
                    error
                })
            });
            bridge.relay_changes.notify_one();
            schedule_relay_deletions(relay_secret.into_iter().collect());
            bridge
                .presence
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .remove(&device_id);
            if let Some(error) = publisher_error {
                log::error!("Device was revoked after wake publisher failure: {error}");
                json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Device was revoked, but wake shutdown failed",
                )
            } else {
                json_response(StatusCode::OK, &serde_json::json!({ "status": "revoked" }))
            }
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

async fn ingest_mobile_hush_signals(
    request: Request<hyper::body::Incoming>,
    app: &tauri::AppHandle,
    bridge: &MobileBridgeState,
) -> Response<HttpBody> {
    let token = request_token(&request).map(str::to_owned);
    let body = match collect_bounded_body(request.into_body(), MAX_HUSH_SIGNAL_REQUEST_BYTES).await
    {
        Ok(body) => body,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid Hush health signal batch"),
    };
    let store = app.state::<Arc<std::sync::Mutex<crate::hush_signal_store::HushSignalStore>>>();
    let mut store = store.lock().unwrap_or_else(|error| error.into_inner());
    match ingest_mobile_hush_signal_body(token.as_deref(), &body, bridge, &mut store) {
        Ok(report) => json_response(StatusCode::OK, &report),
        Err(StatusCode::UNAUTHORIZED) => {
            json_error(StatusCode::UNAUTHORIZED, "Pair this device first")
        }
        Err(_) => json_error(StatusCode::BAD_REQUEST, "Invalid Hush health signal batch"),
    }
}

fn ingest_mobile_hush_signal_body(
    token: Option<&str>,
    body: &[u8],
    bridge: &MobileBridgeState,
    store: &mut crate::hush_signal_store::HushSignalStore,
) -> Result<serde_json::Value, StatusCode> {
    let device = token
        .and_then(|token| token_device_auth(token, bridge))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let batch: crate::hush_signal_store::HushSignalBatch =
        serde_json::from_slice(body).map_err(|_| StatusCode::BAD_REQUEST)?;
    ingest_hush_signal_batch(&device.id, batch, store).map_err(|_| StatusCode::BAD_REQUEST)
}

fn ingest_hush_signal_batch(
    device_id: &str,
    batch: crate::hush_signal_store::HushSignalBatch,
    store: &mut crate::hush_signal_store::HushSignalStore,
) -> Result<serde_json::Value, String> {
    let report = store.ingest(device_id, batch)?;
    serde_json::to_value(report).map_err(|_| "Could not encode Hush health signal report".into())
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
            return json_error(
                StatusCode::UNAUTHORIZED,
                "Start pairing on the desktop app first",
            );
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
        (
            runtime.relay_base_url.clone(),
            runtime.relay_invite_code.clone(),
        )
    };
    let relay_provision =
        if let (Some(base_url), Some(invite_code)) = (relay_base_url, relay_invite_code) {
            let client = match crate::mobile_relay::RelayClient::new(base_url) {
                Ok(client) => client,
                Err(_) => {
                    return rollback_pairing_response(
                        bridge,
                        &device.id,
                        StatusCode::BAD_GATEWAY,
                        "Wake relay pairing failed",
                    );
                }
            };
            let provision = match client.register(&device.id, &invite_code).await {
                Ok(provision) => provision,
                Err(_) => {
                    return rollback_pairing_response(
                        bridge,
                        &device.id,
                        StatusCode::BAD_GATEWAY,
                        "Wake relay pairing failed",
                    );
                }
            };
            Some((client, provision))
        } else {
            None
        };

    let committed = commit_pairing_response(
        bridge,
        &device.id,
        &token,
        challenge_scope,
        relay_provision
            .as_ref()
            .map(|(_, provision)| &provision.desktop),
        relay_provision
            .as_ref()
            .map(|(_, provision)| provision.android.clone()),
    );
    match committed {
        Ok(response) => {
            if relay_provision.is_some() {
                bridge.relay_changes.notify_one();
            }
            response
        }
        Err(PairingCommitError::Cancelled) => {
            if let Some((client, provision)) = relay_provision {
                if client.delete(&provision.desktop).await.is_err() {
                    log::warn!("Could not delete a cancelled wake relay pairing");
                }
            }
            json_error(StatusCode::CONFLICT, "Pairing was cancelled")
        }
        Err(PairingCommitError::Store(error)) => {
            log::error!("Could not commit mobile pairing: {error}");
            // Roll back the local device before awaiting remote cleanup. This
            // leaves no window in which a failed commit is still authorized.
            let response = rollback_pairing_response(
                bridge,
                &device.id,
                StatusCode::INTERNAL_SERVER_ERROR,
                "Wake relay pairing failed",
            );
            if let Some((client, provision)) = relay_provision {
                if client.delete(&provision.desktop).await.is_err() {
                    log::warn!("Could not delete a failed wake relay pairing");
                }
            }
            response
        }
    }
}

fn request_scope(
    request: &Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Option<MobileDeviceScope> {
    request_device_auth(request, bridge).map(|device| device.scope)
}

fn request_device_auth(
    request: &Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Option<MobileDeviceAuth> {
    request_token(request).and_then(|token| token_device_auth(token, bridge))
}

fn token_scope(token: &str, bridge: &MobileBridgeState) -> Option<MobileDeviceScope> {
    token_device_auth(token, bridge).map(|device| device.scope)
}

fn token_device_auth(token: &str, bridge: &MobileBridgeState) -> Option<MobileDeviceAuth> {
    bridge
        .devices
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .authorize_device(token)
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
    relay_id: Option<String>,
    relay_secret: Option<crate::mobile_relay::RelayDeviceSecret>,
}

impl PairingChallenge {
    fn new(code: &str, now: i64, scope: MobileDeviceScope) -> Self {
        Self {
            code: code.to_ascii_uppercase(),
            expires_at: now + PAIRING_TTL_SECONDS,
            failed_attempts: 0,
            scope,
            relay_id: None,
            relay_secret: None,
        }
    }

    fn for_relay(
        mut self,
        relay_id: &str,
        relay_secret: Option<crate::mobile_relay::RelayDeviceSecret>,
    ) -> Self {
        self.relay_id = Some(relay_id.to_string());
        self.relay_secret = relay_secret;
        self
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

fn claim_temporary_pairing(
    bridge: &MobileBridgeState,
    relay_id: &str,
    code: &str,
    now: i64,
) -> Result<MobileDeviceScope, String> {
    let mut runtime = bridge.runtime.lock().map_err(|error| error.to_string())?;
    let challenge = runtime
        .pairing
        .as_mut()
        .ok_or_else(|| "Pairing is no longer active".to_string())?;
    if challenge.relay_id.as_deref() != Some(relay_id) {
        return Err("Pairing belongs to another relay".into());
    }
    challenge.verify(code, now)?;
    let scope = challenge.scope;
    runtime.pairing = None;
    Ok(scope)
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
            if std::fs::symlink_metadata(&path)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                return Err("Mobile device store cannot be a symbolic link".into());
            }
            set_owner_only(&path)?;
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
        if let Err(error) = self.persist() {
            self.devices.pop();
            return Err(error);
        }
        Ok(device)
    }

    #[cfg(test)]
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
        let previous = self.devices.clone();
        let before = self.devices.len();
        self.devices.retain(|device| device.id != device_id);
        if self.devices.len() == before {
            return Err("Paired mobile device not found".into());
        }
        if let Err(error) = self.persist() {
            self.devices = previous;
            return Err(error);
        }
        Ok(())
    }

    fn revoke_all(&mut self) -> Result<(), String> {
        let previous = std::mem::take(&mut self.devices);
        if let Err(error) = self.persist() {
            self.devices = previous;
            return Err(error);
        }
        Ok(())
    }

    fn persist(&self) -> Result<(), String> {
        let content = serde_json::to_vec_pretty(&self.devices)
            .map_err(|error| format!("Could not serialize mobile devices: {error}"))?;
        crate::local_api_auth::write_private_file_atomically(&self.path, &content)
            .map_err(|error| format!("Could not write mobile devices: {error}"))
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

fn set_owner_only(_path: &Path) -> Result<(), String> {
    crate::local_api_auth::protect_owner_only(_path)
        .map_err(|error| format!("Could not protect mobile private file: {error}"))
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
    fn anywhere_android_setup_uses_only_temporary_relay_credentials() {
        let relay = crate::mobile_relay::WakeRelayBundle {
            version: 2,
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            subscriber_token: "22".repeat(32),
            wake_key: "33".repeat(32),
            command: Some(crate::mobile_relay::RelayCommandPublisherBundle {
                channel_id: "44".repeat(32),
                publisher_token: "55".repeat(32),
                key: "66".repeat(32),
            }),
        };
        let setup = android_setup_payload_with_relay(
            "https://192.168.1.20:31276",
            "ABCD1234",
            MobileDeviceScope::Control,
            "AA:BB:CC",
            1_800_000_300,
            &relay,
        );
        let value: serde_json::Value = serde_json::from_str(&setup).unwrap();

        assert_eq!(value["version"], 2);
        assert_eq!(value["expires_at"], 1_800_000_300_i64);
        assert_eq!(value["pairing_relay"]["version"], 2);
        assert_eq!(
            value["pairing_relay"]["command"]["channel_id"],
            "44".repeat(32)
        );
        assert_eq!(value.as_object().unwrap().len(), 7);
        assert!(!setup.contains("\"token\""));
        assert!(!setup.contains("device_id"));
    }

    #[test]
    fn temporary_relay_pair_request_is_authenticated_and_strict() {
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: "pairing-1".into(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
            command: Some(crate::mobile_relay::RelayCommandSubscriberSecret {
                channel_id: "44".repeat(32),
                subscriber_token: "55".repeat(32),
                key: "66".repeat(32),
                last_sequence: 0,
                pending_request_id: None,
            }),
            pending_downlink: None,
        };
        let envelope = crate::anywhere_crypto::encrypt_anywhere(
            "66".repeat(32).as_str(),
            "44".repeat(32).as_str(),
            crate::anywhere_crypto::AnywhereDirection::Uplink,
            1,
            "request",
            "77".repeat(16).as_str(),
            1_800_000_000,
            1_800_000_300,
            &serde_json::json!({
                "operation": "pair",
                "code": "ABCD1234",
                "device_name": "Xiaomi 14",
                "reply_key": "99".repeat(32)
            }),
            "00".repeat(12).as_str(),
        )
        .unwrap();

        let request = parse_temporary_pair_request(&secret, &envelope, 1_800_000_001).unwrap();

        assert_eq!(request.request_id, "77".repeat(16));
        assert_eq!(request.code, "ABCD1234");
        assert_eq!(request.device_name, "Xiaomi 14");
        assert_eq!(request.reply_key, "99".repeat(32));
        assert_eq!(request.sequence, 1);
        assert_eq!(
            temporary_pair_response_channel(&request.request_id),
            "37a5337f5150b1d1c80cca8a7a1988a68ba8c9bc57947064ce841358b466ea81"
        );
        assert!(parse_temporary_pair_request(&secret, &envelope, 1_800_000_301).is_err());

        let unexpected = crate::anywhere_crypto::encrypt_anywhere(
            "66".repeat(32).as_str(),
            "44".repeat(32).as_str(),
            crate::anywhere_crypto::AnywhereDirection::Uplink,
            2,
            "request",
            "88".repeat(16).as_str(),
            1_800_000_000,
            1_800_000_300,
            &serde_json::json!({
                "operation": "pair",
                "code": "ABCD1234",
                "device_name": "Xiaomi 14",
                "reply_key": "99".repeat(32),
                "token": "must-not-be-accepted"
            }),
            "01".repeat(12).as_str(),
        )
        .unwrap();
        assert!(parse_temporary_pair_request(&secret, &unexpected, 1_800_000_001).is_err());
    }

    #[test]
    fn temporary_pairing_challenge_is_bound_to_one_relay_and_claimed_once() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let now = 1_800_000_000;
        bridge.runtime.lock().unwrap().pairing = Some(
            PairingChallenge::new("ABCD1234", now, MobileDeviceScope::Control)
                .for_relay("pairing-one", None),
        );

        assert!(claim_temporary_pairing(&bridge, "pairing-two", "ABCD1234", now + 1).is_err());
        assert_eq!(
            claim_temporary_pairing(&bridge, "pairing-one", "ABCD1234", now + 1).unwrap(),
            MobileDeviceScope::Control
        );
        assert!(claim_temporary_pairing(&bridge, "pairing-one", "ABCD1234", now + 1).is_err());
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
    fn windows_lan_selection_prefers_reachable_physical_adapters() {
        let wifi = LanAddressCandidate {
            address: Ipv4Addr::new(192, 168, 50, 20),
            interface_type: 71,
            metric: 50,
            has_gateway: false,
            virtual_adapter: false,
        };
        let ethernet = LanAddressCandidate {
            address: Ipv4Addr::new(192, 168, 1, 20),
            interface_type: 6,
            metric: 25,
            has_gateway: true,
            virtual_adapter: false,
        };
        let vpn = LanAddressCandidate {
            address: Ipv4Addr::new(10, 8, 0, 2),
            interface_type: 131,
            metric: 1,
            has_gateway: true,
            virtual_adapter: true,
        };
        let hyper_v = LanAddressCandidate {
            address: Ipv4Addr::new(172, 20, 0, 1),
            interface_type: 6,
            metric: 1,
            has_gateway: true,
            virtual_adapter: true,
        };
        let tailscale = LanAddressCandidate {
            address: Ipv4Addr::new(100, 101, 2, 3),
            interface_type: 6,
            metric: 1,
            has_gateway: true,
            virtual_adapter: true,
        };
        let public_looking_wifi = LanAddressCandidate {
            address: Ipv4Addr::new(30, 169, 112, 215),
            interface_type: 71,
            metric: 75,
            has_gateway: true,
            virtual_adapter: false,
        };

        // Offline Wi-Fi remains usable without an internet route or gateway.
        assert_eq!(
            select_lan_candidate(&[hyper_v, wifi], None),
            Some(wifi.address)
        );
        // A VPN-owned default route must not hide the physical LAN.
        assert_eq!(
            select_lan_candidate(&[vpn, wifi], Some(vpn.address)),
            Some(wifi.address)
        );
        // Between physical adapters, the routed interface is the best default.
        assert_eq!(
            select_lan_candidate(&[ethernet, wifi], Some(wifi.address)),
            Some(wifi.address)
        );
        // Some phone hotspots expose a public-looking on-link subnet. The
        // routed physical adapter must win over an unrelated private adapter.
        assert_eq!(
            select_lan_candidate(
                &[ethernet, public_looking_wifi],
                Some(public_looking_wifi.address),
            ),
            Some(public_looking_wifi.address)
        );
        assert_eq!(
            select_lan_candidate(&[tailscale], Some(tailscale.address)),
            None
        );
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
                pending_downlink: None,
            })
            .unwrap();

        rollback_paired_device(&bridge, &device.id).unwrap();

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
    fn relay_pairing_commit_cannot_follow_a_concurrent_revoke() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = Arc::new(MobileBridgeState::load_or_create(temp.path()).unwrap());
        let token = "phone-token".to_string();
        let device = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Phone", &token, MobileDeviceScope::Control)
            .unwrap();
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: device.id.clone(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
            command: None,
            pending_downlink: None,
        };
        let bundle = crate::mobile_relay::WakeRelayBundle {
            version: 1,
            base_url: secret.base_url.clone(),
            channel_id: secret.channel_id.clone(),
            subscriber_token: "44".repeat(32),
            wake_key: secret.wake_key.clone(),
            command: None,
        };
        let (registered_tx, registered_rx) = std::sync::mpsc::sync_channel(0);
        let (resume_tx, resume_rx) = std::sync::mpsc::sync_channel(0);
        let pairing_bridge = Arc::clone(&bridge);
        let pairing_device_id = device.id.clone();
        let pairing = std::thread::spawn(move || {
            // Model the exact interleaving around RelayClient::register().await:
            // remote registration has finished, but local commit has not run.
            registered_tx.send(()).unwrap();
            resume_rx.recv().unwrap();
            commit_pairing_response(
                &pairing_bridge,
                &pairing_device_id,
                &token,
                MobileDeviceScope::Control,
                Some(&secret),
                Some(bundle),
            )
        });

        registered_rx.recv().unwrap();
        bridge.revoke_device(&device.id).unwrap();
        resume_tx.send(()).unwrap();
        let committed = pairing.join().unwrap();

        assert!(matches!(committed, Err(PairingCommitError::Cancelled)));
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
        assert!(
            crate::mobile_relay::MobileRelaySecretStore::load_or_create(temp.path())
                .unwrap()
                .get(&device.id)
                .is_none()
        );
    }

    #[test]
    fn cross_store_revoke_restores_relay_when_device_commit_fails() {
        let temp = tempfile::tempdir().unwrap();
        let mut devices = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let mut relay_secrets =
            crate::mobile_relay::MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        let device = devices
            .add_device("Phone", "phone-token", MobileDeviceScope::Control)
            .unwrap();
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: device.id.clone(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
            command: None,
            pending_downlink: None,
        };
        relay_secrets.put(secret.clone()).unwrap();
        let blocker = temp.path().join("not-a-directory");
        std::fs::write(&blocker, b"block device persistence").unwrap();
        devices.path = blocker.join("mobile-devices.json");

        assert!(revoke_device_records(&mut devices, &mut relay_secrets, &device.id).is_err());

        assert_eq!(
            devices.authorize("phone-token"),
            Some(MobileDeviceScope::Control)
        );
        assert_eq!(relay_secrets.get(&device.id), Some(&secret));
        assert_eq!(
            crate::mobile_relay::MobileRelaySecretStore::load_or_create(temp.path())
                .unwrap()
                .get(&device.id),
            Some(&secret)
        );
    }

    #[test]
    fn cross_store_revoke_leaves_device_when_relay_commit_fails() {
        let temp = tempfile::tempdir().unwrap();
        let mut devices = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let mut relay_secrets =
            crate::mobile_relay::MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        let device = devices
            .add_device("Phone", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: device.id.clone(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
            command: None,
            pending_downlink: None,
        };
        relay_secrets.put(secret.clone()).unwrap();
        let blocker = temp.path().join("not-a-directory");
        std::fs::write(&blocker, b"block relay persistence").unwrap();
        relay_secrets.set_path_for_test(blocker.join("mobile-relay-secrets.json"));

        assert!(revoke_device_records(&mut devices, &mut relay_secrets, &device.id).is_err());

        assert_eq!(
            devices.authorize("phone-token"),
            Some(MobileDeviceScope::Read)
        );
        assert_eq!(relay_secrets.get(&device.id), Some(&secret));
    }

    #[test]
    fn cross_store_revoke_all_restores_relays_when_device_commit_fails() {
        let temp = tempfile::tempdir().unwrap();
        let mut devices = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let mut relay_secrets =
            crate::mobile_relay::MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        let device = devices
            .add_device("Phone", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: device.id.clone(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
            command: None,
            pending_downlink: None,
        };
        relay_secrets.put(secret.clone()).unwrap();
        let blocker = temp.path().join("not-a-directory");
        std::fs::write(&blocker, b"block device persistence").unwrap();
        devices.path = blocker.join("mobile-devices.json");

        assert!(revoke_all_device_records(&mut devices, &mut relay_secrets).is_err());

        assert_eq!(
            devices.authorize("phone-token"),
            Some(MobileDeviceScope::Read)
        );
        assert_eq!(relay_secrets.get(&device.id), Some(&secret));
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
                    pending_downlink: None,
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
            pending_downlink: None,
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
    fn anywhere_snapshot_encrypts_only_the_scoped_mobile_page() {
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: "device-phone".into(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 7,
            command: Some(crate::mobile_relay::RelayCommandSubscriberSecret {
                channel_id: "44".repeat(32),
                subscriber_token: "55".repeat(32),
                key: "66".repeat(32),
                last_sequence: 0,
                pending_request_id: None,
            }),
            pending_downlink: None,
        };
        let page = serde_json::json!({
            "scope": "read",
            "cursor": "77".repeat(32),
            "sessions": [{
                "id": "session-1",
                "agent": "codex",
                "project": "HUMHUM",
                "status": "active",
                "last_activity_at": "2026-07-16T08:00:00Z",
                "needs_attention": false,
                "pending_actions": [],
                "can_message": false,
                "can_read_conversation": true
            }]
        });
        let envelope = anywhere_snapshot_envelope(
            &secret,
            &page,
            1_783_836_000,
            "000102030405060708090a0b",
            &"88".repeat(16),
        )
        .unwrap();
        let message = crate::anywhere_crypto::decrypt_anywhere(
            &secret.wake_key,
            &secret.channel_id,
            crate::anywhere_crypto::AnywhereDirection::Downlink,
            &envelope,
            1_783_836_001,
            0,
        )
        .unwrap();

        assert_eq!(message.kind, "snapshot");
        assert_eq!(message.body, page);
        let serialized = serde_json::to_string(&envelope).unwrap();
        assert!(!serialized.contains("session-1"));
        assert!(!serialized.contains("HUMHUM"));
    }

    #[test]
    fn anywhere_request_parser_enforces_scope_and_strict_action_bounds() {
        assert!(matches!(
            parse_anywhere_request(
                MobileDeviceScope::Read,
                &serde_json::json!({"action": "conversation", "session_id": "session-1"}),
            )
            .unwrap(),
            AnywhereRequest::Conversation { .. }
        ));
        for body in [
            serde_json::json!({
                "action": "approval",
                "provider": "codex",
                "id": "approval-1",
                "decision": "allow_once"
            }),
            serde_json::json!({
                "action": "message",
                "session_id": "session-1",
                "provider": "codex",
                "message": "continue"
            }),
        ] {
            assert!(parse_anywhere_request(MobileDeviceScope::Read, &body).is_err());
            assert!(parse_anywhere_request(MobileDeviceScope::Control, &body).is_ok());
        }
        assert!(parse_anywhere_request(
            MobileDeviceScope::Control,
            &serde_json::json!({"action": "shell", "command": "rm -rf /"}),
        )
        .is_err());
        assert!(parse_anywhere_request(
            MobileDeviceScope::Control,
            &serde_json::json!({
                "action": "message",
                "session_id": "session-1",
                "provider": "codex",
                "message": "x".repeat(20_001)
            }),
        )
        .is_err());
    }

    fn valid_daily_steps(source_id: &str) -> crate::hush_signal_store::HushSignalInput {
        let ended_at = chrono::Utc::now() - chrono::Duration::minutes(1);
        let started_at = ended_at - chrono::Duration::hours(24);
        crate::hush_signal_store::HushSignalInput {
            source_id: source_id.into(),
            kind: "health.steps.daily".into(),
            started_at: started_at.to_rfc3339(),
            ended_at: ended_at.to_rfc3339(),
            value: 6_420.0,
            unit: "count".into(),
            source: "health_connect".into(),
            captured_at: ended_at.to_rfc3339(),
            quality: "trusted".into(),
        }
    }

    #[test]
    fn signal_parser_accepts_read_devices_and_rejects_oversized_batches() {
        let request = parse_anywhere_request(
            MobileDeviceScope::Read,
            &json!({"action": "signals_upload", "signals": [valid_daily_steps("steps-1")] }),
        )
        .unwrap();
        assert!(matches!(request, AnywhereRequest::SignalsUpload { .. }));

        assert!(parse_anywhere_request(
            MobileDeviceScope::Control,
            &json!({
                "action": "signals_upload",
                "signals": (0..32).map(|index| valid_daily_steps(&format!("steps-{index}"))).collect::<Vec<_>>()
            }),
        )
        .is_err());
    }

    #[test]
    fn signal_ingest_is_device_bound_idempotent_and_returns_a_stable_report() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let device = bridge
            .devices
            .lock()
            .unwrap()
            .add_device("Read phone", "read-token", MobileDeviceScope::Read)
            .unwrap();
        let batch = crate::hush_signal_store::HushSignalBatch {
            signals: vec![valid_daily_steps("steps-1")],
        };
        let body = serde_json::to_vec(&batch).unwrap();
        let mut direct_store =
            crate::hush_signal_store::HushSignalStore::load_or_create(temp.path()).unwrap();
        let direct =
            ingest_mobile_hush_signal_body(Some("read-token"), &body, &bridge, &mut direct_store)
                .unwrap();
        assert_eq!(direct, json!({"imported": 1, "duplicates": 0}));

        let relay_temp = tempfile::tempdir().unwrap();
        let mut relay_store =
            crate::hush_signal_store::HushSignalStore::load_or_create(relay_temp.path()).unwrap();
        let relay = ingest_hush_signal_batch(&device.id, batch.clone(), &mut relay_store).unwrap();
        assert_eq!(relay, direct);
        let duplicate = ingest_hush_signal_batch(&device.id, batch, &mut relay_store).unwrap();
        assert_eq!(duplicate, json!({"imported": 0, "duplicates": 1}));
    }

    #[test]
    fn signal_upload_rejects_unknown_oversized_and_revoked_devices() {
        let temp = tempfile::tempdir().unwrap();
        let bridge = MobileBridgeState::load_or_create(temp.path()).unwrap();
        let mut devices = bridge.devices.lock().unwrap();
        let device = devices
            .add_device("Phone", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        drop(devices);
        let mut store =
            crate::hush_signal_store::HushSignalStore::load_or_create(temp.path()).unwrap();
        let body = serde_json::to_vec(&crate::hush_signal_store::HushSignalBatch {
            signals: vec![valid_daily_steps("steps-1")],
        })
        .unwrap();
        assert_eq!(
            ingest_mobile_hush_signal_body(Some("unknown"), &body, &bridge, &mut store),
            Err(StatusCode::UNAUTHORIZED)
        );
        let oversized = serde_json::to_vec(&crate::hush_signal_store::HushSignalBatch {
            signals: (0..32)
                .map(|index| valid_daily_steps(&format!("steps-{index}")))
                .collect(),
        })
        .unwrap();
        assert_eq!(
            ingest_mobile_hush_signal_body(Some("phone-token"), &oversized, &bridge, &mut store),
            Err(StatusCode::BAD_REQUEST)
        );
        let mut devices = bridge.devices.lock().unwrap();
        devices.revoke_device(&device.id).unwrap();
        drop(devices);
        assert_eq!(
            ingest_mobile_hush_signal_body(Some("phone-token"), &body, &bridge, &mut store),
            Err(StatusCode::UNAUTHORIZED)
        );
    }

    #[test]
    fn anywhere_command_response_remains_available_for_offline_phone() {
        let secret = crate::mobile_relay::RelayDeviceSecret {
            device_id: "device-phone".into(),
            base_url: "https://relay.example.com".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
            command: Some(crate::mobile_relay::RelayCommandSubscriberSecret {
                channel_id: "44".repeat(32),
                subscriber_token: "55".repeat(32),
                key: "66".repeat(32),
                last_sequence: 1,
                pending_request_id: Some("77".repeat(16)),
            }),
            pending_downlink: None,
        };
        let now = chrono::Utc::now().timestamp();
        let envelope = command_response_envelope(
            &secret,
            &"77".repeat(16),
            &serde_json::json!({"ok": true, "data": {"status": "resolved"}}),
        )
        .unwrap();

        assert!(crate::anywhere_crypto::decrypt_anywhere(
            &secret.wake_key,
            &secret.channel_id,
            crate::anywhere_crypto::AnywhereDirection::Downlink,
            &envelope,
            now + 3_600,
            0,
        )
        .is_ok());
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
    fn failed_device_persistence_rolls_back_memory() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileDeviceStore::load_or_create(temp.path()).unwrap();
        let paired = store
            .add_device("My phone", "phone-token", MobileDeviceScope::Read)
            .unwrap();
        let blocker = temp.path().join("not-a-directory");
        std::fs::write(&blocker, b"block child creation").unwrap();
        store.path = blocker.join("mobile-devices.json");

        assert!(store
            .add_device("Tablet", "tablet-token", MobileDeviceScope::Control)
            .is_err());
        assert_eq!(store.authorize("tablet-token"), None);
        assert!(store.revoke_device(&paired.id).is_err());
        assert_eq!(
            store.authorize("phone-token"),
            Some(MobileDeviceScope::Read)
        );
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
        let phone = store
            .add_device("Phone", "phone-token", MobileDeviceScope::Control)
            .unwrap();
        store
            .add_device("Tablet", "tablet-token", MobileDeviceScope::Read)
            .unwrap();
        let mut relay_secrets =
            crate::mobile_relay::MobileRelaySecretStore::load_or_create(temp.path()).unwrap();

        let (revoked_id, relay_secret) =
            revoke_token_records(&mut store, &mut relay_secrets, "phone-token").unwrap();

        assert_eq!(revoked_id, phone.id);
        assert!(relay_secret.is_none());
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
        load_tls_config(&first.cert_path, &first.key_path).unwrap();
        let second = ensure_certificate(temp.path()).unwrap();

        assert_eq!(first.fingerprint, second.fingerprint);
        assert_eq!(first.fingerprint.len(), 95);
        assert_eq!(first.fingerprint.matches(':').count(), 31);
        assert!(first.fingerprint.chars().all(|character| character == ':'
            || character.is_ascii_digit()
            || ('A'..='F').contains(&character)));
        assert_eq!(cert_before, std::fs::read(&second.cert_path).unwrap());
        assert_eq!(key_before, std::fs::read(&second.key_path).unwrap());
    }

    #[test]
    fn incomplete_certificate_identity_is_reported_without_regeneration() {
        let temp = tempfile::tempdir().unwrap();
        let cert_path = temp.path().join("mobile-cert.pem");
        std::fs::write(&cert_path, "existing certificate").unwrap();

        let error = ensure_certificate(temp.path()).unwrap_err();

        assert!(error.contains("incomplete"));
        assert_eq!(
            std::fs::read_to_string(cert_path).unwrap(),
            "existing certificate"
        );
        assert!(!temp.path().join("mobile-key.pem").exists());
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
