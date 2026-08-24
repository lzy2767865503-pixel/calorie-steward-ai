#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for file in README.md NOTICE AUTHORS CITATION.cff; do
  test -f "$file"
  grep -Fq 'LAI ZEYU' "$file"
  grep -Fq '来泽宇' "$file"
done

runtime_files="$(
  git ls-files -co --exclude-standard -- \
    'mobile-app/App.tsx' \
    'mobile-app/src/**' \
    'mobile-app/app.json'
)"
if [[ -z "$runtime_files" ]]; then
  echo "No mobile runtime source files were found."
  exit 1
fi

if ! grep -Fq 'LAI ZEYU' $runtime_files || ! grep -Fq '来泽宇' $runtime_files; then
  echo "The official mobile source must retain visible bilingual developer attribution."
  exit 1
fi

echo "Official-source attribution checks passed."
