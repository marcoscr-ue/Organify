import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
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
      <h3 className="text-sm font-semibold">Nota en bloques</h3>
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
          class: "block-note field min-h-32",
          "aria-label": "Nota en bloques",
        },
      },
    },
    [doc],
  );
  if (!editor) return null;
  const actions = [
    {
      label: "Párrafo",
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Título",
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    { label: "Negrita", run: () => editor.chain().focus().toggleBold().run() },
    {
      label: "Cursiva",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Viñetas",
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numeración",
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Cita",
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Código",
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    { label: "Deshacer", run: () => editor.chain().focus().undo().run() },
    { label: "Rehacer", run: () => editor.chain().focus().redo().run() },
  ];
  return (
    <>
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Formato de la nota"
      >
        {actions.map(({ label, run }) => (
          <button key={label} type="button" className="nav-link" onClick={run}>
            {label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </>
  );
}
