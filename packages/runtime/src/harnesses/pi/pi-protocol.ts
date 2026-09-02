import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@deskto/protocol"
import { z } from "zod"

export type { JsonObject, JsonValue }

/** One line Pi writes on stdout in RPC mode: an event or a command response. */
export const piEventSchema = jsonObjectSchema.and(
  z.object({ type: z.string() })
)

export type PiEvent = z.infer<typeof piEventSchema>

export const piResponseSchema = z.object({
  type: z.literal("response"),
  id: z.string().optional(),
  command: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  data: jsonValueSchema.optional(),
})

export type PiResponse = z.infer<typeof piResponseSchema>

export const piStateSchema = z.object({
  sessionId: z.string().optional(),
  sessionFile: z.string().optional(),
  model: z
    .object({
      id: z.string().optional(),
      provider: z.string().optional(),
      contextWindow: z.number().optional(),
    })
    .optional(),
})

export type PiState = z.infer<typeof piStateSchema>

/** One entry of `get_available_models`; a `null` level in the map is hidden. */
export const piModelSchema = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  contextWindow: z.number().optional(),
  thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
})

export type PiModel = z.infer<typeof piModelSchema>

export const piAvailableModelsSchema = z.object({
  models: z.array(piModelSchema),
})

export const piUsageSchema = z.object({
  totalTokens: z.number().optional(),
  input: z.number().optional(),
  output: z.number().optional(),
})

export const piAssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  usage: piUsageSchema.optional(),
})

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
