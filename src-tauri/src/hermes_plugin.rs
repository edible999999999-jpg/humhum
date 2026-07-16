use std::path::Path;

const MARKER: &str = "HUMHUM_HERMES_PLUGIN";
const MANIFEST: &str = r#"# HUMHUM_HERMES_PLUGIN
name: humhum
version: 1.0.0
description: Forward local Hermes Agent lifecycle events to HUMHUM
provides_hooks:
  - on_session_start
  - pre_llm_call
  - pre_tool_call
  - post_tool_call
  - post_llm_call
  - on_session_end
  - on_session_finalize
  - on_session_reset
"#;

const PYTHON_SOURCE: &str = r#"# HUMHUM_HERMES_PLUGIN
"""Generated local-only HUMHUM observer for Hermes Agent."""

from __future__ import annotations

import json
import os
import queue
import threading
import urllib.request
from pathlib import Path

_STATE = {}
_DELIVERY_QUEUE = queue.Queue()


def _text(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        return value or None
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return None


def _session_id(*values, **kwargs):
    values = values + tuple(kwargs.get(key) for key in ("session_id", "task_id", "conversation_id"))
    for value in values:
        value = _text(value)
        if value:
            return value if value.startswith("hermes-") else "hermes-" + value
    return None


def _cwd(kwargs):
    for key in ("cwd", "working_directory", "directory"):
        value = _text(kwargs.get(key))
        if value:
            return value
    try:
        return os.getcwd()
    except OSError:
        return None


def _user_message(kwargs):
    for key in ("user_message", "prompt", "input", "query", "text", "content"):
        value = _text(kwargs.get(key))
        if value:
            return value
    return None


def _assistant_message(kwargs):
    for key in ("assistant_response", "response", "message", "content", "text"):
        value = kwargs.get(key)
        if isinstance(value, dict):
            for nested in ("content", "text", "response", "message"):
                nested_value = _text(value.get(nested))
                if nested_value:
                    return nested_value
        else:
            value = _text(value)
            if value:
                return value
    return None


def _connection():
    humhum = Path(os.environ.get("HOME", str(Path.home()))) / ".humhum"
    try:
        config = json.loads((humhum / "config.json").read_text(encoding="utf-8"))
        port = int(config.get("hook_port", 31275))
        token = (humhum / "local-api-token").read_text(encoding="utf-8").strip()
    except Exception:
        return None
    if not token or port < 1 or port > 65535:
        return None
    return "http://127.0.0.1:%d/event" % port, token


def _deliver(payload):
    connection = _connection()
    if not connection:
        return
    url, token = connection
    try:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-HumHum-Token": token,
            },
            method="POST",
        )
        # The hook server is loopback-only. Never forward its bearer token to
        # an HTTP(S) proxy inherited from the user's shell or desktop session.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(request, timeout=1):
            pass
    except Exception:
        pass


def _delivery_worker():
    while True:
        payload = _DELIVERY_QUEUE.get()
        try:
            _deliver(payload)
        finally:
            _DELIVERY_QUEUE.task_done()


threading.Thread(target=_delivery_worker, daemon=True).start()


def _emit(session_id, event_name, cwd=None, **payload):
    envelope = {
        "hook_event_name": event_name,
        "session_id": session_id,
        "client_type": "hermes",
        "cwd": cwd,
        **payload,
    }
    _DELIVERY_QUEUE.put(envelope)


def _start(session_id, kwargs, force=False):
    state = _STATE.setdefault(session_id, {})
    if state.get("started") and not force:
        return
    _emit(
        session_id,
        "SessionStart",
        cwd=_cwd(kwargs),
        platform=_text(kwargs.get("platform")),
        model=_text(kwargs.get("model")),
    )
    state["started"] = True


def _on_session_start(session_id=None, platform=None, model=None, **kwargs):
    resolved = _session_id(session_id, **kwargs)
    if resolved:
        _start(resolved, {**kwargs, "platform": platform, "model": model})
    return None


def _on_pre_llm_call(session_id=None, user_message=None, **kwargs):
    resolved = _session_id(session_id, kwargs.get("task_id"), **kwargs)
    if not resolved:
        return None
    combined = {**kwargs, "user_message": user_message}
    _start(resolved, combined)
    prompt = _user_message(combined)
    _emit(resolved, "UserPromptSubmit", cwd=_cwd(combined), prompt=prompt)
    return None


def _on_pre_tool_call(tool_name=None, args=None, task_id=None, **kwargs):
    resolved = _session_id(task_id, kwargs.get("session_id"), **kwargs)
    if resolved:
        _emit(
            resolved,
            "PreToolUse",
            cwd=_cwd(kwargs),
            tool_name=_text(tool_name) or "Tool",
            tool_input=args if isinstance(args, dict) else None,
        )
    return None


def _on_post_tool_call(tool_name=None, args=None, result=None, task_id=None, **kwargs):
    resolved = _session_id(task_id, kwargs.get("session_id"), **kwargs)
    if not resolved:
        return None
    parsed = result
    if isinstance(result, str):
        try:
            parsed = json.loads(result)
        except Exception:
            parsed = None
    error = _text(parsed.get("error")) if isinstance(parsed, dict) else _text(kwargs.get("error"))
    _emit(
        resolved,
        "PostToolUseFailure" if error else "PostToolUse",
        cwd=_cwd(kwargs),
        tool_name=_text(tool_name) or "Tool",
        tool_input=args if isinstance(args, dict) else None,
        tool_result=parsed if isinstance(parsed, dict) else None,
        error=error,
    )
    return None


def _on_post_llm_call(session_id=None, assistant_response=None, **kwargs):
    resolved = _session_id(session_id, kwargs.get("task_id"), **kwargs)
    if not resolved:
        return None
    combined = {**kwargs, "assistant_response": assistant_response}
    message = _assistant_message(combined)
    if message:
        _STATE.setdefault(resolved, {})["assistant"] = message
        _emit(
            resolved,
            "Notification",
            cwd=_cwd(combined),
            notification_type="assistant_message",
            message=message,
        )
    return None


def _on_session_end(session_id=None, completed=None, interrupted=None, **kwargs):
    resolved = _session_id(session_id, kwargs.get("task_id"), **kwargs)
    if resolved:
        _emit(
            resolved,
            "Stop",
            cwd=_cwd(kwargs),
            completed=bool(completed),
            interrupted=bool(interrupted),
            last_assistant_message=_STATE.get(resolved, {}).get("assistant"),
        )
    return None


def _on_session_finalize(session_id=None, **kwargs):
    resolved = _session_id(session_id, kwargs.get("task_id"), **kwargs)
    if resolved:
        _emit(
            resolved,
            "SessionEnd",
            cwd=_cwd(kwargs),
            completed=True,
            last_assistant_message=_STATE.get(resolved, {}).get("assistant"),
        )
        _STATE.pop(resolved, None)
    return None


def _on_session_reset(session_id=None, **kwargs):
    resolved = _session_id(session_id, kwargs.get("task_id"), **kwargs)
    if resolved:
        _STATE.pop(resolved, None)
        _start(resolved, kwargs, force=True)
    return None


def register(ctx):
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("on_session_finalize", _on_session_finalize)
    ctx.register_hook("on_session_reset", _on_session_reset)
"#;

pub fn install_at(plugin_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(plugin_dir)
        .map_err(|error| format!("Could not create Hermes plugin directory: {error}"))?;
    write_atomic(&plugin_dir.join("plugin.yaml"), MANIFEST)?;
    write_atomic(&plugin_dir.join("__init__.py"), PYTHON_SOURCE)?;
    Ok(())
}

pub fn uninstall_at(plugin_dir: &Path) -> Result<(), String> {
    let managed_paths = [
        plugin_dir.join("plugin.yaml"),
        plugin_dir.join("__init__.py"),
    ];
    for path in &managed_paths {
        if path.exists() {
            let source = std::fs::read_to_string(path)
                .map_err(|error| format!("Could not inspect Hermes plugin: {error}"))?;
            if !source.contains(MARKER) {
                return Err("Refusing to remove an unmanaged Hermes plugin".into());
            }
        }
    }
    for path in managed_paths {
        if path.exists() {
            std::fs::remove_file(path)
                .map_err(|error| format!("Could not remove Hermes plugin file: {error}"))?;
        }
    }
    if plugin_dir.exists()
        && std::fs::read_dir(plugin_dir)
            .map_err(|error| format!("Could not inspect Hermes plugin directory: {error}"))?
            .next()
            .is_none()
    {
        std::fs::remove_dir(plugin_dir)
            .map_err(|error| format!("Could not remove Hermes plugin directory: {error}"))?;
    }
    Ok(())
}

pub fn is_installed_at(plugin_dir: &Path) -> bool {
    [
        plugin_dir.join("plugin.yaml"),
        plugin_dir.join("__init__.py"),
    ]
    .iter()
    .all(|path| std::fs::read_to_string(path).is_ok_and(|source| source.contains(MARKER)))
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    crate::knowledge_store::write_file_atomically(path, content.as_bytes())
        .map_err(|error| format!("Could not install Hermes plugin: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn python_command() -> &'static str {
        if cfg!(target_os = "windows") {
            "python"
        } else {
            "python3"
        }
    }

    #[test]
    fn installs_complete_owned_plugin_and_uninstalls_it() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("plugins/humhum");

        install_at(&plugin_dir).unwrap();

        let manifest = std::fs::read_to_string(plugin_dir.join("plugin.yaml")).unwrap();
        let source = std::fs::read_to_string(plugin_dir.join("__init__.py")).unwrap();
        assert!(manifest.contains("HUMHUM_HERMES_PLUGIN"));
        assert!(source.contains("HUMHUM_HERMES_PLUGIN"));
        for event in [
            "on_session_start",
            "pre_llm_call",
            "pre_tool_call",
            "post_tool_call",
            "post_llm_call",
            "on_session_end",
            "on_session_finalize",
            "on_session_reset",
        ] {
            assert!(manifest.contains(event), "manifest missing {event}");
            assert!(
                source.contains(&format!("register_hook(\"{event}\"")),
                "source missing {event}"
            );
        }
        assert!(source.contains(".humhum") && source.contains("config.json"));
        assert!(source.contains("local-api-token"));
        assert!(source.contains("http://127.0.0.1:"));
        assert!(source.contains("UserPromptSubmit"));
        assert!(source.contains("PostToolUseFailure"));
        assert!(is_installed_at(&plugin_dir));

        uninstall_at(&plugin_dir).unwrap();
        assert!(!plugin_dir.exists());
    }

    #[test]
    fn incomplete_plugin_is_not_reported_as_installed() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("humhum");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("plugin.yaml"), "# HUMHUM_HERMES_PLUGIN\n").unwrap();

        assert!(!is_installed_at(&plugin_dir));
    }

    #[test]
    fn refuses_to_remove_an_unmanaged_plugin() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("humhum");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("plugin.yaml"), "name: personal_plugin\n").unwrap();
        std::fs::write(plugin_dir.join("__init__.py"), "print('mine')\n").unwrap();

        let error = uninstall_at(&plugin_dir).unwrap_err();

        assert!(error.contains("unmanaged Hermes plugin"));
        assert!(plugin_dir.join("plugin.yaml").exists());
        assert!(plugin_dir.join("__init__.py").exists());
    }

    #[test]
    fn generated_plugin_is_valid_python() {
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("humhum");
        install_at(&plugin_dir).unwrap();

        let output = std::process::Command::new(python_command())
            .args(["-m", "py_compile"])
            .arg(plugin_dir.join("__init__.py"))
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn generated_plugin_delivers_normalized_events() {
        assert!(
            PYTHON_SOURCE.contains("queue.Queue"),
            "delivery must preserve callback order"
        );
        let temp = tempfile::tempdir().unwrap();
        let plugin_dir = temp.path().join("humhum");
        install_at(&plugin_dir).unwrap();
        let runner = temp.path().join("smoke.py");
        let plugin_path = serde_json::to_string(&plugin_dir.join("__init__.py")).unwrap();
        let workspace = serde_json::to_string(&temp.path().join("workspace")).unwrap();
        let script = format!(
            r#"
import importlib.util
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

events = []
headers = []

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        events.append(json.loads(self.rfile.read(size)))
        headers.append(self.headers.get("X-HumHum-Token"))
        self.send_response(204)
        self.end_headers()
    def log_message(self, *_args):
        pass

server = HTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
humhum = Path(os.environ["HOME"]) / ".humhum"
humhum.mkdir(parents=True)
(humhum / "config.json").write_text(json.dumps({{"hook_port": server.server_port}}))
(humhum / "local-api-token").write_text("smoke-token\n")

spec = importlib.util.spec_from_file_location("humhum_hermes", {plugin_path})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Context:
    def __init__(self):
        self.hooks = {{}}
    def register_hook(self, name, callback):
        self.hooks[name] = callback

context = Context()
module.register(context)
returns = [
    context.hooks["on_session_start"](session_id="session-1", cwd={workspace}),
    context.hooks["pre_llm_call"](session_id="session-1", user_message="build it", cwd={workspace}),
    context.hooks["pre_tool_call"](task_id="session-1", tool_name="terminal", args={{"cmd": "false"}}, cwd={workspace}),
    context.hooks["post_tool_call"](task_id="session-1", tool_name="terminal", args={{"cmd": "false"}}, result={{"error": "exit 1"}}, cwd={workspace}),
    context.hooks["post_llm_call"](session_id="session-1", assistant_response="checked", cwd={workspace}),
    context.hooks["on_session_end"](session_id="session-1", completed=True, cwd={workspace}),
    context.hooks["on_session_finalize"](session_id="session-1", cwd={workspace}),
]
deadline = time.time() + 5
while len(events) < 7 and time.time() < deadline:
    time.sleep(0.02)
server.shutdown()
print(json.dumps({{"events": events, "headers": headers, "returns": returns}}))
"#
        );
        std::fs::write(&runner, script).unwrap();

        let output = std::process::Command::new(python_command())
            .arg(&runner)
            .env("HOME", temp.path())
            .env("HTTP_PROXY", "http://127.0.0.1:9")
            .env("HTTPS_PROXY", "http://127.0.0.1:9")
            .env("ALL_PROXY", "http://127.0.0.1:9")
            .env_remove("NO_PROXY")
            .env_remove("no_proxy")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let events = result["events"].as_array().unwrap();
        let names: Vec<&str> = events
            .iter()
            .map(|event| event["hook_event_name"].as_str().unwrap())
            .collect();

        assert_eq!(
            names,
            [
                "SessionStart",
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUseFailure",
                "Notification",
                "Stop",
                "SessionEnd",
            ]
        );
        assert!(events.iter().all(|event| {
            event["client_type"] == "hermes"
                && event["session_id"] == "hermes-session-1"
                && event["cwd"] == temp.path().join("workspace").to_string_lossy().as_ref()
        }));
        assert_eq!(events[1]["prompt"], "build it");
        assert_eq!(events[2]["tool_name"], "terminal");
        assert_eq!(events[3]["error"], "exit 1");
        assert!(result["headers"]
            .as_array()
            .unwrap()
            .iter()
            .all(|header| header == "smoke-token"));
        assert!(result["returns"]
            .as_array()
            .unwrap()
            .iter()
            .all(serde_json::Value::is_null));
    }
}
