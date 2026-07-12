package com.humhum.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (protocol != null) refreshSessions(false);
            main.postDelayed(this, 10_000);
        }
    };

    private ConnectionStore connectionStore;
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

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        bindViews();
        connectionStore = new ConnectionStore(getSharedPreferences("humhum_connection", MODE_PRIVATE));
        connectButton.setOnClickListener(view -> pair());
        findViewById(R.id.pasteSetupButton).setOnClickListener(view -> pasteSetup());
        refreshButton.setOnClickListener(view -> refreshSessions(true));
        findViewById(R.id.disconnectButton).setOnClickListener(view -> disconnect());

        connection = connectionStore.load();
        if (connection == null) {
            showConnect();
        } else {
            activate(connection);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        main.removeCallbacks(poll);
        main.post(poll);
    }

    @Override
    protected void onStop() {
        main.removeCallbacks(poll);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
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
        setPairing(true);
        network.execute(() -> {
            try {
                Models.PairResult result = new MobileProtocol(config, "", Models.Scope.READ).pair();
                connectionStore.save(config, result.token(), result.scope());
                ConnectionStore.Connection saved = connectionStore.load();
                main.post(() -> {
                    setPairing(false);
                    hideKeyboard();
                    activate(saved);
                });
            } catch (Exception error) {
                main.post(() -> {
                    setPairing(false);
                    connectError.setText(safeError(error));
                });
            }
        });
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
        scopeText.setText(saved.scope() == Models.Scope.CONTROL ? "已安全连接 · 可控制" : "已安全连接 · 只读");
        statusText.setText("正在同步");
        refreshSessions(true);
    }

    private void showConnect() {
        protocol = null;
        connection = null;
        connectPanel.setVisibility(View.VISIBLE);
        sessionPanel.setVisibility(View.GONE);
        statusText.setText("等待连接");
        sessionsContainer.removeAllViews();
    }

    private void disconnect() {
        connectionStore.clear();
        codeInput.setText("");
        showConnect();
    }

    private void refreshSessions(boolean userInitiated) {
        if (protocol == null || refreshInFlight) return;
        refreshInFlight = true;
        refreshButton.setEnabled(false);
        if (userInitiated) statusText.setText("正在刷新");
        MobileProtocol current = protocol;
        network.execute(() -> {
            try {
                Models.SessionPage page = current.sessions();
                main.post(() -> {
                    if (protocol != current) return;
                    refreshInFlight = false;
                    refreshButton.setEnabled(true);
                    statusText.setText("刚刚同步");
                    renderSessions(page.sessions());
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (protocol != current) return;
                    refreshInFlight = false;
                    refreshButton.setEnabled(true);
                    statusText.setText(safeError(error));
                });
            }
        });
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
        network.execute(() -> {
            try {
                current.resolveApproval(action, decision);
                main.post(() -> refreshSessions(true));
            } catch (Exception error) {
                main.post(() -> {
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
        network.execute(() -> {
            try {
                String state = current.sendMessage(session, message);
                main.post(() -> {
                    draft.setText("");
                    send.setEnabled(true);
                    statusText.setText("delivered".equals(state) ? "跟进已送达" : "跟进已进入队列");
                    refreshSessions(false);
                });
            } catch (Exception error) {
                main.post(() -> {
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

    private static String safeError(Exception error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) return "操作失败，请检查 Mac 是否在线";
        return message.length() <= 120 ? message : message.substring(0, 120);
    }
}
