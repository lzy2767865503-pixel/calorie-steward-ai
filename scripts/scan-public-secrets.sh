#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

scan_output="$(mktemp -t diet-steward-secret-scan.XXXXXX)"
name_output="$(mktemp -t diet-steward-name-scan.XXXXXX)"
trap 'rm -f "$scan_output" "$name_output"' EXIT

# Scan files that are tracked or eligible to be added. Ignored local secrets are
# outside the public set; tracked files remain visible here even if a later ignore
# rule happens to match them.
while IFS= read -r -d '' file; do
  case "$file" in
    scripts/scan-public-secrets.sh|*.apk|*.aab|*.ipa|*.png|*.jpg|*.jpeg|*.gif|*.sqlite|*.db|*.zip|*.jar)
      continue
      ;;
  esac

  if LC_ALL=C grep -I -qE \
    'sk-(proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{30,}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' \
    "$file"; then
    printf '%s:<redacted high-confidence match>\n' "$file" >>"$scan_output"
  fi
done < <(git ls-files -co --exclude-standard -z)

while IFS= read -r file; do
  case "$file" in
    *.env.example|.env.example|mobile-app/ios/.xcode.env) ;;
    *.env|*.env.*|*local.properties|*.jks|*.keystore|*.p8|*.p12|*.pfx|*.pem|*.key|*.mobileprovision|*google-services.json|*GoogleService-Info.plist|*credentials.json|*service-account*.json|*id_rsa|*id_ed25519|*.netrc|*.npmrc|*.pypirc)
      printf '%s\n' "$file" >>"$name_output"
      ;;
  esac
done < <(git ls-files -co --exclude-standard)

if [[ -s "$scan_output" || -s "$name_output" ]]; then
  echo "Potential public-secret material found. Review and rotate any real credential."
  [[ ! -s "$scan_output" ]] || cat "$scan_output"
  [[ ! -s "$name_output" ]] || sed 's/$/:<sensitive filename>/' "$name_output"
  exit 1
fi

echo "Public-set secret scan passed."
