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

function renderOAuthSuccessPage(title: string, message: string) {
  return [
    "<!doctype html>",
    '<html lang="ru"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${title}</title>`,
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7fb;color:#111;margin:0;padding:32px}main{max-width:560px;margin:48px auto;background:#fff;border-radius:20px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.08)}a{display:inline-block;margin-top:16px;background:#2a6df4;color:#fff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:600}</style>',
    "</head><body>",
    `<main><h1>${title}</h1><p>${message}</p><a href="https://t.me/CrownPilotBot">Вернуться в Telegram</a></main>`,
    "</body></html>"
  ].join("");
}

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
            "Используйте /calendars, чтобы включить личный и рабочий календари по отдельности.",
            "Следующий шаг: подключите второй Google-аккаунт или Bitrix24 через /connect."
          ].filter(Boolean).join("\n")
        );

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderOAuthSuccessPage("Google Calendar connected", "Подключение завершено. Возвращайтесь в Telegram, я уже привязал календарь к вашему боту."));
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
            "Теперь сделки, задачи и reminders будут читаться по вашему аккаунту.",
            "Следующий шаг: проверьте /agenda и /alerts."
          ].filter(Boolean).join("\n")
        );

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderOAuthSuccessPage("Bitrix24 connected", "Подключение завершено. Возвращайтесь в Telegram, я уже привязал ваш портал Bitrix24."));
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
