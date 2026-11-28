import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

export const T3_CODE_BRAND_MARK_SOURCE =
  appVariant === "development"
    ? require("../../../../assets/dev/upcomputer-blueprint-ios-1024.png")
    : appVariant === "preview"
      ? require("../../../../assets/dev/upcomputer-blueprint-ios-1024.png")
      : require("../../../../assets/prod/upcomputer-ios-1024.png");
