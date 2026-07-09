# Pi Sidecar 接入方案

## 推荐形态

Pi 作为 HUMHUM 的 sidecar 子进程接入，优先使用官方 `pi --mode rpc`。该模式通过 stdin/stdout JSONL 收发命令和事件，适合被桌面应用嵌入；HUMHUM 不 vendor Pi，也不把 Pi 替换成主 Agent。

最小边界：

- HUMHUM 启动 `pi --mode rpc --session-dir ~/.humhum/pi-sessions --no-approve`
- HUMHUM 向 stdin 写入 `prompt`、`abort` 等 RPC 命令
- HUMHUM 读取 stdout JSONL，将 Pi 事件映射成现有 `HookEvent`
- Hexa/Humi/语音管线继续消费 `client_type: "pi"` 的 HUMHUM 事件

## 当前接口

Rust command skeleton：

- `check_pi_installed`
- `start_pi_session`
- `send_pi_prompt`
- `get_pi_session_status`
- `abort_pi_session`
- `stop_pi_session`

`start_pi_session` 支持 `cwd`、`name`、`provider`、`model`，但不会自动启动。用户必须通过 HUMHUM UI 或后续明确入口触发。

## 事件映射

Pi RPC event 会被归一化为 HUMHUM `HookEvent`：

| Pi event | HUMHUM hook_event_name |
| --- | --- |
| `agent_start` | `SessionStart` |
| `agent_end` / `turn_end` | `TaskCompleted` |
| `tool_execution_start` | `PreToolUse` |
| `tool_execution_end` | `PostToolUse` |
| `extension_ui_request` | `PermissionRequest` |
| 其他事件 / stderr | `Notification` |

payload 会保留原始 Pi 字段，并补充：

- `source: "pi_sidecar"`
- `pi_event_type`
- `tool_name`，来自 Pi 的 `toolName`

这样 `SessionStore` 和 Hexa 的 stalled/looping/permission 逻辑可以在不理解 Pi 内部格式的情况下先工作。

## 权限与安全

Pi 官方文档明确说明 Pi 没有内置沙箱，工具、扩展和 shell 命令使用启动它的本地用户权限。因此 HUMHUM 不能把 Pi 当作已隔离执行环境。

当前最小实现采取保守策略：

- 不引入 Pi npm 包依赖
- 不修改 Tauri shell allowlist 来开放 `pi`
- 不自动安装或自动启动 Pi
- 用 `--no-approve` 避免 headless RPC 默认信任项目本地 `.pi` 扩展/设置
- 所有 Pi 输出先进入 HUMHUM event bus，由 Hexa/Humi/可视化消费

后续如果要让 Pi 执行高风险文件修改或 shell 命令，应优先补一层 HUMHUM 权限门：把 Pi 的工具执行请求转成 HUMHUM `PermissionRequest`，由现有 ConfirmToast/语音/快捷键链路裁决；更强边界应走容器、VM 或受控沙箱。

## 后续切片

1. 在 Hub/Humi 增加一个隐藏或实验入口，调用 `check_pi_installed` 和 `start_pi_session`。
2. 为 `extension_ui_request` 增加真正的 `extension_ui_response` 回写，目前只投影成待确认事件。
3. 若需要实时文本展示，可把 `message_update` 的 text delta 聚合成会话 transcript。
4. 增加 Pi 进程退出 watcher，把异常退出从缓存状态清理并标记 `SessionEnd`。
