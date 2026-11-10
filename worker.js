/*
  <!-- Интерактивное расписание для МГПУ (MCU Schedule) Copyright (c) 2026 Окороков Роман Александрович. Все права защищены. -->
*/

const WEB_APP_URL = "https://rom41g.github.io/mcu-schedule/";
const VK_APP_ID = 54861422;
const VK_CONFIRMATION_CODE = "543f7ccf";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-key",
};

/* ============================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ICAL, БОТА И ТЕЛЕМЕТРИИ
   (Объявлены до export default для устранения предупреждений линтера)
============================================================ */

function escapeIcs(str) {
  return (str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatIcsDateTime(date, hour, minute) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}00`;
}

function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

async function verifyTelegramWebAppData(initDataStr, botToken) {
  try {
    const params = new URLSearchParams(initDataStr);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    // Защита от Replay-атак: проверяем срок давности initData (не старше 24 часов)
    const authDate = parseInt(params.get("auth_date"), 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(authDate) || (now - authDate) > 86400 || (authDate - now) > 300) {
      return null;
    }

    const dataCheckArr = [];
    const keys = Array.from(params.keys()).sort();
    for (const key of keys) {
      dataCheckArr.push(`${key}=${params.get(key)}`);
    }
    const dataCheckString = dataCheckArr.join("\n");

    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));

    const validationKey = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", validationKey, encoder.encode(dataCheckString));
    const hexSignature = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    if (hexSignature !== hash) return null;
    const userRaw = params.get("user");
    return userRaw ? JSON.parse(userRaw) : null;
  } catch (err) {
    return null;
  }
}

function getCycleIdsAt0259Msk(now = new Date()) {
  const shifted = new Date(now.getTime() + 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");

  const dayId = `${y}-${m}-${d}`;
  const monthId = `${y}-${m}`;

  const dayOfWeek = (shifted.getUTCDay() + 6) % 7;
  const mondayDate = new Date(Date.UTC(y, shifted.getUTCMonth(), shifted.getUTCDate() - dayOfWeek));
  const wy = mondayDate.getUTCFullYear();
  const wm = String(mondayDate.getUTCMonth() + 1).padStart(2, "0");
  const wd = String(mondayDate.getUTCDate()).padStart(2, "0");
  const weekId = `${wy}-${wm}-${wd}`;

  return { dayId, weekId, monthId };
}

function createEmptyBucket(id, label = "") {
  return {
    id: id,
    label: label,
    saved_at: "",
    total_sessions: 0,
    unique_users: 0,
    platforms: { tg: 0, vk: 0, pwa: 0, web: 0 },
    roles: { student: 0, teacher: 0 },
    groups: {},
    teachers: {},
    hourly: Array(24).fill(0)
  };
}

function cloneBucketWithTimestamp(bucket, timestampStr) {
  return {
    ...JSON.parse(JSON.stringify(bucket)),
    saved_at: timestampStr
  };
}

function syncLegacyTopFields(stats) {
  if (!stats.periods || !stats.periods.all) return;
  const all = stats.periods.all;
  stats.total_sessions = all.total_sessions;
  stats.platforms = all.platforms;
  stats.roles = all.roles;
  stats.groups = all.groups;
  stats.teachers = all.teachers;
  stats.hourly = all.hourly;
}

function ensurePeriodRotation(rawStats, now = new Date()) {
  const stats = rawStats && typeof rawStats === "object" ? rawStats : {};
  const { dayId, weekId, monthId } = getCycleIdsAt0259Msk(now);
  const mskStamp = now.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  let changed = false;

  if (!stats.daily_dau) stats.daily_dau = {};
  if (!stats.snapshots) {
    stats.snapshots = { day: null, week: null, month: null };
    changed = true;
  }

  if (!stats.periods) {
    const legacyAll = createEmptyBucket("all", "За всё время");
    legacyAll.total_sessions = stats.total_sessions || 0;
    legacyAll.unique_users = Object.values(stats.daily_dau || {}).reduce((a, b) => a + b, 0) || stats.total_sessions || 0;
    legacyAll.platforms = stats.platforms || { tg: 0, vk: 0, pwa: 0, web: 0 };
    legacyAll.roles = stats.roles || { student: 0, teacher: 0 };
    legacyAll.groups = stats.groups || {};
    legacyAll.teachers = stats.teachers || {};
    legacyAll.hourly = Array.isArray(stats.hourly) && stats.hourly.length === 24 ? stats.hourly : Array(24).fill(0);

    const initDay = createEmptyBucket(dayId, `День (${dayId})`);
    initDay.unique_users = stats.daily_dau[dayId] || 0;

    stats.periods = {
      day: initDay,
      week: createEmptyBucket(weekId, `Неделя (с ${weekId})`),
      month: createEmptyBucket(monthId, `Месяц (${monthId})`),
      all: legacyAll
    };
    changed = true;
  }

  if (stats.periods.day.id !== dayId) {
    if (stats.periods.day.total_sessions > 0 || stats.periods.day.unique_users > 0) {
      stats.snapshots.day = cloneBucketWithTimestamp(stats.periods.day, mskStamp);
    }
    stats.periods.day = createEmptyBucket(dayId, `День (${dayId})`);
    changed = true;
  }

  if (stats.periods.week.id !== weekId) {
    if (stats.periods.week.total_sessions > 0 || stats.periods.week.unique_users > 0) {
      stats.snapshots.week = cloneBucketWithTimestamp(stats.periods.week, mskStamp);
    }
    stats.periods.week = createEmptyBucket(weekId, `Неделя (с ${weekId})`);
    changed = true;
  }

  if (stats.periods.month.id !== monthId) {
    if (stats.periods.month.total_sessions > 0 || stats.periods.month.unique_users > 0) {
      stats.snapshots.month = cloneBucketWithTimestamp(stats.periods.month, mskStamp);
    }
    stats.periods.month = createEmptyBucket(monthId, `Месяц (${monthId})`);
    changed = true;
  }

  syncLegacyTopFields(stats);
  return { stats, changed, dayId, weekId, monthId };
}

async function recordTelemetry(env, data) {
  if (!env.STATS_KV) return;
  try {
    const now = new Date();
    const moscowHour = parseInt(
      now.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", hour: "numeric", hour12: false }),
      10
    );

    const raw = (await env.STATS_KV.get("stats:summary", "json")) || {};
    const { stats, dayId } = ensurePeriodRotation(raw, now);

    const p = data.platform || "web";
    const r = data.role || "student";
    const cleanTarget = (data.target || "").trim();

    const bucketsToUpdate = [
      stats.periods.day,
      stats.periods.week,
      stats.periods.month,
      stats.periods.all
    ];

    for (const b of bucketsToUpdate) {
      b.total_sessions = (b.total_sessions || 0) + 1;
      b.platforms[p] = (b.platforms[p] || 0) + 1;
      b.roles[r] = (b.roles[r] || 0) + 1;

      if (r === "student" && cleanTarget) {
        const g = cleanTarget.toUpperCase();
        b.groups[g] = (b.groups[g] || 0) + 1;
      } else if (r === "teacher" && cleanTarget) {
        b.teachers[cleanTarget] = (b.teachers[cleanTarget] || 0) + 1;
      }

      if (moscowHour >= 0 && moscowHour < 24) {
        if (!Array.isArray(b.hourly) || b.hourly.length !== 24) b.hourly = Array(24).fill(0);
        b.hourly[moscowHour] = (b.hourly[moscowHour] || 0) + 1;
      }
    }

    if (data.isNewDayVisit) {
      stats.daily_dau[dayId] = (stats.daily_dau[dayId] || 0) + 1;
      stats.periods.day.unique_users = (stats.periods.day.unique_users || 0) + 1;
      stats.periods.all.unique_users = (stats.periods.all.unique_users || 0) + 1;
    }
    if (data.isNewWeekVisit || data.isNewDayVisit) {
      if (data.isNewWeekVisit !== false) {
        stats.periods.week.unique_users = (stats.periods.week.unique_users || 0) + 1;
      }
    }
    if (data.isNewMonthVisit || data.isNewDayVisit) {
      if (data.isNewMonthVisit !== false) {
        stats.periods.month.unique_users = (stats.periods.month.unique_users || 0) + 1;
      }
    }

    const days = Object.keys(stats.daily_dau || {}).sort();
    while (days.length > 31) {
      delete stats.daily_dau[days.shift()];
    }

    syncLegacyTopFields(stats);
    await env.STATS_KV.put("stats:summary", JSON.stringify(stats));
  } catch (err) {}
}

function formatBucketForClient(bucket) {
  if (!bucket) return null;
  const sortAll = (obj) =>
    Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

  return {
    id: bucket.id || "",
    label: bucket.label || "",
    saved_at: bucket.saved_at || "",
    total_sessions: bucket.total_sessions || 0,
    unique_users: bucket.unique_users || 0,
    platforms: bucket.platforms || { tg: 0, vk: 0, pwa: 0, web: 0 },
    roles: bucket.roles || { student: 0, teacher: 0 },
    all_groups: sortAll(bucket.groups),
    all_teachers: sortAll(bucket.teachers),
    hourly: Array.isArray(bucket.hourly) && bucket.hourly.length === 24 ? bucket.hourly : Array(24).fill(0)
  };
}

async function getAggregatedStats(env) {
  const { dayId, weekId, monthId } = getCycleIdsAt0259Msk(new Date());
  const emptyBucket = formatBucketForClient(createEmptyBucket("empty"));

  const fallback = {
    today_dau: 0,
    daily_dau: {},
    periods: {
      day: { ...emptyBucket, id: dayId },
      week: { ...emptyBucket, id: weekId },
      month: { ...emptyBucket, id: monthId },
      all: { ...emptyBucket, id: "all" }
    },
    snapshots: { day: null, week: null, month: null }
  };

  if (!env.STATS_KV) return fallback;

  try {
    const raw = (await env.STATS_KV.get("stats:summary", "json")) || {};
    const { stats, changed } = ensurePeriodRotation(raw, new Date());

    if (changed) {
      try { await env.STATS_KV.put("stats:summary", JSON.stringify(stats)); } catch (e) {}
    }

    return {
      today_dau: stats.periods.day.unique_users || stats.daily_dau[dayId] || 0,
      daily_dau: stats.daily_dau || {},
      periods: {
        day: formatBucketForClient(stats.periods.day),
        week: formatBucketForClient(stats.periods.week),
        month: formatBucketForClient(stats.periods.month),
        all: formatBucketForClient(stats.periods.all)
      },
      snapshots: {
        day: formatBucketForClient(stats.snapshots?.day),
        week: formatBucketForClient(stats.snapshots?.week),
        month: formatBucketForClient(stats.snapshots?.month)
      }
    };
  } catch (e) {
    return fallback;
  }
}

async function sendTgSimpleText(chatId, text, token, parseMode = null) {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function sendStatsMessage(chatId, env, url, token, adminKey) {
  const s = await getAggregatedStats(env);
  const d = s.periods.day;
  const w = s.periods.week;
  const m = s.periods.month;
  const all = s.periods.all;

  const topGrps = all.all_groups.slice(0, 5).map((g, i) => `${i + 1}. *${g.name}* — ${g.count}`).join("\n") || "Пока нет данных";

  const report =
    `📊 *Аналитический дашборд МГПУ ИИЯ*\n` +
    `_(Сброс циклов в 02:59 МСК)_\n\n` +
    `📅 *За сегодня (${d.id}):* ${d.total_sessions} откр. (${d.unique_users} уник.)\n` +
    `📆 *За неделю (с ${w.id}):* ${w.total_sessions} откр.\n` +
    `🗓 *За месяц (${m.id}):* ${m.total_sessions} откр.\n` +
    `🚀 *За всё время:* ${all.total_sessions} откр.\n\n` +
    `🔥 *Топ-5 групп (общий):*\n${topGrps}\n\n` +
    `🔗 [Открыть дашборд и управление ДЗ](https://${url.hostname}/admin?key=${adminKey})`;

  await sendTgSimpleText(chatId, report, token, "Markdown");
}

function renderAdminHtml(s, adminKey) {
  const moscowNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  const moscowHour = moscowNow.getHours();
  const moscowTimeStr = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit"
  });

  const dauEntries = Object.entries(s.daily_dau || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
  const maxDauVal = Math.max(...dauEntries.map(d => d[1]), 1);

  const dauChartHtml = dauEntries.length > 0 ? dauEntries.map(([dateStr, count]) => {
    const pct = Math.max(6, Math.round((count / maxDauVal) * 100));
    const shortDate = dateStr.slice(8, 10) + "." + dateStr.slice(5, 7);
    return `
      <div class="dau-col" title="${dateStr}: ${count} уник. чел.">
        <span class="dau-val">${count}</span>
        <div class="dau-track">
          <div class="dau-fill" style="height:${pct}%;"></div>
        </div>
        <span class="dau-date">${shortDate}</span>
      </div>
    `;
  }).join("") : `<div style="font-size:12px; color:var(--sub); padding:20px 0;">История DAU накапливается по дням...</div>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Аналитика и Управление ДЗ • МГПУ ИИЯ</title>
  <style>
    :root {
      --bg: #F4F5F8;
      --card: #FFFFFF;
      --text: #1D1D1B;
      --sub: #767882;
      --border: #E6E8F0;
      --track: #EEF0F5;
      --red: #E30613;
      --red-soft: rgba(227, 6, 19, 0.1);
      --blue: #0077FF;
      --inspector-bg: #F8F9FC;
    }
    [data-theme="dark"] {
      --bg: #101114;
      --card: #18191E;
      --text: #F3F4F6;
      --sub: #9CA3AF;
      --border: #2A2C34;
      --track: #24262D;
      --red: #FF3B30;
      --red-soft: rgba(255, 59, 48, 0.16);
      --blue: #3B82F6;
      --inspector-bg: #202229;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 20px 14px 50px; -webkit-tap-highlight-color: transparent; transition: background 0.2s, color 0.2s; }
    .container { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }

    .top-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; background: var(--card); padding: 14px 18px; border-radius: 16px; border: 1px solid var(--border); }
    .top-title h1 { font-size: 19px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
    .live-pill { background: #E8F5E9; color: #2E7D32; font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 20px; }
    .top-actions { display: flex; align-items: center; gap: 8px; }
    .btn-action { background: var(--inspector-bg); color: var(--text); border: 1px solid var(--border); padding: 7px 12px; border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
    .btn-action:hover { border-color: var(--red); }

    .period-bar {
      background: var(--card);
      padding: 12px 16px;
      border-radius: 16px;
      border: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .period-tabs {
      display: flex;
      background: var(--track);
      padding: 4px;
      border-radius: 12px;
      gap: 4px;
      flex-wrap: wrap;
    }
    .period-btn {
      border: none;
      background: transparent;
      color: var(--sub);
      font-size: 13px;
      font-weight: 800;
      padding: 8px 14px;
      border-radius: 9px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .period-btn.active {
      background: var(--red);
      color: #FFF;
      box-shadow: 0 2px 8px rgba(227, 6, 19, 0.3);
    }
    .period-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: var(--sub);
      font-weight: 600;
    }
    .snapshot-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--inspector-bg);
      border: 1px solid var(--border);
      padding: 6px 10px;
      border-radius: 9px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      color: var(--text);
    }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 680px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
    .card { background: var(--card); padding: 16px; border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 2px 12px rgba(0,0,0,0.02); }
    .metric-title { font-size: 11px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 6px; }
    .metric-value { font-size: 26px; font-weight: 800; color: var(--text); line-height: 1.1; }
    .metric-value.red { color: var(--red); }
    .metric-sub { font-size: 11px; color: var(--sub); margin-top: 6px; font-weight: 600; }

    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 680px) { .two-col { grid-template-columns: 1fr; } }
    .ratio-bar { height: 9px; background: var(--track); border-radius: 5px; overflow: hidden; display: flex; margin-top: 10px; }
    .legend-row { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-top: 9px; color: var(--sub); flex-wrap: wrap; gap: 6px; }
    .legend-row b { color: var(--text); }

    .section-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
    .segmented-tabs { display: flex; background: var(--track); padding: 3px; border-radius: 10px; gap: 3px; }
    .seg-btn { border: none; background: transparent; color: var(--sub); font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 7px; cursor: pointer; }
    .seg-btn.active { background: var(--card); color: var(--red); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }

    .shifts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    @media (max-width: 600px) { .shifts-grid { grid-template-columns: repeat(2, 1fr); } }
    .shift-box { background: var(--inspector-bg); border: 1px solid var(--border); border-radius: 11px; padding: 9px 11px; cursor: pointer; transition: border-color 0.15s; }
    .shift-box:hover { border-color: var(--red); }
    .shift-name { font-size: 11px; font-weight: 700; color: var(--sub); display: flex; justify-content: space-between; }
    .shift-val { font-size: 16px; font-weight: 800; color: var(--text); margin-top: 3px; }
    .shift-pct { font-size: 11px; font-weight: 700; color: var(--red); }

    .chart-inspector {
      background: var(--inspector-bg);
      border: 1px solid var(--border);
      border-left: 4px solid var(--red);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .inspector-left { display: flex; flex-direction: column; gap: 2px; }
    .inspector-time { font-size: 16px; font-weight: 800; color: var(--text); display: flex; align-items: center; gap: 8px; }
    .inspector-tag { font-size: 11px; font-weight: 700; background: var(--red-soft); color: var(--red); padding: 2px 8px; border-radius: 6px; }
    .inspector-context { font-size: 12px; color: var(--sub); font-weight: 500; }
    .inspector-stats { display: flex; gap: 16px; align-items: center; }
    .insp-stat-item { display: flex; flex-direction: column; align-items: flex-end; }
    .insp-stat-lbl { font-size: 10px; font-weight: 700; color: var(--sub); text-transform: uppercase; }
    .insp-stat-num { font-size: 15px; font-weight: 800; color: var(--text); }
    .insp-stat-num.red { color: var(--red); }

    .chart-wrapper { position: relative; padding-top: 18px; }
    .avg-line {
      position: absolute;
      left: 0; right: 0;
      border-top: 1.5px dashed rgba(227, 6, 19, 0.45);
      z-index: 2;
      pointer-events: none;
      display: flex;
      justify-content: flex-end;
      transition: bottom 0.3s ease;
    }
    .avg-line span {
      background: var(--card);
      color: var(--red);
      font-size: 9px;
      font-weight: 800;
      padding: 1px 5px;
      border-radius: 4px;
      transform: translateY(-50%);
      border: 1px solid var(--border);
    }
    .chart-container {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 155px;
      touch-action: pan-x;
    }
    .chart-bar-col {
      flex: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
      cursor: pointer;
    }
    .bar-top-val {
      font-size: 9px;
      font-weight: 800;
      color: var(--sub);
      margin-bottom: 3px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .chart-bar-col:hover .bar-top-val,
    .chart-bar-col.active .bar-top-val,
    .chart-bar-col.peak-hour .bar-top-val {
      opacity: 1;
      color: var(--red);
    }
    .chart-track {
      width: 100%;
      flex: 1;
      background: var(--track);
      border-radius: 5px;
      overflow: hidden;
      display: flex;
      align-items: flex-end;
      position: relative;
    }
    .chart-bar-fill {
      width: 100%;
      background: var(--red);
      border-radius: 5px 5px 0 0;
      transition: height 0.3s ease;
    }
    .chart-bar-col.peak-hour .chart-bar-fill {
      background: linear-gradient(180deg, #FF453A 0%, #B3000B 100%);
    }
    .chart-bar-col.current-hour .chart-track {
      outline: 1.5px solid var(--blue);
    }
    .chart-bar-col:hover .chart-bar-fill,
    .chart-bar-col.active .chart-bar-fill {
      filter: brightness(1.15);
      box-shadow: 0 0 10px rgba(227, 6, 19, 0.5);
    }
    .chart-axis-label {
      font-size: 9px;
      font-weight: 700;
      color: var(--sub);
      margin-top: 5px;
    }
    .chart-bar-col.current-hour .chart-axis-label {
      color: var(--blue);
      font-weight: 800;
    }
    @media (max-width: 520px) {
      .chart-bar-col:nth-child(odd) .chart-axis-label { visibility: hidden; }
      .chart-bar-col.current-hour .chart-axis-label,
      .chart-bar-col.active .chart-axis-label { visibility: visible !important; }
    }

    .hourly-table-wrap { display: none; max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; }
    table.hourly-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    table.hourly-table th { position: sticky; top: 0; background: var(--inspector-bg); color: var(--sub); text-align: left; padding: 8px 12px; font-size: 10px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
    table.hourly-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    table.hourly-table tr:hover { background: var(--inspector-bg); }
    .now-pill { background: var(--blue); color: #FFF; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 4px; margin-left: 4px; }

    .dau-container { display: flex; align-items: flex-end; gap: 8px; height: 110px; padding-top: 14px; overflow-x: auto; }
    .dau-col { flex: 1; min-width: 36px; height: 100%; display: flex; flex-direction: column; align-items: center; }
    .dau-val { font-size: 10px; font-weight: 800; color: var(--text); margin-bottom: 3px; }
    .dau-track { width: 100%; flex: 1; background: var(--track); border-radius: 5px; display: flex; align-items: flex-end; overflow: hidden; }
    .dau-fill { width: 100%; background: var(--blue); border-radius: 5px 5px 0 0; }
    .dau-date { font-size: 10px; font-weight: 600; color: var(--sub); margin-top: 5px; }

    .filter-input {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid var(--border);
      background: var(--inspector-bg);
      color: var(--text);
      border-radius: 10px;
      font-size: 12px;
      outline: none;
      margin-bottom: 10px;
    }
    .filter-input:focus { border-color: var(--red); }
    .rank-list { display: flex; flex-direction: column; gap: 9px; max-height: 360px; overflow-y: auto; padding-right: 4px; }
    .rank-item { display: flex; flex-direction: column; gap: 4px; }
    .rank-top { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; }
    .rank-name { display: flex; align-items: center; gap: 6px; }
    .rank-num { font-size: 11px; color: var(--sub); min-width: 22px; }
    .rank-actions { display: flex; align-items: center; gap: 8px; }
    .rank-share { font-size: 11px; color: var(--sub); font-weight: 600; }
    .edit-stat-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--sub);
      border-radius: 6px;
      padding: 2px 7px;
      font-size: 11px;
      cursor: pointer;
    }
    .edit-stat-btn:hover { color: var(--red); border-color: var(--red); }

    .hw-admin-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 520px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .hw-admin-card {
      background: var(--inspector-bg);
      border: 1px solid var(--border);
      border-left: 4px solid var(--blue);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .hw-admin-card.is-admin-hw {
      border-left-color: var(--red);
    }
    .hw-admin-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: var(--sub);
      margin-bottom: 6px;
    }
    .hw-group-pill {
      background: var(--red-soft);
      color: var(--red);
      padding: 2px 7px;
      border-radius: 6px;
      font-weight: 800;
    }
    .hw-week-pill {
      background: var(--track);
      color: var(--text);
      padding: 2px 7px;
      border-radius: 6px;
    }
    .admin-red-tag {
      color: var(--red);
      background: var(--red-soft);
      border: 1px solid rgba(227, 6, 19, 0.25);
      padding: 1px 6px;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 800;
      text-transform: lowercase;
      margin-left: 3px;
    }
    .hw-admin-lesson {
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }
    .hw-admin-text {
      font-size: 13px;
      color: var(--text);
      white-space: pre-wrap;
      line-height: 1.4;
      background: var(--card);
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .hw-admin-btns {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .btn-hw-edit, .btn-hw-del {
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-hw-edit:hover { border-color: var(--blue); color: var(--blue); }
    .btn-hw-del:hover { border-color: var(--red); color: var(--red); }

    .admin-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 16px;
      backdrop-filter: blur(3px);
    }
    .admin-modal-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      padding: 18px;
      box-shadow: 0 10px 35px rgba(0,0,0,0.3);
    }
    .admin-textarea {
      width: 100%;
      height: 120px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--inspector-bg);
      color: var(--text);
      font-size: 13px;
      resize: vertical;
      outline: none;
      margin: 10px 0;
    }
    .admin-textarea:focus { border-color: var(--red); }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <div class="top-title">
        <h1>
          <span>МГПУ ИИЯ • Дашборд 3.0</span>
          <span class="live-pill">● LIVE</span>
        </h1>
        <div style="font-size:12px; color:var(--sub); margin-top:2px;">
          Обновлено в ${moscowTimeStr} МСК • Авто-срез в 02:59 МСК
        </div>
      </div>
      <div class="top-actions">
        <button class="btn-action" onclick="exportStatsCsv()" title="Скачать выбранный период в CSV">📥 CSV</button>
        <button class="btn-action" onclick="toggleAdminTheme()" id="themeBtn">🌙 Тема</button>
        <button class="btn-action" onclick="location.reload()">🔄 Обновить</button>
      </div>
    </div>

    <div class="period-bar">
      <div class="period-tabs">
        <button class="period-btn" id="btnPeriodDay" onclick="selectPeriod('day')">📅 За 1 день</button>
        <button class="period-btn" id="btnPeriodWeek" onclick="selectPeriod('week')">📆 За неделю</button>
        <button class="period-btn" id="btnPeriodMonth" onclick="selectPeriod('month')">🗓️ За месяц</button>
        <button class="period-btn active" id="btnPeriodAll" onclick="selectPeriod('all')">♾️ За всё время</button>
      </div>
      <div class="period-meta">
        <span id="activePeriodBadge">Период: За всё время</span>
        <label class="snapshot-toggle" id="snapshotToggleWrap" style="display:none;" title="Показать сохраненный срез предыдущего периода (в 02:59 МСК)">
          <input type="checkbox" id="useSnapshotCheckbox" onchange="renderActivePeriod()">
          <span id="snapshotToggleLabel">Архив 02:59 МСК</span>
        </label>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="card">
        <div class="metric-title" id="kpiUniqueTitle">Уникальные пользователи</div>
        <div class="metric-value red" id="kpiUniqueVal">0</div>
        <div class="metric-sub" id="kpiUniqueSub">DAU сегодня: ${s.today_dau} чел.</div>
      </div>

      <div class="card">
        <div class="metric-title">Открытий за период</div>
        <div class="metric-value" id="kpiSessionsVal">0</div>
        <div class="metric-sub" id="kpiSessionsSub">Среднее в час: ~0 откр.</div>
      </div>

      <div class="card">
        <div class="metric-title">Охват за период</div>
        <div class="metric-value" id="kpiGroupsVal">0</div>
        <div class="metric-sub" id="kpiTeachersSub">Преподавателей: 0 чел.</div>
      </div>

      <div class="card">
        <div class="metric-title">Пиковый час периода</div>
        <div class="metric-value red" id="kpiPeakHourVal">00:00</div>
        <div class="metric-sub" id="kpiPeakHourSub">Максимум: 0 откр.</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="metric-title">Платформы запуска (за выбранный период)</div>
        <div class="ratio-bar" id="platformsBar"></div>
        <div class="legend-row" id="platformsLegend"></div>
      </div>

      <div class="card">
        <div class="metric-title">Студенты vs Преподаватели</div>
        <div class="ratio-bar" id="rolesBar"></div>
        <div class="legend-row" id="rolesLegend"></div>
      </div>
    </div>

    <div class="card">
      <div class="section-head" style="margin-bottom:10px;">
        <div>
          <div class="metric-title" style="margin-bottom:2px;">📝 Все домашние задания (Инспектор ДЗ) <span id="hwTotalCountBadge" style="color:var(--red);"></span></div>
          <div style="font-size:12px; color:var(--sub);">Просмотр, редактирование и удаление любых заданий всех групп института</div>
        </div>
        <button class="btn-action" onclick="loadAllHomeworks()">🔄 Обновить список ДЗ</button>
      </div>

      <input type="text" class="filter-input" id="hwSearchInput" placeholder="🔍 Поиск по группе, предмету, тексту ДЗ или автору..." oninput="renderAdminHomeworks()">

      <div class="hw-admin-grid" id="adminHwList">
        <div style="font-size:12px; color:var(--sub); padding:14px 0;">Загрузка домашних заданий...</div>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <div>
          <div class="metric-title" style="margin-bottom:2px;">Интерактивная карта активности по часам (МСК)</div>
          <div style="font-size:12px; color:var(--sub);">Нажмите на любой столбец, смену или проведите пальцем для детального разбора</div>
        </div>
        <div class="segmented-tabs">
          <button class="seg-btn active" id="tabViewChart" onclick="switchHourlyView('chart')">📊 График 24ч</button>
          <button class="seg-btn" id="tabViewTable" onclick="switchHourlyView('table')">📋 Таблица 24ч</button>
        </div>
      </div>

      <div class="shifts-grid" id="shiftsGrid"></div>

      <div class="chart-inspector">
        <div class="inspector-left">
          <div class="inspector-time">
            <span id="inspectTime">08:00 – 09:00</span>
            <span class="inspector-tag" id="inspectTag">🔥 Пик</span>
          </div>
          <div class="inspector-context" id="inspectContext">Максимальная нагрузка</div>
        </div>
        <div class="inspector-stats">
          <div class="insp-stat-item">
            <span class="insp-stat-lbl">Открытий</span>
            <span class="insp-stat-num red" id="inspectCount">0</span>
          </div>
          <div class="insp-stat-item">
            <span class="insp-stat-lbl">Доля периода</span>
            <span class="insp-stat-num" id="inspectShare">0%</span>
          </div>
          <div class="insp-stat-item">
            <span class="insp-stat-lbl">К среднему</span>
            <span class="insp-stat-num" id="inspectDiff">0%</span>
          </div>
        </div>
      </div>

      <div class="chart-wrapper" id="hourlyChartView">
        <div class="avg-line" id="avgLineEl" style="bottom:20%;">
          <span id="avgLineText">Среднее: 0/ч</span>
        </div>
        <div class="chart-container" id="chartContainer"></div>
      </div>

      <div class="hourly-table-wrap" id="hourlyTableView">
        <table class="hourly-table">
          <thead>
            <tr>
              <th>Интервал (МСК)</th>
              <th>Открытий</th>
              <th>Доля периода</th>
              <th style="text-align:right;">К норме</th>
            </tr>
          </thead>
          <tbody id="hourlyTableBody"></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="section-head" style="margin-bottom:4px;">
        <div>
          <div class="metric-title" style="margin-bottom:2px;">Динамика уникальных пользователей по дням (DAU, срез 02:59 МСК)</div>
          <div style="font-size:12px; color:var(--sub);">Ежедневная аудитория за последние 14 суток</div>
        </div>
      </div>
      <div class="dau-container">
        ${dauChartHtml}
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="section-head" style="margin-bottom:10px;">
          <div class="metric-title" style="margin-bottom:0;" id="groupsBoxTitle">🎓 Рейтинг групп</div>
          <div class="segmented-tabs">
            <button class="seg-btn active" onclick="setGroupLimit(5, this)">Топ-5</button>
            <button class="seg-btn" onclick="setGroupLimit(15, this)">Топ-15</button>
            <button class="seg-btn" onclick="setGroupLimit(999, this)">Все</button>
          </div>
        </div>

        <input type="text" class="filter-input" placeholder="🔍 Найти группу (например: ВЦК, ПОЕ)..." oninput="filterGroups(this.value)">
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:11px; color:var(--sub);">
          <label style="display:flex; align-items:center; gap:5px; cursor:pointer;">
            <input type="checkbox" id="smoothScaleToggle" onchange="renderGroupsList()">
            <span>Сгладить масштаб полосок</span>
          </label>
          <span>Нажмите ✏️ для правки</span>
        </div>

        <div class="rank-list" id="groupsRankContainer"></div>
      </div>

      <div class="card">
        <div class="section-head" style="margin-bottom:10px;">
          <div class="metric-title" style="margin-bottom:0;" id="teachersBoxTitle">👨‍🏫 Преподаватели</div>
          <div class="segmented-tabs">
            <button class="seg-btn active" onclick="setTeacherLimit(5, this)">Топ-5</button>
            <button class="seg-btn" onclick="setTeacherLimit(15, this)">Топ-15</button>
            <button class="seg-btn" onclick="setTeacherLimit(999, this)">Все</button>
          </div>
        </div>

        <input type="text" class="filter-input" placeholder="🔍 Найти преподавателя..." oninput="filterTeachers(this.value)">
        <div style="font-size:11px; color:var(--sub); margin-bottom:10px;">Переходы по расписанию преподавателей за выбранный период</div>

        <div class="rank-list" id="teachersRankContainer"></div>
      </div>
    </div>
  </div>

  <div class="admin-modal-overlay" id="adminHwModal">
    <div class="admin-modal-box">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <div style="font-size:16px; font-weight:800;">✏️ Редактирование ДЗ</div>
        <button class="btn-action" onclick="closeAdminHwModal()">✕</button>
      </div>
      <div id="adminHwModalMeta" style="font-size:12px; color:var(--sub); margin-bottom:6px;"></div>
      <textarea id="adminHwTextarea" class="admin-textarea" maxlength="1000"></textarea>
      <label style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; cursor:pointer; margin-bottom:14px;">
        <input type="checkbox" id="adminSignCheck" checked>
        <span>Поставить красную метку <b style="color:var(--red);">админ</b> рядом с автором</span>
      </label>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn-action" onclick="closeAdminHwModal()">Отмена</button>
        <button class="btn-action" style="background:var(--red); color:#FFF; border-color:var(--red);" onclick="saveAdminHwEdit()">💾 Сохранить изменения</button>
      </div>
    </div>
  </div>

  <script>
    const ADMIN_KEY = ${JSON.stringify(adminKey)};
    const PERIODS_DATA = ${JSON.stringify(s.periods)};
    const SNAPSHOTS_DATA = ${JSON.stringify(s.snapshots)};
    const TODAY_DAU = ${s.today_dau || 0};
    const currentMskHour = ${moscowHour};

    let activePeriodKey = 'all';
    let currentBucket = PERIODS_DATA.all;
    let groupLimit = 5;
    let teacherLimit = 5;
    let groupQuery = "";
    let teacherQuery = "";

    let allHomeworksList = [];
    let editingHwTarget = null;

    function initAdminTheme() {
      const saved = localStorage.getItem('mcu_admin_theme') || 'light';
      document.documentElement.setAttribute('data-theme', saved);
      document.getElementById('themeBtn').textContent = saved === 'dark' ? '☀️ Светлая' : '🌙 Тёмная';
    }
    function toggleAdminTheme() {
      const curr = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('mcu_admin_theme', curr);
      initAdminTheme();
    }
    initAdminTheme();

    function isAdminAuthorCheck(author) {
      if (!author) return false;
      if (author.is_admin === true) return true;
      const b = (author.badge || '').toLowerCase();
      return b === '@kommunalkamus' || b === 'kommunalkamus';
    }

    function formatLessonKeyReadable(lessonKey) {
      const parts = (lessonKey || '').split('_');
      if (parts.length < 3) return lessonKey;
      const day = parts[0];
      const pair = parts[1];
      const rest = parts.slice(2).join(' ');
      return \`\${day} • \${pair} пара • \${rest}\`;
    }

    async function loadAllHomeworks() {
      const container = document.getElementById('adminHwList');
      container.innerHTML = "<div style='font-size:12px; color:var(--sub); padding:14px 0;'>Загрузка списка ДЗ...</div>";
      try {
        const res = await fetch(\`/admin/hw-list?key=\${encodeURIComponent(ADMIN_KEY)}\`);
        const data = await res.json();
        allHomeworksList = data.items || [];
        document.getElementById('hwTotalCountBadge').textContent = \`(\${allHomeworksList.length})\`;
        renderAdminHomeworks();
      } catch (e) {
        container.innerHTML = "<div style='font-size:12px; color:var(--red);'>Ошибка загрузки списка ДЗ</div>";
      }
    }

    function renderAdminHomeworks() {
      const container = document.getElementById('adminHwList');
      const q = (document.getElementById('hwSearchInput')?.value || '').trim().toLowerCase();

      const filtered = allHomeworksList.filter(item => {
        if (!q) return true;
        return item.group.toLowerCase().includes(q) ||
               item.lessonKey.toLowerCase().includes(q) ||
               item.text.toLowerCase().includes(q) ||
               (item.author?.badge || '').toLowerCase().includes(q);
      });

      if (filtered.length === 0) {
        container.innerHTML = "<div style='font-size:12px; color:var(--sub); padding:10px 0;'>Домашних заданий не найдено</div>";
        return;
      }

      container.innerHTML = filtered.map((item, idx) => {
        const isAdm = isAdminAuthorCheck(item.author);
        const icon = item.author?.platform === 'tg' ? '📱' : (item.author?.platform === 'vk' ? '🔵' : '🌐');
        const adminTagHtml = isAdm ? '<span class="admin-red-tag">админ</span>' : '';
        const readableLesson = formatLessonKeyReadable(item.lessonKey);

        return \`
          <div class="hw-admin-card \${isAdm ? 'is-admin-hw' : ''}">
            <div style="flex:1; min-width:0;">
              <div class="hw-admin-meta">
                <span class="hw-group-pill">🎓 \${escapeHtml(item.group)}</span>
                <span class="hw-week-pill">\${escapeHtml(String(item.week))} нед.</span>
                <span>Автор: \${icon} <b>\${escapeHtml(item.author?.badge || 'Студент')}</b>\${adminTagHtml}</span>
                \${item.updated_at ? \`<span>• \${escapeHtml(item.updated_at)}</span>\` : ''}
              </div>
              <div class="hw-admin-lesson">\${escapeHtml(readableLesson)}</div>
              <div class="hw-admin-text">\${escapeHtml(item.text)}</div>
            </div>
            <div class="hw-admin-btns">
              <button class="btn-hw-edit" onclick="openAdminHwEdit(\${idx})" title="Редактировать ДЗ">✏️ Изм.</button>
              <button class="btn-hw-del" onclick="deleteAdminHw(\${idx})" title="Удалить ДЗ">🗑️</button>
            </div>
          </div>
        \`;
      }).join('');

      window._filteredAdminHw = filtered;
    }

    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function openAdminHwEdit(filteredIdx) {
      const item = window._filteredAdminHw?.[filteredIdx];
      if (!item) return;
      editingHwTarget = item;
      document.getElementById('adminHwModalMeta').textContent = \`\${item.group} • \${item.week} неделя • \${formatLessonKeyReadable(item.lessonKey)}\`;
      document.getElementById('adminHwTextarea').value = item.text;
      document.getElementById('adminSignCheck').checked = true;
      document.getElementById('adminHwModal').style.display = 'flex';
    }

    function closeAdminHwModal() {
      document.getElementById('adminHwModal').style.display = 'none';
      editingHwTarget = null;
    }

    async function saveAdminHwEdit() {
      if (!editingHwTarget) return;
      const newText = document.getElementById('adminHwTextarea').value.trim();
      const signAsAdmin = document.getElementById('adminSignCheck').checked;
      if (!newText) {
        alert("Текст задания не может быть пустым");
        return;
      }

      try {
        const res = await fetch(\`/admin/hw-action?key=\${encodeURIComponent(ADMIN_KEY)}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeKey: editingHwTarget.storeKey,
            lessonKey: editingHwTarget.lessonKey,
            text: newText,
            signAsAdmin: signAsAdmin,
            isDelete: false
          })
        });
        const ans = await res.json();
        if (ans.ok) {
          closeAdminHwModal();
          await loadAllHomeworks();
        } else {
          alert(ans.error || "Ошибка сохранения");
        }
      } catch (e) {
        alert("Ошибка сети при сохранении ДЗ");
      }
    }

    async function deleteAdminHw(filteredIdx) {
      const item = window._filteredAdminHw?.[filteredIdx];
      if (!item) return;
      if (!confirm(\`Удалить домашнее задание у группы «\${item.group}» (\${item.week} нед.)?\`)) return;

      try {
        const res = await fetch(\`/admin/hw-action?key=\${encodeURIComponent(ADMIN_KEY)}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeKey: item.storeKey,
            lessonKey: item.lessonKey,
            isDelete: true
          })
        });
        const ans = await res.json();
        if (ans.ok) {
          await loadAllHomeworks();
        } else {
          alert(ans.error || "Ошибка удаления");
        }
      } catch (e) {
        alert("Ошибка сети при удалении ДЗ");
      }
    }

    function selectPeriod(pKey) {
      activePeriodKey = pKey;
      document.getElementById('btnPeriodDay').classList.toggle('active', pKey === 'day');
      document.getElementById('btnPeriodWeek').classList.toggle('active', pKey === 'week');
      document.getElementById('btnPeriodMonth').classList.toggle('active', pKey === 'month');
      document.getElementById('btnPeriodAll').classList.toggle('active', pKey === 'all');

      const snapWrap = document.getElementById('snapshotToggleWrap');
      const snapCheck = document.getElementById('useSnapshotCheckbox');
      snapCheck.checked = false;

      if (pKey !== 'all' && SNAPSHOTS_DATA && SNAPSHOTS_DATA[pKey]) {
        snapWrap.style.display = 'inline-flex';
        const snapNames = { day: 'Вчера (срез 02:59)', week: 'Прошлая нед. (ПН 02:59)', month: 'Прошлый мес. (01 числа 02:59)' };
        document.getElementById('snapshotToggleLabel').textContent = snapNames[pKey] || 'Архив 02:59';
      } else {
        snapWrap.style.display = 'none';
      }

      renderActivePeriod();
    }

    function renderActivePeriod() {
      const useSnap = document.getElementById('useSnapshotCheckbox')?.checked;
      if (activePeriodKey !== 'all' && useSnap && SNAPSHOTS_DATA[activePeriodKey]) {
        currentBucket = SNAPSHOTS_DATA[activePeriodKey];
      } else {
        currentBucket = PERIODS_DATA[activePeriodKey] || PERIODS_DATA.all;
      }

      const periodTitles = {
        day: \`День (\${currentBucket.id}) • сброс в 02:59 МСК\`,
        week: \`Неделя (с ПН \${currentBucket.id}) • сброс в ПН 02:59 МСК\`,
        month: \`Месяц (\${currentBucket.id}) • сброс 1-го числа в 02:59 МСК\`,
        all: 'За всё время наблюдения'
      };
      document.getElementById('activePeriodBadge').textContent = useSnap
        ? \`📦 Архивный срез (\${currentBucket.id}, сохранён \${currentBucket.saved_at || 'в 02:59 МСК'})\`
        : periodTitles[activePeriodKey];

      const hArr = currentBucket.hourly || Array(24).fill(0);
      const totalHourly = hArr.reduce((a, b) => a + b, 0) || 1;
      const avgHourly = Math.round((currentBucket.total_sessions || 0) / 24);
      const maxHourVal = Math.max(...hArr, 1);
      const peakHourIdx = hArr.indexOf(maxHourVal);
      const peakHourStr = String(peakHourIdx).padStart(2, '0') + ':00';

      const uniqueLabels = { day: 'Уникальные за день (DAU)', week: 'Уникальные за неделю (WAU)', month: 'Уникальные за месяц (MAU)', all: 'Уникальные (суммарно)' };
      document.getElementById('kpiUniqueTitle').textContent = uniqueLabels[activePeriodKey];
      document.getElementById('kpiUniqueVal').textContent = currentBucket.unique_users || 0;
      document.getElementById('kpiUniqueSub').textContent = \`Сегодня активны: \${TODAY_DAU} чел.\`;

      document.getElementById('kpiSessionsVal').textContent = currentBucket.total_sessions || 0;
      document.getElementById('kpiSessionsSub').textContent = \`Среднее в час: ~\${avgHourly} откр.\`;

      document.getElementById('kpiGroupsVal').innerHTML = \`\${currentBucket.all_groups.length} <span style="font-size:14px; font-weight:700; color:var(--sub);">гр.</span>\`;
      document.getElementById('kpiTeachersSub').textContent = \`Преподавателей: \${currentBucket.all_teachers.length} чел.\`;

      document.getElementById('kpiPeakHourVal').textContent = peakHourStr;
      document.getElementById('kpiPeakHourSub').textContent = \`Максимум: \${hArr[peakHourIdx] || 0} откр.\`;

      const pf = currentBucket.platforms || { tg: 0, vk: 0, pwa: 0, web: 0 };
      const totalP = (pf.tg + pf.vk + pf.pwa + pf.web) || 1;
      const tgPct = Math.round((pf.tg / totalP) * 100);
      const vkPct = Math.round((pf.vk / totalP) * 100);
      const pwaPct = Math.round((pf.pwa / totalP) * 100);
      const webPct = Math.max(0, 100 - tgPct - vkPct - pwaPct);

      document.getElementById('platformsBar').innerHTML = \`
        <div style="width:\${tgPct}%; background:#2AABEE;"></div>
        <div style="width:\${vkPct}%; background:#0077FF;"></div>
        <div style="width:\${pwaPct}%; background:#E30613;"></div>
        <div style="width:\${webPct}%; background:#9CA3AF;"></div>
      \`;
      document.getElementById('platformsLegend').innerHTML = \`
        <span>📱 TG: <b>\${pf.tg} (\${tgPct}%)</b></span>
        <span>🔵 VK: <b>\${pf.vk} (\${vkPct}%)</b></span>
        <span>📲 PWA: <b>\${pf.pwa} (\${pwaPct}%)</b></span>
        <span>🌐 Web: <b>\${pf.web} (\${webPct}%)</b></span>
      \`;

      const rl = currentBucket.roles || { student: 0, teacher: 0 };
      const totalR = (rl.student + rl.teacher) || 1;
      const studPct = Math.round((rl.student / totalR) * 100);
      const teachPct = Math.max(0, 100 - studPct);

      document.getElementById('rolesBar').innerHTML = \`
        <div style="width:\${studPct}%; background:#E30613;"></div>
        <div style="width:\${teachPct}%; background:#0077FF;"></div>
      \`;
      document.getElementById('rolesLegend').innerHTML = \`
        <span>🎓 Студенты: <b>\${rl.student} (\${studPct}%)</b></span>
        <span>👨‍🏫 Преподаватели: <b>\${rl.teacher} (\${teachPct}%)</b></span>
      \`;

      const sumR = (hrs) => hrs.reduce((acc, h) => acc + (hArr[h] || 0), 0);
      const mSum = sumR([6,7,8,9,10,11]);
      const dSum = sumR([12,13,14,15,16,17]);
      const eSum = sumR([18,19,20,21,22]);
      const nSum = sumR([23,0,1,2,3,4,5]);

      document.getElementById('shiftsGrid').innerHTML = \`
        <div class="shift-box" onclick="inspectHour(8)">
          <div class="shift-name"><span>🌅 Утро (06–12)</span><span class="shift-pct">\${Math.round((mSum / totalHourly) * 100)}%</span></div>
          <div class="shift-val">\${mSum} <span style="font-size:11px; font-weight:600; color:var(--sub);">откр.</span></div>
        </div>
        <div class="shift-box" onclick="inspectHour(12)">
          <div class="shift-name"><span>☀️ День (12–18)</span><span class="shift-pct">\${Math.round((dSum / totalHourly) * 100)}%</span></div>
          <div class="shift-val">\${dSum} <span style="font-size:11px; font-weight:600; color:var(--sub);">откр.</span></div>
        </div>
        <div class="shift-box" onclick="inspectHour(18)">
          <div class="shift-name"><span>🌆 Вечер (18–23)</span><span class="shift-pct">\${Math.round((eSum / totalHourly) * 100)}%</span></div>
          <div class="shift-val">\${eSum} <span style="font-size:11px; font-weight:600; color:var(--sub);">откр.</span></div>
        </div>
        <div class="shift-box" onclick="inspectHour(23)">
          <div class="shift-name"><span>🌙 Ночь (23–06)</span><span class="shift-pct">\${Math.round((nSum / totalHourly) * 100)}%</span></div>
          <div class="shift-val">\${nSum} <span style="font-size:11px; font-weight:600; color:var(--sub);">откр.</span></div>
        </div>
      \`;

      const avgLinePct = Math.min(95, Math.max(5, Math.round((avgHourly / maxHourVal) * 100)));
      document.getElementById('avgLineEl').style.bottom = avgLinePct + '%';
      document.getElementById('avgLineText').textContent = \`Среднее: \${avgHourly}/ч\`;

      document.getElementById('chartContainer').innerHTML = hArr.map((val, h) => {
        const hStr = String(h).padStart(2, '0');
        const pct = Math.max(3, Math.round((val / maxHourVal) * 100));
        const isCurrent = (h === currentMskHour);
        const isPeak = (h === peakHourIdx && val > 0);
        return \`
          <div class="chart-bar-col \${isCurrent ? 'current-hour' : ''} \${isPeak ? 'peak-hour' : ''}" data-hour="\${h}" onmouseenter="inspectHour(\${h})" onclick="inspectHour(\${h})">
            <span class="bar-top-val">\${val}</span>
            <div class="chart-track">
              <div class="chart-bar-fill" style="height:\${pct}%;"></div>
            </div>
            <span class="chart-axis-label">\${hStr}</span>
          </div>
        \`;
      }).join('');

      document.getElementById('hourlyTableBody').innerHTML = hArr.map((val, h) => {
        const hStart = String(h).padStart(2, '0') + ':00';
        const hEnd = String((h + 1) % 24).padStart(2, '0') + ':00';
        const share = ((val / totalHourly) * 100).toFixed(1);
        const pctBar = Math.round((val / maxHourVal) * 100);
        const diffAvg = avgHourly > 0 ? Math.round(((val - avgHourly) / avgHourly) * 100) : 0;
        const diffBadge = diffAvg >= 0
          ? \`<span style="color:#10B981; font-weight:700;">+\${diffAvg}%</span>\`
          : \`<span style="color:var(--sub);">\${diffAvg}%</span>\`;
        return \`
          <tr onclick="inspectHour(\${h})" style="cursor:pointer;">
            <td style="font-weight:700;">\${hStart} – \${hEnd} \${h === currentMskHour ? '<span class="now-pill">СЕЙЧАС</span>' : ''}</td>
            <td style="font-weight:800; color:var(--red);">\${val}</td>
            <td>
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; height:6px; background:var(--track); border-radius:3px; overflow:hidden; min-width:50px;">
                  <div style="height:100%; width:\${pctBar}%; background:var(--red);"></div>
                </div>
                <span style="font-size:11px; font-weight:600; min-width:34px;">\${share}%</span>
              </div>
            </td>
            <td style="font-size:11px; text-align:right;">\${diffBadge}</td>
          </tr>
        \`;
      }).join('');

      document.getElementById('groupsBoxTitle').textContent = \`🎓 Рейтинг групп (\${currentBucket.all_groups.length})\`;
      document.getElementById('teachersBoxTitle').textContent = \`👨‍🏫 Преподаватели (\${currentBucket.all_teachers.length})\`;

      renderGroupsList();
      renderTeachersList();
      inspectHour(peakHourIdx);
    }

    function switchHourlyView(mode) {
      document.getElementById('tabViewChart').classList.toggle('active', mode === 'chart');
      document.getElementById('tabViewTable').classList.toggle('active', mode === 'table');
      document.getElementById('hourlyChartView').style.display = mode === 'chart' ? 'block' : 'none';
      document.getElementById('hourlyTableView').style.display = mode === 'table' ? 'block' : 'none';
    }

    function inspectHour(h) {
      const hArr = currentBucket.hourly || Array(24).fill(0);
      const totalHourly = hArr.reduce((a, b) => a + b, 0) || 1;
      const avgHourly = Math.round((currentBucket.total_sessions || 0) / 24);
      const maxHourVal = Math.max(...hArr, 1);
      const peakHourIndex = hArr.indexOf(maxHourVal);

      document.querySelectorAll('.chart-bar-col').forEach(el => el.classList.remove('active'));
      const activeCol = document.querySelector(\`.chart-bar-col[data-hour="\${h}"]\`);
      if (activeCol) activeCol.classList.add('active');

      const val = hArr[h] || 0;
      const hStart = String(h).padStart(2, '0') + ':00';
      const hEnd = String((h + 1) % 24).padStart(2, '0') + ':00';
      const share = totalHourly > 0 ? ((val / totalHourly) * 100).toFixed(1) : '0.0';
      const diffPct = avgHourly > 0 ? Math.round(((val - avgHourly) / avgHourly) * 100) : 0;

      let tag = '';
      let context = '';
      if (h === peakHourIndex && val > 0) tag = '🔥 Пик периода';
      else if (h === currentMskHour) tag = '⚡️ Текущий час';
      else if (h >= 7 && h <= 11) tag = '🌅 Утренняя смена';
      else if (h >= 12 && h <= 17) tag = '☀️ Дневная смена';
      else if (h >= 18 && h <= 22) tag = '🌆 Вечер / ДЗ';
      else tag = '🌙 Ночное время';

      if (h === 8 || h === 9) context = 'Перед 1-й парой (09:00–10:20) — проверка кабинетов';
      else if (h === 10 || h === 11) context = 'Идёт 2-я пара (10:30–11:50)';
      else if (h === 12 || h === 13) context = 'Большая перемена и 3-я пара (12:40–14:00)';
      else if (h === 14 || h === 15) context = 'Идёт 4-я пара (14:10–15:30)';
      else if (h === 16 || h === 17) context = 'Вечерние пары (5–6 пара)';
      else if (h >= 18 && h <= 22) context = 'Подготовка к следующему дню и запись домашних заданий';
      else context = 'Ночные просмотры расписания (ротация суток в 02:59 МСК)';

      document.getElementById('inspectTime').textContent = \`\${hStart} – \${hEnd}\`;
      document.getElementById('inspectTag').textContent = tag;
      document.getElementById('inspectContext').textContent = context;
      document.getElementById('inspectCount').textContent = val;
      document.getElementById('inspectShare').textContent = \`\${share}%\`;
      document.getElementById('inspectDiff').textContent = (diffPct >= 0 ? '+' : '') + diffPct + '%';
      document.getElementById('inspectDiff').style.color = diffPct >= 0 ? '#10B981' : 'var(--sub)';
    }

    const chartEl = document.getElementById('chartContainer');
    function handleChartTouch(e) {
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const barCol = target ? target.closest('.chart-bar-col') : null;
      if (barCol) {
        const h = parseInt(barCol.getAttribute('data-hour'), 10);
        if (!isNaN(h)) inspectHour(h);
      }
    }
    chartEl.addEventListener('touchstart', handleChartTouch, { passive: true });
    chartEl.addEventListener('touchmove', handleChartTouch, { passive: true });

    function renderGroupsList() {
      const container = document.getElementById('groupsRankContainer');
      const smooth = document.getElementById('smoothScaleToggle')?.checked;
      const list = currentBucket.all_groups || [];
      const totalGroupHits = list.reduce((a, b) => a + b.count, 0) || 1;

      const filtered = list
        .filter(g => !groupQuery || g.name.toLowerCase().includes(groupQuery))
        .slice(0, groupLimit);

      if (filtered.length === 0) {
        container.innerHTML = "<div style='font-size:12px; color:var(--sub);'>За выбранный период данных пока нет</div>";
        return;
      }

      const maxVal = filtered[0]?.count || 1;
      const secondVal = filtered[1]?.count || maxVal;

      container.innerHTML = filtered.map((g, idx) => {
        const share = ((g.count / totalGroupHits) * 100).toFixed(1);
        let barPct = Math.round((g.count / maxVal) * 100);
        if (smooth && maxVal > secondVal * 2.5) {
          barPct = Math.min(100, Math.round((Math.sqrt(g.count) / Math.sqrt(maxVal)) * 100));
        }
        const safeName = g.name.replace(/'/g, "\'");
        return \`
          <div class="rank-item">
            <div class="rank-top">
              <div class="rank-name">
                <span class="rank-num">#\${idx + 1}</span>
                <span>🎓 \${g.name}</span>
              </div>
              <div class="rank-actions">
                <span class="rank-share">\${share}%</span>
                <span style="color:var(--red); min-width:28px; text-align:right;">\${g.count}</span>
                <button class="edit-stat-btn" onclick="editStatValue('group', '\${safeName}', \${g.count})" title="Исправить счётчик">✏️</button>
              </div>
            </div>
            <div style="height:6px; background:var(--track); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:\${barPct}%; background:var(--red); transition:width 0.25s;"></div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderTeachersList() {
      const container = document.getElementById('teachersRankContainer');
      const list = currentBucket.all_teachers || [];
      const totalTeachHits = list.reduce((a, b) => a + b.count, 0) || 1;

      const filtered = list
        .filter(t => !teacherQuery || t.name.toLowerCase().includes(teacherQuery))
        .slice(0, teacherLimit);

      if (filtered.length === 0) {
        container.innerHTML = "<div style='font-size:12px; color:var(--sub);'>За выбранный период данных пока нет</div>";
        return;
      }

      const maxVal = filtered[0]?.count || 1;

      container.innerHTML = filtered.map((t, idx) => {
        const share = ((t.count / totalTeachHits) * 100).toFixed(1);
        const barPct = Math.round((t.count / maxVal) * 100);
        const safeName = t.name.replace(/'/g, "\'");
        return \`
          <div class="rank-item">
            <div class="rank-top">
              <div class="rank-name">
                <span class="rank-num">#\${idx + 1}</span>
                <span>👨‍🏫 \${t.name}</span>
              </div>
              <div class="rank-actions">
                <span class="rank-share">\${share}%</span>
                <span style="color:var(--blue); min-width:28px; text-align:right;">\${t.count}</span>
                <button class="edit-stat-btn" onclick="editStatValue('teacher', '\${safeName}', \${t.count})" title="Исправить счётчик">✏️</button>
              </div>
            </div>
            <div style="height:6px; background:var(--track); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:\${barPct}%; background:var(--blue); transition:width 0.25s;"></div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function setGroupLimit(lim, btn) {
      groupLimit = lim;
      btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGroupsList();
    }

    function setTeacherLimit(lim, btn) {
      teacherLimit = lim;
      btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTeachersList();
    }

    function filterGroups(q) {
      groupQuery = (q || '').trim().toLowerCase();
      renderGroupsList();
    }

    function filterTeachers(q) {
      teacherQuery = (q || '').trim().toLowerCase();
      renderTeachersList();
    }

    async function editStatValue(category, targetName, currentVal) {
      const input = prompt(
        \`Изменить количество заходов для «\${targetName}» в периоде «\${activePeriodKey}»:
(Введите новое число или 0 для удаления)\`,
        currentVal
      );
      if (input === null) return;
      const newVal = parseInt(input, 10);
      if (isNaN(newVal)) return;

      try {
        const res = await fetch(\`/admin/update-stat?key=\${encodeURIComponent(ADMIN_KEY)}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ periodKey: activePeriodKey, category, target: targetName, value: newVal })
        });
        const ans = await res.json();
        if (ans.ok) location.reload();
        else alert(ans.error || "Ошибка сохранения");
      } catch (e) {
        alert("Ошибка сети при обновлении счетчика");
      }
    }

    function exportStatsCsv() {
      let csv = \`﻿Период: \${activePeriodKey} (\${currentBucket.id})
Категория;Название / Час;Значение
\`;
      (currentBucket.hourly || []).forEach((v, h) => {
        csv += \`Час МСК;\${String(h).padStart(2, '0')}:00;\${v}
\`;
      });
      (currentBucket.all_groups || []).forEach(g => {
        csv += \`Группа;\${g.name};\${g.count}
\`;
      });
      (currentBucket.all_teachers || []).forEach(t => {
        csv += \`Преподаватель;\${t.name};\${t.count}
\`;
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = \`mcu_stats_\${activePeriodKey}_\${currentBucket.id}.csv\`;
      link.click();
    }

    renderActivePeriod();
    loadAllHomeworks();
  </script>
</body>
</html>`;
}

export default {
  /* ============================================================
     ПЛАНОВЫЙ ЗАПУСК ПО РАСПИСАНИЮ В 02:59 МСК (CRON: 59 23 * * *)
  ============================================================ */
  async scheduled(event, env, ctx) {
    if (!env.STATS_KV) return;
    ctx.waitUntil((async () => {
      try {
        const raw = (await env.STATS_KV.get("stats:summary", "json")) || {};
        const checkTime = new Date(Date.now() + 65 * 1000);
        const { stats, changed } = ensurePeriodRotation(raw, checkTime);
        if (changed) {
          await env.STATS_KV.put("stats:summary", JSON.stringify(stats));
        }
      } catch (e) {}
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const TG_TOKEN = env.TG_TOKEN || "";
    const VK_GROUP_TOKEN = env.VK_GROUP_TOKEN || "";
    const TG_WEBHOOK_SECRET = env.TG_WEBHOOK_SECRET || "";
    const ADMIN_PASS = env.ADMIN_PASS || "mcu2026";
    const ADMIN_SECRET_KEY = env.ADMIN_SECRET_KEY || "mcu2026";
    const ADMIN_TG_ID = String(env.ADMIN_TG_ID || "123456789");
    const ADMIN_VK_ID = String(env.ADMIN_VK_ID || "242671645");
    const ADMIN_TG_USERNAME = (env.ADMIN_TG_USERNAME || "kommunalkamus").toLowerCase().replace(/^@/, "");

    /* ============================================================
       1. ГЕНЕРАТОР КАЛЕНДАРЯ ICAL (.ICS) ДЛЯ СТУДЕНТОВ И ПРЕПОДАВАТЕЛЕЙ
    ============================================================ */
    if (url.pathname === "/api/cal.ics" || url.pathname === "/api/cal") {
      const teacher = url.searchParams.get("teacher");
      const group = url.searchParams.get("group");

      if (!teacher && !group) {
        return new Response("Не указана группа или преподаватель", { status: 400, headers: corsHeaders });
      }

      try {
        const scheduleRes = await fetch("https://rom41g.github.io/mcu-schedule/schedule.json", {
          cf: { cacheTtl: 3600, cacheEverything: true }
        });
        if (!scheduleRes.ok) {
          return new Response("Ошибка получения расписания", { status: 502, headers: corsHeaders });
        }
        const db = await scheduleRes.json();

        let targetType = "";
        let matchedKey = null;
        let lessons = [];

        if (teacher) {
          targetType = "teacher";
          const normTarget = teacher.trim().toLowerCase();
          for (const k of Object.keys(db.teachers || {})) {
            if (k.trim().toLowerCase() === normTarget) {
              matchedKey = k;
              lessons = db.teachers[k] || [];
              break;
            }
          }
        } else if (group) {
          targetType = "student";
          const normTarget = group.trim().toLowerCase();
          for (const k of Object.keys(db.groups || {})) {
            if (k.trim().toLowerCase() === normTarget) {
              matchedKey = k;
              lessons = db.groups[k] || [];
              break;
            }
          }
        }

        if (!matchedKey || lessons.length === 0) {
          return new Response("Расписание не найдено", { status: 404, headers: corsHeaders });
        }

        const daysMap = {
          "ПОНЕДЕЛЬНИК": 0, "ВТОРНИК": 1, "СРЕДА": 2,
          "ЧЕТВЕРГ": 3, "ПЯТНИЦА": 4, "СУББОТА": 5
        };

        const calTitle = targetType === "teacher" 
          ? `МГПУ • Преподаватель ${matchedKey}` 
          : `МГПУ • Группа ${matchedKey}`;

        const ics = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//MCU Schedule//RU",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
          `X-WR-CALNAME:${escapeIcs(calTitle)}`,
          "X-WR-TIMEZONE:Europe/Moscow"
        ];

        for (const item of lessons) {
          const wMeta = db.weeks ? (db.weeks[item.week] || db.weeks[String(item.week)]) : null;
          let mondayDate = null;

          if (wMeta && typeof wMeta === 'object' && wMeta.start) {
            mondayDate = new Date(wMeta.start);
          } else {
            const str = (typeof wMeta === 'string') ? wMeta : (item.date_range || "");
            const m = str.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
            if (m) {
              const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
              const mon = parseInt(m[2], 10) - 1;
              const d = parseInt(m[1], 10);
              mondayDate = new Date(y, mon, d);
            }
          }

          if (!mondayDate || isNaN(mondayDate.getTime())) continue;

          const dayOffset = daysMap[item.day] ?? 0;
          const lessonDate = new Date(mondayDate.getTime() + dayOffset * 86400000);

          let startH = 8, startM = 30, endH = 10, endM = 0;
          const timeMatch = (item.time || "").match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
          if (timeMatch) {
            startH = parseInt(timeMatch[1], 10);
            startM = parseInt(timeMatch[2], 10);
            endH = parseInt(timeMatch[3], 10);
            endM = parseInt(timeMatch[4], 10);
          }

          const dtStart = formatIcsDateTime(lessonDate, startH, startM);
          const dtEnd = formatIcsDateTime(lessonDate, endH, endM);
          const uid = `mcu_${targetType}_${item.week}_${dayOffset}_${item.pair}_${Math.abs(hashStr((item.subject || '') + (item.group || '') + (item.teacher || '')))}@mcuedu`;

          const descLines = [];
          if (targetType === "teacher") {
            descLines.push(`👥 Группа: ${item.group || '—'}`);
          } else {
            if (item.teacher) descLines.push(`👨‍🏫 Преподаватель: ${item.teacher}`);
          }
          if (item.room) descLines.push(`📍 Аудитория: ${item.room}`);
          if (item.subgroup) descLines.push(`🔹 Подгруппа: ${item.subgroup}`);
          if (item.is_substitute) descLines.push(`⚠️ Замена`);

          ics.push("BEGIN:VEVENT");
          ics.push(`UID:${uid}`);
          ics.push(`DTSTAMP:${formatIcsDateTime(new Date(), 0, 0)}Z`);
          ics.push(`DTSTART;TZID=Europe/Moscow:${dtStart}`);
          ics.push(`DTEND;TZID=Europe/Moscow:${dtEnd}`);
          ics.push(`SUMMARY:${escapeIcs((item.subject || 'Занятие') + (item.type ? ' (' + item.type + ')' : ''))}`);
          ics.push(`DESCRIPTION:${escapeIcs(descLines.join('\n'))}`);
          ics.push(`LOCATION:${escapeIcs(item.room || 'МГПУ ИИЯ')}`);
          ics.push("STATUS:CONFIRMED");
          ics.push("END:VEVENT");
        }

        ics.push("END:VCALENDAR");

        return new Response(ics.join("\r\n"), {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": `attachment; filename="mcu_${encodeURIComponent(matchedKey)}.ics"`,
            "Cache-Control": "public, max-age=3600"
          }
        });
      } catch (err) {
        return new Response("Ошибка генерации календаря", { status: 500, headers: corsHeaders });
      }
    }

    /* ============================================================
       2. API ДОМАШНИХ ЗАДАНИЙ (С МЕТКОЙ АДМИНА И СИНХРОНИЗАЦИЕЙ ПОТОКА)
    ============================================================ */
    if (url.pathname === "/api/hw" && request.method === "GET") {
      const group = url.searchParams.get("group");
      const week = url.searchParams.get("week");

      if (!group || !week || !env.STATS_KV) {
        return new Response(JSON.stringify({}), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const key = `hw:${group.trim().toLowerCase()}:${week}`;
      try {
        const data = await env.STATS_KV.get(key, "json") || {};
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({}), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

        if (url.pathname === "/api/hw" && request.method === "POST") {
      try {
        const body = await request.json();
        const { group, week, lessonKey, text, isDelete, jointGroups } = body;

        if (!group || !week || !lessonKey || !env.STATS_KV) {
          return new Response(JSON.stringify({ error: "Некорректные параметры запроса" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        let caller = null;
        let isAdmin = false;
        const authHeader = request.headers.get("Authorization") || "";
        const adminHeaderKey = request.headers.get("x-admin-key") || url.searchParams.get("key");

        if (adminHeaderKey && adminHeaderKey === ADMIN_SECRET_KEY) {
          isAdmin = true;
        }

        if (authHeader.startsWith("tma ") && TG_TOKEN) {
          const initDataStr = authHeader.slice(4);
          const tgUser = await verifyTelegramWebAppData(initDataStr, TG_TOKEN);
          if (tgUser && tgUser.id) {
            const tgIdStr = String(tgUser.id);
            const tgUname = (tgUser.username || "").toLowerCase();
            if ((tgIdStr === ADMIN_TG_ID) || (tgUname === ADMIN_TG_USERNAME)) {
              isAdmin = true;
            }
            caller = {
              id: `tg_${tgIdStr}`,
              platform: "tg",
              badge: tgUser.username ? `@${tgUser.username}` : (tgUser.first_name || "Студент"),
              name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "Студент",
              is_admin: isAdmin
            };
          }
        }

        if (!caller) {
          const clientAuthor = body.author || {};
          const fallbackId = String(clientAuthor.id || "guest");
          if (fallbackId.startsWith("tg_")) {
            return new Response(JSON.stringify({ error: "Ошибка авторизации сессии" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          // Безопасность: неавторизованные клиенты не могут выдавать себя за админа через тело запроса
          caller = {
            id: fallbackId,
            platform: clientAuthor.platform || "web",
            badge: (clientAuthor.badge || "Студент").slice(0, 50),
            name: (clientAuthor.name || "Студент").slice(0, 50),
            is_admin: isAdmin
          };
        }

        // Ограничиваем список совместных групп максимум 4 группами для соблюдения лимитов KV
        const rawGroups = (Array.isArray(jointGroups) && jointGroups.length > 0)
          ? [...new Set(jointGroups)]
          : [group];
        const targetGroups = rawGroups.filter(g => typeof g === 'string' && g.trim()).slice(0, 4);
        if (!targetGroups.some(g => g.trim().toLowerCase() === group.trim().toLowerCase())) {
          targetGroups.unshift(group);
        }

        // 1. Быстро читаем записи параллельно
        const entries = await Promise.all(targetGroups.map(async (grp) => {
          const sKey = `hw:${grp.trim().toLowerCase()}:${week}`;
          let wHw = {};
          try {
            wHw = (await env.STATS_KV.get(sKey, "json")) || {};
          } catch (e) {}
          return { grp, sKey, wHw };
        }));

        const primaryEntry = entries.find(e => e.grp.trim().toLowerCase() === group.trim().toLowerCase()) || entries[0];
        const existingItem = primaryEntry?.wHw?.[lessonKey];
        const isAuthor = existingItem && existingItem.author && (existingItem.author.id === caller.id);

        if (isDelete) {
          if (existingItem && !isAuthor && !isAdmin) {
            return new Response(JSON.stringify({ error: "Только автор или админ может удалить задание" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }

          await Promise.all(entries.map(async ({ sKey, wHw }) => {
            delete wHw[lessonKey];
            try {
              if (Object.keys(wHw).length === 0) {
                await env.STATS_KV.delete(sKey);
              } else {
                await env.STATS_KV.put(sKey, JSON.stringify(wHw));
              }
            } catch (e) {}
          }));

          return new Response(JSON.stringify({ success: true, deleted: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const cleanText = (text || "").trim();
        if (!cleanText || cleanText.length > 1000) {
          return new Response(JSON.stringify({ error: "Текст задания некорректен (до 1000 симв.)" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (existingItem && !isAuthor && !isAdmin) {
          return new Response(JSON.stringify({ error: "Только автор или админ может изменить это задание" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const hwPayload = {
          text: cleanText,
          updated_at: new Date().toLocaleString("ru-RU", {
            timeZone: "Europe/Moscow",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          }),
          author: caller,
          is_joint: targetGroups.length > 1,
          joint_groups: targetGroups
        };

        // 2. Параллельная запись
        await Promise.all(entries.map(async ({ sKey, wHw }) => {
          wHw[lessonKey] = hwPayload;
          try {
            await env.STATS_KV.put(sKey, JSON.stringify(wHw));
          } catch (e) {}
        }));

        return new Response(JSON.stringify({ success: true, data: hwPayload }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Ошибка сервера: " + (err.message || String(err)) }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/api/stat" && request.method === "POST") {
      try {
        const body = await request.json();
        await recordTelemetry(env, body);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    /* ============================================================
       4. API АДМИН-ПАНЕЛИ: УПРАВЛЕНИЕ ВСЕМИ ДЗ И СТАТИСТИКОЙ
    ============================================================ */
    if (url.pathname === "/admin/hw-list" && request.method === "GET") {
      const authKey = request.headers.get("x-admin-key") || url.searchParams.get("key");
      if (authKey !== ADMIN_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Доступ запрещен" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!env.STATS_KV) {
        return new Response(JSON.stringify({ items: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      try {
        const listRes = await env.STATS_KV.list({ prefix: "hw:" });
        const keys = listRes.keys || [];
        const allItems = [];

        await Promise.all(keys.map(async (kObj) => {
          const storeKey = kObj.name;
          const parts = storeKey.split(":");
          const week = parts.pop();
          const group = parts.slice(1).join(":").toUpperCase();

          const weekData = await env.STATS_KV.get(storeKey, "json");
          if (weekData && typeof weekData === "object") {
            for (const [lessonKey, hwVal] of Object.entries(weekData)) {
              if (hwVal && hwVal.text) {
                allItems.push({
                  storeKey,
                  group,
                  week,
                  lessonKey,
                  text: hwVal.text,
                  updated_at: hwVal.updated_at || "",
                  author: hwVal.author || { badge: "Студент", platform: "web" }
                });
              }
            }
          }
        }));

        allItems.sort((a, b) => a.group.localeCompare(b.group, "ru") || Number(a.week) - Number(b.week));

        return new Response(JSON.stringify({ items: allItems }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Ошибка чтения списка ДЗ", items: [] }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/admin/hw-action" && request.method === "POST") {
      const authKey = request.headers.get("x-admin-key") || url.searchParams.get("key");
      if (authKey !== ADMIN_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Доступ запрещен" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      try {
        const { storeKey, lessonKey, text, isDelete, signAsAdmin } = await request.json();
        if (!env.STATS_KV || !storeKey || !lessonKey) {
          return new Response(JSON.stringify({ error: "Неверные параметры" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const weekHw = (await env.STATS_KV.get(storeKey, "json")) || {};

        if (isDelete) {
          delete weekHw[lessonKey];
          if (Object.keys(weekHw).length === 0) {
            await env.STATS_KV.delete(storeKey);
          } else {
            await env.STATS_KV.put(storeKey, JSON.stringify(weekHw));
          }
          return new Response(JSON.stringify({ ok: true, deleted: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const cleanText = (text || "").trim();
        if (!cleanText) {
          return new Response(JSON.stringify({ error: "Текст не может быть пустым" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const prevAuthor = weekHw[lessonKey]?.author || {
          id: "admin_panel",
          platform: "tg",
          badge: `@${ADMIN_TG_USERNAME}`,
          name: "Админ",
          is_admin: true
        };

        const finalAuthor = signAsAdmin
          ? {
              id: `tg_${ADMIN_TG_ID}`,
              platform: "tg",
              badge: `@${ADMIN_TG_USERNAME}`,
              name: "Админ",
              is_admin: true
            }
          : prevAuthor;

        weekHw[lessonKey] = {
          text: cleanText,
          updated_at: new Date().toLocaleString("ru-RU", {
            timeZone: "Europe/Moscow",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          }),
          author: finalAuthor
        };

        await env.STATS_KV.put(storeKey, JSON.stringify(weekHw));
        return new Response(JSON.stringify({ ok: true, item: weekHw[lessonKey] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Ошибка сохранения ДЗ" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname === "/admin/update-stat" && request.method === "POST") {
      const authKey = request.headers.get("x-admin-key") || url.searchParams.get("key");
      if (authKey !== ADMIN_SECRET_KEY) {
        return new Response(JSON.stringify({ error: "Доступ запрещен" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      try {
        const { periodKey, category, target, value } = await request.json();
        if (!env.STATS_KV || !target) {
          return new Response(JSON.stringify({ error: "Неверные параметры" }), { status: 400, headers: corsHeaders });
        }

        const raw = (await env.STATS_KV.get("stats:summary", "json")) || {};
        const { stats } = ensurePeriodRotation(raw);
        const numVal = parseInt(value, 10);

        const targetBuckets = [];
        if (periodKey && stats.periods && stats.periods[periodKey]) {
          targetBuckets.push(stats.periods[periodKey]);
        } else if (stats.periods) {
          targetBuckets.push(stats.periods.all);
        }

        for (const b of targetBuckets) {
          if (category === "group" && b.groups) {
            const oldVal = b.groups[target] || 0;
            if (isNaN(numVal) || numVal <= 0) delete b.groups[target];
            else b.groups[target] = numVal;
            const diff = (isNaN(numVal) || numVal <= 0 ? 0 : numVal) - oldVal;
            b.total_sessions = Math.max(0, (b.total_sessions || 0) + diff);
            if (b.roles) b.roles.student = Math.max(0, (b.roles.student || 0) + diff);
          } else if (category === "teacher" && b.teachers) {
            const oldVal = b.teachers[target] || 0;
            if (isNaN(numVal) || numVal <= 0) delete b.teachers[target];
            else b.teachers[target] = numVal;
            const diff = (isNaN(numVal) || numVal <= 0 ? 0 : numVal) - oldVal;
            b.total_sessions = Math.max(0, (b.total_sessions || 0) + diff);
            if (b.roles) b.roles.teacher = Math.max(0, (b.roles.teacher || 0) + diff);
          }
        }

        syncLegacyTopFields(stats);
        await env.STATS_KV.put("stats:summary", JSON.stringify(stats));

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Ошибка сохранения в KV" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    /* ============================================================
       5. ПАНЕЛЬ АДМИНИСТРАТОРА (/admin)
    ============================================================ */
    if (url.pathname === "/admin") {
      const authKey = request.headers.get("x-admin-key") || url.searchParams.get("key");
      if (authKey !== ADMIN_SECRET_KEY) {
        return new Response("Доступ запрещен. Неверный ключ безопасности.", { status: 403 });
      }

      const fullStats = await getAggregatedStats(env);
      return new Response(renderAdminHtml(fullStats, authKey), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    if (request.method !== "POST") {
      return new Response("MCU Schedule Worker Running", { status: 200 });
    }

    /* ============================================================
       6. ВЕБХУКИ ТЕЛЕГРАМ И ВКОНТАКТЕ
    ============================================================ */
    try {
      const data = await request.json();

      if (data.type === "confirmation") {
        return new Response(VK_CONFIRMATION_CODE, {
          status: 200,
          headers: { "Content-Type": "text/plain" }
        });
      }

      if (data.type === "message_new") {
        const userId = data.object?.message?.from_id;
        if (userId && VK_GROUP_TOKEN) {
          const keyboard = JSON.stringify({
            inline: false,
            buttons: [
              [{ action: { type: "open_app", app_id: VK_APP_ID, label: "📅 Открыть расписание" } }]
            ]
          });
          const sendUrl = `https://api.vk.com/method/messages.send?user_id=${userId}&random_id=${Math.floor(Math.random() * 1e9)}&message=${encodeURIComponent("👋 Привет! Нажмите кнопку ниже для запуска расписания:")}&keyboard=${encodeURIComponent(keyboard)}&v=5.199&access_token=${VK_GROUP_TOKEN}`;
          await fetch(sendUrl);
        }
        return new Response("ok", { status: 200 });
      }

      if (TG_WEBHOOK_SECRET) {
        const incomingSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (incomingSecret !== TG_WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      if (data.message && data.message.text && TG_TOKEN) {
        const chatId = data.message.chat.id;
        const text = data.message.text.trim();

        if (text.startsWith("/admin") || text.startsWith("/stats")) {
          const parts = text.split(/\s+/);
          if (parts.length > 1 && parts[1] === ADMIN_PASS) {
            await sendStatsMessage(chatId, env, url, TG_TOKEN, ADMIN_SECRET_KEY);
            return new Response("ok", { status: 200 });
          }

          await sendTgSimpleText(
            chatId,
            "🔒 *Вход в панель администратора*\n\nОтправьте команду вместе с паролем в одном сообщении:\n`/admin " + ADMIN_PASS + "`",
            TG_TOKEN,
            "Markdown"
          );
          return new Response("ok", { status: 200 });
        }

        const tgPayload = {
          chat_id: chatId,
          text: "👋 Привет! Нажмите кнопку ниже, чтобы открыть интерактивное расписание ИИЯ МГПУ:",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📅 Открыть расписание", web_app: { url: WEB_APP_URL } }]
            ]
          }
        };

        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tgPayload)
        });
      }

      return new Response("ok", { status: 200 });
    } catch (e) {
      return new Response("ok", { status: 200 });
    }
  }
};
