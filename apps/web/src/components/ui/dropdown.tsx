import { useEffect, useRef, useState, type ComponentProps } from "react";

export function Dropdown({
  onToggle,
  onKeyDown,
  ...props
}: ComponentProps<"details">) {
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      ) {
        details.current?.removeAttribute("open");
      }
    }
    // Capture also catches clicks on controls that stop event propagation.
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open]);

  return (
    <details
      {...props}
      ref={details}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.currentTarget.open
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    />
  );
}
