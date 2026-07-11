use std::path::Path;

pub const TOKEN_HEADER: &str = "x-humhum-token";

#[derive(Debug)]
pub struct LocalApiAuth {
    token: String,
}

impl LocalApiAuth {
    #[cfg(test)]
    fn from_token(token: String) -> Self {
        Self { token }
    }

    pub fn load_or_create(humhum_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(humhum_dir)
            .map_err(|error| format!("Could not create HUMHUM directory: {error}"))?;
        let token_path = humhum_dir.join("local-api-token");
        let token = if token_path.exists() {
            std::fs::read_to_string(&token_path)
                .map_err(|error| format!("Could not read local API token: {error}"))?
                .trim()
                .to_string()
        } else {
            let token = uuid::Uuid::new_v4().to_string();
            std::fs::write(&token_path, format!("{token}\n"))
                .map_err(|error| format!("Could not write local API token: {error}"))?;
            token
        };
        if token.is_empty() {
            return Err("Local API token is empty".into());
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&token_path)
                .map_err(|error| format!("Could not inspect local API token: {error}"))?
                .permissions();
            permissions.set_mode(0o600);
            std::fs::set_permissions(&token_path, permissions)
                .map_err(|error| format!("Could not protect local API token: {error}"))?;
        }

        Ok(Self { token })
    }

    pub fn authorizes(&self, candidate: Option<&str>) -> bool {
        candidate.is_some_and(|value| constant_time_eq(value.as_bytes(), self.token.as_bytes()))
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0_u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_exact_local_api_token() {
        let auth = LocalApiAuth::from_token("secret-token".into());
        assert!(auth.authorizes(Some("secret-token")));
        assert!(!auth.authorizes(Some("wrong")));
        assert!(!auth.authorizes(None));
    }

    #[cfg(unix)]
    #[test]
    fn token_file_is_created_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let auth = LocalApiAuth::load_or_create(temp.path()).unwrap();
        let token_path = temp.path().join("local-api-token");

        assert!(auth.authorizes(Some(std::fs::read_to_string(&token_path).unwrap().trim())));
        assert_eq!(
            std::fs::metadata(token_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
