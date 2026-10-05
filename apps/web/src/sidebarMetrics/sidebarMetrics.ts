/**
 * The spacing of every UpComputer part of the sidebar: the nav slot, the
 * Projects and Threads section headers, the Projects rows and the compact
 * thread rows. Upstream's Search row (`SidebarThreadHeader`) is the reference:
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
 */
export const SIDEBAR_MENU_SCOPE =
  "[--sidebar-row-content-inset:--spacing(2)] [--sidebar-control-gap:--spacing(2)]";

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
 * Gap between sections (Search, the nav rows, Projects, Threads), on top of
 * each of ours: `--sidebar-content-inset`, the one inset upstream keeps
 * between stacked sidebar groups (`SidebarContent`).
 */
export const SIDEBAR_SECTION_GAP = "pt-(--sidebar-content-inset)";

/** From a section header to its first row: the row gap, as if the header were a row. */
export const SIDEBAR_SECTION_HEADER_GAP = "pt-1";

/**
 * The Threads header closes upstream's fixed sidebar header, whose bottom
 * inset (`--sidebar-content-inset`) separates it from the thread list. This
 * pulls the list up to `SIDEBAR_SECTION_HEADER_GAP` (`--spacing(1)`) instead.
 */
export const SIDEBAR_FIXED_HEADER_END_GAP =
  "-mb-[calc(var(--sidebar-content-inset)-var(--spacing))]";
