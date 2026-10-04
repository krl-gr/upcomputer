# Access from other devices

This release supports UpComputer Connect to the backend bundled with Up.computer Desktop. It does not ship
an official remote/headless server or an SSH/npm bootstrap flow.

## Use UpComputer Connect with Desktop

1. Open Up.computer Desktop on the machine that owns your projects.
2. Open **Settings** → **Connections**.
3. Under the local backend controls, enable UpComputer Connect and follow the pairing flow.
4. Keep the Desktop application running while another paired client uses that environment.

UpComputer Connect installs no npm server package. It links clients to the backend already bundled with the
Desktop app.

## Pairing links

Pairing codes and share links are available only in the client that created them, while its
Connections page remains open. After you leave the page or reload it, create a new link to share.
Other clients can see the active link's name, scopes, and expiry, and can revoke it if they have
access management permission.

## Existing saved environments

Up.computer preserves existing remote and SSH environment records. They remain visible so you can
inspect, disconnect, or remove them without deleting project or server data. This release does not
claim support for reconnecting an SSH-launched server, updating a remote server, or creating a new
headless environment.

The public npm package named `t3` belongs to upstream T3 Code and is not an official Up.computer
remote installation path. A future distribution decision may re-enable remote setup with an
official identity and delivery mechanism.
