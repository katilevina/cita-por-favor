#!/bin/zsh
# Двойной клик запускает локальные уведомления Cita Por Favor: голос, звук,
# уведомления macOS, журнал и снимки. Окно не закрывать.
# Повторный двойной клик = перезапуск: старый экземпляр убивается сам.
# caffeinate -i: пока хелпер работает, Mac не уходит в сон (экран гаснуть может).
cd "$(dirname "$0")"
old=$(lsof -ti tcp:8765)
if [[ -n "$old" ]]; then
  echo "Останавливаю предыдущий хелпер (pid $old)…"
  kill $old 2>/dev/null
  sleep 1
fi
exec caffeinate -i python3 alert-server.py
