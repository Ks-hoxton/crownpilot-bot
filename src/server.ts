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

function renderBitrixInfoPage(title: string, message: string) {
  return [
    "<!doctype html>",
    '<html lang="ru"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${title}</title>`,
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7fb;color:#111;margin:0;padding:32px}main{max-width:640px;margin:48px auto;background:#fff;border-radius:20px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.08)}code{background:#f1f3f8;border-radius:8px;padding:2px 6px}a{color:#2a6df4}</style>',
    "</head><body>",
    `<main><h1>${title}</h1><p>${message}</p><p>Если вы настраиваете локальное приложение Bitrix24 для CrownPilot, используйте этот сервер как безопасную точку интеграции.</p><p><a href="https://t.me/CrownPilotBot">Открыть CrownPilot в Telegram</a></p></main>`,
    "</body></html>"
  ].join("");
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
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

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/oauth/bitrix/install") {
      const body = req.method === "POST" ? await readRequestBody(req) : "";

      if (body) {
        console.log("Bitrix24 install callback received");
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        renderBitrixInfoPage(
          "Bitrix24 installation callback",
          "CrownPilot принял установочный callback от Bitrix24. Теперь можно вернуться в портал, сохранить приложение и использовать выданные Client ID и Client Secret."
        )
      );
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
            `✅ ${oauthState.role === "personal" ? "Личный" : "Рабочий"} Google Calendar подключен.`,
            userInfo.email ? `Аккаунт: ${userInfo.email}` : null,
            `Найдено календарей: ${calendars.length}`,
            "По умолчанию включен primary calendar.",
            "Если хотите задачи, дни рождения и юбилеи в одном окне, следующим шагом войдите в Bitrix24."
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

    if (req.method === "GET" && (url.pathname === "/oauth/bitrix/callback" || url.pathname === "/oauth/bitrix/launch")) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (url.pathname === "/oauth/bitrix/launch" && (!code || !state)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          renderBitrixInfoPage(
            "CrownPilot Bitrix24 handler",
            "Этот handler используется локальным приложением Bitrix24. Если вы входили через Telegram, просто вернитесь в Jarvis и повторите подключение."
          )
        );
        return;
      }

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
            "✅ Bitrix24 подключен.",
            connection.portalBase ? `Портал: ${connection.portalBase}` : null,
            connection.mappedUserName
              ? `Ваш Bitrix user: ${connection.mappedUserName}${connection.mappedUserId ? ` (id ${connection.mappedUserId})` : ""}`
              : connection.mappedUserId
                ? `Ваш Bitrix user id: ${connection.mappedUserId}`
                : "Bitrix user не определился автоматически.",
            "Теперь я могу показывать ваши задачи, дни рождения и юбилеи коллег."
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
