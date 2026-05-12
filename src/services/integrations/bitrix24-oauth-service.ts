import crypto from "node:crypto";
import { getConfig } from "../../config.js";
import { store } from "../../state/store.js";

const BITRIX_OAUTH_SERVER = "https://oauth.bitrix.info";

type BitrixTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  client_endpoint?: string;
  server_endpoint?: string;
  member_id?: string;
  scope?: string;
  domain?: string;
  status?: string;
  error?: string;
  error_description?: string;
};

export class Bitrix24OAuthService {
  getConnectUrl(telegramUserId: number, portalDomain: string): string {
    const config = getConfig();

    if (!config.BITRIX24_CLIENT_ID || !config.BITRIX24_REDIRECT_URI) {
      throw new Error("Bitrix24 OAuth is not configured");
    }

    const normalizedDomain = normalizePortalDomain(portalDomain);
    const state = crypto.randomUUID();

    store.saveBitrixOauthState(state, {
      telegramUserId,
      portalDomain: normalizedDomain
    });

    const params = new URLSearchParams({
      client_id: config.BITRIX24_CLIENT_ID,
      response_type: "code",
      redirect_uri: config.BITRIX24_REDIRECT_URI,
      state
    });

    return `https://${normalizedDomain}/oauth/authorize/?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<BitrixTokenResponse> {
    const config = getConfig();

    if (!config.BITRIX24_CLIENT_ID || !config.BITRIX24_CLIENT_SECRET) {
      throw new Error("Bitrix24 OAuth is not fully configured");
    }

    return this.requestToken({
      grant_type: "authorization_code",
      client_id: config.BITRIX24_CLIENT_ID,
      client_secret: config.BITRIX24_CLIENT_SECRET,
      code
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<BitrixTokenResponse> {
    const config = getConfig();

    if (!config.BITRIX24_CLIENT_ID || !config.BITRIX24_CLIENT_SECRET) {
      throw new Error("Bitrix24 OAuth is not fully configured");
    }

    return this.requestToken({
      grant_type: "refresh_token",
      client_id: config.BITRIX24_CLIENT_ID,
      client_secret: config.BITRIX24_CLIENT_SECRET,
      refresh_token: refreshToken
    });
  }

  isConfigured(): boolean {
    const config = getConfig();
    return Boolean(config.BITRIX24_CLIENT_ID && config.BITRIX24_CLIENT_SECRET && config.BITRIX24_REDIRECT_URI);
  }

  private async requestToken(params: Record<string, string>): Promise<BitrixTokenResponse> {
    const response = await fetch(`${BITRIX_OAUTH_SERVER}/oauth/token/?${new URLSearchParams(params).toString()}`);

    const data = await response.json() as BitrixTokenResponse;

    if (!response.ok || data.error) {
      throw new Error(`Bitrix24 OAuth failed: ${data.error_description ?? data.error ?? response.statusText}`);
    }

    return data;
  }
}

export function normalizePortalDomain(value: string): string {
  const trimmed = value.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
  const withoutPath = withoutProtocol.split("/")[0] ?? withoutProtocol;
  return withoutPath.toLowerCase();
}
