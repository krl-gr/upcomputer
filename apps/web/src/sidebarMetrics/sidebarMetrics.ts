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

/**
 * Icon size: `--sidebar-icon-size` (18px; upstream's Search icon was `size-4`). `SidebarMenuButton`'s icons, the sidebar toggle and the Search icon
 * read the variable too, so changing it resizes every sidebar icon.
 */
export const SIDEBAR_ICON_SIZE = "size-(--sidebar-icon-size)";

/** A section header's chevron: a fixed 14px, not a row icon. */
export const SIDEBAR_SECTION_CHEVRON_SIZE = "size-3.5";

/**
 * A bot's face slot in a sidebar row: the icon size, so names line up with other
 * labels. The face overflows it at 1.25 times the icon size, a shape character at
 * 1.5 (`BotAvatar` draws it a fifth larger). Its pixel `size` still picks its detail.
 */
export const SIDEBAR_BOT_FACE_SLOT =
  "flex size-(--sidebar-icon-size) shrink-0 items-center justify-center [&>.bot-portrait]:size-[calc(var(--sidebar-icon-size)*1.25)]! [&>svg.cbc]:size-[calc(var(--sidebar-icon-size)*1.5)] [&_.bot-portrait-status]:size-full";

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
 * Our menus space rows by `SidebarMenu`'s `gap-1`. A compact thread row sits
 * in upstream's thread list instead, which spaces rows by `gap-px`, so this
 * adds the 3px left over below the row.
 */
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
 * The icon column's Threads header copy closes the sidebar's header group, and
 * this pulls what follows it up by `--sidebar-content-inset` less the row gap;
 * `adaptiveSidebar.css` sizes the gap to the footer with it.
 */
export const SIDEBAR_FIXED_HEADER_END_GAP =
  "-mb-[calc(var(--sidebar-content-inset)-var(--spacing))]";

/**
 * In `SidebarProvider`'s and the sidebar's style: moves upstream's sidebar
 * toggle (`SidebarControl` in `AppSidebarLayout.tsx`, and the phone sheet's
 * own toggle in `SidebarChromeHeader`) so its icon starts where the row icons
 * do. The toggle sits at `--workspace-controls-left` plus its own
 * `ml-px`, and centres a `--sidebar-icon-size` icon in a `--workspace-titlebar-control-size`
 * button; a row icon starts at `--sidebar-content-inset` plus
 * `SIDEBAR_ROW_INSET`. The macOS desktop app sets the variable after this, to
 * clear the traffic lights. Collapsed page titles follow the toggle through
 * `--workspace-titlebar-content-left`.
 */
export const SIDEBAR_TOGGLE_ALIGNMENT = {
  "--workspace-controls-left":
    "calc(env(safe-area-inset-left) + var(--sidebar-content-inset) + var(--spacing) * 2 - (var(--workspace-titlebar-control-size) - var(--sidebar-icon-size)) / 2 - 1px)",
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
 * Its icon is a fixed 16px, smaller than the row icons, set here so every action's icon matches.
 */
export const SIDEBAR_ACTION_BUTTON = `inline-flex size-5 shrink-0 [&>svg]:size-4 cursor-pointer items-center justify-center rounded-md ${SIDEBAR_DIM_TEXT} outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`;
