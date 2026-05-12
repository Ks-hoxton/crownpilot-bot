import { Bot, InlineKeyboard } from "grammy";
import { getConfig } from "./config.js";
import { formatAlertsMessage, formatApprovalsMessage, formatBriefMessage, formatPipelineMessage } from "./formatters.js";
import { AgendaService } from "./services/agenda-service.js";
import { AlertsService } from "./services/alerts-service.js";
import { BriefService } from "./services/brief-service.js";
import { ExecutiveContextService } from "./services/executive-context-service.js";
import { Bitrix24ConnectionService } from "./services/integrations/bitrix24-connection-service.js";
import { normalizePortalDomain } from "./services/integrations/bitrix24-oauth-service.js";
import { Bitrix24Service } from "./services/integrations/bitrix24-service.js";
import { Bitrix24TasksService } from "./services/integrations/bitrix24-tasks-service.js";
import { GoogleCalendarService } from "./services/integrations/google-calendar-service.js";
import { GoogleOAuthService } from "./services/integrations/google-oauth-service.js";
import { OpenAIService } from "./services/openai-service.js";
import { store } from "./state/store.js";
import type { CreateCalendarEventInput } from "./types.js";

const briefService = new BriefService();
const calendarService = new GoogleCalendarService();
const bitrix24Service = new Bitrix24Service();
const googleOAuthService = new GoogleOAuthService();
const bitrix24ConnectionService = new Bitrix24ConnectionService();
const alertsService = new AlertsService(briefService, calendarService, bitrix24Service);
const tasksService = new Bitrix24TasksService();
const agendaService = new AgendaService(calendarService, tasksService);
const executiveContextService = new ExecutiveContextService(
  briefService,
  alertsService,
  calendarService,
  bitrix24Service
);
const openAIService = new OpenAIService();

function buildHomeKeyboard() {
  return new InlineKeyboard()
    .text("Сегодня", "today")
    .text("Аппрувы", "approvals")
    .row()
    .text("Воронка", "pipeline")
    .text("Календари", "calendars")
    .row()
    .text("Помощь", "help");
}

function getTelegramUserId(ctx: { from?: { id: number } }): number | undefined {
  return ctx.from?.id;
}

function buildCalendarRoleKeyboard(telegramUserId: number) {
  return new InlineKeyboard()
    .text("Личный Google", `connect_calendar:personal:${telegramUserId}`)
    .row()
    .text("Рабочий Google", `connect_calendar:work:${telegramUserId}`);
}

function buildBitrixConnectKeyboard(telegramUserId: number, portalDomain: string) {
  const keyboard = new InlineKeyboard();
  keyboard.text("Подключить Bitrix24", `connect_bitrix_oauth:${telegramUserId}:${portalDomain}`);
  return keyboard;
}

function buildCalendarSettingsKeyboard(telegramUserId: number) {
  const keyboard = new InlineKeyboard();
  const connections = store.getGoogleConnections(telegramUserId);

  connections.forEach((connection) => {
    connection.calendars.forEach((calendar, index) => {
      const flag = calendar.enabled ? "ON" : "OFF";
      keyboard.text(
        `${flag} ${connection.role}:${calendar.summary}`,
        `tglcal:${connection.connectionId}:${index}`
      ).row();
    });
  });

  return keyboard;
}

function formatCalendarConnections(telegramUserId: number): string {
  const connections = store.getGoogleConnections(telegramUserId);

  if (connections.length === 0) {
    return [
      "Google Calendar пока не подключен.",
      "Используйте /connect_calendar и выберите личный или рабочий аккаунт."
    ].join("\n");
  }

  return [
    "Подключенные Google-аккаунты и календари:",
    ...connections.flatMap((connection, accountIndex) => [
      `${accountIndex + 1}. ${connection.role === "personal" ? "personal" : "work"} - ${connection.email ?? "без email"}`,
      ...connection.calendars.map((calendar) => `   - [${calendar.enabled ? "on" : "off"}] ${calendar.summary}${calendar.primary ? " (primary)" : ""}`)
    ]),
    "",
    "Кнопками ниже можно включать и выключать календари для agenda и reminders."
  ].join("\n");
}

function getCreateMeetingHelpText() {
  return [
    "Формат создания встречи:",
    "/create_meeting YYYY-MM-DD HH:MM | Тема | Описание | 60 | email1@example.com, email2@example.com",
    "",
    "Примеры:",
    "/create_meeting 2026-05-12 15:00 | Созвон по продукту | Сверить roadmap и роли | 45 | ceo@company.com",
    'или просто напишите: "создай встречу завтра в 15:00 с командой продукта на 45 минут"'
  ].join("\n");
}

function formatBitrixConnectionStatus(telegramUserId: number): string {
  const connection = store.getBitrixConnection(telegramUserId);

  if (!connection) {
    return [
      "Bitrix24 пока не подключен.",
      "Для OAuth отправьте: /connect_bitrix yourcompany.bitrix24.ru",
      "Или как fallback: bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/"
    ].join("\n");
  }

  return [
    `Bitrix24 подключен через ${connection.authType === "oauth" ? "OAuth" : "webhook"}.`,
    connection.portalBase ? `Портал: ${connection.portalBase}` : null,
    connection.mappedUserName
      ? `Пользователь: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
      : connection.mappedUserId
        ? `Пользователь Bitrix: ${connection.mappedUserId}`
        : null
  ].filter(Boolean).join("\n");
}

function formatCreatedMeetingMessage(event: {
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  htmlLink?: string;
  joinUrl?: string;
}) {
  const startLabel = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: event.timeZone
  }).format(new Date(event.startAt));
  const endLabel = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: event.timeZone
  }).format(new Date(event.endAt));

  return [
    `Встреча создана: ${event.title}`,
    `Когда: ${startLabel} - ${endLabel}`,
    `Время показано в: ${formatGmtOffsetLabel(event.timeZone, event.startAt)}`,
    event.joinUrl ? `Войти: ${event.joinUrl}` : null,
    event.htmlLink ? `Открыть в календаре: ${event.htmlLink}` : null
  ].filter(Boolean).join("\n");
}

function formatGmtOffsetLabel(timeZone: string, dateLike: string | Date): string {
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  return value.replace("UTC", "GMT");
}

function parsePipeMeetingInput(input: string, timeZone: string): CreateCalendarEventInput | undefined {
  const parts = input.split("|").map((part) => part.trim()).filter(Boolean);

  if (parts.length < 2) {
    return undefined;
  }

  const startAt = parseMeetingDateTime(parts[0], timeZone);
  if (!startAt) {
    return undefined;
  }

  const durationMinutes = Number(parts[3] ?? "60");
  const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 60;
  const endAt = new Date(startAt.getTime() + safeDuration * 60_000);
  const attendees = (parts[4] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    title: parts[1],
    description: parts[2],
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    attendees,
    timeZone
  };
}

function parseMeetingDateTime(value: string, timeZone: string): Date | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);

  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute] = match;
  return zonedTimeToUtc(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute)
    },
    timeZone
  );
}

function zonedTimeToUtc(
  input: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  timeZone: string
): Date {
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0));
  const rendered = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(utcGuess);

  const get = (type: string) => Number(rendered.find((part) => part.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const desiredUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0);
  return new Date(utcGuess.getTime() - (asIfUtc - desiredUtc));
}

async function tryHandleMeetingCreateIntent(ctx: {
  reply: (text: string) => Promise<unknown>;
  message?: { text: string };
  from?: { id: number };
}): Promise<boolean> {
  const userId = getTelegramUserId(ctx);
  const rawText = ctx.message?.text?.trim();

  if (!userId || !rawText) {
    return false;
  }

  const commandPayload = rawText.startsWith("/create_meeting")
    ? rawText.replace(/^\/create_meeting(?:@\w+)?\s*/i, "").trim()
    : rawText;

  const lower = rawText.toLowerCase();
  const looksLikeNaturalIntent = lower.startsWith("создай встреч") || lower.startsWith("поставь встреч");
  const looksLikeCommand = rawText.startsWith("/create_meeting");

  if (!looksLikeNaturalIntent && !looksLikeCommand) {
    return false;
  }

  if (!commandPayload) {
    await ctx.reply(getCreateMeetingHelpText());
    return true;
  }

  const timeZone = calendarService.getEffectiveTimeZone(userId);
  let eventInput: CreateCalendarEventInput | undefined;

  if (looksLikeCommand) {
    eventInput = parsePipeMeetingInput(commandPayload, timeZone);
  }

  if (!eventInput && openAIService.isConfigured()) {
    try {
      const parsed = await openAIService.parseMeetingCreateRequest({
        request: commandPayload,
        timeZone
      });

      eventInput = {
        title: parsed.title,
        description: parsed.description,
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        attendees: parsed.attendees,
        timeZone
      };
    } catch (error) {
      console.error("Meeting create parse failed", error);
    }
  }

  if (!eventInput) {
    await ctx.reply(
      [
        "Не удалось разобрать параметры встречи.",
        getCreateMeetingHelpText(),
        "",
        "Если Google подключался раньше, переподключите его через /connect_calendar, чтобы выдать боту право на создание событий."
      ].join("\n")
    );
    return true;
  }

  try {
    const event = await calendarService.createEvent(userId, eventInput);
    await ctx.reply(formatCreatedMeetingMessage(event));
  } catch (error) {
    console.error("Meeting create failed", error);
    await ctx.reply(
      [
        "Не удалось создать встречу в Google Calendar.",
        "Проверьте, что календарь подключен через /connect_calendar и у бота есть write-доступ."
      ].join("\n")
    );
  }

  return true;
}

export function createBot(): Bot {
  const bot = new Bot(getConfig().TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await ctx.reply(
      [
        "Я ваш CrownPilot в Telegram.",
        "Моя задача - собрать календарь, CRM, задачи, аналитику и аппрувы в один чат.",
        "",
        "С чего можно начать:",
        "- /today",
        "- /brief",
        "- /agenda",
        "- /approvals",
        "- /pipeline",
        "- /alerts",
        "- /connect_calendar",
        "- /calendars",
        "- /connect_bitrix"
      ].join("\n"),
      { reply_markup: buildHomeKeyboard() }
    );
  });

  bot.command("help", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await ctx.reply(
      [
        "Команды MVP:",
        "/today - показать расписание и фокус дня",
        "/brief - утренний executive brief",
        "/agenda - встречи и задачи на сегодня",
        "/approvals - платежи на аппрув",
        "/pipeline - сделки в риске",
        "/alerts - executive alerts и риски",
        "/connect_calendar - подключить personal/work Google",
        "/calendars - выбрать активные календари",
        "/connect_bitrix - подключить Bitrix24",
        "/meeting_suggest - подсказать тему и описание встречи",
        "/create_meeting - создать встречу в Google Calendar",
        "",
        "Можно писать и обычным языком, например:",
        '"что у меня сегодня критичного?"'
      ].join("\n")
    );
  });

  bot.command("today", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const [brief, meetings] = await Promise.all([
      briefService.getDailyBrief(userId),
      calendarService.getTodayMeetings(userId)
    ]);

    await ctx.reply(
      [
        formatBriefMessage(brief),
        "",
        "Календарь:",
        ...meetings.map((meeting, index) => `${index + 1}. ${meeting}`)
      ].join("\n")
    );
  });

  bot.command("connect_calendar", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await ctx.reply(
      [
        "Какой Google-аккаунт подключаем?",
        "Можно подключить и личный, и рабочий, а потом выбрать нужные календари."
      ].join("\n"),
      { reply_markup: buildCalendarRoleKeyboard(userId) }
    );
  });

  bot.command("calendars", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await ctx.reply(
      formatCalendarConnections(userId),
      { reply_markup: buildCalendarSettingsKeyboard(userId) }
    );
  });

  bot.command("connect_bitrix", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const rawPortal = ctx.match?.trim();

    if (rawPortal && bitrix24ConnectionService.isOAuthConfigured()) {
      const portalDomain = normalizePortalDomain(rawPortal);
      await ctx.reply(
        [
          `Подготовил OAuth для портала ${portalDomain}.`,
          "Нажмите кнопку ниже, авторизуйтесь в Bitrix24 и вернитесь в Telegram."
        ].join("\n"),
        { reply_markup: buildBitrixConnectKeyboard(userId, portalDomain) }
      );
      return;
    }

    await ctx.reply(
      [
        formatBitrixConnectionStatus(userId),
        "",
        bitrix24ConnectionService.isOAuthConfigured()
          ? "Для нормального подключения отправьте:\n/connect_bitrix yourcompany.bitrix24.ru"
          : "Bitrix OAuth пока не настроен на сервере.",
        "",
        "Fallback-вариант через webhook:",
        "bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/"
      ].join("\n")
    );
  });

  bot.command("alerts", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const alerts = await alertsService.getAlerts(userId);
    await ctx.reply(formatAlertsMessage(alerts));
  });

  bot.command("brief", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const brief = await briefService.getDailyBrief(userId);
    await ctx.reply(formatBriefMessage(brief), { reply_markup: buildHomeKeyboard() });
  });

  bot.command("agenda", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const agenda = await agendaService.getMorningAgenda(userId);
    await ctx.reply(agenda);
  });

  bot.command("approvals", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const approvals = await briefService.getApprovals();
    await ctx.reply(formatApprovalsMessage(approvals), {
      reply_markup: new InlineKeyboard()
        .text("Approve #1", "approve:pay_001")
        .text("Review #2", "review:pay_002")
    });
  });

  bot.command("pipeline", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const risks = await briefService.getPipelineRisks(userId);
    const summary = await bitrix24Service.getPipelineSummary(userId);

    await ctx.reply(
      [
        "Сводка Bitrix24:",
        ...summary.map((line, index) => `${index + 1}. ${line}`),
        "",
        formatPipelineMessage(risks)
      ].join("\n")
    );
  });

  bot.command("meeting_suggest", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const request = ctx.match?.trim();

    if (!request) {
      await ctx.reply("Напишите после команды, для какой встречи нужна тема и описание.\nПример:\n/meeting_suggest встреча с командой по запуску продукта и распределению ролей");
      return;
    }

    if (!openAIService.isConfigured()) {
      await ctx.reply("Для этой функции нужен `OPENAI_API_KEY`. После подключения я смогу предлагать тему и содержание встречи.");
      return;
    }

    try {
      const suggestion = await openAIService.suggestMeeting({ request });
      await ctx.reply(suggestion);
    } catch (error) {
      console.error("Meeting suggestion failed", error);
      await ctx.reply("Не удалось сгенерировать тему и описание встречи.");
    }
  });

  bot.command("create_meeting", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    await tryHandleMeetingCreateIntent(ctx);
  });

  bot.callbackQuery(/^today$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Открываю сегодняшнюю сводку. Используйте /today.");
  });

  bot.callbackQuery(/^approvals$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Показываю аппрувы. Используйте /approvals.");
  });

  bot.callbackQuery(/^pipeline$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Показываю воронку. Используйте /pipeline.");
  });

  bot.callbackQuery(/^calendars$/, async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(
      formatCalendarConnections(userId),
      { reply_markup: buildCalendarSettingsKeyboard(userId) }
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
        [
          `Подключаем ${role === "personal" ? "личный" : "рабочий"} Google-аккаунт.`,
          "Откройте ссылку ниже, авторизуйтесь и вернитесь в Telegram."
        ].join("\n"),
        { reply_markup: new InlineKeyboard().url("Open Google OAuth", url) }
      );
    } catch (error) {
      console.error(error);
      await ctx.reply("Google OAuth пока не настроен. Нужны `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.");
    }
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
      const connectUrl = bitrix24ConnectionService.getOAuthConnectUrl(userId, portalDomain);
      await ctx.reply(
        [
          `Подключаем портал ${portalDomain}.`,
          "Откройте ссылку ниже, подтвердите доступ и вернитесь в Telegram."
        ].join("\n"),
        { reply_markup: new InlineKeyboard().url("Open Bitrix24 OAuth", connectUrl) }
      );
    } catch (error) {
      console.error(error);
      await ctx.reply("Bitrix OAuth пока не настроен. Нужны `BITRIX24_CLIENT_ID`, `BITRIX24_CLIENT_SECRET`, `BITRIX24_REDIRECT_URI`.");
    }
  });

  bot.callbackQuery(/^tglcal:([^:]+):(\d+)$/, async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    await ctx.answerCallbackQuery();

    const connectionId = ctx.match[1];
    const calendarIndex = Number(ctx.match[2]);
    const connection = store.getGoogleConnectionById(userId, connectionId);

    if (!connection) {
      await ctx.reply("Не удалось найти подключенный Google-аккаунт.");
      return;
    }

    const calendar = connection.calendars[calendarIndex];

    if (!calendar) {
      await ctx.reply("Не удалось найти календарь.");
      return;
    }

    store.updateGoogleCalendarEnabled(userId, connectionId, calendar.id, !calendar.enabled);
    await ctx.reply(
      formatCalendarConnections(userId),
      { reply_markup: buildCalendarSettingsKeyboard(userId) }
    );
  });

  bot.callbackQuery(/^help$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Показываю доступные команды. Используйте /help.");
  });

  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const approvalId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Аппрув зафиксирован" });
    await ctx.reply(`Платеж ${approvalId} отмечен как approved. На следующем этапе подключим реальный workflow и audit log.`);
  });

  bot.callbackQuery(/^review:(.+)$/, async (ctx) => {
    const approvalId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Отправлено на уточнение" });
    await ctx.reply(`Платеж ${approvalId} отправлен на review. На следующем этапе добавим запрос деталей у инициатора.`);
  });

  bot.on("message:text", async (ctx) => {
    const userId = getTelegramUserId(ctx);
    if (!userId) return;
    store.rememberTelegramUser(userId);
    const input = ctx.message.text.toLowerCase();

    if (await tryHandleMeetingCreateIntent(ctx)) {
      return;
    }

    if (input.includes("сегодня") || input.includes("critical") || input.includes("крит")) {
      const brief = await briefService.getDailyBrief(userId);
      await ctx.reply(formatBriefMessage(brief));
      return;
    }

    if (input.includes("аппрув") || input.includes("платеж")) {
      const approvals = await briefService.getApprovals();
      await ctx.reply(formatApprovalsMessage(approvals));
      return;
    }

    if (input.includes("алерт") || input.includes("риск") || input.includes("warning")) {
      const alerts = await alertsService.getAlerts(userId);
      await ctx.reply(formatAlertsMessage(alerts));
      return;
    }

    if (input.startsWith("/connect_bitrix ")) {
      const rawPortal = ctx.message.text.replace(/^\/connect_bitrix(?:@\w+)?\s+/i, "").trim();

      if (!rawPortal) {
        await ctx.reply("Формат: /connect_bitrix yourcompany.bitrix24.ru");
        return;
      }

      if (!bitrix24ConnectionService.isOAuthConfigured()) {
        await ctx.reply("Bitrix OAuth пока не настроен на сервере. Временно можно подключить webhook форматом `bitrix https://...`.");
        return;
      }

      const portalDomain = normalizePortalDomain(rawPortal);
      await ctx.reply(
        [
          `Подготовил OAuth для портала ${portalDomain}.`,
          "Нажмите кнопку ниже, чтобы авторизоваться."
        ].join("\n"),
        { reply_markup: buildBitrixConnectKeyboard(userId, portalDomain) }
      );
      return;
    }

    if (input.startsWith("portal ") || input.startsWith("bitrix24 ")) {
      const portalDomain = normalizePortalDomain(ctx.message.text.split(/\s+/, 2)[1] ?? "");

      if (!portalDomain) {
        await ctx.reply("Формат: portal yourcompany.bitrix24.ru");
        return;
      }

      if (!bitrix24ConnectionService.isOAuthConfigured()) {
        await ctx.reply("Bitrix OAuth пока не настроен на сервере. Временно можно подключить webhook форматом `bitrix https://...`.");
        return;
      }

      await ctx.reply(
        [
          `Подготовил OAuth для портала ${portalDomain}.`,
          "Нажмите кнопку ниже, чтобы авторизоваться."
        ].join("\n"),
        { reply_markup: buildBitrixConnectKeyboard(userId, portalDomain) }
      );
      return;
    }

    if (input.startsWith("bitrix https://")) {
      try {
        const webhookUrl = ctx.message.text.slice("bitrix ".length);
        const connection = await bitrix24ConnectionService.connectViaWebhook(userId, webhookUrl);
        await ctx.reply(
          [
            "Bitrix24 подключен через webhook.",
            connection.portalBase ? `Портал: ${connection.portalBase}` : null,
            connection.mappedUserName
              ? `Ваш Bitrix user: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
              : connection.mappedUserId
                ? `Ваш Bitrix user id: ${connection.mappedUserId}`
                : "Bitrix user не определился автоматически.",
            "Теперь задачи и напоминания будут фильтроваться по вашему пользователю."
          ].filter(Boolean).join("\n")
        );
      } catch (error) {
        await ctx.reply("Не удалось подключить Bitrix24. Проверьте webhook URL.");
        console.error(error);
      }
      return;
    }

    if (input.includes("воронк") || input.includes("сделк")) {
      const risks = await briefService.getPipelineRisks(userId);
      await ctx.reply(formatPipelineMessage(risks));
      return;
    }

    if (input.includes("встреч") && (input.includes("тема") || input.includes("описан") || input.includes("содержание"))) {
      if (!openAIService.isConfigured()) {
        await ctx.reply("Для подсказки темы и содержания встречи нужен `OPENAI_API_KEY`.");
        return;
      }

      try {
        const suggestion = await openAIService.suggestMeeting({ request: ctx.message.text });
        await ctx.reply(suggestion);
      } catch (error) {
        console.error("Meeting suggestion failed", error);
        await ctx.reply("Не удалось подготовить тему и описание встречи.");
      }
      return;
    }

    if (openAIService.isConfigured()) {
      try {
        const context = await executiveContextService.buildContext(userId);
        const answer = await openAIService.getExecutiveAdvice({
          message: ctx.message.text,
          context
        });
        await ctx.reply(answer);
        return;
      } catch (error) {
        console.error("AI advice failed", error);
        await ctx.reply("AI-слой сейчас недоступен. Можно продолжить через команды /brief, /approvals, /pipeline, /alerts.");
        return;
      }
    }

    await ctx.reply(
      [
        "AI-слой пока не подключен, поэтому я работаю в командном режиме.",
        "Попробуйте:",
        '- "что у меня сегодня критичного?"',
        '- "какие платежи ждут аппрува?"',
        '- "какие сделки в риске?"',
        '- "какие сейчас алерты?"',
        '- "/connect_calendar"',
        '- "/calendars"',
        '- "/connect_bitrix"',
        "Или добавьте `OPENAI_API_KEY`, чтобы включить живой copilot-режим."
      ].join("\n")
    );
  });

  return bot;
}
