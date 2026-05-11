import { store } from "../state/store.js";
import { BriefService } from "./brief-service.js";
import { AlertsService } from "./alerts-service.js";
import { Bitrix24Service } from "./integrations/bitrix24-service.js";
import { GoogleCalendarService } from "./integrations/google-calendar-service.js";

export class ExecutiveContextService {
  constructor(
    private readonly briefService: BriefService,
    private readonly alertsService: AlertsService,
    private readonly calendarService: GoogleCalendarService,
    private readonly bitrix24Service: Bitrix24Service
  ) {}

  async buildContext(telegramUserId: number): Promise<string> {
    const [brief, approvals, risks, alerts, meetings, pipelineSummary] = await Promise.all([
      this.briefService.getDailyBrief(telegramUserId),
      this.briefService.getApprovals(),
      this.briefService.getPipelineRisks(telegramUserId),
      this.alertsService.getAlerts(telegramUserId),
      this.calendarService.getTodayMeetings(telegramUserId),
      this.bitrix24Service.getPipelineSummary(telegramUserId)
    ]);

    const googleConnected = store.getGoogleConnections(telegramUserId).length > 0;
    const bitrixConnected = Boolean(store.getBitrixConnection(telegramUserId));

    return [
      "Assistant role: AI chief of staff for a CEO/founder.",
      "Style: concise, practical, executive-level, action-oriented.",
      `Google Calendar connected: ${googleConnected ? "yes" : "no"}`,
      `Bitrix24 connected: ${bitrixConnected ? "yes" : "no"}`,
      "",
      "Daily brief:",
      `Meetings count: ${brief.meetingsCount}`,
      `Approvals count: ${brief.approvalCount}`,
      `Top priorities: ${brief.priorities.map((item) => `${item.title} (${item.reason})`).join("; ")}`,
      "",
      "Meetings:",
      meetings.join("; "),
      "",
      "Pipeline summary:",
      pipelineSummary.join("; "),
      "",
      "Pipeline risks:",
      risks.map((item) => `${item.client} ${item.amountRub} RUB - ${item.issue} - owner ${item.owner}`).join("; ") || "none",
      "",
      "Approvals:",
      approvals.map((item) => `${item.vendor} ${item.amountRub} RUB - ${item.recommendation} - ${item.comment}`).join("; ") || "none",
      "",
      "Alerts:",
      alerts.map((item) => `[${item.severity}] ${item.title}: ${item.message}. Action: ${item.action}`).join("; ") || "none"
    ].join("\n");
  }
}
