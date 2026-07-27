# Serrano Wazzup-Bitrix Orchestrator — Full Project Context

## Overview

Backend service for **Serrano & Bustamante**, a Venezuelan luxury interior design firm. Orchestrates WhatsApp messages (via Wazzup) into Bitrix24 CRM leads with AI chatbot.

**Stack:** NestJS + TypeScript strict + PostgreSQL + Drizzle ORM + Zod + OpenRouter (GPT-4o-mini) + Coolify

**Repo:** `github.com/Richardael/serrano-wazzup-bitrix-orchestrator`

---

## Architecture (Clean Architecture — 4 layers)

```
src/
├── domain/            # Pure entities, NO frameworks, NO NestJS, NO DB
│   ├── contacts/
│   ├── leads/
│   ├── messages/
│   ├── events/
│   └── shared/
├── application/       # Use cases, ports (interfaces), services
│   ├── ports/         # Interfaces for CRM, queue, events, phone links
│   ├── use-cases/     # Business logic
│   ├── policies/
│   └── services/      # ChatbotService, IncomingMessageHandler, LeadIntelligence
├── infrastructure/    # Implementations of ports
│   ├── database/      # Drizzle ORM schema, migrations, repositories
│   ├── bitrix24/      # Bitrix24 HTTP adapter
│   ├── wazzup/        # Wazzup HTTP adapter
│   ├── openrouter/    # OpenRouter AI adapter (GPT-4o-mini)
│   ├── queue/         # PostgreSQL-backed durable queue
│   ├── logging/
│   └── config/        # Zod-validated env vars, phone normalizer
├── interfaces/        # HTTP controllers, webhooks
│   ├── http/          # HealthController, InternalController (debug)
│   └── webhooks/      # WazzupIngestController, WazzupWebhookController
└── main.ts            # NestJS bootstrap
```

### Key rules
- `any` is PROHIBITED everywhere
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`
- `strict: true`
- Tests use Vitest

---

## Data Flow (end-to-end)

```
1. WhatsApp message arrives at Wazzup (channel 584221043091)
2. Wazzup webhook pushes to → POST /wazzup-ingest
3. WazzupIngestController:
   a. Sanitizes + stores payload for debug (/internal/last-payload)
   b. Skips outbound/echo/duplicate messages (anti-loop)
   c. Maps Wazzup native format → internal webhook payload
      - Phone: contact.phone (Wazzup sends it without +, normalized later)
      - Name: contact.name (WhatsApp display name)
      - chatId: top-level chatId (phone number, used for sendMessage)
      - channelId: top-level channelId (f2071598-...)
      - Direction: status field ("inbound"/"outbound")
      - Text: text field (message body)
4. IncomingMessageHandler.handle():
   a. Normalizes phone to E.164 (+58XXXXXXXXXX)
   b. Tries DB path (handleWithDb): persist event + queue job + process
   c. Falls back to direct path (handleDirect) if DB unavailable
   d. Calls callChatbot() after lead creation/reuse
5. handleDirect():
   a. findLeadsByPhone(normalizedPhone) → Bitrix24 crm.duplicate.findbycomm
   b. 0 leads → createLead() with title "WhatsApp / {name} / {vendor}"
   c. 1 active lead → reuse it (lead_reused)
   d. All closed → create new lead (lead_created)
   e. Multiple active → manual_review
6. ChatbotService.handleMessage():
   a. Builds system prompt with vendor name + conversation history
   b. Maintains in-memory history per chatId (last 20 turns)
   c. Calls OpenRouter GPT-4o-mini to generate response
   d. Sends response via Wazzup sendMessage API
   e. Calls LeadIntelligenceService.updateLeadFromHistory()
7. LeadIntelligenceService:
   a. Extracts structured data from conversation via AI JSON extraction
   b. Maps to Bitrix24 UF field LIST IDs (not string values)
   c. Updates lead: STATUS→IN_PROCESS, TITLE→"Rubro / Nombre / Vendor", UF fields, COMMENTS
```

---

## Bitrix24 Integration

### Portal
- URL: `https://industriae.bitrix24.com/rest/424/vbwihjyves1s2b8j/`
- Mode: CRM with LEADS (not deals)
- User: Richard Echenique (ID 424)

### Lead Fields Used

| Field | Type | Purpose |
|---|---|---|
| `TITLE` | string | Lead title (populated by orchestrator) |
| `NAME` | string | First name (from WhatsApp display name) |
| `STATUS_ID` | crm_status | Initial: NEW → updated to IN_PROCESS |
| `SOURCE_ID` | crm_status | Always WHATSAPP |
| `ASSIGNED_BY_ID` | user | Round-robin among 3 vendors |
| `PHONE` | crm_multifield | E.164 normalized phone |
| `COMMENTS` | string | Extracted data from conversation |
| `UF_CRM_RUBRO` | enum (LIST) | Rubro, set via API using LIST ID |
| `UF_CRM_ESTADO_VENEZUELA` | enum (LIST) | Estado, set via API using LIST ID |

### Lead Statuses
```
NEW → ASSIGNED → CANNOT_CONTACT → DETAILS → IN_PROCESS → ON_HOLD → RESTORED → UC_G1C4G0 → CONVERTED / JUNK
```
- Orchestrator creates leads with `NEW`
- LeadIntelligence promotes to `IN_PROCESS` when 3+ data fields collected

### UF Field LIST IDs (for API writes)

**UF_CRM_RUBRO:** 282=Iluminación, 284=Mobiliario, 286=Domótica, 288=Redes, 290=Diseño de interiores, 292=Ejecución de obra, 294=Papel tapiz, 296=Paneles

**UF_CRM_ESTADO_VENEZUELA:** 232=Amazonas, 234=Anzoátegui, ..., 256=La Guaira, ..., 278=Distrito Capital, 280=Dependencias Federales

**CRITICAL:** UF enum fields in Bitrix24 REST API must use their internal LIST ID (numeric), NOT the display string value. Example: `fields[UF_CRM_RUBRO]=282` (not "Iluminación").

### API Methods Used (READ-ONLY except create/update)

| Method | Endpoint | Purpose |
|---|---|---|
| findLeadsByPhone | `crm.duplicate.findbycomm` | Find leads by phone (no filter support for PHONE in lead.list) |
| createLead | `crm.lead.add` | Create new lead with title/phone/source/status/assigned |
| updateLead | `crm.lead.update` | Update STATUS, TITLE, COMMENTS, UF fields |
| getLead | `crm.lead.get` | Get full lead details |

### Form Body Encoding
Bitrix24 REST API uses `application/x-www-form-urlencoded` with PHP-style nested params:
- `fields[TITLE]=Hello` (flat)
- `fields[PHONE][0][VALUE]=+584141234567` (nested array)
- `fields[UF_CRM_RUBRO]=282` (UF enum by LIST ID)

The `buildFormBody` / `flattenParams` methods in Bitrix24HttpAdapter handle this encoding.

---

## Wazzup Integration

### Channel
- Channel ID: `f2071598-110c-4529-a0c8-5bdfdc718957`
- Transport: WAPI (WhatsApp Business API)
- Number: 584221043091

### Webhook
- URL: `POST /wazzup-ingest` (on Coolify domain)
- Subscriptions: `messagesAndStatuses: true`
- Configured via: `PATCH /v3/webhooks` with API key

### Real Payload Format (from Wazzup)
```json
{
  "messages": [{
    "messageId": "dc788040-9983-471c-817a-7eb3a5be3cc9",
    "dateTime": "2026-07-27T14:50:59.220Z",
    "channelId": "f2071598-110c-4529-a0c8-5bdfdc718957",
    "chatType": "whatsapp",
    "chatId": "584128027107",
    "type": "text",
    "isEcho": false,
    "contact": {
      "name": "Richard",
      "messengerChatId": "584128027107",
      "phone": "584128027107"
    },
    "text": "Hola",
    "status": "inbound"
  }]
}
```

### Send Message API
```json
POST /v3/message
{
  "chatId": "584128027107",
  "channelId": "f2071598-110c-4529-a0c8-5bdfdc718957",
  "text": "¡Hola! Soy asesora de Serrano & Bustamante...",
  "chatType": "whatsapp"
}
```
CRITICAL: `chatType: "whatsapp"` is REQUIRED.

### API Key
- Stored in Coolify env: `WAZZUP_API_KEY`
- Used for webhook config + sendMessage

---

## Vendor Assignment

### Vendors
| ID | Name | Short Name |
|---|---|---|
| 206 | Tahiruma Colina | Tahi |
| 268 | Sabrina Pontillo | Sabrina |
| 308 | Paola Perez | Paola |

### Algorithm
- Pure round-robin (in-memory counter in handler instance)
- `getNextVendor()` → increments counter → returns vendor ID
- `lastVendorId` stored for chatbot reference
- Config: `VENDOR_IDS=206,268,308`

---

## AI Chatbot (OpenRouter)

### Model: `openai/gpt-4o-mini`
- Temperature: 0.7
- Max tokens: 300
- Cost: ~$0.00002 per message

### System Prompt Design (current version)
- **Persona**: Luxury design advisor for Serrano & Bustamante
- **Tone**: Warm but professional, like a designer in her studio. NO fake enthusiasm.
- **Rules**:
  - ONE question per message. Never a checklist.
  - Acknowledge what client said first, THEN ask.
  - Never repeat greetings once conversation started.
  - Never mention prices or timelines.
  - Never say "I'm an AI" or "virtual assistant".
  - If client's unit is wrong (m³ instead of m²), assume typo, reformulate gracefully.
  - Never repeat questions already answered.
- **Data to extract** (in order, one at a time):
  1. Name (if unknown)
  2. Product / project type
  3. Space (room type)
  4. Location (state/city in Venezuela)
  5. Approximate measurements
- **Closing**: If 4+ data points collected, close gracefully: "Perfecto, {name}. Ya tengo todo. {vendor} te contactará en breve."

### Conversation Memory
- In-memory Map<chatId, ConversationTurn[]>
- Stores last 20 turns (10 exchanges)
- Passed as message history to AI
- Auto-cleans entries older than 1 hour

---

## Lead Intelligence Service

### AI Data Extraction
- Separate lightweight AI call to extract structured JSON from conversation
- Input: user messages only (filtered from history)
- Output: `{rubro, espacio, estado, ciudad, medidas, producto}`
- Trigger: after every chatbot response (async, non-blocking)
- Threshold: 3+ camposLlenos to trigger lead update

### Lead Update
When 3+ fields extracted:
1. STATUS → `IN_PROCESS` (Conversación Inicial)
2. TITLE → `{rubro} / {nombre} / {vendedora}` (e.g., "Papel tapiz / Richard / Tahi")
3. UF_CRM_RUBRO → numeric LIST ID
4. UF_CRM_ESTADO_VENEZUELA → numeric LIST ID
5. COMMENTS → structured text with all extracted data

### Location Mapping (keyword → LIST ID)
```
caracas/distrito capital → 278
la guaira/vargas → 256
maracaibo/zulia → 276
valencia/carabobo → 244
maracay/aragua → 238
barquisimeto/lara → 254
margarita/nueva esparta → 264
... (25 states total)
```

### Rubro Mapping (keyword → LIST ID)
```
iluminación → 282
mobiliario → 284
domótica → 286
redes → 288
diseño de interiores → 290
ejecución de obra → 292
papel tapiz → 294
paneles → 296
```

---

## Database Schema (PostgreSQL via Drizzle ORM)

### Tables
- **integration_events**: idempotency tracking, UUID, provider, payload_hash, status, correlation_id
- **phone_links**: normalized_phone → active_lead_ids (JSONB)
- **assignment_counter**: round-robin counter
- **integration_actions**: audit log of Bitrix24 operations
- **processing_jobs**: PostgreSQL-backed durable queue with SKIP LOCKED

Note: DB is available but not critical. Handler falls back to direct processing if DB unavailable.

---

## Anti-Loop Protection (WazzupIngestController)

1. **Outbound skip**: Ignore `status: "outbound"` messages (our own responses)
2. **Echo skip**: Ignore `isEcho: true` (Wazzup echoes sent messages)
3. **Dedup 8s**: Same chatId + same text prefix → skipped for 8 seconds
4. Manual cleanup of dedup map every ~1000 entries

---

## Coolify Deployment

### Project
- Name: Serrano Bustamante (UUID: b14jszadckc1kyhdh33hade3)
- Environment: production

### Resources
- **App**: serrano-wazzup-orchestrator (UUID: gda54z4h7uabe5ki84bz8um2)
  - Build pack: dockerfile
  - Git: Richardael/serrano-wazzup-bitrix-orchestrator.git (main)
  - Domain: `gda54z4h7uabe5ki84bz8um2.86.48.18.154.sslip.io`
- **DB**: serrano-orchestrator-db (UUID: x91l9ykcaboc80cd6r7ewemx)
  - PostgreSQL 16 Alpine
  - User: orchestrator / DB: serrano_orchestrator

### Key Env Vars
```
DATABASE_URL=postgresql://orchestrator:***@serrano-orchestrator-postgres:5432/serrano_orchestrator
BITRIX24_WEBHOOK_BASE_URL=https://industriae.bitrix24.com/rest/424/.../
VENDOR_IDS=206,268,308
WAZZUP_API_KEY=c0510394...caa7
OPENROUTER_API_KEY=sk-or-v1-f3b50031...bf06b
```

### Known Issue: Container replacement
Coolify `restart` sometimes builds the image but doesn't replace the running container. Workaround: **stop + start** (not restart) forces fresh container deployment.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check (also POST for Wazzup verification) |
| GET | `/ready` | Readiness check |
| POST | `/wazzup-ingest` | Wazzup webhook — receives all messages |
| POST | `/webhooks/wazzup/:webhookId` | Alternative webhook with auth |
| POST | `/wazzup-verify` | Wazzup verification endpoint (returns 200) |
| GET | `/internal/last-payload` | Debug: last Wazzup payload received (sanitized) |
| GET | `/internal/last-update` | Debug: last LeadIntelligence update attempt |

---

## Phone Normalization

- Library: `libphonenumber-js`
- Default country: VE (+58)
- Examples: `04141234567` → `+584141234567`, `+584141234567` → `+584141234567`
- Invalid numbers → null, logged as warning

---

## Known Quirks & Gotchas

1. **crm.lead.list filter[PHONE] doesn't work** — phone is crm_multifield, not filterable. Use `crm.duplicate.findbycomm` instead.

2. **UF enum fields need LIST IDs** — sending the string value (e.g., "Iluminación") sets it to 0/first item. Must send the numeric LIST ID (e.g., 282).

3. **Wazzup sendMessage needs chatType** — must include `"chatType": "whatsapp"` in the request body.

4. **NestJS POST returns 201 by default** — must add `@HttpCode(200)` for webhook verification.

5. **Coolify restart doesn't replace container** — use stop + start workflow.

6. **Interface injection needs @Inject()** — NestJS can't auto-resolve interface tokens. Use `@Inject("TOKEN_NAME")` or provide via factory.

7. **exactOptionalPropertyTypes strictness** — can't assign `undefined` to optional properties. Use conditional property inclusion.

8. **Wazzup webhook test ping** — requires the endpoint to return HTTP 200 on POST with `Content-Type: application/json`. Wazzup validates this before accepting the webhook URL.

---

## Current State (as of last deploy)

- App: `running:healthy`
- Webhook: configured and receiving messages
- Chatbot: AI-powered, with conversation memory and anti-loop
- Lead creation: working with `WhatsApp / {Name} / {Vendor}` title
- Lead intelligence: extracting data + updating STATUS, TITLE, UF fields, COMMENTS
- Test lead 6594 confirmed: all fields updated correctly
