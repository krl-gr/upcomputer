import type { AuthClientPresentationMetadata } from "@upcomputer/contracts";
import { Platform } from "react-native";

export function authClientMetadata(): AuthClientPresentationMetadata {
  return {
    label: "T3 Code Mobile",
    deviceType: "mobile",
    ...(Platform.OS === "ios" ? { os: "iOS" } : Platform.OS === "android" ? { os: "Android" } : {}),
  };
}
