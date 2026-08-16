import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@openappto/protocol"
import { z } from "zod"

export type { JsonObject, JsonValue }

export const codexNotificationSchema = z.object({
  method: z.string(),
  params: jsonObjectSchema.optional(),
})

export type CodexNotification = z.infer<typeof codexNotificationSchema>

export const codexServerRequestSchema = codexNotificationSchema.extend({
  id: z.union([z.string(), z.number()]),
})

export type CodexServerRequest = z.infer<typeof codexServerRequestSchema>

export const codexThreadResponseSchema = z.object({
  thread: z.object({ id: z.string() }),
})

export type CodexThreadResponse = z.infer<typeof codexThreadResponseSchema>

export const codexTurnResponseSchema = z.object({
  turn: z.object({ id: z.string() }),
})

export type CodexTurnResponse = z.infer<typeof codexTurnResponseSchema>

export function parseJsonObject(
  value: JsonValue | undefined
): JsonObject | undefined {
  const parsed = jsonObjectSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function getString(
  value: JsonObject | undefined,
  key: string
): string | undefined {
  const parsed = z.string().safeParse(value?.[key])
  return parsed.success ? parsed.data : undefined
}

export function parseJsonValue(value: string): JsonValue | undefined {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
