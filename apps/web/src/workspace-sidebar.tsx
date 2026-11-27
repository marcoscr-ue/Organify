import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import sidebarLogo from "../../../organify_logo_sidebar_beta.png";
import { ReleaseNotes } from "./app-overlays";
import { InterfaceIcon } from "./interface-icon";

const compactViewport = window.matchMedia("(width < 48rem)");

function subscribe(onChange: () => void) {
  compactViewport.addEventListener("change", onChange);
  return () => compactViewport.removeEventListener("change", onChange);
}

function isCompactViewport() {
  return compactViewport.matches;
}

export function useCompactNavigation() {
  return useSyncExternalStore(subscribe, isCompactViewport);
}

export function WorkspaceSidebar({
  compact,
  drawer,
  children,
  onHome,
  onCollapse,
}: {
  compact: boolean;
  drawer: RefObject<HTMLDialogElement | null>;
  children: ReactNode;
  onHome: () => void;
  onCollapse: () => void;
}) {
  const sidebar = (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <button
          type="button"
          onClick={onHome}
          aria-label="Ir a Inicio"
          className="min-w-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent md:w-full"
        >
          <img
            src={sidebarLogo}
            alt="Organify"
            width={2172}
            height={724}
            className="sidebar-logo h-auto w-40 object-contain md:mb-3 md:w-full md:max-w-53"
          />
        </button>
        {!compact && (
          <button
            type="button"
            aria-label="Contraer barra lateral"
            title="Contraer barra lateral"
            className="sidebar-collapse-toggle"
            onClick={onCollapse}
          >
            <InterfaceIcon name="chevron" className="size-4 rotate-90" />
          </button>
        )}
        {compact && (
          <button
            type="button"
            autoFocus
            aria-label="Cerrar menú de navegación"
            className="nav-link grid size-11 shrink-0 place-items-center p-0"
            onClick={() => drawer.current?.close()}
          >
            <InterfaceIcon name="close" className="size-5" />
          </button>
        )}
      </div>
      <div className="sidebar-sections">{children}</div>
      <div className="sidebar-footer">
        <ReleaseNotes />
      </div>
    </aside>
  );

  if (!compact) return sidebar;

  return (
    <dialog
      id="mobile-navigation"
      ref={drawer}
      aria-label="Menú de navegación"
      className="mobile-navigation"
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {sidebar}
    </dialog>
  );
}
