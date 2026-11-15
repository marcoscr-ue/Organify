import { useState, type FormEvent } from "react";

export function TaskProperties({
  values,
  save,
}: {
  values: Record<string, unknown>;
  save: (
    name: string,
    value: string | number | boolean | null,
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState("text");
  const [busy, setBusy] = useState(false);

  async function change(key: string, next: string | number | boolean | null) {
    setBusy(true);
    try {
      if (await save(key, next)) {
        setName("");
        setValue("");
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    const next =
      kind === "number"
        ? Number(value)
        : kind === "yes"
          ? true
          : kind === "no"
            ? false
            : value;
    if (typeof next === "number" && !Number.isFinite(next)) return;
    void change(name, next);
  }

  return (
    <section className="mt-4 grid gap-2 text-sm">
      <h3 className="font-semibold">Propiedades</h3>
      {Object.entries(values).map(([key, current]) => (
        <div key={key} className="flex flex-wrap items-center gap-2 break-all">
          <span>
            {key}:{" "}
            {current === true
              ? "Sí"
              : current === false
                ? "No"
                : String(current)}
          </span>
          <button
            type="button"
            className="nav-link"
            disabled={busy}
            onClick={() => {
              setName(key);
              setKind(
                current === true
                  ? "yes"
                  : current === false
                    ? "no"
                    : typeof current === "number"
                      ? "number"
                      : "text",
              );
              setValue(String(current));
            }}
          >
            Editar
          </button>
          <button
            type="button"
            className="nav-link"
            disabled={busy}
            onClick={() => void change(key, null)}
          >
            Quitar
          </button>
        </div>
      ))}
      <form className="grid gap-2" onSubmit={submit}>
        <input
          className="field min-w-0"
          aria-label="Nombre de propiedad"
          placeholder="Nombre de propiedad"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <select
          className="field"
          aria-label="Tipo de propiedad"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="text">Texto</option>
          <option value="number">Número</option>
          <option value="yes">Sí</option>
          <option value="no">No</option>
        </select>
        {(kind === "text" || kind === "number") && (
          <input
            className="field min-w-0"
            aria-label="Valor de propiedad"
            placeholder="Valor"
            type={kind}
            step={kind === "number" ? "any" : undefined}
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <button type="submit" className="nav-link" disabled={busy}>
          Guardar propiedad
        </button>
      </form>
    </section>
  );
}
