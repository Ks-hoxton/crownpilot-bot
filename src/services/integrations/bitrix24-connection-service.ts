import type { BitrixConnection } from "../../types.js";
import { store } from "../../state/store.js";

export class Bitrix24ConnectionService {
  async connect(telegramUserId: number, webhookUrl: string): Promise<BitrixConnection> {
    const normalized = webhookUrl.trim();

    if (!normalized.startsWith("https://")) {
      throw new Error("Bitrix24 webhook URL must start with https://");
    }

    const portalBase = extractPortalBase(normalized);
    const fallbackUserId = extractUserIdFromWebhook(normalized);
    const profile = await this.getCurrentUserProfile(normalized).catch(() => undefined);

    const connection: BitrixConnection = {
      telegramUserId,
      webhookUrl: normalized,
      portalBase,
      authUserId: profile?.id ?? fallbackUserId,
      mappedUserId: profile?.id ?? fallbackUserId,
      mappedUserName: profile?.name
    };

    store.saveBitrixConnection(connection);
    return connection;
  }

  isConnected(telegramUserId: number): boolean {
    return Boolean(store.getBitrixConnection(telegramUserId));
  }

  private async getCurrentUserProfile(webhookUrl: string): Promise<{ id?: string; name?: string }> {
    const normalized = webhookUrl.replace(/\/$/, "");
    const response = await fetch(`${normalized}/profile`);

    if (!response.ok) {
      throw new Error(`Bitrix24 profile failed: ${await response.text()}`);
    }

    const data = await response.json() as {
      result?: {
        ID?: string | number;
        NAME?: string;
        LAST_NAME?: string;
      };
    };

    return {
      id: data.result?.ID ? String(data.result.ID) : undefined,
      name: [data.result?.NAME, data.result?.LAST_NAME].filter(Boolean).join(" ").trim() || undefined
    };
  }
}

function extractPortalBase(webhookUrl: string): string | undefined {
  try {
    const url = new URL(webhookUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function extractUserIdFromWebhook(webhookUrl: string): string | undefined {
  const match = webhookUrl.match(/\/rest\/(\d+)\//);
  return match?.[1];
}
