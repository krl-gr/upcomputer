import { msg } from "gt-react";

/**
 * `centerY` is the vertical middle of the body. Small avatars frame on it, so
 * a body drawn low in the 128 box still sits centered next to a line of text.
 * `hat` is where the brim center rests and how it leans, so headwear follows
 * an off-center or tilted head instead of floating above x=64.
 */
export const botShapes = [
  {
    id: "drop",
    centerY: 73,
    label: msg("Drop", { $context: "bot body shape" }),
    hat: { x: 64, y: 42, tilt: 0 },
    path: "M64 34C72 34 79 48 90 61C103 76 104 88 96 99C83 117 46 117 32 99C19 82 26 65 39 52L54 37Q59 32 64 34Z",
  },
  {
    id: "triangle",
    centerY: 71,
    label: msg("Triangle"),
    hat: { x: 64, y: 43, tilt: 0 },
    path: "M53 40Q64 24 76 41L106 89Q117 109 93 110H35Q12 110 23 89Z",
  },
  {
    id: "cloud",
    centerY: 74,
    label: msg("Cloud"),
    hat: { x: 58, y: 44, tilt: -10 },
    path: "M39 54C44 31 76 29 86 51C112 49 122 81 104 95Q94 104 81 101C71 118 48 114 42 102C15 107 8 78 24 62Q30 56 39 54Z",
  },
  {
    id: "circle",
    centerY: 74,
    label: msg("Circle"),
    hat: { x: 72, y: 42, tilt: 14 },
    path: "M107 74A43 40 0 1 1 21 74A43 40 0 1 1 107 74Z",
  },
  {
    id: "capsule",
    centerY: 79,
    label: msg("Capsule"),
    hat: { x: 64, y: 51, tilt: 0 },
    path: "M44 49H84A30 30 0 0 1 84 109H44A30 30 0 0 1 44 49Z",
  },
  {
    id: "peanut",
    centerY: 73,
    label: msg("Peanut"),
    hat: { x: 57, y: 44, tilt: -14 },
    path: "M60 34C84 27 106 46 99 67C95 79 83 82 82 94C80 119 45 120 32 101C20 84 33 75 38 66C44 55 35 42 60 34Z",
  },
  {
    id: "diamond",
    centerY: 74,
    label: msg("Diamond"),
    hat: { x: 64, y: 42, tilt: 0 },
    path: "M53 37Q64 26 76 38L104 66Q118 79 104 91L76 113Q64 122 52 110L24 86Q12 75 24 63Z",
  },
  {
    id: "bean",
    centerY: 73,
    label: msg("Bean"),
    hat: { x: 82, y: 41, tilt: 10 },
    path: "M76 35C103 29 116 53 107 77C99 100 78 115 50 112C22 109 14 88 28 75C38 65 48 67 56 58C65 48 61 39 76 35Z",
  },
  {
    id: "dome",
    centerY: 75,
    label: msg("Dome"),
    hat: { x: 64, y: 46, tilt: 0 },
    path: "M17 100C17 62 37 40 64 40S111 62 111 100Q111 109 101 109H27Q17 109 17 100Z",
  },
  {
    id: "squircle",
    centerY: 74,
    label: msg("Squircle"),
    hat: { x: 64, y: 42, tilt: 0 },
    path: "M64 36C99 36 107 44 107 75S99 112 64 112S21 104 21 75S29 36 64 36Z",
  },
  {
    id: "star",
    centerY: 73,
    label: msg("Star"),
    hat: { x: 64, y: 43, tilt: 0 },
    path: "M55 36Q64 23 73 38L83 53Q85 56 94 57Q120 60 106 80L96 92L98 107Q99 121 82 116L65 110L47 116Q29 122 30 105L31 92L21 79Q7 60 33 57L46 54Z",
  },
  {
    id: "blob",
    centerY: 73,
    label: msg("Blob"),
    hat: { x: 71, y: 45, tilt: 14 },
    path: "M55 34C74 27 78 47 95 53C121 63 120 85 100 95C83 102 77 120 58 114C45 110 47 102 32 100C11 97 14 78 25 66C37 53 29 43 55 34Z",
  },
] as const;

export const botColors = [
  { id: "gray", label: msg("Gray"), fill: "#7d8085", shade: "#686c72" },
  { id: "blue", label: msg("Blue"), fill: "#1687fb", shade: "#0870e2" },
  { id: "orange", label: msg("Orange"), fill: "#ff8518", shade: "#ef6505" },
  { id: "black", label: msg("Black"), fill: "#292c32", shade: "#171a20" },
  { id: "green", label: msg("Green"), fill: "#07c68d", shade: "#00ae79" },
  { id: "brown", label: msg("Brown"), fill: "#a57442", shade: "#8c5c30" },
  { id: "purple", label: msg("Purple"), fill: "#9b84bb", shade: "#8068a4" },
  { id: "red", label: msg("Red"), fill: "#ed6266", shade: "#d74c56" },
  { id: "teal", label: msg("Teal"), fill: "#19b4ba", shade: "#089aa3" },
  { id: "yellow", label: msg("Yellow"), fill: "#e8b51b", shade: "#d19b08" },
  { id: "coral", label: msg("Coral"), fill: "#ff806c", shade: "#f36358" },
  { id: "navy", label: msg("Navy"), fill: "#334976", shade: "#24355c" },
] as const;

const botAccessories = [
  { id: "none", label: msg("None", { $context: "no bot accessory" }) },
  { id: "bowtie", label: msg("Bow tie") },
  { id: "gentleman", label: msg("Gentleman") },
  { id: "detective", label: msg("Detective") },
  { id: "chef", label: msg("Chef") },
  { id: "builder", label: msg("Builder") },
  { id: "artist", label: msg("Artist") },
  { id: "graduate", label: msg("Graduate") },
  { id: "cowboy", label: msg("Cowboy") },
  { id: "wizard", label: msg("Wizard") },
  { id: "professor", label: msg("Professor") },
  { id: "headphones", label: msg("Headphones") },
  { id: "crown", label: msg("Crown") },
  { id: "pirate", label: msg("Pirate") },
  { id: "firefighter", label: msg("Firefighter") },
  { id: "police", label: msg("Police") },
  { id: "nurse", label: msg("Nurse") },
  { id: "scientist", label: msg("Scientist") },
  { id: "pilot", label: msg("Pilot") },
  { id: "santa", label: msg("Santa") },
  { id: "winter", label: msg("Winter") },
  { id: "summer", label: msg("Summer") },
  { id: "photographer", label: msg("Photographer") },
  { id: "bunny", label: msg("Bunny") },
] as const;

export const botStates = [
  { id: "idle", label: msg("Idle") },
  { id: "working", label: msg("Working") },
  { id: "waiting", label: msg("Waiting") },
  { id: "attention", label: msg("Needs your attention") },
  { id: "done", label: msg("Done", { $context: "bot status" }) },
  { id: "failed", label: msg("Failed") },
  { id: "limited", label: msg("Provider limit") },
] as const;

export type BotShape = (typeof botShapes)[number]["id"];
export type BotColor = (typeof botColors)[number]["id"];
export type BotAccessory = (typeof botAccessories)[number]["id"];
export type BotCharacterState = (typeof botStates)[number]["id"];
export type BotAppearance = { shape: BotShape; color: BotColor; accessory: BotAccessory };

/** Labels are `msg()` text; whatever shows them translates them with `useMessages()`. */
export const botAppearanceCatalog = {
  shapes: botShapes,
  colors: botColors,
  accessories: botAccessories,
};
