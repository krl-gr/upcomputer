# Computer use backend contract and VM clicks

Managed backend: `open-computer-use@0.3.5` (pinned in
`packages/computer-use-server/package.json`, `apps/server/package.json`, the
lockfile, and `ManagedComputerUseSidecar.ts`).

## Why coordinates must not use auto

The native `auto` click path can select an AXWindow for a canvas/VM and then press an unrelated descendant button. This reproduced as Tart closing and stopping its guest after a click inside the guest Terminal, not on a window control.

UpComputer maps coordinate clicks to explicit `app_post` by default. macOS VM/canvas left clicks can select `coordinateMethod: "sky_click"`; this is the upstream background window delivery method, not a fork. Neither path uses AX descendant selection. `auto`/`global` cannot be selected through our coordinate method argument. Older/custom backends without the requested method fail before dispatch, rather than silently falling back.

Coordinates refer to **pixels in the returned app screenshot**, not host-global screen coordinates. Element targets and coordinate targets are mutually exclusive. `sky_click` supports left single/double click only. Right/middle coordinate clicks still use `app_post` and need visual verification.

## Contract

- All tools except list_apps require `app`.
- Numeric element indexes are serialized to native string identifiers.
- button/double map to mouse_button/click_count.
- scroll amount maps to pages; scroll requires an element.
- Secondary actions require the exact action name returned in the accessibility tree.
- Drag supports app plus coordinates, not element IDs or configurable duration.
- Unsupported windowId/includeScreenshot fields are not forwarded; native get_app_state returns the key window and screenshot.
- type_text requires a focused accessible editable element. Tart does not expose guest fields through host AX; this operation is refused rather than sent blindly. Individual press_key calls were verified inside the guest.

## Checks

```sh
cd packages/computer-use-server
vp test run
UPCOMPUTER_TEST_NATIVE_COMPUTER_USE=1 vp test run src/computerUse/ComputerUseNativeContract.test.ts
tsgo --noEmit
```

The opt-in native contract test queries the installed binary's tools/list. It does not click, type, or access provider accounts. Run it when upgrading the dependency; mocked sessions do not establish backend compatibility.

## Real-backend verification (2026-09-17)

Against a macOS guest in Tart:

- PASS: app_post coordinate click no longer shuts down Tart, but did not focus the guest Terminal. Not counted as successful guest interaction.
- PASS: explicit sky_click focused the guest Terminal; guest menu changed from Finder to Terminal and VM stayed running.
- PASS: normalized press_key calls entered and executed `echo cu` in guest Terminal.
- PASS: normalized type_text appended text to a dedicated host TextEdit smoke document; confirmed in AX state and a screenshot.
- LIMITATION: type_text inside Tart returns the native focused-editable-element error, as expected for its opaque AX surface.
- NOT PASSED: subsequent host TextEdit Cmd+S returned cgWindowNotFound; the smoke file on disk did not contain the appended text. Do not infer successful saving from the typing test.
- NOT TESTED: Windows/Linux behavior, native drag-and-drop, right/middle VM clicks.
