import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { LockIcon, LockOpenIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useState } from "react";

import { CompactComposerControlsMenu } from "../components/chat/CompactComposerControlsMenu";
import {
  ComposerControl,
  ComposerControlIcon,
  ComposerSelectControl,
} from "../components/chat/ComposerControl";
import { useComposerMenuProps } from "../components/chat/composerEventScope";
import { renderProviderTraitsPicker } from "../components/chat/composerProviderState";
import type { runtimeModeConfig } from "../components/chat/runtimeModeConfig";
import { useComposerMenuState } from "../components/chat/useComposerMenuState";
import { resolveRestingComposerControlsLayout } from "../components/composerFooterLayout";
import { Select, SelectItem, SelectPopup } from "../components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { measureComposerFooterControls } from "./composerFooterMeasurement";

type RuntimeModeOption = { readonly mode: RuntimeMode } & (typeof runtimeModeConfig)[RuntimeMode];

export interface UpComputerComposerFooterProps {
  /** Upstream's attach action (its hidden file input and paperclip), or null. */
  attachAction: ReactNode;
  /** Upstream's model picker, labelled "Provider · Model" through `composerModelPickerSurfaceProps`. */
  modelPicker: ReactNode;
  /** Upstream's "Open provider settings" control, shown instead of the controls when set. */
  providerUnavailableControl: ReactNode;
  /** Upstream's effort and context window picker input; the picker renders only what the model has. */
  traitsPickerInput: Parameters<typeof renderProviderTraitsPicker>[0];
  traitsMenuContent: ReactNode;
  showInteractionModeToggle: boolean;
  interactionMode: ProviderInteractionMode;
  onToggleInteractionMode: () => void;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  /** Upstream's context ring and send, stop and queue actions. */
  primaryActions: ReactNode;
  className?: string | undefined;
}

// V1's quiet text controls: regular weight, muted, no fill and no chevrons.
const QUIET_CONTROLS_CLASS =
  "[&_[data-composer-control-chevron]]:hidden [&_button]:font-normal [&_button]:text-muted-foreground [&_button:hover]:bg-transparent [&_button:hover]:text-foreground [&_button[data-pressed]]:bg-transparent [&_button[data-pressed]]:text-foreground [&_button[aria-expanded=true]]:text-foreground [&_button[aria-pressed=true]]:bg-transparent [&_[data-chat-provider-model-picker]]:ms-0";

const ICON_ONLY_BLOCK_CLASS =
  "[&_[data-composer-control-label]]:pointer-events-none [&_[data-composer-control-label]]:invisible [&_[data-composer-control-label]]:absolute [&_[data-composer-control-label]]:w-max [&_[data-composer-control-label]]:max-w-none [&_[data-composer-control-compact-icon]]:[visibility:inherit] [&_[data-composer-control-compact-icon]]:relative";

function FooterSeparator() {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-foreground/35 dark:bg-border" />;
}

/**
 * Fit the controls into their row: measure natural widths, then drop trailing
 * labels and move trailing blocks into the overflow menu, as V1's footer did.
 */
function useComposerFooterControlsLayout() {
  const [row, setRow] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState({ hiddenCount: 0, iconOnlyCount: 0 });

  const measure = useCallback(() => {
    if (!row) return;
    const measurement = measureComposerFooterControls(row);
    setLayout((current) => {
      const next = resolveRestingComposerControlsLayout({
        ...measurement,
        hostWidth: row.clientWidth,
        previous: { ...current, visible: true },
      });
      const iconOnlyCount = next.iconOnlyCount ?? 0;
      return next.hiddenCount === current.hiddenCount && iconOnlyCount === current.iconOnlyCount
        ? current
        : { hiddenCount: next.hiddenCount, iconOnlyCount };
    });
  }, [row]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const observeControls = () => {
      observer.disconnect();
      observer.observe(row);
      row
        .querySelectorAll<HTMLElement>(
          "[data-composer-footer-block], [data-composer-control-label], [data-chat-provider-model-picker-label]",
        )
        .forEach((element) => observer.observe(element));
      measure();
    };
    observeControls();
    const mutations = new MutationObserver(observeControls);
    mutations.observe(row, { childList: true, subtree: true, characterData: true });
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [row, measure]);

  return { attachRow: setRow, ...layout };
}

/** "Build" or "Plan"; a click toggles upstream's interaction mode. */
function InteractionModeControl(props: {
  interactionMode: ProviderInteractionMode;
  onToggle: () => void;
}) {
  const plan = props.interactionMode === "plan";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            type="button"
            className="shrink-0"
            aria-pressed={plan}
            data-composer-footer-mode={props.interactionMode}
            onClick={props.onToggle}
          />
        }
      >
        {plan ? "Plan" : "Build"}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {plan ? "Plan mode: click to return to Build" : "Build mode: click to plan first"}
      </TooltipPopup>
    </Tooltip>
  );
}

/** A lock, open for full access; the label is in its tooltip, the menu is upstream's access list. */
function AccessControl(props: {
  runtimeMode: RuntimeMode;
  options: ReadonlyArray<RuntimeModeOption>;
  hidden: boolean;
  onChange: (mode: RuntimeMode) => void;
}) {
  const floatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const option = props.options.find((candidate) => candidate.mode === props.runtimeMode);
  const label = option?.label ?? props.runtimeMode;
  const Icon = props.runtimeMode === "full-access" ? LockOpenIcon : LockIcon;
  return (
    <Tooltip>
      <Select
        open={open}
        onOpenChange={setOpen}
        value={props.runtimeMode}
        onValueChange={(value) => {
          if (value) props.onChange(value);
        }}
      >
        <TooltipTrigger
          render={
            <ComposerSelectControl
              data-composer-shortcut="composer.mode"
              data-composer-footer-access={props.runtimeMode}
              aria-label={`Access: ${label}`}
            />
          }
        >
          <ComposerControlIcon icon={Icon} />
        </TooltipTrigger>
        <SelectPopup alignItemWithTrigger={false} {...floatingLayerProps}>
          {props.options.map((candidate) => {
            const OptionIcon = candidate.icon;
            return (
              <SelectItem
                key={candidate.mode}
                value={candidate.mode}
                hideIndicator
                className="min-w-64"
              >
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {candidate.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {candidate.description}
                  </span>
                </div>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

type FooterBlockId = "mode" | "traits" | "access";

/**
 * The composer footer in V1's layout, built from upstream's controls: attach,
 * mode, provider and model, effort and context, access, then the context ring
 * and send on the right. Trailing blocks fold into upstream's overflow menu.
 */
export function UpComputerComposerFooter(props: UpComputerComposerFooterProps) {
  const { attachRow, hiddenCount, iconOnlyCount } = useComposerFooterControlsLayout();
  const hasTraits = renderProviderTraitsPicker(props.traitsPickerInput) !== null;
  // Priority order: the last block loses its label and folds first.
  const blocks: FooterBlockId[] = [
    ...(props.showInteractionModeToggle ? (["mode"] as const) : []),
    ...(hasTraits ? (["traits"] as const) : []),
    "access",
  ];
  const hiddenBlocks = new Set(blocks.slice(Math.max(0, blocks.length - hiddenCount)));
  const renderBlock = (id: FooterBlockId, content: ReactNode) => {
    const index = blocks.indexOf(id);
    const hidden = hiddenBlocks.has(id);
    const iconOnly = index >= blocks.length - iconOnlyCount;
    return (
      <div
        data-composer-footer-block={id}
        data-composer-block-icon-only={iconOnly ? "true" : "false"}
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
        className={cn(
          "flex w-max min-w-max shrink-0 items-center gap-0.5",
          hidden && "pointer-events-none invisible absolute",
          iconOnly && ICON_ONLY_BLOCK_CLASS,
        )}
      >
        {content}
      </div>
    );
  };

  return (
    <div
      data-chat-composer-footer="true"
      data-composer-footer-surface="upcomputer"
      className={cn(
        "flex min-w-0 flex-nowrap items-center gap-2 px-3 pb-3 sm:px-4 sm:pb-4",
        props.className,
      )}
    >
      <div
        ref={attachRow}
        data-chat-composer-controls="left"
        data-chat-composer-footer-controls="true"
        className={cn(
          "relative -ms-1.5 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-clip",
          QUIET_CONTROLS_CLASS,
        )}
      >
        {props.providerUnavailableControl ?? (
          <>
            {props.attachAction}
            {props.attachAction ? <FooterSeparator /> : null}
            {props.showInteractionModeToggle
              ? renderBlock(
                  "mode",
                  <>
                    <InteractionModeControl
                      interactionMode={props.interactionMode}
                      onToggle={props.onToggleInteractionMode}
                    />
                    <FooterSeparator />
                  </>,
                )
              : null}
            {props.modelPicker}
            {hasTraits
              ? renderBlock(
                  "traits",
                  <>
                    <FooterSeparator />
                    {renderProviderTraitsPicker({
                      ...props.traitsPickerInput,
                      hidden: hiddenBlocks.has("traits"),
                    })}
                  </>,
                )
              : null}
            {renderBlock(
              "access",
              <>
                <FooterSeparator />
                <AccessControl
                  runtimeMode={props.runtimeMode}
                  options={props.runtimeModeOptions}
                  hidden={hiddenBlocks.has("access")}
                  onChange={props.onRuntimeModeChange}
                />
              </>,
            )}
            <div
              data-composer-footer-overflow
              aria-hidden={hiddenBlocks.size === 0 || undefined}
              inert={hiddenBlocks.size === 0 || undefined}
              className={cn(
                "shrink-0",
                hiddenBlocks.size === 0 && "pointer-events-none invisible absolute",
              )}
            >
              <CompactComposerControlsMenu
                interactionMode={props.interactionMode}
                runtimeMode={props.runtimeMode}
                runtimeModeOptions={props.runtimeModeOptions}
                hidden={hiddenBlocks.size === 0}
                showInteractionModeToggle={hiddenBlocks.has("mode")}
                traitsMenuContent={hiddenBlocks.has("traits") ? props.traitsMenuContent : undefined}
                onToggleInteractionMode={props.onToggleInteractionMode}
                onRuntimeModeChange={props.onRuntimeModeChange}
              />
            </div>
          </>
        )}
      </div>
      <div
        data-chat-composer-actions="right"
        data-chat-composer-transition-actions="true"
        className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
      >
        {props.primaryActions}
      </div>
    </div>
  );
}
