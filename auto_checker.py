import os
import requests

VK_GROUP_ID = 29490619
VK_TOPIC_ID = 68268274
VK_SERVICE_TOKEN = os.getenv("VK_SERVICE_TOKEN")


def get_latest_excel_url():
  url = "https://api.vk.com/method/board.getComments"
  params = {
      "group_id": VK_GROUP_ID,
      "topic_id": VK_TOPIC_ID,
      "need_likes": 0,
      "count": 10,
      "sort": "desc",
      "access_token": VK_SERVICE_TOKEN,
      "v": "5.199",
  }

  res = requests.get(url, params=params).json()
  items = res.get("response", {}).get("items", [])

  for comment in items:
    for att in comment.get("attachments", []):
      if att.get("type") == "doc":
        doc = att.get("doc", {})
        ext = doc.get("ext", "").lower()
        title = doc.get("title", "").lower()
        if ext in ["xlsx", "xls"] or "расписание" in title:
          return doc.get("url"), doc.get("title")
  return None, None


def run_pipeline():
  if not VK_SERVICE_TOKEN:
    print("❌ Не задан VK_SERVICE_TOKEN")
    return

  print("🔍 Проверка обсуждения...")
  doc_url, doc_title = get_latest_excel_url()

  if not doc_url:
    print("ℹ️ Вложений Excel не найдено.")
    return

  last_title_file = ".last_scraped_title"
  if os.path.exists(last_title_file):
    with open(last_title_file, "r", encoding="utf-8") as f:
      if f.read().strip() == doc_title and os.path.exists("schedule.json"):
        print(f"✅ Файл '{doc_title}' уже актуален.")
        return

  print(f"📥 Новое расписание обнаружено: {doc_title}")
  print("⚙️ Запуск сборки актуального расписания (vk_downloader)...")
  try:
    import vk_downloader

    vk_downloader.main()
  except Exception as e:
    print(f"⚠️ Ошибка выполнения парсера расписания: {e}")
    return

  with open(last_title_file, "w", encoding="utf-8") as f:
    f.write(doc_title)
  print("🎉 Расписание и schedule.json успешно обновлены!")


if __name__ == "__main__":
  run_pipeline()
