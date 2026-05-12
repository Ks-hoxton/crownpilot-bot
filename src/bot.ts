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
type ReplyContext = { reply: (...args: any[]) => Promise<unknown> };

function getTelegramUserId(ctx: { from?: { id: number } }): number | undefined {
  return ctx.from?.id;
}

function hasGoogleConnection(telegramUserId: number): boolean {
  return store.getGoogleConnections(telegramUserId).length > 0;
}

function hasBitrixConnection(telegramUserId: number): boolean {
  return Boolean(store.getBitrixConnection(telegramUserId));
}

function buildCalendarRoleKeyboard(telegramUserId: number) {
  return new InlineKeyboard()
    .text("🧑 Личный календарь", `connect_calendar:personal:${telegramUserId}`)
    .row()
    .text("🏢 Рабочий календарь", `connect_calendar:work:${telegramUserId}`);
}

function buildBitrixConnectKeyboard(telegramUserId: number, portalDomain: string) {
  return new InlineKeyboard().text("🔐 Войти в Bitrix24", `connect_bitrix_oauth:${telegramUserId}:${portalDomain}`);
}

function buildMainMenuKeyboard(telegramUserId: number) {
  const keyboard = new Keyboard();
  const hasGoogle = hasGoogleConnection(telegramUserId);
  const hasBitrix = hasBitrixConnection(telegramUserId);

  keyboard.text("✨ План на сегодня");

  if (hasGoogle) {
    keyboard.text("📅 Мои встречи сегодня");
  }

  keyboard.row();

  if (hasBitrix) {
    keyboard.text("✅ Мои задачи сегодня").text("🗂 Мои задачи завтра").row();
    keyboard.text("🎂 Дни рождения сегодня").text("🎂 Дни рождения завтра").row();
    keyboard.text("🏅 Юбилеи сегодня").text("🏅 Юбилеи завтра").row();
  }

  if (!hasGoogle) {
    keyboard.text("🔐 Войти в Google Calendar");
  }

  if (!hasBitrix) {
    keyboard.text("🔐 Войти в Bitrix24");
  }

  keyboard.row().text("👥 Пригласить коллегу");

  return keyboard.resized().persistent();
}

function buildConnectionsKeyboard(telegramUserId: number) {
  const keyboard = new InlineKeyboard();

  if (!hasGoogleConnection(telegramUserId)) {
    keyboard.text("🗓 Войти в Google Calendar", `open_connect_calendar:${telegramUserId}`);
  }

  if (!hasBitrixConnection(telegramUserId)) {
    if (!hasGoogleConnection(telegramUserId)) {
      keyboard.row();
    }

    keyboard.text("🧩 Войти в Bitrix24", `prompt_bitrix_portal:${telegramUserId}`);
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
  const hasGoogle = hasGoogleConnection(telegramUserId);
  const hasBitrix = hasBitrixConnection(telegramUserId);
  const invited = startPayload === "invite";
  const nextStep = hasGoogle
    ? hasBitrix
      ? "Все системы на связи. Выбирайте действие кнопками ниже, и я соберу день без лишнего шума."
      : "Следующий шаг: войдите в Bitrix24. Тогда я добавлю задачи, дни рождения и юбилеи коллег."
    : "Начнем с Google Calendar. После этого я предложу подключить Bitrix24 и соберу все в одном чате.";

  return [
    invited ? "👋 Вас пригласили в CrownPilot для команды SBL." : "👋 Добро пожаловать в CrownPilot.",
    "",
    "Я Jarvis.",
    "Представьте помощника в духе Iron Man, только для команды SBL: спокойного, внимательного и всегда на шаг впереди.",
    "",
    "Я умею:",
    "• 📅 собирать встречи на сегодня",
    "• ✅ напоминать о задачах из Bitrix24",
    "• 🎂 подсказывать дни рождения коллег",
    "• 🏅 напоминать о юбилеях по дате выхода",
    "",
    "Статус подключений:",
    getStatusLine(hasGoogle, "Google Calendar"),
    getStatusLine(hasBitrix, "Bitrix24"),
    "",
    nextStep
  ].join("\n");
}

function getBitrixPortalPromptText() {
  return [
    "🔗 Пришлите домен вашего Bitrix24.",
    "Пример: yourcompany.bitrix24.ru",
    "",
    "Я подготовлю безопасный вход и верну вас обратно в Jarvis."
  ].join("\n");
}

function formatBitrixConnectionStatus(telegramUserId: number): string {
  const connection = store.getBitrixConnection(telegramUserId);

  if (!connection) {
    return "Bitrix24 пока не подключен.";
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
    ? ["На сегодня встреч нет."]
    : meetings.map((meeting, index) =>
      [
        `${index + 1}. ${meeting.startLabel} — ${meeting.title}`,
        meeting.sourceLabel ? `Календарь: ${meeting.sourceLabel}` : null,
        (meeting.joinUrl ?? meeting.calendarUrl) ? `Ссылка: ${meeting.joinUrl ?? meeting.calendarUrl}` : null
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
  const emptyLine = title === "Дни рождения сегодня"
    ? "Сегодня дней рождения нет."
    : "Завтра дней рождения нет.";

  const normalizedLines = entries.length === 0
    ? [emptyLine]
    : entries.map((entry, index) =>
      [
        `${index + 1}. ${entry.person.name}${entry.person.workPosition ? `, ${entry.person.workPosition}` : ""}`,
        entry.age ? `Исполняется: ${entry.age}` : null
      ].filter(Boolean).join("\n")
    );

  return [title, "", ...normalizedLines].join("\n");
}

function formatAnniversaries(title: string, entries: AnniversaryEntry[]): string {
  const emptyLine = title === "Юбилеи коллег сегодня"
    ? "Сегодня юбилеев коллег нет."
    : "Завтра юбилеев коллег нет.";

  const normalizedLines = entries.length === 0
    ? [emptyLine]
    : entries.map((entry, index) =>
      [
        `${index + 1}. ${entry.person.name}${entry.person.workPosition ? `, ${entry.person.workPosition}` : ""}`,
        `В компании: ${entry.years} ${pluralizeYears(entry.years)}`
      ].join("\n")
    );

  return [title, "", ...normalizedLines].join("\n");
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

function getGoogleLoginRequiredMessage(): string {
  return [
    "🔐 Сначала войдите в Google Calendar.",
    "После этого я смогу показать встречи и собрать план дня по календарю."
  ].join("\n");
}

function getBitrixLoginRequiredMessage(): string {
  return [
    "🔐 Сначала войдите в Bitrix24.",
    "После этого я смогу показать задачи, дни рождения и юбилеи коллег."
  ].join("\n");
}

async function replyPlanToday(ctx: ReplyContext, userId: number) {
  if (!hasGoogleConnection(userId) && !hasBitrixConnection(userId)) {
    await ctx.reply(getWelcomeMessage(userId), {
      reply_markup: buildConnectionsKeyboard(userId)
    });
    return;
  }

  await ctx.reply(await agendaService.getMorningAgenda(userId));
}

async function replyMyMeetingsToday(ctx: ReplyContext, userId: number) {
  if (!hasGoogleConnection(userId)) {
    await ctx.reply(getGoogleLoginRequiredMessage(), {
      reply_markup: buildConnectionsKeyboard(userId)
    });
    return;
  }

  const timeZone = calendarService.getEffectiveTimeZone(userId);
  const meetings = await calendarService.getTodayMeetingItems(userId);
  await ctx.reply(formatMeetingsList("Мои встречи сегодня", meetings, timeZone));
}

async function replyMyTasks(
  ctx: ReplyContext,
  userId: number,
  dayOffset: 0 | 1
) {
  if (!hasBitrixConnection(userId)) {
    await ctx.reply(getBitrixLoginRequiredMessage(), {
      reply_markup: buildConnectionsKeyboard(userId)
    });
    return;
  }

  const timeZone = calendarService.getEffectiveTimeZone(userId);
  const title = dayOffset === 0 ? "Мои задачи сегодня" : "Мои задачи завтра";

  try {
    const tasks = await tasksService.getTasksForDay(userId, dayOffset, timeZone);
    await ctx.reply(formatTaskList(title, tasks, timeZone));
  } catch {
    await ctx.reply(getBitrixUnavailableMessage());
  }
}

async function replyBirthdays(
  ctx: ReplyContext,
  userId: number,
  dayOffset: 0 | 1
) {
  if (!hasBitrixConnection(userId)) {
    await ctx.reply(getBitrixLoginRequiredMessage(), {
      reply_markup: buildConnectionsKeyboard(userId)
    });
    return;
  }

  const timeZone = calendarService.getEffectiveTimeZone(userId);
  try {
    const entries = await peopleService.getBirthdaysForDay(userId, dayOffset, timeZone);
    await ctx.reply(formatBirthdays(dayOffset === 0 ? "Дни рождения сегодня" : "Дни рождения завтра", entries));
  } catch {
    await ctx.reply(getBitrixUnavailableMessage());
  }
}

async function replyAnniversaries(
  ctx: ReplyContext,
  userId: number,
  dayOffset: 0 | 1
) {
  if (!hasBitrixConnection(userId)) {
    await ctx.reply(getBitrixLoginRequiredMessage(), {
      reply_markup: buildConnectionsKeyboard(userId)
    });
    return;
  }

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
    "1. Jarvis поприветствует и коротко объяснит, что умеет.",
    "2. Сначала предложит войти в Google Calendar.",
    "3. Затем мягко проведет через вход в Bitrix24.",
    "4. После входа покажет только те действия, которые уже доступны этому сотруднику."
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
        reply_markup: buildMainMenuKeyboard(userId)
      }
    );

    if (!hasGoogleConnection(userId) || !hasBitrixConnection(userId)) {
      await ctx.reply("🔌 Давайте подключим нужные сервисы:", {
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
        "🗓 В какой Google Calendar войти?",
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
        `🧩 Подготовил вход для портала ${portalDomain}.`,
        { reply_markup: buildBitrixConnectKeyboard(userId, portalDomain) }
      );
      return;
    }

    await ctx.reply(
      [
        formatBitrixConnectionStatus(userId),
        "",
        "Нажмите кнопку ниже, и я проведу вас через вход в Bitrix24."
      ].join("\n"),
      { reply_markup: new InlineKeyboard().text("Указать домен Bitrix24", `prompt_bitrix_portal:${userId}`) }
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
        "🗓 В какой Google Calendar войти?",
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
        `🔐 Открываю вход в ${role === "personal" ? "личный" : "рабочий"} Google Calendar.`,
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
        `🔐 Открываю вход в портал ${portalDomain}.`,
        { reply_markup: new InlineKeyboard().url("🔐 Войти в Bitrix24", connectUrl) }
      );
    } catch (error) {
      console.error(error);
      await ctx.reply("Вход в Bitrix24 сейчас временно недоступен. Попробуйте еще раз чуть позже.");
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

      store.clearPendingUserAction(userId);
      await ctx.reply(
        `🧩 Подготовил вход для портала ${portalDomain}.`,
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
            "✅ Bitrix24 подключен.",
            connection.portalBase ? `Портал: ${connection.portalBase}` : null,
            connection.mappedUserName
              ? `Ваш Bitrix user: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
              : null,
            "Бот будет читать только ваши задачи и календарь сотрудников."
          ].filter(Boolean).join("\n")
        );
      } catch (error) {
        console.error(error);
        await ctx.reply("Не удалось подключить Bitrix24. Попробуйте снова начать вход через кнопку.");
      }
      return;
    }

    if (input === "план на сегодня" || input === "✨ план на сегодня") {
      if (!hasGoogleConnection(userId) && !hasBitrixConnection(userId)) {
        await ctx.reply(getWelcomeMessage(userId), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyPlanToday(ctx, userId);
      return;
    }

    if (input === "мои встречи сегодня" || input === "📅 мои встречи сегодня" || input === "📅 мои встречи") {
      if (!hasGoogleConnection(userId)) {
        await ctx.reply(getGoogleLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyMyMeetingsToday(ctx, userId);
      return;
    }

    if (input === "мои задачи сегодня" || input === "✅ задачи сегодня" || input === "✅ мои задачи сегодня") {
      if (!hasBitrixConnection(userId)) {
        await ctx.reply(getBitrixLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyMyTasks(ctx, userId, 0);
      return;
    }

    if (input === "мои задачи завтра" || input === "🗂 задачи завтра" || input === "🗂 мои задачи завтра") {
      if (!hasBitrixConnection(userId)) {
        await ctx.reply(getBitrixLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyMyTasks(ctx, userId, 1);
      return;
    }

    if (input === "дни рождения сегодня" || input === "🎂 дни рождения сегодня") {
      if (!hasBitrixConnection(userId)) {
        await ctx.reply(getBitrixLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyBirthdays(ctx, userId, 0);
      return;
    }

    if (input === "дни рождения завтра" || input === "🎂 дни рождения завтра") {
      if (!hasBitrixConnection(userId)) {
        await ctx.reply(getBitrixLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyBirthdays(ctx, userId, 1);
      return;
    }

    if (input === "юбилеи коллег сегодня" || input === "🏅 юбилеи сегодня") {
      if (!hasBitrixConnection(userId)) {
        await ctx.reply(getBitrixLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyAnniversaries(ctx, userId, 0);
      return;
    }

    if (input === "юбилеи коллег завтра" || input === "🏅 юбилеи завтра") {
      if (!hasBitrixConnection(userId)) {
        await ctx.reply(getBitrixLoginRequiredMessage(), {
          reply_markup: buildConnectionsKeyboard(userId)
        });
        return;
      }

      await replyAnniversaries(ctx, userId, 1);
      return;
    }

    if (input === "подключить календарь" || input === "🔐 войти в google calendar") {
      await ctx.reply("🗓 Выберите календарь для входа.", {
        reply_markup: buildCalendarRoleKeyboard(userId)
      });
      return;
    }

    if (input === "подключить битрикс" || input === "🔐 войти в bitrix24" || input === "🔌 подключить сервисы") {
      await ctx.reply(
        [
          "🔌 Подключения",
          "",
          `${hasGoogleConnection(userId) ? "✅" : "◻️"} Google Calendar`,
          `${hasBitrixConnection(userId) ? "✅" : "◻️"} Bitrix24`,
          "",
          "Выберите сервис, в который хотите войти."
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
      { reply_markup: buildMainMenuKeyboard(userId) }
    );
  });

  return bot;
}
