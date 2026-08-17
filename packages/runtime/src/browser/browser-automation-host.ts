export type BrowserStatus = {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export type BrowserElement = {
  ref: string
  tag: string
  role?: string
  name: string
  value?: string
}

export type BrowserSnapshot = BrowserStatus & {
  snapshotId: string
  text: string
  elements: BrowserElement[]
}

/** Electron implements this interface; Runtime and Harness Adapters do not. */
export interface BrowserAutomationHost {
  status(threadId: string): Promise<BrowserStatus>
  open(threadId: string, url?: string): Promise<BrowserStatus>
  navigate(threadId: string, url: string): Promise<BrowserStatus>
  snapshot(threadId: string): Promise<BrowserSnapshot>
  click(threadId: string, ref: string): Promise<BrowserStatus>
  type(
    threadId: string,
    ref: string,
    text: string,
    submit: boolean
  ): Promise<BrowserStatus>
  keypress(threadId: string, key: string): Promise<BrowserStatus>
  back(threadId: string): Promise<BrowserStatus>
  forward(threadId: string): Promise<BrowserStatus>
  reload(threadId: string): Promise<BrowserStatus>
  screenshot(threadId: string): Promise<{
    status: BrowserStatus
    data: string
    mimeType: "image/png"
  }>
}
