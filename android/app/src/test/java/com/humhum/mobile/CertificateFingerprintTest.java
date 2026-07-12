package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import javax.net.ssl.X509TrustManager;
import org.junit.Test;

public class CertificateFingerprintTest {
    private static final String CERTIFICATE_DER =
            "MIIDHTCCAgWgAwIBAgIUTbpMQ0HNwvCZErp8aoZ5rrkmiBgwDQYJKoZIhvcNAQELBQAw"
                    + "HjEcMBoGA1UEAwwTSFVNSFVNIEFuZHJvaWQgVGVzdDAeFw0yNjA3MTIwMjQzMjhaFw0z"
                    + "NjA3MDkwMjQzMjhaMB4xHDAaBgNVBAMME0hVTUhVTSBBbmRyb2lkIFRlc3QwggEiMA0G"
                    + "CSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC282m1WkJ/Syg78NjZWcIJ3GoaqCcV+012"
                    + "TfgigSfda0wwT9VQllquNtW64OKUCdkRrB00uOqbnJgTqT1Fgoxax2SLDajHeoom30ZR"
                    + "hjp62b+YbwS2BFkAc9z39j5ClIAETAOee6t1gA1cUeUiasUAJoTWAGm3Q+xMEQlV6Sfp"
                    + "uhWVq8hhcwULBXtLvJ9RJnkmkJG8xpAVTZ19cE/L5muJiAO+cnze0sw11OG2HE/c0ALr"
                    + "l6i9NX7SKdS9vY3Fhx4CLzeBc+HwZdl5hwXgS6rNlTe7vg3imuVx7kNxKnaS97a0HnI"
                    + "QaRylEEHsaIeXzYpsVX0dQVCbDR+MrGsAYajjAgMBAAGjUzBRMB0GA1UdDgQWBBT5ZNpO"
                    + "98sPsFrWUOWi6UTwEmpPtjAfBgNVHSMEGDAWgBT5ZNpO98sPsFrWUOWi6UTwEmpPtjAP"
                    + "BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBOz5Wur769KFv0NLFAGsp0"
                    + "usAhahXYBGd+lsvhfxtQuaJEfdaUCXxO1NdtFQ1DACrSYzi/R/mTcm9UtCR6T5d8mayo"
                    + "9NN+F/zI+idfM7XWNAA1zBD9sqVALz0wCHei4Mz5XQ2k13OviSOMNgV8TsSUVL+KoYFg"
                    + "Yu6usuS2s7qoXteXSackBqJEHkXHk4RZFxrF3KpJ8f/9RkzKqxZgsQ4DsHMDGcEeqLcA"
                    + "a77zKJNPZK95c9kXqouWGEVRQoFiWSQbjGyjUHsyRxLPheDkoNSNG7dN9YIBH8HqYNP"
                    + "YJdu2fSWQhi20QoRvzCHyBEkK64xC9wO4rjCHxza/xspT8BWp";
    private static final String EXPECTED =
            "ED7789FE2A3DC6AB1B1F92613F21A6A139BEB50712609CDADFDD8508BA4E71F7";

    @Test
    public void hashesTheExactDerCertificate() throws Exception {
        assertEquals(EXPECTED, PinnedTlsClient.sha256(certificate()));
    }

    @Test
    public void acceptsOnlyTheConfiguredLeafCertificate() throws Exception {
        X509Certificate certificate = certificate();
        X509TrustManager manager = PinnedTlsClient.trustManager(EXPECTED);

        manager.checkServerTrusted(new X509Certificate[] {certificate}, "RSA");

        X509TrustManager wrong = PinnedTlsClient.trustManager("00".repeat(32));
        assertThrows(CertificateException.class,
                () -> wrong.checkServerTrusted(new X509Certificate[] {certificate}, "RSA"));
    }

    @Test
    public void rejectsAnEmptyCertificateChain() {
        X509TrustManager manager = PinnedTlsClient.trustManager(EXPECTED);
        assertThrows(CertificateException.class,
                () -> manager.checkServerTrusted(new X509Certificate[0], "RSA"));
    }

    private static X509Certificate certificate() throws Exception {
        byte[] bytes = Base64.getDecoder().decode(CERTIFICATE_DER);
        return (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(bytes));
    }
}
