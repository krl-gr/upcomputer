import { Navigate } from "@tanstack/react-router";

/** Keeps links to the former Browser settings path working. */
function BrowserUseLegacyRedirect() {
  return <Navigate to={"/settings/browser-use" as never} replace />;
}

export default BrowserUseLegacyRedirect;
