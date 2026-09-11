# Quick start

The supported Up.computer product for this release is the local Desktop application. Install the
signed Desktop build from the official download page, open it, and choose a local project. The app
starts its bundled backend automatically; no server or CLI package needs to be installed.

## Develop from source

```bash
# Web and server with hot reload
vp run dev

# Desktop with hot reload
vp run dev:desktop

# Desktop development on an isolated port set
T3CODE_DEV_INSTANCE=feature-xyz vp run dev:desktop

# Build the Desktop application
vp run build:desktop

# Build a shareable macOS .dmg (arm64 by default)
vp run dist:desktop:dmg
```

There is no official Up.computer npm CLI or headless-server distribution in this release. The npm
package named `t3` belongs to upstream T3 Code and must not be used to install or update an
Up.computer server.
