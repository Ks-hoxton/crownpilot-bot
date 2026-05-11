import { getConfig } from "../config.js";
import { GoogleCalendarService } from "./integrations/google-calendar-service.js";
import { Bitrix24TasksService } from "./integrations/bitrix24-tasks-service.js";

export class AgendaService {
  constructor(
    private readonly calendarService = new GoogleCalendarService(),
    private readonly tasksService = new Bitrix24TasksService()
  ) {}

  async getMorningAgenda(telegramUserId: number): Promise<string> {
    const config = getConfig();
    const [meetings, tasks] = await Promise.all([
      this.calendarService.getTodayMeetingItems(telegramUserId),
      this.tasksService.getTaskAlerts(telegramUserId)
    ]);
    const displayTimeZone = this.calendarService.getEffectiveTimeZone(telegramUserId);

    const meetingLines = meetings.length === 0
      ? ["Сегодня встреч в календаре нет."]
      : meetings.map((meeting, index) => {
        const link = meeting.joinUrl ?? meeting.calendarUrl ?? "ссылка появится после подключения Google Meet/Calendar";
        return `${index + 1}. ${meeting.startLabel} - ${meeting.title}${meeting.sourceLabel ? `\nКалендарь: ${meeting.sourceLabel}` : ""}\nСсылка: ${link}`;
      });

    const taskLines = tasks.length === 0
      ? ["Нет задач с дедлайном на сегодня и завтра."]
      : tasks.map((task, index) => {
        const deadline = task.deadline
          ? new Intl.DateTimeFormat("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: config.DEFAULT_TIMEZONE
            }).format(new Date(task.deadline))
          : "без дедлайна";
        return `${index + 1}. ${task.title}\nДедлайн: ${deadline}${task.url ? `\nОткрыть: ${task.url}` : ""}`;
      });

    return [
      "Утренний agenda:",
      `Время показано в: ${formatGmtOffsetLabel(displayTimeZone)}`,
      "",
      "Встречи:",
      ...meetingLines,
      "",
      "Задачи Bitrix24, которые просрочатся сегодня или завтра:",
      ...taskLines
    ].join("\n");
  }
}

function formatGmtOffsetLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  }).formatToParts(new Date());

  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  return offset.replace("UTC", "GMT");
}
