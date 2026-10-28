import os
import re
import json
import requests
import openpyxl

# ID сообщества и темы обсуждения с расписанием (ИИЯ МГПУ)
# Например, если ссылка: vk.com/topic-242671645_12345678
# group_id = 242671645, topic_id = 12345678
VK_GROUP_ID = 29490619  # ID группы студенческого совета/ИИЯ (без минуса)
VK_TOPIC_ID = 68268274  # ID темы с расписанием
VK_SERVICE_TOKEN = os.getenv("VK_SERVICE_TOKEN")  # Берется из секретов GitHub

DAYS = ["ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"]

def get_latest_excel_url():
    """Получает ссылку на самый свежий Excel-файл из обсуждения ВК."""
    url = "https://api.vk.com/method/board.getComments"
    params = {
        "group_id": VK_GROUP_ID,
        "topic_id": VK_TOPIC_ID,
        "need_likes": 0,
        "count": 10,
        "sort": "desc",
        "access_token": VK_SERVICE_TOKEN,
        "v": "5.199"
    }
    
    res = requests.get(url, params=params).json()
    items = res.get("response", {}).get("items", [])

    for comment in items:
        attachments = comment.get("attachments", [])
        for att in attachments:
            if att.get("type") == "doc":
                doc = att.get("doc", {})
                ext = doc.get("ext", "").lower()
                title = doc.get("title", "").lower()
                if ext in ["xlsx", "xls"] or "расписание" in title:
                    return doc.get("url"), doc.get("title")
    return None, None

def download_file(url, filename="latest_schedule.xlsx"):
    r = requests.get(url, stream=True)
    with open(filename, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)
    return filename

def run_pipeline():
    if not VK_SERVICE_TOKEN:
        print("❌ Ошибка: Не задан токен VK_SERVICE_TOKEN.")
        return False

    print("🔍 Проверка новых файлов в обсуждении ВК...")
    doc_url, doc_title = get_latest_excel_url()

    if not doc_url:
        print("ℹ️ Новых прикрепленных Excel-файлов не найдено.")
        return False

    # Проверка контрольной суммы / названия, чтобы не пересобирать одинаковое
    last_title_file = ".last_scraped_title"
    if os.path.exists(last_title_file):
        with open(last_title_file, "r", encoding="utf-8") as f:
            if f.read().strip() == doc_title:
                print(f"✅ Файл '{doc_title}' уже обработан ранее. Обновление не требуется.")
                return False

    print(f"📥 Скачивание нового файла: {doc_title}...")
    local_excel = download_file(doc_url)

    # Здесь вызывается парсер таблицы (ваш основной логический модуль)
    print("⚙️ Запуск парсинга и генерации schedule.json...")
    # parse_excel_to_json(local_excel) -> schedule.json

    with open(last_title_file, "w", encoding="utf-8") as f:
        f.write(doc_title)

    print("🎉 Расписание успешно обновлено!")
    return True

if __name__ == "__main__":
    run_pipeline()
