import { useRef, type MouseEvent, type PointerEvent } from "react";

export function isDeleteSwipe(dx: number, dy: number) {
  return dx >= 72 && dx > 1.5 * Math.abs(dy);
}

export function useTaskSwipe(enabled: boolean, remove: (id: string) => void) {
  const start = useRef<{ id: string; pointer: number; x: number; y: number }>(
    undefined,
  );
  const suppressClick = useRef(false);

  function clear(event: PointerEvent) {
    if (start.current?.pointer === event.pointerId) start.current = undefined;
  }

  if (!enabled) return {};
  return {
    onPointerDown(event: PointerEvent<HTMLUListElement>) {
      start.current = undefined;
      suppressClick.current = false;
      if (
        event.pointerType !== "touch" ||
        !event.isPrimary ||
        !(event.target instanceof Element)
      )
        return;
      const control = event.target.closest(
        "button, input, select, summary, a, .action-popover",
      );
      if (control && !control.hasAttribute("data-swipe-handle")) return;
      const row = event.target.closest<HTMLElement>("[data-task-shortcut]");
      const id = row?.dataset.taskShortcut;
      if (id)
        start.current = {
          id,
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
    },
    onPointerUp(event: PointerEvent<HTMLUListElement>) {
      const gesture = start.current;
      clear(event);
      if (
        gesture?.pointer !== event.pointerId ||
        !isDeleteSwipe(event.clientX - gesture.x, event.clientY - gesture.y)
      )
        return;
      suppressClick.current = true;
      remove(gesture.id);
    },
    onPointerCancel: clear,
    onLostPointerCapture: clear,
    onClickCapture(event: MouseEvent<HTMLUListElement>) {
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
