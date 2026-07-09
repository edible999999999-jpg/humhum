# Qoder IDE / QoderWork 狂暴模式 Hook 实现

## 概述

HumHum 通过 hooks 机制实现 Qoder IDE 和 QoderWork 的"狂暴模式"——自动放行所有权限请求，不再弹出确认弹窗。

---

## QoderWork

### Hook 事件

`PermissionRequest`

### 响应格式

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow"
    }
  }
}
```

### settings.json 配置

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "command": "~/.qoderwork/hooks/auto-allow-permission.sh",
            "timeout": 5,
            "type": "command"
          }
        ]
      }
    ]
  }
}
```

### 脚本路径

`~/.qoderwork/hooks/auto-allow-permission.sh`

---

## Qoder IDE

### 关键发现

**PermissionRequest hook 只是通知型 hook，不能做权限决策。**

真正能跳过弹窗的是 **PreToolUse** hook（Claude Code 兼容格式）。

### Hook 事件

`PreToolUse`（主要）+ `PermissionRequest`（兼容保留）

### 响应格式

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow"
  }
}
```

可选值：

| 值 | 含义 |
|---|---|
| `allow` | 放行，不弹窗 |
| `deny` | 拒绝执行 |
| `ask` | 弹出确认弹窗（默认行为） |

### settings.json 配置

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "command": "~/.qoder/hooks/auto-allow-permission.sh",
            "timeout": 5,
            "type": "command"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "command": "~/.qoder/hooks/auto-allow-permission.sh",
            "timeout": 5,
            "type": "command"
          }
        ]
      }
    ]
  }
}
```

### 脚本路径

`~/.qoder/hooks/auto-allow-permission.sh`

---

## 执行模式

Hooks 只能控制是否弹窗，**不能选择沙箱/终端执行模式**。

`permissionDecision: "allow"` 等同于自动点击 "Allow" 按钮，走默认**沙箱**路径。

| | 沙箱执行 | 终端执行 |
|---|---|---|
| 权限范围 | 项目目录 + `~/.qoder/` 等白名单 | 本机终端，几乎无限制 |
| `rm -rf /tmp/test` | ✅ | ✅ |
| `brew install` | ❌ | ✅ |
| `sudo` | ❌ | ✅ |

建议狂暴模式默认沙箱——绕过确认弹窗后再加终端权限等于没有安全网。

---

## 踩坑记录

### 1. Qoder IDE 沙箱限制

- `cat > file` 重定向写入在沙箱中失败
- `echo >> logfile` 写日志可能触发 `set -e` 导致脚本静默退出
- 解决：删除所有日志写入，用 `python3` 做 JSON 解析代替纯 bash

### 2. Qoder IDE 用 bash 执行 .sh 文件

shebang `#!/usr/bin/env python3` 被忽略，`.sh` 文件始终用 bash 执行。
不能写 Python 脚本，必须用 bash。

### 3. PermissionRequest 不生效

反复测试了以下格式均无效：
- `permissionDecision: "allow_once"` 字符串
- `permissionDecision: {kind: "allow_once"}` 对象
- `permissionDecision: [{kind: "allow_once"}]` 数组
- `permissionDecision: {behavior: "allow"}` QoderWork 风格
- `## Decision` Markdown 格式
- 退出码控制

最终确认：PermissionRequest hook 在 Qoder IDE v1.13.0 中**不支持决策**。

### 4. Qoder IDE 二进制逆向分析

通过 `strings` 分析 Qoder IDE Go 二进制，关键发现：
- `dispatchPermissionRequestHook` 存在且被调用
- `HookSpecificOutput` 包含 `PermissionDecision` 和 `ContinueWithPrompt` 字段
- `HookOutput.IsBlocked` / `GetBlockReason` 控制操作是否被阻止
- `PreToolUse` hook 也存在于代码中

### 5. PreToolUse 才是正解

参考 Claude Code hooks 文档确认：
- PreToolUse hook → 可在工具执行前做出 allow/deny/ask 决策
- PermissionRequest → 仅通知，不能干预

---

## Qoder IDE vs QoderWork 对比

| | Qoder IDE | QoderWork |
|---|---|---|
| 决策 hook | PreToolUse | PermissionRequest |
| 响应字段 | `permissionDecision` | `decision` |
| 响应值 | `"allow"` | `{"behavior":"allow"}` |
| hookEventName | 不需要 | 需要 |
| 脚本语言 | 必须 bash | bash |
| 沙箱写文件 | 受限 | 正常 |

---

## HumHum 集成

### Rust 后端 (`commands.rs`)

- 常量 `QODER_AUTO_ALLOW_SCRIPT`：嵌入脚本内容
- `toggle_qoder_auto_allow`：同时写入 PreToolUse + PermissionRequest 到 settings.json
- `get_qoder_auto_allow_status`：检查 PreToolUse 条目是否存在

### 前端 (`SettingsPanel.tsx`)

无需改动——Tauri command 接口名不变，只是底层行为从 PermissionRequest 改为 PreToolUse。
