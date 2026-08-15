import type { ComponentProps } from "react"

/**
 * Appto's own brand marks. Drawn as inline svg in currentColor — like the
 * provider logos in brand-logos.tsx — so they tint with the surrounding text
 * and follow the theme instead of needing a light and a dark asset.
 *
 * The wordmark is vectorised from the brand's appto_black.png, which ships
 * only as a raster and so can only ever be one colour.
 */

/** The sygnet on its own — the app icon shape, no wordmark. Mirrors
    appto-sygnet.svg. Ink spans x 1–1064, y 0–820 inside the viewBox. */
const MARK_PATH =
  "M567 674L567 820L1 674L1 0L567 146L567 0L900 146L900 0L1064 147L1064 820L900 674L900 820L567 674Z"

/** "appto" set in the brand face, in a 1124×354 box sitting on the mark's baseline. */
const WORDMARK_PATH =
  "M775 .34c0 .3-9.97 43.99-11.5 50.41-.53 2.23-.7 2.25-18.52 2.25H727v55h34l.04 48.75c.03 51.03.6 63.18 3.48 74.75 5.91 23.76 22.61 39 49.07 44.75 13.6 2.96 44.31 3.14 61.66.37l11.75-1.88V219l-14.75-.03c-29.7-.07-38.8-1.8-43.64-8.3-2.07-2.76-2.12-3.77-2.4-52.74l-.28-49.93H887V53h-61V0h-25.5c-14.02 0-25.5.15-25.5.34M89.5 49.07C38.93 55.97 6 90.1 6 135.63V142h30.5c16.77 0 30.5-.34 30.5-.75.19-17.7 5.38-27.42 17.07-31.92 6.62-2.55 33.12-2.54 41.43.01 11.6 3.57 16.2 10.84 17.2 27.16l.54 9-34.37 5.33c-63.42 9.83-76.82 14.09-91.87 29.16-22.03 22.06-21.96 62.03.14 84.15 28.55 28.57 93.15 23.02 119.7-10.28 6.9-8.65 7.16-8.31 7.16 9.14v15h60l-.03-71.75c-.02-40.34-.46-75.03-1-79.25-5.39-41.64-28.86-67.74-68.47-76.15-10.59-2.25-34.62-3.2-45-1.78m266 .06c-22.13 2.76-39.92 13.2-51.06 29.96-2.53 3.8-5 6.91-5.52 6.91s-.92-7.08-.92-16.5V53h-60l.25 150.25.25 150.25 32.25.26 32.25.27V301.5c0-55.86.12-57.11 4.52-48.76 3.26 6.17 14.28 16.4 21.98 20.41 26.94 14.01 65.1 12.19 89.19-4.27 28.26-19.31 42.53-53.7 42.67-102.89.06-22.37-.83-30.23-5.44-47.78-13.08-49.81-50.22-75.37-100.42-69.1m251.65.06c-21.72 2.72-42.71 15.56-51.76 31.67-1.59 2.83-3.34 5-3.89 4.82-.6-.2-1.11-6.86-1.27-16.5L549.95 53H491v301h64v-52.5c0-56.65.05-57.1 4.97-48.34 11.28 20.07 42.14 32.24 73.15 28.83 42.42-4.67 69.13-33.56 78.58-84.99 2.44-13.3 2.42-50.54-.04-63.74-11.36-60.99-48.75-91.07-104.51-84.08m390.02-.07c-49.26 5.72-81.03 35.78-91.84 86.89-2.53 11.96-2.55 46.7-.04 59.18 11.98 59.49 57.7 92.51 120.21 86.86 59.7-5.4 94.7-45.02 97.21-110.04 3.17-81.95-47.87-131.91-125.54-122.89M335 106.69c-14.99 2.5-25.46 10.89-29.71 23.77-2.16 6.53-3.12 54.6-1.28 64.04 4.15 21.31 17.96 30.46 45.99 30.47 26.34 0 38.52-8.2 44.66-30.04 2.64-9.42 2.64-49.44 0-58.86-6.25-22.26-18.27-30.24-45.12-29.93-6.62.07-13.17.32-14.54.55m248.76.87c-13.84 3.35-22.34 10.79-26.4 23.08-3.43 10.45-2.99 58.6.67 71.59 2.4 8.5 11.5 16.71 22.55 20.33 8.3 2.72 34.41 2.82 42.02.16 21.22-7.41 29.25-28.44 26.37-69.08-2.1-29.6-10.44-42.2-30.77-46.52-7.2-1.52-27.4-1.27-34.44.44m420.74.43c-28.51 2.7-37.66 16.67-37.66 57.51 0 46.5 13.58 60.61 55.16 57.33 28.43-2.25 38-16.74 38-57.52 0-41.48-10.16-55.73-41-57.54a115 115 0 0 0-14.5.22M107.5 195c-34.7 5.7-36.66 6.2-41.2 10.36-2.95 2.7-3.64 4.11-4.04 8.3-1.34 13.97 10.54 19.48 37.14 17.24 26.84-2.26 40.66-13.6 43.23-35.42l.65-5.49-3.4.12c-1.86.06-16.43 2.26-32.38 4.89"

/**
 * Lockup layout, taken from appto_black.png: the mark stands 375 units tall and
 * overshoots the wordmark's cap height by 21, and 167 units of air separate the
 * two. The mark's width follows its own aspect rather than the png's, where it
 * had been squeezed about 4% narrow.
 */
const MARK_SCALE = 375 / 820
const WORDMARK_X = 1063 * MARK_SCALE + 167

/** The sygnet alone, for tight spots where the wordmark would not read. */
export function ApptoMark(props: ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1064 821"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d={MARK_PATH} />
    </svg>
  )
}

/** The full lockup — sygnet plus "appto". Size it by height; the width follows. */
export function ApptoLockup({
  title = "Appto",
  ...props
}: { title?: string } & ComponentProps<"svg">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1777 375"
      fill="currentColor"
      role="img"
      aria-label={title}
      {...props}
    >
      <path d={MARK_PATH} transform={`scale(${MARK_SCALE}) translate(-1 0)`} />
      <path
        d={WORDMARK_PATH}
        fillRule="evenodd"
        transform={`translate(${WORDMARK_X} 21)`}
      />
    </svg>
  )
}
