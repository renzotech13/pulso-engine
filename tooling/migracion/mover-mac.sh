#!/usr/bin/env bash
# Mueve todo lo que Git NO lleva (claves, memoria de Claude, skills, plists,
# modelos y assets ignorados) entre dos Macs.
#
#   Mac origen:   tooling/migracion/mover-mac.sh empaquetar [--sin-modelos]
#   Mac destino:  tooling/migracion/mover-mac.sh restaurar ~/Desktop/pulso-engine-migracion.tar.gz
#
# El paquete contiene el .env (claves): pásalo por AirDrop/disco y bórralo después.
set -euo pipefail

REPO="${REPO:-$HOME/Pulso Engine}"
CLAUDE="$HOME/.claude"
MEM_DIR="projects/-Users-$(whoami)-Pulso-Engine/memory"
LAUNCH="$HOME/Library/LaunchAgents"

cmd="${1:-}"; shift || true

case "$cmd" in
empaquetar)
  sin_modelos=0; [[ "${1:-}" == "--sin-modelos" ]] && sin_modelos=1
  out="$HOME/Desktop/pulso-engine-migracion.tar.gz"
  stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
  mkdir -p "$stage/repo/apps/video-editor" "$stage/claude" "$stage/launchagents"

  cp "$REPO/.env" "$stage/repo/.env"
  for d in config/luts bin assets/b-roll; do
    [[ -d "$REPO/apps/video-editor/$d" ]] || continue
    mkdir -p "$stage/repo/apps/video-editor/$(dirname "$d")"
    cp -R "$REPO/apps/video-editor/$d" "$stage/repo/apps/video-editor/$d"
  done
  if [[ $sin_modelos -eq 0 && -d "$REPO/apps/video-editor/models" ]]; then
    cp -R "$REPO/apps/video-editor/models" "$stage/repo/apps/video-editor/models"
  fi

  mkdir -p "$stage/claude/$MEM_DIR"
  cp -R "$CLAUDE/$MEM_DIR/." "$stage/claude/$MEM_DIR/"
  [[ -d "$CLAUDE/skills" ]] && cp -R "$CLAUDE/skills" "$stage/claude/skills"
  [[ -d "$CLAUDE/aura-respaldo" ]] && cp -R "$CLAUDE/aura-respaldo" "$stage/claude/aura-respaldo"
  for f in settings.json settings.local.json; do
    [[ -f "$CLAUDE/$f" ]] && cp "$CLAUDE/$f" "$stage/claude/$f"
  done
  cp "$LAUNCH"/com.pulsoengine.*.plist "$stage/launchagents/" 2>/dev/null || true

  tar -czf "$out" -C "$stage" .
  echo "Listo: $out ($(du -h "$out" | cut -f1))"
  echo "Contiene el .env con claves: no lo subas a la nube ni a Git."
  ;;

restaurar)
  pkg="${1:?Indica la ruta del .tar.gz}"
  [[ -d "$REPO/.git" ]] || { echo "Primero clona el repo en: $REPO"; exit 1; }
  stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
  tar -xzf "$pkg" -C "$stage"

  cp -R "$stage/repo/." "$REPO/"
  mkdir -p "$CLAUDE"
  # No pisa settings ya existentes en esta Mac: los deja como .migrado
  for f in settings.json settings.local.json; do
    [[ -f "$stage/claude/$f" ]] || continue
    if [[ -f "$CLAUDE/$f" ]]; then cp "$stage/claude/$f" "$CLAUDE/$f.migrado"; else cp "$stage/claude/$f" "$CLAUDE/$f"; fi
  done
  mkdir -p "$CLAUDE/$MEM_DIR"; cp -R "$stage/claude/$MEM_DIR/." "$CLAUDE/$MEM_DIR/"
  [[ -d "$stage/claude/skills" ]] && { mkdir -p "$CLAUDE/skills"; cp -R "$stage/claude/skills/." "$CLAUDE/skills/"; }
  [[ -d "$stage/claude/aura-respaldo" ]] && cp -R "$stage/claude/aura-respaldo" "$CLAUDE/"

  mkdir -p "$LAUNCH" "$HOME/Library/Logs/pulso-engine"
  cp "$stage/launchagents/"*.plist "$LAUNCH/" 2>/dev/null || true

  cat <<MSG
Restaurado. Falta, a mano:
  1. cd "$REPO" && nvm install && corepack enable && pnpm install
  2. brew install ffmpeg (y lo que pida apps/video-editor/README.md)
  3. Instalar LM Studio + el modelo, si esta Mac va a generar copys
  4. Activar servicios SOLO si esta Mac será la que procese trabajos:
       for p in workers videoeditor rendertemplates; do
         launchctl bootstrap gui/\$(id -u) "$LAUNCH/com.pulsoengine.\$p.plist"
       done
     Los workers de las dos Macs contra la misma base se pisan: deja uno solo.
MSG
  ;;
*)
  echo "Uso: $0 empaquetar [--sin-modelos] | restaurar <paquete.tar.gz>"; exit 1;;
esac
