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
  triggerClassName,
  labelClassName,
  open,
  onOpenChange,
}: {
  label: string
  value: string
  options: ProfileOption[]
  onSelect: (value: string) => void
  disabled?: boolean
  contentClassName?: string
  /** Lets one menu in a row give up its label before its neighbours do. */
  triggerClassName?: string
  /** For a label short enough that half of it is worse than none of it. */
  labelClassName?: string
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
            // Buttons are shrink-0 by default, which is right for a toolbar
            // with room and wrong for this one: the composer narrows with the
            // panel, and a row that cannot give way runs out of its own box.
            // The label goes before the icon does, and the title says what the
            // icon alone cannot.
            className={cn(
              "min-w-0 shrink text-muted-foreground",
              triggerClassName
            )}
            disabled={disabled}
            title={`${label}: ${selected?.label ?? "not set"}`}
            aria-label={`${label}: ${selected?.label ?? "not set"}`}
          />
        }
      >
        {selected?.icon}
        <span className={cn("truncate", labelClassName)}>
          {selected?.label ?? label}
        </span>
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
