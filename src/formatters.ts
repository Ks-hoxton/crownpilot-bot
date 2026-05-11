import type { AlertItem, ApprovalItem, PipelineRisk } from "./types.js";
import type { DailyBrief } from "./services/brief-service.js";

export function formatBriefMessage(brief: DailyBrief): string {
  const priorities = brief.priorities
    .map((item, index) => `${index + 1}. ${item.title}\nПричина: ${item.reason}`)
    .join("\n\n");

  const riskLine = brief.risks[0]
    ? `Главный риск: ${brief.risks[0].client} (${formatRub(brief.risks[0].amountRub)}) - ${brief.risks[0].issue}`
    : "Главный риск: явных критичных рисков не найдено.";

  return [
    "Утренний brief:",
    `Встреч сегодня: ${brief.meetingsCount}`,
    `Аппрувов в очереди: ${brief.approvalCount}`,
    "",
    "Фокусы дня:",
    priorities,
    "",
    riskLine
  ].join("\n");
}

export function formatApprovalsMessage(approvals: ApprovalItem[]): string {
  if (approvals.length === 0) {
    return "Сейчас нет платежей, которые ждут аппрува.";
  }

  return [
    "Платежи на аппрув:",
    ...approvals.map((item, index) =>
      [
        `${index + 1}. ${item.vendor} - ${formatRub(item.amountRub)}`,
        `Инициатор: ${item.initiator}`,
        `Срок: ${item.dueLabel}`,
        `Рекомендация: ${item.recommendation}`,
        `Контекст: ${item.comment}`
      ].join("\n")
    )
  ].join("\n\n");
}

export function formatPipelineMessage(risks: PipelineRisk[]): string {
  if (risks.length === 0) {
    return "Сделок в явном риске сейчас не найдено.";
  }

  return [
    "Сделки в риске:",
    ...risks.map((item, index) =>
      `${index + 1}. ${item.client} - ${formatRub(item.amountRub)}\nПроблема: ${item.issue}\nОтветственный: ${item.owner}`
    )
  ].join("\n\n");
}

export function formatAlertsMessage(alerts: AlertItem[]): string {
  if (alerts.length === 0) {
    return "Сейчас нет критичных алертов.";
  }

  return [
    "Executive alerts:",
    ...alerts.map((item, index) =>
      [
        `${index + 1}. [${item.severity.toUpperCase()}] ${item.title}`,
        item.message,
        `Действие: ${item.action}`
      ].join("\n")
    )
  ].join("\n\n");
}

function formatRub(amount: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(amount)} RUB`;
}
