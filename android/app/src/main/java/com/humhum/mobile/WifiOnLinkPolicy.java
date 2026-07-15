package com.humhum.mobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.IpPrefix;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import java.net.Inet4Address;

public final class WifiOnLinkPolicy {
    private WifiOnLinkPolicy() {}

    public static boolean isHostOnCurrentWifi(Context context, String host) {
        byte[] candidate = parseIpv4(host);
        if (context == null || candidate == null) return false;
        ConnectivityManager manager =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities == null
                    || !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                continue;
            }
            LinkProperties properties = manager.getLinkProperties(network);
            if (properties == null) continue;
            for (RouteInfo route : properties.getRoutes()) {
                IpPrefix destination = route.getDestination();
                if (destination == null
                        || !(destination.getAddress() instanceof Inet4Address)
                        || destination.getPrefixLength() <= 0
                        || route.hasGateway()) {
                    continue;
                }
                if (matchesIpv4Prefix(
                        host,
                        destination.getAddress().getAddress(),
                        destination.getPrefixLength())) {
                    return true;
                }
            }
        }
        return false;
    }

    static boolean matchesIpv4Prefix(String host, byte[] network, int prefixLength) {
        byte[] candidate = parseIpv4(host);
        if (candidate == null
                || network == null
                || network.length != 4
                || prefixLength < 1
                || prefixLength > 32) {
            return false;
        }
        int candidateValue = toInt(candidate);
        int networkValue = toInt(network);
        int mask = prefixLength == 32 ? -1 : -1 << (32 - prefixLength);
        return (candidateValue & mask) == (networkValue & mask);
    }

    private static int toInt(byte[] address) {
        return ((address[0] & 0xff) << 24)
                | ((address[1] & 0xff) << 16)
                | ((address[2] & 0xff) << 8)
                | (address[3] & 0xff);
    }

    private static byte[] parseIpv4(String host) {
        if (host == null) return null;
        String[] parts = host.trim().split("\\.", -1);
        if (parts.length != 4) return null;
        byte[] address = new byte[4];
        try {
            for (int index = 0; index < parts.length; index++) {
                if (parts[index].isEmpty()
                        || (parts[index].length() > 1 && parts[index].startsWith("0"))) {
                    return null;
                }
                int value = Integer.parseInt(parts[index]);
                if (value < 0 || value > 255) return null;
                address[index] = (byte) value;
            }
            return address;
        } catch (NumberFormatException error) {
            return null;
        }
    }
}
