export type ExecutivePriority = {
  title: string;
  reason: string;
};

export type ApprovalItem = {
  id: string;
  amountRub: number;
  vendor: string;
  initiator: string;
  dueLabel: string;
  recommendation: "approve" | "review" | "reject";
  comment: string;
};

export type PipelineRisk = {
  client: string;
  amountRub: number;
  issue: string;
  owner: string;
};

export type AlertItem = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  message: string;
  action: string;
};

export type CalendarMeeting = {
  id: string;
  title: string;
  startLabel: string;
  rawStart: string;
  attendees: string[];
  joinUrl?: string;
  calendarUrl?: string;
  sourceLabel?: string;
  displayTimeZone?: string;
};

export type CreateCalendarEventInput = {
  title: string;
  description?: string;
  startAt: string;
  endAt: string;
  attendees?: string[];
  calendarId?: string;
  timeZone?: string;
};

export type CreatedCalendarEvent = {
  id: string;
  title: string;
  htmlLink?: string;
  joinUrl?: string;
  startAt: string;
  endAt: string;
  calendarId: string;
  timeZone: string;
};

export type BitrixDeal = {
  id: string;
  title: string;
  stageId: string;
  stageSemanticId: "P" | "S" | "F" | string;
  amountRub: number;
  assignedById?: string;
  dateModify?: string;
  closeDate?: string;
  probability?: number;
};

export type BitrixTask = {
  id: string;
  title: string;
  deadline?: string;
  responsibleId?: string;
  status?: string;
  priority?: string;
  url?: string;
};

export type BitrixPerson = {
  id: string;
  name: string;
  birthday?: string;
  employmentDate?: string;
  registeredAt?: string;
  workPosition?: string;
};

export type BirthdayEntry = {
  person: BitrixPerson;
  age?: number;
};

export type AnniversaryEntry = {
  person: BitrixPerson;
  years: number;
};

export type GoogleCalendarRole = "personal" | "work";

export type GoogleCalendarConfig = {
  id: string;
  summary: string;
  primary: boolean;
  enabled: boolean;
  timeZone?: string;
};

export type GoogleAccountConnection = {
  connectionId: string;
  telegramUserId: number;
  role: GoogleCalendarRole;
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  scope?: string;
  email?: string;
  calendars: GoogleCalendarConfig[];
};

export type BitrixConnection = {
  telegramUserId: number;
  authType: "webhook" | "oauth";
  webhookUrl?: string;
  portalBase?: string;
  portalDomain?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientEndpoint?: string;
  memberId?: string;
  scope?: string;
  authUserId?: string;
  mappedUserId?: string;
  mappedUserName?: string;
};

export type PendingUserAction =
  | {
      type: "awaiting_bitrix_portal";
    };
