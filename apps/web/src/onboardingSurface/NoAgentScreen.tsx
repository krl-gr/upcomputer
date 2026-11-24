import { ProviderDriverKind } from "@t3tools/contracts";
import type { ProviderIcon } from "@t3tools/provider-core/client";
import { T, useGT } from "gt-react";
import { CheckIcon, ChevronRightIcon, CircleAlertIcon, CopyIcon, PlugIcon } from "lucide-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { AntigravityIcon, ClaudeAI, OpenAI } from "../components/Icons";
import { ProviderPackageIcon } from "../components/chat/ProviderPackageIcon";
import hermesLogo from "../components/mcp/logos/hermes.png";
import { providerClients } from "../components/settings/providerDriverMeta";
import { RefreshIcon } from "../components/ui/refresh-icon";
import { Spinner } from "../components/ui/spinner";
import { isElectron } from "../env";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";
import { NO_AGENT_SETUP_PROMPT } from "./noAgentSetupPrompt";

const OPENCODE_URL = "https://opencode.ai";
const COPIED_NOTE_MS = 4_000;

const openCodeIcon = providerClients.get(ProviderDriverKind.make("opencode"))?.icon;
const grokIcon = providerClients.get(ProviderDriverKind.make("grok"))?.icon;

/** The filled card is dark in the light theme and light in the dark one, so its mark swaps too. */
function invertedIcon(icon: ProviderIcon): ProviderIcon {
  return {
    ...icon,
    fill: { light: icon.fill.dark, dark: icon.fill.light },
    paths: icon.paths.map((path) =>
      path.fill ? { ...path, fill: { light: path.fill.dark, dark: path.fill.light } } : path,
    ),
  };
}
const openCodeIconOnFill = openCodeIcon ? invertedIcon(openCodeIcon) : undefined;

export type NoAgentScreenView =
  | { readonly kind: "offer" }
  | {
      readonly kind: "installing";
      /** 0 to 1 while the download reports bytes, null before and after it. */
      readonly progress: number | null;
      /** Installed, and still starting: the same wording the composer uses. */
      readonly slow: boolean;
    }
  | { readonly kind: "failed"; readonly message: string };

/**
 * A new user's first screen when no coding agent is on the Mac: three ways to
 * get one, and nothing installs before they pick. Presentational: the caller
 * owns the install and its events.
 */
export function NoAgentScreen({
  view,
  retrying = false,
  copied: copiedOverride,
  onInstall,
  onRetry,
  onSetUpMyself,
  onCopyPrompt,
  onOpenCodeLinkClick,
}: {
  readonly view: NoAgentScreenView;
  readonly retrying?: boolean;
  /** Forces the copied note, for state sheets. */
  readonly copied?: boolean;
  readonly onInstall: () => void;
  readonly onRetry: () => void;
  readonly onSetUpMyself: () => void;
  readonly onCopyPrompt?: () => void;
  readonly onOpenCodeLinkClick?: () => void;
}) {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    timeout: COPIED_NOTE_MS,
    onCopy: onCopyPrompt,
  });
  const copied = copiedOverride ?? isCopied;
  const installing = view.kind === "installing";
  const failed = view.kind === "failed";

  return (
    <main
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      data-no-agent-screen={view.kind}
    >
      {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
      {isElectron ? (
        <div className="drag-region h-(--workspace-topbar-height) shrink-0" aria-hidden />
      ) : null}
      <div className="flex min-h-0 flex-1 items-center-safe justify-center overflow-y-auto scrollbar-gutter-both px-4 py-8 [@media(max-height:34rem)]:py-3 sm:px-6">
        <section className="w-full max-w-lg" aria-labelledby="no-agent-screen-title">
          {/* A short window drops the picture so the three cards stay in view. */}
          <div className="mb-8 [@media(max-height:42rem)]:hidden">
            <AgentIconStack />
          </div>

          <h1
            id="no-agent-screen-title"
            className="text-2xl font-semibold tracking-tight text-foreground [@media(max-height:34rem)]:text-xl"
          >
            {gt("Let's get you an agent")}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground [@media(max-height:34rem)]:mt-1.5 [@media(max-height:34rem)]:text-sm [@media(max-height:34rem)]:leading-snug">
            {gt(
              "We didn't find Claude Code, Codex or another coding agent on this Mac. Up.computer works with the agents you already have.",
            )}
          </p>

          {/* Equal rows: the cards keep one shape, and a state change never moves the block. */}
          <div className="mt-7 grid auto-rows-fr gap-2.5 [@media(max-height:34rem)]:mt-3 [@media(max-height:34rem)]:gap-2">
            <OptionCard
              filled
              action={failed ? "retry" : "install"}
              track={failed ? "onboarding.no_agent.retry" : "onboarding.no_agent.install"}
              disabled={installing || retrying}
              onClick={failed ? onRetry : onInstall}
              icon={
                openCodeIconOnFill ? (
                  <ProviderPackageIcon icon={openCodeIconOnFill} className="h-5 w-auto" />
                ) : null
              }
              title={gt("Install a free agent")}
              trailing={
                installing ? (
                  <Spinner size="md" />
                ) : failed ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <RefreshIcon size="sm" refreshing={retrying} />
                    {retrying ? gt("Retrying…") : gt("Retry")}
                  </span>
                ) : undefined
              }
              description={
                installing ? (
                  <InstallProgress progress={view.progress} slow={view.slow} />
                ) : failed ? (
                  <span role="alert">
                    <CircleAlertIcon
                      className="mr-1.5 inline-block size-4 align-text-bottom text-destructive"
                      aria-hidden
                    />
                    <span className="text-background">{view.message}</span>
                  </span>
                ) : (
                  <T>
                    <a
                      className="relative z-10 font-medium text-background underline decoration-current/40 underline-offset-2 hover:decoration-current"
                      href={OPENCODE_URL}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={onOpenCodeLinkClick}
                      data-no-agent-action="opencode-link"
                      data-track="onboarding.no_agent.opencode_link"
                    >
                      OpenCode
                    </a>{" "}
                    with free models that don't keep your data. It will help you set up the rest.
                  </T>
                )
              }
            />
            <OptionCard
              action="copy-prompt"
              track="onboarding.no_agent.copy_prompt"
              onClick={() => copyToClipboard(NO_AGENT_SETUP_PROMPT, undefined)}
              icon={
                copied ? (
                  <CheckIcon className="size-5 text-success-foreground" />
                ) : (
                  <CopyIcon className="size-4.5" />
                )
              }
              title={gt("Ask your own agent")}
              description={
                copied ? (
                  <span role="status">{gt("Copied. Paste it into your agent.")}</span>
                ) : (
                  gt("Copy a setup prompt for Claude, ChatGPT or any agent you already use.")
                )
              }
            />
            <OptionCard
              action="setup-myself"
              track="onboarding.no_agent.setup_myself"
              onClick={onSetUpMyself}
              icon={<PlugIcon className="size-4.5" />}
              title={gt("Set up myself")}
              description={gt("Install or connect Claude Code, Codex, Antigravity and more.")}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

/*
 * One choice. The whole card is the click target: a button stretched over it,
 * so a link in the description can sit above the button without nesting in it.
 */
function OptionCard({
  filled = false,
  action,
  track,
  disabled = false,
  onClick,
  icon,
  title,
  description,
  trailing,
}: {
  readonly filled?: boolean;
  readonly action: string;
  readonly track: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: ReactNode;
  readonly trailing?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3.5 rounded-xl border px-4 py-3.5 [@media(max-height:34rem)]:gap-3 [@media(max-height:34rem)]:px-3 [@media(max-height:34rem)]:py-2",
        filled
          ? "border-foreground bg-foreground text-background shadow-sm has-[button:enabled:hover]:bg-foreground/90"
          : "border-border text-foreground has-[button:enabled:hover]:border-foreground/25 has-[button:enabled:hover]:bg-accent/60",
      )}
      data-no-agent-card={action}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={onClick}
        data-no-agent-action={action}
        data-track={track}
      />
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center",
          filled ? "" : "text-muted-foreground",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          id={titleId}
          className="block text-base leading-snug font-medium [@media(max-height:34rem)]:text-sm"
        >
          {title}
        </span>
        <span
          id={descriptionId}
          className={cn(
            "mt-0.5 block text-sm leading-snug [@media(max-height:34rem)]:mt-0 [@media(max-height:34rem)]:text-xs",
            filled ? "text-background/70" : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      </span>
      <span className={cn("flex shrink-0 items-center", filled ? "" : "text-muted-foreground")}>
        {trailing ?? (
          <ChevronRightIcon
            className="size-4.5 opacity-70 transition-transform group-has-[button:enabled:hover]:translate-x-0.5"
            aria-hidden
          />
        )}
      </span>
    </div>
  );
}

/** Inside the filled card, so the bar and text take the card's own colors. */
function InstallProgress({
  progress,
  slow,
}: {
  readonly progress: number | null;
  readonly slow: boolean;
}) {
  const gt = useGT();
  // The bar never runs backward: once the download is done it stays full while the agent starts.
  const reported = progress ?? 0;
  const [filled, setFilled] = useState(reported);
  if (reported > filled) setFilled(reported);
  if (slow) {
    return (
      <span role="status" data-no-agent-progress>
        <span className="text-background">{gt("Still starting your agent…")}</span>{" "}
        {gt("The first start can take a minute or two.")}
      </span>
    );
  }
  return (
    <span className="block pt-1.5" role="status" data-no-agent-progress>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-background/20">
        <span
          className="block h-full rounded-full bg-background transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(filled * 100)}%` }}
        />
      </span>
      <span className="mt-2 block text-background/80">
        {progress === null
          ? gt("Setting up your agent…")
          : gt("Setting up your agent… {percent}%", { percent: Math.round(progress * 100) })}
      </span>
    </span>
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
      className="flex h-[4.5rem] items-center pl-1"
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
