import type { ComponentProps } from "react"

const MARK_PATH =
  "M90 0H390C650 0 820 155 820 410S650 820 390 820H90V0ZM270 170V650H390C545 650 630 560 630 410S545 170 390 170H270Z"

/** The Deskto monogram used by the app icon and compact UI. */
export function DesktoMark(props: ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 820 820"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d={MARK_PATH} fillRule="evenodd" />
    </svg>
  )
}

/** The Deskto monogram and wordmark. Size it by height; the width follows. */
export function DesktoLockup({
  title = "Deskto",
  ...props
}: { title?: string } & ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 2870 820"
      fill="currentColor"
      role="img"
      aria-label={title}
      {...props}
    >
      <path d={MARK_PATH} fillRule="evenodd" />
      <text
        x="930"
        y="650"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="650"
        fontWeight="700"
        letterSpacing="-24"
      >
        Deskto
      </text>
    </svg>
  )
}
