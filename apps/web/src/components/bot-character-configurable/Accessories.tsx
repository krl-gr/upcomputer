/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- SVG artwork uses colocated CSS and fixed illustration colors independent of UI tokens. */
import type { BotAccessory } from "./catalog";

const ink = "#263447";
const gold = "#ffc844";
const paper = "#f8fafc";
const red = "#f45157";

function Badge() {
  return <path d="M60-18H68L70-12Q69-5 64-3Q59-5 58-12Z" fill={gold} />;
}

export function Headwear({
  accessory,
  hat,
}: {
  accessory: BotAccessory;
  hat: { readonly x: number; readonly y: number; readonly tilt: number };
}) {
  return (
    <g
      transform={`translate(${hat.x} ${hat.y}) rotate(${hat.tilt}) translate(-64 0)`}
      className="cbc-headwear"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {accessory === "gentleman" && (
        <g fill={ink}>
          <path d="M45-3V-11A19 19 0 0 1 83-11V-3Z" />
          <path d="M45-8H83" stroke="#8291a7" strokeWidth="4" />
          <rect x="35" y="-4" width="58" height="7" rx="3.5" />
        </g>
      )}
      {accessory === "detective" && (
        <g>
          <path d="M40-3L48-26Q55-30 64-24Q76-31 80-24L88-3Z" fill="#b17c59" />
          <path d="M44-10H84L86-4H42Z" fill={ink} />
          <ellipse cx="64" cy="-1" rx="40" ry="5" fill="#c18a64" />
        </g>
      )}
      {accessory === "chef" && (
        <g fill={paper} stroke="#c0cfdf" strokeWidth="2">
          <path
            d="M43 2L41-14C26-19 34-39 47-33C51-47 74-47 80-33C95-39 104-19 87-14L85 2Z"
            transform="translate(0 8) scale(1 .8)"
          />
          <path d="M43 3H85M54-10L52-20M74-10L76-20" className="cbc-detail" />
        </g>
      )}
      {accessory === "builder" && (
        <g>
          <path d="M29-1A35 30 0 0 1 99-1Z" fill="#ffd33e" />
          <path d="M54-22V-7M74-22V-7" stroke="#efa711" strokeWidth="4" className="cbc-detail" />
          <rect x="24" y="-3" width="80" height="7" rx="3.5" fill="#ffbc19" />
          <path d="M61-27H67V-6H61Z" fill="#ffdf64" />
        </g>
      )}
      {accessory === "artist" && (
        <g fill={ink} transform="rotate(-14 64 -7)">
          <ellipse cx="64" cy="-10" rx="34" ry="13" />
          <rect x="61" y="-27" width="5" height="10" rx="2" />
          <path d="M39-3H89V3H39Z" />
        </g>
      )}
      {accessory === "graduate" && (
        <g>
          <path d="M40-10H88V4Q64 13 40 4Z" fill={ink} />
          <path d="M20-12L64-29L108-12L64 3Z" fill="#34445a" />
          <path d="M99-10V10" stroke={gold} strokeWidth="3" />
          <path d="M99 8L95 18H103Z" fill={gold} />
        </g>
      )}
      {accessory === "cowboy" && (
        <g>
          <path d="M40-4L47-28Q51-32 64-25Q77-33 81-28L88-4" fill="#a56a49" />
          <path d="M42-11Q64-5 86-11L88-4H40Z" fill="#e5a774" />
          <path
            d="M23-8Q30-17 39-5Q64 7 89-5Q100-17 106-8Q109 13 64 11Q19 13 23-8Z"
            fill="#945f43"
          />
        </g>
      )}
      {accessory === "wizard" && (
        <g>
          <path d="M39-2L63-37Q67-43 90-30L77-25L88-2Z" fill="#7054c8" />
          <ellipse cx="64" cy="0" rx="42" ry="7" fill="#6244b6" />
          <path d="M62-22L64-16L70-16L65-12L67-6L62-10L57-6L59-12L54-16H60Z" fill={gold} />
          <circle cx="74" cy="-28" r="2" fill={gold} className="cbc-detail" />
        </g>
      )}
      {accessory === "headphones" && (
        <g fill="#268bff" stroke={ink} strokeWidth="5">
          <path d="M26 25V12A38 34 0 0 1 102 12V25" fill="none" />
          <rect x="21" y="14" width="13" height="28" rx="6" />
          <rect x="94" y="14" width="13" height="28" rx="6" />
        </g>
      )}
      {accessory === "crown" && (
        <g>
          <path d="M33 0L29-26L47-13L64-34L81-13L99-26L95 0Z" fill={gold} />
          <rect x="30" y="-1" width="68" height="6" rx="3" fill="#f5b41a" />
          <path d="M64-20Q73-13 64-6Q55-13 64-20Z" fill={red} />
          <g fill="#f5b41a" className="cbc-detail">
            <circle cx="29" cy="-26" r="3" />
            <circle cx="64" cy="-34" r="3" />
            <circle cx="99" cy="-26" r="3" />
          </g>
        </g>
      )}
      {accessory === "pirate" && (
        <g>
          <path
            d="M21-7Q20-16 35-15Q48-15 54-27Q64-35 75-26Q83-15 96-15Q111-16 107-7L99 3H29Z"
            fill={ink}
            stroke={gold}
            strokeWidth="3"
          />
          <path d="M32 1Q64-7 96 1" stroke={red} strokeWidth="6" />
          <g fill={paper} className="cbc-detail">
            <circle cx="64" cy="-18" r="5" />
            <path d="M59-11L70-6M69-11L58-6" stroke={paper} strokeWidth="2" />
          </g>
        </g>
      )}
      {accessory === "firefighter" && (
        <g>
          <path d="M29-1A35 30 0 0 1 99-1Z" fill="#ed3f48" />
          <path
            d="M50-23L47-2M78-23L81-2"
            stroke="#bf2d39"
            strokeWidth="5"
            className="cbc-detail"
          />
          <rect x="23" y="-3" width="82" height="7" rx="3.5" fill="#fa5357" />
          <path d="M59-28H69L75-5H53Z" fill="#d83240" />
          <Badge />
        </g>
      )}
      {accessory === "police" && (
        <g>
          <path d="M23-14Q25-21 64-31Q104-21 105-14L94 0H34Z" fill="#28568e" />
          <path d="M34-3Q64 7 94-3V5Q64 17 34 5Z" fill={ink} />
          <path d="M35-2H93" stroke="#7392b8" strokeWidth="2" />
          <Badge />
        </g>
      )}
      {accessory === "nurse" && (
        <g>
          <path d="M30-22Q64-38 98-22L89 3H39Z" fill={paper} stroke="#c6d3df" strokeWidth="2" />
          <path d="M35-20Q64-33 93-20" fill="none" stroke={red} strokeWidth="3" />
          <path d="M61-21H67V-15H73V-9H67V-3H61V-9H55V-15H61Z" fill={red} />
        </g>
      )}
      {accessory === "pilot" && (
        <g>
          <path
            d="M31 25V-1Q31-30 64-30Q97-30 97-1V25H88V3Q64-12 40 3V25Z"
            fill="#946344"
            stroke="#714a36"
            strokeWidth="3"
          />
          <path d="M36 2Q64-13 92 2V23H83V10H45V23H36Z" fill="#b8855e" />
          <g fill="#9cdefa" stroke={paper} strokeWidth="3">
            <ellipse cx="49" cy="-13" rx="13" ry="9" transform="rotate(-12 49 -13)" />
            <ellipse cx="79" cy="-13" rx="13" ry="9" transform="rotate(12 79 -13)" />
          </g>
          <path d="M62-14H66" stroke={ink} strokeWidth="3" />
        </g>
      )}
      {accessory === "santa" && (
        <g>
          <path d="M31-1Q38-35 69-32Q89-31 100-13L89-8Q73-29 77-2Z" fill="#f34b55" />
          <path d="M34 0Q64-9 92 0" fill="none" stroke={paper} strokeWidth="10" />
          <circle cx="101" cy="-11" r="8" fill={paper} />
        </g>
      )}
      {accessory === "winter" && (
        <g>
          <path d="M29-1Q31-31 64-31Q97-31 99-1Z" fill="#2a8df2" />
          <circle cx="64" cy="-32" r="8" fill="#64b5ff" />
          <rect x="25" y="-5" width="78" height="13" rx="5" fill="#55a9ff" />
          <path
            d="M36-3V5M48-3V5M60-3V5M72-3V5M84-3V5M96-3V5"
            stroke="#2985dd"
            strokeWidth="3"
            className="cbc-detail"
          />
        </g>
      )}
      {accessory === "summer" && (
        <g>
          <path d="M36-2L44-24Q64-34 84-24L92-2Z" fill="#f4cb75" />
          <path d="M40-13H88L91-4H37Z" fill={red} />
          <ellipse cx="64" cy="0" rx="44" ry="7" fill="#ffda87" />
          <path
            d="M25 1Q64-7 103 1"
            fill="none"
            stroke="#e8b556"
            strokeWidth="2"
            className="cbc-detail"
          />
        </g>
      )}
      {accessory === "bunny" && (
        <g fill={paper} stroke="#b9c8d8" strokeWidth="2">
          <path d="M47 1C14-35 42-54 55-1Z" />
          <path d="M73-1C86-54 114-35 81 1Z" />
          <g fill="#fa94a4" stroke="none">
            <path d="M46-7C29-30 40-39 50-6Z" />
            <path d="M78-6C88-39 99-30 82-7Z" />
          </g>
          <path d="M40 3Q64-9 88 3" fill="none" stroke={paper} strokeWidth="6" />
        </g>
      )}
    </g>
  );
}

export function FaceAccessories({ accessory }: { accessory: BotAccessory }) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {accessory === "bowtie" && (
        <g fill={ink}>
          <path d="M62 98Q44 85 46 100Q43 114 62 104ZM66 98Q84 85 82 100Q85 114 66 104Z" />
          <rect x="60" y="97" width="8" height="8" rx="3" fill="#7285a0" />
        </g>
      )}
      {accessory === "gentleman" && (
        <path
          d="M64 93Q55 83 48 92Q43 96 40 91Q41 108 58 100L64 97L70 100Q87 108 88 91Q85 96 80 92Q73 83 64 93Z"
          fill={ink}
        />
      )}
      {accessory === "detective" && (
        <g transform="rotate(22 103 91)">
          <circle
            cx="103"
            cy="82"
            r="12"
            fill="#deeffb"
            fillOpacity=".65"
            stroke="#5c718e"
            strokeWidth="4"
          />
          <path d="M103 96V111" stroke={ink} strokeWidth="7" />
          <path d="M99 77L104 74" stroke={paper} strokeWidth="3" className="cbc-detail" />
        </g>
      )}
      {accessory === "artist" && (
        <g>
          <path d="M103 96L112 69" stroke="#85573e" strokeWidth="5" />
          <path d="M108 72Q103 62 115 57Q121 73 108 72Z" fill={red} />
          <ellipse cx="96" cy="103" rx="17" ry="12" fill="#ffda90" />
          <g className="cbc-detail">
            <circle cx="88" cy="100" r="3" fill={red} />
            <circle cx="98" cy="97" r="3" fill="#1687fb" />
            <circle cx="105" cy="106" r="3" fill="#7054c8" />
            <circle cx="91" cy="109" r="3" fill="#07b88a" />
          </g>
        </g>
      )}
      {accessory === "professor" && (
        <g>
          <path d="M51 96H77L69 103H59Z" fill={paper} />
          <path d="M62 98H66L70 112L64 117L58 112Z" fill={ink} />
        </g>
      )}
      {accessory === "scientist" && (
        <g>
          <g transform="translate(88 87)">
            <path
              d="M8 0H18M10 1V9L1 25Q0 29 6 29H24Q30 29 28 25L17 9V1"
              fill="#e6f0ff"
              stroke="#c2d2eb"
              strokeWidth="2"
            />
            <path d="M7 19Q13 14 22 20L25 26H4Z" fill="#9b5cff" />
            <circle cx="27" cy="5" r="2" fill="#9b5cff" className="cbc-detail" />
          </g>
        </g>
      )}
      {accessory === "winter" && (
        <g fill={red}>
          <path d="M82 103L93 100L98 117Q94 121 87 117Z" />
          <path d="M25 91Q64 104 103 91L101 103Q64 116 27 103Z" />
          <path
            d="M36 101Q64 110 92 102"
            stroke="#ce3648"
            strokeWidth="2"
            fill="none"
            className="cbc-detail"
          />
        </g>
      )}
      {accessory === "photographer" && (
        <g>
          <path
            d="M33 84Q36 97 48 102M95 84Q92 97 80 102"
            fill="none"
            stroke={ink}
            strokeWidth="3"
          />
          <rect x="44" y="95" width="40" height="24" rx="4" fill={ink} />
          <path d="M57 95L60 91H70L73 95" fill={ink} />
          <circle cx="65" cy="107" r="9" fill="#91a6bd" />
          <circle cx="65" cy="107" r="6" fill="#1e3045" />
          <circle cx="63" cy="105" r="2" fill="#c7dced" className="cbc-detail" />
          <path d="M47 99H53" stroke={red} strokeWidth="3" />
        </g>
      )}
    </g>
  );
}

/** Drawn inside the eyes' tilt so lenses and the patch stay on the eyes of a leaning face. */
export function EyeAccessories({ accessory }: { accessory: BotAccessory }) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {accessory === "professor" && (
        <g fill="none" stroke={ink} strokeWidth="3">
          <ellipse cx="54" cy="73" rx="13" ry="14" />
          <ellipse cx="75" cy="73" rx="13" ry="14" />
          <path d="M65 70H64M41 69H36M88 69H93" />
        </g>
      )}
      {accessory === "pirate" && (
        <g fill={ink}>
          <path d="M66 63L50 56M84 64L94 60" stroke={ink} strokeWidth="2.5" />
          <rect x="65" y="59" width="20" height="28" rx="9" />
        </g>
      )}
      {accessory === "scientist" && (
        <g>
          <path
            d="M38 61H90Q96 61 96 69V77Q96 85 85 85H77Q66 85 64 80Q61 85 52 85H44Q32 85 32 77V69Q32 61 38 61Z"
            fill="#d9f9f1"
            fillOpacity=".18"
            stroke={paper}
            strokeWidth="3"
          />
          <path d="M32 68H29M96 68H99" stroke={ink} strokeWidth="4" />
        </g>
      )}
      {accessory === "summer" && (
        <g fill="#243b48" fillOpacity=".14" stroke={gold} strokeWidth="3">
          <path d="M37 64Q50 60 62 65L59 80Q47 89 40 78Z" />
          <path d="M66 65Q78 60 91 64L88 78Q81 89 69 80Z" />
          <path d="M62 67Q64 63 66 67M34 64H37M91 64H94" fill="none" />
        </g>
      )}
    </g>
  );
}
