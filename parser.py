from datetime import timedelta
import json
import re
import pandas as pd

EXCEL_FILE = "schedule.xls"
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


def parse_schedule(file_path):
    print(" Читаю файл расписания...")
    excel = pd.ExcelFile(file_path)
    full_schedule = {}
    weeks_labels = {}

    for sheet_name in excel.sheet_names:
        clean_name = str(sheet_name).strip()

        # Игнорируем технические листы-числа (6, 7, 8...)
        if clean_name.isdigit():
            continue

        df = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
        if df.shape[0] < 12:
            continue

        full_schedule[clean_name] = []

        # Поиск строки шапки
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

        # Формируем диапазон дат: Понедельник -> Суббота (+5 дней)
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
                weeks_labels[str(week_num)] = range_str

        # Парсим строки с занятиями
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
                            full_schedule[clean_name].append(
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

    output = {"groups": full_schedule, "weeks": weeks_labels}

    with open("schedule.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(
        f" Успешно! Добавлены группы: {', '.join(full_schedule.keys())} (всего: {len(full_schedule)})"
    )


if __name__ == "__main__":
    parse_schedule(EXCEL_FILE)