import { getConfig } from "../config.js";
import { GoogleCalendarService } from "./integrations/google-calendar-service.js";
import { Bitrix24PeopleService } from "./integrations/bitrix24-people-service.js";
import { Bitrix24TasksService } from "./integrations/bitrix24-tasks-service.js";

export class AgendaService {
  constructor(
    private readonly calendarService = new GoogleCalendarService(),
    private readonly tasksService = new Bitrix24TasksService(),
    private readonly peopleService = new Bitrix24PeopleService()
  ) {}

  async getMorningAgenda(telegramUserId: number): Promise<string> {
    const [meetings, tasksToday, birthdaysToday, anniversariesToday] = await Promise.all([
      this.calendarService.getTodayMeetingItems(telegramUserId),
      this.tasksService.getTasksForDay(telegramUserId, 0, this.calendarService.getEffectiveTimeZone(telegramUserId)),
      this.peopleService.getBirthdaysForDay(telegramUserId, 0, this.calendarService.getEffectiveTimeZone(telegramUserId)).catch(() => []),
      this.peopleService.getAnniversariesForToday(telegramUserId, this.calendarService.getEffectiveTimeZone(telegramUserId)).catch(() => [])
    ]);
    const displayTimeZone = this.calendarService.getEffectiveTimeZone(telegramUserId);

    const meetingLines = meetings.length === 0
      ? ["Сегодня встреч в календаре нет."]
      : meetings.map((meeting, index) => {
        const link = meeting.joinUrl ?? meeting.calendarUrl ?? "ссылка появится после подключения Google Meet/Calendar";
        return `${index + 1}. ${meeting.startLabel} - ${meeting.title}${meeting.sourceLabel ? `\nКалендарь: ${meeting.sourceLabel}` : ""}\nСсылка: ${link}`;
      });

    const taskLines = tasksToday.length === 0
      ? ["Нет задач с дедлайном на сегодня."]
      : tasksToday.map((task, index) => {
        const deadline = task.deadline
          ? new Intl.DateTimeFormat("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: displayTimeZone
            }).format(new Date(task.deadline))
          : "без дедлайна";
        return `${index + 1}. ${task.title}\nДедлайн: ${deadline}${task.url ? `\nОткрыть: ${task.url}` : ""}`;
      });

    const birthdayLines = birthdaysToday.length === 0
      ? ["Сегодня дней рождения нет."]
      : birthdaysToday.map((entry, index) =>
        [
          `${index + 1}. ${entry.person.name}${entry.person.workPosition ? `, ${entry.person.workPosition}` : ""}`,
          entry.age ? `Исполняется: ${entry.age}` : null
        ].filter(Boolean).join("\n")
      );

    const anniversaryLines = anniversariesToday.length === 0
      ? ["Сегодня юбилеев коллег нет."]
      : anniversariesToday.map((entry, index) =>
        [
          `${index + 1}. ${entry.person.name}${entry.person.workPosition ? `, ${entry.person.workPosition}` : ""}`,
          `В компании: ${entry.years} ${pluralizeYears(entry.years)}`
        ].join("\n")
      );

    return [
      "План на сегодня",
      `Время показано в: ${formatGmtOffsetLabel(displayTimeZone)}`,
      "",
      "Мои встречи сегодня:",
      ...meetingLines,
      "",
      "Мои задачи сегодня:",
      ...taskLines
      ,
      "",
      "Дни рождения сегодня:",
      ...birthdayLines,
      "",
      "Юбилеи коллег сегодня:",
      ...anniversaryLines
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
