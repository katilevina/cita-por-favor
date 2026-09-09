#!/usr/bin/env python3
"""Локальный помощник уведомлений Cita Por Favor.

Локальный HTTP-сервер (только 127.0.0.1): userscript в Chrome дёргает его,
когда ситы пойманы, и Mac зовёт голосом + звуком + уведомлением.
Ошибки чекера (kind=error) — только уведомление macOS, без голоса.
Запуск: python3 alert-server.py  (или двойной клик по «Запустить-уведомления-сит.command»).
Никаких зависимостей, только stdlib.

Эндпоинты:
  GET  /ping            — жив ли хелпер (проверка из userscript)
  GET  /beat            — пульс чекера (сторож следит, что вкладка жива)
  GET  /alert           — голос/звук/уведомление
  POST /journal         — строка журнала → journal.log
  POST /snap            — «экран» чекера: текст страницы → snaps/*.txt (+ PNG
                          скриншот всего экрана, если есть право «Запись
                          экрана»; без права PNG пустой, текст работает)
  POST /htmlsnap        — HTML-снимок страницы находки → snaps/*.html
"""

import json
import os
import subprocess
import threading
import time
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("CITA_ALERT_PORT", "8765"))
VOICE = "Milena"
SOUND = "/System/Library/Sounds/Sosumi.aiff"
SOFT_SOUND = "/System/Library/Sounds/Funk.aiff"

# ---- «экраны»: снимки ключевых экранов чекера (v7.30) ----
# Userscript после находки присылает каждый ключевой экран (находка, капча,
# слот, телефон, финал, срыв, бот-блок, ошибка) — текст страницы и (для
# доказательства) PNG-скриншот всего экрана. Файлы копятся в snaps/ в папке
# проекта: ИИ-сессия читает их и видит всю цепочку — что было доступно и где
# сгорели ситы. Файлы содержат личные данные, в git не идут (.gitignore).
SNAPS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snaps")
ENABLE_PNG = True      # PNG честный (screencapture) — нужно право «Запись экрана»
SNAPS_KEEP = 300       # держим последние N файлов, старшие подчищаем
_png_hint_shown = False

# kind → (текст, сирена перед голосом, говорить ли вслух)
MESSAGES = {
    "found":   ("Ситы пойманы, всё заполнено! Введи SMS-код и нажми Confirmar!", True, True),
    "help":    ("Ситы есть, но нужна твоя помощь! Подойди к компьютеру!", True, True),
    "stopped": ("Чекер сит остановился. Посмотри, когда будет минутка.", False, True),
    "unknown": ("Чекер сит увидел незнакомую страницу и остановился.", False, True),
    "error":   ("Чекер сит: ошибка проверки.", False, False),
    "clave":   ("Нужна авторизация Cl@ve — подтверди вход в приложении Cl@ve на телефоне.", False, True),
    "watchdog": ("Чекер сит молчит — обнови вкладку с сайтом. Команд Эр.", False, True),
    "test":    ("Проверка связи. Голос работает.", False, True),
}

# ---- сторож: чекер шлёт пульс раз в минуту; замолчал — зовём человека ----
WATCH_GRACE_SEC = 600      # столько даём сверх запланированного времени проверки
WATCH_REPEAT_SEC = 900     # напоминать каждые 15 минут, пока не оживёт
_watch = {"on": False, "due_ms": 0, "last_alarm": 0.0}


def watchdog_loop():
    while True:
        time.sleep(30)
        if not _watch["on"] or not _watch["due_ms"]:
            continue
        now = time.time()
        if now > _watch["due_ms"] / 1000 + WATCH_GRACE_SEC and \
           now - _watch["last_alarm"] > WATCH_REPEAT_SEC:
            _watch["last_alarm"] = now
            overdue_min = int((now - _watch["due_ms"] / 1000) / 60)
            log(f"СТОРОЖ: чекер молчит, проверка просрочена на ~{overdue_min} мин")
            announce("watchdog", f"Чекер молчит ~{overdue_min} мин — обнови вкладку с сайтом (Cmd+R)")


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def sanitize(s):
    return s.replace("\\", "").replace('"', "'").strip()[:140]


# ---- «экраны»: сохранение снимков ----

def _safe_name(s):
    """Только безопасные для файловой системы символы (имя файла от userscript)."""
    return "".join(c for c in s if c.isalnum() or c in "._-")[:80]


def _screenshot(png_path):
    """PNG-скриншот всего экрана через macOS screencapture (без звука)."""
    global _png_hint_shown

    def run():
        global _png_hint_shown
        try:
            subprocess.run(["screencapture", "-x", png_path],
                           check=False, timeout=10)
            if not os.path.exists(png_path) or os.path.getsize(png_path) == 0:
                if not _png_hint_shown:
                    _png_hint_shown = True
                    log("PNG пустой — выдай Terminal право «Запись экрана»: "
                        "Системные настройки → Конфиденциальность и безопасность")
        except Exception as e:
            log(f"скриншот не вышел: {e}")

    threading.Thread(target=run, daemon=True).start()


def _clean_snaps():
    """Держим в snaps/ последние SNAPS_KEEP файлов, старшие подчищаем."""
    try:
        files = [os.path.join(SNAPS_DIR, f) for f in os.listdir(SNAPS_DIR)]
        files = [p for p in files if os.path.isfile(p)]
        files.sort(key=lambda p: os.path.getmtime(p))
        for p in files[:max(0, len(files) - SNAPS_KEEP)]:
            os.remove(p)
    except Exception as e:
        log(f"чистка snaps не вышла: {e}")


def save_snap(kind, page_url, note, text):
    """Текст «экрана» + PNG → snaps/<дата>_<kind>.txt / .png. Возвращает stem."""
    os.makedirs(SNAPS_DIR, exist_ok=True)
    kind = _safe_name(kind)[:30] or "?"
    stem = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + kind
    header = (
        f"время:  {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}\n"
        f"экран:  {kind}\n"
        f"url:    {page_url}\n"
        f"заметка: {note}\n"
        + "-" * 60 + "\n"
    )
    with open(os.path.join(SNAPS_DIR, stem + ".txt"), "w", encoding="utf-8") as f:
        f.write(header + (text or ""))
    if ENABLE_PNG:
        _screenshot(os.path.join(SNAPS_DIR, stem + ".png"))
    _clean_snaps()
    return stem


_speaking = threading.Lock()


def announce(kind, msg=None):
    text, loud, speak = MESSAGES.get(kind, MESSAGES["test"])
    notif = sanitize(msg) if msg else text
    if speak and not _speaking.acquire(blocking=False):
        log(f"алерт {kind} пропущен: уже говорю")
        return

    def run():
        try:
            if loud:
                for _ in range(3):
                    subprocess.run(["afplay", SOUND], check=False)
            if speak:
                subprocess.run(["say", "-v", VOICE, text], check=False)
            else:
                subprocess.run(["afplay", SOFT_SOUND], check=False)
            subprocess.run(
                ["osascript", "-e",
                 f'display notification "{notif}" with title "Cita Por Favor"'],
                check=False)
        except Exception as e:
            log(f"не смогла проиграть алерт: {e}")
        finally:
            if speak:
                _speaking.release()

    threading.Thread(target=run, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def _reply(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/ping":
            self._reply({"ok": True})
            return
        if url.path == "/beat":
            params = urllib.parse.parse_qs(url.query)
            on = params.get("on", ["0"])[0] == "1"
            due = params.get("due", ["0"])[0]
            was_silent = _watch["last_alarm"] > 0
            _watch["on"] = on
            try:
                _watch["due_ms"] = int(float(due)) if on else 0
            except ValueError:
                _watch["due_ms"] = 0
            _watch["last_alarm"] = 0.0
            if was_silent and on:
                log("СТОРОЖ: чекер снова шлёт пульс — всё ожило")
            self._reply({"ok": True, "watching": on})
            return
        if url.path == "/alert":
            params = urllib.parse.parse_qs(url.query)
            kind = params.get("kind", ["test"])[0]
            msg = params.get("msg", [None])[0]
            if kind not in MESSAGES:
                kind = "test"
            log(f"алерт: {kind}" + (f" — {sanitize(msg)}" if msg else ""))
            announce(kind, msg)
            self._reply({"ok": True, "kind": kind})
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/snap":
            # «экран» чекера: текст страницы (+ PNG экрана на стороне Mac)
            params = urllib.parse.parse_qs(url.query)
            kind = sanitize(params.get("kind", ["?"])[0])
            page_url = sanitize(params.get("url", [""])[0])
            note = sanitize(params.get("note", [""])[0])
            length = int(self.headers.get("Content-Length", "0") or "0")
            data = self.rfile.read(min(length, 2_000_000)) \
                .decode("utf-8", "replace") if length else ""
            try:
                stem = save_snap(kind, page_url, note, data)
                log(f"экран: {kind}" + (f" — {note}" if note else ""))
            except Exception as e:
                stem = None
                log(f"не смогла сохранить экран: {e}")
            self._reply({"ok": True, "stem": stem})
            return
        if url.path == "/htmlsnap":
            # полная HTML-страница находки (доказательство: ситы, не ошибка)
            params = urllib.parse.parse_qs(url.query)
            name = _safe_name(params.get("name", [""])[0]) or (
                "cita-found_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".html")
            if not name.endswith(".html"):
                name += ".html"
            length = int(self.headers.get("Content-Length", "0") or "0")
            data = self.rfile.read(min(length, 4_000_000)) if length else b""
            try:
                os.makedirs(SNAPS_DIR, exist_ok=True)
                with open(os.path.join(SNAPS_DIR, name), "wb") as f:
                    f.write(data)
                log(f"HTML-снимок находки: {name}")
                _clean_snaps()
            except Exception as e:
                log(f"не смогла сохранить HTML-снимок: {e}")
            self._reply({"ok": True, "name": name})
            return
        if url.path == "/journal":
            # userscript шлёт каждую запись журнала строкой — дописываем в файл,
            # чтобы полная история проверок жила на диске (для контекста ИИ-сессий)
            length = int(self.headers.get("Content-Length", "0") or "0")
            data = self.rfile.read(length).decode("utf-8", "replace") if length else ""
            try:
                path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "journal.log")
                with open(path, "a", encoding="utf-8") as f:
                    f.write(data.rstrip("\n") + "\n")
            except Exception as e:
                log(f"не смогла записать журнал: {e}")
            self._reply({"ok": True})
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):  # не шуметь стандартным access-логом
        pass


if __name__ == "__main__":
    log(f"Голосовой хелпер слушает http://{HOST}:{PORT} — не закрывай это окно.")
    log("Проверка: открой в браузере http://127.0.0.1:8765/alert?kind=test")
    threading.Thread(target=watchdog_loop, daemon=True).start()
    HTTPServer((HOST, PORT), Handler).serve_forever()
