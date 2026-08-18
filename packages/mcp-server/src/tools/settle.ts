import { caughtErrorSchema } from "./schemas.js"

export type Settled<Item, Value> =
  | { item: Item; value: Value; error?: undefined }
  | { item: Item; value?: undefined; error: Error }

export function settleAll<Item, Value>(
  items: readonly Item[],
  run: (item: Item) => Promise<Value>
): Promise<Array<Settled<Item, Value>>> {
  return Promise.all(
    items.map(async (item) => {
      try {
        return { item, value: await run(item) }
      } catch (error) {
        return { item, error: caughtErrorSchema.parse(error) }
      }
    })
  )
}
