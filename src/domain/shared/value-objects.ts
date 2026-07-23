import { z } from "zod";

export const PhoneNumberSchema = z
  .string()
  .min(1)
  .refine((val) => /^\+?[0-9]{7,15}$/.test(val.replace(/[\s\-().]/g, "")), {
    message: "Invalid phone number format",
  });

export const NormalizedPhoneSchema = z
  .string()
  .regex(/^\+[1-9][0-9]{6,14}$/, "Must be E.164 format");

export const LeadTitleSchema = z.string().min(1).max(255);

export const CorrelationIdSchema = z.string().uuid();

export const DirectionSchema = z.enum(["inbound", "outbound"]);

export const MessageTypeSchema = z.enum(["text", "image", "video", "audio", "document", "other"]);

export const ProviderEventIdSchema = z.string().min(1);

export const ProviderMessageIdSchema = z.string().min(1).optional();

export const ChannelIdSchema = z.string().min(1).optional();

export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;
export type NormalizedPhone = z.infer<typeof NormalizedPhoneSchema>;
export type LeadTitle = z.infer<typeof LeadTitleSchema>;
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type MessageType = z.infer<typeof MessageTypeSchema>;
