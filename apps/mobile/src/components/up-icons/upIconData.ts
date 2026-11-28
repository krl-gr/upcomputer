/**
 * Outline icons from iconmcp (https://iconmcp.com, MIT, Copyright (c) 2026 UI8), drawn on a
 * 16-unit grid. Generated from the library's SVGs; add an icon by fetching it with get_icon.
 */
export type UpIconElement =
  | { readonly kind: "path"; readonly d: string; readonly fill?: true }
  | {
      readonly kind: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill?: true;
    }
  | {
      readonly kind: "ellipse";
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly fill?: true;
    }
  | {
      readonly kind: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
      readonly fill?: true;
    };

export interface UpIconData {
  /** Degrees around the grid's center. */
  readonly rotate?: number;
  readonly elements: ReadonlyArray<UpIconElement>;
}

export const UP_ICONS = {
  alert: {
    elements: [
      {
        kind: "path",
        d: "M9.311 4.36 L13.012 11.022 C13.567 12.021 12.844 13.25 11.701 13.25 L4.299 13.25 C3.156 13.25 2.433 12.021 2.988 11.022 L6.689 4.36 C7.26 3.332 8.74 3.332 9.311 4.36 Z",
      },
      { kind: "line", x1: 8, y1: 6.25, x2: 8, y2: 8.75 },
      { kind: "circle", cx: 8, cy: 10.9, r: 0.66, fill: true },
    ],
  },
  "alert-circle": {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "line", x1: 8, y1: 5.25, x2: 8, y2: 8.75 },
      { kind: "circle", cx: 8, cy: 11.15, r: 0.66, fill: true },
    ],
  },
  archive: {
    elements: [
      { kind: "rect", x: 1.75, y: 2.75, width: 12.5, height: 3.5, rx: 1 },
      {
        kind: "path",
        d: "M2.75 6.25 L2.75 11.25 C2.75 12.355 3.645 13.25 4.75 13.25 L11.25 13.25 C12.355 13.25 13.25 12.355 13.25 11.25 L13.25 6.25",
      },
      { kind: "line", x1: 6.5, y1: 9, x2: 9.5, y2: 9 },
    ],
  },
  "arrow-up": {
    rotate: -90,
    elements: [
      { kind: "line", x1: 2.75, y1: 8, x2: 13.25, y2: 8 },
      { kind: "path", d: "M8.5 3.25 L13.25 8 L8.5 12.75" },
    ],
  },
  calendar: {
    elements: [
      { kind: "rect", x: 2.25, y: 3.25, width: 11.5, height: 10.5, rx: 2 },
      { kind: "line", x1: 5.5, y1: 1.75, x2: 5.5, y2: 4.5 },
      { kind: "line", x1: 10.5, y1: 1.75, x2: 10.5, y2: 4.5 },
      { kind: "line", x1: 2.25, y1: 7, x2: 13.75, y2: 7 },
    ],
  },
  "chevron-down": {
    rotate: 90,
    elements: [{ kind: "path", d: "M5.875 3.75 L10.125 8 L5.875 12.25" }],
  },
  "chevron-left": {
    rotate: 180,
    elements: [{ kind: "path", d: "M5.875 3.75 L10.125 8 L5.875 12.25" }],
  },
  "chevron-right": {
    elements: [{ kind: "path", d: "M5.875 3.75 L10.125 8 L5.875 12.25" }],
  },
  "chevrons-left": {
    rotate: 180,
    elements: [
      { kind: "path", d: "M3.75 4.5 L7.25 8 L3.75 11.5" },
      { kind: "path", d: "M8.75 4.5 L12.25 8 L8.75 11.5" },
    ],
  },
  "chevrons-right": {
    elements: [
      { kind: "path", d: "M3.75 4.5 L7.25 8 L3.75 11.5" },
      { kind: "path", d: "M8.75 4.5 L12.25 8 L8.75 11.5" },
    ],
  },
  "chevrons-up-down": {
    elements: [
      { kind: "path", d: "M4.75 6 L8 2.75 L11.25 6" },
      { kind: "path", d: "M4.75 10 L8 13.25 L11.25 10" },
    ],
  },
  circle: {
    elements: [{ kind: "circle", cx: 8, cy: 8, r: 6 }],
  },
  "circle-check": {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "path", d: "M5.25 8.25 L7.25 10.25 L10.75 6.25" },
    ],
  },
  "circle-dashed": {
    elements: [
      { kind: "path", d: "M13.88 9.196 A6 6 0 0 1 13.003 11.312" },
      { kind: "path", d: "M11.312 13.003 A6 6 0 0 1 9.196 13.88" },
      { kind: "path", d: "M6.804 13.88 A6 6 0 0 1 4.688 13.003" },
      { kind: "path", d: "M2.997 11.312 A6 6 0 0 1 2.12 9.196" },
      { kind: "path", d: "M2.12 6.804 A6 6 0 0 1 2.997 4.688" },
      { kind: "path", d: "M4.688 2.997 A6 6 0 0 1 6.804 2.12" },
      { kind: "path", d: "M9.196 2.12 A6 6 0 0 1 11.312 2.997" },
      { kind: "path", d: "M13.003 4.688 A6 6 0 0 1 13.88 6.804" },
    ],
  },
  close: {
    elements: [
      { kind: "line", x1: 3.75, y1: 3.75, x2: 12.25, y2: 12.25 },
      { kind: "line", x1: 12.25, y1: 3.75, x2: 3.75, y2: 12.25 },
    ],
  },
  "collapse-diagonal": {
    rotate: 90,
    elements: [
      { kind: "line", x1: 13.25, y1: 2.75, x2: 9.25, y2: 6.75 },
      { kind: "path", d: "M9.25 3.5 L9.25 6.75 L12.5 6.75" },
      { kind: "line", x1: 2.75, y1: 13.25, x2: 6.75, y2: 9.25 },
      { kind: "path", d: "M3.5 9.25 L6.75 9.25 L6.75 12.5" },
    ],
  },
  "compose-note": {
    elements: [
      {
        kind: "path",
        d: "M8 2.25 H4.25 Q2.25 2.25 2.25 4.25 V11.75 Q2.25 13.75 4.25 13.75 H11.75 Q13.75 13.75 13.75 11.75 V9",
      },
      {
        kind: "path",
        d: "M5.776 9.487 L6.208 7.904 C6.236 7.803 6.289 7.711 6.363 7.637 L10.576 3.424 C10.81 3.19 11.19 3.19 11.424 3.424 L12.576 4.576 C12.81 4.81 12.81 5.19 12.576 5.424 L8.363 9.637 C8.289 9.711 8.197 9.764 8.096 9.792 L6.513 10.224 C6.065 10.346 5.654 9.935 5.776 9.487 Z",
      },
    ],
  },
  contrast: {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "path", d: "M8 2 A6 6 0 0 1 8 14 Z" },
    ],
  },
  "dice-roll": {
    elements: [
      {
        kind: "path",
        d: "M8.009 3.721 L12.931 5.039 C13.571 5.211 13.951 5.869 13.779 6.509 L12.461 11.431 C12.289 12.071 11.631 12.451 10.991 12.279 L6.069 10.961 C5.429 10.789 5.049 10.131 5.221 9.491 L6.539 4.569 C6.711 3.929 7.369 3.549 8.009 3.721 Z",
      },
      { kind: "circle", cx: 11.34, cy: 6.94, r: 0.66, fill: true },
      { kind: "circle", cx: 7.66, cy: 9.06, r: 0.66, fill: true },
      { kind: "line", x1: 1.75, y1: 5.5, x2: 3.75, y2: 5.5 },
      { kind: "line", x1: 1.75, y1: 10.5, x2: 3.75, y2: 10.5 },
    ],
  },
  edit: {
    elements: [
      {
        kind: "path",
        d: "M10.957 3.457 L12.543 5.043 C12.933 5.433 12.933 6.067 12.543 6.457 L5.793 13.207 C5.605 13.395 5.351 13.5 5.086 13.5 L2.5 13.5 L2.5 10.914 C2.5 10.649 2.605 10.395 2.793 10.207 L9.543 3.457 C9.933 3.067 10.567 3.067 10.957 3.457 Z",
      },
      { kind: "line", x1: 8.75, y1: 4.25, x2: 11.75, y2: 7.25 },
    ],
  },
  "expand-diagonal": {
    rotate: 90,
    elements: [
      { kind: "line", x1: 9.25, y1: 6.75, x2: 13, y2: 3 },
      { kind: "path", d: "M9.5 3 L13 3 L13 6.5" },
      { kind: "line", x1: 6.75, y1: 9.25, x2: 3, y2: 13 },
      { kind: "path", d: "M3 9.5 L3 13 L6.5 13" },
    ],
  },
  eye: {
    elements: [
      {
        kind: "path",
        d: "M2 8 C3.4 5.2 5.6 3.75 8 3.75 C10.4 3.75 12.6 5.2 14 8 C12.6 10.8 10.4 12.25 8 12.25 C5.6 12.25 3.4 10.8 2 8 Z",
      },
      { kind: "circle", cx: 8, cy: 8, r: 2.25 },
    ],
  },
  "file-copy": {
    elements: [
      {
        kind: "path",
        d: "M4.5 5.5 L6.75 5.5 L9.75 8.5 L9.75 12 C9.75 13.105 8.855 14 7.75 14 L4.5 14 C3.395 14 2.5 13.105 2.5 12 L2.5 7.5 C2.5 6.395 3.395 5.5 4.5 5.5 Z",
      },
      { kind: "path", d: "M6.75 5.5 L6.75 7.5 C6.75 8.052 7.198 8.5 7.75 8.5 L9.75 8.5" },
      {
        kind: "path",
        d: "M5.5 3.25 L5.5 2.625 C5.5 2.28 5.78 2 6.125 2 L10 2 L13.5 5.5 L13.5 10.75 C13.5 11.164 13.164 11.5 12.75 11.5 L12 11.5",
      },
      { kind: "path", d: "M10 2 L10 4.5 C10 5.052 10.448 5.5 11 5.5 L13.5 5.5" },
    ],
  },
  "file-diff": {
    elements: [
      {
        kind: "path",
        d: "M5.25 2 L9 2 L12.75 5.75 L12.75 12 C12.75 13.105 11.855 14 10.75 14 L5.25 14 C4.145 14 3.25 13.105 3.25 12 L3.25 4 C3.25 2.895 4.145 2 5.25 2 Z",
      },
      { kind: "path", d: "M9 2 L9 4.75 C9 5.302 9.448 5.75 10 5.75 L12.75 5.75" },
      { kind: "line", x1: 8, y1: 6.5, x2: 8, y2: 9.5 },
      { kind: "line", x1: 6.5, y1: 8, x2: 9.5, y2: 8 },
      { kind: "line", x1: 6.5, y1: 11.75, x2: 9.5, y2: 11.75 },
    ],
  },
  filter: {
    elements: [
      {
        kind: "path",
        d: "M4.346 3 L11.654 3 C12.495 3 12.96 3.975 12.431 4.629 L9.723 7.975 C9.579 8.153 9.5 8.375 9.5 8.604 L9.5 11.382 C9.5 12.125 8.718 12.609 8.053 12.276 L7.053 11.776 C6.714 11.607 6.5 11.261 6.5 10.882 L6.5 8.604 C6.5 8.375 6.421 8.153 6.277 7.975 L3.569 4.629 C3.04 3.975 3.505 3 4.346 3 Z",
      },
    ],
  },
  folder: {
    elements: [
      {
        kind: "path",
        d: "M4.25 3.25 L5.33 3.25 C5.914 3.25 6.469 3.505 6.849 3.948 L7.151 4.302 C7.531 4.745 8.086 5 8.67 5 L11.75 5 C12.855 5 13.75 5.895 13.75 7 L13.75 10.75 C13.75 11.855 12.855 12.75 11.75 12.75 L4.25 12.75 C3.145 12.75 2.25 11.855 2.25 10.75 L2.25 5.25 C2.25 4.145 3.145 3.25 4.25 3.25 Z",
      },
    ],
  },
  "git-pull-request": {
    elements: [
      { kind: "circle", cx: 4.25, cy: 4, r: 1.75 },
      { kind: "circle", cx: 11.75, cy: 12, r: 1.75 },
      { kind: "line", x1: 4.25, y1: 5.75, x2: 4.25, y2: 14 },
      { kind: "path", d: "M8 4 L9.875 4 C10.911 4 11.75 4.839 11.75 5.875 L11.75 10.25" },
      { kind: "path", d: "M10 2 L8 4 L10 6" },
    ],
  },
  globe: {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "line", x1: 2, y1: 8, x2: 14, y2: 8 },
      { kind: "ellipse", cx: 8, cy: 8, rx: 2.5, ry: 6 },
    ],
  },
  "grid-2x2": {
    elements: [
      { kind: "rect", x: 2.25, y: 2.75, width: 11.5, height: 10.5, rx: 2 },
      { kind: "line", x1: 8, y1: 2.75, x2: 8, y2: 13.25 },
      { kind: "line", x1: 2.25, y1: 8, x2: 13.75, y2: 8 },
    ],
  },
  hammer: {
    elements: [
      {
        kind: "path",
        d: "M7.937 2.757 L13.243 8.063 C13.633 8.453 13.633 9.087 13.243 9.477 L12.357 10.363 C11.967 10.753 11.333 10.753 10.943 10.363 L5.637 5.057 C5.247 4.667 5.247 4.033 5.637 3.643 L6.523 2.757 C6.913 2.367 7.547 2.367 7.937 2.757 Z",
      },
      { kind: "line", x1: 8.29, y1: 7.71, x2: 2.1, y2: 13.9 },
    ],
  },
  inbox: {
    elements: [
      {
        kind: "path",
        d: "M2.31 8.334 L4.011 3.658 C4.154 3.263 4.53 3 4.95 3 L11.05 3 C11.47 3 11.846 3.263 11.989 3.658 L13.69 8.334 C13.73 8.444 13.75 8.56 13.75 8.676 L13.75 12 C13.75 12.552 13.302 13 12.75 13 L3.25 13 C2.698 13 2.25 12.552 2.25 12 L2.25 8.676 C2.25 8.56 2.27 8.444 2.31 8.334 Z",
      },
      {
        kind: "path",
        d: "M2.25 8.5 L5.152 8.5 C5.367 8.5 5.566 8.615 5.673 8.802 L6.327 9.948 C6.434 10.135 6.633 10.25 6.848 10.25 L9.152 10.25 C9.367 10.25 9.566 10.135 9.673 9.948 L10.327 8.802 C10.434 8.615 10.633 8.5 10.848 8.5 L13.75 8.5",
      },
    ],
  },
  "issue-open": {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 5.75 },
      { kind: "circle", cx: 8, cy: 8, r: 1.75 },
    ],
  },
  link: {
    rotate: -45,
    elements: [
      { kind: "path", d: "M7 5.75 H4.75 A2.25 2.25 0 0 0 4.75 10.25 H7" },
      { kind: "path", d: "M9 5.75 H11.25 A2.25 2.25 0 0 1 11.25 10.25 H9" },
      { kind: "line", x1: 5.75, y1: 8, x2: 10.25, y2: 8 },
    ],
  },
  "list-checks": {
    elements: [
      { kind: "path", d: "M2 4.75 L3.5 6.25 L6 3.5" },
      { kind: "path", d: "M2 11.25 L3.5 12.75 L6 10" },
      { kind: "line", x1: 8.25, y1: 3.25, x2: 13.75, y2: 3.25 },
      { kind: "line", x1: 8.25, y1: 6.375, x2: 11.75, y2: 6.375 },
      { kind: "line", x1: 8.25, y1: 9.625, x2: 13.75, y2: 9.625 },
      { kind: "line", x1: 8.25, y1: 12.75, x2: 11.75, y2: 12.75 },
    ],
  },
  "list-plus": {
    elements: [
      { kind: "circle", cx: 2.75, cy: 2.75, r: 0.66, fill: true },
      { kind: "circle", cx: 2.75, cy: 6.25, r: 0.66, fill: true },
      { kind: "circle", cx: 2.75, cy: 9.75, r: 0.66, fill: true },
      { kind: "line", x1: 6, y1: 2.75, x2: 13.25, y2: 2.75 },
      { kind: "line", x1: 6, y1: 6.25, x2: 13.25, y2: 6.25 },
      { kind: "line", x1: 6, y1: 9.75, x2: 7.75, y2: 9.75 },
      { kind: "line", x1: 11.75, y1: 9.75, x2: 11.75, y2: 13.75 },
      { kind: "line", x1: 9.75, y1: 11.75, x2: 13.75, y2: 11.75 },
    ],
  },
  lock: {
    elements: [
      { kind: "path", d: "M5.25 7 V5 A2.75 2.75 0 0 1 10.75 5 V7" },
      { kind: "rect", x: 3, y: 7, width: 10, height: 7, rx: 2 },
      { kind: "line", x1: 8, y1: 9.75, x2: 8, y2: 11.25 },
    ],
  },
  message: {
    elements: [
      {
        kind: "path",
        d: "M4.25 3 L11.75 3 C12.855 3 13.75 3.895 13.75 5 L13.75 9.25 C13.75 10.355 12.855 11.25 11.75 11.25 L7.25 11.25 L4.25 13.75 L4.25 11.25 L3.25 11.25 C2.698 11.25 2.25 10.802 2.25 10.25 L2.25 5 C2.25 3.895 3.145 3 4.25 3 Z",
      },
    ],
  },
  "message-question": {
    elements: [
      {
        kind: "path",
        d: "M4.25 3 L11.75 3 C12.855 3 13.75 3.895 13.75 5 L13.75 9.25 C13.75 10.355 12.855 11.25 11.75 11.25 L7.25 11.25 L4.25 13.75 L4.25 11.25 L3.25 11.25 C2.698 11.25 2.25 10.802 2.25 10.25 L2.25 5 C2.25 3.895 3.145 3 4.25 3 Z",
      },
      { kind: "path", d: "M6.75 6 A1.25 1.25 0 1 1 8.5 7.15 C8.15 7.35 8 7.6 8 7.75" },
      { kind: "circle", cx: 8, cy: 9.5, r: 0.66, fill: true },
    ],
  },
  messages: {
    elements: [
      {
        kind: "path",
        d: "M4 2 L8 2 C9.105 2 10 2.895 10 4 L10 6.25 C10 7.355 9.105 8.25 8 8.25 L5 8.25 L2 10.75 L2 4 C2 2.895 2.895 2 4 2 Z",
      },
      {
        kind: "path",
        d: "M12 5.25 L12.875 5.25 C13.358 5.25 13.75 5.642 13.75 6.125 L13.75 10.75 C13.75 11.302 13.302 11.75 12.75 11.75 L11.75 11.75 L11.75 14 L9 11.75 L7 11.75 C6.724 11.75 6.5 11.526 6.5 11.25 L6.5 10.75",
      },
    ],
  },
  monitor: {
    elements: [
      { kind: "rect", x: 1.75, y: 2.5, width: 12.5, height: 8.5, rx: 2 },
      { kind: "line", x1: 8, y1: 11, x2: 8, y2: 13.5 },
      { kind: "line", x1: 5.25, y1: 13.5, x2: 10.75, y2: 13.5 },
    ],
  },
  "more-horizontal": {
    elements: [
      { kind: "circle", cx: 3, cy: 8, r: 1.25, fill: true },
      { kind: "circle", cx: 8, cy: 8, r: 1.25, fill: true },
      { kind: "circle", cx: 13, cy: 8, r: 1.25, fill: true },
    ],
  },
  "no-entry": {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "line", x1: 4.5, y1: 8, x2: 11.5, y2: 8 },
    ],
  },
  "panel-bottom": {
    elements: [
      { kind: "rect", x: 2.25, y: 2.75, width: 11.5, height: 10.5, rx: 2 },
      { kind: "line", x1: 2.25, y1: 10, x2: 13.75, y2: 10 },
    ],
  },
  plus: {
    elements: [
      { kind: "line", x1: 8, y1: 2.75, x2: 8, y2: 13.25 },
      { kind: "line", x1: 2.75, y1: 8, x2: 13.25, y2: 8 },
    ],
  },
  robot: {
    elements: [
      { kind: "rect", x: 2.5, y: 5.5, width: 11, height: 8.25, rx: 2 },
      { kind: "line", x1: 8, y1: 5.5, x2: 8, y2: 3.25 },
      { kind: "circle", cx: 8, cy: 2.5, r: 0.66, fill: true },
      { kind: "circle", cx: 5.75, cy: 9.5, r: 0.66, fill: true },
      { kind: "circle", cx: 10.25, cy: 9.5, r: 0.66, fill: true },
    ],
  },
  settings: {
    elements: [
      {
        kind: "path",
        d: "M6.663 3.269 L6.631 2.646 C6.611 2.246 6.93 1.91 7.33 1.91 L8.67 1.91 C9.07 1.91 9.389 2.246 9.369 2.646 L9.337 3.269 C9.324 3.532 9.459 3.779 9.686 3.911 L10.698 4.495 C10.926 4.626 11.208 4.619 11.428 4.476 L11.953 4.137 C12.289 3.92 12.739 4.028 12.939 4.375 L13.609 5.535 C13.809 5.882 13.678 6.326 13.322 6.508 L12.766 6.793 C12.532 6.912 12.385 7.153 12.385 7.416 L12.385 8.584 C12.385 8.847 12.532 9.088 12.766 9.207 L13.322 9.492 C13.678 9.674 13.809 10.118 13.609 10.465 L12.939 11.625 C12.739 11.972 12.289 12.08 11.953 11.863 L11.428 11.524 C11.208 11.381 10.926 11.374 10.698 11.505 L9.686 12.089 C9.459 12.221 9.324 12.468 9.337 12.731 L9.369 13.354 C9.389 13.754 9.07 14.09 8.67 14.09 L7.33 14.09 C6.93 14.09 6.611 13.754 6.631 13.354 L6.663 12.731 C6.676 12.468 6.541 12.221 6.314 12.089 L5.302 11.505 C5.074 11.374 4.792 11.381 4.572 11.524 L4.047 11.863 C3.711 12.08 3.261 11.972 3.061 11.625 L2.391 10.465 C2.191 10.118 2.322 9.674 2.678 9.492 L3.234 9.207 C3.468 9.088 3.615 8.847 3.615 8.584 L3.615 7.416 C3.615 7.153 3.468 6.912 3.234 6.793 L2.678 6.508 C2.322 6.326 2.191 5.882 2.391 5.535 L3.061 4.375 C3.261 4.028 3.711 3.92 4.047 4.137 L4.572 4.476 C4.792 4.619 5.074 4.626 5.302 4.495 L6.314 3.911 C6.541 3.779 6.676 3.532 6.663 3.269 Z",
      },
      { kind: "circle", cx: 8, cy: 8, r: 2 },
    ],
  },
  "shield-alert": {
    elements: [
      {
        kind: "path",
        d: "M5 2.5 L11 2.5 A2 2 0 0 1 13 4.5 L13 6.525 C13 8.02 13 9.805 8 14 C3 9.805 3 8.02 3 6.525 L3 4.5 A2 2 0 0 1 5 2.5 Z",
      },
      { kind: "line", x1: 8, y1: 5.25, x2: 8, y2: 8.25 },
      { kind: "circle", cx: 8, cy: 10.6, r: 0.66, fill: true },
    ],
  },
  "shield-check": {
    elements: [
      {
        kind: "path",
        d: "M5 2.5 L11 2.5 A2 2 0 0 1 13 4.5 L13 6.525 C13 8.02 13 9.805 8 14 C3 9.805 3 8.02 3 6.525 L3 4.5 A2 2 0 0 1 5 2.5 Z",
      },
      { kind: "path", d: "M5.5 7.75 L7.25 9.5 L10.5 6.25" },
    ],
  },
  "shield-off": {
    elements: [
      {
        kind: "path",
        d: "M9.68 12.508 C9.194 12.969 8.638 13.465 8 14 C3 9.805 3 8.02 3 6.525 L3 5.621 M5.15 2.5 L11 2.5 A2 2 0 0 1 13 4.5 L13 6.525 C13 7.315 13 8.186 12.262 9.451",
      },
      { kind: "line", x1: 2.75, y1: 2.75, x2: 13.25, y2: 13.25 },
    ],
  },
  sliders: {
    elements: [
      { kind: "line", x1: 2.25, y1: 4.75, x2: 7.75, y2: 4.75 },
      { kind: "circle", cx: 9.75, cy: 4.75, r: 2 },
      { kind: "line", x1: 11.75, y1: 4.75, x2: 13.75, y2: 4.75 },
      { kind: "line", x1: 2.25, y1: 11.25, x2: 4.25, y2: 11.25 },
      { kind: "circle", cx: 6.25, cy: 11.25, r: 2 },
      { kind: "line", x1: 8.25, y1: 11.25, x2: 13.75, y2: 11.25 },
    ],
  },
  stop: {
    elements: [{ kind: "rect", x: 3, y: 3, width: 10, height: 10, rx: 1.5 }],
  },
  terminal: {
    elements: [
      { kind: "rect", x: 1.75, y: 2.75, width: 12.5, height: 10.5, rx: 2 },
      { kind: "path", d: "M4.5 6 L6.5 8 L4.5 10" },
      { kind: "line", x1: 8, y1: 10, x2: 11, y2: 10 },
    ],
  },
  trash: {
    elements: [
      {
        kind: "path",
        d: "M3.5 4.25 L4.105 11.907 C4.187 12.948 5.055 13.75 6.098 13.75 L9.902 13.75 C10.945 13.75 11.813 12.948 11.895 11.907 L12.5 4.25",
      },
      { kind: "line", x1: 2.25, y1: 4.25, x2: 13.75, y2: 4.25 },
      {
        kind: "path",
        d: "M6 4.25 L6 3.25 C6 2.698 6.448 2.25 7 2.25 L9 2.25 C9.552 2.25 10 2.698 10 3.25 L10 4.25",
      },
      { kind: "line", x1: 6.75, y1: 7, x2: 6.75, y2: 11 },
      { kind: "line", x1: 9.25, y1: 7, x2: 9.25, y2: 11 },
    ],
  },
  undo: {
    elements: [
      { kind: "path", d: "M2.75 6.5 H9.75 A3.5 3.5 0 0 1 9.75 13.5 H6.25" },
      { kind: "path", d: "M6 3.25 L2.75 6.5 L6 9.75" },
    ],
  },
  "user-circle": {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "circle", cx: 8, cy: 6.25, r: 2 },
      {
        kind: "path",
        d: "M4.25 12.75 C5.1 11.3 6.45 10.5 8 10.5 C9.55 10.5 10.9 11.3 11.75 12.75",
      },
    ],
  },
  "wifi-off": {
    elements: [
      { kind: "path", d: "M2.05 5.75 A9 9 0 0 1 2.534 5.353 M6.367 3.652 A9 9 0 0 1 13.95 5.75" },
      { kind: "path", d: "M3.53 8.5 A6 6 0 0 1 4.69 7.498 M9.154 6.614 A6 6 0 0 1 12.47 8.5" },
      { kind: "path", d: "M5.56 10.75 A3 3 0 0 1 6.948 9.686" },
      { kind: "circle", cx: 8, cy: 12.5, r: 0.66, fill: true },
      { kind: "line", x1: 2.75, y1: 2.75, x2: 13.25, y2: 13.25 },
    ],
  },
  "x-circle": {
    elements: [
      { kind: "circle", cx: 8, cy: 8, r: 6 },
      { kind: "line", x1: 5.75, y1: 5.75, x2: 10.25, y2: 10.25 },
      { kind: "line", x1: 10.25, y1: 5.75, x2: 5.75, y2: 10.25 },
    ],
  },
} as const satisfies Record<string, UpIconData>;

export type UpIconName = keyof typeof UP_ICONS;
