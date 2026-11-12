from datetime import timedelta
import glob
import json
import os
import re
import ssl
import urllib.request
import pandas as pd
import vk_api

ssl._create_default_https_context = ssl._create_unverified_context

GROUP_ID = 29490619
TOPIC_ID = 68268274
VK_SERVICE_TOKEN = os.environ.get("VK_SERVICE_TOKEN", "")
FOLDER_NAME = "schedules"
DAYS = ["ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"]


def clean_teacher_name(name):
  if not name:
    return ""
  t = name.replace("\xa0", " ").strip()
  if len(t) < 4:
    return ""
  lower = t.lower()
  if any(
      x in lower
      for x in [
          "ауд",
          "lms",
          "день для",
          "электив",
          "самостоят",
          "библиотеч",
          "кафедр",
      ]
  ):
    return ""
  return t


def parse_cell_lessons(text):
  if not text or pd.isna(text):
    return []
  raw = str(text).strip()
  if not raw or raw.lower() == "nan":
    return []

  if (
      "самостоятельной подготовки" in raw.lower()
      or "элективные модули" in raw.lower()
  ):
    return [{
        "type": "Инфо",
        "subject": raw.replace("\n", " ").strip(),
        "teacher": "",
        "room": "",
        "is_parallel": False,
        "subgroup": "",
    }]

  lines = [l.strip() for l in raw.split("\n") if l.strip()]
  if not lines:
    return []

  lesson_start_regex = re.compile(
      r"^(?:пр\.|лек\.|конс\.|лаб\.|зач\.|экз\.)", re.IGNORECASE
  )
  chunks = []
  current_chunk = []
  for line in lines:
    if lesson_start_regex.match(line) and current_chunk:
      chunks.append(current_chunk)
      current_chunk = [line]
    else:
      current_chunk.append(line)
  if current_chunk:
    chunks.append(current_chunk)

  is_parallel = len(chunks) > 1
  results = []

  for idx, chunk in enumerate(chunks):
    subj = chunk[0]
    details = chunk[1] if len(chunk) > 1 else ""
    if len(chunk) > 2:
      details += " " + " ".join(chunk[2:])

    l_type = "Пара"
    for prefix, name in [
        ("лек.", "Лекция"),
        ("пр.", "Практика"),
        ("конс.", "Консультация"),
        ("лаб.", "Лабораторная"),
    ]:
      if subj.lower().startswith(prefix):
        l_type = name
        subj = subj[len(prefix) :].strip()
        break

    subgroup = ""
    sub_match = re.search(r"(\d+\s*(?:гр|подгр|п/г)[\.]?)", subj, re.IGNORECASE)
    if sub_match:
      subgroup = sub_match.group(1).strip()
    elif is_parallel:
      subgroup = f"Подгруппа {idx + 1}"

    teacher = details
    room = ""
    if " - " in details:
      parts = details.rsplit(" - ", 1)
      teacher = parts[0].strip()
      room = parts[1].strip()
    elif "ауд" in details.lower() or "lms" in details.lower():
      room = details.strip()
      teacher = ""

    results.append({
        "type": l_type,
        "subject": subj,
        "teacher": clean_teacher_name(teacher),
        "room": room,
        "is_parallel": is_parallel,
        "subgroup": subgroup,
    })
  return results


def parse_single_excel(
    file_path, full_schedule, directions_map, weeks_metadata, teachers_map
):
  try:
    excel = pd.ExcelFile(file_path)
  except Exception:
    return

  for sheet_name in excel.sheet_names:
    clean_name = str(sheet_name).strip()
    if clean_name.isdigit():
      continue

    try:
      df = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
    except Exception:
      continue

    if df.shape[0] < 12:
      continue

    header_row = None
    for r in range(min(25, len(df))):
      row_vals = [str(x).strip().lower() for x in df.iloc[r] if pd.notna(x)]
      if any("день / неделя" in x for x in row_vals):
        header_row = r
        break

    if header_row is None:
      continue

    week_cols = {}
    for c in range(3, df.shape[1]):
      val = df.iloc[header_row, c]
      if pd.notna(val) and str(val).isdigit():
        week_num = int(val)
        date_val = (
            df.iloc[header_row + 1, c] if header_row + 1 < len(df) else None
        )

        start_iso = ""
        end_iso = ""
        range_str = f"{week_num} неделя"

        if pd.notna(date_val):
          try:
            dt_start = pd.to_datetime(date_val)
            dt_end = dt_start + timedelta(days=5)
            start_iso = dt_start.strftime("%Y-%m-%d")
            end_iso = dt_end.strftime("%Y-%m-%d")
            range_str = (
                f"{dt_start.strftime('%d.%m.%y')} –"
                f" {dt_end.strftime('%d.%m.%y')}"
            )
          except Exception:
            pass

        week_cols[c] = {"week": week_num, "date_range": range_str}
        w_key = str(week_num)
        if w_key not in weeks_metadata:
          weeks_metadata[w_key] = {
              "label": range_str,
              "start": start_iso,
              "end": end_iso,
          }

    lessons_list = []
    current_day = ""
    for r in range(header_row + 1, len(df)):
      day_cell = str(df.iloc[r, 0]).strip().upper()
      if day_cell in DAYS:
        current_day = day_cell

      pair_cell = df.iloc[r, 1]
      time_cell = str(df.iloc[r, 2]).strip() if pd.notna(df.iloc[r, 2]) else ""

      if pd.notna(pair_cell) and str(pair_cell).isdigit() and current_day:
        pair_num = int(pair_cell)
        for col_idx, week_info in week_cols.items():
          if col_idx < df.shape[1]:
            cell_val = df.iloc[r, col_idx]
            parsed_items = parse_cell_lessons(cell_val)
            for lesson in parsed_items:
              lesson_record = {
                  "week": week_info["week"],
                  "date_range": week_info["date_range"],
                  "day": current_day,
                  "pair": pair_num,
                  "time": time_cell,
                  "type": lesson["type"],
                  "subject": lesson["subject"],
                  "teacher": lesson["teacher"],
                  "room": lesson["room"],
                  "is_parallel": lesson["is_parallel"],
                  "subgroup": lesson["subgroup"],
              }
              lessons_list.append(lesson_record)

              # Индексация для личного кабинета преподавателя
              teacher_name = lesson["teacher"]
              if teacher_name:
                if teacher_name not in teachers_map:
                  teachers_map[teacher_name] = []

                # Проверка: если у преподавателя уже есть эта пара в это время (поточная лекция)
                existing = None
                for ex in teachers_map[teacher_name]:
                  if (
                      ex["week"] == week_info["week"]
                      and ex["day"] == current_day
                      and ex["pair"] == pair_num
                      and ex["subject"] == lesson["subject"]
                  ):
                    existing = ex
                    break

                if existing:
                  if clean_name not in existing["group"]:
                    existing["group"] += f", {clean_name}"
                else:
                  teachers_map[teacher_name].append({
                      "week": week_info["week"],
                      "date_range": week_info["date_range"],
                      "day": current_day,
                      "pair": pair_num,
                      "time": time_cell,
                      "type": lesson["type"],
                      "subject": lesson["subject"],
                      "group": clean_name,
                      "room": lesson["room"],
                      "subgroup": lesson["subgroup"],
                  })

    if lessons_list:
      full_schedule[clean_name] = lessons_list


def main():
  if not os.path.exists(FOLDER_NAME):
    os.makedirs(FOLDER_NAME)

  if (
      VK_SERVICE_TOKEN
      and VK_SERVICE_TOKEN != "ВСТАВЬТЕ_СЮДА_ВАШ_ТОКЕН_ВК"
      and not VK_SERVICE_TOKEN.startswith("ВСТАВЬТЕ")
  ):
    try:
      vk_session = vk_api.VkApi(token=VK_SERVICE_TOKEN)
      vk = vk_session.get_api()
      print("🔍 Проверка обновлений в ВК...")
      comments = vk.board.getComments(
          group_id=GROUP_ID, topic_id=TOPIC_ID, count=25, sort="desc"
      )

      downloaded = 0
      for item in comments.get("items", []):
        for att in item.get("attachments", []):
          if att.get("type") == "doc":
            doc = att["doc"]
            title = doc.get("title", "")
            ext = doc.get("ext", "").lower()
            url = doc.get("url")

            if (
                ext in ["xls", "xlsx"]
                or title.endswith(".xls")
                or title.endswith(".xlsx")
            ) and url:
              file_path = os.path.join(FOLDER_NAME, title)
              if not os.path.exists(file_path):
                print(f"📥 Скачиваю: {title}")
                urllib.request.urlretrieve(url, file_path)
                downloaded += 1
      print(f"✔️ Скачивание завершено (новых: {downloaded})")
    except Exception as e:
      print(
          f"⚠️ Ошибка авторизации ВК ({e}), использую уже скачанные таблицы..."
      )
  else:
    print(
        "ℹ️ Токен ВК не задан. Использую скачанные таблицы из папки"
        f" '{FOLDER_NAME}'..."
    )

  print("⚙️ Сборка schedule.json с индексацией преподавателей...")
  files = glob.glob(os.path.join(FOLDER_NAME, "*.xls*"))

  full_schedule = {}
  directions_map = {}
  weeks_metadata = {}
  teachers_map = {}

  for f in sorted(files):
    parse_single_excel(
        f, full_schedule, directions_map, weeks_metadata, teachers_map
    )

  # Сортировка преподавателей по алфавиту
  sorted_teachers = {k: teachers_map[k] for k in sorted(teachers_map.keys())}

  output = {
      "groups": full_schedule,
      "weeks": weeks_metadata,
      "teachers": sorted_teachers,
  }

  # Без indent: файл читает машина, а лишние отступы добавляют мегабайты
  with open("schedule.json", "w", encoding="utf-8") as out:
    json.dump(output, out, ensure_ascii=False, separators=(",", ":"))

  write_split_schedule(full_schedule, sorted_teachers, weeks_metadata)

  print(f"\n🎉 Готово! Всего групп: {len(full_schedule)}")
  print(f"👨‍🏫 Найдено преподавателей: {len(sorted_teachers)}")
  print("📁 База сохранена в schedule.json")


def _safe_filename(name):
  """Имя группы/преподавателя в виде, пригодном для имени файла.

  Кириллица в URL допустима, но её приходится процентно кодировать, а разные
  браузеры делают это по-разному. Поэтому оставляем только буквы, цифры,
  дефис и подчёркивание, а всё остальное заменяем на «_».
  """
  safe = re.sub(r"[^\w\-]", "_", str(name).strip(), flags=re.UNICODE)
  return safe or "_"


def write_split_schedule(full_schedule, sorted_teachers, weeks_metadata):
  """Раскладываем базу на маленькие файлы по группам и преподавателям.

  Раньше мини-апп тянул целиком schedule.json (~25 МБ) ради расписания одной
  группы. Теперь он сначала берёт index.json (десятки килобайт), а затем
  только нужный файл — типичная группа весит ~60 КБ.
  """
  groups_dir = os.path.join("data", "groups")
  teachers_dir = os.path.join("data", "teachers")
  os.makedirs(groups_dir, exist_ok=True)
  os.makedirs(teachers_dir, exist_ok=True)

  groups_index = {}
  for grp_name, lessons in full_schedule.items():
    fname = _safe_filename(grp_name) + ".json"
    with open(os.path.join(groups_dir, fname), "w", encoding="utf-8") as f:
      json.dump(lessons, f, ensure_ascii=False, separators=(",", ":"))
    groups_index[grp_name] = fname

  teachers_index = {}
  for tch_name, lessons in sorted_teachers.items():
    fname = _safe_filename(tch_name) + ".json"
    with open(os.path.join(teachers_dir, fname), "w", encoding="utf-8") as f:
      json.dump(lessons, f, ensure_ascii=False, separators=(",", ":"))
    teachers_index[tch_name] = fname

  index = {
      "version": 1,
      "weeks": weeks_metadata,
      "groups": groups_index,
      "teachers": teachers_index,
  }
  with open("data/index.json", "w", encoding="utf-8") as f:
    json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

  total = sum(
      os.path.getsize(os.path.join(groups_dir, n)) for n in groups_index.values()
  ) + sum(
      os.path.getsize(os.path.join(teachers_dir, n))
      for n in teachers_index.values()
  )
  print(f"🧩 Разбито на файлы: {len(groups_index)} групп,"
        f" {len(teachers_index)} преподавателей")
  print(f"📦 Суммарный объём data/: {total / 1024 / 1024:.1f} МБ")
  print("📁 Индекс сохранён в data/index.json")


if __name__ == "__main__":
  main()