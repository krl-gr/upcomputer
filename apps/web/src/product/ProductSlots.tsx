import { createElement, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { SIDEBAR_AFTER_SEARCH_GAP, SIDEBAR_MENU_SCOPE } from "../sidebarMetrics/sidebarMetrics";
import { cn } from "../lib/utils";
import { WEB_PRODUCT } from "./productEntry";
import type {
  ExperimentalWebThreadAccessoryProps,
  ExperimentalWebThreadRowAccessoryProps,
} from "./WebFeature";
import {
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

/** Feature entries in the sidebar's primary navigation. */
export function ProductSidebarNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  if (WEB_PRODUCT.navigation.length === 0) return null;
  return (
    <div className={cn(SIDEBAR_AFTER_SEARCH_GAP, SIDEBAR_MENU_SCOPE)}>
      <SidebarMenu>
        {WEB_PRODUCT.navigation.map((item) => {
          const Icon = item.icon;
          const Accessory = item.accessory;
          return (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={isExperimentalWebNavigationActive(item, pathname)}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                  void navigate({ to: "/$", params: { _splat: item.path.slice(1) } });
                }}
              >
                {Icon ? <Icon /> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {Accessory ? (
                  <span className="ml-auto shrink-0 tabular-nums">
                    <Accessory />
                  </span>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </div>
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

// One lazy component per page, created once for the build's product.
const routePages = new Map<string, ComponentType>(
  WEB_PRODUCT.routes.map((route) => [route.path, lazy(route.load)]),
);
const settingsPages = new Map<string, ComponentType>(
  WEB_PRODUCT.settings.map((page) => [page.path, lazy(page.load)]),
);

function ProductPage(props: { readonly page: ComponentType | undefined }) {
  const Page = props.page;
  if (Page === undefined) return null;
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}

/** The feature page at a top-level path; the route has already checked it exists. */
export function ProductRoutePage(props: { readonly pathname: string }) {
  return <ProductPage page={routePages.get(props.pathname)} />;
}

/** The feature settings section at a path; the route has already checked it exists. */
export function ProductSettingsPage(props: { readonly pathname: string }) {
  return <ProductPage page={settingsPages.get(props.pathname)} />;
}
