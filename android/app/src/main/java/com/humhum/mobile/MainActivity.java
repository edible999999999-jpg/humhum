package com.humhum.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4103;
    private static final StartedOwnerRegistry<MainActivity> STARTED_ACTIVITIES =
            new StartedOwnerRegistry<>();
    private static final DurableConnectionTransitionCoordinator TRANSITIONS =
            new DurableConnectionTransitionCoordinator(
                    MainActivity::notifyStartedActivityOfTransitionCompletion);
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (protocol != null) refreshSessions(false);
            main.postDelayed(this, 10_000);
        }
    };

    private ConnectionStore connectionStore;
    private EncryptedSessionSnapshotStore snapshotStore;
    private SessionSnapshotGenerationGate snapshotGenerationGate;
    private MonitorStore monitorStore;
    private ConnectionStore.Connection connection;
    private MobileProtocol protocol;
    private boolean refreshInFlight;
    private LinearLayout connectPanel;
    private LinearLayout sessionPanel;
    private LinearLayout sessionsContainer;
    private TextView statusText;
    private TextView scopeText;
    private TextView connectError;
    private EditText urlInput;
    private EditText codeInput;
    private EditText fingerprintInput;
    private EditText deviceNameInput;
    private Button connectButton;
    private Button refreshButton;
    private Button disconnectButton;
    private Switch monitorSwitch;
    private TextView monitorStatusText;
    private TextView batteryStatusText;
    private TextView pushStatusText;
    private Button batterySettingsButton;
    private Button autostartSettingsButton;
    private boolean updatingMonitorSwitch;
    private boolean pendingMonitorEnable;
    private SharedPreferences pushPreferences;
    private final SharedPreferences.OnSharedPreferenceChangeListener pushStateListener =
            (preferences, key) -> main.post(this::updatePushStatus);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        bindViews();
        connectionStore = new ConnectionStore(getSharedPreferences("humhum_connection", MODE_PRIVATE));
        snapshotStore = new EncryptedSessionSnapshotStore(this);
        snapshotGenerationGate = SessionSnapshotGenerationGate.open();
        monitorStore = AgentMonitorService.monitorStore(this);
        pushPreferences = getSharedPreferences("humhum_push", MODE_PRIVATE);
        connectButton.setOnClickListener(view -> pair());
        findViewById(R.id.pasteSetupButton).setOnClickListener(view -> pasteSetup());
        refreshButton.setOnClickListener(view -> refreshSessions(true));
        disconnectButton.setOnClickListener(view -> disconnect());
        monitorSwitch.setOnCheckedChangeListener((button, checked) -> onMonitorChanged(checked));
        batterySettingsButton.setOnClickListener(view -> openBatterySettings());
        autostartSettingsButton.setOnClickListener(view -> openAutostartSettings());
        autostartSettingsButton.setVisibility(
                DeviceCarePlan.isXiaomiFamily(Build.MANUFACTURER) ? View.VISIBLE : View.GONE);

        connection = connectionStore.load();
        if (connection == null) {
            showConnect();
        } else {
            activate(connection);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        STARTED_ACTIVITIES.start(this);
        boolean ownsProcessState = snapshotGenerationGate.isLatestOwner()
                || snapshotGenerationGate.claimLatestOwnerIfVacant();
        if (ownsProcessState) {
            DurableConnectionTransitionCoordinator.State transitionState = TRANSITIONS.state();
            adoptTransitionState();
            if (transitionState == DurableConnectionTransitionCoordinator.State.IDLE) {
                reconcileDurableConnection(null);
            }
        }
        pushPreferences.registerOnSharedPreferenceChangeListener(pushStateListener);
        updatePushStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (connection != null) {
            syncMonitorState();
            reportForegroundPresence();
        }
        updateDeviceCareStatus();
        main.removeCallbacks(poll);
        main.post(poll);
    }

    @Override
    protected void onStop() {
        STARTED_ACTIVITIES.stop(this);
        notifyPreviousStartedActivity();
        pushPreferences.unregisterOnSharedPreferenceChangeListener(pushStateListener);
        main.removeCallbacks(poll);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        snapshotGenerationGate.close();
        network.shutdownNow();
        super.onDestroy();
    }

    private void bindViews() {
        connectPanel = findViewById(R.id.connectPanel);
        sessionPanel = findViewById(R.id.sessionPanel);
        sessionsContainer = findViewById(R.id.sessionsContainer);
        statusText = findViewById(R.id.statusText);
        scopeText = findViewById(R.id.scopeText);
        connectError = findViewById(R.id.connectError);
        urlInput = findViewById(R.id.urlInput);
        codeInput = findViewById(R.id.codeInput);
        fingerprintInput = findViewById(R.id.fingerprintInput);
        deviceNameInput = findViewById(R.id.deviceNameInput);
        connectButton = findViewById(R.id.connectButton);
        refreshButton = findViewById(R.id.refreshButton);
        disconnectButton = findViewById(R.id.disconnectButton);
        monitorSwitch = findViewById(R.id.monitorSwitch);
        monitorStatusText = findViewById(R.id.monitorStatusText);
        batteryStatusText = findViewById(R.id.batteryStatusText);
        pushStatusText = findViewById(R.id.pushStatusText);
        batterySettingsButton = findViewById(R.id.batterySettingsButton);
        autostartSettingsButton = findViewById(R.id.autostartSettingsButton);
    }

    private void updateDeviceCareStatus() {
        if (batteryStatusText == null) return;
        PowerManager power = getSystemService(PowerManager.class);
        boolean exempt = power != null && power.isIgnoringBatteryOptimizations(getPackageName());
        batteryStatusText.setText(DeviceCarePlan.batteryStatus(exempt));
    }

    private void openBatterySettings() {
        if (!DeviceCareNavigator.openBatterySettings(this)) {
            batteryStatusText.setText("无法打开系统设置");
        }
    }

    private void openAutostartSettings() {
        if (!DeviceCareNavigator.openAutostartSettings(this, Build.MANUFACTURER)) {
            batteryStatusText.setText("无法打开系统设置");
        }
    }

    private void pair() {
        connectError.setText("");
        final BridgeConfig config;
        try {
            config = BridgeConfig.parse(
                    urlInput.getText().toString(),
                    codeInput.getText().toString(),
                    fingerprintInput.getText().toString(),
                    deviceNameInput.getText().toString());
        } catch (IllegalArgumentException error) {
            connectError.setText(error.getMessage());
            return;
        }
        boolean started = TRANSITIONS.begin(
                DurableConnectionTransitionCoordinator.State.PAIRING,
                () -> {
                    Models.PairResult result =
                            new MobileProtocol(config, "", Models.Scope.READ).pair();
                    SessionSnapshotGenerationGate.callExclusiveTransition(() -> {
                        clearSnapshotSafely();
                        connectionStore.save(config, result);
                        return null;
                    });
                    return "";
                });
        if (!started) {
            adoptTransitionState();
            return;
        }
        setPairing(true);
    }

    private void pasteSetup() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData data = clipboard.getPrimaryClip();
        if (data == null || data.getItemCount() == 0) {
            connectError.setText("剪贴板为空");
            return;
        }
        CharSequence text = data.getItemAt(0).coerceToText(this);
        try {
            PairingSetup setup = PairingSetup.parse(text == null ? "" : text.toString());
            urlInput.setText(setup.url());
            codeInput.setText(setup.code());
            fingerprintInput.setText(setup.fingerprint());
            connectError.setText(setup.scope() == Models.Scope.CONTROL
                    ? "已填入可控制配对资料，请点击安全配对"
                    : "已填入只读配对资料，请点击安全配对");
        } catch (IllegalArgumentException error) {
            connectError.setText(error.getMessage());
        }
    }

    private void activate(ConnectionStore.Connection saved) {
        if (saved == null) {
            showConnect();
            return;
        }
        connection = saved;
        protocol = new MobileProtocol(saved.config(), saved.token(), saved.scope());
        connectPanel.setVisibility(View.GONE);
        sessionPanel.setVisibility(View.VISIBLE);
        String route = saved.config().isTailnet() ? "Tailnet · " : "";
        scopeText.setText(saved.scope() == Models.Scope.CONTROL
                ? "已安全连接 · " + route + "可控制"
                : "已安全连接 · " + route + "只读");
        statusText.setText("正在同步");
        syncMonitorState();
        reportForegroundPresence();
        PushRegistration.refresh(this);
        updatePushStatus();
        refreshSessions(true);
    }

    private void reportForegroundPresence() {
        MobileProtocol active = protocol;
        if (active == null) return;
        network.execute(() -> {
            try {
                active.reportPresence(MobileProtocol.PresenceMode.FOREGROUND);
            } catch (Exception ignored) {
                // Session refresh owns visible connection errors and authentication handling.
            }
        });
    }

    private void showConnect() {
        protocol = null;
        connection = null;
        connectPanel.setVisibility(View.VISIBLE);
        sessionPanel.setVisibility(View.GONE);
        statusText.setText("等待连接");
        sessionsContainer.removeAllViews();
        if (monitorStore != null && monitorStore.isEnabled()) disableMonitor();
    }

    private void disconnect() {
        MobileProtocol current = protocol;
        if (current == null || connection == null) return;
        boolean started = TRANSITIONS.begin(
                DurableConnectionTransitionCoordinator.State.DISCONNECTING,
                () -> {
                    String warning = "";
                    try {
                        current.disconnect();
                    } catch (Exception error) {
                        warning = "本机连接已清除；Mac 未确认撤销，请在 Hexa 中撤销旧设备。";
                    }
                    SessionSnapshotGenerationGate.runExclusiveTransition(() -> {
                        clearSnapshotSafely();
                        connectionStore.clear();
                    });
                    return warning;
                });
        if (!started) {
            adoptTransitionState();
            return;
        }
        disableMonitor();
        PushRegistration.cancel(this);
        setDisconnecting(true);
    }

    private void onMonitorChanged(boolean checked) {
        if (updatingMonitorSwitch) return;
        if (!checked) {
            disableMonitor();
            return;
        }
        boolean granted = hasNotificationPermission();
        if (MonitorPermissionPolicy.needsRequest(Build.VERSION.SDK_INT, granted)) {
            pendingMonitorEnable = true;
            setMonitorSwitch(false);
            monitorStatusText.setText("需要通知权限");
            requestPermissions(
                    new String[] {Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST);
            return;
        }
        enableMonitor();
    }

    private void syncMonitorState() {
        if (!monitorStore.isEnabled()) {
            setMonitorSwitch(false);
            monitorStatusText.setText("已关闭");
            return;
        }
        if (!MonitorPermissionPolicy.canStart(Build.VERSION.SDK_INT, hasNotificationPermission())) {
            disableMonitor();
            monitorStatusText.setText("需要通知权限");
            return;
        }
        setMonitorSwitch(true);
        monitorStatusText.setText("正在监控这台 Mac");
        AgentMonitorService.start(this);
    }

    private void enableMonitor() {
        try {
            monitorStore.setEnabled(true);
            AgentMonitorService.start(this);
            setMonitorSwitch(true);
            monitorStatusText.setText("正在监控这台 Mac");
        } catch (RuntimeException error) {
            monitorStore.clear();
            setMonitorSwitch(false);
            monitorStatusText.setText("无法启动后台监控");
        }
    }

    private void disableMonitor() {
        pendingMonitorEnable = false;
        AgentMonitorService.stop(this);
        monitorStore.clear();
        setMonitorSwitch(false);
        if (monitorStatusText != null) monitorStatusText.setText("已关闭");
    }

    private void setMonitorSwitch(boolean checked) {
        if (monitorSwitch == null) return;
        updatingMonitorSwitch = true;
        monitorSwitch.setChecked(checked);
        updatingMonitorSwitch = false;
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        == PackageManager.PERMISSION_GRANTED;
    }

    private void updatePushStatus() {
        if (pushStatusText == null || connectionStore == null) return;
        ConnectionStore.Connection current = connectionStore.load();
        String channel = current == null || current.wakeRelay() == null
                ? null
                : current.wakeRelay().channelId();
        PushStateStore.State state = PushRegistration.stateStore(this).read(
                channel,
                HumHumApplication.isFcmConfigured());
        pushStatusText.setText(PushStateStore.copy(state));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST || !pendingMonitorEnable) return;
        pendingMonitorEnable = false;
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) {
            enableMonitor();
        } else {
            setMonitorSwitch(false);
            monitorStatusText.setText("需要通知权限");
        }
    }

    private void refreshSessions(boolean userInitiated) {
        if (protocol == null || connection == null || refreshInFlight) return;
        refreshInFlight = true;
        refreshButton.setEnabled(false);
        if (userInitiated) statusText.setText("正在刷新");
        MobileProtocol current = protocol;
        ConnectionStore.Connection currentConnection = connection;
        long refreshGeneration = snapshotGenerationGate.capture();
        network.execute(() -> {
            try {
                Models.SessionPage page = current.sessions();
                long savedAtMillis = System.currentTimeMillis();
                boolean written = snapshotGenerationGate.callIfCurrent(refreshGeneration, () -> {
                    if (!isCurrentConnection(current, currentConnection)) return false;
                    writeSnapshotSafely(currentConnection, page.sessions(), savedAtMillis);
                    return true;
                }, false);
                if (!written) return;
                postIfCurrent(refreshGeneration, current, currentConnection, () -> {
                    refreshInFlight = false;
                    refreshButton.setEnabled(true);
                    statusText.setText("刚刚同步");
                    renderSessions(page.sessions());
                });
            } catch (Exception error) {
                long nowMillis = System.currentTimeMillis();
                SessionSnapshot snapshot = OfflineFallbackPolicy.canUseSnapshot(error)
                        ? snapshotGenerationGate.callIfCurrent(
                                refreshGeneration,
                                () -> {
                                    if (!isCurrentConnection(current, currentConnection)) return null;
                                    return readSnapshotSafely(currentConnection, nowMillis);
                                },
                                null)
                        : null;
                postIfCurrent(refreshGeneration, current, currentConnection, () -> {
                    refreshInFlight = false;
                    refreshButton.setEnabled(true);
                    if (snapshot == null) {
                        statusText.setText(safeError(error));
                        return;
                    }
                    statusText.setText(
                            SessionSnapshotCodec.ageCopy(snapshot.savedAtMillis(), nowMillis));
                    renderSessions(snapshot.sessions());
                });
            }
        });
    }

    private boolean isCurrentConnection(
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection) {
        return protocol == expectedProtocol && connection == expectedConnection;
    }

    private void postIfCurrent(
            long generation,
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection,
            Runnable action) {
        main.post(() -> {
            if (!snapshotGenerationGate.isLatestOwner()) return;
            if (!snapshotGenerationGate.isCurrent(generation)) return;
            if (TRANSITIONS.state() != DurableConnectionTransitionCoordinator.State.IDLE) return;
            if (!isCurrentConnection(expectedProtocol, expectedConnection)) return;
            action.run();
        });
    }

    private static void notifyPreviousStartedActivity() {
        STARTED_ACTIVITIES.dispatch(activity -> activity.main.post(() -> {
            if (!STARTED_ACTIVITIES.isCurrent(activity)) return;
            activity.reclaimStartedOwnershipAndReconcile();
        }));
    }

    private void reclaimStartedOwnershipAndReconcile() {
        if (!STARTED_ACTIVITIES.isCurrent(this)) return;
        snapshotGenerationGate.claimLatestOwner();
        DurableConnectionTransitionCoordinator.State state = TRANSITIONS.state();
        adoptTransitionState();
        if (state == DurableConnectionTransitionCoordinator.State.IDLE) {
            reconcileDurableConnection(null);
        }
    }

    private static void notifyStartedActivityOfTransitionCompletion(
            DurableConnectionTransitionCoordinator.Completion completion) {
        STARTED_ACTIVITIES.dispatch(activity -> activity.main.post(() -> {
            if (!STARTED_ACTIVITIES.isCurrent(activity)) return;
            if (!activity.snapshotGenerationGate.isLatestOwner()) return;
            activity.handleTransitionCompletion(completion);
        }));
    }

    private void handleTransitionCompletion(
            DurableConnectionTransitionCoordinator.Completion completion) {
        adoptTransitionState();
        if (completion.failure() == null) {
            reconcileDurableConnection(completion.notice());
            return;
        }
        reconcileDurableConnection(null);
        if (completion.state() == DurableConnectionTransitionCoordinator.State.PAIRING) {
            setPairing(false);
            connectError.setText(safeError(completion.failure()));
        } else {
            setDisconnecting(false);
            statusText.setText(safeError(completion.failure()));
        }
    }

    private void reconcileDurableConnection(String notice) {
        if (!STARTED_ACTIVITIES.isCurrent(this)) return;
        if (!snapshotGenerationGate.isLatestOwner()) return;
        ensureCurrentSnapshotGeneration();
        ConnectionStore.Connection saved = connectionStore.load();
        if (saved == null) {
            if (connection == null && notice == null) return;
            PushRegistration.cancel(this);
            disconnectButton.setEnabled(true);
            codeInput.setText("");
            refreshInFlight = false;
            refreshButton.setEnabled(true);
            showConnect();
            if (notice != null) {
                connectError.setText(notice.isEmpty()
                        ? "已安全断开并撤销此设备"
                        : notice);
            }
            return;
        }
        setPairing(false);
        hideKeyboard();
        if (!sameConnection(connection, saved)) {
            activate(saved);
        } else if (notice != null) {
            refreshInFlight = false;
            refreshButton.setEnabled(true);
            refreshSessions(true);
        }
    }

    private void adoptTransitionState() {
        DurableConnectionTransitionCoordinator.State state = TRANSITIONS.state();
        if (state == DurableConnectionTransitionCoordinator.State.PAIRING) {
            setPairing(true);
            return;
        }
        if (state == DurableConnectionTransitionCoordinator.State.DISCONNECTING) {
            setDisconnecting(true);
            return;
        }
        connectButton.setEnabled(true);
        connectButton.setText("安全配对");
        setDisconnecting(false);
    }

    private void setDisconnecting(boolean disconnecting) {
        disconnectButton.setEnabled(!disconnecting);
        refreshButton.setEnabled(!disconnecting);
        if (disconnecting) statusText.setText("正在安全断开");
    }

    private void ensureCurrentSnapshotGeneration() {
        long generation = snapshotGenerationGate.capture();
        if (snapshotGenerationGate.isCurrent(generation)) return;
        snapshotGenerationGate.close();
        snapshotGenerationGate = SessionSnapshotGenerationGate.open();
    }

    private static boolean sameConnection(
            ConnectionStore.Connection first, ConnectionStore.Connection second) {
        if (first == second) return true;
        if (first == null || second == null) return false;
        BridgeConfig firstConfig = first.config();
        BridgeConfig secondConfig = second.config();
        return Objects.equals(firstConfig.baseUrl(), secondConfig.baseUrl())
                && Objects.equals(firstConfig.fingerprint(), secondConfig.fingerprint())
                && Objects.equals(firstConfig.deviceName(), secondConfig.deviceName())
                && Objects.equals(first.token(), second.token())
                && first.scope() == second.scope()
                && sameWakeRelay(first.wakeRelay(), second.wakeRelay());
    }

    private static boolean sameWakeRelay(
            Models.WakeRelayConfig first, Models.WakeRelayConfig second) {
        if (first == second) return true;
        if (first == null || second == null) return false;
        return Objects.equals(first.baseUrl(), second.baseUrl())
                && Objects.equals(first.channelId(), second.channelId())
                && Objects.equals(first.subscriberToken(), second.subscriberToken())
                && Objects.equals(first.wakeKey(), second.wakeKey());
    }

    private void writeSnapshotSafely(
            ConnectionStore.Connection activeConnection,
            List<Models.Session> sessions,
            long savedAtMillis) {
        try {
            snapshotStore.write(activeConnection, sessions, savedAtMillis);
        } catch (RuntimeException ignored) {
            // The live response remains authoritative when local caching is unavailable.
        }
    }

    private SessionSnapshot readSnapshotSafely(
            ConnectionStore.Connection activeConnection, long nowMillis) {
        try {
            return snapshotStore.read(activeConnection, nowMillis);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private void clearSnapshotSafely() {
        try {
            snapshotStore.clear();
        } catch (RuntimeException ignored) {
            // Connection lifecycle must continue even when cache cleanup is unavailable.
        }
    }

    private void renderSessions(List<Models.Session> sessions) {
        sessionsContainer.removeAllViews();
        if (sessions.isEmpty()) {
            TextView empty = text("最近没有 Agent 会话", 14, color(R.color.muted));
            empty.setGravity(android.view.Gravity.CENTER);
            empty.setPadding(0, dp(48), 0, dp(48));
            sessionsContainer.addView(empty);
            return;
        }
        for (Models.Session session : sessions) {
            sessionsContainer.addView(sessionCard(session));
        }
    }

    private View sessionCard(Models.Session session) {
        LinearLayout card = vertical();
        LinearLayout.LayoutParams cardParams = matchWidthWrap();
        cardParams.bottomMargin = dp(10);
        card.setLayoutParams(cardParams);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(R.color.surface));
        background.setCornerRadius(dp(8));
        background.setStroke(dp(session.needsAttention() ? 2 : 1),
                color(session.needsAttention() ? R.color.attention : R.color.line));
        card.setBackground(background);

        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        TextView project = text(session.project(), 16, color(R.color.ink));
        project.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        heading.addView(project, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView agent = text(session.agent(), 11, color(R.color.muted));
        heading.addView(agent);
        card.addView(heading);

        String prefix = session.needsAttention() ? "需要处理 · " : "";
        TextView meta = text(prefix + session.status() + " · " + session.lastActivityAt(), 12, color(R.color.muted));
        meta.setPadding(0, dp(7), 0, 0);
        card.addView(meta);

        for (Models.Action action : session.actions()) {
            card.addView(actionPanel(action));
        }
        if (session.canMessage()) {
            card.addView(messagePanel(session));
        }
        return card;
    }

    private View actionPanel(Models.Action action) {
        LinearLayout panel = vertical();
        panel.setPadding(0, dp(12), 0, 0);
        TextView title = text(action.operation(), 13, color(R.color.ink));
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        panel.addView(title);
        panel.addView(text(action.summary(), 12, color(R.color.muted)));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setPadding(0, dp(8), 0, 0);
        Button deny = button("拒绝", false);
        Button allow = button("允许一次", true);
        deny.setOnClickListener(view -> resolve(action, "deny", deny, allow));
        allow.setOnClickListener(view -> resolve(action, "allow_once", deny, allow));
        buttons.addView(deny, weightedButton());
        LinearLayout.LayoutParams allowParams = weightedButton();
        allowParams.leftMargin = dp(8);
        buttons.addView(allow, allowParams);
        panel.addView(buttons);
        return panel;
    }

    private View messagePanel(Models.Session session) {
        LinearLayout panel = vertical();
        panel.setPadding(0, dp(12), 0, 0);
        EditText draft = new EditText(this);
        draft.setHint("给这个 Agent 会话发送跟进");
        draft.setMinHeight(dp(72));
        draft.setMaxLines(5);
        draft.setBackgroundResource(R.drawable.input_background);
        draft.setTextColor(color(R.color.ink));
        draft.setHintTextColor(Color.rgb(147, 164, 184));
        panel.addView(draft, matchWidthWrap());
        Button send = button("发送跟进", true);
        LinearLayout.LayoutParams sendParams = matchWidthWrap();
        sendParams.topMargin = dp(8);
        panel.addView(send, sendParams);
        send.setOnClickListener(view -> send(session, draft, send));
        return panel;
    }

    private void resolve(Models.Action action, String decision, Button first, Button second) {
        first.setEnabled(false);
        second.setEnabled(false);
        MobileProtocol current = protocol;
        ConnectionStore.Connection currentConnection = connection;
        long generation = snapshotGenerationGate.capture();
        network.execute(() -> {
            try {
                current.resolveApproval(action, decision);
                postIfCurrent(generation, current, currentConnection, () -> refreshSessions(true));
            } catch (Exception error) {
                postIfCurrent(generation, current, currentConnection, () -> {
                    first.setEnabled(true);
                    second.setEnabled(true);
                    statusText.setText(safeError(error));
                });
            }
        });
    }

    private void send(Models.Session session, EditText draft, Button send) {
        String message = draft.getText().toString().trim();
        if (message.isEmpty()) return;
        send.setEnabled(false);
        MobileProtocol current = protocol;
        ConnectionStore.Connection currentConnection = connection;
        long generation = snapshotGenerationGate.capture();
        network.execute(() -> {
            try {
                String state = current.sendMessage(session, message);
                postIfCurrent(generation, current, currentConnection, () -> {
                    draft.setText("");
                    send.setEnabled(true);
                    statusText.setText("delivered".equals(state) ? "跟进已送达" : "跟进已进入队列");
                    refreshSessions(false);
                });
            } catch (Exception error) {
                postIfCurrent(generation, current, currentConnection, () -> {
                    send.setEnabled(true);
                    statusText.setText(safeError(error));
                });
            }
        });
    }

    private void setPairing(boolean pairing) {
        connectButton.setEnabled(!pairing);
        connectButton.setText(pairing ? "正在安全配对" : "安全配对");
        statusText.setText(pairing ? "正在验证证书" : "等待连接");
    }

    private void hideKeyboard() {
        View focused = getCurrentFocus();
        if (focused != null) {
            ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE))
                    .hideSoftInputFromWindow(focused.getWindowToken(), 0);
        }
    }

    private LinearLayout vertical() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    private Button button(String label, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setHeight(dp(42));
        if (primary) {
            button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(color(R.color.primary)));
            button.setTextColor(color(R.color.surface));
        } else {
            button.setBackgroundResource(R.drawable.button_secondary);
            button.setTextColor(color(R.color.ink));
        }
        return button;
    }

    private LinearLayout.LayoutParams weightedButton() {
        return new LinearLayout.LayoutParams(0, dp(42), 1);
    }

    private LinearLayout.LayoutParams matchWidthWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int color(int resource) {
        return getColor(resource);
    }

    private static String safeError(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) return "操作失败，请检查 Mac 是否在线";
        return message.length() <= 120 ? message : message.substring(0, 120);
    }
}
