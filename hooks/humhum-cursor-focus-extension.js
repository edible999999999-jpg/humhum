const vscode = require('vscode');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';

function run(command, args) {
  try {
    return childProcess.execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function normalizeTty(value) {
  const tty = String(value || '').trim().replace(/^\/dev\//, '');
  return /^ttys\d+$/.test(tty) ? tty : null;
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let normalized = path.normalize(raw);
  if (IS_WINDOWS && normalized.startsWith('\\\\?\\UNC\\')) {
    normalized = '\\\\' + normalized.slice(8);
  } else if (IS_WINDOWS && normalized.startsWith('\\\\?\\')) {
    normalized = normalized.slice(4);
  }
  const root = path.parse(normalized).root;
  while (normalized.length > root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return IS_WINDOWS ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function readTty(pid) {
  if (IS_WINDOWS) return null;
  return normalizeTty(run('/bin/ps', ['-p', String(pid), '-o', 'tty=']));
}

function readCwd(pid) {
  if (IS_WINDOWS) return null;
  const lines = run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn']).split(/\r?\n/);
  const marker = lines.indexOf('fcwd');
  return marker >= 0 && lines[marker + 1]?.startsWith('n')
    ? normalizePath(lines[marker + 1].slice(1))
    : null;
}

function unixProcessTree() {
  const entries = new Map();
  for (const line of run('/bin/ps', ['-axww', '-o', 'pid=,ppid=']).split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (match) entries.set(Number(match[1]), { pid: Number(match[1]), ppid: Number(match[2]) });
  }
  return entries;
}

function windowsProcessTree() {
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    '@(Get-CimInstance Win32_Process | ForEach-Object {',
    "  [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId }",
    '}) | ConvertTo-Json -Compress',
  ].join('\n');
  let output = '';
  for (const executable of ['powershell.exe', 'pwsh.exe']) {
    output = run(executable, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ]);
    if (output) break;
  }

  const entries = new Map();
  try {
    const parsed = JSON.parse(output.replace(/^\uFEFF/, ''));
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      const pid = Number(row?.pid);
      const ppid = Number(row?.ppid);
      if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid >= 0) {
        entries.set(pid, { pid, ppid });
      }
    }
  } catch {
    // Terminal root PIDs and VS Code shell-integration CWDs remain usable.
  }
  return entries;
}

function processTree() {
  return IS_WINDOWS ? windowsProcessTree() : unixProcessTree();
}

function descendants(rootPid, entries) {
  const result = [];
  const pending = [rootPid];
  const seen = new Set();
  while (pending.length && result.length < 64) {
    const pid = pending.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    result.push(pid);
    for (const entry of entries.values()) {
      if (entry.ppid === pid) pending.push(entry.pid);
    }
  }
  return result;
}

function cwdFromValue(value) {
  if (typeof value === 'string') return normalizePath(value);
  if (value && typeof value.fsPath === 'string') return normalizePath(value.fsPath);
  return null;
}

function terminalCwds(terminal) {
  const result = new Set();
  const integrated = cwdFromValue(terminal.shellIntegration?.cwd);
  const configured = cwdFromValue(terminal.creationOptions?.cwd);
  if (integrated) result.add(integrated);
  if (configured) result.add(configured);
  return result;
}

async function describe(terminal, entries) {
  const rootPid = await terminal.processId;
  if (!Number.isFinite(rootPid) || rootPid <= 0) return null;
  const pids = descendants(rootPid, entries);
  const cwds = terminalCwds(terminal);
  if (!IS_WINDOWS) {
    for (const pid of pids) {
      const cwd = readCwd(pid);
      if (cwd) cwds.add(cwd);
    }
  }
  return {
    terminal,
    pids,
    ttys: new Set(pids.map(readTty).filter(Boolean)),
    cwds,
  };
}

function relatedPath(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const separator = path.sep;
  return left.startsWith(right + separator) || right.startsWith(left + separator);
}

function score(descriptor, target) {
  let value = 0;
  if (target.pid && descriptor.pids.includes(target.pid)) value += 500;
  if (target.tty && descriptor.ttys.has(target.tty)) value += 300;
  if (target.cwd && descriptor.cwds.has(target.cwd)) value += 200;
  if (target.cwd && Array.from(descriptor.cwds).some(cwd => relatedPath(cwd, target.cwd))) {
    value += 80;
  }
  return value;
}

function writeReceipt(receipt) {
  if (!/^[0-9a-fA-F-]{36}$/.test(receipt || '')) return;
  const directory = path.join(os.homedir(), '.humhum', 'cursor-focus');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, receipt), 'focused\n', { encoding: 'utf8', mode: 0o600 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function focusTerminal(query) {
  const target = {
    pid: /^\d+$/.test(query.get('pid') || '') ? Number(query.get('pid')) : null,
    tty: normalizeTty(query.get('tty')),
    cwd: normalizePath(query.get('cwd')),
  };
  if (!target.pid && !target.tty && !target.cwd) return false;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entries = processTree();
    const descriptors = (await Promise.all(vscode.window.terminals.map(item => describe(item, entries))))
      .filter(Boolean);
    const ranked = descriptors
      .map(item => ({ item, value: score(item, target) }))
      .filter(item => item.value > 0)
      .sort((left, right) => right.value - left.value);
    if (ranked.length && (ranked.length === 1 || ranked[0].value > ranked[1].value)) {
      ranked[0].item.terminal.show(false);
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
      return true;
    }
    await sleep(250);
  }
  return false;
}

function activate(context) {
  context.subscriptions.push(vscode.window.registerUriHandler({
    async handleUri(uri) {
      if (uri.path !== '/focus') return;
      const query = new URLSearchParams(uri.query);
      if (await focusTerminal(query)) writeReceipt(query.get('receipt'));
    },
  }));
}

function deactivate() {}
module.exports = { activate, deactivate };
