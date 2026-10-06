/**
 * The spacing of every UpComputer part of the sidebar: the nav slot, the
 * Projects and Threads section headers, the Projects rows, the compact
 * thread rows and the sidebar toggle; their text tone; and the look of their
 * icon buttons. Upstream's Search row (`SidebarThreadHeader`) is the reference:
 * each value is upstream's, read off that row or the `components/ui/sidebar`
 * primitives, so our rows line up with it and upstream's own components keep
 * their spacing. Our parts take their spacing from here only, and
 * `sidebarAlignment.test.tsx` measures the result in a real browser.
 *
 * Tailwind only sees literal class names, so a value that two forms need
 * (a class and a variable) is written out in both; the test keeps them equal.
 */

/** Row height: the Search row's `h-8`, also `SidebarMenuButton`'s default size. */
export const SIDEBAR_ROW_HEIGHT = "h-8";

/**
 * Horizontal inset of a row's content: the Search row's `px-2`, hard-coded
 * there by upstream. `SidebarMenuButton` insets by `--sidebar-row-content-inset`
 * (0.625rem) instead; `SIDEBAR_MENU_SCOPE` sets that to this value.
 */
export const SIDEBAR_ROW_INSET = "px-2";
/** The end side of `SIDEBAR_ROW_INSET`, for a row whose action sits at its end. */
export const SIDEBAR_ROW_INSET_END = "pe-2";

/** Icon size: the Search icon's `size-4`, also `SidebarMenuButton`'s default icon size. */
export const SIDEBAR_ICON_SIZE = "size-4";

/** Gap from icon to text: the Search row's `gap-2`, the value of `--sidebar-control-gap`. */
export const SIDEBAR_ICON_GAP = "gap-2";

/**
 * On the container of our `SidebarMenuButton` rows. The button reads its inset
 * and icon gap from these variables, so this gives it the Search row's inset
 * (`SIDEBAR_ROW_INSET`) and gap (`SIDEBAR_ICON_GAP`) without restyling it.
 * It also gives the resting buttons `SIDEBAR_ROW_TEXT` in place of their
 * `font-medium` and dimmer `/80`: `:where()` keeps those rules as specific as
 * the button's own resting classes, so its hover and active states still win.
 */
export const SIDEBAR_MENU_SCOPE =
  "[--sidebar-row-content-inset:--spacing(2)] [--sidebar-control-gap:--spacing(2)] [&_:where([data-sidebar=menu-button])]:font-normal [&_:where([data-sidebar=menu-button])]:text-sidebar-muted-foreground";

/**
 * Gap between rows: `SidebarMenu`'s `gap-1`, which our menus get from it.
 * A compact thread row sits in upstream's thread list instead, which spaces
 * rows by `gap-px`; `SIDEBAR_LIST_ROW_SPACING` adds the 3px left over.
 */
export const SIDEBAR_ROW_GAP = "gap-1";

/** A compact row in upstream's thread list: `SIDEBAR_ROW_GAP` less the list's `gap-px`, below it. */
export const SIDEBAR_LIST_ROW_SPACING = "pb-0.75";

/** `contain-intrinsic-size` of a compact row in upstream's list: `SIDEBAR_ROW_HEIGHT`. */
export const SIDEBAR_LIST_ROW_INTRINSIC_SIZE = "[contain-intrinsic-size:auto_--spacing(8)]";

/**
 * Gap between sections (the nav rows, Projects, Threads), on top of each of
 * ours: `--sidebar-content-inset`, the one inset upstream keeps
 * between stacked sidebar groups (`SidebarContent`).
 */
export const SIDEBAR_SECTION_GAP = "pt-(--sidebar-content-inset)";

/** From a section header to its first row: the row gap, as if the header were a row. */
export const SIDEBAR_SECTION_HEADER_GAP = "pt-1";

/**
 * Above the nav rows: the row gap, so they continue upstream's Search row,
 * which ends its header container without spacing of its own.
 */
export const SIDEBAR_AFTER_SEARCH_GAP = "pt-1";

/**
 * The Threads header closes upstream's fixed sidebar header, whose bottom
 * inset (`--sidebar-content-inset`) separates it from the thread list. This
 * pulls the list up to `SIDEBAR_SECTION_HEADER_GAP` (`--spacing(1)`) instead.
 */
export const SIDEBAR_FIXED_HEADER_END_GAP =
  "-mb-[calc(var(--sidebar-content-inset)-var(--spacing))]";

/**
 * In `SidebarProvider`'s style: moves upstream's sidebar toggle
 * (`SidebarControl` in `AppSidebarLayout.tsx`) so its icon starts where the
 * row icons do. The toggle sits at `--workspace-controls-left` plus its own
 * `ml-px`, and centres a `size-4` icon in a `--workspace-titlebar-control-size`
 * button; a row icon starts at `--sidebar-content-inset` plus
 * `SIDEBAR_ROW_INSET`. The macOS desktop app sets the variable after this, to
 * clear the traffic lights. Collapsed page titles follow the toggle through
 * `--workspace-titlebar-content-left`.
 */
export const SIDEBAR_TOGGLE_ALIGNMENT = {
  "--workspace-controls-left":
    "calc(env(safe-area-inset-left) + var(--sidebar-content-inset) + var(--spacing) * 2 - (var(--workspace-titlebar-control-size) - var(--spacing) * 4) / 2 - 1px)",
} as const;

/**
 * Text of a row at rest (nav, Projects and thread rows): the Search row's
 * `text-sidebar-muted-foreground`, at regular weight. The Up.computer theme
 * sets that token to V1's row tone. `SIDEBAR_MENU_SCOPE` gives it to our
 * `SidebarMenuButton` rows.
 */
export const SIDEBAR_ROW_TEXT = "font-normal text-sidebar-muted-foreground";

/**
 * On upstream's Search row: its input at `SIDEBAR_ROW_TEXT`'s weight. The
 * `input` in the selector outranks `SidebarInput`'s own `font-medium` rule.
 */
export const SIDEBAR_SEARCH_ROW_TEXT = "[&_input[data-slot=input]]:font-normal";

/** Section titles and icon buttons at rest: one step dimmer than `SIDEBAR_ROW_TEXT`. */
export const SIDEBAR_DIM_TEXT = "text-sidebar-muted-foreground/80";

/**
 * An icon button in one of our sidebar rows or section headers (New thread,
 * Add project, a row's "…"). Dim like a section title, bright only while the
 * pointer is on the button itself or it has keyboard focus. Each place keeps
 * its own reveal rule (hidden until its row or header is hovered or focused).
 */
export const SIDEBAR_ACTION_BUTTON = `inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md ${SIDEBAR_DIM_TEXT} outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring`;
