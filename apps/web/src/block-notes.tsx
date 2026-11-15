import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";
import type { TaskRepositories } from "@organify/storage";

const remote = Symbol("repository");

export function BlockNotes({
  id,
  legacy,
  documents,
}: {
  id: string;
  legacy: string;
  documents: TaskRepositories["documents"];
}) {
  const [session, setSession] = useState<{ doc: Y.Doc; retry: () => void }>();
  const [status, setStatus] = useState("");
  useEffect(() => {
    const doc = new Y.Doc();
    let mounted = true;
    let saving = false;
    let pending: Uint8Array[] = [];
    async function flush() {
      if (saving || !pending.length) return;
      saving = true;
      const batch = pending;
      pending = [];
      if (mounted) setStatus("Guardando…");
      try {
        await documents.append(id, Y.mergeUpdates(batch));
        if (mounted) setStatus("Guardado en este dispositivo.");
      } catch {
        pending = [...batch, ...pending];
        if (mounted)
          setStatus("No se guardaron los cambios. Vuelve a intentarlo.");
        return;
      } finally {
        saving = false;
      }
      if (pending.length) void flush();
    }
    const retry = () => {
      void flush();
    };
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === remote) return;
      pending.push(update);
      retry();
    });
    const stop = documents.subscribe(
      id,
      (state) => {
        if (state) Y.applyUpdate(doc, state, remote);
        setSession((current) =>
          current?.doc === doc ? current : { doc, retry },
        );
      },
      () => setStatus("No se pudo leer la nota."),
    );
    return () => {
      mounted = false;
      stop();
      doc.destroy();
    };
  }, [documents, id]);

  return (
    <section className="mt-4 grid gap-2">
      <h3 className="text-sm font-semibold">Nota enriquecida</h3>
      {legacy && (
        <details className="text-sm">
          <summary>Nota de texto anterior</summary>
          <p className="whitespace-pre-wrap break-words">{legacy}</p>
        </details>
      )}
      {session && <Editor doc={session.doc} />}
      <p role="status" className="text-sm text-muted">
        {status}
      </p>
      {status.startsWith("No se guardaron") && (
        <button type="button" className="nav-link" onClick={session?.retry}>
          Reintentar guardado
        </button>
      )}
    </section>
  );
}

function Editor({ doc }: { doc: Y.Doc }) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: doc }),
      ],
      editorProps: {
        attributes: {
          class:
            "block-note min-h-32 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          "aria-label": "Nota enriquecida",
        },
      },
    },
    [doc],
  );
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      undo: editor?.can().undo() ?? false,
      redo: editor?.can().redo() ?? false,
      paragraph: editor?.isActive("paragraph") ?? false,
      heading: editor?.isActive("heading", { level: 2 }) ?? false,
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      bullets: editor?.isActive("bulletList") ?? false,
      numbering: editor?.isActive("orderedList") ?? false,
      quote: editor?.isActive("blockquote") ?? false,
      code: editor?.isActive("codeBlock") ?? false,
    }),
  });
  if (!editor) return null;
  const actions = [
    {
      label: "Deshacer",
      path: "m9 5-6 6 6 6M3 11h11a5 5 0 0 1 5 5v3",
      disabled: !state?.undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "Rehacer",
      path: "m15 5 6 6-6 6m6-6H10a5 5 0 0 0-5 5v3",
      disabled: !state?.redo,
      run: () => editor.chain().focus().redo().run(),
    },
    {
      label: "Párrafo",
      path: "M20 4h-9a4 4 0 0 0 0 8h2m0-8v16m4-16v16",
      pressed: state?.paragraph,
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Título",
      path: "M3 5v14m9-14v14M3 12h9m4-2a2.5 2.5 0 0 1 5 0c0 2-5 3.5-5 6h5",
      pressed: state?.heading,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Negrita",
      path: "M6 4h7a4 4 0 0 1 0 8H6m0-8v16h8a4 4 0 0 0 0-8H6",
      pressed: state?.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Cursiva",
      path: "M19 4h-9m4 16H5m10-16L9 20",
      pressed: state?.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Viñetas",
      path: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
      pressed: state?.bullets,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numeración",
      path: "M10 6h10m-10 6h10m-10 6h10M3 5l2-1v5m-2 0h4m-4 5a2 2 0 0 1 4 0c0 1.5-4 3-4 5h4",
      pressed: state?.numbering,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Cita",
      path: "M10 11H4v-1a5 5 0 0 1 5-5m-5 6v6h6v-6m10 0h-6v-1a5 5 0 0 1 5-5m-5 6v6h6v-6",
      pressed: state?.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Código",
      path: "m8 6-6 6 6 6m8-12 6 6-6 6m-2-14-4 16",
      pressed: state?.code,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];
  return (
    <div className="rounded-lg border border-line bg-paper">
      <div
        className="flex flex-wrap gap-1 rounded-t-lg border-b border-line bg-background p-1.5"
        role="group"
        aria-label="Formato de la nota"
      >
        {actions.map(({ label, path, pressed, disabled, run }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-panel focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-tint aria-pressed:text-primary"
            onClick={run}
          >
            <svg
              aria-hidden="true"
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={path} />
            </svg>
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
