use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

const VERSION: u8 = 1;
#[allow(dead_code)]
const MAX_CLOCK_SKEW_SECONDS: i64 = 600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WakeEnvelope {
    pub version: u8,
    pub sequence: u64,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WakeSignal {
    pub kind: String,
    pub issued_at: i64,
    #[serde(skip)]
    pub sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeCryptoError {
    InvalidConfiguration,
    InvalidEnvelope,
    AuthenticationFailed,
}

fn decode_hex<const N: usize>(value: &str) -> Result<[u8; N], WakeCryptoError> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(WakeCryptoError::InvalidConfiguration);
    }
    let decoded = hex::decode(value).map_err(|_| WakeCryptoError::InvalidConfiguration)?;
    decoded
        .try_into()
        .map_err(|_| WakeCryptoError::InvalidConfiguration)
}

fn aad(channel: &str, sequence: u64) -> Result<String, WakeCryptoError> {
    let _: [u8; 32] = decode_hex(channel)?;
    if sequence == 0 {
        return Err(WakeCryptoError::InvalidEnvelope);
    }
    Ok(format!("humhum-wake-v1:{channel}:{sequence}"))
}

pub fn encrypt_wake(
    key_hex: &str,
    channel: &str,
    sequence: u64,
    issued_at: i64,
    nonce_hex: &str,
) -> Result<WakeEnvelope, WakeCryptoError> {
    if issued_at <= 0 {
        return Err(WakeCryptoError::InvalidEnvelope);
    }
    let key: [u8; 32] = decode_hex(key_hex)?;
    let nonce: [u8; 12] = decode_hex(nonce_hex)?;
    let additional = aad(channel, sequence)?;
    let plaintext = serde_json::to_vec(&WakeSignal {
        kind: "wake".into(),
        issued_at,
        sequence,
    })
    .map_err(|_| WakeCryptoError::InvalidEnvelope)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| WakeCryptoError::InvalidConfiguration)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: additional.as_bytes(),
            },
        )
        .map_err(|_| WakeCryptoError::AuthenticationFailed)?;
    Ok(WakeEnvelope {
        version: VERSION,
        sequence,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    })
}

#[allow(dead_code)]
pub fn decrypt_wake(
    key_hex: &str,
    channel: &str,
    envelope: &WakeEnvelope,
    now: i64,
    expected_after: u64,
) -> Result<WakeSignal, WakeCryptoError> {
    if envelope.version != VERSION
        || envelope.sequence <= expected_after
        || envelope.nonce.len() != 16
        || envelope.ciphertext.is_empty()
        || envelope.ciphertext.len() > 4096
    {
        return Err(WakeCryptoError::InvalidEnvelope);
    }
    let key: [u8; 32] = decode_hex(key_hex)?;
    let nonce = URL_SAFE_NO_PAD
        .decode(&envelope.nonce)
        .map_err(|_| WakeCryptoError::InvalidEnvelope)?;
    let nonce: [u8; 12] = nonce
        .try_into()
        .map_err(|_| WakeCryptoError::InvalidEnvelope)?;
    if URL_SAFE_NO_PAD.encode(nonce) != envelope.nonce {
        return Err(WakeCryptoError::InvalidEnvelope);
    }
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&envelope.ciphertext)
        .map_err(|_| WakeCryptoError::InvalidEnvelope)?;
    let additional = aad(channel, envelope.sequence)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| WakeCryptoError::InvalidConfiguration)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: additional.as_bytes(),
            },
        )
        .map_err(|_| WakeCryptoError::AuthenticationFailed)?;
    if plaintext.len() > 256 {
        return Err(WakeCryptoError::InvalidEnvelope);
    }
    let mut signal: WakeSignal =
        serde_json::from_slice(&plaintext).map_err(|_| WakeCryptoError::InvalidEnvelope)?;
    if signal.kind != "wake"
        || signal.issued_at <= 0
        || now <= 0
        || now.abs_diff(signal.issued_at) > MAX_CLOCK_SKEW_SECONDS as u64
    {
        return Err(WakeCryptoError::InvalidEnvelope);
    }
    signal.sequence = envelope.sequence;
    Ok(signal)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const CHANNEL: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const NONCE: &str = "000102030405060708090a0b";
    const CIPHERTEXT: &str =
        "PCC9cquB4CGvNvbg1MtUT-ql9EGVHwAdTEXftCpRM4oyJp7Mn7yvhjDJtCCMtszDBhqD82nZ";

    #[test]
    fn wake_encryption_matches_the_shared_android_vector() {
        let envelope = encrypt_wake(KEY, CHANNEL, 7, 1_783_836_000, NONCE).unwrap();

        assert_eq!(envelope.version, 1);
        assert_eq!(envelope.sequence, 7);
        assert_eq!(envelope.nonce, "AAECAwQFBgcICQoL");
        assert_eq!(envelope.ciphertext, CIPHERTEXT);
        assert_eq!(
            decrypt_wake(KEY, CHANNEL, &envelope, 1_783_836_001, 0).unwrap(),
            WakeSignal {
                kind: "wake".into(),
                issued_at: 1_783_836_000,
                sequence: 7,
            }
        );
    }

    #[test]
    fn wake_decryption_rejects_wrong_key_aad_tampering_replay_and_stale_time() {
        let envelope = encrypt_wake(KEY, CHANNEL, 7, 1_783_836_000, NONCE).unwrap();
        let wrong_key = "ff".repeat(32);
        assert!(decrypt_wake(&wrong_key, CHANNEL, &envelope, 1_783_836_001, 0).is_err());
        assert!(decrypt_wake(KEY, &"22".repeat(32), &envelope, 1_783_836_001, 0).is_err());

        let mut tampered = envelope.clone();
        tampered.ciphertext.replace_range(0..1, "A");
        assert!(decrypt_wake(KEY, CHANNEL, &tampered, 1_783_836_001, 0).is_err());
        assert!(decrypt_wake(KEY, CHANNEL, &envelope, 1_783_836_001, 7).is_err());
        assert!(decrypt_wake(KEY, CHANNEL, &envelope, 1_783_836_601, 0).is_err());
    }
}
