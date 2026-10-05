"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SchoolResource } from "./api";
import Markdown from "./Markdown";
import styles from "./Workspace.module.css";
export default function NoteEditor({
  resource,
  onSaved,
  images = [],
}: {
  resource: SchoolResource;
  onSaved: (resource: SchoolResource) => void;
  images?: SchoolResource[];
}) {
  const [markdown, setMarkdown] = useState(
    String(resource.data.markdown ?? ""),
  );
  const [status, setStatus] = useState("Saved");
  const [preview, setPreview] = useState(false);
  const [revisions, setRevisions] = useState<
    { id: string; version: number; created_at: string }[]
  >([]);
  const version = useRef(resource.version);
  const saved = useRef(markdown);
  const saving = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(markdown);
  latest.current = markdown;
  const callback = useRef(onSaved);
  callback.current = onSaved;
  useEffect(() => {
    version.current = resource.version;
  }, [resource.version]);
  const saveNow = useCallback(
    async function saveNote(): Promise<void> {
      if (
        !resource.editable ||
        saving.current ||
        latest.current === saved.current
      )
        return;
      const snapshot = latest.current;
      saving.current = true;
      setStatus("Saving…");
      try {
        const next = await api<SchoolResource>(
          `classes/resources/${resource.id}`,
          "PATCH",
          { data: { markdown: snapshot }, expectedVersion: version.current },
        );
        version.current = next.version;
        saved.current = snapshot;
        callback.current(next);
        setStatus("Saved");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Save failed");
        return;
      } finally {
        saving.current = false;
      }
      if (latest.current !== snapshot) await saveNote();
    },
    [resource.id, resource.editable],
  );
  useEffect(() => {
    if (markdown === saved.current) return;
    setStatus("Unsaved");
    const timer = setTimeout(() => void saveNow(), 900);
    return () => clearTimeout(timer);
  }, [markdown, saveNow]);
  useEffect(
    () => () => {
      void saveNow();
    },
    [saveNow],
  );
  function insert(before: string, after = "") {
    const area = editor.current;
    if (!area) return;
    const start = area.selectionStart,
      end = area.selectionEnd;
    setMarkdown(
      markdown.slice(0, start) +
        before +
        markdown.slice(start, end) +
        after +
        markdown.slice(end),
    );
    setTimeout(() => {
      area.focus();
      area.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  }
  async function history() {
    try {
      setRevisions(await api(`classes/resources/${resource.id}/revisions`));
    } catch (error) {
      setStatus(String(error));
    }
  }
  async function restore(revisionId: string) {
    try {
      const next = await api<SchoolResource>(
        `classes/resources/${resource.id}/restore-revision`,
        "POST",
        { revisionId },
      );
      saved.current = String(next.data.markdown);
      version.current = next.version;
      setMarkdown(saved.current);
      onSaved(next);
      setStatus("Restored");
      setRevisions([]);
    } catch (error) {
      setStatus(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <button onClick={() => setPreview(!preview)}>
          {preview ? "Edit source" : "Preview"}
        </button>
        <button onClick={history}>Version history</button>
        {resource.editable && (
          <button onClick={() => void saveNow()}>Save now</button>
        )}
        <span className={styles.muted} role="status">
          {status}
        </span>
      </div>
      {resource.editable && !preview && (
        <div className={styles.toolbar}>
          {[
            ["Heading", "# ", ""],
            ["Bold", "**", "**"],
            ["Italic", "*", "*"],
            ["Underline", "__", "__"],
            ["List", "\n- ", ""],
            ["Numbered", "\n1. ", ""],
            ["Checkbox", "\n- [ ] ", ""],
            ["Quote", "\n> ", ""],
            ["Code", "`", "`"],
            ["Block", "\n```\n", "\n```"],
            ["Link", "[", "](https://example.com)"],
            [
              "Table",
              "\n| Column | Column |\n| --- | --- |\n| Value | Value |\n",
              "",
            ],
            ["Equation", "$", "$"],
            ["Display equation", "\n$$\n", "\n$$\n"],
            ["Rule", "\n---\n", ""],
          ].map(([label, before, after]) => (
            <button key={label} onClick={() => insert(before, after)}>
              {label}
            </button>
          ))}
          <select
            aria-label="Insert uploaded image"
            value=""
            onChange={(event) => {
              const image = images.find(
                (file) => file.id === event.target.value,
              );
              if (image)
                insert(`![${image.title}](/api/classes/files/${image.id})`);
            }}
          >
            <option value="">Insert uploaded image…</option>
            {images.map((image) => (
              <option key={image.id} value={image.id}>
                {image.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {preview || !resource.editable ? (
        <div className={styles.preview}>
          <Markdown value={markdown} />
        </div>
      ) : (
        <textarea
          aria-label="Markdown note"
          ref={editor}
          className={styles.editor}
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key === "b" || key === "i" || key === "u") {
              event.preventDefault();
              const marker = key === "b" ? "**" : key === "i" ? "*" : "__";
              insert(marker, marker);
            } else if (key === "s") {
              event.preventDefault();
              void saveNow();
            } else if (event.shiftKey && key === "p") {
              event.preventDefault();
              setPreview(true);
            }
          }}
        />
      )}
      {resource.editable && (
        <span className={styles.muted}>
          Ctrl/⌘ B, I, U format selection · Ctrl/⌘ S saves · Ctrl/⌘ Shift P
          previews. Inline math: $x^2$; display math: $$ on separate lines.
        </span>
      )}
      {revisions.length > 0 && (
        <div className={styles.card}>
          <strong>Previous versions</strong>
          {revisions.map((revision) => (
            <div className={styles.row} key={revision.id}>
              <span>
                v{revision.version} ·{" "}
                {new Date(revision.created_at).toLocaleString()}
              </span>
              {resource.editable && (
                <button onClick={() => restore(revision.id)}>Restore</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
