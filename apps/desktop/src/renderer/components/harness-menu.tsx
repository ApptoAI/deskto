import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import type { Harness } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import {
  findHarness,
  harnessUnavailableReason,
  isHarnessAvailable,
} from "../lib/harness.js"
import { HarnessLogo } from "./brand-logos.js"

/** One line on what each agent is, for the menu's resting rows. */
const harnessSummaries = new Map<string, string>([
  ["claude", "Anthropic's agent. Runs with your Claude subscription."],
  ["codex", "OpenAI's agent. Runs with your ChatGPT subscription."],
])

function harnessSummary(harnessId: string): string | undefined {
  return harnessSummaries.get(harnessId)
}

export function HarnessMenu({
  harnesses,
  selectedId,
  onSelect,
}: {
  harnesses: Harness[]
  selectedId: string | null
  onSelect: (harnessId: string) => void
}) {
  const selected = selectedId ? findHarness(harnesses, selectedId) : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground" />
        }
      >
        {selected ? <HarnessLogo harnessId={selected.id} /> : null}
        {selected?.name ?? "Choose an agent"}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-72">
        <DropdownMenuRadioGroup
          value={selectedId ?? ""}
          onValueChange={(value) => onSelect(String(value))}
        >
          {harnesses.map((harness) => {
            // An unavailable agent explains itself; an available one still
            // owes the person a sentence, or the only annotated row in the
            // menu is the broken one.
            const reason =
              harnessUnavailableReason(harness) ?? harnessSummary(harness.id)
            return (
              <DropdownMenuRadioItem
                key={harness.id}
                value={harness.id}
                disabled={!isHarnessAvailable(harness)}
                closeOnClick
              >
                <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <span className="flex items-center gap-1.5">
                    <HarnessLogo harnessId={harness.id} />
                    {harness.name}
                  </span>
                  {reason ? (
                    <span className="text-xs leading-snug text-muted-foreground">
                      {reason}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
