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
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4103;
    private static final String SELECTED_ROLE_STATE = "selected_role";
    private static final StartedOwnerRegistry<MainActivity> STARTED_ACTIVITIES =
            new StartedOwnerRegistry<>();
    private static final DurableConnectionTransitionCoordinator TRANSITIONS =
            new DurableConnectionTransitionCoordinator(
                    MainActivity::notifyStartedActivityOfTransitionCompletion);
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Map<String, List<Models.ConversationMessage>> recentConversationBySessionId =
            new HashMap<>();
    private final Map<String, String> messageDraftBySessionId = new HashMap<>();
    private final Set<String> sendingSessionIds = new HashSet<>();
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
    private MobileRoleDashboard.Role selectedRole = MobileRoleDashboard.Role.HUMI;
    private final Map<MobileRoleDashboard.Role, LinearLayout> roleTabs =
            new EnumMap<>(MobileRoleDashboard.Role.class);
    private final Map<MobileRoleDashboard.Role, TextView> roleTabLabels =
            new EnumMap<>(MobileRoleDashboard.Role.class);
    private LinearLayout connectPanel;
    private LinearLayout sessionPanel;
    private LinearLayout roleNavigation;
    private LinearLayout roleHero;
    private LinearLayout roleContent;
    private LinearLayout hexaDetailContent;
    private LinearLayout sessionsContainer;
    private ImageView roleHeroMascot;
    private TextView roleKicker;
    private TextView roleTitle;
    private TextView roleDescription;
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
    private List<Models.Session> renderedSessions = List.of();
    private String expandedConversationSessionId;
    private String loadingConversationSessionId;
    private String conversationErrorSessionId;
    private String conversationErrorText = "";
    private SharedPreferences pushPreferences;
    private final SharedPreferences.OnSharedPreferenceChangeListener pushStateListener =
            (preferences, key) -> main.post(this::updatePushStatus);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            selectedRole = MobileRoleDashboard.Role.fromId(
                    state.getString(SELECTED_ROLE_STATE, MobileRoleDashboard.Role.HUMI.id()));
        }
        setContentView(R.layout.activity_main);
        applySystemBarInsets(findViewById(R.id.rootLayout));
        bindViews();
        bindRoleTabs();
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
    protected void onSaveInstanceState(Bundle outState) {
        outState.putString(SELECTED_ROLE_STATE, selectedRole.id());
        super.onSaveInstanceState(outState);
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
                DurableConnectionTransitionCoordinator.Completion completion =
                        TRANSITIONS.claimCompletion();
                if (completion == null) {
                    reconcileDurableConnection(null);
                } else {
                    handleTransitionCompletion(completion);
                }
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
        MainActivity fallback = STARTED_ACTIVITIES.stop(this);
        if (fallback != null) notifyPreviousStartedActivity(fallback);
        pushPreferences.unregisterOnSharedPreferenceChangeListener(pushStateListener);
        main.removeCallbacks(poll);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        recentConversationBySessionId.clear();
        messageDraftBySessionId.clear();
        sendingSessionIds.clear();
        collapseConversationDisclosure();
        renderedSessions = List.of();
        snapshotGenerationGate.close();
        network.shutdownNow();
        super.onDestroy();
    }

    private void bindViews() {
        connectPanel = findViewById(R.id.connectPanel);
        sessionPanel = findViewById(R.id.sessionPanel);
        roleNavigation = findViewById(R.id.roleNavigation);
        roleHero = findViewById(R.id.roleHero);
        roleContent = findViewById(R.id.roleContent);
        hexaDetailContent = findViewById(R.id.hexaDetailContent);
        sessionsContainer = findViewById(R.id.sessionsContainer);
        roleHeroMascot = findViewById(R.id.roleHeroMascot);
        roleKicker = findViewById(R.id.roleKicker);
        roleTitle = findViewById(R.id.roleTitle);
        roleDescription = findViewById(R.id.roleDescription);
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

    private void bindRoleTabs() {
        roleTabs.put(MobileRoleDashboard.Role.HUMI, findViewById(R.id.humiTab));
        roleTabs.put(MobileRoleDashboard.Role.HYPE, findViewById(R.id.hypeTab));
        roleTabs.put(MobileRoleDashboard.Role.HUSH, findViewById(R.id.hushTab));
        roleTabs.put(MobileRoleDashboard.Role.HEXA, findViewById(R.id.hexaTab));
        roleTabLabels.put(MobileRoleDashboard.Role.HUMI, findViewById(R.id.humiTabLabel));
        roleTabLabels.put(MobileRoleDashboard.Role.HYPE, findViewById(R.id.hypeTabLabel));
        roleTabLabels.put(MobileRoleDashboard.Role.HUSH, findViewById(R.id.hushTabLabel));
        roleTabLabels.put(MobileRoleDashboard.Role.HEXA, findViewById(R.id.hexaTabLabel));

        findViewById(R.id.humiTab).setOnClickListener(
                view -> selectRole(MobileRoleDashboard.Role.HUMI));
        findViewById(R.id.hypeTab).setOnClickListener(
                view -> selectRole(MobileRoleDashboard.Role.HYPE));
        findViewById(R.id.hushTab).setOnClickListener(
                view -> selectRole(MobileRoleDashboard.Role.HUSH));
        findViewById(R.id.hexaTab).setOnClickListener(
                view -> selectRole(MobileRoleDashboard.Role.HEXA));
    }

    private void selectRole(MobileRoleDashboard.Role role) {
        if (role == null || role == selectedRole) return;
        if (role != MobileRoleDashboard.Role.HEXA && expandedConversationSessionId != null) {
            collapseConversationDisclosure();
            renderSessions(renderedSessions);
        }
        selectedRole = role;
        renderSelectedRole();
        ScrollView scroll = findViewById(R.id.rootScroll);
        scroll.smoothScrollTo(0, 0);
    }

    private void renderSelectedRole() {
        if (roleContent == null) return;
        int accent = color(roleAccent(selectedRole));
        int soft = color(roleSoft(selectedRole));
        for (MobileRoleDashboard.Role role : MobileRoleDashboard.roles()) {
            boolean active = role == selectedRole;
            LinearLayout tab = roleTabs.get(role);
            TextView label = roleTabLabels.get(role);
            if (tab != null) {
                tab.setBackground(active
                        ? roundedSurface(color(roleSoft(role)), color(roleAccent(role)), 8)
                        : getDrawable(R.drawable.role_tab_idle));
                tab.setSelected(active);
            }
            if (label != null) {
                label.setTextColor(active ? color(roleAccent(role)) : color(R.color.muted));
                label.setTypeface(Typeface.DEFAULT, active ? Typeface.BOLD : Typeface.NORMAL);
            }
        }

        roleHero.setBackground(roundedSurface(soft, accent, 8));
        roleHeroMascot.setImageResource(roleMascot(selectedRole));
        roleKicker.setText(
                selectedRole.displayName().toUpperCase(Locale.ROOT)
                        + " · "
                        + roleKicker(selectedRole));
        roleKicker.setTextColor(accent);
        roleTitle.setText(roleTitle(selectedRole));
        roleDescription.setText(selectedRole.purpose());
        roleContent.removeAllViews();
        hexaDetailContent.setVisibility(
                selectedRole == MobileRoleDashboard.Role.HEXA ? View.VISIBLE : View.GONE);

        switch (selectedRole) {
            case HUMI -> renderHumiRole(accent, soft);
            case HYPE -> renderCapabilityRole(
                    "你的知识仍安静地留在 Mac 上",
                    "这台手机还没有获得个人知识摘要权限。Hype 不会把本地记忆、技能文件或路径偷偷同步过来。",
                    "等桌面端提供经过解释的只读摘要后，这里会显示值得保存的偏好、工作流和知识缺口。",
                    accent,
                    soft);
            case HUSH -> renderCapabilityRole(
                    "消息内容没有同步到手机",
                    "Hush 仍在 Mac 上按朋友、工作和家庭整理通知；没有明确授权时，手机只会说明能力边界。",
                    "未来的移动摘要会继续保持只读，并由你主动决定是否查看具体消息。",
                    accent,
                    soft);
            case HEXA -> renderHexaRole(accent, soft);
        }
    }

    private void renderHumiRole(int accent, int soft) {
        MobileRoleDashboard.Summary summary = MobileRoleDashboard.summarize(renderedSessions);
        roleContent.addView(roleInfoCard(summary.title(), summary.detail(), accent, soft));
        if (summary.hasAttention()) {
            Button action = roleAction("去 Hexa 查看并决定", accent);
            action.setOnClickListener(view -> selectRole(MobileRoleDashboard.Role.HEXA));
            LinearLayout.LayoutParams actionParams = matchWidthWrap();
            actionParams.bottomMargin = dp(8);
            roleContent.addView(action, actionParams);
        }

        if (renderedSessions.isEmpty()) return;
        roleContent.addView(roleSectionLabel("最近在做什么", accent));
        int visibleCount = Math.min(3, renderedSessions.size());
        for (int index = 0; index < visibleCount; index++) {
            Models.Session session = renderedSessions.get(index);
            int cardAccent = session.needsAttention() ? color(R.color.attention) : accent;
            String detail = session.agent() + " · " + session.status() + " · " + session.lastActivityAt();
            roleContent.addView(roleInfoCard(session.project(), detail, cardAccent, color(R.color.surface)));
        }
        if (renderedSessions.size() > visibleCount) {
            TextView remaining = text(
                    "另外 " + (renderedSessions.size() - visibleCount) + " 个会话可在 Hexa 查看",
                    11,
                    color(R.color.muted));
            remaining.setPadding(dp(2), dp(2), 0, dp(8));
            roleContent.addView(remaining);
        }
    }

    private void renderCapabilityRole(
            String title,
            String detail,
            String nextStep,
            int accent,
            int soft) {
        roleContent.addView(roleInfoCard(title, detail, accent, soft));
        roleContent.addView(roleSectionLabel("接下来", accent));
        roleContent.addView(roleInfoCard("保持真实和可控", nextStep, accent, color(R.color.surface)));
    }

    private void renderHexaRole(int accent, int soft) {
        MobileRoleDashboard.Summary summary = MobileRoleDashboard.summarize(renderedSessions);
        String title = summary.sessionCount() == 0
                ? "暂时没有 Agent 会话"
                : summary.sessionCount() + " 个 Agent 会话在视野中";
        String detail = summary.hasAttention()
                ? summary.attentionCount() + " 件事需要你处理，详细控制保留在下方。"
                : "目前没有等待确认的操作，可以继续查看最近进展。";
        roleContent.addView(roleInfoCard(title, detail, accent, soft));
    }

    private TextView roleSectionLabel(String value, int accent) {
        TextView label = text(value, 13, accent);
        label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        label.setPadding(dp(2), dp(8), 0, dp(8));
        return label;
    }

    private View roleInfoCard(String title, String detail, int accent, int fill) {
        LinearLayout card = vertical();
        LinearLayout.LayoutParams params = matchWidthWrap();
        params.bottomMargin = dp(8);
        card.setLayoutParams(params);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackground(roundedSurface(fill, accent, 8));

        TextView heading = text(title, 15, color(R.color.ink));
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        card.addView(heading);
        TextView body = text(detail, 12, color(R.color.muted));
        body.setPadding(0, dp(5), 0, 0);
        card.addView(body);
        return card;
    }

    private Button roleAction(String label, int accent) {
        Button action = new Button(this);
        action.setText(label);
        action.setAllCaps(false);
        action.setMinHeight(dp(48));
        action.setTextColor(color(R.color.surface));
        action.setTextSize(13);
        action.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        action.setBackgroundTintList(android.content.res.ColorStateList.valueOf(accent));
        return action;
    }

    private GradientDrawable roundedSurface(int fill, int stroke, int radiusDp) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(fill);
        background.setCornerRadius(dp(radiusDp));
        background.setStroke(dp(1), (stroke & 0x00FFFFFF) | 0x66000000);
        return background;
    }

    private int roleAccent(MobileRoleDashboard.Role role) {
        return switch (role) {
            case HUMI -> R.color.humi_accent;
            case HYPE -> R.color.hype_accent;
            case HUSH -> R.color.hush_accent;
            case HEXA -> R.color.hexa_accent;
        };
    }

    private int roleSoft(MobileRoleDashboard.Role role) {
        return switch (role) {
            case HUMI -> R.color.humi_soft;
            case HYPE -> R.color.hype_soft;
            case HUSH -> R.color.hush_soft;
            case HEXA -> R.color.hexa_soft;
        };
    }

    private int roleMascot(MobileRoleDashboard.Role role) {
        return switch (role) {
            case HUMI -> R.drawable.mascot_humi;
            case HYPE -> R.drawable.mascot_hype;
            case HUSH -> R.drawable.mascot_hush;
            case HEXA -> R.drawable.mascot_hexa;
        };
    }

    private String roleKicker(MobileRoleDashboard.Role role) {
        return switch (role) {
            case HUMI -> "今天";
            case HYPE -> "个人知识";
            case HUSH -> "消息";
            case HEXA -> "Agent 监工";
        };
    }

    private String roleTitle(MobileRoleDashboard.Role role) {
        return switch (role) {
            case HUMI -> "我替你留意今天的重要进展";
            case HYPE -> "你的工作方式正在成形";
            case HUSH -> "值得留意的消息，由你决定";
            case HEXA -> "电脑离开后，我替你看着";
        };
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarInsets(View root) {
        int baseLeft = root.getPaddingLeft();
        int baseTop = root.getPaddingTop();
        int baseRight = root.getPaddingRight();
        int baseBottom = root.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int leftInset = insets.getSystemWindowInsetLeft();
            int topInset = insets.getSystemWindowInsetTop();
            int rightInset = insets.getSystemWindowInsetRight();
            int bottomInset = insets.getSystemWindowInsetBottom();
            view.setPadding(
                    baseLeft + leftInset,
                    baseTop + topInset,
                    baseRight + rightInset,
                    baseBottom + bottomInset);
            return insets;
        });
        root.requestApplyInsets();
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
        clearConversationState();
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
        recentConversationBySessionId.clear();
        messageDraftBySessionId.clear();
        sendingSessionIds.clear();
        collapseConversationDisclosure();
        renderedSessions = List.of();
        connection = saved;
        protocol = new MobileProtocol(saved.config(), saved.token(), saved.scope());
        connectPanel.setVisibility(View.GONE);
        sessionPanel.setVisibility(View.VISIBLE);
        roleNavigation.setVisibility(View.VISIBLE);
        String route = saved.config().isTailnet() ? "Tailnet · " : "";
        scopeText.setText(saved.scope() == Models.Scope.CONTROL
                ? route + "可控制"
                : route + "只读");
        statusText.setText("正在同步");
        syncMonitorState();
        reportForegroundPresence();
        PushRegistration.refresh(this);
        updatePushStatus();
        renderSelectedRole();
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
        recentConversationBySessionId.clear();
        messageDraftBySessionId.clear();
        sendingSessionIds.clear();
        collapseConversationDisclosure();
        renderedSessions = List.of();
        protocol = null;
        connection = null;
        connectPanel.setVisibility(View.VISIBLE);
        sessionPanel.setVisibility(View.GONE);
        roleNavigation.setVisibility(View.GONE);
        statusText.setText("等待连接");
        sessionsContainer.removeAllViews();
        if (monitorStore != null && monitorStore.isEnabled()) disableMonitor();
    }

    private void disconnect() {
        MobileProtocol current = protocol;
        if (current == null || connection == null) return;
        List<Models.Session> sessions = renderedSessions;
        messageDraftBySessionId.clear();
        sendingSessionIds.clear();
        clearConversationState();
        renderSessions(sessions);
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
                if (!written) {
                    postStaleRefreshReset(
                            refreshGeneration, current, currentConnection);
                    return;
                }
                postRefreshIfCurrent(refreshGeneration, current, currentConnection, () -> {
                    refreshInFlight = false;
                    refreshButton.setEnabled(true);
                    statusText.setText("刚刚同步");
                    renderSessions(page.sessions());
                });
            } catch (Exception error) {
                if (OfflineFallbackPolicy.isAuthorizationRevoked(error)) {
                    clearRevokedConnection(
                            refreshGeneration, current, currentConnection);
                    return;
                }
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
                postRefreshIfCurrent(refreshGeneration, current, currentConnection, () -> {
                    refreshInFlight = false;
                    refreshButton.setEnabled(true);
                    if (snapshot == null) {
                        statusText.setText("Mac 离线");
                        renderUnavailableSessions();
                        return;
                    }
                    statusText.setText(
                            SessionSnapshotCodec.ageCopy(snapshot.savedAtMillis(), nowMillis));
                    renderSessions(snapshot.sessions());
                });
            }
        });
    }

    private void clearRevokedConnection(
            long generation,
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection) {
        boolean cleared = snapshotGenerationGate.callIfCurrent(generation, () -> {
            if (!isCurrentConnection(expectedProtocol, expectedConnection)) return false;
            clearSnapshotSafely();
            connectionStore.clear();
            return true;
        }, false);
        if (!cleared) {
            postStaleRefreshReset(generation, expectedProtocol, expectedConnection);
            return;
        }
        postRefreshIfCurrent(generation, expectedProtocol, expectedConnection, () -> {
            refreshInFlight = false;
            refreshButton.setEnabled(true);
            PushRegistration.cancel(this);
            showConnect();
            connectError.setText("移动连接已失效，请重新配对");
        });
    }

    private void postRefreshIfCurrent(
            long generation,
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection,
            Runnable action) {
        main.post(() -> {
            if (!snapshotGenerationGate.isLatestOwner()
                    || !snapshotGenerationGate.isCurrent(generation)
                    || TRANSITIONS.state() != DurableConnectionTransitionCoordinator.State.IDLE
                    || !isCurrentConnection(expectedProtocol, expectedConnection)) {
                resetStaleRefreshState(generation, expectedProtocol, expectedConnection);
                return;
            }
            action.run();
        });
    }

    private void postStaleRefreshReset(
            long generation,
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection) {
        main.post(() -> resetStaleRefreshState(
                generation, expectedProtocol, expectedConnection));
    }

    private void resetStaleRefreshState(
            long generation,
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection) {
        refreshInFlight = false;
        if (!snapshotGenerationGate.isLatestOwner()) return;
        if (!snapshotGenerationGate.isCurrent(generation)) return;
        if (TRANSITIONS.state() != DurableConnectionTransitionCoordinator.State.IDLE) return;
        if (!isCurrentConnection(expectedProtocol, expectedConnection)) return;
        refreshButton.setEnabled(true);
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

    private static void notifyPreviousStartedActivity(MainActivity fallback) {
        fallback.main.post(() -> {
            if (!STARTED_ACTIVITIES.isCurrent(fallback)) return;
            fallback.reclaimStartedOwnershipAndReconcile();
        });
    }

    private void reclaimStartedOwnershipAndReconcile() {
        if (!STARTED_ACTIVITIES.isCurrent(this)) return;
        snapshotGenerationGate.claimLatestOwner();
        DurableConnectionTransitionCoordinator.State state = TRANSITIONS.state();
        adoptTransitionState();
        if (state == DurableConnectionTransitionCoordinator.State.IDLE) {
            DurableConnectionTransitionCoordinator.Completion completion =
                    TRANSITIONS.claimCompletion();
            if (completion == null) {
                reconcileDurableConnection(null);
            } else {
                handleTransitionCompletion(completion);
            }
        }
    }

    private static void notifyStartedActivityOfTransitionCompletion(
            DurableConnectionTransitionCoordinator.Completion completion) {
        STARTED_ACTIVITIES.dispatch(activity -> activity.main.post(() -> {
            if (!STARTED_ACTIVITIES.isCurrent(activity)) return;
            if (!activity.snapshotGenerationGate.isLatestOwner()) return;
            DurableConnectionTransitionCoordinator.Completion claimed =
                    TRANSITIONS.claimCompletion(completion);
            if (claimed == null) return;
            activity.handleTransitionCompletion(claimed);
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
            refreshInFlight = false;
            refreshButton.setEnabled(true);
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

    private void clearConversationState() {
        recentConversationBySessionId.clear();
        collapseConversationDisclosure();
        renderedSessions = List.of();
    }

    private void collapseConversationDisclosure() {
        expandedConversationSessionId = null;
        loadingConversationSessionId = null;
        conversationErrorSessionId = null;
        conversationErrorText = "";
        syncConversationPrivacy();
    }

    private void syncConversationPrivacy() {
        if (expandedConversationSessionId == null) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private void syncConversationDisclosureWithSessions(List<Models.Session> sessions) {
        renderedSessions = List.copyOf(sessions);
        if (expandedConversationSessionId == null) return;
        for (Models.Session session : renderedSessions) {
            if (session.canReadConversation() && expandedConversationSessionId.equals(session.id())) {
                return;
            }
        }
        collapseConversationDisclosure();
    }

    private void renderSessions(List<Models.Session> sessions) {
        syncConversationDisclosureWithSessions(sessions);
        sessionsContainer.removeAllViews();
        if (sessions.isEmpty()) {
            TextView empty = text("最近没有 Agent 会话", 14, color(R.color.muted));
            empty.setGravity(android.view.Gravity.CENTER);
            empty.setPadding(0, dp(48), 0, dp(48));
            sessionsContainer.addView(empty);
            renderSelectedRole();
            return;
        }
        for (Models.Session session : sessions) {
            sessionsContainer.addView(sessionCard(session));
        }
        renderSelectedRole();
    }

    private void renderUnavailableSessions() {
        renderedSessions = List.of();
        collapseConversationDisclosure();
        sessionsContainer.removeAllViews();
        TextView unavailable = text("无法确认当前会话状态，请恢复连接后重试", 14, color(R.color.muted));
        unavailable.setGravity(android.view.Gravity.CENTER);
        unavailable.setPadding(0, dp(48), 0, dp(48));
        sessionsContainer.addView(unavailable);
        renderSelectedRole();
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
        if (session.canReadConversation()) {
            card.addView(conversationPanel(session));
        }
        if (session.canMessage()) {
            card.addView(messagePanel(session));
        }
        return card;
    }

    private View conversationPanel(Models.Session session) {
        LinearLayout panel = vertical();
        panel.setPadding(0, dp(12), 0, 0);

        boolean expanded = session.id().equals(expandedConversationSessionId);
        Button toggle = button(expanded ? "收起最近对话" : "查看最近对话", false);
        panel.addView(toggle, matchWidthWrap());
        toggle.setOnClickListener(view -> toggleConversation(session));
        if (!expanded) return panel;

        if (session.id().equals(loadingConversationSessionId)) {
            TextView loading = text("正在读取最近对话", 12, color(R.color.muted));
            loading.setPadding(0, dp(8), 0, 0);
            panel.addView(loading);
            return panel;
        }

        if (session.id().equals(conversationErrorSessionId)) {
            TextView error = text(conversationErrorText, 12, color(R.color.attention));
            error.setPadding(0, dp(8), 0, 0);
            panel.addView(error);
            Button retry = button("重试", false);
            LinearLayout.LayoutParams retryParams = matchWidthWrap();
            retryParams.topMargin = dp(8);
            retry.setOnClickListener(view -> retryConversation(session));
            panel.addView(retry, retryParams);
            return panel;
        }

        List<Models.ConversationMessage> messages = recentConversationBySessionId.get(session.id());
        if (messages == null || messages.isEmpty()) {
            TextView unavailable = text("最近对话暂时不可用", 12, color(R.color.muted));
            unavailable.setPadding(0, dp(8), 0, 0);
            panel.addView(unavailable);
            return panel;
        }

        LinearLayout transcript = vertical();
        transcript.setPadding(0, dp(8), 0, 0);
        for (Models.ConversationMessage message : messages) {
            transcript.addView(conversationRow(message));
        }
        panel.addView(transcript);
        return panel;
    }

    private void toggleConversation(Models.Session session) {
        if (session == null || !session.canReadConversation()) return;
        String sessionId = session.id();
        if (sessionId.equals(expandedConversationSessionId)) {
            collapseConversationDisclosure();
            renderSessions(renderedSessions);
            return;
        }
        expandedConversationSessionId = sessionId;
        syncConversationPrivacy();
        conversationErrorSessionId = null;
        conversationErrorText = "";
        if (recentConversationBySessionId.containsKey(sessionId)) {
            loadingConversationSessionId = null;
            renderSessions(renderedSessions);
            return;
        }
        loadingConversationSessionId = sessionId;
        renderSessions(renderedSessions);
        loadConversation(session);
    }

    private void retryConversation(Models.Session session) {
        if (session == null || !session.id().equals(expandedConversationSessionId)) return;
        loadingConversationSessionId = session.id();
        conversationErrorSessionId = null;
        conversationErrorText = "";
        renderSessions(renderedSessions);
        loadConversation(session);
    }

    private View conversationRow(Models.ConversationMessage message) {
        LinearLayout row = vertical();
        LinearLayout.LayoutParams params = matchWidthWrap();
        params.topMargin = dp(8);
        row.setLayoutParams(params);
        row.setPadding(dp(10), dp(10), dp(10), dp(10));
        row.setMinimumHeight(dp(44));

        GradientDrawable background = new GradientDrawable();
        background.setCornerRadius(dp(8));
        boolean user = message.role() == Models.ConversationRole.USER;
        background.setColor(color(user ? R.color.primary_soft : R.color.surface));
        background.setStroke(dp(1), color(user ? R.color.primary : R.color.line));
        row.setBackground(background);

        TextView role = text(user ? "你" : "Agent", 11, color(user ? R.color.primary : R.color.muted));
        role.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        row.addView(role);

        TextView body = text(message.text(), 13, color(R.color.ink));
        body.setPadding(0, dp(4), 0, 0);
        row.addView(body);
        return row;
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
        draft.setText(messageDraftBySessionId.getOrDefault(session.id(), ""));
        draft.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                if (value.length() == 0) {
                    messageDraftBySessionId.remove(session.id());
                } else {
                    messageDraftBySessionId.put(session.id(), value.toString());
                }
            }
            @Override public void afterTextChanged(Editable value) {}
        });
        panel.addView(draft, matchWidthWrap());
        Button send = button("发送跟进", true);
        boolean sending = sendingSessionIds.contains(session.id());
        draft.setEnabled(!sending);
        send.setEnabled(!sending);
        LinearLayout.LayoutParams sendParams = matchWidthWrap();
        sendParams.topMargin = dp(8);
        panel.addView(send, sendParams);
        send.setOnClickListener(view -> send(session, draft, send));
        return panel;
    }

    private void loadConversation(Models.Session session) {
        MobileProtocol current = protocol;
        ConnectionStore.Connection currentConnection = connection;
        if (current == null || currentConnection == null) return;
        String sessionId = session.id();
        long generation = snapshotGenerationGate.capture();
        network.execute(() -> {
            try {
                List<Models.ConversationMessage> messages = current.conversation(session);
                postConversationIfCurrent(
                        generation,
                        current,
                        currentConnection,
                        sessionId,
                        () -> {
                            recentConversationBySessionId.put(sessionId, List.copyOf(messages));
                            loadingConversationSessionId = null;
                            conversationErrorSessionId = null;
                            conversationErrorText = "";
                            renderSessions(renderedSessions);
                        });
            } catch (Exception error) {
                if (OfflineFallbackPolicy.isAuthorizationRevoked(error)) {
                    clearRevokedConnection(generation, current, currentConnection);
                    return;
                }
                postConversationIfCurrent(
                        generation,
                        current,
                        currentConnection,
                        sessionId,
                        () -> {
                            loadingConversationSessionId = null;
                            conversationErrorSessionId = sessionId;
                            conversationErrorText = safeError(error);
                            renderSessions(renderedSessions);
                        });
            }
        });
    }

    private void postConversationIfCurrent(
            long generation,
            MobileProtocol expectedProtocol,
            ConnectionStore.Connection expectedConnection,
            String expectedSessionId,
            Runnable action) {
        main.post(() -> {
            if (!snapshotGenerationGate.isLatestOwner()) return;
            if (!snapshotGenerationGate.isCurrent(generation)) return;
            if (TRANSITIONS.state() != DurableConnectionTransitionCoordinator.State.IDLE) return;
            if (!isCurrentConnection(expectedProtocol, expectedConnection)) return;
            if (!expectedSessionId.equals(expandedConversationSessionId)) return;
            action.run();
        });
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
                if (OfflineFallbackPolicy.isAuthorizationRevoked(error)) {
                    clearRevokedConnection(generation, current, currentConnection);
                    return;
                }
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
        if (message.isEmpty() || sendingSessionIds.contains(session.id())) return;
        sendingSessionIds.add(session.id());
        draft.setEnabled(false);
        send.setEnabled(false);
        MobileProtocol current = protocol;
        ConnectionStore.Connection currentConnection = connection;
        long generation = snapshotGenerationGate.capture();
        network.execute(() -> {
            try {
                String state = current.sendMessage(session, message);
                postIfCurrent(generation, current, currentConnection, () -> {
                    sendingSessionIds.remove(session.id());
                    messageDraftBySessionId.remove(session.id());
                    statusText.setText("delivered".equals(state) ? "跟进已送达" : "跟进已进入队列");
                    renderSessions(renderedSessions);
                    refreshSessions(false);
                });
            } catch (Exception error) {
                if (OfflineFallbackPolicy.isAuthorizationRevoked(error)) {
                    clearRevokedConnection(generation, current, currentConnection);
                    return;
                }
                postIfCurrent(generation, current, currentConnection, () -> {
                    sendingSessionIds.remove(session.id());
                    statusText.setText(safeError(error));
                    renderSessions(renderedSessions);
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
        button.setMinHeight(dp(48));
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
        return new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
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
