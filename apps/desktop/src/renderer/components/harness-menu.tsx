import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import type { Harness } from "@openappto/protocol"

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
        {selected?.name ?? "Choose an agent"}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-72">
        <DropdownMenuRadioGroup
          value={selectedId ?? ""}
          onValueChange={(value) => onSelect(String(value))}
        >
          {harnesses.map((harness) => {
            const reason = harnessUnavailableReason(harness)
            return (
              <DropdownMenuRadioItem
                key={harness.id}
                value={harness.id}
                disabled={!isHarnessAvailable(harness)}
                closeOnClick
              >
                <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <span>{harness.name}</span>
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
