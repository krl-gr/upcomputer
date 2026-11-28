import { useNavigation } from "@react-navigation/native";
import { plainErrorSentence } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import type { ProviderUpdate } from "./notificationsModel";
import { useNotifications } from "./useNotifications";

/**
 * The desktop bell as a tab: Updates (provider CLIs a computer can update) and Notifications
 * (computers Up.computer can't reach), with the bell's words.
 */
export function NotificationsScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottomClearance = useWorkspaceTabs()?.bottomClearance ?? 0;
  const { updates, outages } = useNotifications();
  const openConnections = () => openSettings(navigation, "SettingsEnvironments");

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
          flexGrow: 1,
          paddingBottom:
            Math.max(Math.max(insets.bottom, 18) + 18, bottomClearance) -
            (Platform.OS === "ios" ? insets.bottom : 0),
        }}
      >
        {updates.length === 0 && outages.length === 0 ? (
          <View className="flex-1 justify-center">
            <EmptyState
              variant="plain"
              title={gt("You're all caught up")}
              detail={gt("Updates and alerts show here.")}
            />
          </View>
        ) : null}
        {updates.length > 0 ? (
          <ListSection title={gt("Updates", { $context: "notifications section" })}>
            {updates.map((update) => (
              <ProviderUpdateRow key={update.key} update={update} />
            ))}
          </ListSection>
        ) : null}
        {outages.length > 0 ? (
          <ListSection title={gt("Notifications")}>
            {outages.map((outage) => (
              <ListRowLayout
                key={outage.environmentId}
                icon={outage.stopped ? "up.alert-circle" : "up.alert"}
                label={
                  outage.stopped
                    ? gt("Can't connect to {computer}", { computer: outage.label })
                    : gt("Can't reach {computer}", { computer: outage.label })
                }
                description={
                  outage.stopped
                    ? gt("{appName} stopped trying. Retry, or open Connections to see why.", {
                        appName: "Up.computer",
                      })
                    : gt("{appName} keeps trying. Its chats, bots and tasks show what they had.", {
                        appName: "Up.computer",
                      })
                }
                accessory={<CardButton label={gt("Connections")} onPress={openConnections} />}
              />
            ))}
          </ListSection>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProviderUpdateRow(props: { readonly update: ProviderUpdate }) {
  const gt = useGT();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider);
  const [updating, setUpdating] = useState(false);
  const { update } = props;
  const run = async () => {
    setUpdating(true);
    const result = await updateProvider({
      environmentId: update.environmentId,
      input: { provider: update.driver, instanceId: update.instanceId },
    });
    setUpdating(false);
    if (AsyncResult.isFailure(result))
      Dialog.alert(
        gt("{provider} update failed", { provider: update.name }),
        plainErrorSentence(squashAtomCommandFailure(result)),
      );
  };
  return (
    <ListRowLayout
      icon="up.arrow-up"
      label={`${update.name} ${update.latestVersion}`}
      description={
        update.version === null
          ? undefined
          : update.machineLabel
            ? gt("You have {version} on {machine}", {
                version: update.version,
                machine: update.machineLabel,
              })
            : gt("You have {version}", { version: update.version })
      }
      accessory={
        <CardButton
          label={updating ? gt("Updating") : gt("Update")}
          disabled={updating}
          onPress={() => void run()}
        />
      }
    />
  );
}

function CardButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={8}
      className="rounded-full bg-subtle px-3 py-2 active:opacity-70"
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
    </Pressable>
  );
}
