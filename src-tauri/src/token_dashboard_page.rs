// Builds a self-contained HTML token-usage dashboard fed by live stats and
// opens it in the system browser. The render script is reused verbatim from
// the design-qa asset so the page stays in sync with the reviewed design.

use std::path::PathBuf;

// The vetted editorial render script (reads `window.TOKEN_DATA`).
const DASHBOARD_JS: &str = include_str!("../../design-qa-assets/token-dashboard.js");

// Inline stylesheet (system-font fallbacks; a temp file can't reach bundled fonts).
const DASHBOARD_CSS: &str = include_str!("../../design-qa-assets/token-dashboard.inline.css");

/// The shared design-qa script carries "static snapshot / rerun the script"
/// wording. Our data is generated live at open time, so rewrite those strings
/// without touching the design-qa asset (its own snapshot flow still uses them).
fn live_dashboard_js() -> String {
    DASHBOARD_JS
        .replace("（本地，非实时）", "（打开时刻）")
        .replace(
            "。数值为静态快照，重跑 <b>scripts/gen-token-dashboard.sh</b> 刷新。",
            "。数据取自本地会话记录，重新打开即刷新。",
        )
}

/// Assemble a standalone HTML page with the live data JSON inlined.
pub fn build_page(data_json: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Token 用量 · HUMHUM</title>
<style>{css}</style>
</head>
<body>
<div class="stage">
  <p class="kicker">数据源本地会话 · 快照 <span class="snap" id="snap">—</span></p>
  <h1 class="title">Token 用量</h1>
  <p class="note" id="rangeNote">加载中…</p>
  <section class="focus" id="focus"></section>
  <nav class="tabs" id="tabs"></nav>
  <section class="section"><div class="numgroup" id="numgroup"></div></section>
  <section class="section">
    <div class="section-head">
      <h2 class="section-title" id="chartTitle">趋势</h2>
      <span class="section-meta" id="chartMeta"></span>
    </div>
    <div class="chart" id="chart"></div>
    <div class="legend">
      <span><i style="background:var(--s-input)"></i>输入</span>
      <span><i style="background:var(--s-cread)"></i>缓存读</span>
      <span><i style="background:var(--s-cwrite)"></i>缓存写</span>
      <span><i style="background:var(--s-out)"></i>输出</span>
      <span><i style="background:var(--s-reason)"></i>推理</span>
    </div>
  </section>
  <section class="section">
    <div class="section-head"><h2 class="section-title">周期明细</h2></div>
    <table id="periodTable"></table>
  </section>
  <div class="grid2">
    <section class="section">
      <div class="section-head"><h2 class="section-title">按模型</h2><span class="section-meta">全量</span></div>
      <table id="modelTable"></table>
    </section>
    <section class="section">
      <div class="section-head"><h2 class="section-title">按客户端</h2><span class="section-meta">全量</span></div>
      <table id="clientTable"></table>
    </section>
  </div>
</div>
<div class="tip" id="tip"></div>
<script>window.TOKEN_DATA={data_json};</script>
<script>{js}</script>
</body>
</html>"#,
        css = DASHBOARD_CSS,
        data_json = data_json,
        js = live_dashboard_js(),
    )
}

/// Write the page to a temp file and open it in the default browser.
pub fn open_in_browser(data_json: &str) -> Result<(), String> {
    let html = build_page(data_json);
    let mut path: PathBuf = std::env::temp_dir();
    path.push("humhum-token-dashboard.html");
    std::fs::write(&path, html.as_bytes())
        .map_err(|e| format!("Failed to write dashboard page: {e}"))?;
    open::that(&path).map_err(|e| format!("Failed to open browser: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_inlines_data_and_script() {
        let page = build_page(r#"{"today":"2026-08-07","days":[],"hours":[]}"#);
        assert!(page.contains("window.TOKEN_DATA={\"today\":\"2026-08-07\""));
        assert!(page.contains("const D = window.TOKEN_DATA"));
        assert!(!page.contains("token-dashboard-data.js"));
    }

    #[test]
    fn page_uses_local_source_label_not_static_snapshot() {
        let page = build_page("{}");
        assert!(page.contains("数据源本地会话"));
        assert!(!page.contains("非实时"));
        assert!(!page.contains("gen-token-dashboard.sh"));
    }

    // Manual visual check: render the real dashboard to /tmp and open it.
    //   cargo test --lib render_real_dashboard_to_tmp -- --ignored --nocapture
    #[test]
    #[ignore]
    fn render_real_dashboard_to_tmp() {
        use crate::stats_store::StatsStore;
        let path = dirs::home_dir().unwrap().join(".humhum/stats.json");
        let store = StatsStore::new_with_backfill(path, false);
        let dash = store.get_token_dashboard();
        let json = serde_json::to_string(&dash).unwrap();
        let html = build_page(&json);
        let out = std::env::temp_dir().join("humhum-dashboard-verify.html");
        std::fs::write(&out, html.as_bytes()).unwrap();
        eprintln!("wrote {}", out.display());
    }
}
