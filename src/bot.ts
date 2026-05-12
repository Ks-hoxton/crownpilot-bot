import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { getConfig } from "./config.js";
import { AgendaService } from "./services/agenda-service.js";
import { Bitrix24ConnectionService } from "./services/integrations/bitrix24-connection-service.js";
import { normalizePortalDomain } from "./services/integrations/bitrix24-oauth-service.js";
import { Bitrix24PeopleService } from "./services/integrations/bitrix24-people-service.js";
import { Bitrix24TasksService } from "./services/integrations/bitrix24-tasks-service.js";
import { GoogleCalendarService } from "./services/integrations/google-calendar-service.js";
import { GoogleOAuthService } from "./services/integrations/google-oauth-service.js";
import { store } from "./state/store.js";
import type { AnniversaryEntry, BirthdayEntry, BitrixTask, CalendarMeeting } from "./types.js";

const agendaService = new AgendaService();
const calendarService = new GoogleCalendarService();
const googleOAuthService = new GoogleOAuthService();
const bitrix24ConnectionService = new Bitrix24ConnectionService();
const tasksService = new Bitrix24TasksService();
const peopleService = new Bitrix24PeopleService();

function getTelegramUserId(ctx: { from?: { id: number } }): number | undefined {
  return ctx.from?.id;
}

function buildCalendarRoleKeyboard(telegramUserId: number) {
  return new InlineKeyboard()
    .text("🧑 Личный Google", `connect_calendar:personal:${telegramUserId}`)
    .row()
    .text("🏢 Рабочий Google", `connect_calendar:work:${telegramUserId}`);
}

function buildBitrixConnectKeyboard(telegramUserId: number, portalDomain: string) {
  return new InlineKeyboard().text("🔐 Подключить Bitrix24", `connect_bitrix_oauth:${telegramUserId}:${portalDomain}`);
}

function buildMainMenuKeyboard() {
  return new Keyboard()
    .text("✨ План на сегодня")
    .text("📅 Мои встречи")
    .row()
    .text("✅ Задачи сегодня")
    .text("🗂 Задачи завтра")
    .row()
    .text("🎂 Дни рождения")
    .text("🏅 Юбилеи")
    .row()
    .text("🔌 Подключить сервисы")
    .text("👥 Пригласить коллегу")
    .resized()
    .persistent();
}

function buildPeopleKeyboard(kind: "birthdays" | "anniversaries") {
  return new InlineKeyboard()
    .text("Сегодня", `${kind}:today`)
    .text("Завтра", `${kind}:tomorrow`);
}

function buildConnectionsKeyboard(telegramUserId: number) {
  const keyboard = new InlineKeyboard()
    .text("🗓 Подключить календарь", `open_connect_calendar:${telegramUserId}`);

  if (bitrix24ConnectionService.isOAuthConfigured()) {
    keyboard.row().text("🧩 Подключить Bitrix24", `prompt_bitrix_portal:${telegramUserId}`);
  }

  return keyboard;
}

function getInviteLink() {
  return "https://t.me/CrownPilotBot?start=invite";
}

function getStatusLine(enabled: boolean, text: string) {
  return `${enabled ? "✅" : "◻️"} ${text}`;
}

function getWelcomeMessage(telegramUserId: number, startPayload?: string) {
  const hasGoogle = store.getGoogleConnections(telegramUserId).length > 0;
  const hasBitrix = Boolean(store.getBitrixConnection(telegramUserId));
  const invited = startPayload === "invite";

  return [
    invited ? "👋 Вас пригласили в CrownPilot." : "👋 Добро пожаловать в CrownPilot.",
    "",
    "Я собираю ваш рабочий день в одном чате:",
    "• 📅 встречи на сегодня",
    "• ✅ задачи из Bitrix24",
    "• 🎂 дни рождения коллег",
    "• 🏅 юбилеи по дате выхода",
    "",
    "Что осталось подключить:",
    getStatusLine(hasGoogle, "Google Calendar"),
    getStatusLine(hasBitrix, "Bitrix24"),
    "",
    hasGoogle && hasBitrix
      ? "Готово. Нажмите «✨ План на сегодня» или выберите действие кнопками ниже."
      : bitrix24ConnectionService.isOAuthConfigured()
        ? "Шаг 1: подключите календарь. Шаг 2: подключите Bitrix24. После этого бот сразу соберет ваш день."
        : "Шаг 1: подключите календарь. Для Bitrix24 пока доступно ручное подключение через /connect_bitrix и webhook."
  ].join("\n");
}

function getBitrixPortalPromptText() {
  return [
    "🔗 Пришлите домен вашего Bitrix24.",
    "Пример: yourcompany.bitrix24.ru",
    "",
    "Я подготовлю кнопку входа и верну вас обратно в бот."
  ].join("\n");
}

function formatBitrixConnectionStatus(telegramUserId: number): string {
  const connection = store.getBitrixConnection(telegramUserId);

  if (!connection) {
    return [
      "Bitrix24 пока не подключен.",
      "Можно подключить портал через OAuth или прислать webhook:",
      "bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/"
    ].join("\n");
  }

  return [
    `Bitrix24 подключен через ${connection.authType === "oauth" ? "OAuth" : "webhook"}.`,
    connection.portalBase ? `Портал: ${connection.portalBase}` : null,
    connection.mappedUserName
      ? `Пользователь: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
      : null
  ].filter(Boolean).join("\n");
}

function formatGmtOffsetLabel(timeZone: string, dateLike: string | Date = new Date()): string {
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  return value.replace("UTC", "GMT");
}

function formatTaskList(title: string, tasks: BitrixTask[], timeZone: string): string {
  const lines = tasks.length === 0
    ? [title === "Мои задачи сегодня" ? "На сегодня нет задач." : "На завтра нет задач."]
    : tasks.map((task, index) => {
      const deadline = task.deadline
        ? new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            timeZone
          }).format(new Date(task.deadline))
        : "без дедлайна";

      return [
        `${index + 1}. ${task.title}`,
        `Дедлайн: ${deadline}`,
        task.url ? `Открыть: ${task.url}` : null
      ].filter(Boolean).join("\n");
    });

  return [
    title,
    `🕒 Время показано в: ${formatGmtOffsetLabel(timeZone)}`,
    "",
    ...lines
  ].join("\n");
}

function formatMeetingsList(title: string, meetings: CalendarMeeting[], timeZone: string): string {
  const lines = meetings.length === 0
    ? ["Сегодня встреч нет."]
    : meetings.map((meeting, index) =>
      [
        `${index + 1}. ${meeting.startLabel} — ${meeting.title}`,
        meeting.sourceLabel ? `Календарь: ${meeting.sourceLabel}` : null,
        `Ссылка: ${meeting.joinUrl ?? meeting.calendarUrl ?? "ссылка недоступна"}`
      ].filter(Boolean).join("\n")
    );

  return [
    title,
    `🕒 Время показано в: ${formatGmtOffsetLabel(timeZone)}`,
    "",
    ...lines
  ].join("\n");
}

function formatBirthdays(title: string, entries: BirthdayEntry[]): string {
  const lines = entries.length === 0
    ? ["Никого нет."]
    : entries.map((entry, index) =>
      [
        `${index + 1}. ${entry.person.name}${entry.person.workPosition ? `, ${entry.person.workPosition}` : ""}`,
        entry.age ? `Исполняется: ${entry.age}` : null
      ].filter(Boolean).join("\n")
    );

  return [title, "", ...lines].join("\n");
}

function formatAnniversaries(title: string, entries: AnniversaryEntry[]): string {
  const lines = entries.length === 0
    ? ["Никого нет."]
    : entries.map((entry, index) =>
      [
        `${index + 1}. ${entry.person.name}${entry.person.workPosition ? `, ${entry.person.workPosition}` : ""}`,
        `В компании: ${entry.years} ${pluralizeYears(entry.years)}`
      ].join("\n")
    );

  return [title, "", ...lines].join("\n");
}

function pluralizeYears(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "год";
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "года";
  }

  return "лет";
}

async function replyPlanToday(ctx: { reply: (text: string) => Promise<unknown> }, userId: number) {
  await ctx.reply(await agendaService.getMorningAgenda(userId));
}

async function replyMyMeetingsToday(ctx: { reply: (text: string) => Promise<unknown> }, userId: number) {
  const timeZone = calendarService.getEffectiveTimeZone(userId);
  const meetings = await calendarService.getTodayMeetingItems(userId);
  await ctx.reply(formatMeetingsList("Мои встречи сегодня", meetings, timeZone));
}

async function replyMyTasks(ctx: { reply: (text: string) => Promise<unknown> }, userId: number, dayOffset: 0 | 1) {
  const timeZone = calendarService.getEffectiveTimeZone(userId);
  const title = dayOffset === 0 ? "Мои задачи сегодня" : "Мои задачи завтра";

  try {
    const tasks = await tasksService.getTasksForDay(userId, dayOffset, timeZone);
    await ctx.reply(formatTaskList(title, tasks, timeZone));
  } catch {
    await ctx.reply(getBitrixUnavailableMessage());
  }
}

async function replyBirthdays(ctx: { reply: (text: string) => Promise<unknown> }, userId: number, dayOffset: 0 | 1) {
  const timeZone = calendarService.getEffectiveTimeZone(userId);
  try {
    const entries = await peopleService.getBirthdaysForDay(userId, dayOffset, timeZone);
    await ctx.reply(formatBirthdays(dayOffset === 0 ? "Дни рождения сегодня" : "Дни рождения завтра", entries));
  } catch {
    await ctx.reply(getBitrixUnavailableMessage());
  }
}

async function replyAnniversaries(
  ctx: { reply: (text: string) => Promise<unknown> },
  userId: number,
  dayOffset: 0 | 1
) {
  const timeZone = calendarService.getEffectiveTimeZone(userId);
  try {
    const entries = await peopleService.getAnniversariesForDay(userId, dayOffset, timeZone);
    await ctx.reply(formatAnniversaries(dayOffset === 0 ? "Юбилеи коллег сегодня" : "Юбилеи коллег завтра", entries));
  } catch {
    await ctx.reply(getBitrixUnavailableMessage());
  }
}

function getBitrixUnavailableMessage(): string {
  return [
    "⚠️ Bitrix пока не доступен.",
    "Попробуйте подключить его заново через /connect_bitrix."
  ].join("\n");
}

function getInviteMessage() {
  return [
    "👥 Ссылка для коллеги:",
    getInviteLink(),
    "",
    "Как пройдет onboarding:",
    "1. Откроет бота",
    "2. Подключит Google Calendar",
    bitrix24ConnectionService.isOAuthConfigured()
      ? "3. Подключит Bitrix24"
      : "3. Подключит Bitrix24, если у нее будет личный webhook или когда мы включим Bitrix OAuth",
    "4. Сразу получит свой «План на сегодня»"
  ].join("\n");
}

export function createBot(): Bot {
  const bot = new Bot(getConfig().TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const startPayload = typeof ctx.match === "string" ? ctx.match.trim() : undefined;
    await ctx.reply(
      getWelcomeMessage(userId, startPayload),
      {
        reply_markup: buildMainMenuKeyboard()
      }
    );

    if (store.getGoogleConnections(userId).length === 0 || !store.getBitrixConnection(userId)) {
      await ctx.reply("🔌 Начнем с подключений:", {
        reply_markup: buildConnectionsKeyboard(userId)
      });
    }
  });

  bot.command("connect_calendar", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await ctx.reply(
      [
        "🗓 Какой Google-аккаунт подключаем?",
        "Можно подключить и личный, и рабочий."
      ].join("\n"),
      { reply_markup: buildCalendarRoleKeyboard(userId) }
    );
  });

  bot.command("connect_bitrix", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const rawPortal = ctx.match?.trim();

    if (rawPortal && bitrix24ConnectionService.isOAuthConfigured()) {
      const portalDomain = normalizePortalDomain(rawPortal);
      store.clearPendingUserAction(userId);
      await ctx.reply(
        `🧩 Подготовил OAuth для портала ${portalDomain}.`,
        { reply_markup: buildBitrixConnectKeyboard(userId, portalDomain) }
      );
      return;
    }

    await ctx.reply(
      [
        formatBitrixConnectionStatus(userId),
        "",
        bitrix24ConnectionService.isOAuthConfigured()
          ? "Нажмите кнопку ниже и я проведу вас через вход в Bitrix24."
          : "Пока доступно ручное подключение через webhook.",
        !bitrix24ConnectionService.isOAuthConfigured()
          ? "Формат: bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/"
          : null
      ].filter(Boolean).join("\n"),
      bitrix24ConnectionService.isOAuthConfigured()
        ? { reply_markup: new InlineKeyboard().text("Указать домен Bitrix24", `prompt_bitrix_portal:${userId}`) }
        : undefined
    );
  });

  bot.command("my_tasks_today", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyMyTasks(ctx, userId, 0);
  });

  bot.command("my_tasks_tomorrow", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyMyTasks(ctx, userId, 1);
  });

  bot.command("my_meetings_today", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyMyMeetingsToday(ctx, userId);
  });

  bot.command("birthdays_today", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyBirthdays(ctx, userId, 0);
  });

  bot.command("birthdays_tomorrow", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyBirthdays(ctx, userId, 1);
  });

  bot.command("anniversaries_today", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyAnniversaries(ctx, userId, 0);
  });

  bot.command("anniversaries_tomorrow", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await replyAnniversaries(ctx, userId, 1);
  });

  bot.callbackQuery(/^open_connect_calendar:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramUserId = Number(ctx.match[1]);
    const userId = getTelegramUserId(ctx);

    if (!userId || telegramUserId !== userId) {
      await ctx.reply("Эта кнопка привязана к другому пользователю.");
      return;
    }

    await ctx.reply(
      [
        "🗓 Какой Google-аккаунт подключаем?",
        "Можно подключить и личный, и рабочий."
      ].join("\n"),
      { reply_markup: buildCalendarRoleKeyboard(userId) }
    );
  });

  bot.callbackQuery(/^connect_calendar:(personal|work):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const role = ctx.match[1] as "personal" | "work";
    const telegramUserId = Number(ctx.match[2]);
    const userId = getTelegramUserId(ctx);

    if (!userId) return;

    if (telegramUserId !== userId) {
      await ctx.reply("Эта кнопка привязана к другому пользователю.");
      return;
    }

    try {
      const url = googleOAuthService.getConnectUrl(userId, role);
      await ctx.reply(
        `🔐 Подключаем ${role === "personal" ? "личный" : "рабочий"} Google-аккаунт.`,
        { reply_markup: new InlineKeyboard().url("Открыть Google OAuth", url) }
      );
    } catch (error) {
      console.error(error);
      await ctx.reply("Google OAuth пока не настроен.");
    }
  });

  bot.callbackQuery(/^prompt_bitrix_portal:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const telegramUserId = Number(ctx.match[1]);
    const userId = getTelegramUserId(ctx);

    if (!userId) return;

    if (telegramUserId !== userId) {
      await ctx.reply("Эта кнопка привязана к другому пользователю.");
      return;
    }

    if (!bitrix24ConnectionService.isOAuthConfigured()) {
      await ctx.reply(
        [
          "⚠️ Bitrix OAuth пока не настроен.",
          "Сейчас можно подключить Bitrix24 только вручную через webhook.",
          "Формат: bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/"
        ].join("\n")
      );
      return;
    }

    store.savePendingUserAction(userId, { type: "awaiting_bitrix_portal" });
    await ctx.reply(getBitrixPortalPromptText());
  });

  bot.callbackQuery(/^connect_bitrix_oauth:(\d+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();

    const telegramUserId = Number(ctx.match[1]);
    const portalDomain = normalizePortalDomain(ctx.match[2]);
    const userId = getTelegramUserId(ctx);

    if (!userId) return;

    if (telegramUserId !== userId) {
      await ctx.reply("Эта кнопка привязана к другому пользователю.");
      return;
    }

    try {
      store.clearPendingUserAction(userId);
      const connectUrl = bitrix24ConnectionService.getOAuthConnectUrl(userId, portalDomain);
      await ctx.reply(
        `🔐 Подключаем портал ${portalDomain}.`,
        { reply_markup: new InlineKeyboard().url("Открыть Bitrix24 OAuth", connectUrl) }
      );
    } catch (error) {
      console.error(error);
      await ctx.reply("Bitrix OAuth пока не настроен.");
    }
  });

  bot.on("message:text", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);

    const rawText = ctx.message.text.trim();
    const input = rawText.toLowerCase();
    const pendingAction = store.getPendingUserAction(userId);

    if (pendingAction?.type === "awaiting_bitrix_portal") {
      const portalDomain = normalizePortalDomain(rawText);

      if (!portalDomain || !portalDomain.includes(".")) {
        await ctx.reply("Не удалось распознать домен портала. Пришлите что-то вроде `yourcompany.bitrix24.ru`.");
        return;
      }

      if (!bitrix24ConnectionService.isOAuthConfigured()) {
        store.clearPendingUserAction(userId);
        await ctx.reply(
          [
            "⚠️ Bitrix OAuth пока не настроен.",
            "Сейчас можно подключить Bitrix24 только вручную через webhook.",
            "Формат: bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/"
          ].join("\n")
        );
        return;
      }

      store.clearPendingUserAction(userId);
      await ctx.reply(
        `🧩 Подготовил OAuth для портала ${portalDomain}.`,
        { reply_markup: buildBitrixConnectKeyboard(userId, portalDomain) }
      );
      return;
    }

    if (input.startsWith("bitrix https://")) {
      try {
        const webhookUrl = rawText.slice("bitrix ".length);
        const connection = await bitrix24ConnectionService.connectViaWebhook(userId, webhookUrl);
        await ctx.reply(
          [
            "✅ Bitrix24 подключен через webhook.",
            connection.portalBase ? `Портал: ${connection.portalBase}` : null,
            connection.mappedUserName
              ? `Ваш Bitrix user: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
              : null,
            "Бот будет читать только ваши задачи и календарь сотрудников."
          ].filter(Boolean).join("\n")
        );
      } catch (error) {
        console.error(error);
        await ctx.reply("Не удалось подключить Bitrix24. Проверьте webhook URL.");
      }
      return;
    }

    if (input === "план на сегодня" || input === "✨ план на сегодня") {
      await replyPlanToday(ctx, userId);
      return;
    }

    if (input === "мои встречи сегодня" || input === "📅 мои встречи") {
      await replyMyMeetingsToday(ctx, userId);
      return;
    }

    if (input === "мои задачи сегодня" || input === "✅ задачи сегодня") {
      await replyMyTasks(ctx, userId, 0);
      return;
    }

    if (input === "мои задачи завтра" || input === "🗂 задачи завтра") {
      await replyMyTasks(ctx, userId, 1);
      return;
    }

    if (input === "дни рождения сегодня") {
      await replyBirthdays(ctx, userId, 0);
      return;
    }

    if (input === "дни рождения завтра") {
      await replyBirthdays(ctx, userId, 1);
      return;
    }

    if (input === "🎂 дни рождения") {
      await ctx.reply("🎂 Что показать?", {
        reply_markup: buildPeopleKeyboard("birthdays")
      });
      return;
    }

    if (input === "юбилеи коллег сегодня") {
      await replyAnniversaries(ctx, userId, 0);
      return;
    }

    if (input === "юбилеи коллег завтра") {
      await replyAnniversaries(ctx, userId, 1);
      return;
    }

    if (input === "🏅 юбилеи") {
      await ctx.reply("🏅 Что показать?", {
        reply_markup: buildPeopleKeyboard("anniversaries")
      });
      return;
    }

    if (input === "подключить календарь") {
      await ctx.reply("🗓 Выберите Google-аккаунт для подключения.", {
        reply_markup: buildCalendarRoleKeyboard(userId)
      });
      return;
    }

    if (input === "подключить битрикс" || input === "🔌 подключить сервисы") {
      await ctx.reply(
        [
          "🔌 Подключения",
          "",
          `${store.getGoogleConnections(userId).length > 0 ? "✅" : "◻️"} Google Calendar`,
          `${store.getBitrixConnection(userId) ? "✅" : "◻️"} Bitrix24`,
          "",
          bitrix24ConnectionService.isOAuthConfigured()
            ? "Можно пройти обычный onboarding кнопками ниже."
            : "Bitrix24 пока подключается вручную через webhook."
        ].join("\n"),
        { reply_markup: buildConnectionsKeyboard(userId) }
      );
      return;
    }

    if (input === "👥 пригласить коллегу") {
      await ctx.reply(getInviteMessage());
      return;
    }

    await ctx.reply(
      getWelcomeMessage(userId),
      { reply_markup: buildMainMenuKeyboard() }
    );
  });

  bot.callbackQuery(/^birthdays:(today|tomorrow)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    await replyBirthdays(ctx, userId, ctx.match[1] === "today" ? 0 : 1);
  });

  bot.callbackQuery(/^anniversaries:(today|tomorrow)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    await replyAnniversaries(ctx, userId, ctx.match[1] === "today" ? 0 : 1);
  });

  return bot;
}
