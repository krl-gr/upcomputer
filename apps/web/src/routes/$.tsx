import { createFileRoute, notFound, useLocation } from "@tanstack/react-router";

import { ProductRoutePage } from "../product/ProductSlots";
import { WEB_PRODUCT } from "../product/productEntry";
import { findExperimentalWebRoute } from "../product/WebProduct";

function ProductRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return <ProductRoutePage pathname={pathname} />;
}

// Pages of the web product's features. A path no feature owns stays not found.
export const Route = createFileRoute("/$")({
  beforeLoad: ({ location }) => {
    if (findExperimentalWebRoute(WEB_PRODUCT, location.pathname) === undefined) throw notFound();
  },
  component: ProductRouteView,
});
