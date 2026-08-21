import { SurfaceCommandRegistry } from "../commands/surface-commands.js"
import { BrowserSurfaceApi } from "./browser.js"
import { SurfaceNavigationApi } from "./navigation.js"
import {
  ActivitiesSurfaceApi,
  FilesSurfaceApi,
  SideSurfaceApi,
  TaskPanelApi,
  type TaskPanelCapability,
} from "./task-panel.js"

export class SurfaceApi {
  readonly commands = new SurfaceCommandRegistry()
  readonly navigation = new SurfaceNavigationApi()
  readonly panel: TaskPanelCapability
  readonly files: FilesSurfaceApi
  readonly activities: ActivitiesSurfaceApi
  readonly browser: BrowserSurfaceApi
  readonly side: SideSurfaceApi

  constructor() {
    const panel = new TaskPanelApi()
    this.panel = panel
    this.files = new FilesSurfaceApi(panel)
    this.activities = new ActivitiesSurfaceApi(panel)
    this.browser = new BrowserSurfaceApi(panel)
    this.side = new SideSurfaceApi(panel)
  }
}
