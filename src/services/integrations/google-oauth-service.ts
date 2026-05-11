import crypto from "node:crypto";
import { getConfig } from "../../config.js";
import { store } from "../../state/store.js";
import type { GoogleCalendarRole } from "../../types.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export class GoogleOAuthService {
  getConnectUrl(telegramUserId: number, role: GoogleCalendarRole): string {
    const config = getConfig();

    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_REDIRECT_URI) {
      throw new Error("Google OAuth is not configured");
    }

    const state = crypto.randomUUID();
    store.saveGoogleOauthState(state, { telegramUserId, role });

    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar"
      ].join(" "),
      state
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string) {
    const config = getConfig();

    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.GOOGLE_REDIRECT_URI) {
      throw new Error("Google OAuth is not fully configured");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: config.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        code
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google token exchange failed: ${errorBody}`);
    }

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type: string;
    };

    return tokenData;
  }

  async refreshAccessToken(refreshToken: string) {
    const config = getConfig();

    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new Error("Google OAuth is not fully configured");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google token refresh failed: ${errorBody}`);
    }

    return await response.json() as {
      access_token: string;
      expires_in?: number;
      scope?: string;
      token_type: string;
    };
  }

  async getUserInfo(accessToken: string) {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google userinfo failed: ${errorBody}`);
    }

    return await response.json() as { email?: string };
  }
}
