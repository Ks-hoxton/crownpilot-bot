# Telegram CEO Copilot MVP

## Product Core

One Telegram chat where a CEO or founder can run the company without opening multiple systems.

The assistant connects to calendar, CRM, analytics, and payment approval flows, then turns that data into:

- short executive summaries
- direct answers in natural language
- approval actions
- reminders and follow-ups
- task creation

## Product Promise

One chat to run your company.

## Main Problem

CEOs do not want to live inside CRM, BI, ERP, task trackers, and finance systems. They operate from chats. Because of that:

- critical context is fragmented
- approvals are delayed
- follow-ups are lost
- priorities are unclear
- the CEO becomes a bottleneck

## MVP Goal

Deliver a Telegram bot that becomes the CEO's default operating interface for:

- daily priorities
- meeting prep
- CRM awareness
- executive summaries
- payment approvals

## Target User

Primary:

- founder
- CEO
- managing partner

Secondary:

- chief of staff
- executive assistant
- head of sales
- finance manager who needs CEO approvals

## Core Jobs To Be Done

- "Tell me what matters today."
- "Prepare me for my next meeting."
- "Show me what deals are at risk."
- "What needs my approval right now?"
- "Approve or reject this payment."
- "Summarize business status in plain language."
- "Create follow-up tasks after a meeting."

## Telegram-First UX

The main interface is a single Telegram conversation with:

- text chat
- voice note input
- inline action buttons
- scheduled digests
- approval cards
- alert messages

No heavy dashboard is required for MVP. A small admin panel may exist for setup only.

## MVP Scope

### Module 1. Executive Daily Brief

Every morning the bot sends:

- today's meetings from Google Calendar
- top priorities inferred from calendar + CRM + pending approvals
- overdue follow-ups
- urgent deals from Bitrix24
- payments waiting for approval

Example:

1. 11:00 meeting with Acme, late-stage deal worth 4.2M RUB
2. 2 payments require approval above threshold
3. 3 client follow-ups are overdue
4. Main risk: no owner assigned to next step for top pipeline deal

### Module 2. Meeting Copilot

Before each important meeting:

- meeting brief
- attendee/company context
- deal status from Bitrix24
- open tasks
- suggested talking points
- suggested next best action

After the meeting:

- summary
- action items
- owners
- due dates
- optional create task in Bitrix24

### Module 3. CRM Copilot

Natural-language access to Bitrix24:

- pipeline summary
- risky deals
- overdue activities
- deals without next step
- deals by manager
- top opportunities this week

Example commands:

- "Что у нас по воронке?"
- "Какие сделки в риске?"
- "Кого менеджеры давно не дожали?"
- "Покажи сделки без следующего шага"

### Module 4. Payment Approval Inbox

CEO receives approval cards in Telegram.

Each card includes:

- amount
- vendor or payee
- initiator
- budget category
- urgency
- due date
- comment
- supporting context
- AI recommendation

Actions:

- Approve
- Reject
- Ask for details
- Snooze

For MVP, payment requests may come from a simple internal form or Google Sheet if finance-system integration is not ready.

### Module 5. Executive Analytics Summary

Not a full BI tool. A chat summary layer over core metrics.

MVP summary areas:

- sales pipeline
- closed won this week
- overdue deals
- payment queue
- meeting load

Example questions:

- "Дай сводку по бизнесу за сегодня"
- "Что изменилось за неделю?"
- "Где основные риски?"

## Integrations For MVP

### Required

- Telegram Bot API
- Google Calendar
- Bitrix24

### Recommended for MVP+

- Google Sheets for payment approval intake
- OpenAI API
- Whisper for voice note transcription

### Later

- Gmail
- Telegram group sync
- 1C
- bank/payment systems
- Notion
- Slack
- ad platforms

## MVP Conversation Patterns

### Daily Brief

Bot:
"Доброе утро. Сегодня 4 приоритета, 2 платежа на аппрув, 1 риск по крупной сделке."

Buttons:

- Show priorities
- Show approvals
- Show deals at risk

### Approval Flow

Bot:
"Платеж 280 000 RUB. Подрядчик: Studio X. Инициатор: Маркетинг. Срок: сегодня. Рекомендация: approve."

Buttons:

- Approve
- Reject
- Details

### Meeting Prep

User:
"Подготовь меня к встрече с Acme"

Bot:

- company summary
- last interactions
- deal value
- current blockers
- recommended talking points

### Voice-to-Action

User voice note:
"Напомни Ивану закрыть следующий шаг по сделке и пришли мне summary вечером"

Bot:

- transcribes
- confirms intent
- creates reminder/task
- schedules evening summary

## Must-Have Commands

- `/start`
- `/connect_calendar`
- `/connect_bitrix`
- `/today`
- `/brief`
- `/approvals`
- `/pipeline`
- `/meeting`
- `/help`

Natural language should be the primary UX, but commands help with onboarding.

## User Stories

1. As a CEO, I want a morning summary so I know what matters without opening other tools.
2. As a CEO, I want to approve or reject payments from Telegram in one tap.
3. As a CEO, I want pre-meeting context before a call.
4. As a CEO, I want to ask pipeline questions in plain language.
5. As a CEO, I want action items created after a meeting.

## System Architecture

### Client Layer

- Telegram bot

### Backend

- API server
- webhook handler for Telegram
- auth/session layer
- integration service layer
- agent orchestration layer
- notification scheduler

### AI Layer

- GPT for reasoning, summarization, routing, recommendations
- Whisper for voice transcription

### Data Layer

- user/org profiles
- linked accounts and tokens
- normalized events from Google Calendar and Bitrix24
- approvals queue
- conversation memory
- audit log for approvals

## Suggested Tech Stack

### Fastest MVP

- `Next.js` or `Node.js` backend
- `Postgres`
- `Redis` for jobs/cache
- `Telegram Bot API`
- `OpenAI API`
- `Google Calendar API`
- `Bitrix24 REST API`

### Good split

- `Telegram bot service`
- `core API`
- `integration workers`
- `scheduler`

## Key Backend Capabilities

- OAuth/account linking for Google
- Bitrix24 account linking
- event ingestion and normalization
- LLM prompt orchestration
- structured tool calling
- approval workflow state machine
- reminder scheduling
- role-based access and audit trail

## Security Requirements

MVP still needs:

- secure token storage
- audit trail for approvals
- explicit user identity mapping
- approval confirmation logs
- access control by organization and role

For payment approvals, every action must be logged with:

- approver
- timestamp
- request payload
- decision
- reason if present

## What Not To Build In MVP

- full web dashboard
- deep ERP integration
- complex multi-agent autonomy
- custom mobile app
- broad multi-channel support
- advanced forecasting
- full document management

## Success Metrics

First 30 days:

- daily active CEOs
- average daily interactions per CEO
- morning brief open rate
- approval completion time
- number of meetings prepared by the bot
- number of CRM questions asked in chat

Product signal metrics:

- reduction in approval latency
- reduction in overdue follow-ups
- number of times CEO avoided opening another system

## MVP Delivery Plan

### Week 1

- define data model
- Telegram bot skeleton
- `/today` and `/brief` responses with mocked data

### Week 2

- Google Calendar integration
- morning brief automation
- meeting prep flow

### Week 3

- Bitrix24 integration
- pipeline summary
- deals-at-risk logic

### Week 4

- payment approval inbox using simple source
- inline action buttons
- audit logs

### Week 5

- voice note transcription
- post-meeting summary
- task/follow-up creation

### Week 6

- polish prompts
- security hardening
- pilot with 3 to 5 CEOs

## Pilot Version

For the pilot, the product promise should stay narrow:

- one Telegram bot
- one founder or CEO per company
- one connected calendar
- one connected Bitrix24 workspace
- one payment approval queue

The fastest path is to make the bot indispensable for 3 repeatable moments:

1. morning brief
2. payment approvals
3. meeting prep and follow-up

## Positioning

Telegram assistant for CEOs that brings calendar, CRM, analytics, and approvals into one chat.

Short version:

One chat to run your company.
