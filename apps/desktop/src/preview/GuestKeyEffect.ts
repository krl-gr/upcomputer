/**
 * An unfocused guest gets keys through sendInputEvent, and its page may skip the key's edit.
 * For keys whose effect on a text field can be read back, compare the field before and after.
 * Only unmodified keys: an error mid-press would leave Playwright holding the modifier down.
 */
const WATCHED_KEYS: Record<string, { readonly edits: boolean; readonly forward: boolean }> = {
  Backspace: { edits: true, forward: false },
  Delete: { edits: true, forward: true },
  ArrowLeft: { edits: false, forward: false },
  ArrowRight: { edits: false, forward: true },
};

/** sendInputEvent can reach the page after a later evaluation; a key this late counts as lost. */
const KEY_ARRIVAL_MS = 2_000;

const PROBE = `globalThis[Symbol.for("t3.previewKeyEffect")]`;

export const KEY_NO_EFFECT_MESSAGE =
  "The key had no effect: the browser tab does not have focus, so the page did not apply it. Change the field with type and clear=true, or with preview_evaluate.";

const evaluate = async (debuggee: Electron.Debugger, expression: string) => {
  const reply = (await debuggee.sendCommand("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as { readonly result?: { readonly value?: unknown } };
  return reply.result?.value;
};

/** Starts watching the focused text field; true only when the key must change it. */
export const watchKeyEffect = async (
  debuggee: Electron.Debugger,
  focusedDocument: string,
  params: Record<string, unknown>,
): Promise<boolean> => {
  const watched = typeof params["key"] === "string" ? WATCHED_KEYS[params["key"]] : undefined;
  if (!watched || (params["type"] !== "keyDown" && params["type"] !== "rawKeyDown")) return false;
  if (typeof params["modifiers"] === "number" && params["modifiers"] !== 0) return false;
  // A collapsed caret at the edge the key moves toward has nothing to change, so it is not checked.
  const started = await evaluate(
    debuggee,
    `(() => {
      const doc = ${focusedDocument};
      let field = doc?.activeElement ?? null;
      while (field?.shadowRoot?.activeElement) field = field.shadowRoot.activeElement;
      if (field?.tagName !== "INPUT" && field?.tagName !== "TEXTAREA") return false;
      let start, end;
      try { start = field.selectionStart; end = field.selectionEnd; } catch { return false; }
      if (typeof start !== "number" || typeof end !== "number") return false;
      if (${watched.edits} ? field.disabled || field.readOnly
          : doc.defaultView.getComputedStyle(field).direction !== "ltr") return false;
      if (start === end && (${watched.forward} ? end >= field.value.length : start === 0)) return false;
      const probe = { field, value: field.value, start, end, events: {}, arrived: () => {} };
      const record = (event) => {
        probe.events[event.type] ??= event;
        if (event.type === "keydown") probe.arrived();
      };
      for (const type of ["keydown", "beforeinput", "input"]) doc.addEventListener(type, record, true);
      probe.stop = () => {
        for (const type of ["keydown", "beforeinput", "input"]) doc.removeEventListener(type, record, true);
      };
      ${PROBE} = probe;
      return true;
    })()`,
  );
  return started === true;
};

/** True when the key changed the field, or the page took the key or the edit itself. */
export const keyHadEffect = async (debuggee: Electron.Debugger): Promise<boolean> =>
  (await evaluate(
    debuggee,
    `(async () => {
      const probe = ${PROBE};
      if (!probe) return true;
      if (!probe.events.keydown) {
        await new Promise((resolve) => {
          probe.arrived = resolve;
          setTimeout(resolve, ${KEY_ARRIVAL_MS});
        });
      }
      // The edit runs after keydown's listeners, in the same task; a new task sees its outcome.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (${PROBE} === probe) delete ${PROBE};
      probe.stop();
      const { field, events } = probe;
      return !field.isConnected || field.getRootNode().activeElement !== field ||
        field.value !== probe.value || field.selectionStart !== probe.start ||
        field.selectionEnd !== probe.end || events.input !== undefined ||
        events.keydown?.defaultPrevented === true || events.beforeinput?.defaultPrevented === true;
    })()`,
  )) !== false;
