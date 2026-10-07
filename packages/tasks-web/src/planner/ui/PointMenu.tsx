import { useMemo, type ReactNode } from "react";

import { Menu, MenuPopup } from "../../../../../apps/web/src/components/ui/menu.tsx";

export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/** Where a menu opened from a button sits: under the button's centre, as wande. */
export function pointBelow(element: Element): MenuPoint {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom };
}

/**
 * A `ui/menu` popup at a screen point: a right-click or a three-dots button.
 * One menu per list or column, opened for the item that asked.
 */
export function PointMenu(props: {
  readonly point: MenuPoint | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const { point } = props;
  const anchor = useMemo(
    () =>
      point
        ? {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: point.x, y: point.y, width: 0, height: 0 }),
          }
        : null,
    [point],
  );
  return (
    <Menu
      open={point !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MenuPopup anchor={anchor} align="start" side="bottom">
        {props.children}
      </MenuPopup>
    </Menu>
  );
}
