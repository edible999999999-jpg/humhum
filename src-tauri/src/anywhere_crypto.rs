use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

const VERSION: u8 = 1;
const MAX_CLOCK_SKEW_SECONDS: i64 = 600;
const MAX_LIFETIME_SECONDS: i64 = 86_400;
const MAX_PLAINTEXT_BYTES: usize = 49_152;
const MAX_CIPHERTEXT_CHARS: usize = 65_536;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnywhereDirection {
    Downlink,
    Uplink,
}

impl AnywhereDirection {
    fn as_str(self) -> &'static str {
        match self {
            Self::Downlink => "downlink",
            Self::Uplink => "uplink",
        }
    }

    fn allows(self, kind: &str) -> bool {
        match self {
            Self::Downlink => matches!(kind, "snapshot" | "response"),
            Self::Uplink => kind == "request",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AnywhereEnvelope {
    pub version: u8,
    pub sequence: u64,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AnywhereMessage {
    pub version: u8,
    pub kind: String,
    pub request_id: String,
    pub issued_at: i64,
    pub expires_at: i64,
    pub body: serde_json::Value,
    #[serde(skip)]
    pub sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnywhereCryptoError {
    InvalidConfiguration,
    InvalidEnvelope,
    AuthenticationFailed,
}

fn decode_hex<const N: usize>(value: &str) -> Result<[u8; N], AnywhereCryptoError> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AnywhereCryptoError::InvalidConfiguration);
    }
    hex::decode(value)
        .map_err(|_| AnywhereCryptoError::InvalidConfiguration)?
        .try_into()
        .map_err(|_| AnywhereCryptoError::InvalidConfiguration)
}

fn valid_request_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn aad(
    channel: &str,
    direction: AnywhereDirection,
    sequence: u64,
) -> Result<String, AnywhereCryptoError> {
    let _: [u8; 32] = decode_hex(channel)?;
    if sequence == 0 {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    Ok(format!(
        "humhum-anywhere-v1:{}:{channel}:{sequence}",
        direction.as_str()
    ))
}

fn validate_message(
    direction: AnywhereDirection,
    message: &AnywhereMessage,
) -> Result<(), AnywhereCryptoError> {
    if message.version != VERSION
        || !direction.allows(&message.kind)
        || !valid_request_id(&message.request_id)
        || message.issued_at <= 0
        || message.expires_at <= message.issued_at
        || message.expires_at - message.issued_at > MAX_LIFETIME_SECONDS
        || !message.body.is_object()
    {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn encrypt_anywhere(
    key_hex: &str,
    channel: &str,
    direction: AnywhereDirection,
    sequence: u64,
    kind: &str,
    request_id: &str,
    issued_at: i64,
    expires_at: i64,
    body: &serde_json::Value,
    nonce_hex: &str,
) -> Result<AnywhereEnvelope, AnywhereCryptoError> {
    let key: [u8; 32] = decode_hex(key_hex)?;
    let nonce: [u8; 12] = decode_hex(nonce_hex)?;
    let additional = aad(channel, direction, sequence)?;
    let message = AnywhereMessage {
        version: VERSION,
        kind: kind.to_string(),
        request_id: request_id.to_string(),
        issued_at,
        expires_at,
        body: body.clone(),
        sequence,
    };
    validate_message(direction, &message)?;
    let plaintext =
        serde_json::to_vec(&message).map_err(|_| AnywhereCryptoError::InvalidEnvelope)?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| AnywhereCryptoError::InvalidConfiguration)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: additional.as_bytes(),
            },
        )
        .map_err(|_| AnywhereCryptoError::AuthenticationFailed)?;
    Ok(AnywhereEnvelope {
        version: VERSION,
        sequence,
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    })
}

pub fn decrypt_anywhere(
    key_hex: &str,
    channel: &str,
    direction: AnywhereDirection,
    envelope: &AnywhereEnvelope,
    now: i64,
    expected_after: u64,
) -> Result<AnywhereMessage, AnywhereCryptoError> {
    let message =
        decrypt_anywhere_authenticated(key_hex, channel, direction, envelope, expected_after)?;
    if !anywhere_message_is_current(&message, now) {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    Ok(message)
}

pub(crate) fn anywhere_message_is_current(message: &AnywhereMessage, now: i64) -> bool {
    now > 0
        && now >= message.issued_at.saturating_sub(MAX_CLOCK_SKEW_SECONDS)
        && now <= message.expires_at
}

pub(crate) fn decrypt_anywhere_authenticated(
    key_hex: &str,
    channel: &str,
    direction: AnywhereDirection,
    envelope: &AnywhereEnvelope,
    expected_after: u64,
) -> Result<AnywhereMessage, AnywhereCryptoError> {
    if envelope.version != VERSION
        || envelope.sequence <= expected_after
        || envelope.nonce.len() != 16
        || envelope.ciphertext.is_empty()
        || envelope.ciphertext.len() > MAX_CIPHERTEXT_CHARS
    {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    let key: [u8; 32] = decode_hex(key_hex)?;
    let nonce = URL_SAFE_NO_PAD
        .decode(&envelope.nonce)
        .map_err(|_| AnywhereCryptoError::InvalidEnvelope)?;
    let nonce: [u8; 12] = nonce
        .try_into()
        .map_err(|_| AnywhereCryptoError::InvalidEnvelope)?;
    if URL_SAFE_NO_PAD.encode(nonce) != envelope.nonce {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&envelope.ciphertext)
        .map_err(|_| AnywhereCryptoError::InvalidEnvelope)?;
    let additional = aad(channel, direction, envelope.sequence)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| AnywhereCryptoError::InvalidConfiguration)?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: additional.as_bytes(),
            },
        )
        .map_err(|_| AnywhereCryptoError::AuthenticationFailed)?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(AnywhereCryptoError::InvalidEnvelope);
    }
    let mut message: AnywhereMessage =
        serde_json::from_slice(&plaintext).map_err(|_| AnywhereCryptoError::InvalidEnvelope)?;
    validate_message(direction, &message)?;
    message.sequence = envelope.sequence;
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const KEY: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const CHANNEL: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const REQUEST_ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const NONCE: &str = "000102030405060708090a0b";
    const CIPHERTEXT: &str = "PCCgfreWq3TjY626ncsTBO2ypQ7SCToNTQKW8T9FIsBkYduZ3LVN8RCGRc_p5klZjzgB7Du3wrte9kt4eYKUj5FdpxuysEcAfTXLD82jLIFL-bwHEjwyHN_Hr_tAw4G-_chp1ohjrWLudUzXOypAC5hdU5zb9h2pe8xn_a7EDGHfKyL8z_W4MGeRLYMH-D6nV5DBSEgpowo8BpnnvTwZYsDMeE8J";
    const ANDROID_CIPHERTEXT: &str = "PCCzY7WMsH7-Hvb_k9NJWrvlvwfGSG9MFEWO7HMNIogjYsuN2qRh7FaIXY_n41Ea1CJC_jm5078drQhrfYKRzI0Q5Ay2o1UIczqIVN6jLJpd-7wHBRcMAZnfpO4Zkdjsqpk4h8UgqXv_fV_TKRRAHtsGA8qCpET7LJ42rKDKTGfIIXWj0IiqJyrbeZYF6XTxAMTTBUjS7zapRHSMSPsnYG-ho7_t";

    #[test]
    fn anywhere_encryption_matches_the_shared_android_vector() {
        let envelope = encrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            7,
            "request",
            REQUEST_ID,
            1_783_836_000,
            1_783_836_300,
            &json!({"scope": "read"}),
            NONCE,
        )
        .unwrap();

        assert_eq!(envelope.version, 1);
        assert_eq!(envelope.sequence, 7);
        assert_eq!(envelope.nonce, "AAECAwQFBgcICQoL");
        assert_eq!(envelope.ciphertext, CIPHERTEXT);
        let message = decrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            &envelope,
            1_783_836_001,
            0,
        )
        .unwrap();
        assert_eq!(message.kind, "request");
        assert_eq!(message.request_id, REQUEST_ID);
        assert_eq!(message.body, json!({"scope": "read"}));
        assert_eq!(message.sequence, 7);
    }

    #[test]
    fn anywhere_decryption_rejects_direction_replay_expiry_and_tampering() {
        let envelope = encrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            7,
            "request",
            REQUEST_ID,
            1_783_836_000,
            1_783_836_300,
            &json!({"scope": "read"}),
            NONCE,
        )
        .unwrap();
        assert!(decrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Downlink,
            &envelope,
            1_783_836_001,
            0,
        )
        .is_err());
        let authenticated =
            decrypt_anywhere_authenticated(KEY, CHANNEL, AnywhereDirection::Uplink, &envelope, 0)
                .unwrap();
        assert!(!anywhere_message_is_current(&authenticated, 1_783_836_301));
        assert!(decrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            &envelope,
            1_783_836_001,
            7,
        )
        .is_err());
        assert!(decrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            &envelope,
            1_783_836_301,
            0,
        )
        .is_err());
        let mut tampered = envelope;
        tampered.ciphertext.replace_range(0..1, "A");
        assert!(decrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            &tampered,
            1_783_836_001,
            0,
        )
        .is_err());
    }

    #[test]
    fn rust_decrypts_the_shared_android_vector() {
        let envelope = AnywhereEnvelope {
            version: 1,
            sequence: 7,
            nonce: "AAECAwQFBgcICQoL".into(),
            ciphertext: ANDROID_CIPHERTEXT.into(),
        };
        let message = decrypt_anywhere(
            KEY,
            CHANNEL,
            AnywhereDirection::Uplink,
            &envelope,
            1_783_836_001,
            0,
        )
        .unwrap();
        assert_eq!(message.kind, "request");
        assert_eq!(message.request_id, REQUEST_ID);
        assert_eq!(message.body, json!({"scope": "read"}));
    }
}
