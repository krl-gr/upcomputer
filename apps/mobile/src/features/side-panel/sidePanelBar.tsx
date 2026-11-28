import type { MenuAction } from "@react-native-menu/menu";
import type {
  NativeStackHeaderItem,
  NativeStackHeaderItemMenu,
} from "@react-navigation/native-stack";
import { useGT } from "gt-react-native";
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Pressable,
  View,
  type StyleProp,
  type TextInputInstance,
  type ViewStyle,
} from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { SearchField } from "../../components/ui/SearchField";
import { UpIcon, type UpIconName } from "../../components/up-icons/UpIcon";
import { upBarIcon } from "../../components/up-icons/upBarIcons";
import { GlassCapsule } from "./GlassBarButton";
import { WorkspaceSlotOptionsContext } from "../../native/v5-workspace-context";

type HeaderIcon = Extract<NativeStackHeaderItem, { type: "button" }>["icon"];
type HeaderMenuItem = NativeStackHeaderItemMenu["menu"]["items"][number];

/** The parts of a view's bar options the panel's one header row draws. */
interface ViewBarOptions {
  readonly unstable_headerRightItems?: (props: {
    readonly canGoBack: boolean;
  }) => ReadonlyArray<NativeStackHeaderItem>;
  readonly headerSearchBarOptions?: {
    readonly placeholder?: string;
    readonly onChangeText?: (event: { readonly nativeEvent: { readonly text: string } }) => void;
  };
  readonly unstable_headerToolbarItems?: () => ReadonlyArray<{
    readonly type: string;
    readonly placeholder?: string;
    readonly onSearchTextChange?: (text: string) => void;
  }>;
}

const NO_ROUTES: ReadonlyMap<string, object> = new Map();

/** The bar options each open view sets, by view, so the panel's header shows the current one's. */
export function createSidePanelBarStore() {
  let bars: ReadonlyMap<string, object> = new Map();
  const listeners = new Set<() => void>();
  return {
    set(key: string, options: object) {
      bars = new Map(bars).set(key, { ...bars.get(key), ...options });
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => bars,
  };
}

export type SidePanelBarStore = ReturnType<typeof createSidePanelBarStore>;

/**
 * A view's screens write their bar (AppBar, SheetHeader, Toolbar) here instead of the pane's
 * own bar, which then stays hidden: the panel's header row draws the view's actions.
 */
export function SidePanelBarSlot(props: {
  readonly store: SidePanelBarStore;
  readonly viewKey: string;
  readonly children: ReactNode;
}) {
  const { store, viewKey } = props;
  const slot = useMemo(
    () => ({
      byRoute: NO_ROUTES,
      set: (_routeKey: string, options: object) => store.set(viewKey, options),
    }),
    [store, viewKey],
  );
  return <WorkspaceSlotOptionsContext value={slot}>{props.children}</WorkspaceSlotOptionsContext>;
}

/** The panel's one header row: `leading` (the view select), the view's actions, `trailing`. */
export function SidePanelHeaderRow(props: {
  readonly store: SidePanelBarStore;
  readonly viewKey: string | null;
  readonly leading: ReactNode;
  readonly trailing: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const gt = useGT();
  const bars = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
  const options =
    props.viewKey === null ? undefined : (bars.get(props.viewKey) as ViewBarOptions | undefined);
  const items = options?.unstable_headerRightItems?.({ canGoBack: false }) ?? [];
  const search = searchOf(options);
  const [searching, setSearching] = useState<{
    readonly key: string;
    readonly text: string;
  } | null>(null);
  const searchText = search && searching?.key === props.viewKey ? searching.text : null;
  const searchInput = useRef<TextInputInstance>(null);
  const setSearch = (text: string | null) => {
    if (props.viewKey === null || search === null) return;
    setSearching(text === null ? null : { key: props.viewKey, text });
    search.onChange(text ?? "");
  };

  return (
    <View className="pb-2 pl-4 pr-4" style={props.style}>
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1 flex-row items-center">{props.leading}</View>
        {search ? (
          <BarButton
            label={searchText === null ? search.placeholder : gt("Close search")}
            icon={{
              type: "sfSymbol",
              name: searchText === null ? "magnifyingglass" : "xmark.circle",
            }}
            onPress={() => setSearch(searchText === null ? "" : null)}
          />
        ) : null}
        {items.map((item, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- header items carry no id; a view's bar lists them in a fixed order
          <BarItem key={`${item.type}:${index}`} item={item} itemKey={String(index)} />
        ))}
        {props.trailing}
      </View>
      {searchText !== null && search ? (
        <View className="flex-row pt-2 pr-1">
          <SearchField
            inputRef={searchInput}
            accessibilityLabel={search.placeholder}
            clearAccessibilityLabel={gt("Clear search")}
            placeholder={search.placeholder}
            value={searchText}
            onChangeText={setSearch}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A view's search: the bar's search field or, in compact width, the mail search toolbar. */
function searchOf(options: ViewBarOptions | undefined) {
  const field = options?.headerSearchBarOptions;
  if (field?.onChangeText) {
    const onChangeText = field.onChangeText;
    return {
      placeholder: field.placeholder ?? "",
      onChange: (text: string) => onChangeText({ nativeEvent: { text } }),
    };
  }
  const mail = options
    ?.unstable_headerToolbarItems?.()
    .find((item) => item.type === "mailSearchToolbar");
  if (mail?.onSearchTextChange) {
    return { placeholder: mail.placeholder ?? "", onChange: mail.onSearchTextChange };
  }
  return null;
}

function BarItem(props: { readonly item: NativeStackHeaderItem; readonly itemKey: string }) {
  const { item } = props;
  switch (item.type) {
    case "button":
      return (
        <BarButton
          label={item.accessibilityLabel ?? item.label}
          icon={item.icon}
          tintColor={item.tintColor}
          disabled={item.disabled}
          onPress={item.onPress}
        />
      );
    case "menu": {
      const label = item.accessibilityLabel ?? item.label ?? item.menu.title ?? "";
      if (item.disabled) return <BarButton label={label} icon={item.icon} disabled />;
      const handlers = new Map<string, () => void>();
      const actions = menuActions(item.menu.items, props.itemKey, handlers);
      return (
        <Menu
          accessible
          accessibilityRole="button"
          accessibilityLabel={label}
          title={item.menu.title}
          actions={actions}
          onPressAction={({ nativeEvent }) => handlers.get(nativeEvent.event)?.()}
        >
          <GlassCapsule>
            <BarIcon icon={item.icon} label={label} tintColor={item.tintColor} />
          </GlassCapsule>
        </Menu>
      );
    }
    case "custom":
      return <View className="min-h-11 items-center justify-center">{item.element}</View>;
    default:
      return null;
  }
}

function BarButton(props: {
  readonly label: string;
  readonly icon: HeaderIcon;
  readonly tintColor?: unknown;
  readonly disabled?: boolean;
  readonly onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={4}
      className="active:opacity-60"
      style={props.disabled ? { opacity: 0.4 } : undefined}
    >
      <GlassCapsule>
        <BarIcon icon={props.icon} label={props.label} tintColor={props.tintColor} />
      </GlassCapsule>
    </Pressable>
  );
}

const BAR_ICON_NAMES = [
  "chevron-left",
  "filter",
  "more-horizontal",
  "panel-bottom",
  "plus",
  "sliders",
] as const;

function BarIcon(props: {
  readonly icon: HeaderIcon;
  readonly label: string;
  readonly tintColor?: unknown;
}) {
  const { icon } = props;
  const tint = typeof props.tintColor === "string" ? props.tintColor : undefined;
  if (icon?.type === "image") {
    const name: UpIconName | undefined = BAR_ICON_NAMES.find(
      (candidate) => upBarIcon(candidate).source === icon.source,
    );
    if (name)
      return tint ? (
        <UpIcon name={name} size={20} tintColor={tint} />
      ) : (
        <UpIcon name={name} size={20} tintColorClassName="accent-icon" />
      );
  }
  if (icon?.type === "sfSymbol") {
    const name = icon.name as AppSymbolName;
    const size = String(icon.name).startsWith("up.") ? 20 : 18;
    return tint ? (
      <SymbolView name={name} size={size} tintColor={tint} />
    ) : (
      <SymbolView name={name} size={size} tintColorClassName="accent-icon" />
    );
  }
  return (
    <Text numberOfLines={1} className="px-2 text-[17px] text-foreground">
      {props.label}
    </Text>
  );
}

/** A native header menu's items as a `Menu`'s actions, with their handlers by action id. */
function menuActions(
  items: ReadonlyArray<HeaderMenuItem>,
  prefix: string,
  handlers: Map<string, () => void>,
): MenuAction[] {
  return items.flatMap((item, index): MenuAction[] => {
    if ("hidden" in item && item.hidden) return [];
    const id = `${prefix}:${index}`;
    const image = menuImage(item.icon);
    if (item.type === "submenu") {
      return [
        {
          id,
          title: item.label,
          image,
          displayInline: item.inline,
          subactions: menuActions(item.items, id, handlers),
        },
      ];
    }
    handlers.set(id, item.onPress);
    return [
      {
        id,
        title: item.label,
        subtitle: item.description,
        image,
        state: item.state,
        attributes:
          item.disabled || item.destructive
            ? { disabled: item.disabled, destructive: item.destructive }
            : undefined,
      },
    ];
  });
}

/** Native menu rows take SF Symbol names only, so the app's own icons drop out there. */
function menuImage(icon: HeaderIcon) {
  return icon?.type === "sfSymbol" && !String(icon.name).startsWith("up.")
    ? String(icon.name)
    : undefined;
}
