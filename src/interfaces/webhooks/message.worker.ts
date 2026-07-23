import { Injectable, Logger, Inject } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { QueuePort } from "../../application/ports/queue.port";
import { ProcessIncomingMessageUseCase } from "../../application/use-cases/process-incoming-message.use-case";
import { EventRepository } from "../../application/ports/event-repository.port";
import { AppConfig } from "../../infrastructure/config/app.config";

const QUEUE_PORT = "QUEUE_PORT";
const EVENT_REPOSITORY = "EVENT_REPOSITORY";

interface ProcessMessageJobPayload {
  eventId: string;
  normalizedPhone: string;
  direction: string;
  messageType: string;
  contactName: string | null;
  [key: string]: unknown;
}

@Injectable()
export class MessageWorker {
  private readonly logger = new Logger(MessageWorker.name);

  constructor(
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
    private readonly useCase: ProcessIncomingMessageUseCase,
    @Inject(EVENT_REPOSITORY) private readonly eventRepo: EventRepository,
    private readonly config: AppConfig,
  ) {}

  @Interval(2000)
  async poll(): Promise<void> {
    try {
      const jobs = await this.queue.dequeue<ProcessMessageJobPayload>("process-incoming-message", 3);

      for (const job of jobs) {
        try {
          const event = await this.eventRepo.findByProviderEventId(
            "WAZZUP",
            job.payload.eventId,
          );

          if (!event) {
            this.logger.warn(`Event not found for job ${job.id}`);
            await this.queue.fail(job.id, "Event not found");
            continue;
          }

          const normalizedMessage = {
            providerEventId: "",
            providerMessageId: null,
            channelId: null,
            direction: job.payload.direction as "inbound" | "outbound",
            messageType: job.payload.messageType as "text" | "image" | "video" | "audio" | "document" | "other",
            occurredAt: new Date().toISOString(),
            contact: {
              externalId: null,
              displayName: job.payload.contactName,
              rawPhone: job.payload.normalizedPhone,
              normalizedPhone: job.payload.normalizedPhone,
            },
            content: {
              hasText: false,
              textHash: null,
              hasAttachments: false,
            },
            rawMetadata: null,
          };

          await this.useCase.execute(normalizedMessage, job.payload.eventId);
          await this.queue.complete(job.id);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Job ${job.id} failed: ${errorMsg}`);

          if (job.attempts >= this.config.env.JOB_MAX_ATTEMPTS) {
            await this.queue.fail(job.id, errorMsg);
          } else {
            const backoffMs = Math.pow(2, job.attempts) * 1000 + Math.random() * 1000;
            await this.queue.retry(job.id, backoffMs);
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Worker poll error: ${errorMsg}`);
    }
  }
}
