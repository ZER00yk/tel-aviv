"use client";
import { useEffect, useState } from "react";
import { api, type SchoolResource } from "./api";
import NoteEditor from "./NoteEditor";
import { Flashcards, Quiz } from "./Study";
import styles from "./Workspace.module.css";
function Assignment({
  resource,
  onSaved,
  available,
}: {
  resource: SchoolResource;
  onSaved: (resource: SchoolResource) => void;
  available: SchoolResource[];
}) {
  const [data, setData] = useState(resource.data);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<
    {
      id: string;
      previous_status: string | null;
      status: string;
      due_at: string | null;
      created_at: string;
    }[]
  >([]);
  useEffect(() => {
    void api<typeof history>(`classes/resources/${resource.id}/history`)
      .then(setHistory)
      .catch((error) => setMessage(String(error)));
  }, [resource.id, resource.version]);
  async function save() {
    try {
      onSaved(
        await api(`classes/resources/${resource.id}`, "PATCH", {
          expectedVersion: resource.version,
          data,
        }),
      );
      setMessage("Assignment saved");
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      <label>
        Description
        <textarea
          disabled={!resource.editable}
          value={String(data.description ?? "")}
          onChange={(event) =>
            setData({ ...data, description: event.target.value })
          }
        />
      </label>
      <label>
        Work notes
        <textarea
          aria-label="Assignment notes"
          disabled={!resource.editable}
          value={String(data.notes ?? "")}
          onChange={(event) => setData({ ...data, notes: event.target.value })}
        />
      </label>
      <div className={styles.row}>
        <label>
          Status
          <select
            disabled={!resource.editable}
            value={String(data.status ?? "not-started")}
            onChange={(event) =>
              setData({ ...data, status: event.target.value })
            }
          >
            <option value="not-started">Not Started</option>
            <option value="in-progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label>
          Priority
          <select
            disabled={!resource.editable}
            value={String(data.priority ?? "normal")}
            onChange={(event) =>
              setData({ ...data, priority: event.target.value })
            }
          >
            <option>low</option>
            <option>normal</option>
            <option>high</option>
          </select>
        </label>
        <label>
          Due date
          <input
            disabled={!resource.editable}
            type="datetime-local"
            value={
              data.dueDate
                ? new Date(
                    new Date(String(data.dueDate)).getTime() -
                      new Date(String(data.dueDate)).getTimezoneOffset() *
                        60_000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
            onChange={(event) =>
              setData({
                ...data,
                dueDate: event.target.value
                  ? new Date(event.target.value).toISOString()
                  : null,
              })
            }
          />
        </label>
      </div>
      <label>
        Links, one per line
        <textarea
          disabled={!resource.editable}
          value={((data.links ?? []) as string[]).join("\n")}
          onChange={(event) =>
            setData({
              ...data,
              links: event.target.value.split("\n").filter(Boolean),
            })
          }
        />
      </label>
      {((data.links ?? []) as string[]).map((link) => (
        <a key={link} href={link} rel="noopener noreferrer" target="_blank">
          {link}
        </a>
      ))}
      {((data.attachments ?? []) as string[]).map((attachment) => (
        <a key={attachment} href={`/api/classes/files/${attachment}`}>
          Download attachment
        </a>
      ))}
      {resource.editable && (
        <>
          <strong>Attach files from this class</strong>
          {available
            .filter(
              (file) =>
                file.kind === "file" && file.class_id === resource.class_id,
            )
            .map((file) => (
              <label key={file.id}>
                <span>
                  <input
                    type="checkbox"
                    checked={((data.attachments ?? []) as string[]).includes(
                      file.id,
                    )}
                    onChange={(event) =>
                      setData({
                        ...data,
                        attachments: event.target.checked
                          ? [...((data.attachments ?? []) as string[]), file.id]
                          : ((data.attachments ?? []) as string[]).filter(
                              (id) => id !== file.id,
                            ),
                      })
                    }
                  />
                  {file.title}
                </span>
              </label>
            ))}
          <button className={styles.primary} onClick={save}>
            Save assignment
          </button>
        </>
      )}
      <span role="status">{message}</span>
      <details>
        <summary>Completion and deadline history ({history.length})</summary>
        {history.map((event) => (
          <p key={event.id}>
            {new Date(event.created_at).toLocaleString()} ·{" "}
            {event.previous_status
              ? `${event.previous_status} → `
              : "Created: "}
            {event.status}
            {event.due_at
              ? ` · due ${new Date(event.due_at).toLocaleString()}`
              : " · no deadline"}
          </p>
        ))}
      </details>
    </div>
  );
}
function Share({
  resource,
  refresh,
}: {
  resource: SchoolResource;
  refresh: () => void;
}) {
  const [username, setUsername] = useState("");
  const [permission, setPermission] = useState("view");
  const [error, setError] = useState("");
  async function grant() {
    try {
      await api(`classes/resources/${resource.id}/share`, "POST", {
        username,
        permission,
      });
      setUsername("");
      refresh();
    } catch (error) {
      setError(String(error));
    }
  }
  async function revoke(userId: string) {
    try {
      await api(`classes/resources/${resource.id}/share/${userId}`, "DELETE");
      refresh();
    } catch (error) {
      setError(String(error));
    }
  }
  return (
    <div className={styles.card}>
      <strong>Share this {resource.kind}</strong>
      <p className={styles.muted}>
        Private by default. A folder grant includes its contents. Recipients
        must sign in.
      </p>
      <div className={styles.row}>
        <input
          aria-label="Recipient username"
          placeholder="Existing username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <select
          aria-label="Sharing permission"
          value={permission}
          onChange={(event) => setPermission(event.target.value)}
        >
          <option value="view">Can view</option>
          <option value="edit">Can edit</option>
        </select>
        <button onClick={grant}>Share</button>
      </div>
      {resource.shares?.map((share) => (
        <div className={styles.row} key={share.user_id}>
          <span>
            {share.username} · {share.permission}
          </span>
          <button onClick={() => revoke(share.user_id)}>Revoke</button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export default function ResourceEditor({
  resource,
  onSaved,
  onDelete,
  refresh,
  owner,
  available,
}: {
  resource: SchoolResource;
  onSaved: (resource: SchoolResource) => void;
  onDelete: () => void;
  refresh: () => void;
  owner: boolean;
  available: SchoolResource[];
}) {
  const [sharing, setSharing] = useState(false);
  const [title, setTitle] = useState(resource.title);
  const [message, setMessage] = useState("");
  async function rename() {
    try {
      onSaved(
        await api(`classes/resources/${resource.id}`, "PATCH", {
          expectedVersion: resource.version,
          title,
        }),
      );
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.header}>
        <div>
          <p className={styles.muted}>
            {resource.kind} · {owner ? "Private workspace" : "Shared with you"}{" "}
            · v{resource.version}
          </p>
          <h2>{resource.title}</h2>
        </div>
        <div className={styles.row}>
          {owner && (
            <>
              <button onClick={() => setSharing(!sharing)}>Sharing</button>
              <button onClick={onDelete}>Move to trash</button>
            </>
          )}
        </div>
      </div>
      {resource.editable && (
        <div className={styles.row}>
          <input
            aria-label="Resource title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button onClick={rename}>Rename</button>
        </div>
      )}
      {owner && (
        <label>
          Move to folder
          <select
            value={resource.parent_id ?? ""}
            onChange={async (event) => {
              try {
                onSaved(
                  await api(`classes/resources/${resource.id}`, "PATCH", {
                    expectedVersion: resource.version,
                    parentId: event.target.value || null,
                  }),
                );
              } catch (error) {
                setMessage(String(error));
              }
            }}
          >
            <option value="">Class root</option>
            {available
              .filter(
                (folder) =>
                  folder.kind === "folder" &&
                  folder.id !== resource.id &&
                  folder.class_id === resource.class_id,
              )
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {message && <p role="alert">{message}</p>}
      {sharing && owner && <Share resource={resource} refresh={refresh} />}
      {resource.kind === "note" && (
        <NoteEditor
          resource={resource}
          onSaved={onSaved}
          images={available.filter(
            (file) =>
              file.kind === "file" &&
              String(file.data.mime).startsWith("image/") &&
              file.class_id === resource.class_id,
          )}
        />
      )}
      {resource.kind === "assignment" && (
        <Assignment
          resource={resource}
          onSaved={onSaved}
          available={available}
        />
      )}
      {resource.kind === "flashcards" && (
        <Flashcards
          resource={resource}
          onSaved={onSaved}
          images={available.filter(
            (file) =>
              file.kind === "file" &&
              file.class_id === resource.class_id &&
              String(file.data.mime).startsWith("image/"),
          )}
        />
      )}
      {resource.kind === "quiz" && (
        <Quiz resource={resource} onSaved={onSaved} />
      )}
      {resource.kind === "file" && (
        <div className={styles.card}>
          <p>
            {String(resource.data.name)} ·{" "}
            {(Number(resource.data.size) / 1024).toFixed(1)} KB
          </p>
          <a href={`/api/classes/files/${resource.id}`}>Download file</a>
          <p className={styles.muted}>
            This download checks your permission each time.
          </p>
        </div>
      )}
      {resource.kind === "link" && (
        <a
          href={String(resource.data.url)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {String(resource.data.url)}
        </a>
      )}
      {resource.kind === "folder" && (
        <p className={styles.muted}>
          Open this folder from the resource browser to manage its contents.
        </p>
      )}
    </div>
  );
}
