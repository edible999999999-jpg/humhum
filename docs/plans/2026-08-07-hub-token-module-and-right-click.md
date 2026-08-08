# 右键直开 Hub + Hub Token 模块日周月+cost

## 背景
1. 右键桌宠现在是「右键弹菜单 → 再点 Hub 按钮」两步。用户要一步：右键直接开 Hub。
2. Hub 里的 Token 模块（HumiModule）当前只展示 `total_tokens / active_agents / total_sessions / total_tool_calls`，来自 `get_stats`（humhum 自己的 stats_store 聚合）。用户要展示日/周/月汇总 token 量 + 具体 cost，数据源用 tokscale 全量（与 `npx tokscale` 一致）。

## 改动一：右键直接打开 Hub（PetView.tsx）

- `handleContextMenu`（601-609）：改为不再 `setContextMenu(...)`，直接 `invoke("toggle_hub")`（保留 `preventDefault`/`stopPropagation`、`setShowDashboard(false)`）。
- 删除中间态单按钮菜单相关死代码：
  - JSX 724-735 的 `{contextMenu && (...)}` 块
  - state `contextMenu`（72 行）及其 setter 的所有引用（197、605、612、619）
  - 常量 `CONTEXT_MENU_WIDTH` / `CONTEXT_MENU_HEIGHT`（55-56）
  - `handlePetLeave`（618-620）里 `setContextMenu(null)` —— 若该函数只剩这一行则整体移除，并从 `onMouseLeave` 解绑
- `handleOpenHub`（611-616）保留：SessionDashboard 的 `onOpenHub` 仍在用（652）。去掉其中的 `setContextMenu(null)`。
- 更新 pet body 注释（715）「right-click → command menu」→「right-click → Hub」。

## 改动二：新增 Rust 命令，产出 tokscale 全量日周月+cost

新增 `#[tauri::command] get_token_report`（commands.rs），包装 tokscale-core 的 `generate_local_graph_report`（与 `npx tokscale graph` 同一入口，含 LiteLLM 离线定价 fallback）。

```rust
use tokscale_core::{generate_local_graph_report, ReportOptions, GroupBy};

#[tauri::command]
pub async fn get_token_report() -> Result<Value, String> {
    let opts = ReportOptions {
        home_dir: None,            // use_env_roots=true → 扫描全部默认根，全量
        use_env_roots: true,
        clients: None,
        since: None, until: None, year: None,
        group_by: GroupBy::default(),
        scanner_settings: Default::default(),
    };
    let graph = generate_local_graph_report(opts).await?;
    // 只回传前端需要的精简结构：逐日 contributions（date + tokens + cost）
    // + summary（total_tokens/total_cost）。日周月聚合在前端做（复用看板 bucketize 逻辑）。
    serde_json::to_value(TokenReport { ... }).map_err(...)
}
```

回传结构（精简，避免把整个 GraphResult 丢给前端）：
```rust
struct TokenReportDay { date: String, tokens: i64, cost: f64 }
struct TokenReport { total_tokens: i64, total_cost: f64, days: Vec<TokenReportDay> }
```
`days` 来自 `graph.contributions`，每天 `totals.tokens` / `totals.cost`；`total_*` 来自 `graph.summary`。

在 `lib.rs` 的 `generate_handler!`（402+）注册 `commands::get_token_report`。

注意：该命令做全盘 transcript 扫描，可能耗时数百 ms 到数秒。前端异步调用、加载态处理即可（已是 async command，不阻塞）。

## 改动三：HumiModule Token 模块 UI（HumiModule.tsx）

- 新增 interface `TokenReport { total_tokens; total_cost; days: {date;tokens;cost}[] }`。
- 新增 state `tokenReport` + `fetchTokenReport()`（`invoke<TokenReport>("get_token_report")`），在现有 stats 刷新处一并触发。
- 新增日/周/月 tab 切换 state（`'day'|'week'|'month'`，默认 day）。
- 前端聚合：把 `days` 按当前 mode bucket 化（day 原样；week 按 ISO 周起始；month 按 `YYYY-MM`），取「最近一个 bucket」展示在卡片（token + cost），与看板 renderCards 语义一致；范围总量（total_tokens/total_cost）放 meta 行。
- 复用现有 `formatHumiCount`；cost 用 `$` + 两位小数格式化（新增小 helper）。
- 用 stats_store 的 `active_agents/total_sessions/total_tool_calls` 作为辅助信息保留在 meta 行（这些 tokscale 不产出）。

布局沿用现有 `.humi-token-summary` section 结构，增加一行 tab 按钮 + cost 显示。样式若缺则在对应 CSS 补最小类。

## 验证
- `cd src-tauri && cargo build`（确认新命令与 tokscale API 签名匹配）
- `cd src-tauri && cargo test --lib`（不应回归；新命令可加一个 smoke 测试，或依赖手测）
- `npx tsc --noEmit`（前端类型）
- 手测：右键桌宠直接开/关 Hub；Hub Token 模块显示日周月切换 + cost，数量级与 `npx tokscale graph` 一致（此前核对为总量 ~3.5B / $3338）。

## 不做
- 不动 stats_store 的 dedup/prune 修复（已完成、已测）。
- 不把整份看板搬进 Hub；Hub 只做精简卡片式日周月+cost。看板 HTML 保留在 design-qa-assets 作参考。
