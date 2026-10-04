import { createFileRoute, notFound, useLocation } from "@tanstack/react-router";

import { ProductSettingsPage } from "../product/ProductSlots";
import { WEB_PRODUCT } from "../product/productEntry";
import { findExperimentalWebSettingsPage } from "../product/WebProduct";

function ProductSettingsRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return <ProductSettingsPage pathname={pathname} />;
}

// Settings sections of the web product's features; core sections match first.
export const Route = createFileRoute("/settings/$section")({
  beforeLoad: ({ location }) => {
    if (findExperimentalWebSettingsPage(WEB_PRODUCT, location.pathname) === undefined) {
      throw notFound();
    }
  },
  component: ProductSettingsRouteView,
});
