# Serrano Wazzup-Bitrix Orchestrator — Project Context

## Purpose

This NestJS service receives Wazzup events, normalizes inbound messages, stores operational state, and relays authorized traffic to `bot-crm-backend`. Bitrix24 and OpenRouter adapters remain available for legacy responsibilities.

## Runtime flow

1. Wazzup delivers an authenticated webhook.
2. The orchestrator validates and normalizes the event.
3. PostgreSQL-backed deduplication and queue logic protect processing.
4. The internal relay calls the bot with `ORCHESTRATOR_SHARED_SECRET`.
5. Outbound messages use the configured Wazzup channel.

## Security rules

- Never commit production URLs containing credentials, API keys, bearer tokens, database passwords, webhook secrets, or resolved Coolify values.
- `.env.example` must contain unmistakable placeholders only.
- Production secrets live in Coolify or an approved secret manager and must be marked hidden.
- Webhook and internal relay authentication fail closed.
- Logs must not contain message bodies or credentials at normal production levels.
- Rotate a credential immediately after suspected exposure; history rewriting does not revoke it.

## Required environment variables

- `DATABASE_URL`
- `BITRIX24_WEBHOOK_BASE_URL`
- `WAZZUP_WEBHOOK_BEARER_TOKEN`
- `WAZZUP_API_KEY`
- `BOT_INTERNAL_BASE_URL`
- `ORCHESTRATOR_SHARED_SECRET`
- `OPENROUTER_API_KEY` when legacy AI features are enabled

Values are intentionally omitted.

## Deployment

Production is managed by Coolify in the Serrano Bustamante project. Deployments must use a reviewed commit, health checks, least-privilege API tokens, and a verified rollback target.

Do not place resource credentials or Coolify tokens in this document.
