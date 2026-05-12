import crypto from "node:crypto";
import { store } from "../../state/store.js";
import type {
  CalendarMeeting,
  CreateCalendarEventInput,
  CreatedCalendarEvent,
  GoogleAccountConnection,
  GoogleCalendarConfig
} from "../../types.js";
import { getConfig } from "../../config.js";
import { GoogleOAuthService } from "./google-oauth-service.js";

type GoogleCalendarListResponse = {
  items?: Array<{
    id: string;
    summary?: string;
    htmlLink?: string;
    hangoutLink?: string;
    start?: {
      date?: string;
      dateTime?: string;
    };
    attendees?: Array<{
      email?: string;
      self?: boolean;
    }>;
  }>;
};

type GoogleCalendarCalendarListResponse = {
  items?: Array<{
    id: string;
    summary?: string;
    primary?: boolean;
    timeZone?: string;
  }>;
};

type GoogleCalendarEventResponse = {
  id: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: {
    dateTime?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    timeZone?: string;
  };
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
    }>;
  };
};

export class GoogleCalendarService {
  private readonly oauthService = new GoogleOAuthService();

  async listCalendars(accessToken: string): Promise<GoogleCalendarConfig[]> {
    const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google calendar list fetch failed: ${errorBody}`);
    }

    const data = await response.json() as GoogleCalendarCalendarListResponse;
    return (data.items ?? []).map((calendar) => ({
      id: calendar.id,
      summary: calendar.summary?.trim() || "Без названия",
      primary: Boolean(calendar.primary),
      enabled: Boolean(calendar.primary),
      timeZone: calendar.timeZone
    }));
  }

  getEffectiveTimeZone(telegramUserId?: number): string {
    const config = getConfig();

    if (!telegramUserId) {
      return config.DEFAULT_TIMEZONE;
    }

    const connections = store.getEnabledGoogleConnections(telegramUserId);

    for (const connection of connections) {
      const primaryCalendar = connection.calendars.find((calendar) => calendar.enabled && calendar.primary && calendar.timeZone);
      if (primaryCalendar?.timeZone) {
        return primaryCalendar.timeZone;
      }
    }

    for (const connection of connections) {
      const enabledCalendar = connection.calendars.find((calendar) => calendar.enabled && calendar.timeZone);
      if (enabledCalendar?.timeZone) {
        return enabledCalendar.timeZone;
      }
    }

    return config.DEFAULT_TIMEZONE;
  }

  async getTodayMeetingItems(telegramUserId?: number): Promise<CalendarMeeting[]> {
    const connections = telegramUserId ? store.getEnabledGoogleConnections(telegramUserId) : [];
    const displayTimeZone = this.getEffectiveTimeZone(telegramUserId);

    if (!telegramUserId || connections.length === 0) {
      return [];
    }

    const allMeetings = await Promise.all(connections.map(async (connection) => {
      const hydratedConnection = await this.ensureValidAccessToken(connection);
      const enabledCalendars = hydratedConnection.calendars.filter((calendar) => calendar.enabled);
      const items = await Promise.all(enabledCalendars.map(async (calendar) => {
        const sourceLabel = `${hydratedConnection.role === "personal" ? "personal" : "work"} / ${calendar.summary}`;
        return this.fetchCalendarEvents(
          hydratedConnection.accessToken,
          calendar.id,
          sourceLabel,
          displayTimeZone
        );
      }));

      return items.flat();
    }));

    return allMeetings.flat().sort((a, b) => new Date(a.rawStart).getTime() - new Date(b.rawStart).getTime());
  }

  async createEvent(
    telegramUserId: number,
    input: CreateCalendarEventInput
  ): Promise<CreatedCalendarEvent> {
    const connection = await this.getWritableConnection(telegramUserId, input.calendarId);
    const accessToken = connection.accessToken;
    const calendarId = input.calendarId ?? pickDefaultCalendar(connection)?.id;

    if (!calendarId) {
      throw new Error("No enabled writable calendar found");
    }

    const timeZone = input.timeZone ?? this.getEffectiveTimeZone(telegramUserId);
    const attendees = (input.attendees ?? [])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email }));

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          summary: input.title,
          description: input.description,
          start: {
            dateTime: input.startAt,
            timeZone
          },
          end: {
            dateTime: input.endAt,
            timeZone
          },
          attendees,
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: {
                type: "hangoutsMeet"
              }
            }
          }
        })
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Calendar event create failed: ${errorBody}`);
    }

    const event = await response.json() as GoogleCalendarEventResponse;
    return {
      id: event.id,
      title: event.summary?.trim() || input.title,
      htmlLink: event.htmlLink,
      joinUrl: event.hangoutLink ?? event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri,
      startAt: event.start?.dateTime ?? input.startAt,
      endAt: event.end?.dateTime ?? input.endAt,
      calendarId,
      timeZone: event.start?.timeZone ?? timeZone
    };
  }

  private async fetchCalendarEvents(
    accessToken: string,
    calendarId: string,
    sourceLabel: string,
    displayTimeZone: string
  ): Promise<CalendarMeeting[]> {
    const config = getConfig();
    const { timeMin, timeMax } = getTodayRange(displayTimeZone);
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "10",
      timeZone: displayTimeZone
    });

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Calendar events fetch failed: ${errorBody}`);
    }

    const data = await response.json() as GoogleCalendarListResponse;
    const items = data.items ?? [];

    if (items.length === 0) {
      return [];
    }

    return items.map((item) => {
      const rawStart = item.start?.dateTime ?? item.start?.date ?? "";
      return {
        id: item.id,
        title: item.summary?.trim() || "Без названия",
        startLabel: formatMeetingStart(rawStart, displayTimeZone),
        rawStart,
        joinUrl: item.hangoutLink,
        calendarUrl: item.htmlLink,
        sourceLabel,
        displayTimeZone,
        attendees: (item.attendees ?? [])
          .filter((attendee) => attendee.email && !attendee.self)
          .map((attendee) => attendee.email as string)
      };
    });
  }

  private async ensureValidAccessToken(connection: GoogleAccountConnection): Promise<GoogleAccountConnection> {
    if (!connection.expiryDate || connection.expiryDate > Date.now() + 60_000 || !connection.refreshToken) {
      return connection;
    }

    const refreshed = await this.oauthService.refreshAccessToken(connection.refreshToken);
    const updated = {
      ...connection,
      accessToken: refreshed.access_token,
      expiryDate: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : connection.expiryDate,
      scope: refreshed.scope ?? connection.scope
    };

    store.saveGoogleConnection(updated);
    return updated;
  }

  private async getWritableConnection(
    telegramUserId: number,
    preferredCalendarId?: string
  ): Promise<GoogleAccountConnection> {
    const connections = store.getEnabledGoogleConnections(telegramUserId);

    if (connections.length === 0) {
      throw new Error("Google Calendar is not connected");
    }

    if (preferredCalendarId) {
      const matched = connections.find((connection) =>
        connection.calendars.some((calendar) => calendar.enabled && calendar.id === preferredCalendarId)
      );

      if (matched) {
        return this.ensureValidAccessToken(matched);
      }
    }

    const primaryConnection = connections.find((connection) => pickDefaultCalendar(connection)?.primary);
    if (primaryConnection) {
      return this.ensureValidAccessToken(primaryConnection);
    }

    return this.ensureValidAccessToken(connections[0]);
  }

  async getTodayMeetings(telegramUserId?: number): Promise<string[]> {
    const meetings = await this.getTodayMeetingItems(telegramUserId);

    if (meetings.length === 0) {
      return ["Сегодня в календаре нет встреч."];
    }

    return meetings.map((meeting) => `${meeting.startLabel} - ${meeting.title}`);
  }
}

const mockMeetings: CalendarMeeting[] = [
  {
    id: "mock-1",
    title: "Acme / финальный созвон",
    startLabel: "11:00",
    rawStart: new Date().toISOString(),
    attendees: ["sales@acme.com"],
    joinUrl: "https://meet.google.com/example-acme",
    calendarUrl: "https://calendar.google.com/calendar/event?eid=mock-1"
  },
  {
    id: "mock-2",
    title: "Внутренний sales review",
    startLabel: "14:30",
    rawStart: new Date().toISOString(),
    attendees: [],
    calendarUrl: "https://calendar.google.com/calendar/event?eid=mock-2"
  },
  {
    id: "mock-3",
    title: "Инвесторский follow-up",
    startLabel: "18:00",
    rawStart: new Date().toISOString(),
    attendees: ["partner@fund.com"],
    joinUrl: "https://meet.google.com/example-fund",
    calendarUrl: "https://calendar.google.com/calendar/event?eid=mock-3"
  }
];

function getTodayRange(timeZone: string) {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone }));
  const start = new Date(local);
  start.setHours(0, 0, 0, 0);

  const end = new Date(local);
  end.setHours(23, 59, 59, 999);

  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  };
}

function formatMeetingStart(rawStart: string, timeZone: string): string {
  if (!rawStart) {
    return "Время не указано";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) {
    return "Весь день";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone
  }).format(new Date(rawStart));
}

function pickDefaultCalendar(connection: GoogleAccountConnection): GoogleCalendarConfig | undefined {
  return connection.calendars.find((calendar) => calendar.enabled && calendar.primary)
    ?? connection.calendars.find((calendar) => calendar.enabled);
}
