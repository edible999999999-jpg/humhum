use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::io::BufReader;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_rustls::rustls;
use tokio_rustls::TlsAcceptor;

const PAIRING_TTL_SECONDS: i64 = 300;
const MAX_PAIRING_ATTEMPTS: u8 = 5;
pub const DEFAULT_MOBILE_PORT: u16 = 31_276;

type HttpBody = Full<Bytes>;

#[derive(Debug, Clone, Serialize)]
pub struct MobileBridgeStatus {
    pub enabled: bool,
    pub url: Option<String>,
    pub certificate_fingerprint: Option<String>,
    pub paired_devices: usize,
    pub devices: Vec<MobileDeviceSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MobilePairingInfo {
    pub code: String,
    pub expires_at: i64,
    pub url: String,
    pub certificate_fingerprint: String,
    pub scope: MobileDeviceScope,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobileDeviceScope {
    Read,
    Control,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MobileDeviceSummary {
    pub id: String,
    pub name: String,
    pub paired_at: String,
    pub scope: MobileDeviceScope,
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
    url: Option<String>,
    certificate_fingerprint: Option<String>,
    pairing: Option<PairingChallenge>,
    shutdown: Option<oneshot::Sender<()>>,
}

pub struct MobileBridgeState {
    humhum_dir: PathBuf,
    devices: Arc<Mutex<MobileDeviceStore>>,
    runtime: Mutex<MobileRuntime>,
}

impl MobileBridgeState {
    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        Ok(Self {
            humhum_dir: humhum_dir.to_path_buf(),
            devices: Arc::new(Mutex::new(MobileDeviceStore::load_or_create(humhum_dir)?)),
            runtime: Mutex::new(MobileRuntime {
                enabled: false,
                url: None,
                certificate_fingerprint: None,
                pairing: None,
                shutdown: None,
            }),
        })
    }

    pub fn status(&self) -> MobileBridgeStatus {
        let runtime = self
            .runtime
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let devices = self
            .devices
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .summaries();
        MobileBridgeStatus {
            enabled: runtime.enabled,
            url: runtime.url.clone(),
            certificate_fingerprint: runtime.certificate_fingerprint.clone(),
            paired_devices: devices.len(),
            devices,
        }
    }

    pub async fn enable(
        self: &Arc<Self>,
        app: tauri::AppHandle,
    ) -> Result<MobileBridgeStatus, String> {
        if self.status().enabled {
            return Ok(self.status());
        }

        let local_ip = local_lan_ip()?;
        let cert = ensure_certificate(&self.humhum_dir, local_ip)?;
        let tls_config = load_tls_config(&cert.cert_path, &cert.key_path)?;
        let listener = TcpListener::bind(SocketAddr::new(
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            DEFAULT_MOBILE_PORT,
        ))
        .await
        .map_err(|error| format!("Could not open mobile HTTPS port: {error}"))?;
        let url = format!("https://{local_ip}:{DEFAULT_MOBILE_PORT}");
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        {
            let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
            runtime.enabled = true;
            runtime.url = Some(url);
            runtime.certificate_fingerprint = Some(cert.fingerprint);
            runtime.shutdown = Some(shutdown_tx);
        }

        let bridge = Arc::clone(self);
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
        Ok(self.status())
    }

    pub fn disable(&self) -> Result<MobileBridgeStatus, String> {
        let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        if let Some(shutdown) = runtime.shutdown.take() {
            let _ = shutdown.send(());
        }
        runtime.enabled = false;
        runtime.pairing = None;
        runtime.url = None;
        runtime.certificate_fingerprint = None;
        drop(runtime);
        Ok(self.status())
    }

    pub fn create_pairing(&self, scope: MobileDeviceScope) -> Result<MobilePairingInfo, String> {
        let mut runtime = self.runtime.lock().map_err(|error| error.to_string())?;
        if !runtime.enabled {
            return Err("Enable mobile access before pairing a device".into());
        }
        let now = chrono::Utc::now().timestamp();
        let code = uuid::Uuid::new_v4().simple().to_string()[..8].to_ascii_uppercase();
        let challenge = PairingChallenge::new(&code, now, scope);
        let info = MobilePairingInfo {
            code,
            expires_at: challenge.expires_at,
            url: runtime.url.clone().ok_or("Mobile URL is unavailable")?,
            certificate_fingerprint: runtime
                .certificate_fingerprint
                .clone()
                .ok_or("Mobile certificate fingerprint is unavailable")?,
            scope,
        };
        runtime.pairing = Some(challenge);
        Ok(info)
    }

    pub fn revoke_devices(&self) -> Result<MobileBridgeStatus, String> {
        self.devices
            .lock()
            .map_err(|error| error.to_string())?
            .revoke_all()?;
        Ok(self.status())
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<MobileBridgeStatus, String> {
        self.devices
            .lock()
            .map_err(|error| error.to_string())?
            .revoke_device(device_id)?;
        Ok(self.status())
    }
}

struct MobileCertificate {
    cert_path: PathBuf,
    key_path: PathBuf,
    fingerprint: String,
}

fn ensure_certificate(humhum_dir: &Path, local_ip: Ipv4Addr) -> Result<MobileCertificate, String> {
    let cert_path = humhum_dir.join("mobile-cert.pem");
    let key_path = humhum_dir.join("mobile-key.pem");
    let certificate_matches_ip = cert_path.exists()
        && std::process::Command::new("/usr/bin/openssl")
            .args(["x509", "-in"])
            .arg(&cert_path)
            .args(["-noout", "-text"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| {
                String::from_utf8_lossy(&output.stdout).contains(&format!("IP Address:{local_ip}"))
            });
    if !key_path.exists() || !certificate_matches_ip {
        let output = std::process::Command::new("/usr/bin/openssl")
            .args([
                "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "365", "-nodes",
                "-keyout",
            ])
            .arg(&key_path)
            .arg("-out")
            .arg(&cert_path)
            .args([
                "-subj",
                "/CN=HumHum Mobile",
                "-addext",
                &format!("subjectAltName=IP:{local_ip},DNS:humhum.local"),
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

async fn handle_mobile_request(
    request: Request<hyper::body::Incoming>,
    app: tauri::AppHandle,
    bridge: Arc<MobileBridgeState>,
) -> Result<Response<HttpBody>, Infallible> {
    let response = match (request.method(), request.uri().path()) {
        (&Method::GET, "/") => html_response(MOBILE_HTML),
        (&Method::POST, "/api/pair") => pair_device(request, &bridge).await,
        (&Method::GET, "/api/sessions") => {
            let scope = request_scope(&request, &bridge);
            if scope.is_none() {
                json_error(StatusCode::UNAUTHORIZED, "Pair this device first")
            } else {
                let scope = scope.unwrap_or(MobileDeviceScope::Read);
                let mut hook_actions =
                    std::collections::HashMap::<String, Vec<MobileApprovalSummary>>::new();
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
                let mut sessions = codex
                    .sessions()
                    .iter()
                    .map(|session| {
                        MobileSessionSummary::from_codex(session, scope.allows_control())
                    })
                    .collect::<Vec<_>>();
                let known_ids = sessions
                    .iter()
                    .map(|session| session.id.clone())
                    .collect::<std::collections::HashSet<_>>();
                sessions.extend(
                    store
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .get_all_sessions_with_history()
                        .into_iter()
                        .filter(|session| !known_ids.contains(&session.session_id))
                        .take(30)
                        .map(|session| {
                            let mut summary =
                                MobileSessionSummary::from_hook(&session, scope.allows_control());
                            summary.pending_actions =
                                hook_actions.remove(&session.session_id).unwrap_or_default();
                            summary.needs_attention |= !summary.pending_actions.is_empty();
                            summary
                        }),
                );
                sessions.sort_by(|left, right| right.last_activity_at.cmp(&left.last_activity_at));
                sessions.truncate(30);
                json_response(
                    StatusCode::OK,
                    &serde_json::json!({ "scope": scope, "sessions": sessions }),
                )
            }
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
    if bridge
        .devices
        .lock()
        .map_err(|error| error.to_string())
        .and_then(|mut devices| devices.add_device(name, &token, challenge_scope))
        .is_err()
    {
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save this device",
        );
    }
    json_response(
        StatusCode::OK,
        &serde_json::json!({ "token": token, "scope": challenge_scope }),
    )
}

fn request_scope(
    request: &Request<hyper::body::Incoming>,
    bridge: &MobileBridgeState,
) -> Option<MobileDeviceScope> {
    let token = request
        .headers()
        .get(hyper::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    token.and_then(|token| {
        bridge
            .devices
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .authorize(token)
    })
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
        let candidate = digest_token(raw_token);
        self.devices
            .iter()
            .find(|device| constant_time_eq(device.token_digest.as_bytes(), candidate.as_bytes()))
            .map(|device| device.scope)
    }

    fn summaries(&self) -> Vec<MobileDeviceSummary> {
        self.devices
            .iter()
            .map(|device| MobileDeviceSummary {
                id: device.id.clone(),
                name: device.name.clone(),
                paired_at: device.paired_at.clone(),
                scope: device.scope,
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
}

#[derive(Debug, Clone, Serialize)]
struct MobileApprovalSummary {
    id: String,
    provider: String,
    operation: String,
    summary: String,
}

impl MobileSessionSummary {
    fn from_hook(session: &crate::session_store::Session, include_actions: bool) -> Self {
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
        }
    }

    fn from_codex(
        session: &crate::hexa_protocol::HexaSessionProjection,
        include_actions: bool,
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
    fn certificate_is_reused_while_the_lan_address_is_unchanged() {
        let temp = tempfile::tempdir().unwrap();
        let ip = Ipv4Addr::new(192, 168, 1, 25);

        let first = ensure_certificate(temp.path(), ip).unwrap();
        let second = ensure_certificate(temp.path(), ip).unwrap();

        assert_eq!(first.fingerprint, second.fingerprint);
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

        let json =
            serde_json::to_string(&MobileSessionSummary::from_hook(&session, false)).unwrap();
        assert!(json.contains("project"));
        assert!(!json.contains("/Users"));
        assert!(!json.contains("private transcript text"));
        assert!(!MobileSessionSummary::from_hook(&session, false).can_message);

        let mut opencode = session.clone();
        opencode.client_type = "opencode".into();
        assert!(!MobileSessionSummary::from_hook(&opencode, false).can_message);
        assert!(MobileSessionSummary::from_hook(&opencode, true).can_message);
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

        let read = MobileSessionSummary::from_codex(&session, false);
        let control = MobileSessionSummary::from_codex(&session, true);

        assert!(!read.can_message);
        assert!(read.pending_actions.is_empty());
        assert!(control.can_message);
        assert_eq!(control.pending_actions.len(), 1);
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
