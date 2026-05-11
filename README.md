# Telegram CEO Copilot

Telegram-first AI assistant for CEOs and founders.

## Phase 1

This repository currently includes:

- TypeScript bot skeleton
- Telegram commands and chat-first messaging
- env validation
- placeholder services for brief, approvals, and integrations
- Google OAuth callback server
- Bitrix24 webhook connection flow
- GPT-5 advice layer via OpenAI Responses API
- executive alerts service

## Run locally

1. Copy `.env.example` to `.env`
2. Fill in `TELEGRAM_BOT_TOKEN`
3. Install dependencies with `npm install`
4. Start the bot with `npm run dev`

If `npm` is missing on your machine but `node` exists, install Node.js from the official installer or use a hosting platform like Railway where `npm` is available by default.

## Commands

- `/start`
- `/help`
- `/today`
- `/brief`
- `/agenda`
- `/approvals`
- `/pipeline`
- `/alerts`
- `/connect_calendar`
- `/calendars`
- `/connect_bitrix`
- `/meeting_suggest`
- `/create_meeting`

## Next build phases

1. Connect Google Calendar
2. Connect Bitrix24
3. Add OpenAI-powered summaries
4. Add payment approval workflow
5. Add voice notes and meeting follow-up

## Create The Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Set a bot name
4. Set a username ending in `bot`
5. Copy the token into `.env` as `TELEGRAM_BOT_TOKEN`
6. If you want the display name to be `CrownPilot`, use `/setname` in `@BotFather`

## Local Start Checklist

1. Create `.env` from `.env.example`
2. Paste the Telegram token
3. Add `OPENAI_API_KEY` to enable AI advice
4. Add `STATE_ENCRYPTION_KEY` for encrypted local state
5. Run `npm install`
6. Run `npm run dev`
7. Open the bot in Telegram and press `Start`

## Deploy To Railway

1. Push this folder to GitHub
2. Create a new Railway project from the repo
3. Railway will detect [Dockerfile](/Users/hoxton/Documents/Codex/2026-05-11-24/Dockerfile)
4. Add environment variables:
   - `TELEGRAM_BOT_TOKEN`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL=gpt-5`
   - `PORT=3000`
   - `APP_BASE_URL`
   - `DEFAULT_TIMEZONE`
   - `STATE_ENCRYPTION_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - future Bitrix24 credentials if needed
5. Set `APP_BASE_URL` to your Railway public URL
6. Attach a persistent volume and mount it to `/app/data`
7. Deploy

After deploy, the bot will run continuously with long polling, so no webhook setup is required for the MVP.

Important:

- the bot uses local encrypted `SQLite` at `/app/data/state.db`
- without a persistent volume, Google/Bitrix connections and reminder state will be lost on redeploy
- the container now expects `Node 24` because the project uses `node:sqlite`

## Recommended Hosting

- `Railway` for fastest MVP deploy
- `Render` as a simple alternative
- `VPS + Docker` if you want full control

## Integration Setup

### Google Calendar

1. Create Google OAuth credentials
2. Set:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
3. The redirect URI should point to:
   - `https://your-domain.com/oauth/google/callback`
   - or `http://localhost:3000/oauth/google/callback` for local tests
4. In Telegram run `/connect_calendar`
5. Connect personal and work accounts separately if needed
6. Use `/calendars` to enable the specific calendars that should feed agenda and reminders
7. If you connected Google before meeting creation was added, reconnect it once so the bot gets write access to create events

### Bitrix24

1. Create an incoming webhook in Bitrix24
2. In Telegram run `/connect_bitrix`
3. Send:
   - `bitrix https://yourcompany.bitrix24.ru/rest/1/your_webhook/`
4. The bot will try to detect your Bitrix user automatically and filter tasks by that user

## AI Layer

The bot can use OpenAI through the Responses API for free-form CEO chat and advice.

Environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Default model:

- `gpt-5`

The AI layer is fed with:

- daily brief
- approvals
- pipeline risks
- executive alerts
- connected integrations state

## Reminder Scenarios

The bot now includes the product logic for:

- morning agenda with all meetings and links
- reminder 10 minutes before a meeting with the join link
- Bitrix24 task alerts for tasks due today or tomorrow
- AI suggestion for meeting title and description
- meeting creation in Google Calendar directly from chat
- multi-account Google onboarding for personal and work calendars
- calendar selection so only chosen calendars affect agenda and reminders

Current limitation:

- reminders work only while the bot process is running
- state is persisted in encrypted `SQLite` at `data/state.db`
- `node:sqlite` still emits an experimental warning in Node 24
- state is encrypted on disk, but this is still not a full secret-management system
