import hashlib
import os
import sys

import requests

for _stream in (sys.stdout, sys.stderr):
  try:
    _stream.reconfigure(errors="replace")
  except (AttributeError, ValueError):
    pass

VK_GROUP_ID = 29490619
VK_TOPIC_ID = 68268274
VK_SERVICE_TOKEN = os.getenv("VK_SERVICE_TOKEN")

# Сколько последних комментариев темы просматривать. Преподаватели загружают
# файлы под теми же названиями, поэтому «новый документ» определяется не по
# названию, а по паре (название, размер, дата комментария).
COMMENTS_LIMIT = 100


def get_latest_docs():
  """Документы из темы, свежие сверху.

  Возвращает список (title, size, date) — по нему считается отпечаток набора
  расписаний. Названия повторяются, поэтому одного title для проверки
  «изменилось ли что-то» недостаточно.
  """
  url = "https://api.vk.com/method/board.getComments"
  params = {
      "group_id": VK_GROUP_ID,
      "topic_id": VK_TOPIC_ID,
      "need_likes": 0,
      "count": COMMENTS_LIMIT,
      "sort": "desc",
      "access_token": VK_SERVICE_TOKEN,
      "v": "5.199",
  }

  res = requests.get(url, params=params, timeout=30).json()

  if "error" in res:
    raise RuntimeError(res["error"].get("error_msg", str(res["error"])))

  items = res.get("response", {}).get("items", [])
  docs = []
  seen = set()
  for comment in items:
    for att in comment.get("attachments", []):
      if att.get("type") == "doc":
        doc = att.get("doc", {})
        title = str(doc.get("title", "")).strip()
        ext = str(doc.get("ext", "")).lower()
        if ext in ["xlsx", "xls"] or title.lower().endswith((".xls", ".xlsx")):
          stem = os.path.splitext(title)[0].strip().lower()
          # Первое вхождение = самая новая версия файла с таким названием
          if stem in seen:
            continue
          seen.add(stem)
          docs.append((title, doc.get("size"), comment.get("date")))
  return docs


def docs_fingerprint(docs):
  payload = "|".join(f"{t}:{s}:{d}" for t, s, d in docs)
  return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def run_pipeline():
  if not VK_SERVICE_TOKEN:
    print("❌ Не задан VK_SERVICE_TOKEN")
    return

  print("🔍 Проверка обсуждения...")
  try:
    docs = get_latest_docs()
  except Exception as e:
    print(f"⚠️ Не удалось получить список файлов из ВК: {e}")
    return

  if not docs:
    print("ℹ️ Вложений Excel не найдено.")
    return

  print(f"📄 Файлов расписания в теме: {len(docs)}")
  for title, size, _date in docs:
    print(f"   • {title} ({size} б)")

  fingerprint = docs_fingerprint(docs)
  mark_file = ".last_scraped_title"

  if os.path.exists(mark_file) and os.path.exists("schedule.json"):
    with open(mark_file, "r", encoding="utf-8") as f:
      if f.read().strip() == fingerprint:
        print("✅ Набор расписаний не изменился с прошлого запуска.")
        return

  print("📥 Обнаружены изменения — пересобираю базу из ВК...")
  try:
    import vk_downloader

    vk_downloader.main()
  except Exception as e:
    print(f"⚠️ Ошибка выполнения парсера расписания: {e}")
    return

  with open(mark_file, "w", encoding="utf-8") as f:
    f.write(fingerprint)
  print("🎉 Расписание и schedule.json успешно обновлены!")


if __name__ == "__main__":
  run_pipeline()
