// Up.computer web push service worker. It shows agent alerts sent by the relay
// and opens their thread when one is clicked. It caches nothing and handles no
// fetches. The app registers it only when the user turns on notifications for
// this device, and never in the desktop app.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Relay deep links use the mobile route /threads/<environmentId>/<threadId>.
function threadFromPath(path) {
  const match = /^\/threads\/([^/?#]+)\/([^/?#]+)$/.exec(typeof path === "string" ? path : "");
  if (!match) return null;
  try {
    return { environmentId: decodeURIComponent(match[1]), threadId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : null;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  // Every push must show a notification: Safari revokes the subscription of a
  // site that receives pushes silently.
  const title = typeof data.title === "string" && data.title ? data.title : "Up.computer";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/apple-touch-icon.png",
    data: { thread: threadFromPath(data.path) },
  };
  // The in-app notification for a thread uses the same tag, so the two replace
  // each other instead of stacking.
  if (typeof data.tag === "string" && data.tag) options.tag = data.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const thread = event.notification.data ? event.notification.data.thread : null;
  const path = thread
    ? `/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`
    : "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // The open app routes in place instead of reloading.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Client.postMessage takes no target origin.
        if (thread) open.postMessage({ type: "upcomputer:open-thread", ...thread });
        return;
      }
      await self.clients.openWindow(new URL(path, self.location.origin).href);
    })(),
  );
});
