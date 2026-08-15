import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

import { DropdownMenuContent } from "@workspace/ui/components/dropdown-menu"

/**
 * A menu opened by right-click or long press instead of by a button. Base UI
 * shares the popup, items and submenus with the dropdown menu, so only the
 * root and the trigger are new here — everything inside is a
 * `DropdownMenuItem`, `DropdownMenuSub`, and so on.
 */
const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuContent = DropdownMenuContent

export { ContextMenu, ContextMenuContent, ContextMenuTrigger }
