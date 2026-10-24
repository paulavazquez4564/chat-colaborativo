#!/usr/bin/env bash
# Vigilante de pings para Pepe. PLANTILLA: se activa cuando ya existe el enlace de Render.
# 1. Copia este archivo a ~/hooks/scripts/chat-pepe-watch.sh
# 2. Escribe la URL del chat en ~/hooks/state/chat-pepe-url.txt (solo la URL, sin clave)
# 3. Regístralo con poll_interval_secs=10 y la instrucción de HOOK_PROMPT.txt
# 4. Haz dry_run, luego enable.
# Regla adaptativa: el vigilante revisa cada 10 s. Si hay silencio de 10 min,
# Pepe, al despertarse o al revisar, puede actualizar el intervalo a 180 s;
# el primer ping detectado en reposo lo devuelve a 10 s.
# El script NUNCA lleva claves: solo lee mensajes y pings públicos (GET).
set -euo pipefail
source "$HATCH_HOOK_RUNTIME"

STATE_DIR="$HOME/hooks/state"
URL_FILE="$STATE_DIR/chat-pepe-url.txt"
SEEN_FILE="$STATE_DIR/chat-pepe-seen-pings.txt"
mkdir -p "$STATE_DIR"
touch "$SEEN_FILE"

if [ ! -s "$URL_FILE" ]; then
  silent "sin URL de chat configurada" '{}'
  exit 0
fi
CHAT_URL="$(head -n 1 "$URL_FILE" | tr -d '[:space:]')"
if [ -z "$CHAT_URL" ]; then
  silent "URL de chat vacía" '{}'
  exit 0
fi

PINGS="$(curl --fail --silent --show-error --max-time 10 "$CHAT_URL/api/pings" || true)"
if [ -z "$PINGS" ]; then
  log "sin respuesta de la API del chat" '{}'
  silent "API del chat sin respuesta" '{}'
  exit 0
fi
# Pings nuevos: ids que no están en el archivo de vistos.
NEW="$(echo "$PINGS" | jq -r '.[].id' 2>/dev/null | grep -vxF -f "$SEEN_FILE" || true)"
if [ -z "$NEW" ]; then
  log "sin pings nuevos" '{}'
  silent "sin pings nuevos" '{}'
  exit 0
fi
# Guarda los nuevos como vistos antes de despertar, para no repetirlos.
echo "$NEW" >> "$SEEN_FILE"
PAYLOAD="$(echo "$PINGS" | jq -c --argjson _x 0 '{pings: [.[] | select(.id as $id | $id == $id)]}' 2>/dev/null || echo '{}')"
# Payload simple y útil: lista de pings nuevos con autor y texto.
DETAIL="$(echo "$PINGS" | jq -c '[.[] | {id, author, text, time}]' 2>/dev/null || echo '[]')"
log "pings nuevos para Pepe" "{\"detail\": $DETAIL}"
wake "ping nuevo en el chat para Pepe" "{\"pings\": $DETAIL}"
