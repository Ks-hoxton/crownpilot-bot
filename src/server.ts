import http from "node:http";
import { URL } from "node:url";
import crypto from "node:crypto";
import { Bot } from "grammy";
import { getConfig } from "./config.js";
import { Bitrix24ConnectionService } from "./services/integrations/bitrix24-connection-service.js";
import { GoogleCalendarService } from "./services/integrations/google-calendar-service.js";
import { Bitrix24OAuthService } from "./services/integrations/bitrix24-oauth-service.js";
import { GoogleOAuthService } from "./services/integrations/google-oauth-service.js";
import { store } from "./state/store.js";

const googleOAuthService = new GoogleOAuthService();
const googleCalendarService = new GoogleCalendarService();
const bitrixOAuthService = new Bitrix24OAuthService();
const bitrixConnectionService = new Bitrix24ConnectionService();

export function createHttpServer(bot: Bot) {
  return http.createServer(async (req, res) => {
    const config = getConfig();

    if (!req.url) {
      res.writeHead(400);
      res.end("Missing URL");
      return;
    }

    const url = new URL(req.url, config.APP_BASE_URL);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/oauth/google/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing code or state");
        return;
      }

      const oauthState = store.consumeGoogleOauthState(state);

      if (!oauthState) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("OAuth state expired or invalid");
        return;
      }

      try {
        const tokenData = await googleOAuthService.exchangeCode(code);
        const userInfo = await googleOAuthService.getUserInfo(tokenData.access_token);
        const calendars = await googleCalendarService.listCalendars(tokenData.access_token);

        store.saveGoogleConnection({
          connectionId: crypto.randomUUID(),
          telegramUserId: oauthState.telegramUserId,
          role: oauthState.role,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiryDate: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
          scope: tokenData.scope,
          email: userInfo.email,
          calendars: calendars.map((calendar) => ({
            ...calendar,
            enabled: calendar.primary
          }))
        });

        await bot.api.sendMessage(
          oauthState.telegramUserId,
          [
            `Google ${oauthState.role === "personal" ? "personal" : "work"} account подключен.`,
            userInfo.email ? `Аккаунт: ${userInfo.email}` : null,
            `Найдено календарей: ${calendars.length}`,
            "По умолчанию включен primary calendar.",
            "Используйте /calendars, чтобы включить личный и рабочий календари по отдельности."
          ].filter(Boolean).join("\n")
        );

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Google Calendar connected</h1><p>You can return to Telegram.</p>");
      } catch (error) {
        console.error("Google OAuth callback failed", error);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Google Calendar connection failed");
      }

      return;
    }

    if (req.method === "GET" && url.pathname === "/oauth/bitrix/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing code or state");
        return;
      }

      const oauthState = store.consumeBitrixOauthState(state);

      if (!oauthState) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("OAuth state expired or invalid");
        return;
      }

      try {
        const tokenData = await bitrixOAuthService.exchangeCode(code);
        const connection = await bitrixConnectionService.connectViaOAuth(
          oauthState.telegramUserId,
          tokenData,
          oauthState.portalDomain
        );

        await bot.api.sendMessage(
          oauthState.telegramUserId,
          [
            "Bitrix24 подключен через OAuth.",
            connection.portalBase ? `Портал: ${connection.portalBase}` : null,
            connection.mappedUserName
              ? `Ваш Bitrix user: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
              : connection.mappedUserId
                ? `Ваш Bitrix user id: ${connection.mappedUserId}`
                : "Bitrix user не определился автоматически.",
            "Теперь сделки, задачи и reminders будут читаться по вашему аккаунту."
          ].filter(Boolean).join("\n")
        );

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Bitrix24 connected</h1><p>You can return to Telegram.</p>");
      } catch (error) {
        console.error("Bitrix24 OAuth callback failed", error);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bitrix24 connection failed");
      }

      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });
}
