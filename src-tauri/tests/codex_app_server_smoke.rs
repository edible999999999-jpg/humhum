use humhum_lib::codex_bridge::transport::{IncomingMessage, JsonRpcTransport};
use serde_json::{json, Value};
use std::time::Duration;

#[tokio::test]
#[ignore = "requires an installed and authenticated Codex CLI"]
async fn observes_a_disposable_codex_thread() {
    let workspace = tempfile::tempdir().unwrap();
    let transport = JsonRpcTransport::spawn_codex().await.unwrap();
    transport
        .request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "humhum_smoke_test",
                    "title": "HUMHUM smoke test",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {"experimentalApi": false}
            }),
        )
        .await
        .unwrap();
    transport.notify("initialized", json!({})).await.unwrap();

    let started = transport
        .request(
            "thread/start",
            json!({
                "cwd": workspace.path(),
                "approvalPolicy": "never",
                "approvalsReviewer": "user",
                "ephemeral": true,
                "serviceName": "humhum_smoke_test"
            }),
        )
        .await
        .unwrap();
    let thread_id = started["thread"]["id"].as_str().unwrap().to_string();
    let turn = transport
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{"type": "text", "text": "Reply with exactly: HUMHUM_READY", "text_elements": []}],
                "approvalPolicy": "never",
                "approvalsReviewer": "user"
            }),
        )
        .await
        .unwrap();
    let turn_id = turn["turn"]["id"].as_str().unwrap().to_string();

    let observed = tokio::time::timeout(Duration::from_secs(90), async {
        let mut text = String::new();
        loop {
            match transport.next_incoming().await {
                Some(IncomingMessage::Notification { method, params }) => {
                    if method == "item/agentMessage/delta" {
                        text.push_str(params["delta"].as_str().unwrap_or_default());
                    }
                    if method == "turn/completed"
                        && params["turn"]["id"] == Value::String(turn_id.clone())
                    {
                        break text;
                    }
                }
                Some(IncomingMessage::Request { id, .. }) => {
                    transport
                        .respond(id, json!({"decision": "decline"}))
                        .await
                        .unwrap();
                }
                None => panic!("app-server stopped before the turn completed"),
            }
        }
    })
    .await
    .expect("Codex turn timed out");

    assert!(
        observed.contains("HUMHUM_READY"),
        "unexpected reply: {observed}"
    );
    transport.shutdown().await.unwrap();
}
