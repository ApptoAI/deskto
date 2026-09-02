export const minimumConversationWidth = 520
export const minimumTaskPanelWidth = 280

/** The Slack rail-stack is the widest sidebar. */
const maximumSidebarWidth = 328

export const minimumWindowWidth =
  maximumSidebarWidth + minimumConversationWidth + minimumTaskPanelWidth

/** Passed to the renderer's argv when the window sits on a native blur. */
export const frostedShellArgument = "--deskto-frosted-shell"
