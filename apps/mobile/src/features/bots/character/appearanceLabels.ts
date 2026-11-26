import { BotAppearance } from "@t3tools/tasks-contracts/v1";
import { msg } from "gt-react-native";

// The desktop's picker labels for the character catalog
// (apps/web/src/components/bot-character-configurable/catalog.ts), in its order.

type Labels<K extends string> = { readonly [Key in K]: string };

export const BOT_SHAPE_LABELS: Labels<BotAppearance["shape"]> = {
  drop: msg("Drop", { $context: "bot body shape" }),
  triangle: msg("Triangle"),
  cloud: msg("Cloud"),
  circle: msg("Circle"),
  capsule: msg("Capsule"),
  peanut: msg("Peanut"),
  diamond: msg("Diamond"),
  bean: msg("Bean"),
  dome: msg("Dome"),
  squircle: msg("Squircle"),
  star: msg("Star"),
  blob: msg("Blob"),
};

export const BOT_COLOR_LABELS: Labels<BotAppearance["color"]> = {
  gray: msg("Gray"),
  blue: msg("Blue"),
  orange: msg("Orange"),
  black: msg("Black"),
  green: msg("Green"),
  brown: msg("Brown"),
  purple: msg("Purple"),
  red: msg("Red"),
  teal: msg("Teal"),
  yellow: msg("Yellow"),
  coral: msg("Coral"),
  navy: msg("Navy"),
};

export const BOT_ACCESSORY_LABELS: Labels<BotAppearance["accessory"]> = {
  none: msg("None", { $context: "no bot accessory" }),
  bowtie: msg("Bow tie"),
  gentleman: msg("Gentleman"),
  detective: msg("Detective"),
  chef: msg("Chef"),
  builder: msg("Builder"),
  artist: msg("Artist"),
  graduate: msg("Graduate"),
  cowboy: msg("Cowboy"),
  wizard: msg("Wizard"),
  professor: msg("Professor"),
  headphones: msg("Headphones"),
  crown: msg("Crown"),
  pirate: msg("Pirate"),
  firefighter: msg("Firefighter"),
  police: msg("Police"),
  nurse: msg("Nurse"),
  scientist: msg("Scientist"),
  pilot: msg("Pilot"),
  santa: msg("Santa"),
  winter: msg("Winter"),
  summer: msg("Summer"),
  photographer: msg("Photographer"),
  bunny: msg("Bunny"),
};

export const BOT_ACCESSORIES = BotAppearance.fields.accessory.literals;
