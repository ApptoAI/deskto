import type { RuntimeOptions } from "@deskto/runtime"

type HarnessFactory = RuntimeOptions["harnesses"][number]

/**
 * Wraps a harness so it always probes as unavailable, for exercising the
 * first-run wizard on a machine where the real CLIs work. Everything except
 * the availability answer delegates, so the descriptor — and with it the
 * renderer's cards — stay exactly what production shows.
 */
export function withForcedUnavailability(
  factory: HarnessFactory,
  reason: string
): HarnessFactory {
  const stub: HarnessFactory = {
    descriptor: factory.descriptor,
    checkAvailability: () =>
      Promise.resolve({ status: "unavailable" as const, reason }),
    listModels: () => factory.listModels(),
    start: (input, signal) => factory.start(input, signal),
  }
  if (factory.generateText) {
    stub.generateText = (input, signal) => factory.generateText!(input, signal)
  }
  if (factory.discoverSkillRoots) {
    stub.discoverSkillRoots = (input) => factory.discoverSkillRoots!(input)
  }
  return stub
}
