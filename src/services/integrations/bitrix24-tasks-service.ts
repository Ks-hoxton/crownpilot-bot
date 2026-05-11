import { getConfig } from "../../config.js";
import { store } from "../../state/store.js";
import type { BitrixTask } from "../../types.js";

type BitrixTasksListResponse = {
  result?: {
    tasks?: Array<Record<string, unknown>>;
  };
  error?: string;
  error_description?: string;
};

export class Bitrix24TasksService {
  async getUrgentTasks(telegramUserId?: number): Promise<BitrixTask[]> {
    const config = getConfig();
    const bitrixConnection = telegramUserId ? store.getBitrixConnection(telegramUserId) : undefined;
    const webhookUrl = bitrixConnection?.webhookUrl ?? config.BITRIX24_WEBHOOK_URL;

    if (!webhookUrl) {
      return mockTasks;
    }

    const endOfTomorrow = getEndOfTomorrowIso();
    const filter: Record<string, unknown> = {
      "!REAL_STATUS": [4, 5, 6, 7],
      "<=DEADLINE": endOfTomorrow
    };

    if (bitrixConnection?.mappedUserId) {
      filter.RESPONSIBLE_ID = bitrixConnection.mappedUserId;
    }

    const data = await this.callMethod<BitrixTasksListResponse>(webhookUrl, "tasks.task.list", {
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
      .map((item) => normalizeTask(item, webhookUrl))
      .filter((task) => task.deadline)
      .slice(0, 20);
  }

  async getTaskAlerts(telegramUserId?: number): Promise<BitrixTask[]> {
    const tasks = await this.getUrgentTasks(telegramUserId);
    return tasks.filter((task) => isTodayOrTomorrow(task.deadline));
  }

  private async callMethod<T>(webhookUrl: string, method: string, payload: Record<string, unknown>): Promise<T> {
    const normalized = webhookUrl.replace(/\/$/, "");
    const response = await fetch(`${normalized}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Bitrix24 ${method} failed: ${errorBody}`);
    }

    const data = await response.json() as BitrixTasksListResponse;
    if (data.error) {
      throw new Error(`Bitrix24 ${method} error: ${data.error_description ?? data.error}`);
    }

    return data as T;
  }
}

const mockTasks: BitrixTask[] = [
  {
    id: "101",
    title: "Согласовать бюджет на май",
    deadline: new Date().toISOString(),
    responsibleId: "17",
    status: "2",
    priority: "2",
    url: "https://example.bitrix24.ru/company/personal/user/17/tasks/task/view/101/"
  },
  {
    id: "102",
    title: "Дать фидбек по офферу кандидату",
    deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    responsibleId: "17",
    status: "2",
    priority: "1",
    url: "https://example.bitrix24.ru/company/personal/user/17/tasks/task/view/102/"
  }
];

function normalizeTask(item: Record<string, unknown>, webhookUrl: string): BitrixTask {
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
  const portalBase = extractPortalBase(webhookUrl);

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

function isTodayOrTomorrow(deadline?: string): boolean {
  if (!deadline) {
    return false;
  }

  const now = new Date();
  const due = new Date(deadline);
  const end = new Date();
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return due >= new Date(now.setHours(0, 0, 0, 0)) && due <= end;
}
