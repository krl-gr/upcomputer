# Mobile notifications

Sign in to T3 Connect, link your environments, and enable **Device Notifications** in **Settings → Notifications** to receive alerts when an agent finishes, fails, needs approval, or asks for input. Tap a notification to open its thread. Your environment must have agent activity publishing enabled.

Enable **Ongoing Agent Activity** on Android or **Live Activity Updates** on iOS to follow work without opening the app. Finished results remain visible for up to 15 minutes. You can dismiss an Android activity card without disabling alerts; turn off ongoing activity in Settings to stop future cards.

Ordinary alerts stay quiet while the mobile app is in the foreground. Ongoing activity continues to update. Viewing a thread on another device does not silence your phone's alerts.

Android notifications require Android 7.0 or newer and Google Play services. Android 16 and newer can promote ongoing activity to a Live Update, subject to system settings and device support. Other devices show a regular ongoing notification. Android 7's battery-saving modes can delay removal of expired cards.

## In a browser or on iPhone without the app

The web app can show the same alerts while it is closed: in Chrome, Edge or Firefox on a computer
or Android, and in Safari on iPhone or iPad with iOS 16.4 or newer.

On iPhone or iPad, notifications work only in the web app added to the Home Screen:

1. Open Up.computer in Safari, tap **Share**, then **Add to Home Screen**.
2. Open Up.computer from the new Home Screen icon, not from a Safari tab.
3. Sign in to UpComputer Connect under **Settings → Connections**.
4. In **Settings → General**, choose **Enable on this device** next to **Notifications on this
   device**, then allow notifications.

In other browsers, start at step 3. Each browser is enabled separately, and the same button turns
it off. Signing out of UpComputer Connect also turns it off on that device. A device that is offline
for more than 4 hours misses the alerts sent meanwhile. The desktop app uses its own notifications
and does not show this option.

## Permissions and requirements

Notification permission and Android notification channels are controlled in system Settings. Background delivery requires T3 Connect; a direct or Tailscale connection alone does not enable push notifications. The mobile app does not need to maintain a connection to your environment. Force-stopping the Android app in system Settings prevents push delivery until you open it again.
