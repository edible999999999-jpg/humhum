package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

public class ManifestContractTest {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";

    @Test
    public void backgroundMonitorPermissionsAndComponentsAreScoped() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder()
                .parse(Path.of("src/main/AndroidManifest.xml").toFile());

        Set<String> permissions = new HashSet<>();
        NodeList permissionNodes = document.getElementsByTagName("uses-permission");
        for (int index = 0; index < permissionNodes.getLength(); index++) {
            permissions.add(((Element) permissionNodes.item(index)).getAttributeNS(ANDROID, "name"));
        }
        assertEquals(Set.of(
                "android.permission.INTERNET",
                "android.permission.ACCESS_NETWORK_STATE",
                "android.permission.FOREGROUND_SERVICE",
                "android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING",
                "android.permission.POST_NOTIFICATIONS",
                "android.permission.RECEIVE_BOOT_COMPLETED"), permissions);
        assertFalse(permissions.contains("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"));
        assertFalse(permissions.contains("android.permission.QUERY_ALL_PACKAGES"));
        assertFalse(permissions.contains("android.permission.READ_EXTERNAL_STORAGE"));
        assertFalse(permissions.contains("android.permission.WRITE_EXTERNAL_STORAGE"));
        assertFalse(permissions.contains("android.permission.MANAGE_EXTERNAL_STORAGE"));
        assertFalse(permissions.contains("android.permission.READ_MEDIA_AUDIO"));
        assertFalse(permissions.contains("android.permission.READ_MEDIA_IMAGES"));
        assertFalse(permissions.contains("android.permission.READ_MEDIA_VIDEO"));

        NodeList visiblePackages = document.getElementsByTagName("package");
        assertEquals(1, visiblePackages.getLength());
        assertEquals(
                "com.miui.securitycenter",
                ((Element) visiblePackages.item(0)).getAttributeNS(ANDROID, "name"));

        Element service = component(document, "service", ".AgentMonitorService");
        assertEquals("false", service.getAttributeNS(ANDROID, "exported"));
        assertEquals("remoteMessaging", service.getAttributeNS(ANDROID, "foregroundServiceType"));

        Element messaging = component(document, "service", ".HumHumMessagingService");
        assertEquals("false", messaging.getAttributeNS(ANDROID, "exported"));
        assertEquals(
                "com.google.firebase.MESSAGING_EVENT",
                ((Element) messaging.getElementsByTagName("action").item(0))
                        .getAttributeNS(ANDROID, "name"));

        Element application = (Element) document.getElementsByTagName("application").item(0);
        assertEquals(".HumHumApplication", application.getAttributeNS(ANDROID, "name"));

        Element receiver = component(document, "receiver", ".MonitorBootReceiver");
        assertEquals("false", receiver.getAttributeNS(ANDROID, "exported"));
        assertNotNull(receiver.getElementsByTagName("intent-filter").item(0));
    }

    @Test
    public void rotationKeepsTheActivityOwnedDraftAndSendStateAlive() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder()
                .parse(Path.of("src/main/AndroidManifest.xml").toFile());
        Element activity = component(document, "activity", ".MainActivity");
        Set<String> handledChanges = Set.of(
                activity.getAttributeNS(ANDROID, "configChanges").split("\\|"));

        assertTrue(handledChanges.contains("orientation"));
        assertTrue(handledChanges.contains("screenSize"));
    }

    @Test
    public void cleartextIsLimitedToExactLoopbackDevelopmentHosts() throws Exception {
        Document document = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(Path.of("src/main/res/xml/network_security_config.xml").toFile());
        Element base = (Element) document.getElementsByTagName("base-config").item(0);
        assertEquals("false", base.getAttribute("cleartextTrafficPermitted"));

        NodeList domains = document.getElementsByTagName("domain");
        Set<String> values = new HashSet<>();
        for (int index = 0; index < domains.getLength(); index++) {
            Element domain = (Element) domains.item(index);
            assertEquals("false", domain.getAttribute("includeSubdomains"));
            values.add(domain.getTextContent().trim());
        }
        assertEquals(Set.of("localhost", "127.0.0.1", "[::1]"), values);
    }

    @Test
    public void mergedFirebasePermissionsAreExplicitAndBounded() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder().parse(Path.of(
                "build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml")
                .toFile());
        Set<String> permissions = new HashSet<>();
        NodeList permissionNodes = document.getElementsByTagName("uses-permission");
        for (int index = 0; index < permissionNodes.getLength(); index++) {
            permissions.add(((Element) permissionNodes.item(index)).getAttributeNS(ANDROID, "name"));
        }
        assertEquals(Set.of(
                "android.permission.INTERNET",
                "android.permission.ACCESS_NETWORK_STATE",
                "android.permission.FOREGROUND_SERVICE",
                "android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING",
                "android.permission.POST_NOTIFICATIONS",
                "android.permission.RECEIVE_BOOT_COMPLETED",
                "android.permission.WAKE_LOCK",
                "com.google.android.c2dm.permission.RECEIVE",
                "com.humhum.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"), permissions);
        assertFalse(document.getDocumentElement().getTextContent().contains("firebase.analytics"));
    }

    @Test
    public void pairedScreenHasOneInterpretedPushStatus() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder()
                .parse(Path.of("src/main/res/layout/activity_main.xml").toFile());
        NodeList textViews = document.getElementsByTagName("TextView");
        int matches = 0;
        for (int index = 0; index < textViews.getLength(); index++) {
            Element element = (Element) textViews.item(index);
            if ("@+id/pushStatusText".equals(element.getAttributeNS(ANDROID, "id"))) {
                matches++;
                assertEquals("系统推送尚未配置", element.getAttributeNS(ANDROID, "text"));
            }
        }
        assertEquals(1, matches);
        String visible = document.getDocumentElement().getTextContent();
        assertFalse(visible.contains("FCM"));
        assertFalse(visible.contains("HTTP"));
        assertFalse(visible.contains("token"));
    }

    @Test
    public void textBearingControlsGrowWithAccessibilityFontScale() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder()
                .parse(Path.of("src/main/res/layout/activity_main.xml").toFile());

        assertScalableHeight(document, "pasteSetupButton", "44dp");
        assertScalableHeight(document, "urlInput", "50dp");
        assertScalableHeight(document, "codeInput", "50dp");
        assertScalableHeight(document, "fingerprintInput", "72dp");
        assertScalableHeight(document, "deviceNameInput", "50dp");
        assertScalableHeight(document, "connectButton", "48dp");
        assertScalableHeight(document, "refreshButton", "42dp");
        assertScalableHeight(document, "disconnectButton", "42dp");
        assertScalableHeight(document, "batterySettingsButton", "42dp");
        assertScalableHeight(document, "autostartSettingsButton", "42dp");

        Element monitorSwitch = elementById(document, "monitorSwitch");
        Element monitorRow = (Element) monitorSwitch.getParentNode();
        assertEquals("wrap_content", monitorRow.getAttributeNS(ANDROID, "layout_height"));
        assertEquals("56dp", monitorRow.getAttributeNS(ANDROID, "minHeight"));

        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        String button = methodSource(source, "private Button button(", "private LinearLayout.LayoutParams weightedButton()");
        assertFalse(button.contains("setHeight("));
        assertTrue(button.contains("setMinHeight(dp(48))"));
        String weighted = methodSource(source, "private LinearLayout.LayoutParams weightedButton()", "private LinearLayout.LayoutParams matchWidthWrap()");
        assertTrue(weighted.contains("LinearLayout.LayoutParams.WRAP_CONTENT"));
    }

    @Test
    public void rootScrollViewKeepsContentOutsideSideAndBottomSystemBars() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        Document document = factory.newDocumentBuilder()
                .parse(Path.of("src/main/res/layout/activity_main.xml").toFile());
        assertEquals("@+id/rootScroll", document.getDocumentElement()
                .getAttributeNS(ANDROID, "id"));

        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        String insets = methodSource(
                source, "private void applySystemBarInsets(", "private void updateDeviceCareStatus(");
        assertTrue(insets.contains("getSystemWindowInsetRight()"));
        assertTrue(insets.contains("baseTop"));
        assertTrue(insets.contains("baseRight + rightInset"));
        assertTrue(insets.contains("baseBottom + bottomInset"));
    }

    @Test
    public void failedRefreshWithoutSnapshotRemovesStaleSessionActions() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        String refresh = methodSource(
                source,
                "private void refreshSessions(boolean userInitiated)",
                "private void postRefreshIfCurrent(");
        int noSnapshot = refresh.indexOf("if (snapshot == null)");
        int staleClear = refresh.indexOf("renderUnavailableSessions();", noSnapshot);
        int branchReturn = refresh.indexOf("return;", noSnapshot);

        assertTrue(noSnapshot >= 0);
        assertTrue(staleClear > noSnapshot);
        assertTrue(staleClear < branchReturn);
    }

    @Test
    public void revokedPairingReturnsToConnectScreen() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        String refresh = methodSource(
                source,
                "private void refreshSessions(boolean userInitiated)",
                "private void postRefreshIfCurrent(");
        assertTrue(refresh.contains("OfflineFallbackPolicy.isAuthorizationRevoked(error)"));
        assertTrue(refresh.contains("clearRevokedConnection("));

        String clear = methodSource(
                source,
                "private void clearRevokedConnection(",
                "private void postRefreshIfCurrent(");
        assertOrdered(
                clear,
                "clearSnapshotSafely();",
                "connectionStore.clear();",
                "showConnect();",
                "connectError.setText(\"移动连接已失效，请重新配对\")");

        String resolve = methodSource(
                source, "private void resolve(", "private void send(");
        assertOrdered(
                resolve,
                "OfflineFallbackPolicy.isAuthorizationRevoked(error)",
                "clearRevokedConnection(");
        String send = methodSource(
                source, "private void send(", "private void setPairing(");
        assertOrdered(
                send,
                "OfflineFallbackPolicy.isAuthorizationRevoked(error)",
                "clearRevokedConnection(");
    }

    @Test
    public void recentConversationDisclosureStaysActivityOnlyAndScopedToEligibleLiveCards()
            throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        assertTrue(source.contains("Map<String, List<Models.ConversationMessage>>"));

        String activation = methodSource(
                source, "private void activate(", "private void reportForegroundPresence()");
        assertTrue(activation.contains("recentConversationBySessionId.clear();"));

        String connect = methodSource(source, "private void showConnect()", "private void disconnect()");
        assertTrue(connect.contains("recentConversationBySessionId.clear();"));

        String destroy = methodSource(source, "protected void onDestroy()", "private void bindViews()");
        assertOrdered(
                destroy,
                "recentConversationBySessionId.clear();",
                "snapshotGenerationGate.close();",
                "network.shutdownNow();");

        String card = methodSource(source, "private View sessionCard(Models.Session session)", "private View actionPanel(");
        assertTrue(card.contains("session.canReadConversation()"));
        assertTrue(card.contains("查看最近对话"));
        assertTrue(card.contains("收起最近对话"));
    }

    @Test
    public void disconnectRerendersConversationDisclosureBeforeAsyncRevocationFinishes()
            throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        String disconnect = methodSource(
                source, "private void disconnect()", "private void onMonitorChanged(boolean checked)");
        assertOrdered(
                disconnect,
                "List<Models.Session> sessions = renderedSessions;",
                "clearConversationState();",
                "renderSessions(sessions);",
                "TRANSITIONS.begin(");
    }

    @Test
    public void recentConversationLateResponsesRequireGenerationProtocolConnectionAndSessionChecks()
            throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);

        String loading = methodSource(
                source, "private void loadConversation(", "private void resolve(");
        assertOrdered(
                loading,
                "long generation = snapshotGenerationGate.capture();",
                "network.execute(() -> {",
                "current.conversation(session)",
                "postConversationIfCurrent(");

        String posting = methodSource(
                source, "private void postConversationIfCurrent(", "private void resolve(");
        assertTrue(posting.contains("snapshotGenerationGate.isLatestOwner()"));
        assertTrue(posting.contains("snapshotGenerationGate.isCurrent(generation)"));
        assertTrue(posting.contains("isCurrentConnection(expectedProtocol, expectedConnection)"));
        assertTrue(posting.contains("expectedSessionId.equals(expandedConversationSessionId)"));
    }

    @Test
    public void conversationRerendersPreserveUnsavedFollowUpDraftsInActivityMemory()
            throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        assertTrue(source.contains("Map<String, String> messageDraftBySessionId"));
        assertTrue(source.contains("Set<String> sendingSessionIds"));

        String panel = methodSource(
                source, "private View messagePanel(", "private void loadConversation(");
        assertOrdered(
                panel,
                "messageDraftBySessionId.getOrDefault(session.id(), \"\")",
                "draft.addTextChangedListener(",
                "messageDraftBySessionId.put(session.id(), value.toString())",
                "boolean sending = sendingSessionIds.contains(session.id());",
                "draft.setEnabled(!sending)",
                "send.setEnabled(!sending)");

        String send = methodSource(source, "private void send(", "private void setPairing(");
        assertOrdered(
                send,
                "sendingSessionIds.add(session.id());",
                "draft.setEnabled(false);",
                "current.sendMessage(session, message)",
                "sendingSessionIds.remove(session.id());",
                "messageDraftBySessionId.remove(session.id());",
                "renderSessions(renderedSessions)");
    }

    @Test
    public void expandedConversationIsExcludedFromAndroidTaskSnapshots() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        assertTrue(source.contains("WindowManager.LayoutParams.FLAG_SECURE"));

        String privacy = methodSource(
                source, "private void syncConversationPrivacy()", "private void syncConversationDisclosureWithSessions(");
        assertTrue(privacy.contains("expandedConversationSessionId == null"));
        assertTrue(privacy.contains("getWindow().clearFlags"));
        assertTrue(privacy.contains("getWindow().addFlags"));
    }

    @Test
    public void protocolAlwaysDisconnectsHttpsConnectionsAfterReadFailures() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MobileProtocol.java")),
                StandardCharsets.UTF_8);
        String execute = methodSource(
                source, "private String execute(", "static String readBounded(");
        assertOrdered(execute, "try {", "} finally {", "connection.disconnect();");
    }

    @Test
    public void recentConversationTextIsAbsentFromSnapshotsPushAndNotificationSources()
            throws Exception {
        String snapshotCodec = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/SessionSnapshotCodec.java")),
                StandardCharsets.UTF_8);
        String snapshotStore = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/EncryptedSessionSnapshotStore.java")),
                StandardCharsets.UTF_8);
        String pushService = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/HumHumMessagingService.java")),
                StandardCharsets.UTF_8);
        String wakeEnvelope = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/WakeEnvelope.java")),
                StandardCharsets.UTF_8);

        assertFalse(snapshotCodec.contains("ConversationMessage"));
        assertFalse(snapshotCodec.contains("can_read_conversation"));
        assertFalse(snapshotStore.contains("ConversationMessage"));
        assertFalse(snapshotStore.contains("can_read_conversation"));
        assertFalse(pushService.contains("ConversationMessage"));
        assertFalse(pushService.contains("/api/session/conversation"));
        assertFalse(wakeEnvelope.contains("ConversationMessage"));
        assertFalse(wakeEnvelope.contains("conversation"));
    }

    @Test
    public void fallbackActivityClaimsPendingTransitionCompletion() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")),
                StandardCharsets.UTF_8);
        String reclaim = methodSource(
                source,
                "private void reclaimStartedOwnershipAndReconcile()",
                "private static void notifyStartedActivityOfTransitionCompletion(");
        assertOrdered(
                reclaim,
                "TRANSITIONS.state()",
                "TRANSITIONS.claimCompletion()",
                "handleTransitionCompletion(completion)");
    }

    private static void assertScalableHeight(
            Document document, String id, String expectedMinimum) {
        Element element = elementById(document, id);
        assertEquals("wrap_content", element.getAttributeNS(ANDROID, "layout_height"));
        assertEquals(expectedMinimum, element.getAttributeNS(ANDROID, "minHeight"));
    }

    private static Element elementById(Document document, String id) {
        NodeList elements = document.getElementsByTagName("*");
        for (int index = 0; index < elements.getLength(); index++) {
            Element element = (Element) elements.item(index);
            if (("@+id/" + id).equals(element.getAttributeNS(ANDROID, "id"))) {
                return element;
            }
        }
        throw new AssertionError("Missing Android view: " + id);
    }

    @Test
    public void encryptedSnapshotLifecycleUsesPolicyAndGenerationGuard() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")), StandardCharsets.UTF_8);

        assertTrue(source.contains("snapshotStore = new EncryptedSessionSnapshotStore(this);"));
        assertTrue(source.contains(
                "snapshotGenerationGate = SessionSnapshotGenerationGate.open();"));
        assertTrue(source.contains(
                "StartedOwnerRegistry<MainActivity> STARTED_ACTIVITIES"));
        assertTrue(source.contains(
                "DurableConnectionTransitionCoordinator TRANSITIONS"));
        assertFalse(source.contains("DURABLE_TRANSITIONS"));

        String start = methodSource(source, "protected void onStart()", "protected void onResume()");
        assertOrdered(
                start,
                "STARTED_ACTIVITIES.start(this);",
                "adoptTransitionState();");
        assertTrue(start.contains("TRANSITIONS.state()"));

        String stop = methodSource(source, "protected void onStop()", "protected void onDestroy()");
        assertOrdered(
                stop,
                "MainActivity fallback = STARTED_ACTIVITIES.stop(this);",
                "if (fallback != null)",
                "notifyPreviousStartedActivity(fallback);");

        String destruction = methodSource(
                source, "protected void onDestroy()", "private void bindViews()");
        assertOrdered(destruction, "snapshotGenerationGate.close();", "network.shutdownNow();");

        String pairing = methodSource(source, "private void pair()", "private void pasteSetup()");
        assertOrdered(
                pairing,
                "TRANSITIONS.begin(",
                "DurableConnectionTransitionCoordinator.State.PAIRING",
                "SessionSnapshotGenerationGate.callExclusiveTransition(",
                "clearSnapshotSafely();",
                "connectionStore.save(config, result);",
                "setPairing(true);");
        assertFalse(pairing.contains("callIfCurrent"));

        String disconnect = methodSource(
                source, "private void disconnect()", "private void onMonitorChanged(boolean checked)");
        assertOrdered(
                disconnect,
                "List<Models.Session> sessions = renderedSessions;",
                "clearConversationState();",
                "renderSessions(sessions);",
                "TRANSITIONS.begin(",
                "DurableConnectionTransitionCoordinator.State.DISCONNECTING",
                "SessionSnapshotGenerationGate.runExclusiveTransition(",
                "clearSnapshotSafely();",
                "connectionStore.clear();",
                "disableMonitor();");
        assertFalse(disconnect.contains("callIfCurrent"));
        assertFalse(disconnect.contains("snapshotGenerationGate.renew"));

        String refresh = methodSource(
                source, "private void refreshSessions(boolean userInitiated)",
                "private void postRefreshIfCurrent(");
        assertOrdered(
                refresh,
                "long refreshGeneration = snapshotGenerationGate.capture();",
                "Models.SessionPage page = current.sessions();",
                "snapshotGenerationGate.callIfCurrent(",
                "isCurrentConnection(current, currentConnection)",
                "writeSnapshotSafely(",
                "postRefreshIfCurrent(refreshGeneration, current, currentConnection");
        assertOrdered(
                refresh,
                "} catch (Exception error) {",
                "OfflineFallbackPolicy.canUseSnapshot(error)",
                "snapshotGenerationGate.callIfCurrent(",
                "isCurrentConnection(current, currentConnection)",
                "readSnapshotSafely(currentConnection, nowMillis)",
                "postRefreshIfCurrent(refreshGeneration, current, currentConnection");
        assertTrue(refresh.contains("statusText.setText(safeError(error));"));
        assertTrue(refresh.contains("postStaleRefreshReset("));
        assertFalse(refresh.contains("postIfCurrent("));

        String callback = methodSource(
                source, "private void postIfCurrent(", "private void writeSnapshotSafely(");
        assertTrue(callback.contains("snapshotGenerationGate.isLatestOwner()"));
        assertTrue(callback.contains("snapshotGenerationGate.isCurrent(generation)"));
        assertTrue(callback.contains(
                "TRANSITIONS.state() != DurableConnectionTransitionCoordinator.State.IDLE"));
        assertTrue(callback.contains(
                "isCurrentConnection(expectedProtocol, expectedConnection)"));
        assertFalse(callback.contains("runIfCurrent"));

        String notification = methodSource(
                source,
                "private static void notifyStartedActivityOfTransitionCompletion(",
                "private void handleTransitionCompletion(");
        assertTrue(notification.contains("STARTED_ACTIVITIES.dispatch("));
        assertTrue(notification.contains("STARTED_ACTIVITIES.isCurrent(activity)"));

        String fallback = methodSource(
                source,
                "private static void notifyPreviousStartedActivity(MainActivity fallback)",
                "private void reclaimStartedOwnershipAndReconcile()");
        assertTrue(fallback.contains("STARTED_ACTIVITIES.isCurrent(fallback)"));

        String reclaim = methodSource(
                source,
                "private void reclaimStartedOwnershipAndReconcile()",
                "private void handleTransitionCompletion(");
        assertTrue(reclaim.contains("snapshotGenerationGate.claimLatestOwner();"));
        assertTrue(reclaim.contains("adoptTransitionState();"));

        String completion = methodSource(
                source,
                "private void handleTransitionCompletion(",
                "private void reconcileDurableConnection(");
        assertTrue(completion.contains("completion.failure()"));
        assertTrue(completion.contains("reconcileDurableConnection(completion.notice())"));

        String adoption = methodSource(
                source, "private void adoptTransitionState()", "private void setDisconnecting(");
        assertTrue(adoption.contains("State.PAIRING"));
        assertTrue(adoption.contains("State.DISCONNECTING"));
        assertTrue(adoption.contains("setPairing(true)"));
        assertTrue(adoption.contains("setDisconnecting(true)"));

        String reconciliation = methodSource(
                source, "private void reconcileDurableConnection(",
                "private void ensureCurrentSnapshotGeneration()");
        assertOrdered(
                reconciliation,
                "ensureCurrentSnapshotGeneration();",
                "connectionStore.load()",
                "PushRegistration.cancel(this)",
                "showConnect()");
        assertTrue(reconciliation.contains("activate(saved)"));
        assertOrdered(
                reconciliation,
                "refreshInFlight = false;",
                "refreshButton.setEnabled(true);",
                "activate(saved)");

        String staleReset = methodSource(
                source,
                "private void resetStaleRefreshState(",
                "private boolean isCurrentConnection(");
        assertOrdered(
                staleReset,
                "refreshInFlight = false;",
                "snapshotGenerationGate.isCurrent(generation)",
                "refreshButton.setEnabled(true);");
    }

    private static Element component(Document document, String tag, String name) {
        NodeList nodes = document.getElementsByTagName(tag);
        for (int index = 0; index < nodes.getLength(); index++) {
            Element element = (Element) nodes.item(index);
            if (name.equals(element.getAttributeNS(ANDROID, "name"))) return element;
        }
        throw new AssertionError(tag + " not found: " + name);
    }

    private static String methodSource(String source, String start, String end) {
        int startIndex = source.indexOf(start);
        int endIndex = source.indexOf(end, startIndex);
        assertTrue("Missing method start: " + start, startIndex >= 0);
        assertTrue("Missing method end: " + end, endIndex > startIndex);
        return source.substring(startIndex, endIndex);
    }

    private static void assertOrdered(String source, String... fragments) {
        int previous = -1;
        for (String fragment : fragments) {
            int index = source.indexOf(fragment, previous + 1);
            assertTrue("Missing or out-of-order source: " + fragment, index > previous);
            previous = index;
        }
    }
}
