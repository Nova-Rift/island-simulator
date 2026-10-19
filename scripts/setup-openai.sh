#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local
chmod 700 .local
read -r -s -p 'OpenAI API key (hidden; never committed): ' island_openai_key
printf '\n'
if [[ ${#island_openai_key} -lt 16 || ${#island_openai_key} -gt 4096 || "$island_openai_key" =~ [[:space:]] ]]; then
  printf 'Invalid key format; nothing saved.\n' >&2
  exit 1
fi
# Atomic replacement avoids following a preexisting symlink.
island_key_temp=$(mktemp .local/openai-api-key.XXXXXX)
trap 'rm -f "$island_key_temp"' EXIT
printf '%s' "$island_openai_key" > "$island_key_temp"
unset island_openai_key
mv -f "$island_key_temp" .local/openai-api-key
printf 'Saved privately. Restart the local server, select OpenAI, and enable live agents.\n'
