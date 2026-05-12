import { getConfig } from "../../config.js";
import { store } from "../../state/store.js";
import type { BitrixTask } from "../../types.js";
import { Bitrix24RestClient } from "./bitrix24-rest-client.js";

type BitrixTasksListResponse = {
  result?: {
    tasks?: Array<Record<string, unknown>>;
  };
  error?: string;
  error_description?: string;
};

export class Bitrix24TasksService {
  private readonly restClient = new Bitrix24RestClient();

  async getUrgentTasks(telegramUserId?: number): Promise<BitrixTask[]> {
    const config = getConfig();
    const bitrixConnection = telegramUserId ? store.getBitrixConnection(telegramUserId) : undefined;
    const webhookUrl = bitrixConnection?.webhookUrl ?? config.BITRIX24_WEBHOOK_URL;

    if (!bitrixConnection && !webhookUrl) {
      return [];
    }

    const endOfTomorrow = getEndOfTomorrowIso();
    const filter: Record<string, unknown> = {
      "!REAL_STATUS": [4, 5, 6, 7],
      "<=DEADLINE": endOfTomorrow
    };

    if (bitrixConnection?.mappedUserId) {
      filter.RESPONSIBLE_ID = bitrixConnection.mappedUserId;
    }

    const data = await this.restClient.callMethod<BitrixTasksListResponse>(telegramUserId, "tasks.task.list", {
      order: {
        DEADLINE: "asc"
      },
      filter,
      select: [
        "ID",
        "TITLE",
        "DEADLINE",
        "RESPONSIBLE_ID",
        "REAL_STATUS",
        "PRIORITY"
      ]
    });

    const items = data.result?.tasks ?? [];
    return items
      .map((item) => normalizeTask(item, bitrixConnection?.portalBase ?? extractPortalBase(webhookUrl ?? "")))
      .filter((task) => task.deadline)
      .slice(0, 20);
  }

  async getTaskAlerts(telegramUserId?: number, timeZone?: string): Promise<BitrixTask[]> {
    const tasks = await this.getUrgentTasks(telegramUserId);
    return tasks.filter((task) => isTodayOrTomorrow(task.deadline, timeZone));
  }

  async getTasksForDay(
    telegramUserId: number | undefined,
    dayOffset: 0 | 1,
    timeZone?: string
  ): Promise<BitrixTask[]> {
    const tasks = await this.getUrgentTasks(telegramUserId);
    return tasks.filter((task) => isOnDayOffset(task.deadline, dayOffset, timeZone));
  }
}

function normalizeTask(item: Record<string, unknown>, portalBase?: string): BitrixTask {
  const id = String(item.id ?? item.ID ?? "");
  const title = String(item.title ?? item.TITLE ?? "Без названия");
  const deadline = typeof item.deadline === "string"
    ? item.deadline
    : typeof item.DEADLINE === "string"
      ? item.DEADLINE
      : undefined;
  const responsibleId = typeof item.responsibleId === "string"
    ? item.responsibleId
    : typeof item.RESPONSIBLE_ID === "string"
      ? item.RESPONSIBLE_ID
      : undefined;
  return {
    id,
    title,
    deadline,
    responsibleId,
    status: String(item.realStatus ?? item.REAL_STATUS ?? ""),
    priority: String(item.priority ?? item.PRIORITY ?? ""),
    url: responsibleId && portalBase
      ? `${portalBase}/company/personal/user/${responsibleId}/tasks/task/view/${id}/`
      : undefined
  };
}

function extractPortalBase(webhookUrl: string): string | undefined {
  try {
    const url = new URL(webhookUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function getEndOfTomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function isTodayOrTomorrow(deadline?: string, timeZone?: string): boolean {
  if (!deadline) {
    return false;
  }

  return isOnDayOffset(deadline, 0, timeZone) || isOnDayOffset(deadline, 1, timeZone);
}

function isOnDayOffset(deadline: string | undefined, dayOffset: 0 | 1, timeZone?: string): boolean {
  if (!deadline) {
    return false;
  }

  return getDateKey(deadline, timeZone) === getDateKeyForOffset(dayOffset, timeZone);
}

function getDateKeyForOffset(dayOffset: 0 | 1, timeZone?: string): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return getDateKey(base, timeZone);
}

function getDateKey(input: string | Date, timeZone?: string): string {
  const date = typeof input === "string" ? new Date(input) : input;

  if (!timeZone) {
    return date.toISOString().slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}
