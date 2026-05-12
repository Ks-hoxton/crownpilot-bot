import { getConfig } from "../../config.js";
import { store } from "../../state/store.js";
import type { BitrixConnection } from "../../types.js";
import { Bitrix24OAuthService, normalizePortalDomain } from "./bitrix24-oauth-service.js";

type BitrixErrorResponse = {
  error?: string;
  error_description?: string;
};

export class Bitrix24RestClient {
  private readonly oauthService = new Bitrix24OAuthService();

  async callMethod<T>(
    telegramUserId: number | undefined,
    method: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    const config = getConfig();
    const userConnection = telegramUserId ? store.getBitrixConnection(telegramUserId) : undefined;

    if (userConnection) {
      return this.callUsingConnection(userConnection, method, payload);
    }

    if (config.BITRIX24_WEBHOOK_URL) {
      return this.callUsingWebhook(config.BITRIX24_WEBHOOK_URL, method, payload);
    }

    throw new Error("Bitrix24 is not connected");
  }

  async getCurrentUserProfile(connection: BitrixConnection): Promise<{ id?: string; name?: string }> {
    const data = await this.callUsingConnection<{ result?: { ID?: string | number; NAME?: string; LAST_NAME?: string } }>(
      connection,
      "profile",
      {}
    );

    return {
      id: data.result?.ID ? String(data.result.ID) : undefined,
      name: [data.result?.NAME, data.result?.LAST_NAME].filter(Boolean).join(" ").trim() || undefined
    };
  }

  async callUsingConnection<T>(
    connection: BitrixConnection,
    method: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    if (connection.authType === "webhook") {
      if (!connection.webhookUrl) {
        throw new Error("Bitrix24 webhook URL is missing");
      }

      return this.callUsingWebhook(connection.webhookUrl, method, payload);
    }

    const validConnection = await this.ensureValidOAuthConnection(connection);
    return this.callUsingOAuth(validConnection, method, payload);
  }

  private async callUsingWebhook<T>(
    webhookUrl: string,
    method: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    const normalized = webhookUrl.replace(/\/$/, "");
    const response = await fetch(`${normalized}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await this.parseJsonResponse<T>(response);
    this.throwIfBitrixError(data);
    return data;
  }

  private async callUsingOAuth<T>(
    connection: BitrixConnection,
    method: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    if (!connection.clientEndpoint || !connection.accessToken) {
      throw new Error("Bitrix24 OAuth connection is incomplete");
    }

    const endpoint = `${connection.clientEndpoint.replace(/\/$/, "")}/${method}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        ...payload,
        auth: connection.accessToken
      })
    });

    const data = await this.parseJsonResponse<T>(response);

    if (isExpiredToken(data)) {
      if (!connection.refreshToken) {
        throw new Error("Bitrix24 OAuth token expired and no refresh token is available");
      }

      const refreshed = await this.refreshConnection(connection);
      return this.callUsingOAuth(refreshed, method, payload);
    }

    this.throwIfBitrixError(data);
    return data;
  }

  private async ensureValidOAuthConnection(connection: BitrixConnection): Promise<BitrixConnection> {
    if (connection.authType !== "oauth") {
      return connection;
    }

    if (!connection.expiresAt || connection.expiresAt > Date.now() + 60_000) {
      return connection;
    }

    if (!connection.refreshToken) {
      return connection;
    }

    return this.refreshConnection(connection);
  }

  private async refreshConnection(connection: BitrixConnection): Promise<BitrixConnection> {
    const refreshed = await this.oauthService.refreshAccessToken(connection.refreshToken!);
    const updated: BitrixConnection = {
      ...connection,
      authType: "oauth",
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? connection.refreshToken,
      expiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : connection.expiresAt,
      clientEndpoint: refreshed.client_endpoint ?? connection.clientEndpoint,
      memberId: refreshed.member_id ?? connection.memberId,
      scope: refreshed.scope ?? connection.scope,
      portalDomain: refreshed.domain ? normalizePortalDomain(refreshed.domain) : connection.portalDomain,
      portalBase: refreshed.client_endpoint ? endpointToPortalBase(refreshed.client_endpoint) : connection.portalBase
    };

    store.saveBitrixConnection(updated);
    return updated;
  }

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Bitrix24 request failed: ${text}`);
    }

    return JSON.parse(text) as T;
  }

  private throwIfBitrixError(data: unknown) {
    if (typeof data !== "object" || !data) {
      return;
    }

    const typed = data as BitrixErrorResponse;
    if (typed.error) {
      throw new Error(`Bitrix24 error: ${typed.error_description ?? typed.error}`);
    }
  }
}

function isExpiredToken(data: unknown): boolean {
  if (typeof data !== "object" || !data) {
    return false;
  }

  const typed = data as BitrixErrorResponse;
  return typed.error === "expired_token";
}

export function endpointToPortalBase(clientEndpoint: string): string | undefined {
  try {
    const url = new URL(clientEndpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}
