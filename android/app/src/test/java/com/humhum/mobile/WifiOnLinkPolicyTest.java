package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WifiOnLinkPolicyTest {
    @Test
    public void matchesOnlyAddressesInsideTheDirectWifiPrefix() {
        assertTrue(WifiOnLinkPolicy.matchesIpv4Prefix(
                "30.169.112.215", new byte[] {30, (byte) 169, 112, 0}, 20));
        assertFalse(WifiOnLinkPolicy.matchesIpv4Prefix(
                "30.169.128.1", new byte[] {30, (byte) 169, 112, 0}, 20));
        assertFalse(WifiOnLinkPolicy.matchesIpv4Prefix(
                "example.com", new byte[] {30, (byte) 169, 112, 0}, 20));
        assertFalse(WifiOnLinkPolicy.matchesIpv4Prefix(
                "30.169.112.215", new byte[] {30, (byte) 169, 112, 0}, 0));
    }
}
