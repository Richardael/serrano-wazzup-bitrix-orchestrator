import { ProcessIncomingMessageUseCase } from "./process-incoming-message.use-case";

describe("ProcessIncomingMessageUseCase", () => {
  it("upserts the contact before creating a NEW lead linked to it", async () => {
    const calls: string[] = [];
    const bitrix = {
      upsertContact: vi.fn(async () => {
        calls.push("contact");
        return "contact-1";
      }),
      findLeadsByPhone: vi.fn(async () => {
        calls.push("find-leads");
        return [];
      }),
      createLead: vi.fn(async (input: { statusId: string; contactId?: string }) => {
        calls.push("lead");
        expect(input).toMatchObject({ statusId: "NEW", contactId: "contact-1" });
        return "lead-1";
      }),
      updateLead: vi.fn(),
    };
    const eventRepo = {
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    const phoneLinkRepo = { upsert: vi.fn().mockResolvedValue(undefined) };
    const useCase = new ProcessIncomingMessageUseCase(
      {} as never,
      bitrix as never,
      eventRepo as never,
      phoneLinkRepo as never,
      {} as never,
    );

    await useCase.execute(
      {
        providerEventId: "event-1",
        providerMessageId: "message-1",
        channelId: "channel-1",
        direction: "inbound",
        messageType: "text",
        occurredAt: new Date().toISOString(),
        contact: {
          externalId: null,
          displayName: "Ana Perez",
          rawPhone: "+15550000000",
          normalizedPhone: "+15550000000" as never,
        },
        content: { hasText: true, textHash: null, hasAttachments: false },
        rawMetadata: null,
      },
      "event-1",
    );

    expect(calls).toEqual(["contact", "find-leads", "lead"]);
    expect(eventRepo.updateStatus).toHaveBeenLastCalledWith("event-1", "COMPLETED");
  });
});
