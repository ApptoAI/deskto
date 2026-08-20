import type { UpdateState } from "../shared/desktop-api.js"
import type { UpdateDriver } from "./update-driver.js"

const initialCheckDelayMs = 15_000
const automaticCheckIntervalMs = 4 * 60 * 60 * 1_000
const checkErrorMessage =
  "Deskto couldn't check for updates. Check your connection and try again."

export class UpdateManager {
  private state: UpdateState
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private readonly unsubscribeDriver: (() => void) | undefined
  private initialCheck: ReturnType<typeof setTimeout> | undefined
  private recurringCheck: ReturnType<typeof setInterval> | undefined
  private started = false

  constructor(
    private readonly currentVersion: string,
    private readonly driver?: UpdateDriver
  ) {
    this.state = driver
      ? { status: "idle", currentVersion }
      : {
          status: "unavailable",
          currentVersion,
          message: "Updates are available in installed copies of Deskto.",
        }

    this.unsubscribeDriver = driver?.subscribe({
      checking: () => this.setState({ status: "checking", currentVersion }),
      available: (availableVersion) =>
        this.setState({
          status: "downloading",
          currentVersion,
          availableVersion,
        }),
      notAvailable: () =>
        this.setState({ status: "up-to-date", currentVersion }),
      progress: (percent) => {
        if (this.state.status !== "downloading") return
        this.setState({
          ...this.state,
          percent: Math.round(Math.max(0, Math.min(100, percent))),
        })
      },
      downloaded: (availableVersion) =>
        this.setState({
          status: "ready",
          currentVersion,
          availableVersion,
        }),
      cancelled: () =>
        this.setState({
          status: "error",
          currentVersion,
          message: "The update download stopped. Try checking again.",
        }),
      error: (error) => {
        console.error("Desktop update failed", error)
        this.setState({
          status: "error",
          currentVersion,
          message: checkErrorMessage,
        })
      },
    })
  }

  getState(): UpdateState {
    return this.state
  }

  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (!this.driver || this.started) return
    this.started = true
    this.initialCheck = setTimeout(() => void this.check(), initialCheckDelayMs)
    this.recurringCheck = setInterval(
      () => void this.check(),
      automaticCheckIntervalMs
    )
  }

  async check(): Promise<void> {
    if (
      !this.driver ||
      this.state.status === "checking" ||
      this.state.status === "downloading" ||
      this.state.status === "ready"
    ) {
      return
    }

    this.setState({ status: "checking", currentVersion: this.currentVersion })
    try {
      await this.driver.checkForUpdates()
      if (this.getState().status === "checking") {
        this.setState({
          status: "error",
          currentVersion: this.currentVersion,
          message: checkErrorMessage,
        })
      }
    } catch {
      this.setState({
        status: "error",
        currentVersion: this.currentVersion,
        message: checkErrorMessage,
      })
    }
  }

  install(): void {
    if (!this.driver || this.state.status !== "ready") {
      throw new Error("The update has not finished downloading yet.")
    }
    this.driver.quitAndInstall()
  }

  dispose(): void {
    if (this.initialCheck) clearTimeout(this.initialCheck)
    if (this.recurringCheck) clearInterval(this.recurringCheck)
    this.unsubscribeDriver?.()
    this.listeners.clear()
  }

  private setState(state: UpdateState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}
