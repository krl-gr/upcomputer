import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { ListSection } from "../../../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../../../components/ui/ScreenScrollView";
import { upBarIcon } from "../../../components/up-icons/upBarIcons";
import { SettingsRow } from "../../settings/components/SettingsRow";
import { withNativeGlassHeaderItem } from "../native-glass-header-items";
import { MORE_TAB, openedFromMore } from "./moreTab";
import type { NavigationTab } from "./navigation-tab-order";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";

/** The More tab: the desktop's sections the bar leaves out. */
export function MoreScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const insets = useSafeAreaInsets();
  const bottomClearance = useWorkspaceTabs()?.bottomClearance ?? 0;
  return (
    <View className="flex-1 bg-screen">
      {/* A list opened before in this slot leaves its search behind. */}
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1 bg-screen"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom:
            Math.max(Math.max(insets.bottom, 18) + 18, bottomClearance) -
            (Platform.OS === "ios" ? insets.bottom : 0),
        }}
      >
        <ListSection>
          <SettingsRow
            icon="up.robot"
            label={gt("Workers")}
            onPress={() => navigation.navigate("Workers")}
          />
        </ListSection>
        <ListSection>
          <SettingsRow
            icon="up.git-pull-request"
            label={gt("Pull requests")}
            onPress={() => selectTab("pullRequests")}
          />
          <SettingsRow
            icon="up.issue-open"
            label={gt("Issues")}
            onPress={() => selectTab("issues")}
          />
        </ListSection>
        <ListSection>
          <SettingsRow
            icon="up.settings"
            label={gt("Settings")}
            onPress={() => selectTab("settings")}
          />
        </ListSection>
      </ScrollView>
    </View>
  );
}

/** Back to More, for the sections More opens in its own slot. */
export function useBackToMoreHeaderItems(tab: NavigationTab, settingsOpen: boolean) {
  const gt = useGT();
  const selectTab = useSelectWorkspaceTab();
  if (!openedFromMore(tab, settingsOpen)) return [];
  const label = gt("More", { $context: "navigation tab, list of further sections" });
  return [
    withNativeGlassHeaderItem({
      accessibilityLabel: gt("Back to {name}", { name: label }),
      icon: upBarIcon("chevron-left"),
      identifier: "workspace-back-to-more",
      label,
      onPress: () => selectTab(MORE_TAB),
      type: "button" as const,
    }),
  ];
}
