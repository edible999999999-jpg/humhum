#!/usr/bin/env bash
set -euo pipefail

umask 077

humhum_dir="${HOME}/.humhum"
signing_dir="${humhum_dir}/android-signing"
keystore="${signing_dir}/humhum-release.jks"
properties="${humhum_dir}/android-signing.properties"
alias_name="humhum-release"

if [[ -e "${keystore}" || -e "${properties}" ]]; then
  echo "HUMHUM release signing already exists; refusing to overwrite it." >&2
  exit 1
fi

if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/keytool" ]]; then
  keytool_bin="${JAVA_HOME}/bin/keytool"
elif command -v keytool >/dev/null 2>&1; then
  keytool_bin="$(command -v keytool)"
else
  echo "Java keytool was not found. Set JAVA_HOME to JDK 17 or newer." >&2
  exit 1
fi

mkdir -p "${signing_dir}"
chmod 700 "${humhum_dir}" "${signing_dir}"

temp_keystore="${signing_dir}/.humhum-release.jks.$$"
temp_properties="${humhum_dir}/.android-signing.properties.$$"
cleanup() {
  rm -f "${temp_keystore}" "${temp_properties}"
}
trap cleanup EXIT

password="$(openssl rand -hex 32)"
"${keytool_bin}" -genkeypair \
  -keystore "${temp_keystore}" \
  -storetype JKS \
  -storepass "${password}" \
  -keypass "${password}" \
  -alias "${alias_name}" \
  -keyalg RSA \
  -keysize 4096 \
  -sigalg SHA256withRSA \
  -validity 10950 \
  -dname "CN=HUMHUM Android Release, O=HUMHUM, C=CN" \
  >/dev/null

printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=%s\nkeyPassword=%s\n' \
  "${keystore}" "${password}" "${alias_name}" "${password}" > "${temp_properties}"
chmod 600 "${temp_keystore}" "${temp_properties}"
mv "${temp_keystore}" "${keystore}"
mv "${temp_properties}" "${properties}"
unset password

trap - EXIT
echo "Created HUMHUM Android release signing files under ~/.humhum/."
echo "Back up both files before distributing release builds."
