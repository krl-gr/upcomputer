import { ProviderDriverKind } from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react";
import { CheckIcon, ChevronRightIcon, CopyIcon, PlugIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { AntigravityIcon, ClaudeAI, OpenAI } from "../components/Icons";
import { ProviderPackageIcon } from "../components/chat/ProviderPackageIcon";
import hermesLogo from "../components/mcp/logos/hermes.png";
import { providerClients } from "../components/settings/providerDriverMeta";
import { InlineButton } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { isElectron } from "../env";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { NO_AGENT_COPY } from "./noAgentScreenCopy";
import type { NoAgentScreenPlace, NoAgentScreenView } from "./upComputerOnboarding.logic";
import { NO_AGENT_SETUP_PROMPT } from "./noAgentSetupPrompt";

const COPIED_NOTE_MS = 4_000;

const openCodeIcon = providerClients.get(ProviderDriverKind.make("opencode"))?.icon;
const grokIcon = providerClients.get(ProviderDriverKind.make("grok"))?.icon;

/**
 * A new user's first screen when no coding agent is on the Mac: three ways to
 * get one, and nothing installs before they pick. Installing and a failure
 * each replace the cards. Presentational: the caller owns the install and its events.
 */
export function NoAgentScreen({
  view,
  place,
  copied: copiedOverride,
  onInstall,
  onTryAgain,
  onSetUpAnotherWay,
  onSetUpMyself,
  onCopyPrompt,
}: {
  readonly view: NoAgentScreenView;
  readonly place: NoAgentScreenPlace;
  /** Forces the copied note, for state sheets. */
  readonly copied?: boolean;
  readonly onInstall: () => void;
  readonly onTryAgain: () => void;
  readonly onSetUpAnotherWay: () => void;
  readonly onSetUpMyself: () => void;
  readonly onCopyPrompt: () => void;
}) {
  const m = useMessages();
  const offer = view.kind === "offer";
  const title =
    view.kind === "offer"
      ? NO_AGENT_COPY.offer.title
      : view.kind === "installing"
        ? NO_AGENT_COPY.installing[view.phase].title
        : NO_AGENT_COPY.failed[view.reason].title;

  return (
    <main
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      data-no-agent-screen={view.kind}
    >
      {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
      {isElectron ? (
        <div className="drag-region h-(--workspace-topbar-height) shrink-0" aria-hidden />
      ) : null}
      <div className="flex min-h-0 flex-1 items-center-safe justify-center overflow-y-auto scrollbar-gutter-both px-4 py-8 [@media(max-height:34rem)]:py-2 sm:px-6">
        <section className="w-full max-w-lg text-center" aria-labelledby="no-agent-screen-title">
          {/* A short window drops the picture so the three cards stay in view. */}
          <div className={cn("mb-8", offer && "[@media(max-height:42rem)]:hidden")}>
            <AgentIconStack />
          </div>

          <h1
            id="no-agent-screen-title"
            className="text-2xl font-semibold tracking-tight text-foreground [@media(max-height:34rem)]:text-xl"
          >
            {m(title)}
          </h1>
          {view.kind === "offer" ? (
            <Offer
              place={place}
              copied={copiedOverride}
              onInstall={onInstall}
              onSetUpMyself={onSetUpMyself}
              onCopyPrompt={onCopyPrompt}
            />
          ) : view.kind === "installing" ? (
            <Installing
              phase={view.phase}
              progress={view.progress}
              onSetUpAnotherWay={onSetUpAnotherWay}
            />
          ) : (
            <Failed
              reason={view.reason}
              onTryAgain={onTryAgain}
              onSetUpAnotherWay={onSetUpAnotherWay}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function Offer({
  place,
  copied: copiedOverride,
  onInstall,
  onSetUpMyself,
  onCopyPrompt,
}: {
  readonly place: NoAgentScreenPlace;
  readonly copied: boolean | undefined;
  readonly onInstall: () => void;
  readonly onSetUpMyself: () => void;
  readonly onCopyPrompt: () => void;
}) {
  const m = useMessages();
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    timeout: COPIED_NOTE_MS,
    onCopy: onCopyPrompt,
  });
  const copied = copiedOverride ?? isCopied;
  const copy = NO_AGENT_COPY.offer;
  return (
    <>
      {/* The smallest window drops the intro, so all three cards fit at a readable size. */}
      <p className="mt-3 text-base leading-relaxed text-muted-foreground [@media(max-height:28rem)]:hidden [@media(max-height:34rem)]:mt-1.5 [@media(max-height:34rem)]:text-sm [@media(max-height:34rem)]:leading-snug">
        {m(place.kind === "remote" ? copy.intro.remote(place.name) : copy.intro[place.kind])}
      </p>

      {/* Equal rows: the cards keep one shape, and a state change never moves the block. */}
      <div className="mt-7 grid auto-rows-fr gap-2.5 text-left [@media(max-height:34rem)]:mt-3 [@media(max-height:34rem)]:gap-2">
        <OptionCard
          action="install"
          track="onboarding.no_agent.install"
          onClick={onInstall}
          icon={
            openCodeIcon ? <ProviderPackageIcon icon={openCodeIcon} className="h-5 w-auto" /> : null
          }
          title={m(copy.installTitle)}
          tag={m(copy.installTag)}
          description={m(copy.installDescription)}
        />
        <OptionCard
          action="copy-prompt"
          track="onboarding.no_agent.copy_prompt"
          onClick={() => copyToClipboard(NO_AGENT_SETUP_PROMPT, undefined)}
          icon={
            copied ? (
              <CheckIcon className="size-5 text-success-foreground" />
            ) : (
              <CopyIcon className="size-4.5 text-muted-foreground" />
            )
          }
          title={m(copy.askTitle)}
          description={
            copied ? <span role="status">{m(copy.askCopied)}</span> : m(copy.askDescription)
          }
        />
        <OptionCard
          action="setup-myself"
          track="onboarding.no_agent.setup_myself"
          onClick={onSetUpMyself}
          icon={<PlugIcon className="size-4.5 text-muted-foreground" />}
          title={m(copy.setupTitle)}
          description={m(copy.setupDescription)}
        />
      </div>
    </>
  );
}

/** One choice: the whole card is the button. */
function OptionCard({
  action,
  track,
  onClick,
  icon,
  title,
  tag,
  description,
}: {
  readonly action: string;
  readonly track: string;
  readonly onClick: () => void;
  readonly icon: ReactNode;
  readonly title: string;
  readonly tag?: string;
  readonly description: ReactNode;
}) {
  return (
    <button
      type="button"
      className="group flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-border px-4 py-3.5 text-left text-foreground outline-none hover:border-foreground/25 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [@media(max-height:34rem)]:gap-3 [@media(max-height:34rem)]:px-3 [@media(max-height:34rem)]:py-2"
      onClick={onClick}
      data-no-agent-action={action}
      data-track={track}
    >
      <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base leading-snug [@media(max-height:34rem)]:text-sm">
          <span className="font-medium">{title}</span>
          {tag ? <span className="ml-2 text-muted-foreground">{tag}</span> : null}
        </span>
        {/* The smallest text on the screen: nothing here goes under it. */}
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground [@media(max-height:34rem)]:mt-0">
          {description}
        </span>
      </span>
      <ChevronRightIcon
        className="size-4.5 shrink-0 text-muted-foreground opacity-70 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

function Installing({
  phase,
  progress,
  onSetUpAnotherWay,
}: {
  readonly phase: "downloading" | "starting" | "slow" | "retrying";
  readonly progress: number | null;
  readonly onSetUpAnotherWay: () => void;
}) {
  const m = useMessages();
  // Full once installed. The bar never runs backward within one attempt.
  const reported =
    phase === "starting" || phase === "slow" ? 1 : phase === "retrying" ? 0 : (progress ?? 0);
  const [filled, setFilled] = useState(reported);
  if (reported > filled) setFilled(reported);
  const copy = NO_AGENT_COPY.installing;
  return (
    <>
      <div className="mx-auto mt-7 w-full max-w-xs" role="status" data-no-agent-progress={phase}>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
            style={{ width: `${Math.round(filled * 100)}%` }}
          />
        </div>
        <p className="mt-3.5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {/* The bar holds still outside the download, so the spinner shows the work goes on. */}
          {phase === "downloading" ? null : <Spinner size="sm" />}
          {phase === "downloading"
            ? m(copy.downloading.line(Math.round((progress ?? 0) * 100)))
            : m(copy[phase].line)}
        </p>
      </div>
      <div className="mt-6 text-sm">
        <SetUpAnotherWay onClick={onSetUpAnotherWay} />
      </div>
    </>
  );
}

/** The quiet way back to the three cards, from the installing and failure screens. */
function SetUpAnotherWay({ onClick }: { readonly onClick: () => void }) {
  const m = useMessages();
  return (
    <InlineButton
      tone="muted"
      onClick={onClick}
      data-no-agent-action="setup-another-way"
      data-track="onboarding.no_agent.setup_another_way"
    >
      {m(NO_AGENT_COPY.setUpAnotherWay)}
    </InlineButton>
  );
}

function Failed({
  reason,
  onTryAgain,
  onSetUpAnotherWay,
}: {
  readonly reason: "install" | "timeout" | "models";
  readonly onTryAgain: () => void;
  readonly onSetUpAnotherWay: () => void;
}) {
  const m = useMessages();
  return (
    <div data-no-agent-failed={reason}>
      <p
        className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-muted-foreground"
        role="alert"
      >
        {m(NO_AGENT_COPY.failed[reason].line)}
      </p>
      <div className="mt-7 flex flex-col items-center gap-4 text-sm">
        {/* The bar's own dark tone, which no shared Button variant has. */}
        <button
          type="button"
          className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background shadow-sm outline-none hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.98]"
          onClick={onTryAgain}
          data-no-agent-action="try-again"
          data-track="onboarding.no_agent.try_again"
        >
          {m(NO_AGENT_COPY.tryAgain)}
        </button>
        <SetUpAnotherWay onClick={onSetUpAnotherWay} />
      </div>
    </div>
  );
}

/*
 * The agents Up.computer works with, as a loose stack of app tiles: each tile
 * leans a little and overlaps the next, so it reads as one picture, not a row
 * of icons. Static: nothing here repaints.
 */
const TILES: ReadonlyArray<{
  readonly name: string;
  readonly rotate: number;
  readonly lift: number;
  readonly mark: ReactNode;
}> = [
  { name: "Claude Code", rotate: -9, lift: 5, mark: <ClaudeAI className="size-7" /> },
  {
    name: "Codex",
    rotate: 5,
    lift: -4,
    mark: <OpenAI className="size-[29px] text-black dark:text-white" />,
  },
  { name: "Antigravity", rotate: -4, lift: 3, mark: <AntigravityIcon className="size-8" /> },
  {
    name: "Grok",
    rotate: 7,
    lift: -5,
    mark: grokIcon ? <ProviderPackageIcon icon={grokIcon} className="size-[29px]" /> : null,
  },
  {
    name: "OpenCode",
    rotate: -6,
    lift: 2,
    mark: openCodeIcon ? <ProviderPackageIcon icon={openCodeIcon} className="h-7 w-auto" /> : null,
  },
  {
    name: "Hermes",
    rotate: 8,
    lift: -3,
    mark: <img src={hermesLogo} alt="" className="size-full rounded-[inherit] object-cover" />,
  },
];

function AgentIconStack() {
  const gt = useGT();
  return (
    <div
      className="flex h-[4.5rem] items-center justify-center"
      role="img"
      aria-label={gt("Claude Code, Codex, Antigravity, Grok, OpenCode and Hermes")}
    >
      {TILES.map((tile, index) => (
        <span
          key={tile.name}
          className="flex size-14 shrink-0 rotate-(--tile-rotate) translate-y-(--tile-lift) items-center justify-center rounded-2xl border border-black/8 bg-white shadow-lg shadow-black/8 not-first:-ml-2.5 dark:border-white/10 dark:bg-secondary dark:shadow-black/40"
          style={
            {
              "--tile-rotate": `${tile.rotate}deg`,
              "--tile-lift": `${tile.lift}px`,
              zIndex: index,
            } as CSSProperties
          }
        >
          {tile.mark}
        </span>
      ))}
    </div>
  );
}
