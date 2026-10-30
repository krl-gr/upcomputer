import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { BlankWorkspacePage } from "../components/BlankWorkspacePage";
import { CompactSidebarButton, CompactSidebarPill } from "../components/sidebar/CompactSidebarPill";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { SIDEBAR_AFTER_SEARCH_GAP, SIDEBAR_MENU_SCOPE } from "../sidebarMetrics/sidebarMetrics";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  SidebarCompactTooltip,
  useSidebarFooterTooltipSide,
} from "../adaptiveSidebar/adaptiveSidebar";
import { cn } from "../lib/utils";
import { WEB_PRODUCT } from "./productEntry";
import type {
  ExperimentalWebRightPanelSurfaceContribution,
  ExperimentalWebRightPanelSurfaceProps,
  ExperimentalWebThreadAccessoryProps,
  ExperimentalWebThreadRowAccessoryProps,
} from "./WebFeature";
import {
  findExperimentalWebRightPanelSurface,
  isExperimentalWebNavigationActive,
  type ExperimentalWebProductComposition,
} from "./WebProduct";

/** Each feature's row accessory wraps the next one's, ending at the timestamp. */
export function threadRowAccessoryElement(
  product: ExperimentalWebProductComposition,
  props: ExperimentalWebThreadRowAccessoryProps,
): ReactNode {
  return product.features.reduceRight<ReactNode>(
    (fallback, feature) =>
      feature.threadRowAccessory
        ? createElement(feature.threadRowAccessory, { ...props, fallback, key: feature.id })
        : fallback,
    props.fallback,
  );
}

export function chatHeaderAccessoryElements(
  product: ExperimentalWebProductComposition,
  props: ExperimentalWebThreadAccessoryProps,
): ReadonlyArray<ReactNode> {
  return product.features.flatMap((feature) =>
    feature.chatHeaderAccessory
      ? [createElement(feature.chatHeaderAccessory, { ...props, key: feature.id })]
      : [],
  );
}

const rowNavigation = WEB_PRODUCT.navigation.filter((item) => item.placement === undefined);
const footerNavigation = WEB_PRODUCT.navigation.filter((item) => item.placement === "footer");

function useNavigateTo() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return (path: string) => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/$", params: { _splat: path.slice(1) } });
  };
}

/** Feature entries in the sidebar's primary navigation. */
export function ProductSidebarNavigation() {
  const navigateTo = useNavigateTo();
  const pathname = useLocation({ select: (location) => location.pathname });
  if (rowNavigation.length === 0) return null;
  return (
    <div className={cn(SIDEBAR_AFTER_SEARCH_GAP, SIDEBAR_MENU_SCOPE)}>
      <SidebarMenu>
        {rowNavigation.map((item) => {
          const Icon = item.icon;
          const Accessory = item.accessory;
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarCompactTooltip label={item.label}>
                <SidebarMenuButton
                  data-track={`nav.${item.id}`}
                  isActive={isExperimentalWebNavigationActive(item, pathname)}
                  onClick={() => navigateTo(item.path)}
                >
                  {Icon ? <Icon /> : null}
                  <span className="flex-1 truncate">{item.label}</span>
                  {Accessory ? (
                    <span className="ml-auto shrink-0 tabular-nums">
                      <Accessory />
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarCompactTooltip>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </div>
  );
}

/** Feature entries placed in the sidebar footer, as its utility buttons are. */
export function ProductSidebarFooterNavigation() {
  const navigateTo = useNavigateTo();
  const pathname = useLocation({ select: (location) => location.pathname });
  const tooltipSide = useSidebarFooterTooltipSide();
  return footerNavigation.map((item) => {
    const Icon = item.icon;
    return (
      <SidebarMenuItem key={item.id} className="shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <SidebarMenuButton
                aria-label={item.label}
                data-track={`nav.${item.id}`}
                isActive={isExperimentalWebNavigationActive(item, pathname)}
                onClick={() => navigateTo(item.path)}
                size="icon"
              >
                {Icon ? <Icon /> : null}
              </SidebarMenuButton>
            }
          />
          <TooltipPopup side={tooltipSide}>{item.label}</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    );
  });
}

/** The primary navigation's pill in the compact sidebar. */
export function ProductCompactSidebarNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  if (WEB_PRODUCT.navigation.length === 0) return null;
  return (
    <CompactSidebarPill label="Navigation">
      {WEB_PRODUCT.navigation.map((item) => {
        const Icon = item.icon;
        return (
          <CompactSidebarButton
            key={item.id}
            data-track={`nav.${item.id}`}
            label={item.label}
            isActive={isExperimentalWebNavigationActive(item, pathname)}
            onClick={() => void navigate({ to: "/$", params: { _splat: item.path.slice(1) } })}
          >
            {Icon ? <Icon /> : null}
          </CompactSidebarButton>
        );
      })}
    </CompactSidebarPill>
  );
}

/** Feature settings sections, after core's in the settings navigation. */
export function ProductSettingsNavItems(props: { readonly pathname: string }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  return WEB_PRODUCT.settings.map((page) => {
    const Icon = page.icon;
    return (
      <SidebarMenuItem key={page.path}>
        <SidebarMenuButton
          data-track={`settings.nav.${page.id}`}
          isActive={props.pathname === page.path}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
            void navigate({
              to: "/settings/$section",
              params: { section: page.path.slice("/settings/".length) },
              hash: "",
              replace: true,
              hashScrollIntoView: false,
            });
          }}
        >
          {Icon ? <Icon /> : null}
          <span className="truncate">{page.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}

export function ProductThreadRowAccessory(props: ExperimentalWebThreadRowAccessoryProps) {
  return threadRowAccessoryElement(WEB_PRODUCT, props);
}

export function ProductChatHeaderAccessory(props: ExperimentalWebThreadAccessoryProps) {
  return chatHeaderAccessoryElements(WEB_PRODUCT, props);
}

export function ProductSidebarSections() {
  return WEB_PRODUCT.features.flatMap((feature) =>
    feature.sidebarSection ? [createElement(feature.sidebarSection, { key: feature.id })] : [],
  );
}

export function ProductCompactSidebarSections() {
  return WEB_PRODUCT.features.flatMap((feature) =>
    feature.compactSidebarSection
      ? [createElement(feature.compactSidebarSection, { key: feature.id })]
      : [],
  );
}

/** Every feature's app-wide coordinator. */
export function ProductCoordinators() {
  return WEB_PRODUCT.features.flatMap((feature) =>
    feature.coordinator ? [createElement(feature.coordinator, { key: feature.id })] : [],
  );
}

// One lazy component per page, created once for the build's product.
const routePages = new Map<string, ComponentType>(
  WEB_PRODUCT.routes.map((route) => [route.path, lazy(route.load)]),
);
const settingsPages = new Map<string, ComponentType>(
  WEB_PRODUCT.settings.map((page) => [page.path, lazy(page.load)]),
);
const rightPanelSurfaces = new Map<string, ComponentType<ExperimentalWebRightPanelSurfaceProps>>(
  WEB_PRODUCT.rightPanelSurfaces.map((surface) => [surface.id, lazy(surface.load)]),
);

function ProductPage(props: {
  readonly page: ComponentType | undefined;
  readonly fallback: ReactNode;
}) {
  const Page = props.page;
  // The path moved on to another route that is still loading.
  if (Page === undefined) return props.fallback;
  return (
    <Suspense fallback={props.fallback}>
      <Page />
    </Suspense>
  );
}

/** The feature page at a top-level path; the route has already checked it exists. */
export function ProductRoutePage(props: { readonly pathname: string }) {
  // A page sets its own background, so it loads on a blank page. Keyed by
  // path, so the previous page never stays up under the next one's nav item.
  // The pathname is the location's, which moves before the next route loads.
  return (
    <ProductPage
      key={props.pathname}
      page={routePages.get(props.pathname)}
      fallback={<BlankWorkspacePage />}
    />
  );
}

/** The feature settings section at a path; the route has already checked it exists. */
export function ProductSettingsPage(props: { readonly pathname: string }) {
  return (
    <ProductPage key={props.pathname} page={settingsPages.get(props.pathname)} fallback={null} />
  );
}

/** Feature surfaces the right panel beside a thread offers after core's. */
export function productRightPanelSurfaces(): ReadonlyArray<ExperimentalWebRightPanelSurfaceContribution> {
  return WEB_PRODUCT.rightPanelSurfaces;
}

export function productRightPanelSurface(
  id: string,
): ExperimentalWebRightPanelSurfaceContribution | undefined {
  return findExperimentalWebRightPanelSurface(WEB_PRODUCT, id);
}

/** A feature surface's content; nothing for a surface this build does not have. */
export function ProductRightPanelSurface(
  props: ExperimentalWebRightPanelSurfaceProps & { readonly featureSurfaceId: string },
) {
  const surface = rightPanelSurfaces.get(props.featureSurfaceId);
  if (surface === undefined) return null;
  return (
    <Suspense fallback={null}>
      {createElement(surface, {
        environmentId: props.environmentId,
        threadId: props.threadId,
        projectId: props.projectId,
      })}
    </Suspense>
  );
}
