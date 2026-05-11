import type { ApprovalItem, ExecutivePriority, PipelineRisk } from "../types.js";
import { Bitrix24Service } from "./integrations/bitrix24-service.js";
import { GoogleCalendarService } from "./integrations/google-calendar-service.js";

export type DailyBrief = {
  meetingsCount: number;
  approvalCount: number;
  priorities: ExecutivePriority[];
  risks: PipelineRisk[];
};

const mockPriorities: ExecutivePriority[] = [
  {
    title: "Подготовиться к встрече с Acme в 11:00",
    reason: "Крупная сделка без зафиксированного следующего шага."
  },
  {
    title: "Разобрать 2 платежа на аппрув",
    reason: "Оба платежа должны быть подтверждены сегодня."
  },
  {
    title: "Вернуть менеджеру владельца по сделке Beta",
    reason: "Сделка в риске из-за просроченного follow-up."
  }
];

const mockRisks: PipelineRisk[] = [
  {
    client: "Acme",
    amountRub: 4200000,
    issue: "Нет следующего шага после последнего созвона.",
    owner: "Анна"
  }
];

const mockApprovals: ApprovalItem[] = [
  {
    id: "pay_001",
    amountRub: 280000,
    vendor: "Studio X",
    initiator: "Маркетинг",
    dueLabel: "сегодня",
    recommendation: "approve",
    comment: "Оплата по текущему контракту, сумма в пределах обычного диапазона."
  },
  {
    id: "pay_002",
    amountRub: 540000,
    vendor: "Lead Partners",
    initiator: "Продажи",
    dueLabel: "сегодня",
    recommendation: "review",
    comment: "Сумма выше среднего, нужен контекст по ожидаемому результату."
  }
];

export class BriefService {
  constructor(
    private readonly calendarService = new GoogleCalendarService(),
    private readonly bitrix24Service = new Bitrix24Service()
  ) {}

  async getDailyBrief(telegramUserId?: number): Promise<DailyBrief> {
    const [meetings, risks] = await Promise.all([
      this.calendarService.getTodayMeetingItems(telegramUserId),
      this.bitrix24Service.getPipelineRisks(telegramUserId)
    ]);

    const livePriorities = buildPriorities(meetings.length, risks);

    return {
      meetingsCount: meetings.length,
      approvalCount: mockApprovals.length,
      priorities: livePriorities.length > 0 ? livePriorities : mockPriorities,
      risks: risks.length > 0 ? risks : mockRisks
    };
  }

  async getApprovals(): Promise<ApprovalItem[]> {
    return mockApprovals;
  }

  async getPipelineRisks(telegramUserId?: number): Promise<PipelineRisk[]> {
    const risks = await this.bitrix24Service.getPipelineRisks(telegramUserId);
    return risks.length > 0 ? risks : mockRisks;
  }
}

function buildPriorities(meetingsCount: number, risks: PipelineRisk[]): ExecutivePriority[] {
  const priorities: ExecutivePriority[] = [];

  if (meetingsCount > 0) {
    priorities.push({
      title: `Подготовиться к ${meetingsCount} встречам на сегодня`,
      reason: "Календарь уже заполнен, важно зайти в ключевые встречи с контекстом и следующими шагами."
    });
  }

  if (mockApprovals.length > 0) {
    priorities.push({
      title: `Разобрать ${mockApprovals.length} платежа на аппрув`,
      reason: "Платежи сдвигают исполнение, если CEO не принимает решение вовремя."
    });
  }

  if (risks[0]) {
    priorities.push({
      title: `Сделка ${risks[0].client} требует внимания`,
      reason: risks[0].issue
    });
  }

  return priorities.slice(0, 3);
}
