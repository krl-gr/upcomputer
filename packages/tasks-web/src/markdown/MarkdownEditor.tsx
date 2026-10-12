import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  type LucideIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareCodeIcon,
  Table2Icon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { readLocalApi } from "../../../../apps/web/src/localApi.ts";
import { cn } from "../../../../apps/web/src/lib/utils.ts";
import { configureBlockHandle } from "./markdownBlockHandle.tsx";
import {
  applySlashCommand,
  MarkdownEditorSession,
  refreshView,
  type SlashCommandId,
  type SlashMenuState,
} from "./markdownEditorCore.ts";
import "./markdownEditor.css";

export interface MarkdownEditorProps {
  readonly value: string;
  /** Called on every edit, never for opening, focusing or scrolling the text. */
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly placeholder?: string;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

const SLASH_COMMANDS: ReadonlyArray<{
  readonly id: SlashCommandId;
  readonly label: string;
  readonly keywords: string;
  readonly icon: LucideIcon;
}> = [
  { id: "text", label: "Text", keywords: "paragraph p", icon: PilcrowIcon },
  { id: "h1", label: "Heading 1", keywords: "title", icon: Heading1Icon },
  { id: "h2", label: "Heading 2", keywords: "", icon: Heading2Icon },
  { id: "h3", label: "Heading 3", keywords: "", icon: Heading3Icon },
  { id: "bullet", label: "Bullet list", keywords: "ul", icon: ListIcon },
  { id: "ordered", label: "Numbered list", keywords: "ordered ol", icon: ListOrderedIcon },
  { id: "task", label: "Checklist", keywords: "task todo checkbox", icon: ListTodoIcon },
  { id: "quote", label: "Quote", keywords: "blockquote", icon: QuoteIcon },
  { id: "divider", label: "Divider", keywords: "hr rule", icon: MinusIcon },
  { id: "table", label: "Table", keywords: "grid", icon: Table2Icon },
  { id: "code", label: "Code block", keywords: "snippet", icon: SquareCodeIcon },
];

interface OpenMenu {
  readonly state: SlashMenuState;
  /** Opened from the block handle's "+": the command goes into a new block below. */
  readonly insertBelow: boolean;
}

/**
 * Wande's Milkdown editor, always editable and styled like the rendered
 * markdown around it: markdown shortcuts while typing, Cmd+B and Cmd+I, a `/`
 * menu, a block handle, clickable task checkboxes and Cmd+click links. How it
 * follows `value` is `MarkdownEditorSession`'s. Load it through
 * `LazyMarkdownEditor`.
 */
export default function MarkdownEditor(props: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<MarkdownEditorSession | null>(null);
  const propsRef = useRef(props);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const items = useMemo(() => {
    const query = menu?.state.query.toLowerCase() ?? "";
    return SLASH_COMMANDS.filter((command) =>
      `${command.label} ${command.keywords}`.toLowerCase().includes(query),
    );
  }, [menu]);
  const runCommand = (id: SlashCommandId) => {
    const session = sessionRef.current;
    if (!session || !menu) return;
    setMenu(null);
    applySlashCommand(session.editor, menu.state, id, menu.insertBelow);
  };
  const latestRef = useRef({ menu, items, activeIndex, runCommand });

  useLayoutEffect(() => {
    propsRef.current = props;
    latestRef.current = { menu, items, activeIndex, runCommand };
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    const openMenu = (state: SlashMenuState | null, insertBelow: boolean) => {
      if (disposed) return;
      setActiveIndex(0);
      setMenu(state ? { state, insertBelow } : null);
    };
    const session = new MarkdownEditorSession(
      root,
      {
        value: () => propsRef.current.value,
        onChange: (value) => propsRef.current.onChange(value),
        onEdit: () => setMenu((open) => (open?.insertBelow ? null : open)),
        onBlur: () => {
          setMenu(null);
          propsRef.current.onBlur?.();
        },
        onSlashMenu: (state) => openMenu(state, false),
        onKey: (event) => {
          const latest = latestRef.current;
          if (!latest.menu) return false;
          if (event.key === "Escape") {
            setMenu(null);
            return true;
          }
          if (latest.items.length === 0) return false;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((latest.activeIndex + step + latest.items.length) % latest.items.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const command = latest.items[latest.activeIndex] ?? latest.items[0];
            if (command) latest.runCommand(command.id);
            return true;
          }
          return false;
        },
        onOpenLink: (href) => void readLocalApi()?.shell.openExternal(href),
        isEditable: () => propsRef.current.disabled !== true,
        placeholder: () => propsRef.current.placeholder ?? "",
        ariaLabel: () => propsRef.current.ariaLabel,
      },
      (ctx) => configureBlockHandle(ctx, (state) => openMenu(state, true)),
      propsRef.current.autoFocus,
    );
    sessionRef.current = session;
    return () => {
      disposed = true;
      sessionRef.current = null;
      session.destroy();
    };
  }, []);

  // After every render: a new value is shown or kept per the session's rules,
  // and a new disabled state, label or placeholder reaches the view.
  const viewPropsRef = useRef("");
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.valueChanged();
    const viewProps = `${props.disabled === true}\0${props.placeholder}\0${props.ariaLabel}`;
    if (viewProps === viewPropsRef.current) return;
    viewPropsRef.current = viewProps;
    void session.ready.then(() => refreshView(session.editor));
  });

  return (
    <div className={cn("markdown-editor", props.className)}>
      <div ref={rootRef} />
      {menu && items.length > 0
        ? createPortal(
            <div
              role="listbox"
              aria-label="Insert block"
              className="fixed z-[200] w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ left: menu.state.left, top: menu.state.top }}
              onMouseDown={(event) => event.preventDefault()}
            >
              {items.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runCommand(command.id)}
                >
                  <command.icon className="size-4 text-muted-foreground" />
                  {command.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
