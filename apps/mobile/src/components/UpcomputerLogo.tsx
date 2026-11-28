import { Image } from "react-native";

const LOGO = require("../../assets/upcomputer-logo.png");

/** The Up.computer app icon, the same image the desktop sidebar shows as its logo. */
export function UpcomputerLogo(props: { readonly size: number }) {
  return (
    <Image
      accessibilityLabel="Up.computer"
      source={LOGO}
      style={{ width: props.size, height: props.size }}
    />
  );
}
