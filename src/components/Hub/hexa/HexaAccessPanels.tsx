import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Link, Power, QrCode, RefreshCw, Save, Send, ShieldCheck, Smartphone, Trash2, X } from "lucide-react";
import {
  type CodexRemoteControlState,
  type CodexRemotePairing,
  type MobileBridgeStatus,
  type MobilePairingInfo,
  type MobileRelayConfig,
} from "../../../hooks/useHexaData";
import { mobilePresenceLabel } from "../../../hooks/mobilePresence";
import {
  mobilePairingSecondsRemaining,
  shouldShowMobilePairingQr,
} from "../../../hooks/mobilePairingQr";
import { t } from "@/lib/i18n";

export const hexaRegisterCommand = () =>
  `~/.humhum/bin/humhum-hexa watch "${t("hexa.cmdRegisterPlaceholder")}"`;
export const hexaUpdateCommand = () =>
  `~/.humhum/bin/humhum-hexa update "${t("hexa.cmdUpdatePlaceholder")}"`;
export const HEXA_DELETE_COMMAND = `~/.humhum/bin/humhum-hexa unwatch`;

export interface HermesObserverStatus {
  detected: boolean;
  connected: boolean;
  message: string;
}

export async function startOrRefreshMobilePairing(
  state: MobileBridgeStatus,
  pairing: MobilePairingInfo | null,
  onEnable: () => Promise<MobileBridgeStatus>,
  onPair: (
    scope?: "read" | "control",
    network?: "lan" | "tailnet",
    personalContext?: boolean,
  ) => Promise<MobilePairingInfo>,
): Promise<MobilePairingInfo> {
  if (!state.enabled) await onEnable();
  return onPair(
    pairing?.scope ?? "control",
    pairing?.network ?? "lan",
    pairing?.personal_context ?? true,
  );
}

export function HexaMobilePairingCard({
  state,
  pairing,
  onEnable,
  onPair,
}: {
  state: MobileBridgeStatus;
  pairing: MobilePairingInfo | null;
  onEnable: () => Promise<MobileBridgeStatus>;
  onPair: (
    scope?: "read" | "control",
    network?: "lan" | "tailnet",
    personalContext?: boolean,
  ) => Promise<MobilePairingInfo>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [pairingDismissed, setPairingDismissed] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  useEffect(() => {
    setPairingDismissed(false);
  }, [pairing?.android_setup]);

  const secondsRemaining = pairing
    ? mobilePairingSecondsRemaining(pairing.expires_at, nowMs)
    : 0;
  const qrVisible = pairing
    ? shouldShowMobilePairingQr(state.pairing_active, pairing.expires_at, nowMs)
    : false;
  const pairingExpanded =
    qrVisible && Boolean(pairing?.android_setup) && !pairingDismissed;
  const actionLabel = pairingExpanded ? t("hexa.pairRefreshQr") : t("hexa.pairGenerateQr");

  const refreshPairing = async () => {
    setBusy(true);
    setError(null);
    try {
      await startOrRefreshMobilePairing(state, pairing, onEnable, onPair);
      setPairingDismissed(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="hexa-mobile-pairing"
      aria-label={t("hexa.mobileConnect")}
      data-expanded={pairingExpanded ? "true" : "false"}
    >
      {pairingExpanded && pairing?.android_setup ? (
        <div className="hexa-mobile-pairing-panel">
          <button
            type="button"
            className="hexa-mobile-pairing-close"
            aria-label={t("hexa.closePairingQr")}
            title={t("hexa.closePairingQr")}
            onClick={() => setPairingDismissed(true)}
          >
            <X size={14} aria-hidden="true" />
          </button>
          <div className="hexa-mobile-pairing-qr" aria-label={t("hexa.pairingQrLabel")}>
            <QRCodeSVG
              value={pairing.android_setup}
              size={120}
              bgColor="#ffffff"
              fgColor="#111827"
              level="M"
              marginSize={4}
              title={t("hexa.androidSecurePairing")}
            />
          </div>
          <div className="hexa-mobile-pairing-copy">
            <div className="hexa-mobile-pairing-title">
              <Smartphone size={16} />
              <span>{t("hexa.controlHexaPhone")}</span>
            </div>
            <div className="hexa-mobile-pairing-detail">{t("hexa.androidScanConnect")}</div>
            <div className="hexa-mobile-pairing-status">
              {state.relay_url
                ? t("hexa.relayEncrypted")
                : pairing.network === "tailnet"
                  ? "Tailnet"
                  : t("hexa.sameWifi")} · {pairing.scope === "control" ? t("hexa.scopeControl") : t("hexa.scopeReadonly")} · {t("hexa.minutesRemaining", { count: Math.max(1, Math.ceil(secondsRemaining / 60)) })}
            </div>
            <button
              type="button"
              className="hexa-mobile-pairing-action"
              aria-label={actionLabel}
              title={actionLabel}
              disabled={busy}
              onClick={() => void refreshPairing()}
            >
              <RefreshCw size={14} className={busy ? "hexa-mobile-refreshing" : undefined} />
              <span className="hexa-mobile-action-label">
                {busy ? t("hexa.refreshing") : t("hexa.refreshQr")}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="hexa-mobile-affordance">
          <Smartphone size={17} aria-hidden="true" />
          <div className="hexa-mobile-affordance-copy">
            <strong>{t("hexa.controlHexaPhone")}</strong>
            <span>
              {error ?? (state.paired_devices > 0
                ? t("hexa.connectedDevicesRepair", { count: state.paired_devices })
                : t("hexa.scanAfterGenerate"))}
            </span>
            <small>{t("hexa.pairDefaultHint")}</small>
          </div>
          <button
            type="button"
            className="hexa-mobile-pairing-action"
            aria-label={actionLabel}
            title={actionLabel}
            disabled={busy}
            onClick={() => void refreshPairing()}
          >
            <QrCode size={15} />
            <span className="hexa-mobile-action-label">
              {busy ? t("hexa.generating") : t("hexa.generateQr")}
            </span>
          </button>
        </div>
      )}
      {error && pairingExpanded && <div className="hexa-mobile-pairing-error">{error}</div>}
    </aside>
  );
}

export function HexaRemoteAccessPanel({
  state,
  pairing,
  onEnable,
  onDisable,
  onPair,
}: {
  state: CodexRemoteControlState;
  pairing: CodexRemotePairing | null;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onPair: () => Promise<CodexRemotePairing>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };
  const connected = state.status === "connected";

  return (
    <section className="hexa-binding-section hexa-remote-access">
      <Smartphone size={18} color={connected ? "#22c55e" : "#38bdf8"} />
      <div className="hexa-binding-copy">
        <strong>Codex Mobile Remote</strong>
        <span>{pairing?.manual_pairing_code ? t("hexa.pairingCode", { code: pairing.manual_pairing_code }) : state.message}</span>
      </div>
      <div className="hexa-binding-actions">
        {connected ? (
          <button type="button" title={t("hexa.closeMobileAccess")} disabled={busy} onClick={() => run(onDisable)} className="kawaii-toggle-btn"><Power size={15} /></button>
        ) : (
          <>
            <button type="button" title={t("hexa.enableMobileAccess")} disabled={busy || state.status === "unavailable"} onClick={() => run(onEnable)} className="kawaii-toggle-btn connected"><Power size={15} /></button>
            <button type="button" title={t("hexa.generatePairCode")} disabled={busy || state.status === "unavailable"} onClick={() => run(onPair)} className="kawaii-toggle-btn"><Link size={15} /></button>
          </>
        )}
      </div>
    </section>
  );
}

export function HexaMobileAccessPanel({
  state,
  pairing,
  relayConfig,
  onEnable,
  onDisable,
  onPair,
  onRevoke,
  onRevokeDevice,
  onConfigureRelay,
}: {
  state: MobileBridgeStatus;
  pairing: MobilePairingInfo | null;
  relayConfig: MobileRelayConfig;
  onEnable: () => Promise<MobileBridgeStatus>;
  onDisable: () => Promise<MobileBridgeStatus>;
  onPair: (
    scope?: "read" | "control",
    network?: "lan" | "tailnet",
    personalContext?: boolean,
  ) => Promise<MobilePairingInfo>;
  onRevoke: () => Promise<MobileBridgeStatus>;
  onRevokeDevice: (deviceId: string) => Promise<MobileBridgeStatus>;
  onConfigureRelay: (
    enabled: boolean,
    baseUrl: string,
    inviteCode: string,
  ) => Promise<MobileRelayConfig>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [network, setNetwork] = useState<"lan" | "tailnet">("lan");
  const [personalContext, setPersonalContext] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [relayEnabled, setRelayEnabled] = useState(relayConfig.enabled);
  const [relayUrl, setRelayUrl] = useState(relayConfig.base_url ?? "");
  const [relayInvite, setRelayInvite] = useState(relayConfig.invite_code ?? "");
  useEffect(() => {
    if (!state.tailnet_url) setNetwork("lan");
  }, [state.tailnet_url]);
  useEffect(() => {
    setRelayEnabled(relayConfig.enabled);
    setRelayUrl(relayConfig.base_url ?? "");
    setRelayInvite(relayConfig.invite_code ?? "");
  }, [relayConfig]);
  useEffect(() => {
    if (!pairing) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const pairingSeconds = pairing
    ? mobilePairingSecondsRemaining(pairing.expires_at, nowMs)
    : 0;
  const pairingQrVisible = pairing
    ? shouldShowMobilePairingQr(state.pairing_active, pairing.expires_at, nowMs)
    : false;
  const detail = pairing
    ? pairingQrVisible
      ? `${copied ? t("hexa.androidCopiedPrefix") : ""}${t("hexa.pairCodeDetail", {
          code: pairing.code,
          network: state.relay_url ? t("hexa.networkRelay") : pairing.network === "tailnet" ? t("hexa.networkTailnet") : t("hexa.networkLan"),
          scope: pairing.scope === "control" ? t("hexa.scopeControl") : t("hexa.scopeReadonly"),
          minutes: Math.ceil(pairingSeconds / 60),
        })}`
      : t("hexa.qrExpired")
    : state.enabled
      ? t("hexa.lanDevices", { url: state.lan_url ?? state.url ?? "", count: state.paired_devices })
      : t("hexa.mobileDefaultOff");

  return (
    <section className="hexa-binding-section hexa-mobile-access">
      <Smartphone size={18} color={state.enabled ? "#22c55e" : "#86a7d5"} />
      <div className="hexa-binding-copy hexa-mobile-access-copy">
        <strong>HUMHUM Mobile Web</strong>
        <span className={error ? "is-error" : undefined}>{error ?? detail}</span>
        {state.enabled && state.certificate_fingerprint && (
          <small className="hexa-mobile-fingerprint" title={state.certificate_fingerprint}>
            TLS {state.certificate_fingerprint}
          </small>
        )}
        {state.enabled && state.tailnet_url && (
          <div
            role="group"
            aria-label={t("hexa.androidPairNetwork")}
            className="hexa-mobile-network-control"
          >
            {(["lan", "tailnet"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={network === option}
                onClick={() => setNetwork(option)}
                className={network === option ? "is-active" : undefined}
              >
                {option === "lan" ? t("hexa.netOptionLan") : t("hexa.netOptionTailnet")}
              </button>
            ))}
          </div>
        )}
        {state.enabled && (
          <label title={t("hexa.personalContextTip")}>
            <input
              type="checkbox"
              checked={personalContext}
              onChange={(event) => setPersonalContext(event.target.checked)}
            />
            {t("hexa.syncPersonalContext")}
          </label>
        )}
        {!state.enabled && (
          <div className="hexa-mobile-relay-form">
            <label title={t("hexa.relayWakeTip")}>
              <input
                type="checkbox"
                checked={relayEnabled}
                onChange={(event) => setRelayEnabled(event.target.checked)}
              />
              {t("hexa.anywhereBeta")}
            </label>
            <div className="hexa-mobile-relay-fields">
              <input
                aria-label={t("hexa.relayUrlLabel")}
                type="url"
                value={relayUrl}
                disabled={!relayEnabled || busy}
                placeholder="https://relay.example.com"
                onChange={(event) => setRelayUrl(event.target.value)}
                className="hexa-binding-input"
              />
              <input
                aria-label={t("hexa.inviteCodeLabel")}
                type="password"
                value={relayInvite}
                disabled={!relayEnabled || busy}
                placeholder={t("hexa.inviteCodePlaceholder")}
                autoComplete="off"
                onChange={(event) => setRelayInvite(event.target.value)}
                className="hexa-binding-input"
              />
            </div>
            <button
              type="button"
              title={t("hexa.saveAnywhere")}
              aria-label={t("hexa.saveAnywhere")}
              disabled={busy}
              onClick={() => run(() => onConfigureRelay(
                relayEnabled,
                relayUrl,
                relayInvite,
              ))}
              className="kawaii-icon-btn"
              style={{ width: 28, height: 28, minWidth: 28 }}
            ><Save size={13} /></button>
          </div>
        )}
        {state.enabled && (
          <div className={`hexa-mobile-relay-status ${state.relay_status === "errored" ? "is-error" : ""}`}>
            {t("hexa.wakeEncrypted")} · {state.relay_status === "disabled" ? t("hexa.relayDisabled") : state.relay_status === "connected" ? t("hexa.relayConnected") : state.relay_status === "retrying" ? t("hexa.relayRetrying") : t("hexa.relayError")}{state.relay_url ? ` · ${state.relay_url}` : ""}
          </div>
        )}
        {state.devices.map((device) => (
          <div key={device.id} className="hexa-mobile-device">
            <span title={device.last_seen_at ?? t("hexa.deviceOffline")}>
              {device.name} · {device.scope === "control" ? t("hexa.scopeControl") : t("hexa.scopeReadonly")} · {mobilePresenceLabel(device.presence_mode)}
            </span>
            <button type="button" title={t("hexa.revokeDevice", { name: device.name })} aria-label={t("hexa.revokeDevice", { name: device.name })} disabled={busy} onClick={() => run(() => onRevokeDevice(device.id))} className="kawaii-icon-btn" style={{ width: 24, height: 24, minWidth: 24 }}><Trash2 size={12} /></button>
          </div>
        ))}
        {pairing?.android_setup && pairingQrVisible && (
          <div className="hexa-mobile-setup">
            <div aria-label={t("hexa.androidQrLabel")} className="hexa-mobile-setup-qr">
              <QRCodeSVG
                value={pairing.android_setup}
                size={160}
                bgColor="#ffffff"
                fgColor="#111827"
                level="M"
                marginSize={4}
                title={t("hexa.androidSecurePairing")}
              />
            </div>
            <div className="hexa-mobile-setup-copy">
              <strong>{t("hexa.scanConnect")}</strong>
              <span>
                {t("hexa.androidOpenScan")}
              </span>
              <small>
                {t("hexa.pairSecondsLeft", {
                  network: state.relay_url ? t("hexa.networkRelay") : pairing.network === "tailnet" ? t("hexa.networkTailnet") : t("hexa.sameNetwork"),
                  scope: pairing.scope === "control" ? t("hexa.scopeControl") : t("hexa.scopeReadonly"),
                  seconds: pairingSeconds,
                })}
              </small>
            </div>
          </div>
        )}
      </div>
      <div className="hexa-binding-actions hexa-mobile-access-actions">
        {state.enabled ? (
          <>
            {pairing?.android_setup && (
              <button
                type="button"
                title={t("hexa.copyAndroidPairing")}
                aria-label={t("hexa.copyAndroidPairing")}
                disabled={busy}
                onClick={() => run(async () => {
                  await navigator.clipboard.writeText(pairing.android_setup);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 3000);
                })}
                className="kawaii-toggle-btn"
              ><Copy size={15} /></button>
            )}
            <button type="button" title={t("hexa.genReadonlyCode")} aria-label={t("hexa.genReadonlyCode")} disabled={busy} onClick={() => run(() => onPair("read", network, personalContext))} className="kawaii-toggle-btn connected"><Link size={15} /></button>
            <button type="button" title={t("hexa.genControlCode")} aria-label={t("hexa.genControlCode")} disabled={busy} onClick={() => run(() => onPair("control", network, personalContext))} className="kawaii-toggle-btn"><ShieldCheck size={15} /></button>
            {state.paired_devices > 0 && <button type="button" title={t("hexa.revokeAllDevices")} aria-label={t("hexa.revokeAllDevices")} disabled={busy} onClick={() => run(onRevoke)} className="kawaii-toggle-btn"><Trash2 size={15} /></button>}
            <button type="button" title={t("hexa.closeHumhumMobile")} aria-label={t("hexa.closeHumhumMobile")} disabled={busy} onClick={() => run(onDisable)} className="kawaii-toggle-btn"><Power size={15} /></button>
          </>
        ) : (
          <button type="button" title={t("hexa.openHumhumMobile")} aria-label={t("hexa.openHumhumMobile")} disabled={busy} onClick={() => run(onEnable)} className="kawaii-toggle-btn connected"><Power size={15} /></button>
        )}
      </div>
    </section>
  );
}

export function HexaWatchCommandPanel() {
  const [copied, setCopied] = useState<"register" | "update" | "delete" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const copy = async (kind: "register" | "update" | "delete", command: string) => {
    await navigator.clipboard.writeText(command);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <section className={`hexa-binding-section hexa-watch-command ${expanded ? "is-expanded" : ""}`}>
      <div className="hexa-watch-command-heading">
        <div className="hexa-binding-copy">
          <strong>{t("hexa.joinManaged")}</strong>
          <span>
            {t("hexa.joinManagedDesc")}
          </span>
        </div>
        <div className="hexa-binding-actions">
          <button type="button" className="kawaii-toggle-btn" onClick={() => setExpanded((value) => !value)}>
            {expanded ? t("hexa.collapseCommand") : t("hexa.expandCommand")}
          </button>
          <button type="button" className="kawaii-toggle-btn connected" onClick={() => void copy("register", hexaRegisterCommand())}>
            <Copy size={14} /> {copied === "register" ? t("hexa.copied") : t("hexa.copyRegisterCmd")}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="hexa-watch-command-details">
          <pre>{hexaRegisterCommand()}</pre>
          <div className="hexa-watch-command-footer">
            <span>
              {t("hexa.updateCmdNote")}
            </span>
            <div className="hexa-binding-actions">
              <button type="button" className="kawaii-toggle-btn" onClick={() => void copy("update", hexaUpdateCommand())}>
                <Send size={14} /> {copied === "update" ? t("hexa.copied") : t("hexa.copyUpdateCmd")}
              </button>
              <button type="button" className="kawaii-toggle-btn" onClick={() => void copy("delete", HEXA_DELETE_COMMAND)}>
                <Trash2 size={14} /> {copied === "delete" ? t("hexa.copied") : t("hexa.copyDeleteCmd")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <code className="hexa-watch-command-preview">{hexaRegisterCommand()}</code>
      )}
    </section>
  );
}

export function HermesObserverCard({
  status,
  busy,
  error,
  onConnect,
}: {
  status: HermesObserverStatus | null;
  busy: boolean;
  error: string | null;
  onConnect: () => Promise<void>;
}) {
  if (!status?.detected) return null;
  const tone = status.connected ? "#22c55e" : "#0f9f8f";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 10,
        padding: 10,
        borderRadius: 8,
        background: `${tone}0d`,
        border: `1px solid ${tone}2e`,
      }}
    >
      <ShieldCheck size={18} color={tone} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#263241", fontSize: 11, fontWeight: 900 }}>
          Hermes Agent
        </div>
        <div
          role={error ? "alert" : "status"}
          style={{
            color: error ? "#d85b64" : "#64748b",
            fontSize: 10,
            lineHeight: 1.45,
            marginTop: 3,
            overflowWrap: "anywhere",
          }}
        >
          {error ?? status.message}
        </div>
      </div>
      {status.connected ? (
        <span style={{ color: tone, fontSize: 10, fontWeight: 850 }}>{t("hexa.joined")}</span>
      ) : (
        <button
          type="button"
          className="kawaii-toggle-btn connected"
          disabled={busy}
          onClick={() => void onConnect()}
        >
          {busy ? t("hexa.joining") : t("hexa.joinHexa")}
        </button>
      )}
    </div>
  );
}
