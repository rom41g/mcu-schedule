from http.server import BaseHTTPRequestHandler
import json
import os
import urllib.request

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEB_APP_URL = os.getenv("WEB_APP_URL", "https://rom41g.github.io/mcu-schedule/")


class handler(BaseHTTPRequestHandler):

  def do_POST(self):
    if not BOT_TOKEN:
      self.send_response(500)
      self.send_header("Content-type", "text/plain; charset=utf-8")
      self.end_headers()
      self.wfile.write(b"BOT_TOKEN is not configured")
      return

    content_length = int(self.headers["Content-Length"])
    post_data = self.rfile.read(content_length)
    update = json.loads(post_data.decode("utf-8"))

    if "message" in update and "chat" in update["message"]:
      chat_id = update["message"]["chat"]["id"]
      text = update["message"].get("text", "")

      if text.startswith("/start"):
        send_url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": (
                "Привет! Нажми на кнопку ниже, чтобы открыть"
                " интерактивное расписание МГПУ:"
            ),
            "reply_markup": {
                "inline_keyboard": [[{
                    "text": "📅 Открыть расписание",
                    "web_app": {"url": WEB_APP_URL},
                }]]
            },
        }

        req = urllib.request.Request(
            send_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
          urllib.request.urlopen(req, timeout=5)
        except Exception:
          pass

    self.send_response(200)
    self.send_header("Content-type", "text/plain")
    self.end_headers()
    self.wfile.write(b"OK")
