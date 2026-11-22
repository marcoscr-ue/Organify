import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { desktopWindow } from "./desktop-windows";

export const shortcutActions = [
  { id: "edit", label: "Editar tarea o rutina", key: "e" },
  { id: "rename", label: "Renombrar tarea o rutina", key: "r" },
  { id: "delete", label: "Borrar tarea o rutina", key: "d" },
  { id: "create", label: "Crear tarea o rutina", key: "n" },
] as const;

export type ShortcutAction = (typeof shortcutActions)[number]["id"];
export type ShortcutBindings = Record<ShortcutAction, string | null>;
const shortcutsKey = "organify.workspace-shortcuts";
const swipeKey = "organify.swipe-to-delete";
const mobilePointer = "(hover: none) and (pointer: coarse)";

export function letterKey(key: string) {
  const letter = key.toLowerCase();
  return /^\p{L}$/u.test(letter) ? letter : undefined;
}

export function remapShortcut(
  bindings: ShortcutBindings,
  action: ShortcutAction,
  key: string | null,
): ShortcutBindings {
  const next = { ...bindings, [action]: key };
  if (key) {
    for (const { id } of shortcutActions) {
      if (id !== action && next[id] === key) next[id] = null;
    }
  }
  return next;
}

function readShortcuts(): ShortcutBindings {
  let saved: Partial<ShortcutBindings> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(shortcutsKey) ?? "null");
  } catch {
    // Fall back to the defaults if the saved preferences cannot be read.
  }
  const bindings: ShortcutBindings = {
    edit: null,
    rename: null,
    delete: null,
    create: null,
  };
  for (const { id, key } of shortcutActions) {
    const value = saved?.[id];
    bindings[id] =
      value === null
        ? null
        : (typeof value === "string" && letterKey(value)) || key;
  }
  return bindings;
}

function readSwipe() {
  return localStorage.getItem(swipeKey) === "true";
}

function isMobile() {
  return (
    !desktopWindow &&
    (Capacitor.isNativePlatform() || window.matchMedia(mobilePointer).matches)
  );
}

export function useWorkspacePreferences() {
  const [mobile, setMobile] = useState(isMobile);
  const [bindings, setBindings] = useState(readShortcuts);
  const [swipeToDelete, setSwipeToDelete] = useState(readSwipe);

  useEffect(() => {
    const media = window.matchMedia(mobilePointer);
    const updateMobile = () => setMobile(isMobile());
    function updateStorage(event: StorageEvent) {
      if (event.key === shortcutsKey || event.key === null)
        setBindings(readShortcuts());
      if (event.key === swipeKey || event.key === null)
        setSwipeToDelete(readSwipe());
    }
    media.addEventListener("change", updateMobile);
    window.addEventListener("storage", updateStorage);
    return () => {
      media.removeEventListener("change", updateMobile);
      window.removeEventListener("storage", updateStorage);
    };
  }, []);

  function assign(action: ShortcutAction, key: string | null) {
    const next = remapShortcut(readShortcuts(), action, key);
    localStorage.setItem(shortcutsKey, JSON.stringify(next));
    setBindings(next);
  }

  function changeSwipe(enabled: boolean) {
    localStorage.setItem(swipeKey, String(enabled));
    setSwipeToDelete(enabled);
  }

  const keyboardShortcuts =
    Boolean(desktopWindow) || !Capacitor.isNativePlatform();
  return {
    mobile,
    keyboardShortcuts,
    bindings,
    assign,
    swipeToDelete,
    changeSwipe,
  };
}

export type WorkspacePreferences = ReturnType<typeof useWorkspacePreferences>;

export function useWorkspaceShortcuts(
  bindings: ShortcutBindings | undefined,
  run: (action: ShortcutAction) => boolean | void,
) {
  useEffect(() => {
    if (!bindings) return;
    function handleKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input, textarea, select, [role='textbox']"))) ||
        document.querySelector("dialog[open]")
      )
        return;

      const key = letterKey(event.key);
      const action = shortcutActions.find(({ id }) => key === bindings?.[id]);
      if (action && run(action.id)) event.preventDefault();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [bindings, run]);
}
