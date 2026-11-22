import { useState } from "react";
import {
  letterKey,
  shortcutActions,
  type ShortcutAction,
  type WorkspacePreferences,
} from "./workspace-shortcuts";

export function ShortcutSettings({ bindings, assign }: WorkspacePreferences) {
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<ShortcutAction>();
  const actions = shortcutActions.filter(({ label }) =>
    label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="grid gap-3">
      <input
        type="search"
        className="field w-full"
        aria-label="Buscar acciones"
        placeholder="Buscar acciones"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="text-xs text-muted">
        Selecciona una asignación y pulsa una letra. Si ya está en uso, se
        reasignará a la acción elegida.
      </p>
      {actions.length ? (
        <ul className="divide-y divide-line">
          {actions.map(({ id, label }) => {
            const key = bindings[id];
            const active = recording === id;
            const value = key?.toUpperCase() ?? "Sin asignar";
            return (
              <li key={id} className="flex items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1 wrap-anywhere">{label}</span>
                <button
                  type="button"
                  className="topbar-button shrink-0 px-2"
                  aria-label={`${label}, ${active ? "pulsa una letra" : value}`}
                  aria-pressed={active}
                  onClick={() => setRecording(active ? undefined : id)}
                  onBlur={() => setRecording(undefined)}
                  onKeyDown={(event) => {
                    if (!active || event.key === "Tab") return;
                    event.preventDefault();
                    if (event.key === "Escape") {
                      setRecording(undefined);
                      return;
                    }
                    if (
                      event.nativeEvent.isComposing ||
                      event.repeat ||
                      event.ctrlKey ||
                      event.altKey ||
                      event.metaKey
                    )
                      return;
                    const letter = letterKey(event.key);
                    if (letter) {
                      assign(id, letter);
                      setRecording(undefined);
                    }
                  }}
                >
                  {active ? (
                    "Pulsa una letra"
                  ) : key ? (
                    <kbd>{value}</kbd>
                  ) : (
                    value
                  )}
                </button>
                <button
                  type="button"
                  className="topbar-button size-9 shrink-0 disabled:opacity-40"
                  aria-label={`Desasignar ${label.toLowerCase()}`}
                  disabled={!key}
                  onClick={() => assign(id, null)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No hay acciones que coincidan.</p>
      )}
    </div>
  );
}
