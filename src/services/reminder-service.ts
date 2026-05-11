import type { Bot } from "grammy";
import { getConfig } from "../config.js";
import { store } from "../state/store.js";
import { AgendaService } from "./agenda-service.js";
import { GoogleCalendarService } from "./integrations/google-calendar-service.js";
import { Bitrix24TasksService } from "./integrations/bitrix24-tasks-service.js";

export class ReminderService {
  constructor(
    private readonly bot: Bot,
    private readonly agendaService = new AgendaService(),
    private readonly calendarService = new GoogleCalendarService(),
    private readonly tasksService = new Bitrix24TasksService()
  ) {}

  start() {
    setInterval(() => {
      void this.tick();
    }, 60_000);
  }

  async tick() {
    const telegramUserIds = store.getKnownTelegramUsers();

    for (const telegramUserId of telegramUserIds) {
      await this.sendMorningAgendaIfNeeded(telegramUserId);
      await this.sendMeetingRemindersIfNeeded(telegramUserId);
      await this.sendTaskRemindersIfNeeded(telegramUserId);
    }
  }

  private async sendMorningAgendaIfNeeded(telegramUserId: number) {
    const now = new Date();
    const key = `${telegramUserId}:${now.toISOString().slice(0, 10)}:morning`;
    const displayTimeZone = this.calendarService.getEffectiveTimeZone(telegramUserId);
    const { hour, minute } = getZonedHourMinute(now, displayTimeZone);
    const reminderState = store.getReminderState();

    if (reminderState.sentMorningAgendaKeys.has(key) || hour !== 8 || minute > 10) {
      return;
    }

    const agenda = await this.agendaService.getMorningAgenda(telegramUserId);
    await this.bot.api.sendMessage(telegramUserId, agenda);
    store.markMorningAgendaSent(key);
  }

  private async sendMeetingRemindersIfNeeded(telegramUserId: number) {
    const meetings = await this.calendarService.getTodayMeetingItems(telegramUserId);
    const nowMs = Date.now();

    for (const meeting of meetings) {
      const startMs = new Date(meeting.rawStart).getTime();
      const diffMinutes = Math.round((startMs - nowMs) / 60000);
      const meetingDate = meeting.rawStart.slice(0, 10);
      const key = `${telegramUserId}:${meeting.id}:10min:${meetingDate}`;
      const reminderState = store.getReminderState();

      if (diffMinutes >= 9 && diffMinutes <= 10 && !reminderState.sentMeetingReminderKeys.has(key)) {
        await this.bot.api.sendMessage(
          telegramUserId,
          [
            `Через 10 минут встреча: ${meeting.title}`,
            `Время: ${meeting.startLabel}`,
            `Время показано в: ${formatGmtOffsetLabel(meeting.displayTimeZone ?? this.calendarService.getEffectiveTimeZone(telegramUserId))}`,
            meeting.sourceLabel ? `Календарь: ${meeting.sourceLabel}` : null,
            `Ссылка: ${meeting.joinUrl ?? meeting.calendarUrl ?? "ссылка недоступна"}`
          ].filter(Boolean).join("\n")
        );
        store.markMeetingReminderSent(key);
      }
    }
  }

  private async sendTaskRemindersIfNeeded(telegramUserId: number) {
    const config = getConfig();
    const tasks = await this.tasksService.getTaskAlerts(telegramUserId);
    const today = new Date().toISOString().slice(0, 10);
    const key = `${telegramUserId}:${today}:tasks`;
    const reminderState = store.getReminderState();
    const displayTimeZone = this.calendarService.getEffectiveTimeZone(telegramUserId);

    if (reminderState.sentTaskReminderKeys.has(key) || tasks.length === 0) {
      return;
    }

    const lines = tasks.slice(0, 10).map((task, index) => {
      const deadline = task.deadline
        ? new Intl.DateTimeFormat("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: displayTimeZone
          }).format(new Date(task.deadline))
        : "без дедлайна";
      return `${index + 1}. ${task.title}\nДедлайн: ${deadline}${task.url ? `\n${task.url}` : ""}`;
    });

    await this.bot.api.sendMessage(
      telegramUserId,
      [
        `Время показано в: ${formatGmtOffsetLabel(displayTimeZone)}`,
        "Задачи Bitrix24 с дедлайном сегодня/завтра:",
        ...lines
      ].join("\n\n")
    );
    store.markTaskReminderSent(key);
  }
}

function getZonedHourMinute(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone
  });

  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return { hour, minute };
}

function formatGmtOffsetLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  }).formatToParts(new Date());

  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  return offset.replace("UTC", "GMT");
}
