import { DesktoLockup } from "../deskto-logo.js"

/**
 * The brand lockup over the task start screen. It is the real mark rather than
 * a ghosted word: this screen is the one place in the app with nothing in it
 * yet, so it is the one place the product is allowed to say its own name at
 * full strength instead of whispering it behind the content.
 */
export function DesktoWordmark() {
  return <DesktoLockup className="h-[52px] w-auto shrink-0 text-body" />
}
