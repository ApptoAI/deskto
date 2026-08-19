import type { Packs } from "../storage/packs.js"
import type { PackRow } from "../storage/records.js"
import { digestPackDirectory } from "./pack-digest.js"

/** Refreshes derived Pack metadata without turning a committed write into a failure. */
export async function refreshPackDigest(
  packs: Packs,
  pack: PackRow
): Promise<void> {
  try {
    const digest = await digestPackDirectory(pack.path)
    packs.updateContentDigest(pack.id, digest.contentDigest)
  } catch {
    try {
      packs.updateContentDigest(pack.id, null)
    } catch {
      // The content write is already committed. Digest bookkeeping must not
      // report that write as failed or encourage a duplicate retry.
    }
  }
}
