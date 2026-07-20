package com.humhum.mobile.ui;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;

public class RoomVisualAssetContractTest {
    @Test
    public void androidRoleVisualsExactlyMatchMacAssets() throws Exception {
        assertSameFile(
                "../../public/mascots/hub-backgrounds/humi-room.webp",
                "src/main/res/drawable-nodpi/room_humi.webp");
        assertSameFile(
                "../../public/mascots/hub-backgrounds/hype-room.webp",
                "src/main/res/drawable-nodpi/room_hype.webp");
        assertSameFile(
                "../../public/mascots/hub-backgrounds/hush-room.webp",
                "src/main/res/drawable-nodpi/room_hush.webp");
        assertSameFile(
                "../../public/mascots/hub-backgrounds/hexa-room-v2.png",
                "src/main/res/drawable-nodpi/room_hexa.png");
        assertSameFile(
                "../../public/mascots/avatars/hexa-avatar.png",
                "src/main/res/drawable-nodpi/room_hexa_character.png");
    }

    @Test
    public void bundledChineseFontKeepsItsOflLicense() throws Exception {
        Path font = Path.of("src/main/res/font/noto_sans_sc.ttf");
        Path license = Path.of("src/main/res/raw/noto_sans_sc_ofl.txt");
        assertTrue(Files.isRegularFile(font));
        assertTrue(Files.size(font) > 10_000_000L);
        String licenseText = new String(Files.readAllBytes(license), StandardCharsets.UTF_8);
        assertTrue(licenseText.contains("SIL OPEN FONT LICENSE"));
    }

    private static void assertSameFile(String shared, String android) throws Exception {
        assertArrayEquals(
                Files.readAllBytes(Path.of(shared)),
                Files.readAllBytes(Path.of(android)));
    }
}
