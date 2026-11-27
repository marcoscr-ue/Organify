import { useRef, type ComponentProps } from "react";

function outsideDialog(
  dialog: HTMLDialogElement,
  point: { clientX: number; clientY: number },
) {
  const bounds = dialog.getBoundingClientRect();
  return (
    point.clientX < bounds.left ||
    point.clientX > bounds.right ||
    point.clientY < bounds.top ||
    point.clientY > bounds.bottom
  );
}

// Send the same cancel event as Escape so each window keeps its own cleanup
// and can prevent closing while an operation is in progress.
export function Dialog({
  onPointerDown,
  onClick,
  ...props
}: ComponentProps<"dialog">) {
  const pressedOutside = useRef(false);

  return (
    <dialog
      {...props}
      onPointerDown={(event) => {
        pressedOutside.current =
          event.button === 0 &&
          event.target === event.currentTarget &&
          outsideDialog(event.currentTarget, event);
        onPointerDown?.(event);
      }}
      onClick={(event) => {
        const dismiss =
          pressedOutside.current &&
          event.target === event.currentTarget &&
          outsideDialog(event.currentTarget, event);
        pressedOutside.current = false;
        if (!dismiss) {
          onClick?.(event);
          return;
        }
        const dialog = event.currentTarget;
        const cancel = new Event("cancel", { cancelable: true });
        if (dialog.dispatchEvent(cancel)) dialog.close();
      }}
    />
  );
}
