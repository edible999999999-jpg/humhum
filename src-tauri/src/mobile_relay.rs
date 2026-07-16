use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::collections::HashSet;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[allow(dead_code)]
const COALESCE_MILLIS: u64 = 1_000;
const RETRY_MILLIS: [u64; 4] = [5_000, 15_000, 30_000, 60_000];
const MAX_RELAY_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RelayPublisherStatus {
    Disabled,
    Connected,
    Retrying,
    Errored,
}

impl RelayPublisherStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Connected => "connected",
            Self::Retrying => "retrying",
            Self::Errored => "errored",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingWake {
    pub(crate) device_id: String,
    pub(crate) cursor: String,
}

#[derive(Default)]
struct DevicePublisherState {
    published_cursor: Option<String>,
    pending_cursor: Option<String>,
    due_at: u64,
    failures: usize,
}

#[derive(Default)]
pub(crate) struct PublisherState {
    devices: BTreeMap<String, DevicePublisherState>,
}

impl PublisherState {
    #[allow(dead_code)]
    pub(crate) fn observe(&mut self, device_id: &str, cursor: &str, now: u64) {
        self.observe_after(device_id, cursor, now, COALESCE_MILLIS);
    }

    fn observe_after(&mut self, device_id: &str, cursor: &str, now: u64, coalesce: u64) {
        let state = self.devices.entry(device_id.to_string()).or_default();
        if state.published_cursor.is_none() {
            state.published_cursor = Some(cursor.to_string());
            return;
        }
        if state.published_cursor.as_deref() == Some(cursor) {
            state.pending_cursor = None;
            state.failures = 0;
            return;
        }
        if state.pending_cursor.is_none() {
            state.due_at = now.saturating_add(coalesce);
        }
        state.pending_cursor = Some(cursor.to_string());
    }

    pub(crate) fn ready(&self, now: u64) -> Vec<PendingWake> {
        self.devices
            .iter()
            .filter(|&(_device_id, state)| state.pending_cursor.is_some() && now >= state.due_at)
            .map(|(device_id, state)| PendingWake {
                device_id: device_id.clone(),
                cursor: state.pending_cursor.clone().unwrap_or_default(),
            })
            .collect()
    }

    pub(crate) fn succeeded(&mut self, device_id: &str, cursor: &str) {
        let Some(state) = self.devices.get_mut(device_id) else {
            return;
        };
        if state.pending_cursor.as_deref() == Some(cursor) {
            state.published_cursor = state.pending_cursor.take();
            state.failures = 0;
        }
    }

    #[allow(dead_code)]
    pub(crate) fn failed(&mut self, device_id: &str, now: u64) {
        self.failed_after(device_id, now, RETRY_MILLIS);
    }

    fn failed_after(&mut self, device_id: &str, now: u64, retries: [u64; 4]) {
        let Some(state) = self.devices.get_mut(device_id) else {
            return;
        };
        let delay = retries[state.failures.min(retries.len() - 1)];
        state.failures = state.failures.saturating_add(1);
        state.due_at = now.saturating_add(delay);
    }

    fn next_due(&self) -> Option<u64> {
        self.devices
            .values()
            .filter(|state| state.pending_cursor.is_some())
            .map(|state| state.due_at)
            .min()
    }

    fn has_pending(&self, device_id: &str) -> bool {
        self.devices
            .get(device_id)
            .is_some_and(|state| state.pending_cursor.is_some())
    }

    fn exhaust(&mut self, device_id: &str) {
        let Some(state) = self.devices.get_mut(device_id) else {
            return;
        };
        state.failures = RETRY_MILLIS.len();
        state.due_at = u64::MAX;
    }

    pub(crate) fn remove(&mut self, device_id: &str) {
        self.devices.remove(device_id);
    }

    pub(crate) fn clear(&mut self) {
        self.devices.clear();
    }

    pub(crate) fn status(&self, enabled: bool) -> RelayPublisherStatus {
        if !enabled {
            return RelayPublisherStatus::Disabled;
        }
        let failures = self
            .devices
            .values()
            .map(|state| state.failures)
            .max()
            .unwrap_or(0);
        if failures >= RETRY_MILLIS.len() {
            RelayPublisherStatus::Errored
        } else if failures > 0 {
            RelayPublisherStatus::Retrying
        } else {
            RelayPublisherStatus::Connected
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct PublisherTiming {
    pub(crate) coalesce: Duration,
    pub(crate) retries: [Duration; 4],
}

impl Default for PublisherTiming {
    fn default() -> Self {
        Self {
            coalesce: Duration::from_secs(1),
            retries: [
                Duration::from_secs(5),
                Duration::from_secs(15),
                Duration::from_secs(30),
                Duration::from_secs(60),
            ],
        }
    }
}

enum PublisherCommand {
    Observe {
        device_id: String,
        cursor: String,
    },
    Revoke {
        device_id: String,
        complete: std::sync::mpsc::SyncSender<()>,
    },
    Clear {
        complete: std::sync::mpsc::SyncSender<()>,
    },
    Stop,
}

pub(crate) struct WakePublisher {
    commands: tokio::sync::mpsc::UnboundedSender<PublisherCommand>,
    status: Arc<Mutex<RelayPublisherStatus>>,
    lifecycle: Arc<PublisherLifecycle>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

#[derive(Default)]
struct PublisherLifecycle {
    stopping: AtomicBool,
    clearing: AtomicBool,
    barriers: AtomicUsize,
    revoked: Mutex<HashSet<String>>,
}

impl WakePublisher {
    pub(crate) fn start(
        secrets: Arc<Mutex<MobileRelaySecretStore>>,
        timing: PublisherTiming,
    ) -> Arc<Self> {
        let (commands, receiver) = tokio::sync::mpsc::unbounded_channel();
        let status = Arc::new(Mutex::new(RelayPublisherStatus::Connected));
        let lifecycle = Arc::new(PublisherLifecycle::default());
        let publisher_status = Arc::clone(&status);
        let publisher_lifecycle = Arc::clone(&lifecycle);
        let thread = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            match runtime {
                Ok(runtime) => runtime.block_on(run_publisher(
                    secrets,
                    receiver,
                    publisher_status,
                    publisher_lifecycle,
                    timing,
                )),
                Err(_) => {
                    *publisher_status
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()) = RelayPublisherStatus::Errored;
                }
            }
        });
        Arc::new(Self {
            commands,
            status,
            lifecycle,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub(crate) fn observe(&self, device_id: &str, cursor: &str) {
        if self.lifecycle.stopping.load(Ordering::Acquire)
            || self.lifecycle.clearing.load(Ordering::Acquire)
            || self
                .lifecycle
                .revoked
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .contains(device_id)
        {
            return;
        }
        let _ = self.commands.send(PublisherCommand::Observe {
            device_id: device_id.to_string(),
            cursor: cursor.to_string(),
        });
    }

    pub(crate) fn revoke(&self, device_id: &str) -> Result<(), String> {
        self.lifecycle.barriers.fetch_add(1, Ordering::AcqRel);
        self.lifecycle
            .revoked
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(device_id.to_string());
        let (complete, completed) = std::sync::mpsc::sync_channel(0);
        if self
            .commands
            .send(PublisherCommand::Revoke {
                device_id: device_id.to_string(),
                complete,
            })
            .is_err()
        {
            self.lifecycle.barriers.fetch_sub(1, Ordering::AcqRel);
            return Err("Wake publisher is unavailable".into());
        }
        completed
            .recv()
            .map_err(|_| "Wake publisher stopped during revocation".to_string())
    }

    pub(crate) fn clear(&self) -> Result<(), String> {
        self.lifecycle.barriers.fetch_add(1, Ordering::AcqRel);
        self.lifecycle.clearing.store(true, Ordering::Release);
        let (complete, completed) = std::sync::mpsc::sync_channel(0);
        if self
            .commands
            .send(PublisherCommand::Clear { complete })
            .is_err()
        {
            self.lifecycle.barriers.fetch_sub(1, Ordering::AcqRel);
            return Err("Wake publisher is unavailable".into());
        }
        completed
            .recv()
            .map_err(|_| "Wake publisher stopped during revocation".to_string())
    }

    pub(crate) fn stop(&self) {
        let thread = self
            .thread
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        if let Some(thread) = thread {
            self.lifecycle.stopping.store(true, Ordering::Release);
            let _ = self.commands.send(PublisherCommand::Stop);
            let _ = thread.join();
        }
    }

    pub(crate) fn status(&self) -> RelayPublisherStatus {
        *self
            .status
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

impl Drop for WakePublisher {
    fn drop(&mut self) {
        if let Ok(thread) = self.thread.get_mut() {
            if let Some(thread) = thread.take() {
                self.lifecycle.stopping.store(true, Ordering::Release);
                let _ = self.commands.send(PublisherCommand::Stop);
                let _ = thread.join();
            }
        }
    }
}

async fn run_publisher(
    secrets: Arc<Mutex<MobileRelaySecretStore>>,
    mut commands: tokio::sync::mpsc::UnboundedReceiver<PublisherCommand>,
    status: Arc<Mutex<RelayPublisherStatus>>,
    lifecycle: Arc<PublisherLifecycle>,
    timing: PublisherTiming,
) {
    let started = std::time::Instant::now();
    let coalesce = duration_millis(timing.coalesce);
    let retries = timing.retries.map(duration_millis);
    let mut state = PublisherState::default();
    let mut envelopes = BTreeMap::<String, crate::wake_crypto::WakeEnvelope>::new();

    loop {
        let now = elapsed_millis(started);
        let wait = state
            .next_due()
            .map(|due| Duration::from_millis(due.saturating_sub(now)))
            .unwrap_or(Duration::from_secs(86_400));
        tokio::select! {
            biased;
            command = commands.recv() => {
                match command {
                    Some(PublisherCommand::Observe { device_id, cursor }) => {
                        let exists = secrets
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .get(&device_id)
                            .is_some();
                        if exists {
                            state.observe_after(
                                &device_id,
                                &cursor,
                                elapsed_millis(started),
                                coalesce,
                            );
                            if !state.has_pending(&device_id) {
                                envelopes.remove(&device_id);
                            }
                        } else {
                            state.remove(&device_id);
                            envelopes.remove(&device_id);
                        }
                    }
                    Some(PublisherCommand::Revoke { device_id, complete }) => {
                        state.remove(&device_id);
                        envelopes.remove(&device_id);
                        lifecycle.barriers.fetch_sub(1, Ordering::AcqRel);
                        let _ = complete.send(());
                    }
                    Some(PublisherCommand::Clear { complete }) => {
                        state.clear();
                        envelopes.clear();
                        lifecycle.clearing.store(false, Ordering::Release);
                        lifecycle.barriers.fetch_sub(1, Ordering::AcqRel);
                        let _ = complete.send(());
                    }
                    Some(PublisherCommand::Stop) | None => {
                        state.clear();
                        envelopes.clear();
                        set_publisher_status(&status, RelayPublisherStatus::Disabled);
                        break;
                    }
                }
                set_publisher_status(&status, state.status(true));
            }
            _ = tokio::time::sleep(wait) => {
                let ready_at = elapsed_millis(started);
                if let Some(pending) = state.ready(ready_at).into_iter().next() {
                    if lifecycle.stopping.load(Ordering::Acquire) {
                        state.clear();
                        envelopes.clear();
                    } else if lifecycle.barriers.load(Ordering::Acquire) > 0 {
                    } else if lifecycle.clearing.load(Ordering::Acquire)
                        || lifecycle
                            .revoked
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .contains(&pending.device_id)
                    {
                        state.remove(&pending.device_id);
                        envelopes.remove(&pending.device_id);
                    } else {
                        let secret = secrets
                            .lock()
                            .unwrap_or_else(|error| error.into_inner())
                            .get(&pending.device_id)
                            .cloned();
                        if let Some(secret) = secret {
                            if secret.next_sequence >= MAX_RELAY_SEQUENCE {
                                state.exhaust(&pending.device_id);
                                envelopes.remove(&pending.device_id);
                                set_publisher_status(&status, state.status(true));
                                continue;
                            }
                            if envelopes
                                .get(&pending.device_id)
                                .is_some_and(|envelope| envelope.sequence != secret.next_sequence)
                            {
                                envelopes.remove(&pending.device_id);
                            }
                            let envelope = match envelopes.get(&pending.device_id).cloned() {
                                Some(envelope) => Ok(envelope),
                                None => create_wake_envelope(&secret).inspect(|envelope| {
                                    envelopes
                                        .insert(pending.device_id.clone(), envelope.clone());
                                }),
                            };
                            let result = envelope.and_then(|envelope| {
                                RelayBaseUrl::parse(&secret.base_url)
                                    .and_then(RelayClient::new)
                                    .map(|client| (client, envelope))
                            });
                            let result = match result {
                                Ok((client, envelope)) => client.publish(&secret, &envelope).await,
                                Err(error) => Err(error),
                            };
                            if result.is_ok()
                                && secrets
                                    .lock()
                                    .unwrap_or_else(|error| error.into_inner())
                                    .advance_sequence(&pending.device_id, secret.next_sequence)
                                    .is_ok()
                            {
                                state.succeeded(&pending.device_id, &pending.cursor);
                                envelopes.remove(&pending.device_id);
                            } else {
                                state.failed_after(
                                    &pending.device_id,
                                    elapsed_millis(started),
                                    retries,
                                );
                            }
                        } else {
                            state.remove(&pending.device_id);
                            envelopes.remove(&pending.device_id);
                        }
                    }
                    set_publisher_status(&status, state.status(true));
                }
                if lifecycle.stopping.load(Ordering::Acquire) {
                    state.clear();
                    envelopes.clear();
                    set_publisher_status(&status, RelayPublisherStatus::Disabled);
                    break;
                }
                if lifecycle.clearing.load(Ordering::Acquire) {
                    state.clear();
                    envelopes.clear();
                    set_publisher_status(&status, RelayPublisherStatus::Connected);
                }
            }
        }
    }
}

fn create_wake_envelope(
    secret: &RelayDeviceSecret,
) -> Result<crate::wake_crypto::WakeEnvelope, String> {
    let mut nonce = [0_u8; 12];
    getrandom::fill(&mut nonce).map_err(|_| "Could not create wake nonce".to_string())?;
    crate::wake_crypto::encrypt_wake(
        &secret.wake_key,
        &secret.channel_id,
        secret.next_sequence,
        chrono::Utc::now().timestamp(),
        &hex::encode(nonce),
    )
    .map_err(|_| "Could not encrypt wake signal".to_string())
}

fn set_publisher_status(status: &Mutex<RelayPublisherStatus>, value: RelayPublisherStatus) {
    *status.lock().unwrap_or_else(|error| error.into_inner()) = value;
}

fn elapsed_millis(started: std::time::Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

fn duration_millis(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

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

    fn is_loopback(&self) -> bool {
        reqwest::Url::parse(&self.0)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<IpAddr>()
                        .is_ok_and(|address| address.is_loopback())
            })
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

pub(crate) struct RelayProvision {
    pub desktop: RelayDeviceSecret,
    pub android: WakeRelayBundle,
}

pub struct RelayClient {
    base_url: RelayBaseUrl,
    client: reqwest::Client,
}

impl RelayClient {
    pub fn new(base_url: RelayBaseUrl) -> Result<Self, String> {
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(5))
            .user_agent("HUMHUM-Wake-Relay/0.1");
        // Loopback relay URLs are allowed for local development and tests.
        // They must never traverse an environment-configured proxy, which
        // could expose publisher credentials or make a local relay unreachable.
        if base_url.is_loopback() {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|_| "Could not configure relay client".to_string())?;
        Ok(Self { base_url, client })
    }

    fn endpoint(&self, path: &str) -> Result<reqwest::Url, String> {
        reqwest::Url::parse(&format!("{}{path}", self.base_url.as_str()))
            .map_err(|_| "Relay endpoint is invalid".into())
    }

    fn registration_request(&self) -> Result<reqwest::Request, String> {
        self.client
            .post(self.endpoint("/v1/channels")?)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body("{}")
            .build()
            .map_err(|_| "Could not build relay registration".into())
    }

    fn deletion_request(&self, secret: &RelayDeviceSecret) -> Result<reqwest::Request, String> {
        secret.validate()?;
        if secret.base_url != self.base_url.as_str() {
            return Err("Relay device secret uses another server".into());
        }
        self.client
            .delete(self.endpoint(&format!("/v1/channels/{}", secret.channel_id))?)
            .header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", secret.publisher_token),
            )
            .header(reqwest::header::ACCEPT, "application/json")
            .build()
            .map_err(|_| "Could not build relay deletion".into())
    }

    fn publication_request(
        &self,
        secret: &RelayDeviceSecret,
        envelope: &crate::wake_crypto::WakeEnvelope,
    ) -> Result<reqwest::Request, String> {
        secret.validate()?;
        if secret.base_url != self.base_url.as_str()
            || envelope.sequence != secret.next_sequence
            || envelope.sequence >= MAX_RELAY_SEQUENCE
        {
            return Err("Relay publication is invalid".into());
        }
        self.client
            .post(self.endpoint(&format!("/v1/channels/{}/messages", secret.channel_id))?)
            .header(
                reqwest::header::AUTHORIZATION,
                format!("Bearer {}", secret.publisher_token),
            )
            .header(reqwest::header::ACCEPT, "application/json")
            .json(envelope)
            .build()
            .map_err(|_| "Could not build relay publication".into())
    }

    pub async fn health(&self) -> Result<(), String> {
        let response = self
            .client
            .get(self.endpoint("/health")?)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| "Wake relay is unreachable".to_string())?;
        if response.status() != reqwest::StatusCode::OK {
            return Err("Wake relay health check failed".into());
        }
        let bytes = bounded_response(response, 256).await?;
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Health {
            status: String,
            name: String,
        }
        let health: Health = serde_json::from_slice(&bytes)
            .map_err(|_| "Wake relay returned invalid health data".to_string())?;
        if health.status != "ok" || health.name != "HUMHUM Wake Relay" {
            return Err("Wake relay returned invalid health data".into());
        }
        Ok(())
    }

    pub async fn register(&self, device_id: &str) -> Result<RelayProvision, String> {
        let response = self
            .client
            .execute(self.registration_request()?)
            .await
            .map_err(|_| "Could not register wake relay channel".to_string())?;
        if response.status() != reqwest::StatusCode::CREATED {
            return Err("Wake relay rejected channel registration".into());
        }
        let bytes = bounded_response(response, 1024).await?;
        let mut wake_key = [0_u8; 32];
        getrandom::fill(&mut wake_key)
            .map_err(|_| "Could not create wake encryption key".to_string())?;
        split_registration(device_id, &self.base_url, &bytes, &hex::encode(wake_key))
    }

    pub async fn delete(&self, secret: &RelayDeviceSecret) -> Result<(), String> {
        let response = self
            .client
            .execute(self.deletion_request(secret)?)
            .await
            .map_err(|_| "Could not delete wake relay channel".to_string())?;
        if response.status() != reqwest::StatusCode::NO_CONTENT {
            return Err("Wake relay rejected channel deletion".into());
        }
        Ok(())
    }

    pub async fn publish(
        &self,
        secret: &RelayDeviceSecret,
        envelope: &crate::wake_crypto::WakeEnvelope,
    ) -> Result<(), String> {
        let response = self
            .client
            .execute(self.publication_request(secret, envelope)?)
            .await
            .map_err(|_| "Could not publish wake signal".to_string())?;
        if response.status() != reqwest::StatusCode::CREATED {
            return Err("Wake relay rejected publication".into());
        }
        let bytes = bounded_response(response, 128).await?;
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PublicationResponse {
            sequence: u64,
        }
        let result: PublicationResponse = serde_json::from_slice(&bytes)
            .map_err(|_| "Wake relay returned invalid publication data".to_string())?;
        if result.sequence != envelope.sequence {
            return Err("Wake relay returned invalid publication data".into());
        }
        Ok(())
    }
}

async fn bounded_response(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("Wake relay response is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read wake relay response".to_string())?
    {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("Wake relay response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
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
            || self.next_sequence > MAX_RELAY_SEQUENCE
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
            set_owner_only(&path)?;
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
        let device_id = secret.device_id.clone();
        let previous = self.devices.insert(device_id.clone(), secret);
        if let Err(error) = self.persist() {
            if let Some(previous) = previous {
                self.devices.insert(device_id, previous);
            } else {
                self.devices.remove(&device_id);
            }
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn all(&self) -> Vec<RelayDeviceSecret> {
        self.devices.values().cloned().collect()
    }

    pub(crate) fn advance_sequence(
        &mut self,
        device_id: &str,
        published_sequence: u64,
    ) -> Result<(), String> {
        let previous = self
            .devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| "Relay device secret is unavailable".to_string())?;
        if previous.next_sequence != published_sequence {
            return Err("Relay sequence changed during publication".into());
        }
        let next_sequence = published_sequence
            .checked_add(1)
            .filter(|sequence| *sequence <= MAX_RELAY_SEQUENCE)
            .ok_or_else(|| "Relay sequence is exhausted".to_string())?;
        self.devices
            .get_mut(device_id)
            .expect("relay secret checked above")
            .next_sequence = next_sequence;
        if let Err(error) = self.persist() {
            self.devices.insert(device_id.to_string(), previous);
            return Err(error);
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn remove(&mut self, device_id: &str) -> Result<(), String> {
        let _ = self.take(device_id)?;
        Ok(())
    }

    #[cfg(test)]
    pub fn clear(&mut self) -> Result<(), String> {
        let _ = self.take_all()?;
        Ok(())
    }

    pub fn take(&mut self, device_id: &str) -> Result<Option<RelayDeviceSecret>, String> {
        let removed = self.devices.remove(device_id);
        if removed.is_none() {
            return Ok(None);
        }
        if let Err(error) = self.persist() {
            if let Some(secret) = removed.clone() {
                self.devices.insert(device_id.to_string(), secret);
            }
            return Err(error);
        }
        Ok(removed)
    }

    pub fn take_all(&mut self) -> Result<Vec<RelayDeviceSecret>, String> {
        let previous = std::mem::take(&mut self.devices);
        if let Err(error) = self.persist() {
            self.devices = previous;
            return Err(error);
        }
        let removed = previous.into_values().collect();
        Ok(removed)
    }

    pub(crate) fn restore_all(&mut self, secrets: &[RelayDeviceSecret]) -> Result<(), String> {
        let mut restored = BTreeMap::new();
        for secret in secrets {
            secret.validate()?;
            if restored
                .insert(secret.device_id.clone(), secret.clone())
                .is_some()
            {
                return Err("Relay secret rollback contains duplicate devices".into());
            }
        }
        let previous = std::mem::replace(&mut self.devices, restored);
        if let Err(error) = self.persist() {
            self.devices = previous;
            return Err(error);
        }
        Ok(())
    }

    fn persist(&self) -> Result<(), String> {
        let values = self.devices.values().collect::<Vec<_>>();
        let content = serde_json::to_vec_pretty(&values)
            .map_err(|error| format!("Could not serialize relay secrets: {error}"))?;
        crate::local_api_auth::write_private_file_atomically(&self.path, &content)
            .map_err(|error| format!("Could not write relay secrets: {error}"))
    }

    #[cfg(test)]
    pub(crate) fn set_path_for_test(&mut self, path: PathBuf) {
        self.path = path;
    }
}

fn set_owner_only(_path: &Path) -> Result<(), String> {
    crate::local_api_auth::protect_owner_only(_path)
        .map_err(|error| format!("Could not protect relay secrets: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{Arc, Mutex};

    struct SlowRelayRequest {
        envelope: crate::wake_crypto::WakeEnvelope,
        respond: tokio::sync::oneshot::Sender<(u16, String)>,
    }

    async fn slow_relay() -> (
        String,
        tokio::sync::mpsc::UnboundedReceiver<SlowRelayRequest>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (requests_tx, requests_rx) = tokio::sync::mpsc::unbounded_channel();
        let server = tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};

            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let requests_tx = requests_tx.clone();
                tokio::spawn(async move {
                    let mut request = Vec::new();
                    let mut buffer = [0_u8; 4096];
                    let body_start = loop {
                        let read = stream.read(&mut buffer).await.unwrap();
                        if read == 0 {
                            return;
                        }
                        request.extend_from_slice(&buffer[..read]);
                        if let Some(position) =
                            request.windows(4).position(|part| part == b"\r\n\r\n")
                        {
                            break position + 4;
                        }
                    };
                    let headers = String::from_utf8_lossy(&request[..body_start]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|value| value.parse::<usize>().ok())
                        })
                        .unwrap();
                    while request.len() < body_start + content_length {
                        let read = stream.read(&mut buffer).await.unwrap();
                        request.extend_from_slice(&buffer[..read]);
                    }
                    let envelope =
                        serde_json::from_slice(&request[body_start..body_start + content_length])
                            .unwrap();
                    let (respond, response) = tokio::sync::oneshot::channel();
                    requests_tx
                        .send(SlowRelayRequest { envelope, respond })
                        .unwrap();
                    let Ok((status, body)) = response.await else {
                        return;
                    };
                    let reason = if status == 201 { "Created" } else { "Error" };
                    let response = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    stream.write_all(response.as_bytes()).await.unwrap();
                });
            }
        });
        (format!("http://{address}"), requests_rx, server)
    }

    fn publisher_store(base_url: &str) -> (tempfile::TempDir, Arc<Mutex<MobileRelaySecretStore>>) {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        store.put(relay_secret(base_url)).unwrap();
        (temp, Arc::new(Mutex::new(store)))
    }

    fn fast_timing() -> PublisherTiming {
        PublisherTiming {
            coalesce: Duration::from_millis(30),
            retries: [
                Duration::from_millis(50),
                Duration::from_millis(150),
                Duration::from_millis(300),
                Duration::from_millis(600),
            ],
        }
    }

    async fn stop_publisher(publisher: Arc<WakePublisher>) {
        tokio::task::spawn_blocking(move || publisher.stop())
            .await
            .unwrap();
    }

    fn relay_secret(base_url: &str) -> RelayDeviceSecret {
        RelayDeviceSecret {
            device_id: "device-phone".into(),
            base_url: base_url.into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 7,
        }
    }

    fn wake_envelope(sequence: u64) -> crate::wake_crypto::WakeEnvelope {
        crate::wake_crypto::encrypt_wake(
            &"22".repeat(32),
            &"11".repeat(32),
            sequence,
            1_783_836_000,
            "000102030405060708090a0b",
        )
        .unwrap()
    }

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
        #[cfg(unix)]
        {
            let path = temp.path().join("mobile-relay-secrets.json");
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

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

    #[test]
    fn relay_client_builds_bounded_registration_and_deletion_requests() {
        let client =
            RelayClient::new(RelayBaseUrl::parse("https://relay.example.com:8443").unwrap())
                .unwrap();
        let registration = client.registration_request().unwrap();
        assert_eq!(registration.method(), reqwest::Method::POST);
        assert_eq!(
            registration.url().as_str(),
            "https://relay.example.com:8443/v1/channels"
        );
        assert_eq!(registration.body().unwrap().as_bytes().unwrap(), b"{}");
        assert!(registration
            .headers()
            .get(reqwest::header::AUTHORIZATION)
            .is_none());

        let secret = RelayDeviceSecret {
            device_id: "device-phone".into(),
            base_url: "https://relay.example.com:8443".into(),
            channel_id: "11".repeat(32),
            wake_key: "22".repeat(32),
            publisher_token: "33".repeat(32),
            next_sequence: 1,
        };
        let deletion = client.deletion_request(&secret).unwrap();
        assert_eq!(deletion.method(), reqwest::Method::DELETE);
        assert_eq!(
            deletion.url().as_str(),
            format!(
                "https://relay.example.com:8443/v1/channels/{}",
                secret.channel_id
            )
        );
        assert_eq!(
            deletion.headers()[reqwest::header::AUTHORIZATION],
            format!("Bearer {}", secret.publisher_token)
        );
    }

    #[tokio::test]
    async fn relay_client_posts_only_the_encrypted_envelope_with_publisher_auth() {
        let body = r#"{"sequence":7}"#;
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            loop {
                let read = stream.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
                if request.ends_with(b"}") {
                    break;
                }
            }
            stream.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8(request).unwrap()
        });
        let base_url = format!("http://{address}");
        let secret = relay_secret(&base_url);
        let envelope = wake_envelope(7);

        RelayClient::new(RelayBaseUrl::parse(&base_url).unwrap())
            .unwrap()
            .publish(&secret, &envelope)
            .await
            .unwrap();

        let request = server.await.unwrap();
        assert!(request.starts_with(&format!(
            "POST /v1/channels/{}/messages HTTP/1.1\r\n",
            secret.channel_id
        )));
        assert!(request
            .to_ascii_lowercase()
            .contains(&format!("authorization: bearer {}", secret.publisher_token)));
        let published: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(published.as_object().unwrap().len(), 4);
        assert_eq!(published["version"], 1);
        assert_eq!(published["sequence"], 7);
        for forbidden in [
            "session", "project", "scope", "device", "approval", "message",
        ] {
            assert!(!published.to_string().contains(forbidden));
        }
    }

    #[tokio::test]
    async fn relay_client_rejects_redirect_errors_mismatch_and_unbounded_responses() {
        let cases = [
            "HTTP/1.1 302 Found\r\nLocation: /elsewhere\r\nContent-Length: 0\r\n\r\n".to_string(),
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n".to_string(),
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 14\r\n\r\n{\"sequence\":8}".to_string(),
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"sequence\":7,\"extra\":true}".to_string(),
            format!(
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 600\r\n\r\n{}",
                "x".repeat(600)
            ),
        ];

        for response in cases {
            let response: &'static str = Box::leak(response.into_boxed_str());
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = [0_u8; 4096];
                let _ = stream.read(&mut buffer).await.unwrap();
                stream.write_all(response.as_bytes()).await.unwrap();
            });
            let base_url = format!("http://{address}");
            let secret = relay_secret(&base_url);
            let result = RelayClient::new(RelayBaseUrl::parse(&base_url).unwrap())
                .unwrap()
                .publish(&secret, &wake_envelope(7))
                .await;
            assert!(result.is_err());
        }
    }

    #[test]
    fn publisher_baselines_then_coalesces_only_changed_cursors_for_one_second() {
        let mut publisher = PublisherState::default();
        publisher.observe("device-phone", "cursor-a", 0);
        assert!(publisher.ready(10_000).is_empty());

        publisher.observe("device-phone", "cursor-b", 10);
        publisher.observe("device-phone", "cursor-c", 500);
        assert!(publisher.ready(1_009).is_empty());
        assert_eq!(
            publisher.ready(1_010),
            vec![PendingWake {
                device_id: "device-phone".into(),
                cursor: "cursor-c".into(),
            }]
        );

        publisher.succeeded("device-phone", "cursor-c");
        publisher.observe("device-phone", "cursor-c", 5_000);
        assert!(publisher.ready(10_000).is_empty());

        publisher.observe("device-phone", "cursor-d", 11_000);
        publisher.observe("device-phone", "cursor-c", 11_500);
        assert!(publisher.ready(20_000).is_empty());
        assert_eq!(publisher.status(true), RelayPublisherStatus::Connected);
    }

    #[test]
    fn publisher_retries_at_bounded_delays_and_keeps_only_newest_wake() {
        let mut publisher = PublisherState::default();
        publisher.observe("device-phone", "cursor-a", 0);
        publisher.observe("device-phone", "cursor-b", 1);
        assert_eq!(publisher.ready(1_001)[0].cursor, "cursor-b");

        let mut now = 1_001;
        for delay in [5_000, 15_000, 30_000, 60_000, 60_000] {
            publisher.failed("device-phone", now);
            publisher.observe("device-phone", &format!("cursor-{now}"), now + 1);
            assert!(publisher.ready(now + delay - 1).is_empty());
            assert_eq!(
                publisher.ready(now + delay)[0].cursor,
                format!("cursor-{now}")
            );
            now += delay;
        }
        assert_eq!(publisher.status(true), RelayPublisherStatus::Errored);
        publisher.succeeded("device-phone", &format!("cursor-{}", now - 60_000));
        assert_eq!(publisher.status(true), RelayPublisherStatus::Connected);
    }

    #[test]
    fn publisher_cancels_revoked_devices_and_shutdown() {
        let mut publisher = PublisherState::default();
        for device in ["device-phone", "device-tablet"] {
            publisher.observe(device, "cursor-a", 0);
            publisher.observe(device, "cursor-b", 1);
        }
        publisher.remove("device-phone");
        assert_eq!(publisher.ready(2_000)[0].device_id, "device-tablet");
        publisher.failed("device-tablet", 2_000);
        assert_eq!(publisher.status(true), RelayPublisherStatus::Retrying);
        publisher.remove("device-tablet");
        assert_eq!(publisher.status(true), RelayPublisherStatus::Connected);
        publisher.clear();
        assert!(publisher.ready(2_000).is_empty());
        assert_eq!(publisher.status(false), RelayPublisherStatus::Disabled);
    }

    #[test]
    fn successful_sequence_advance_is_atomic_and_checked() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        store
            .put(relay_secret("https://relay.example.com"))
            .unwrap();

        assert!(store.advance_sequence("device-phone", 6).is_err());
        assert_eq!(store.get("device-phone").unwrap().next_sequence, 7);
        store.advance_sequence("device-phone", 7).unwrap();
        assert_eq!(store.get("device-phone").unwrap().next_sequence, 8);
        assert_eq!(
            MobileRelaySecretStore::load_or_create(temp.path())
                .unwrap()
                .get("device-phone")
                .unwrap()
                .next_sequence,
            8
        );
    }

    #[test]
    fn failed_relay_persistence_rolls_back_memory() {
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        let original = relay_secret("https://relay.example.com");
        store.put(original.clone()).unwrap();
        let blocker = temp.path().join("not-a-directory");
        std::fs::write(&blocker, b"block child creation").unwrap();
        store.path = blocker.join("mobile-relay-secrets.json");

        let mut replacement = original.clone();
        replacement.next_sequence = 42;
        assert!(store.put(replacement).is_err());
        assert_eq!(store.get("device-phone"), Some(&original));
        assert!(store.advance_sequence("device-phone", 7).is_err());
        assert_eq!(store.get("device-phone"), Some(&original));
    }

    #[test]
    fn relay_sequences_are_bounded_to_json_safe_integers() {
        let mut secret = relay_secret("https://relay.example.com");
        secret.next_sequence = 9_007_199_254_740_991;
        assert!(secret.validate().is_ok());
        secret.next_sequence += 1;
        assert!(secret.validate().is_err());
    }

    #[test]
    fn maximum_sequence_is_a_persisted_exhausted_terminal() {
        let base_url = "https://relay.example.com";
        let client = RelayClient::new(RelayBaseUrl::parse(base_url).unwrap()).unwrap();
        let temp = tempfile::tempdir().unwrap();
        let mut store = MobileRelaySecretStore::load_or_create(temp.path()).unwrap();
        let mut secret = relay_secret(base_url);
        secret.next_sequence = MAX_RELAY_SEQUENCE - 1;
        store.put(secret.clone()).unwrap();

        assert!(client
            .publication_request(&secret, &wake_envelope(MAX_RELAY_SEQUENCE - 1))
            .is_ok());
        store
            .advance_sequence("device-phone", MAX_RELAY_SEQUENCE - 1)
            .unwrap();
        let exhausted = store.get("device-phone").unwrap();
        assert_eq!(exhausted.next_sequence, MAX_RELAY_SEQUENCE);
        assert!(exhausted.validate().is_ok());
        assert!(client
            .publication_request(exhausted, &wake_envelope(MAX_RELAY_SEQUENCE))
            .is_err());
        assert!(store
            .advance_sequence("device-phone", MAX_RELAY_SEQUENCE)
            .is_err());
    }

    #[tokio::test]
    async fn live_publisher_finishes_inflight_before_processing_newest_change() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let publisher = WakePublisher::start(Arc::clone(&store), fast_timing());
        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");

        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first.envelope.sequence, 7);
        publisher.observe("device-phone", "cursor-c");
        first
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();

        let second = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(second.envelope.sequence, 8);
        second
            .respond
            .send((201, r#"{"sequence":8}"#.into()))
            .unwrap();
        stop_publisher(publisher).await;
        assert_eq!(
            store
                .lock()
                .unwrap()
                .get("device-phone")
                .unwrap()
                .next_sequence,
            9
        );
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_backoff_starts_when_slow_failure_finishes() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let publisher = WakePublisher::start(store, fast_timing());
        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");

        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let failed_at = std::time::Instant::now();
        first.respond.send((500, "{}".into())).unwrap();
        let second = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(failed_at.elapsed() >= Duration::from_millis(50));
        second
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();
        stop_publisher(publisher).await;
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_reuses_the_exact_envelope_after_response_loss() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let publisher = WakePublisher::start(store, fast_timing());
        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");

        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        let first_envelope = first.envelope.clone();
        drop(first.respond);

        let second = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(second.envelope, first_envelope);
        second
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();
        stop_publisher(publisher).await;
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_stop_waits_for_inflight_and_reenable_has_one_owner() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let publisher = WakePublisher::start(Arc::clone(&store), fast_timing());
        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");
        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();

        let stopping = Arc::clone(&publisher);
        let stopped = tokio::task::spawn_blocking(move || stopping.stop());
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!stopped.is_finished());
        first
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();
        stopped.await.unwrap();

        let replacement = WakePublisher::start(Arc::clone(&store), fast_timing());
        replacement.observe("device-phone", "cursor-c");
        replacement.observe("device-phone", "cursor-d");
        let second = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(second.envelope.sequence, 8);
        second
            .respond
            .send((201, r#"{"sequence":8}"#.into()))
            .unwrap();
        stop_publisher(replacement).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), requests.recv())
                .await
                .is_err()
        );
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_revoke_barrier_waits_for_inflight_then_cancels_device() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let publisher = WakePublisher::start(Arc::clone(&store), fast_timing());
        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");
        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();

        let revoking = Arc::clone(&publisher);
        let revoked = tokio::task::spawn_blocking(move || revoking.revoke("device-phone"));
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(!revoked.is_finished());
        first
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();
        revoked.await.unwrap().unwrap();
        store.lock().unwrap().remove("device-phone").unwrap();
        publisher.observe("device-phone", "cursor-c");
        assert_eq!(publisher.status(), RelayPublisherStatus::Connected);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), requests.recv())
                .await
                .is_err()
        );
        stop_publisher(publisher).await;
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_stop_never_starts_another_device_after_inflight() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let mut tablet = relay_secret(&base_url);
        tablet.device_id = "device-tablet".into();
        tablet.channel_id = "44".repeat(32);
        store.lock().unwrap().put(tablet).unwrap();
        let publisher = WakePublisher::start(store, fast_timing());
        for device in ["device-phone", "device-tablet"] {
            publisher.observe(device, "cursor-a");
            publisher.observe(device, "cursor-b");
        }
        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();

        let stopping = Arc::clone(&publisher);
        let stopped = tokio::task::spawn_blocking(move || stopping.stop());
        tokio::time::sleep(Duration::from_millis(30)).await;
        first
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();
        stopped.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(100), requests.recv())
                .await
                .is_err()
        );
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_clear_barrier_allows_future_pairings() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let publisher = WakePublisher::start(store, fast_timing());
        let clearing = Arc::clone(&publisher);
        tokio::task::spawn_blocking(move || clearing.clear())
            .await
            .unwrap()
            .unwrap();

        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");
        let request = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        request
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();
        stop_publisher(publisher).await;
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_revoke_does_not_wait_for_the_next_ready_device() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let mut tablet = relay_secret(&base_url);
        tablet.device_id = "device-tablet".into();
        tablet.channel_id = "44".repeat(32);
        store.lock().unwrap().put(tablet).unwrap();
        let publisher = WakePublisher::start(store, fast_timing());
        for device in ["device-phone", "device-tablet"] {
            publisher.observe(device, "cursor-a");
            publisher.observe(device, "cursor-b");
        }
        let first = tokio::time::timeout(Duration::from_secs(1), requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first.envelope.sequence, 7);

        let revoking = Arc::clone(&publisher);
        let mut revoked = tokio::task::spawn_blocking(move || revoking.revoke("device-phone"));
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if publisher
                    .lifecycle
                    .revoked
                    .lock()
                    .unwrap()
                    .contains("device-phone")
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        first
            .respond
            .send((201, r#"{"sequence":7}"#.into()))
            .unwrap();

        let revoke_result = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::select! {
                biased;
                result = &mut revoked => result,
                _ = requests.recv() => panic!("revoke started the next device before it completed"),
            }
        })
        .await
        .expect("revoke did not complete after the current request")
        .unwrap();
        revoke_result.unwrap();

        let next_request = tokio::time::timeout(Duration::from_secs(1), requests.recv()).await;
        if let Ok(Some(request)) = next_request {
            let _ = request.respond.send((201, r#"{"sequence":7}"#.into()));
        }
        stop_publisher(publisher).await;
        server.abort();
    }

    #[tokio::test]
    async fn live_publisher_never_sends_an_exhausted_maximum_sequence() {
        let (base_url, mut requests, server) = slow_relay().await;
        let (_temp, store) = publisher_store(&base_url);
        let mut exhausted = store.lock().unwrap().get("device-phone").unwrap().clone();
        exhausted.next_sequence = MAX_RELAY_SEQUENCE;
        store.lock().unwrap().put(exhausted).unwrap();
        let publisher = WakePublisher::start(store, fast_timing());
        publisher.observe("device-phone", "cursor-a");
        publisher.observe("device-phone", "cursor-b");

        let request = tokio::time::timeout(Duration::from_secs(1), requests.recv()).await;
        if let Ok(Some(request)) = request {
            let _ = request
                .respond
                .send((201, format!(r#"{{"sequence":{MAX_RELAY_SEQUENCE}}}"#)));
            stop_publisher(publisher).await;
            server.abort();
            panic!("published exhausted maximum sequence");
        }
        assert_eq!(publisher.status(), RelayPublisherStatus::Errored);
        stop_publisher(publisher).await;
        server.abort();
    }
}
