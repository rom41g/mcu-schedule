from http.server import BaseHTTPRequestHandler
import json
import urllib.request

BOT_TOKEN = "8615393852:AAE2YU9ZUCyiYq2F9gGnMT3IFZpMJBNKexk"
WEB_APP_URL = "https://rom41g.github.io/mcu-schedule/"


class handler(BaseHTTPRequestHandler):

  def do_POST(self):
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
          urllib.request.urlopen(req)
        except Exception:
          pass

    self.send_response(200)
    self.send_header("Content-type", "text/plain")
    self.end_headers()
    self.wfile.write(b"OK")
