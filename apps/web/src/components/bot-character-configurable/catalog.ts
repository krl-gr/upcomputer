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
    label: "Drop",
    hat: { x: 64, y: 42, tilt: 0 },
    eyeTilt: 0,
    path: "M64 34C72 34 79 48 90 61C103 76 104 88 96 99C83 117 46 117 32 99C19 82 26 65 39 52L54 37Q59 32 64 34Z",
  },
  {
    id: "triangle",
    centerY: 71,
    label: "Triangle",
    hat: { x: 64, y: 43, tilt: 0 },
    eyeTilt: 0,
    path: "M53 40Q64 24 76 41L106 89Q117 109 93 110H35Q12 110 23 89Z",
  },
  {
    id: "cloud",
    centerY: 74,
    label: "Cloud",
    hat: { x: 58, y: 44, tilt: -10 },
    eyeTilt: -15,
    path: "M39 54C44 31 76 29 86 51C112 49 122 81 104 95Q94 104 81 101C71 118 48 114 42 102C15 107 8 78 24 62Q30 56 39 54Z",
  },
  {
    id: "circle",
    centerY: 74,
    label: "Circle",
    hat: { x: 72, y: 42, tilt: 14 },
    eyeTilt: 16,
    path: "M107 74A43 40 0 1 1 21 74A43 40 0 1 1 107 74Z",
  },
  {
    id: "capsule",
    centerY: 79,
    label: "Capsule",
    hat: { x: 64, y: 51, tilt: 0 },
    eyeTilt: 0,
    path: "M44 49H84A30 30 0 0 1 84 109H44A30 30 0 0 1 44 49Z",
  },
  {
    id: "peanut",
    centerY: 73,
    label: "Peanut",
    hat: { x: 57, y: 44, tilt: -14 },
    eyeTilt: -16,
    path: "M60 34C84 27 106 46 99 67C95 79 83 82 82 94C80 119 45 120 32 101C20 84 33 75 38 66C44 55 35 42 60 34Z",
  },
  {
    id: "diamond",
    centerY: 74,
    label: "Diamond",
    hat: { x: 64, y: 42, tilt: 0 },
    eyeTilt: 0,
    path: "M53 37Q64 26 76 38L104 66Q118 79 104 91L76 113Q64 122 52 110L24 86Q12 75 24 63Z",
  },
  {
    id: "bean",
    centerY: 73,
    label: "Bean",
    hat: { x: 82, y: 41, tilt: 10 },
    eyeTilt: -18,
    path: "M76 35C103 29 116 53 107 77C99 100 78 115 50 112C22 109 14 88 28 75C38 65 48 67 56 58C65 48 61 39 76 35Z",
  },
  {
    id: "dome",
    centerY: 75,
    label: "Dome",
    hat: { x: 64, y: 46, tilt: 0 },
    eyeTilt: 0,
    path: "M17 100C17 62 37 40 64 40S111 62 111 100Q111 109 101 109H27Q17 109 17 100Z",
  },
  {
    id: "squircle",
    centerY: 74,
    label: "Squircle",
    hat: { x: 64, y: 42, tilt: 0 },
    eyeTilt: 0,
    path: "M64 36C99 36 107 44 107 75S99 112 64 112S21 104 21 75S29 36 64 36Z",
  },
  {
    id: "star",
    centerY: 73,
    label: "Star",
    hat: { x: 64, y: 43, tilt: 0 },
    eyeTilt: 0,
    path: "M55 36Q64 23 73 38L83 53Q85 56 94 57Q120 60 106 80L96 92L98 107Q99 121 82 116L65 110L47 116Q29 122 30 105L31 92L21 79Q7 60 33 57L46 54Z",
  },
  {
    id: "blob",
    centerY: 73,
    label: "Blob",
    hat: { x: 71, y: 45, tilt: 14 },
    eyeTilt: 17,
    path: "M55 34C74 27 78 47 95 53C121 63 120 85 100 95C83 102 77 120 58 114C45 110 47 102 32 100C11 97 14 78 25 66C37 53 29 43 55 34Z",
  },
] as const;

export const botColors = [
  { id: "gray", label: "Gray", fill: "#7d8085", shade: "#686c72" },
  { id: "blue", label: "Blue", fill: "#1687fb", shade: "#0870e2" },
  { id: "orange", label: "Orange", fill: "#ff8518", shade: "#ef6505" },
  { id: "black", label: "Black", fill: "#292c32", shade: "#171a20" },
  { id: "green", label: "Green", fill: "#07c68d", shade: "#00ae79" },
  { id: "brown", label: "Brown", fill: "#a57442", shade: "#8c5c30" },
  { id: "purple", label: "Purple", fill: "#9b84bb", shade: "#8068a4" },
  { id: "red", label: "Red", fill: "#ed6266", shade: "#d74c56" },
  { id: "teal", label: "Teal", fill: "#19b4ba", shade: "#089aa3" },
  { id: "yellow", label: "Yellow", fill: "#e8b51b", shade: "#d19b08" },
  { id: "coral", label: "Coral", fill: "#ff806c", shade: "#f36358" },
  { id: "navy", label: "Navy", fill: "#334976", shade: "#24355c" },
] as const;

const botAccessories = [
  { id: "none", label: "None" },
  { id: "bowtie", label: "Bow tie" },
  { id: "gentleman", label: "Gentleman" },
  { id: "detective", label: "Detective" },
  { id: "chef", label: "Chef" },
  { id: "builder", label: "Builder" },
  { id: "artist", label: "Artist" },
  { id: "graduate", label: "Graduate" },
  { id: "cowboy", label: "Cowboy" },
  { id: "wizard", label: "Wizard" },
  { id: "professor", label: "Professor" },
  { id: "headphones", label: "Headphones" },
  { id: "crown", label: "Crown" },
  { id: "pirate", label: "Pirate" },
  { id: "firefighter", label: "Firefighter" },
  { id: "police", label: "Police" },
  { id: "nurse", label: "Nurse" },
  { id: "scientist", label: "Scientist" },
  { id: "pilot", label: "Pilot" },
  { id: "santa", label: "Santa" },
  { id: "winter", label: "Winter" },
  { id: "summer", label: "Summer" },
  { id: "photographer", label: "Photographer" },
  { id: "bunny", label: "Bunny" },
] as const;

export const botStates = [
  { id: "idle", label: "Idle" },
  { id: "working", label: "Working" },
  { id: "waiting", label: "Waiting" },
  { id: "attention", label: "Needs your attention" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
  { id: "limited", label: "Provider limit" },
] as const;

export type BotShape = (typeof botShapes)[number]["id"];
export type BotColor = (typeof botColors)[number]["id"];
export type BotAccessory = (typeof botAccessories)[number]["id"];
export type BotCharacterState = (typeof botStates)[number]["id"];
export type BotAppearance = { shape: BotShape; color: BotColor; accessory: BotAccessory };

export const botAppearanceCatalog = {
  shapes: botShapes,
  colors: botColors,
  accessories: botAccessories,
};
