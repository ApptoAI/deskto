import type { ReactNode } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

export type ProfileOption = {
  value: string
  label: string
  description?: string | undefined
  icon?: ReactNode
}

export function ProfileMenu({
  label,
  value,
  options,
  onSelect,
  disabled = false,
  contentClassName,
  open,
  onOpenChange,
}: {
  label: string
  value: string
  options: ProfileOption[]
  onSelect: (value: string) => void
  disabled?: boolean
  contentClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const selected = options.find((option) => option.value === value)

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 text-muted-foreground"
            disabled={disabled}
            aria-label={`${label}: ${selected?.label ?? "not set"}`}
          />
        }
      >
        {selected?.icon}
        <span className="truncate">{selected?.label ?? label}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className={cn("w-64", contentClassName)}
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onSelect(String(next))}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
            >
              <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                <span className="flex items-center gap-1.5">
                  {option.icon}
                  {option.label}
                </span>
                {option.description ? (
                  <span className="text-xs leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
