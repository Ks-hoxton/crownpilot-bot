import type { BitrixConnection } from "../../types.js";
import { store } from "../../state/store.js";
import { Bitrix24OAuthService, normalizePortalDomain } from "./bitrix24-oauth-service.js";
import { Bitrix24RestClient, endpointToPortalBase } from "./bitrix24-rest-client.js";

export class Bitrix24ConnectionService {
  private readonly restClient = new Bitrix24RestClient();
  private readonly oauthService = new Bitrix24OAuthService();

  async connectViaWebhook(telegramUserId: number, webhookUrl: string): Promise<BitrixConnection> {
    const normalized = webhookUrl.trim();

    if (!normalized.startsWith("https://")) {
      throw new Error("Bitrix24 webhook URL must start with https://");
    }

    const fallbackUserId = extractUserIdFromWebhook(normalized);
    const draftConnection: BitrixConnection = {
      telegramUserId,
      authType: "webhook",
      webhookUrl: normalized,
      portalBase: extractPortalBase(normalized),
      portalDomain: extractPortalDomain(normalized),
      authUserId: fallbackUserId,
      mappedUserId: fallbackUserId
    };

    const profile = await this.restClient.getCurrentUserProfile(draftConnection).catch(() => undefined);

    const connection: BitrixConnection = {
      ...draftConnection,
      authUserId: profile?.id ?? fallbackUserId,
      mappedUserId: profile?.id ?? fallbackUserId,
      mappedUserName: profile?.name
    };

    store.saveBitrixConnection(connection);
    return connection;
  }

  async connectViaOAuth(
    telegramUserId: number,
    tokenData: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      client_endpoint?: string;
      member_id?: string;
      scope?: string;
      domain?: string;
    },
    fallbackPortalDomain: string
  ): Promise<BitrixConnection> {
    const portalDomain = normalizePortalDomain(tokenData.domain ?? fallbackPortalDomain);

    const draftConnection: BitrixConnection = {
      telegramUserId,
      authType: "oauth",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
      clientEndpoint: tokenData.client_endpoint,
      memberId: tokenData.member_id,
      scope: tokenData.scope,
      portalDomain,
      portalBase: tokenData.client_endpoint ? endpointToPortalBase(tokenData.client_endpoint) : `https://${portalDomain}`
    };

    const profile = await this.restClient.getCurrentUserProfile(draftConnection).catch(() => undefined);

    const connection: BitrixConnection = {
      ...draftConnection,
      authUserId: profile?.id,
      mappedUserId: profile?.id,
      mappedUserName: profile?.name
    };

    store.saveBitrixConnection(connection);
    return connection;
  }

  getOAuthConnectUrl(telegramUserId: number, portalDomain: string): string {
    return this.oauthService.getConnectUrl(telegramUserId, portalDomain);
  }

  isOAuthConfigured(): boolean {
    return this.oauthService.isConfigured();
  }

  isConnected(telegramUserId: number): boolean {
    return Boolean(store.getBitrixConnection(telegramUserId));
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

function extractPortalDomain(webhookUrl: string): string | undefined {
  try {
    return normalizePortalDomain(webhookUrl);
  } catch {
    return undefined;
  }
}

function extractUserIdFromWebhook(webhookUrl: string): string | undefined {
  const match = webhookUrl.match(/\/rest\/(\d+)\//);
  return match?.[1];
}
