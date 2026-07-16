package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
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

    @Test
    public void legacyGatewayDetectionTreatsOnlyRoutableAddressesAsGateways() throws Exception {
        assertFalse(WifiOnLinkPolicy.gatewayPresent(null));
        assertFalse(WifiOnLinkPolicy.gatewayPresent(InetAddress.getByName("0.0.0.0")));
        assertTrue(WifiOnLinkPolicy.gatewayPresent(InetAddress.getByName("192.168.1.1")));
    }
}
