import type { AlertItem } from "../types.js";
import { BriefService } from "./brief-service.js";
import { Bitrix24Service } from "./integrations/bitrix24-service.js";
import { GoogleCalendarService } from "./integrations/google-calendar-service.js";

export class AlertsService {
  constructor(
    private readonly briefService: BriefService,
    private readonly calendarService: GoogleCalendarService,
    private readonly bitrix24Service: Bitrix24Service
  ) {}

  async getAlerts(telegramUserId?: number): Promise<AlertItem[]> {
    const [brief, meetings, pipelineSummary] = await Promise.all([
      this.briefService.getDailyBrief(telegramUserId),
      this.calendarService.getTodayMeetings(telegramUserId),
      this.bitrix24Service.getPipelineSummary(telegramUserId)
    ]);

    const alerts: AlertItem[] = [];

    if (brief.approvalCount > 0) {
      alerts.push({
        id: "approvals_due_today",
        severity: "high",
        title: `${brief.approvalCount} платежа ждут аппрува`,
        message: "Финансовые решения ждут подтверждения сегодня и могут заблокировать исполнение.",
        action: "Открыть /approvals и принять решение по срочным платежам."
      });
    }

    if (brief.risks.length > 0) {
      const risk = brief.risks[0];
      alerts.push({
        id: "top_pipeline_risk",
        severity: "high",
        title: `Сделка ${risk.client} в риске`,
        message: `Сумма ${risk.amountRub} RUB под риском: ${risk.issue}`,
        action: `Назначить следующий шаг и проверить владельца: ${risk.owner}.`
      });
    }

    if (meetings.length >= 3) {
      alerts.push({
        id: "meeting_load",
        severity: "medium",
        title: `Высокая нагрузка по встречам: ${meetings.length} на сегодня`,
        message: "При плотном календаре критично заранее подготовить talking points и ожидаемые исходы.",
        action: "Выделить 10 минут на prep перед самой важной встречей."
      });
    }

    if (pipelineSummary.some((line) => line.includes("без следующего шага"))) {
      alerts.push({
        id: "missing_next_steps",
        severity: "medium",
        title: "В Bitrix24 есть сделки без следующего шага",
        message: "Это повышает риск потери темпа в продажах и делает CEO узким горлышком.",
        action: "Попросить команду закрыть next step по каждой активной сделке."
      });
    }

    return alerts;
  }
}
