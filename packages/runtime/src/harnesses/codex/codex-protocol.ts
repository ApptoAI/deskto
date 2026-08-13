export type JsonObject = Record<string, unknown>

export type CodexNotification = {
  method: string
  params?: JsonObject
}

export type CodexServerRequest = CodexNotification & {
  id: string | number
}

export type CodexThreadResponse = {
  thread: { id: string }
}

export type CodexTurnResponse = {
  turn: { id: string }
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function getString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key]
    : undefined
}
