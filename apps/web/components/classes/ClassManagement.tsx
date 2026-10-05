"use client";
import { useState } from "react";
import { api, type SchoolClass } from "./api";
import styles from "./Workspace.module.css";
export default function ClassManagement({
  schoolClass,
  onUpdated,
  onDeleted,
}: {
  schoolClass: SchoolClass;
  onUpdated: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(schoolClass.name);
  const [color, setColor] = useState(schoolClass.color);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function rename() {
    setBusy(true);
    setMessage("");
    try {
      await api(`classes/${schoolClass.id}`, "PATCH", { name, color });
      await onUpdated();
      setMessage("Class updated");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Class update failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      await api(`classes/${schoolClass.id}`, "DELETE", { confirmation });
      await onDeleted();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Class deletion failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.card}>
      <h3>Manage class</h3>
      <label>
        Class name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Class color
        <input
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
      </label>
      <div className={styles.row}>
        <button disabled={busy || !name.trim()} onClick={rename}>
          Save class changes
        </button>
        <button disabled={busy} onClick={() => setDeleting(!deleting)}>
          {deleting ? "Cancel deletion" : "Delete class…"}
        </button>
      </div>
      {deleting && (
        <div className={styles.stack}>
          <p>
            This permanently deletes this class, all its notes, folders,
            assignments and uploads. Recipients lose access to shared resources
            in this class.
          </p>
          <label>
            Type DELETE {schoolClass.name} to confirm
            <input
              aria-label="Class deletion confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <button
            disabled={busy || confirmation !== `DELETE ${schoolClass.name}`}
            onClick={remove}
          >
            Permanently delete class
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
