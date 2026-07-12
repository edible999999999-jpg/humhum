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
    public void encryptedSnapshotLifecycleIsOrderedAroundLiveConnectionState() throws Exception {
        String source = new String(Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/MainActivity.java")), StandardCharsets.UTF_8);

        String creation = "snapshotStore = new EncryptedSessionSnapshotStore(this);";
        assertTrue(source.contains(creation));

        String pairing = methodSource(source, "private void pair()", "private void pasteSetup()");
        assertOrdered(
                pairing,
                "clearSnapshotSafely();",
                "connectionStore.save(config, result);");

        String disconnect = methodSource(
                source, "private void disconnect()", "private void onMonitorChanged(boolean checked)");
        assertOrdered(disconnect, "clearSnapshotSafely();", "connectionStore.clear();");

        String refresh = methodSource(
                source, "private void refreshSessions(boolean userInitiated)",
                "private void renderSessions(List<Models.Session> sessions)");
        assertOrdered(
                refresh,
                "Models.SessionPage page = current.sessions();",
                "writeSnapshotSafely(currentConnection, page.sessions(), savedAtMillis);",
                "renderSessions(page.sessions());");
        assertOrdered(
                refresh,
                "} catch (Exception error) {",
                "SessionSnapshot snapshot = readSnapshotSafely(currentConnection, nowMillis);",
                "SessionSnapshotCodec.ageCopy(snapshot.savedAtMillis(), nowMillis)",
                "renderSessions(snapshot.sessions());");
        assertTrue(refresh.contains("statusText.setText(safeError(error));"));

        assertTrue(source.contains("private void writeSnapshotSafely("));
        assertTrue(source.contains("private SessionSnapshot readSnapshotSafely("));
        assertTrue(source.contains("private void clearSnapshotSafely()"));
        assertTrue(source.contains("catch (RuntimeException ignored)"));
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
