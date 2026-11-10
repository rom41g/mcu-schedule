from datetime import timedelta
import glob
import json
import os
import zipfile
import pandas as pd

DAYS = ["ПОНЕДЕЛЬНИК", "ВТОРНИК", "СРЕДА", "ЧЕТВЕРГ", "ПЯТНИЦА", "СУББОТА"]


def parse_lesson_text(text):
    if not text or pd.isna(text):
        return None
    raw = str(text).strip()
    if not raw or raw.lower() == "nan":
        return None

    if (
        "самостоятельной подготовки" in raw.lower()
        or "элективные модули" in raw.lower()
    ):
        return {
            "type": "Инфо",
            "subject": raw.replace("\n", " "),
            "teacher": "",
            "room": "",
        }

    lines = [line.strip() for line in raw.split("\n") if line.strip()]
    subject_line = lines[0] if lines else raw
    details_line = lines[1] if len(lines) > 1 else ""

    lesson_type = "Пара"
    if subject_line.lower().startswith("лек."):
        lesson_type = "Лекция"
        subject_line = subject_line[4:].strip()
    elif subject_line.lower().startswith("пр."):
        lesson_type = "Практика"
        subject_line = subject_line[3:].strip()
    elif subject_line.lower().startswith("конс."):
        lesson_type = "Консультация"
        subject_line = subject_line[6:].strip()

    teacher = details_line
    room = ""
    if " - " in details_line:
        parts = details_line.rsplit(" - ", 1)
        teacher = parts[0].strip()
        room = parts[1].strip()
    elif "ауд" in details_line.lower() or "lms" in details_line.lower():
        room = details_line.strip()
        teacher = ""

    return {
        "type": lesson_type,
        "subject": subject_line,
        "teacher": teacher,
        "room": room,
    }


def parse_single_excel(file_path, full_schedule, weeks_labels):
    print(f"📄 Обрабатываю: {os.path.basename(file_path)}")
    try:
        excel = pd.ExcelFile(file_path)
    except Exception as e:
        print(f"⚠️ Ошибка чтения файла {file_path}: {e}")
        return

    for sheet_name in excel.sheet_names:
        clean_name = str(sheet_name).strip()

        # Пропускаем пустые листы (с цифрами 6, 7, 8...)
        if clean_name.isdigit():
            continue

        try:
            df = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
        except Exception:
            continue

        if df.shape[0] < 12:
            continue

        # Ищем строку шапки
        header_row = None
        for r in range(min(25, len(df))):
            row_vals = [
                str(x).strip().lower() for x in df.iloc[r] if pd.notna(x)
            ]
            if any("день / неделя" in x for x in row_vals):
                header_row = r
                break

        if header_row is None:
            continue

        # Извлекаем даты колонок
        week_cols = {}
        for c in range(3, df.shape[1]):
            val = df.iloc[header_row, c]
            if pd.notna(val) and str(val).isdigit():
                week_num = int(val)
                date_val = (
                    df.iloc[header_row + 1, c]
                    if header_row + 1 < len(df)
                    else None
                )
                range_str = f"{week_num} неделя"

                if pd.notna(date_val):
                    try:
                        dt_start = pd.to_datetime(date_val)
                        dt_end = dt_start + timedelta(days=5)
                        range_str = f"{dt_start.strftime('%d.%m.%y')} – {dt_end.strftime('%d.%m.%y')}"
                    except Exception:
                        pass

                week_cols[c] = {"week": week_num, "date_range": range_str}
                if str(week_num) not in weeks_labels:
                    weeks_labels[str(week_num)] = range_str

        # Парсим занятия
        lessons_list = []
        current_day = ""
        for r in range(header_row + 1, len(df)):
            day_cell = str(df.iloc[r, 0]).strip().upper()
            if day_cell in DAYS:
                current_day = day_cell

            pair_cell = df.iloc[r, 1]
            time_cell = (
                str(df.iloc[r, 2]).strip() if pd.notna(df.iloc[r, 2]) else ""
            )

            if pd.notna(pair_cell) and str(pair_cell).isdigit() and current_day:
                pair_num = int(pair_cell)
                for col_idx, week_info in week_cols.items():
                    if col_idx < df.shape[1]:
                        cell_val = df.iloc[r, col_idx]
                        lesson = parse_lesson_text(cell_val)
                        if lesson:
                            lessons_list.append(
                                {
                                    "week": week_info["week"],
                                    "date_range": week_info["date_range"],
                                    "day": current_day,
                                    "pair": pair_num,
                                    "time": time_cell,
                                    "type": lesson["type"],
                                    "subject": lesson["subject"],
                                    "teacher": lesson["teacher"],
                                    "room": lesson["room"],
                                }
                            )

        if lessons_list:
            full_schedule[clean_name] = lessons_list


def main():
    # Если есть архив schedules.zip — распаковываем его во временную папку
    zip_path = "schedules.zip"
    folder_path = "schedules"

    if os.path.exists(zip_path):
        print(f"📦 Распаковываю {zip_path}...")
        with zipfile.ZipFile(zip_path, "r") as z:
            z.extractall(folder_path)

    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
        print(
            f"⚠️ Положите архив 'schedules.zip' или добавьте файлы .xls/.xlsx в папку '{folder_path}'."
        )
        return

    # Собираем все .xls и .xlsx файлы
    files = glob.glob(os.path.join(folder_path, "**", "*.xls*"), recursive=True)

    if not files:
        print(f"⚠️ В папке '{folder_path}' не найдено файлов Excel.")
        return

    print(f"Найдено файлов для обработки: {len(files)}")
    full_schedule = {}
    weeks_labels = {}

    for f in sorted(files):
        parse_single_excel(f, full_schedule, weeks_labels)

    output = {"groups": full_schedule, "weeks": weeks_labels}

    with open("schedule.json", "w", encoding="utf-8") as out:
        json.dump(output, out, ensure_ascii=False, indent=2)

    print(
        f"\n Готово! Всего распознано групп: {len(full_schedule)}"
    )
    print(" Группы в базе:", ", ".join(sorted(full_schedule.keys())))
    print(" Файл 'schedule.json' успешно сформирован!")


if __name__ == "__main__":
    main()