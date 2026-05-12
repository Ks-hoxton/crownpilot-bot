import { getConfig } from "../../config.js";
import { store } from "../../state/store.js";
import type { BitrixDeal, PipelineRisk } from "../../types.js";
import { Bitrix24RestClient } from "./bitrix24-rest-client.js";

type BitrixListResponse = {
  result?: Array<Record<string, string>>;
  error?: string;
  error_description?: string;
};

export class Bitrix24Service {
  private readonly restClient = new Bitrix24RestClient();

  async getDeals(telegramUserId?: number): Promise<BitrixDeal[]> {
    const config = getConfig();
    const bitrixConnection = telegramUserId ? store.getBitrixConnection(telegramUserId) : undefined;
    const hasAnyConnection = Boolean(bitrixConnection || config.BITRIX24_WEBHOOK_URL);

    if (!hasAnyConnection) {
      return mockDeals;
    }

    const filter: Record<string, unknown> = {
      CLOSED: "N"
    };

    if (bitrixConnection?.mappedUserId) {
      filter.ASSIGNED_BY_ID = bitrixConnection.mappedUserId;
    }

    const data = await this.restClient.callMethod<BitrixListResponse>(telegramUserId, "crm.deal.list", {
      select: [
        "ID",
        "TITLE",
        "STAGE_ID",
        "STAGE_SEMANTIC_ID",
        "OPPORTUNITY",
        "ASSIGNED_BY_ID",
        "DATE_MODIFY",
        "CLOSEDATE",
        "PROBABILITY",
        "CURRENCY_ID",
        "CLOSED"
      ],
      filter,
      order: {
        OPPORTUNITY: "DESC"
      },
      start: 0
    });

    const result = data.result ?? [];

    return result.map((item) => ({
      id: String(item.ID ?? ""),
      title: item.TITLE ?? "Без названия",
      stageId: item.STAGE_ID ?? "",
      stageSemanticId: item.STAGE_SEMANTIC_ID ?? "P",
      amountRub: toNumber(item.OPPORTUNITY),
      assignedById: item.ASSIGNED_BY_ID,
      dateModify: item.DATE_MODIFY,
      closeDate: item.CLOSEDATE,
      probability: item.PROBABILITY ? Number(item.PROBABILITY) : undefined
    }));
  }

  async getPipelineSummary(telegramUserId?: number): Promise<string[]> {
    const deals = await this.getDeals(telegramUserId);
    const activeDeals = deals.filter((deal) => deal.stageSemanticId === "P");
    const highValueDeals = activeDeals.filter((deal) => deal.amountRub >= 500000);
    const atRiskDeals = this.computePipelineRisksFromDeals(deals);
    const staleDeals = activeDeals.filter((deal) => isStale(deal.dateModify, 10));

    return [
      `${activeDeals.length} активных сделок в воронке`,
      `${atRiskDeals.length} сделки в риске`,
      `${staleDeals.length} сделки без свежего движения`,
      `${highValueDeals.length} крупные сделки выше 500k RUB`
    ];
  }

  async getPipelineRisks(telegramUserId?: number): Promise<PipelineRisk[]> {
    const deals = await this.getDeals(telegramUserId);
    return this.computePipelineRisksFromDeals(deals);
  }

  private computePipelineRisksFromDeals(deals: BitrixDeal[]): PipelineRisk[] {
    return deals
      .filter((deal) => deal.stageSemanticId === "P")
      .filter((deal) => {
        const overdueClose = deal.closeDate ? new Date(deal.closeDate) < new Date() : false;
        const lowProbability = typeof deal.probability === "number" && deal.probability < 40;
        const stale = isStale(deal.dateModify, 10);
        return overdueClose || lowProbability || stale;
      })
      .slice(0, 5)
      .map((deal) => ({
        client: deal.title,
        amountRub: deal.amountRub,
        issue: describeRisk(deal),
        owner: deal.assignedById ? `user:${deal.assignedById}` : "не назначен"
      }));
  }
}

const mockDeals: BitrixDeal[] = [
  {
    id: "1",
    title: "Acme",
    stageId: "EXECUTING",
    stageSemanticId: "P",
    amountRub: 4200000,
    assignedById: "17",
    dateModify: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    closeDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    probability: 35
  },
  {
    id: "2",
    title: "Beta Holdings",
    stageId: "PREPARATION",
    stageSemanticId: "P",
    amountRub: 680000,
    assignedById: "21",
    dateModify: new Date().toISOString(),
    closeDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    probability: 60
  },
  {
    id: "3",
    title: "Northwind",
    stageId: "FINAL_INVOICE",
    stageSemanticId: "P",
    amountRub: 1200000,
    assignedById: "17",
    dateModify: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    closeDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    probability: 75
  }
];

function toNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isStale(dateModify: string | undefined, days: number): boolean {
  if (!dateModify) {
    return true;
  }

  const diffMs = Date.now() - new Date(dateModify).getTime();
  return diffMs > days * 24 * 60 * 60 * 1000;
}

function describeRisk(deal: BitrixDeal): string {
  const reasons: string[] = [];

  if (deal.closeDate && new Date(deal.closeDate) < new Date()) {
    reasons.push("ожидаемая дата закрытия уже прошла");
  }

  if (typeof deal.probability === "number" && deal.probability < 40) {
    reasons.push(`низкая вероятность ${deal.probability}%`);
  }

  if (isStale(deal.dateModify, 10)) {
    reasons.push("нет свежего движения больше 10 дней");
  }

  return reasons.join(", ") || "требует внимания";
}
