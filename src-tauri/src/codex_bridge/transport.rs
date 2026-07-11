use serde_json::{json, Value};
use std::collections::HashMap;
use std::fmt;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

type PendingSender = oneshot::Sender<Result<Value, JsonRpcTransportError>>;

#[derive(Debug)]
pub enum JsonRpcTransportError {
    Io(String),
    InvalidMessage(String),
    Rpc { code: i64, message: String },
    ProcessExited,
    Timeout { method: String },
}

impl fmt::Display for JsonRpcTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => write!(formatter, "Codex connection failed: {message}"),
            Self::InvalidMessage(message) => {
                write!(formatter, "Codex sent an invalid message: {message}")
            }
            Self::Rpc { code, message } => write!(formatter, "Codex error {code}: {message}"),
            Self::ProcessExited => write!(formatter, "Codex app-server stopped"),
            Self::Timeout { method } => write!(formatter, "Codex did not answer {method}"),
        }
    }
}

impl std::error::Error for JsonRpcTransportError {}

#[derive(Debug, Clone)]
pub enum IncomingMessage {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

struct TransportInner {
    writer: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, PendingSender>>,
    next_id: AtomicU64,
}

pub struct JsonRpcTransport {
    inner: Arc<TransportInner>,
    incoming: Mutex<mpsc::Receiver<IncomingMessage>>,
}

impl JsonRpcTransport {
    pub async fn spawn_codex() -> Result<Self, JsonRpcTransportError> {
        Self::spawn_command("codex", &["app-server", "--listen", "stdio://"]).await
    }

    pub async fn spawn_command(
        program: &str,
        arguments: &[&str],
    ) -> Result<Self, JsonRpcTransportError> {
        let mut child = Command::new(program)
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| JsonRpcTransportError::Io(error.to_string()))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| JsonRpcTransportError::Io("stdin is unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| JsonRpcTransportError::Io("stdout is unavailable".into()))?;
        let pending = Mutex::new(HashMap::new());
        let inner = Arc::new(TransportInner {
            writer: Mutex::new(stdin),
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
        });
        let (incoming_tx, incoming_rx) = mpsc::channel(128);

        let reader_inner = inner.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Err(error) = route_line(&reader_inner, &incoming_tx, &line).await {
                            log::warn!("[CodexBridge] ignored app-server message: {error}");
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        log::warn!("[CodexBridge] app-server read failed: {error}");
                        break;
                    }
                }
            }

            reject_all_pending(&reader_inner).await;
        });

        Ok(Self {
            inner,
            incoming: Mutex::new(incoming_rx),
        })
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, JsonRpcTransportError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.inner.pending.lock().await.insert(id, sender);

        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(error) = write_message(&self.inner, &message).await {
            self.inner.pending.lock().await.remove(&id);
            return Err(error);
        }

        match tokio::time::timeout(std::time::Duration::from_secs(30), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(JsonRpcTransportError::ProcessExited),
            Err(_) => {
                self.inner.pending.lock().await.remove(&id);
                Err(JsonRpcTransportError::Timeout {
                    method: method.to_string(),
                })
            }
        }
    }

    pub async fn respond(&self, id: Value, result: Value) -> Result<(), JsonRpcTransportError> {
        write_message(
            &self.inner,
            &json!({"jsonrpc": "2.0", "id": id, "result": result}),
        )
        .await
    }

    pub async fn next_incoming(&self) -> Option<IncomingMessage> {
        self.incoming.lock().await.recv().await
    }

    pub async fn shutdown(&self) -> Result<(), JsonRpcTransportError> {
        self.inner
            .child
            .lock()
            .await
            .kill()
            .await
            .map_err(|error| JsonRpcTransportError::Io(error.to_string()))
    }
}

async fn write_message(
    inner: &Arc<TransportInner>,
    message: &Value,
) -> Result<(), JsonRpcTransportError> {
    let mut bytes = serde_json::to_vec(message)
        .map_err(|error| JsonRpcTransportError::InvalidMessage(error.to_string()))?;
    bytes.push(b'\n');
    let mut writer = inner.writer.lock().await;
    writer
        .write_all(&bytes)
        .await
        .map_err(|error| JsonRpcTransportError::Io(error.to_string()))?;
    writer
        .flush()
        .await
        .map_err(|error| JsonRpcTransportError::Io(error.to_string()))
}

async fn route_line(
    inner: &Arc<TransportInner>,
    incoming: &mpsc::Sender<IncomingMessage>,
    line: &str,
) -> Result<(), JsonRpcTransportError> {
    let message: Value = serde_json::from_str(line)
        .map_err(|error| JsonRpcTransportError::InvalidMessage(error.to_string()))?;

    if let Some(method) = message.get("method").and_then(Value::as_str) {
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let incoming_message = match message.get("id") {
            Some(id) => IncomingMessage::Request {
                id: id.clone(),
                method: method.to_string(),
                params,
            },
            None => IncomingMessage::Notification {
                method: method.to_string(),
                params,
            },
        };
        incoming
            .send(incoming_message)
            .await
            .map_err(|_| JsonRpcTransportError::ProcessExited)?;
        return Ok(());
    }

    let id = message.get("id").and_then(Value::as_u64).ok_or_else(|| {
        JsonRpcTransportError::InvalidMessage("response has no numeric id".into())
    })?;
    let Some(sender) = inner.pending.lock().await.remove(&id) else {
        return Ok(());
    };

    let result = if let Some(error) = message.get("error") {
        Err(JsonRpcTransportError::Rpc {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(-1),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Unknown Codex error")
                .to_string(),
        })
    } else {
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    };
    let _ = sender.send(result);
    Ok(())
}

async fn reject_all_pending(inner: &Arc<TransportInner>) {
    let pending = std::mem::take(&mut *inner.pending.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(JsonRpcTransportError::ProcessExited));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn fake_transport(script: &str) -> JsonRpcTransport {
        JsonRpcTransport::spawn_command("/bin/sh", &["-c", script])
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn correlates_out_of_order_responses() {
        let transport = fake_transport(
            r#"
            read first
            read second
            printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"method":"two"}}'
            printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"method":"one"}}'
            sleep 1
            "#,
        )
        .await;

        let first = transport.request("one", json!({}));
        let second = transport.request("two", json!({}));
        let (a, b) = tokio::join!(first, second);
        assert_eq!(a.unwrap()["method"], "one");
        assert_eq!(b.unwrap()["method"], "two");
    }

    #[tokio::test]
    async fn forwards_server_requests_for_approval() {
        let transport = fake_transport(
            r#"
            printf '%s\n' '{"jsonrpc":"2.0","id":61,"method":"item/commandExecution/requestApproval","params":{"itemId":"item-1"}}'
            sleep 1
            "#,
        )
        .await;

        let incoming = transport.next_incoming().await.unwrap();
        assert!(matches!(
            incoming,
            IncomingMessage::Request { method, .. }
                if method == "item/commandExecution/requestApproval"
        ));
    }

    #[tokio::test]
    async fn rejects_pending_requests_when_process_exits() {
        let transport = fake_transport("read request; exit 0").await;
        let error = transport.request("never", json!({})).await.unwrap_err();
        assert!(matches!(error, JsonRpcTransportError::ProcessExited));
    }
}
