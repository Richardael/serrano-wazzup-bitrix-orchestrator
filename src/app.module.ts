import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AppConfig } from "./infrastructure/config/app.config";
import { Bitrix24HttpAdapter } from "./infrastructure/bitrix24/bitrix24-http.adapter";
import { PgEventRepository } from "./infrastructure/database/repositories/pg-event.repository";
import { PgPhoneLinkRepository } from "./infrastructure/database/repositories/pg-phone-link.repository";
import { PgAssignmentCounterRepository } from "./infrastructure/database/repositories/pg-assignment-counter.repository";
import { PgQueueAdapter } from "./infrastructure/queue/pg-queue.adapter";
import { ProcessIncomingMessageUseCase } from "./application/use-cases/process-incoming-message.use-case";
import { IncomingMessageHandler } from "./application/services/incoming-message.handler";
import { HealthController } from "./interfaces/http/health.controller";
import { WazzupWebhookController } from "./interfaces/webhooks/wazzup-webhook.controller";
import { WazzupIngestController } from "./interfaces/webhooks/wazzup-ingest.controller";
import { MessageWorker } from "./interfaces/webhooks/message.worker";
import { MigrationRunner } from "./infrastructure/database/migration-runner";
import { WazzupHttpAdapter } from "./infrastructure/wazzup/wazzup-http.adapter";
import { ChatbotService } from "./application/services/chatbot.service";
import { OpenRouterAdapter } from "./infrastructure/openrouter/openrouter.adapter";
import { InternalController } from "./interfaces/http/internal.controller";

const BITRIX24_PORT = "BITRIX24_PORT";
const EVENT_REPOSITORY = "EVENT_REPOSITORY";
const PHONE_LINK_REPOSITORY = "PHONE_LINK_REPOSITORY";
const ASSIGNMENT_COUNTER_REPOSITORY = "ASSIGNMENT_COUNTER_REPOSITORY";
const QUEUE_PORT = "QUEUE_PORT";
const WAZZUP_PORT = "WAZZUP_PORT";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, WazzupWebhookController, WazzupIngestController, InternalController],
  providers: [
    AppConfig,
    {
      provide: BITRIX24_PORT,
      useClass: Bitrix24HttpAdapter,
    },
    {
      provide: EVENT_REPOSITORY,
      useClass: PgEventRepository,
    },
    {
      provide: PHONE_LINK_REPOSITORY,
      useClass: PgPhoneLinkRepository,
    },
    {
      provide: ASSIGNMENT_COUNTER_REPOSITORY,
      useClass: PgAssignmentCounterRepository,
    },
    {
      provide: QUEUE_PORT,
      useClass: PgQueueAdapter,
    },
    {
      provide: WAZZUP_PORT,
      useClass: WazzupHttpAdapter,
    },
    {
      provide: ProcessIncomingMessageUseCase,
      useFactory: (
        config: AppConfig,
        bitrix24: Bitrix24HttpAdapter,
        eventRepo: PgEventRepository,
        phoneLinkRepo: PgPhoneLinkRepository,
        counterRepo: PgAssignmentCounterRepository,
        queue: PgQueueAdapter,
      ) =>
        new ProcessIncomingMessageUseCase(config, bitrix24, eventRepo, phoneLinkRepo, counterRepo, queue),
      inject: [
        AppConfig,
        BITRIX24_PORT,
        EVENT_REPOSITORY,
        PHONE_LINK_REPOSITORY,
        ASSIGNMENT_COUNTER_REPOSITORY,
        QUEUE_PORT,
      ],
    },
    {
      provide: IncomingMessageHandler,
      useFactory: (
        config: AppConfig,
        eventRepo: PgEventRepository,
        queue: PgQueueAdapter,
        bitrix24: Bitrix24HttpAdapter,
        phoneLinkRepo: PgPhoneLinkRepository,
        chatbot: ChatbotService,
      ) => new IncomingMessageHandler(config, eventRepo, queue, bitrix24, phoneLinkRepo, chatbot),
      inject: [AppConfig, EVENT_REPOSITORY, QUEUE_PORT, BITRIX24_PORT, PHONE_LINK_REPOSITORY, ChatbotService],
    },
    MessageWorker,
    MigrationRunner,
    WazzupHttpAdapter,
    ChatbotService,
    OpenRouterAdapter,
  ],
})
export class AppModule {}
