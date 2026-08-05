#!/bin/bash
# Spouští se přes SessionStart hook (viz .claude/settings.json) na začátku
# každé Claude Code session, cloud i lokální. V cloud session (proměnná
# CLAUDE_CODE_REMOTE=true) doinstaluje závislosti — v lokální session nedělá
# nic, protože si `npm install` spouštíš sám podle potřeby.
#
# Vzniklo jako oprava: environment "Setup script" pole v cloud session
# spouštělo `npm install` z /home/user (ne z rootu repa) → ENOENT na
# package.json. SessionStart hook běží až po startu Claude Code, kdy je
# working directory už správně nastavené na checkoutnutý repo.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

npm install
exit 0
