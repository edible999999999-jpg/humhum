#!/usr/bin/env python3
"""QoderWork Auto-Allow Daemon v6 - POST click events to humhum hook server"""

import asyncio, json, logging, os, re, signal, subprocess, sys, urllib.request
from pathlib import Path

try:
    import websockets
except ImportError:
    sys.exit("Error: pip install websockets")

CONFIG_DIR = Path.home() / ".qoderwork-auto-allow"
PID_FILE = CONFIG_DIR / "daemon.pid"
LOG_FILE = CONFIG_DIR / "daemon.log"
KNOWN_PORTS = {52345, 52347, 16789}
HUMHUM_HOOK_PORT = int(os.environ.get("HUMHUM_HOOK_PORT", "31275"))

logger = logging.getLogger("qw-auto-allow")
logger.setLevel(logging.DEBUG)
fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
fh = logging.FileHandler(LOG_FILE); fh.setFormatter(fmt); logger.addHandler(fh)
if sys.stdout.isatty():
    sh = logging.StreamHandler(sys.stdout); sh.setFormatter(fmt); logger.addHandler(sh)

def discover_cdp_port():
    try:
        r = subprocess.run(["lsof","-i","-P","-n"], capture_output=True, text=True, errors="replace", timeout=5)
        for line in r.stdout.splitlines():
            if "QoderWork" in line and "LISTEN" in line:
                m = re.search(r"(?:localhost|127\.0\.0\.1):(\d+)", line)
                if m:
                    p = int(m.group(1))
                    if p not in KNOWN_PORTS:
                        try:
                            import urllib.request
                            d = json.loads(urllib.request.urlopen(f"http://localhost:{p}/json/version", timeout=2).read())
                            if "Chrome" in d.get("Browser",""): return p
                        except: continue
    except: pass
    return None

async def get_ws_url(port):
    try:
        import urllib.request
        pages = json.loads(urllib.request.urlopen(f"http://localhost:{port}/json/list", timeout=5).read())
        for p in pages:
            if p.get("type")=="page" and "windowId=main" in p.get("url",""): return p.get("webSocketDebuggerUrl")
        for p in pages:
            if p.get("type")=="page": return p.get("webSocketDebuggerUrl")
    except: pass
    return None

def post_to_humhum(tool_name: str, button_text: str, click_count: int):
    """POST an auto-click event to humhum's hook server so it shows in the frontend UI."""
    try:
        payload = json.dumps({
            "hook_event_name": "PreToolUse",
            "session_id": "auto-allow",
            "client_type": "qoderwork-auto-allow",
            "payload": {
                "source": "auto-allow",
                "tool_name": tool_name,
                "action": "auto-clicked",
                "button_text": button_text,
                "click_count": click_count,
                "message": f"自动点击 \"{button_text}\" #{click_count}",
            }
        }).encode()
        req = urllib.request.Request(
            f"http://localhost:{HUMHUM_HOOK_PORT}/event?client=qoderwork-auto-allow",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=2)
        logger.info(f"[POST] humhum event sent: click #{click_count} status={resp.status}")
    except Exception as e:
        logger.warning(f"[POST] humhum event failed: {e}")

# v6 injection: cleaner auto-click with better button detection
INJECT_JS = r"""
(() => {
  // Always re-register — the __qwLog binding is per-CDP-session,
  // so on reconnect the old binding routes to a dead WebSocket.
  // Cleanup previous interval/observer to avoid duplicates.
  if (window.__qwV6Interval) { clearInterval(window.__qwV6Interval); window.__qwV6Interval = null; }
  if (window.__qwV6Observer) { try { window.__qwV6Observer.disconnect(); } catch(e){} window.__qwV6Observer = null; }
  // Cleanup older versions
  if (window.__qwV5) delete window.__qwV5;
  if (window.__qwV4) delete window.__qwV4;
  if (window.__qwV3) delete window.__qwV3;
  if (window.__qwV5Interval) { clearInterval(window.__qwV5Interval); window.__qwV5Interval = null; }
  if (window.__qwV4Interval) { clearInterval(window.__qwV4Interval); window.__qwV4Interval = null; }
  if (window.__qwV3Interval) { clearInterval(window.__qwV3Interval); window.__qwV3Interval = null; }

  window.__qwV6 = true;

  // Preserve click count across reconnections
  if (!window.__qwV6Clicks) window.__qwV6Clicks = 0;
  const clickedSet = new Set();
  const snapshotSet = new Set();

  // ============ DOM Snapshot Recorder ============
  // Records detailed structure of any new element containing dialog-related text
  function recordSnapshot(container) {
    const key = container.tagName + ':' + (container.className || '').substring(0, 40);
    if (snapshotSet.has(key)) return;
    snapshotSet.add(key);

    const snapshot = { tag: container.tagName, class: container.className, children: [] };

    // Walk up to 3 levels deep
    function walk(el, depth, parent) {
      if (depth > 3 || !el) return;
      const info = {
        tag: el.tagName,
        class: (el.className || '').substring(0, 100),
        id: el.id || null,
        role: el.getAttribute('role'),
        text: '',
        children: []
      };

      // Get direct text content (not from children)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');
      info.text = directText.substring(0, 60);

      // Check if this looks like a button
      const isButtonLike = el.tagName === 'BUTTON' ||
        el.getAttribute('role') === 'button' ||
        (el.className && (
          el.className.includes('cursor-pointer') ||
          el.className.includes('hover:') ||
          el.className.includes('btn') ||
          el.className.includes('button')
        ));
      if (isButtonLike) info.buttonLike = true;

      // Get computed style for button-like elements
      if (isButtonLike || depth <= 1) {
        try {
          const style = window.getComputedStyle(el);
          info.cursor = style.cursor;
          info.display = style.display;
          info.visibility = style.visibility;
        } catch(e) {}
      }

      parent.children.push(info);

      // Recurse into children (limit to first 20 to avoid huge snapshots)
      let childCount = 0;
      for (const child of el.children) {
        if (childCount++ >= 20) break;
        walk(child, depth + 1, info);
      }
    }

    walk(container, 0, snapshot);

    // Also record parent chain (up to 5 levels)
    let p = container.parentElement;
    const parentChain = [];
    for (let i = 0; i < 5 && p; i++) {
      parentChain.push({
        tag: p.tagName,
        class: (p.className || '').substring(0, 80),
        id: p.id || null
      });
      p = p.parentElement;
    }
    snapshot.parentChain = parentChain;

    window.__qwLog && window.__qwLog('SNAPSHOT:' + JSON.stringify(snapshot));
  }

  // ============ Dialog Detection + recording ============
  // MutationObserver watches for new elements with dialog-related text
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const text = node.textContent || '';
        // Check if this new node contains dialog-related keywords
        if (text.includes('允许') || text.includes('拒绝') || text.includes('始终') ||
            text.includes('高危') || text.includes('请求批准') || text.includes('Allow') ||
            text.includes('Deny') || text.includes('Always')) {
          recordSnapshot(node);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'aria-hidden']
  });

  window.__qwV6Observer = observer;

  // ============ Auto-click scan ============
  function scan() {
    const candidates = document.querySelectorAll('button, [role="button"], a, span, div');

    for (const el of candidates) {
      // Skip hidden elements — but NOT position:fixed (offsetParent is null for fixed in Electron)
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;
      // Check actual visibility: display:none or visibility:hidden
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      } catch(e) { continue; }

      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');

      // Also check full textContent for buttons/spans where text might be in children
      const fullText = el.textContent ? el.textContent.trim() : '';
      const matchText = directText === '允许' || directText === 'Allow' ||
        ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') &&
         (fullText === '允许' || fullText === 'Allow' || fullText === '始终允许' || fullText === 'Always Allow'));

      if (!matchText) continue;
      const btnText = directText || fullText;

      const elId = el.id || el.className.substring(0, 30) + ':' + rect.x + ':' + rect.y;
      if (clickedSet.has(elId)) continue;

      window.__qwLog && window.__qwLog('FOUND:' + el.tagName + '|class=' + el.className.substring(0, 80) + '|rect=' + Math.round(rect.x) + ',' + Math.round(rect.y) + ',' + Math.round(rect.width) + ',' + Math.round(rect.height));

      clickedSet.add(elId);

      setTimeout(() => {
        try {
          el.click();
          el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
          window.__qwV6Clicks++;
          window.__qwLog && window.__qwLog('CLICKED:' + el.tagName + ' "' + btnText + '" #' + window.__qwV6Clicks);
        } catch(e) {
          window.__qwLog && window.__qwLog('CLICK_ERROR:' + e.message);
        }
      }, 100);
    }
  }

  // Polling fallback every 300ms
  if (window.__qwV6Interval) clearInterval(window.__qwV6Interval);
  window.__qwV6Interval = setInterval(scan, 300);

  // Initial scan
  scan();

  return 'v6_injected';
})()
"""

class Daemon:
    def __init__(self):
        self.ws = None
        self.port = None
        self.running = True
        self._id = 0

    def nid(self): self._id += 1; return self._id

    async def connect(self, url):
        self.ws = await websockets.connect(url, max_size=10*1024*1024)
        await self.ws.send(json.dumps({"id":self.nid(),"method":"Runtime.addBinding","params":{"name":"__qwLog"}}))
        await self.ws.send(json.dumps({"id":self.nid(),"method":"Runtime.enable"}))
        logger.info(f"Connected: {url}")

    def _handle_page_log(self, payload: str):
        """Handle a log message from the injected JS, forwarding CLICKED events to humhum."""
        logger.info(f"[Page] {payload}")
        if payload.startswith("CLICKED:"):
            # Format: CLICKED:TAG "text" #N
            m = re.match(r'CLICKED:(\w+)\s+"(.+?)"\s+#(\d+)', payload)
            if m:
                tag, text, count = m.group(1), m.group(2), int(m.group(3))
                # Run POST in a thread to avoid blocking the async loop
                import threading
                threading.Thread(target=post_to_humhum, args=(f"AutoAllow({tag})", text, count), daemon=True).start()

    async def inject(self):
        await self.ws.send(json.dumps({"id":self.nid(),"method":"Runtime.evaluate","params":{"expression":INJECT_JS,"returnByValue":True}}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == self._id:
                v = msg.get("result",{}).get("result",{}).get("value","")
                logger.info(f"Injected: {v}")
                return
            if msg.get("method") == "Runtime.bindingCalled":
                self._handle_page_log(msg['params']['payload'])

    @staticmethod
    def _check_qw_alive():
        """Check if QoderWork process is running."""
        try:
            r = subprocess.run(["pgrep", "-f", "QoderWork"], capture_output=True, text=True, timeout=3)
            return bool(r.stdout.strip())
        except:
            return False

    @staticmethod
    def _check_cdp_alive(port):
        """Check if CDP endpoint is responsive."""
        try:
            import urllib.request
            d = json.loads(urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=2).read())
            return "Chrome" in d.get("Browser", "")
        except:
            return False

    async def run(self):
        backoff = 2
        while self.running:
            # Wait for QoderWork process to be alive
            if not self._check_qw_alive():
                if self.port:
                    logger.info("QoderWork process gone, waiting for restart...")
                    self.port = None
                    self.ws = None
                await asyncio.sleep(3)
                continue

            port = discover_cdp_port()
            if not port:
                await asyncio.sleep(min(backoff, 10)); continue

            # Detect QoderWork restart: port changed or CDP not responsive
            if port != self.port:
                logger.info(f"QoderWork {'restarted' if self.port else 'started'}, new port: {port}")
                self.port = port
                backoff = 2  # reset backoff on successful detection
            elif not self._check_cdp_alive(port):
                logger.info(f"CDP on port {port} not responsive, re-discovering...")
                self.port = None
                await asyncio.sleep(2)
                continue

            url = await get_ws_url(port)
            if not url:
                await asyncio.sleep(3); continue
            try:
                await self.connect(url)
                await self.inject()
                backoff = 2  # reset backoff after successful injection
                while self.running:
                    try:
                        msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=30))
                        if msg.get("method") == "Runtime.bindingCalled":
                            self._handle_page_log(msg['params']['payload'])
                    except asyncio.TimeoutError:
                        try:
                            await self.ws.send(json.dumps({"id":self.nid(),"method":"Runtime.evaluate","params":{"expression":"1","returnByValue":True}}))
                            while True:
                                try:
                                    msg = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=0.5))
                                    if msg.get("method") == "Runtime.bindingCalled":
                                        self._handle_page_log(msg['params']['payload'])
                                except asyncio.TimeoutError:
                                    break
                        except Exception:
                            logger.warning("Connection lost, reconnecting...")
                            break
                    except websockets.exceptions.ConnectionClosed:
                        logger.warning("WebSocket closed, reconnecting...")
                        break
            except Exception as e:
                logger.warning(f"Error: {e}")
            finally:
                if self.ws:
                    try: await self.ws.close()
                    except: pass
                    self.ws = None; self.port = None
            if self.running:
                await asyncio.sleep(min(backoff, 10))
                backoff = min(backoff * 1.5, 10)

    def stop(self):
        self.running = False
        logger.info("Stopping daemon...")

def write_pid():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))

def is_running():
    if not PID_FILE.exists(): return False, None
    try:
        pid = int(PID_FILE.read_text()); os.kill(pid, 0); return True, pid
    except: PID_FILE.unlink(missing_ok=True); return False, None

async def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--stop", action="store_true")
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    if args.status:
        r,p = is_running(); print(f"Running PID:{p}" if r else "Not running"); return
    if args.stop:
        r,p = is_running()
        if r and p: os.kill(p, signal.SIGTERM); print(f"Stopped {p}"); PID_FILE.unlink(missing_ok=True)
        else: print("Not running")
        return

    r,p = is_running()
    if r: print(f"Already running {p}"); return

    write_pid()
    logger.info(f"Started PID:{os.getpid()}")
    d = Daemon()
    signal.signal(signal.SIGTERM, lambda s,f: d.stop())
    signal.signal(signal.SIGINT, lambda s,f: d.stop())
    try: await d.run()
    finally: PID_FILE.unlink(missing_ok=True); logger.info("Stopped")

if __name__ == "__main__":
    asyncio.run(main())
