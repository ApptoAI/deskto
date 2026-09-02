import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import ActivityIcon from "lucide-react/dist/esm/icons/activity"
import BoxesIcon from "lucide-react/dist/esm/icons/boxes"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import ChevronLeftIcon from "lucide-react/dist/esm/icons/chevron-left"
import ClipboardListIcon from "lucide-react/dist/esm/icons/clipboard-list"
import CopyIcon from "lucide-react/dist/esm/icons/copy"
import FileTextIcon from "lucide-react/dist/esm/icons/file-text"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import GitBranchIcon from "lucide-react/dist/esm/icons/git-branch"
import HandIcon from "lucide-react/dist/esm/icons/hand"
import InboxIcon from "lucide-react/dist/esm/icons/inbox"
import LayersIcon from "lucide-react/dist/esm/icons/layers"
import LayoutTemplateIcon from "lucide-react/dist/esm/icons/layout-template"
import PinIcon from "lucide-react/dist/esm/icons/pin"
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw"
import SearchIcon from "lucide-react/dist/esm/icons/search"
import ShieldCheckIcon from "lucide-react/dist/esm/icons/shield-check"
import {
  appSettings,
  settingValue,
  themeOptions,
  type ThemePreference,
} from "@deskto/settings"
import type { Harness } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { openExternal } from "../../lib/desktop.js"
import { describeHarnessHealth, isHarnessAvailable } from "../../lib/harness.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import { useSettings } from "../../settings/settings-context.js"
import type { RuntimeQuery } from "../../runtime/use-runtime-query.js"
import { HarnessLogo } from "../brand-logos.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"
import { PreviewPane } from "../theme-preview.js"
import {
  InboxScene,
  OrchestrationScene,
  ProjectsScene,
  ScenePanel,
} from "./onboarding-scenes.js"

type OnboardingStep =
  | "welcome"
  | "inbox"
  | "projects"
  | "orchestrate"
  | "appearance"
  | "agent"
  | "project"

/** The poetry column changes with the step; the right pane does the work. */
const steps: readonly {
  id: OnboardingStep
  label: string
  poetry: string
}[] = [
  {
    id: "welcome",
    label: "Welcome",
    poetry: "Everything you delegate comes back done.",
  },
  {
    id: "inbox",
    label: "The inbox",
    poetry: "Ten tasks running. One place to look.",
  },
  {
    id: "projects",
    label: "Projects",
    poetry: "Every project gets its own workforce.",
  },
  {
    id: "orchestrate",
    label: "Orchestration",
    poetry: "One task fans out into many.",
  },
  {
    id: "appearance",
    label: "Appearance",
    poetry: "Dark, light, or whatever the day is.",
  },
  {
    id: "agent",
    label: "Connect an agent",
    poetry: "Bring the agents you already trust.",
  },
  {
    id: "project",
    label: "Create a project",
    poetry: "It all starts with a folder.",
  },
]

/** Per-provider setup copy; the health line itself comes from the probe. */
const harnessSetup = new Map<
  string,
  { install: string; signInHint: string; docsUrl: string }
>([
  [
    "claude",
    {
      install: "npm install -g @anthropic-ai/claude-code",
      signInHint: "Then run claude in a terminal and sign in.",
      docsUrl: "https://docs.claude.com/en/docs/claude-code/overview",
    },
  ],
  [
    "codex",
    {
      install: "npm install -g @openai/codex",
      signInHint: "Then run codex in a terminal and sign in.",
      docsUrl: "https://developers.openai.com/codex/cli",
    },
  ],
])

/**
 * The first-run wizard: a fixed poetry column on the left, the working pane
 * on the right. Owns the whole window until the user finishes or skips; both
 * land in the normal workbench, which is why finishing is a single callback
 * instead of navigation.
 */
export function OnboardingView({
  harnesses,
  workspaceReady,
  hasProject,
  creatingProject,
  onCreateProject,
  onFinish,
}: {
  harnesses: RuntimeQuery<Harness[]>
  workspaceReady: boolean
  hasProject: boolean
  creatingProject: boolean
  onCreateProject: () => void
  onFinish: () => void
}) {
  const client = useRuntimeClient()
  const { snapshot, update } = useSettings()
  const theme = settingValue(snapshot, appSettings.theme)

  const [step, setStep] = useState<OnboardingStep>("welcome")
  const [direction, setDirection] = useState<"forward" | "back">("forward")
  const [checking, setChecking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Whether a project existed when the project step opened: a project that
  // appears afterwards was created here, so the wizard finishes itself.
  const [hadProjectOnEnter, setHadProjectOnEnter] = useState(hasProject)

  const available =
    harnesses.state.status === "ready" &&
    harnesses.state.data.some(isHarnessAvailable)

  const stepIndex = steps.findIndex((candidate) => candidate.id === step)
  const current = steps[stepIndex]!

  function goTo(next: OnboardingStep, dir: "forward" | "back") {
    if (next === "project") setHadProjectOnEnter(hasProject)
    setDirection(dir)
    setActionError(null)
    setStep(next)
  }

  function goForward() {
    const next = steps[stepIndex + 1]
    if (next) goTo(next.id, "forward")
  }

  function goBack() {
    const previous = steps[stepIndex - 1]
    if (previous) goTo(previous.id, "back")
  }

  useEffect(() => {
    if (step === "project" && hasProject && !hadProjectOnEnter) {
      onFinish()
    }
  }, [step, hasProject, hadProjectOnEnter, onFinish])

  // The registry refreshes on its own only every few minutes; while the user
  // is staring at the connect step, a fresh install should show up in
  // seconds, so this step polls with force-probes until something is ready.
  const replaceHarnesses = harnesses.replace
  useEffect(() => {
    if (step !== "agent" || available) return
    const timer = setInterval(() => {
      client.refreshHarnesses().then(replaceHarnesses, () => {})
    }, 15_000)
    return () => clearInterval(timer)
  }, [step, available, client, replaceHarnesses])

  async function checkAgain() {
    setChecking(true)
    setActionError(null)
    try {
      replaceHarnesses(await client.refreshHarnesses())
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    } finally {
      setChecking(false)
    }
  }

  function selectTheme(value: ThemePreference) {
    setActionError(null)
    update({ [appSettings.theme.key]: value }).catch((error) => {
      setActionError(describedErrorSchema.parse(error))
    })
  }

  const preConfirmedProject = hasProject && hadProjectOnEnter
  const primary: { label: string; onClick: () => void; disabled?: boolean } =
    step === "welcome"
      ? { label: "Get started", onClick: goForward }
      : step === "agent"
        ? { label: "Continue", onClick: goForward, disabled: !available }
        : step === "project"
          ? preConfirmedProject
            ? { label: "Finish", onClick: onFinish }
            : {
                label: creatingProject ? "Creating…" : "Create project",
                onClick: onCreateProject,
                disabled: creatingProject || !workspaceReady,
              }
          : { label: "Continue", onClick: goForward }
  const skipLabel = step === "welcome" ? "Skip setup" : "Skip for now"

  return (
    <div className="relative flex min-h-0 flex-1">
      {/* The whole top strip drags the window; controls below it opt out. */}
      <div className="drag-region absolute inset-x-0 top-0 z-50 h-10" />

      <aside className="hidden w-2/5 max-w-[520px] min-w-72 flex-col justify-between border-r border-border bg-chrome p-10 pt-24 md:flex">
        <h1
          key={step}
          className="step-enter max-w-xs font-mono text-3xl leading-snug font-normal tracking-tight text-foreground lg:text-4xl"
        >
          {current.poetry}
        </h1>
        <span
          aria-hidden
          className="font-heading text-2xl tracking-[-0.04em] text-foreground/15 select-none"
        >
          deskto
        </span>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-8 pt-12">
          <div className="no-drag">
            {stepIndex > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                onClick={goBack}
              >
                <ChevronLeftIcon />
              </Button>
            ) : null}
          </div>
          <StepDots index={stepIndex} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6">
          {/* Keyed by step so @starting-style replays the entrance; the CSS
              var flips the slide to match the direction of travel. my-auto
              centres a short step instead of leaving a void under it. */}
          <div
            key={step}
            className="mx-auto my-auto flex w-full max-w-xl flex-col gap-5"
            style={
              // SAFETY: CSSProperties has no index for custom properties, but
              // React passes them straight through to the style attribute.
              {
                "--step-from": direction === "back" ? "-12px" : "12px",
              } as CSSProperties
            }
          >
            <div className="step-enter flex flex-col gap-2">
              <StepHeading step={step} preConfirmed={preConfirmedProject} />
            </div>

            {actionError ? (
              <InlineError className="step-enter" message={actionError} />
            ) : null}

            <div className="step-enter [transition-delay:60ms]">
              {step === "welcome" ? <WelcomeContent /> : null}
              {step === "inbox" ? <InboxContent /> : null}
              {step === "projects" ? <ProjectsContent /> : null}
              {step === "orchestrate" ? <OrchestrateContent /> : null}
              {step === "appearance" ? (
                <AppearanceContent theme={theme} onSelectTheme={selectTheme} />
              ) : null}
              {step === "agent" ? (
                <AgentContent
                  harnesses={harnesses}
                  checking={checking}
                  onCheckAgain={() => void checkAgain()}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-8 pb-6">
          <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-1.5">
            <Button
              size="lg"
              className="w-full"
              onClick={primary.onClick}
              disabled={primary.disabled ?? false}
            >
              {primary.label}
            </Button>
            <Button variant="ghost" size="sm" onClick={onFinish}>
              {skipLabel}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

/** Heading plus one paragraph; the poetry column carries the drama. */
function StepHeading({
  step,
  preConfirmed,
}: {
  step: OnboardingStep
  preConfirmed: boolean
}) {
  if (step === "welcome") {
    return (
      <>
        <h2 className="display-sm">A task instead of a message</h2>
        <p className="text-body">
          You do not chat with Deskto. You hand it a task: a bug to fix, a
          folder to reorganize, a question about your own past work. A coding
          agent like Claude Code or Codex goes off and does it.
        </p>
      </>
    )
  }
  if (step === "inbox") {
    return (
      <>
        <h2 className="display-sm">An inbox, not a chat log</h2>
        <p className="text-body">
          Tasks run in the background and come back as things to review. The
          list stays honest the way a good mail client does:
        </p>
      </>
    )
  }
  if (step === "projects") {
    return (
      <>
        <h2 className="display-sm">Projects scope the work</h2>
        <p className="text-body">
          A project is one folder on this computer. Every task runs inside
          exactly one of them, and agents never wander outside it.
        </p>
      </>
    )
  }
  if (step === "orchestrate") {
    return (
      <>
        <h2 className="display-sm">Tasks that delegate tasks</h2>
        <p className="text-body">
          Deskto hands every running agent a private orchestration line to the
          app. It is configured per task, torn down after, and writes nothing to
          your agent configs.
        </p>
      </>
    )
  }
  if (step === "appearance") {
    return (
      <>
        <h2 className="display-sm">Make it yours</h2>
        <p className="text-body">
          Deskto follows your system, or picks a side. The whole window changes
          as you choose.
        </p>
      </>
    )
  }
  if (step === "agent") {
    return (
      <>
        <h2 className="display-sm">Connect a coding agent</h2>
        <p className="text-body">
          Deskto drives agents installed on this computer, and every task picks
          its agent, model, thinking level, and permission mode. Install one,
          sign in, and this screen notices on its own.
        </p>
      </>
    )
  }
  if (preConfirmed) {
    return (
      <>
        <h2 className="display-sm">You are all set</h2>
        <p className="text-body">
          This computer already has projects, so there is nothing left to set
          up.
        </p>
      </>
    )
  }
  return (
    <>
      <h2 className="display-sm">Create your first project</h2>
      <p className="text-body">
        Start from a template or empty. Deskto can manage the folder for you,
        and you can move it somewhere else later.
      </p>
    </>
  )
}

/** What actually happens after "Get started", in the order it happens. */
function WelcomeContent() {
  return (
    <ul className="flex flex-col gap-4 pt-1">
      <FeatureRow icon={<ClipboardListIcon />} name="Describe the outcome.">
        One task description in, finished work out: code, files, answers. Deskto
        even titles the task for you.
      </FeatureRow>
      <FeatureRow icon={<InboxIcon />} name="Walk away.">
        Tasks run in the background, in parallel, and land in an inbox when they
        need you.
      </FeatureRow>
      <FeatureRow icon={<ShieldCheckIcon />} name="Stay in control.">
        Agents ask before touching anything important. Approvals are the
        default, not an option you enable.
      </FeatureRow>
    </ul>
  )
}

function InboxContent() {
  return (
    <div className="flex flex-col gap-5">
      <InboxScene />
      <ul className="flex flex-col gap-4">
        <FeatureRow icon={<PinIcon />} name="Triage like mail.">
          Pinned, active, later, done. Snoozed tasks wake themselves up when
          their time comes.
        </FeatureRow>
        <FeatureRow icon={<ActivityIcon />} name="Live status on every row.">
          See what each agent is doing right now, not just that it is
          &ldquo;running&rdquo;.
        </FeatureRow>
        <FeatureRow icon={<HandIcon />} name="Approvals come to you.">
          When an agent wants to run something risky, the task waits in the
          inbox for your decision.
        </FeatureRow>
      </ul>
    </div>
  )
}

function ProjectsContent() {
  return (
    <div className="flex flex-col gap-5">
      <ProjectsScene />
      <ul className="flex flex-col gap-4">
        <FeatureRow icon={<FolderIcon />} name="Managed or linked.">
          Deskto can create and own the folder, or you point it at a repo you
          already have.
        </FeatureRow>
        <FeatureRow icon={<FileTextIcon />} name="Instructions and skills.">
          Each project carries shared instructions and skills that every agent
          picks up automatically.
        </FeatureRow>
        <FeatureRow icon={<LayoutTemplateIcon />} name="Templates.">
          Start from a template. Starter files and instructions are copied in
          once, then the project is yours.
        </FeatureRow>
        <FeatureRow icon={<BoxesIcon />} name="Workspaces.">
          Group projects so client work, side projects, and experiments never
          mix.
        </FeatureRow>
      </ul>
    </div>
  )
}

function OrchestrateContent() {
  return (
    <div className="flex flex-col gap-5">
      <OrchestrationScene />
      <ul className="flex flex-col gap-4">
        <FeatureRow icon={<GitBranchIcon />} name="Fan out.">
          An agent can spawn up to eight child tasks in parallel, then wait for
          the results and pull them together.
        </FeatureRow>
        <FeatureRow icon={<LayersIcon />} name="Children are real tasks.">
          They nest under their parent in the sidebar and open like any other
          task, with their own approvals and files.
        </FeatureRow>
        <FeatureRow icon={<SearchIcon />} name="Cross-task memory.">
          Agents can search the titles and messages of your earlier tasks, so
          past work informs new work.
        </FeatureRow>
      </ul>
    </div>
  )
}

/** Icon, a claim, and one honest sentence — the wizard's list vocabulary. */
function FeatureRow({
  icon,
  name,
  children,
}: {
  icon: ReactNode
  name: string
  children: ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex shrink-0 items-center text-muted-foreground [&>svg]:size-4.5 [&>svg]:stroke-[1.5]">
        {icon}
      </span>
      <span className="text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{name}</span> {children}
      </span>
    </li>
  )
}

/** Just the dots, Town-style; the eyebrow above the heading names the step. */
function StepDots({ index }: { index: number }) {
  return (
    <div
      aria-label={`Step ${index + 1} of ${steps.length}`}
      className="no-drag flex items-center gap-1.5"
    >
      {steps.map((candidate, dotIndex) => (
        <span
          key={candidate.id}
          className={cn(
            "size-1.5 rounded-full transition-colors duration-200",
            dotIndex === index
              ? "bg-foreground"
              : dotIndex < index
                ? "bg-foreground/40"
                : "bg-muted-foreground/30"
          )}
        />
      ))}
    </div>
  )
}

function AppearanceContent({
  theme,
  onSelectTheme,
}: {
  theme: ThemePreference
  onSelectTheme: (value: ThemePreference) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Theme"
        className="flex flex-wrap items-center gap-2"
      >
        {themeOptions.map((option) => {
          const checked = option.value === theme
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onSelectTheme(option.value)}
              className={cn(
                "flex h-8 items-center gap-2 rounded-button border px-4 text-sm transition-colors duration-150",
                "motion-safe:active:scale-[0.97]",
                checked
                  ? "border-foreground text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
              )}
            >
              {option.label}
              {checked ? <CheckIcon aria-hidden className="size-3.5" /> : null}
            </button>
          )
        })}
      </div>
      <ThemeCurtain theme={theme} />
    </div>
  )
}

/**
 * Two renders of the same mock window with the dark one clipped on top: the
 * choice drags a curtain across instead of crossfading two overlapping
 * panes. "System" parks the curtain halfway, which is also what it means.
 */
function ThemeCurtain({ theme }: { theme: ThemePreference }) {
  const clipPath =
    theme === "dark"
      ? "inset(0 0 0 0)"
      : theme === "light"
        ? "inset(0 0 0 100%)"
        : "inset(0 0 0 50%)"
  return (
    <ScenePanel>
      <PreviewPane className="h-full" />
      <span
        aria-hidden
        className="theme-curtain absolute inset-0"
        style={{ clipPath }}
      >
        <PreviewPane dark className="h-full" />
      </span>
    </ScenePanel>
  )
}

function AgentContent({
  harnesses,
  checking,
  onCheckAgain,
}: {
  harnesses: RuntimeQuery<Harness[]>
  checking: boolean
  onCheckAgain: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <AgentList harnesses={harnesses} />
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCheckAgain}
          disabled={checking || harnesses.state.status !== "ready"}
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={cn(checking && "animate-spin")}
          />
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>
    </div>
  )
}

function AgentList({ harnesses }: { harnesses: RuntimeQuery<Harness[]> }) {
  if (
    harnesses.state.status === "loading" ||
    harnesses.state.status === "idle"
  ) {
    return <StatusPanel title="Checking which agents are installed…" />
  }
  if (harnesses.state.status === "error") {
    return (
      <StatusPanel
        title="Deskto cannot read the list of agents"
        description={harnesses.state.message}
        tone="danger"
      >
        <Button variant="outline" onClick={harnesses.revalidate}>
          Try again
        </Button>
      </StatusPanel>
    )
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {harnesses.state.data.map((harness) => (
        <AgentCard key={harness.id} harness={harness} />
      ))}
    </ul>
  )
}

function AgentCard({ harness }: { harness: Harness }) {
  const ready = isHarnessAvailable(harness)
  const health = describeHarnessHealth(harness)
  const setup = harnessSetup.get(harness.id)

  // The halo plays only when readiness arrives while the card is on screen —
  // the one moment worth celebrating. Cards that mount already ready stay
  // quiet.
  const wasReady = useRef(ready)
  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    if (ready && !wasReady.current) setCelebrate(true)
    wasReady.current = ready
  }, [ready])

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <HarnessLogo harnessId={harness.id} className="size-5 shrink-0" />
        <span className="text-sm font-medium">{harness.name}</span>
        <span className="relative ml-auto flex size-1.5">
          {celebrate ? (
            <span
              aria-hidden
              className={cn(
                "absolute inset-0 rounded-full bg-foreground",
                "motion-safe:animate-[status-ping_600ms_var(--ease-out-quart)_both]"
              )}
            />
          ) : null}
          <span
            className={cn(
              "relative size-1.5 rounded-full transition-colors duration-200",
              health.dotClassName
            )}
          />
        </span>
      </div>
      {/* Keyed so the setup block and the ready line trade places with a
          fade instead of teleporting when the probe flips. */}
      <div
        key={ready ? "ready" : "setup"}
        className="enter-rise flex flex-col gap-3"
      >
        <p className="text-xs leading-snug text-muted-foreground">
          {health.detail}
        </p>
        {!ready && setup ? (
          <div className="flex flex-col gap-2">
            <CopyField command={setup.install} />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs leading-snug text-muted-foreground">
                {setup.signInHint}
              </p>
              <Button
                variant="link"
                size="xs"
                onClick={() => openExternal(setup.docsUrl)}
              >
                Docs
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}

function CopyField({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    []
  )

  function copy() {
    setCopyFailed(false)
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true)
        if (resetTimer.current) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        // The command stays selectable in the field, so the way out is to
        // copy it by hand rather than to retry the same clipboard call.
        setCopyFailed(true)
      })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">
          {command}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? "Copied" : "Copy install command"}
          onClick={copy}
          className="relative shrink-0"
        >
        {/* Both glyphs stay mounted so the swap is a transition, not a
            remount: rapid clicks retarget instead of restarting. */}
        <CopyIcon
          aria-hidden
          className={cn(
            "absolute size-3.5 transition-[opacity,transform] duration-150 ease-[var(--ease-out-quart)]",
            copied ? "scale-90 opacity-0" : "scale-100 opacity-100"
          )}
        />
        <CheckIcon
          aria-hidden
          className={cn(
            "absolute size-3.5 transition-[opacity,transform] duration-150 ease-[var(--ease-out-quart)]",
            copied ? "scale-100 opacity-100" : "scale-90 opacity-0"
          )}
        />
        </Button>
      </div>
      {copyFailed ? (
        <p role="alert" className="text-xs leading-snug text-muted-foreground">
          Deskto couldn&rsquo;t reach the clipboard. Select the command above and
          copy it yourself.
        </p>
      ) : null}
    </div>
  )
}
