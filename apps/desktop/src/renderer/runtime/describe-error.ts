import { RuntimeClientError } from "@openappto/client"
import { z } from "zod"

export const describedErrorSchema = z
  .union([z.instanceof(RuntimeClientError), z.instanceof(Error)])
  .transform((error) => error.message)
  .catch("The runtime did not explain what went wrong.")
