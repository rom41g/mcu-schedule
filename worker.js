export default {
  async fetch(request) {
    if (request.method === "POST") {
      try {
        const update = await request.json();

        if (update.message && update.message.text && update.message.text.startsWith("/start")) {
          const chatId = update.message.chat.id;

          await fetch("https://api.telegram.org/bot8615393852:AAE2YU9ZUCyiYq2F9gGnMT3IFZpMJBNKexk/sendMessage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "Привет! Нажми на кнопку ниже, чтобы открыть интерактивное расписание МГПУ:",
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: "📅 Открыть расписание",
                    web_app: { url: "https://rom41g.github.io/mcu-schedule/" }
                  }
                ]]
              }
            })
          });
        }
      } catch (e) {
        // Игнорируем ошибки
      }
      return new Response("OK");
    }

    return new Response("Бот расписания МГПУ активен!");
  }
};
