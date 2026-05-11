import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().int().positive().default(3000),
  STATE_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  BITRIX24_WEBHOOK_URL: z.string().optional(),
  DEFAULT_TIMEZONE: z.string().default("Europe/Moscow")
});

export type AppConfig = z.infer<typeof configSchema>;

let configCache: AppConfig | undefined;

export function getConfig(): AppConfig {
  configCache ??= configSchema.parse(process.env);
  return configCache;
}

export function resetConfigCache() {
  configCache = undefined;
}
