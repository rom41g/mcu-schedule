import os
import sys
import telebot
from telebot.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEB_APP_URL = os.getenv("WEB_APP_URL", "https://www.mcu-schedule.ru/")

if not BOT_TOKEN:
    print("❌ Ошибка: Переменная окружения BOT_TOKEN не установлена!")
    print("Задайте BOT_TOKEN в файле .env или системных переменных окружения.")
    sys.exit(1)

bot = telebot.TeleBot(BOT_TOKEN)


@bot.message_handler(commands=["start", "help"])
def send_welcome(message):
    markup = InlineKeyboardMarkup()
    btn = InlineKeyboardButton(
        text="📅 Открыть расписание", web_app=WebAppInfo(url=WEB_APP_URL)
    )
    markup.add(btn)

    bot.send_message(
        message.chat.id,
        "Привет! Нажми на кнопку ниже, чтобы открыть интерактивное расписание МГПУ:",
        reply_markup=markup,
    )


print("🤖 Бот запущен! Откройте @mcu_schedulebot в Telegram и напишите /start")
bot.infinity_polling()
