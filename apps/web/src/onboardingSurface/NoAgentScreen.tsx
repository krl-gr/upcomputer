import { ProviderDriverKind } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { CheckIcon, CircleAlertIcon, CopyIcon, XIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { AntigravityIcon, ClaudeAI, OpenAI } from "../components/Icons";
import { ProviderPackageIcon } from "../components/chat/ProviderPackageIcon";
import hermesLogo from "../components/mcp/logos/hermes.png";
import { providerClients } from "../components/settings/providerDriverMeta";
import { Button, InlineButton } from "../components/ui/button";
import { RefreshIcon } from "../components/ui/refresh-icon";
import { Spinner } from "../components/ui/spinner";
import { isElectron } from "../env";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { NO_AGENT_SETUP_PROMPT } from "./noAgentSetupPrompt";

const BODY_CLASS =
  "mt-3 text-base leading-relaxed text-muted-foreground [@media(max-height:33rem)]:mt-2 [@media(max-height:33rem)]:text-sm [@media(max-height:33rem)]:leading-normal";
const OPENCODE_URL = "https://opencode.ai";
const COPIED_NOTE_MS = 4_000;

const openCodeIcon = providerClients.get(ProviderDriverKind.make("opencode"))?.icon;
const grokIcon = providerClients.get(ProviderDriverKind.make("grok"))?.icon;

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
 * A new user's first screen when no coding agent is on the Mac: it asks before
 * OpenCode is installed. Presentational: the caller owns the install and its events.
 */
export function NoAgentScreen({
  view,
  retrying = false,
  copied: copiedOverride,
  onInstall,
  onRetry,
  onClose,
  onCopyPrompt,
  onOpenCodeLinkClick,
}: {
  readonly view: NoAgentScreenView;
  readonly retrying?: boolean;
  /** Forces the copied note, for state sheets. */
  readonly copied?: boolean;
  readonly onInstall: () => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
  readonly onCopyPrompt?: () => void;
  readonly onOpenCodeLinkClick?: () => void;
}) {
  const gt = useGT();
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    timeout: COPIED_NOTE_MS,
    onCopy: onCopyPrompt,
  });
  const copied = copiedOverride ?? isCopied;

  const copyPrompt = (
    <InlineButton
      onClick={() => copyToClipboard(NO_AGENT_SETUP_PROMPT, undefined)}
      data-no-agent-action="copy-prompt"
      data-track="onboarding.no_agent.copy_prompt"
    >
      {copied ? (
        <>
          <CheckIcon className="mr-1 size-3.5 text-success-foreground" />
          {gt("Copied. Paste it into your agent.")}
        </>
      ) : (
        <>
          <CopyIcon className="mr-1 size-3.5 text-muted-foreground" />
          {gt("Copy a setup prompt for your own agent")}
        </>
      )}
    </InlineButton>
  );

  return (
    <main
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      data-no-agent-screen={view.kind}
    >
      {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
      {isElectron ? (
        <div className="drag-region h-(--workspace-topbar-height) shrink-0" aria-hidden />
      ) : null}
      <div className="flex min-h-0 flex-1 items-center-safe justify-center overflow-y-auto scrollbar-gutter-both px-4 py-8 [@media(max-height:33rem)]:py-4 sm:px-6">
        <section className="relative w-full max-w-lg" aria-labelledby="no-agent-screen-title">
          <div className="absolute -top-1 -right-1.5">
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={gt("Close")}
              onClick={onClose}
              data-no-agent-action="close"
              data-track="onboarding.no_agent.close"
            >
              <XIcon />
            </Button>
          </div>
          {/* A short window drops the picture so the buttons stay in view. */}
          <div className="mb-8 [@media(max-height:33rem)]:hidden">
            <AgentIconStack />
          </div>

          <h1
            id="no-agent-screen-title"
            className="text-2xl font-semibold tracking-tight text-foreground [@media(max-height:33rem)]:pr-10 [@media(max-height:33rem)]:text-xl"
          >
            {gt("Let's get you an agent")}
          </h1>
          <p className={BODY_CLASS}>
            {gt(
              "We didn't find Claude Code, Codex or another coding agent on this Mac. Up.computer works with the agents you already have.",
            )}
          </p>
          <p className={BODY_CLASS}>
            <T>
              To save you from digging through settings, we can install{" "}
              <a
                className="font-medium whitespace-nowrap text-foreground underline decoration-current/30 underline-offset-2 hover:decoration-current"
                href={OPENCODE_URL}
                target="_blank"
                rel="noreferrer noopener"
                onClick={onOpenCodeLinkClick}
                data-no-agent-action="opencode-link"
                data-track="onboarding.no_agent.opencode_link"
              >
                {openCodeIcon ? (
                  <ProviderPackageIcon
                    icon={openCodeIcon}
                    className="mr-1 inline-block h-[0.95em] w-auto align-[-0.1em]"
                    aria-hidden
                  />
                ) : null}
                OpenCode
              </a>
              , a free agent whose models don't keep your data. It will help you set up the rest:
              install Claude Code or Codex, or connect the one you use.
            </T>
          </p>

          {/* Tall enough for every state, so the centered block holds still between them. */}
          <div className="mt-7 min-h-24 text-sm [@media(max-height:33rem)]:mt-5 [@media(max-height:33rem)]:min-h-9">
            {view.kind === "installing" ? (
              <InstallProgress progress={view.progress} slow={view.slow} />
            ) : (
              <>
                {view.kind === "failed" ? (
                  <p
                    className="mb-4 flex items-start gap-2 text-sm leading-snug text-destructive"
                    role="alert"
                  >
                    <CircleAlertIcon className="mt-px size-4 shrink-0" aria-hidden />
                    <span>{view.message}</span>
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  {view.kind === "failed" ? (
                    <Button
                      size="lg"
                      onClick={onRetry}
                      disabled={retrying}
                      data-no-agent-action="retry"
                      data-track="onboarding.no_agent.retry"
                    >
                      <RefreshIcon refreshing={retrying} />
                      {retrying ? gt("Retrying…") : gt("Retry")}
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={onInstall}
                      data-no-agent-action="install"
                      data-track="onboarding.no_agent.install"
                    >
                      {gt("Install free agent")}
                    </Button>
                  )}
                  {copyPrompt}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function InstallProgress({
  progress,
  slow,
}: {
  readonly progress: number | null;
  readonly slow: boolean;
}) {
  const gt = useGT();
  // The bar never runs backward: once the download is done it stays full while the agent starts.
  const reported = slow ? 1 : (progress ?? 0);
  const [filled, setFilled] = useState(reported);
  if (reported > filled) setFilled(reported);
  return (
    <div role="status" data-no-agent-progress>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/8">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(filled * 100)}%` }}
        />
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-foreground">
        <Spinner size="sm" tone="muted" />
        {slow
          ? gt("Still starting your agent…")
          : progress === null
            ? gt("Setting up your agent…")
            : gt("Setting up your agent… {percent}%", { percent: Math.round(progress * 100) })}
      </p>
      {slow ? (
        <p className="mt-1 pl-5.5 text-xs text-muted-foreground">
          {gt("The first start can take a minute or two.")}
        </p>
      ) : null}
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
