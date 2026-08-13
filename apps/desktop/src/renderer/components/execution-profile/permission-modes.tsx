import LockIcon from "lucide-react/dist/esm/icons/lock"
import LockOpenIcon from "lucide-react/dist/esm/icons/lock-open"
import ShieldAlertIcon from "lucide-react/dist/esm/icons/shield-alert"
import type { ExecutionProfile } from "@openappto/protocol"

import type { ProfileOption } from "./profile-menu.js"

type PermissionMode = ExecutionProfile["permissionMode"]

export const permissionOptions: (ProfileOption & { value: PermissionMode })[] =
  [
    {
      value: "approval-required",
      label: "Ask",
      description: "The agent asks before it runs commands or changes files.",
      icon: <LockIcon />,
    },
    {
      value: "auto",
      label: "Auto",
      description:
        "The agent handles routine steps inside this project and asks about risky ones.",
      icon: <LockOpenIcon />,
    },
    {
      value: "full-access",
      label: "Full access",
      description:
        "No sandbox and no questions. The agent can delete files, reach the network, and change anything this computer account can change.",
      icon: <ShieldAlertIcon />,
    },
  ]

export function toPermissionMode(value: string): PermissionMode {
  return (
    permissionOptions.find((option) => option.value === value)?.value ??
    "approval-required"
  )
}
