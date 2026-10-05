"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type SchoolResource } from "./api";
import styles from "./Workspace.module.css";
interface Board {
  assignments: SchoolResource[];
  classes: { id: string; name: string }[];
  folders: { id: string; title: string }[];
}
export function assignmentState(resource: SchoolResource, now = Date.now()) {
  if (resource.data.status === "done") return "completed";
  if (
    resource.data.dueDate &&
    new Date(String(resource.data.dueDate)).getTime() < now
  )
    return resource.data.status === "not-started" ? "missing" : "overdue";
  return "upcoming";
}
export default function AssignmentBoard({
  onOpen,
}: {
  onOpen: (resource: SchoolResource) => void;
}) {
  const [board, setBoard] = useState<Board | null>(null),
    [error, setError] = useState("");
  const [filter, setFilter] = useState("open"),
    [sort, setSort] = useState("due"),
    [group, setGroup] = useState("class"),
    [classId, setClassId] = useState("");
  useEffect(() => {
    void api<Board>("classes/assignments")
      .then(setBoard)
      .catch((error) => setError(String(error)));
  }, []);
  const groups = useMemo(() => {
    const now = Date.now();
    const resources = (board?.assignments ?? [])
      .filter((resource) => {
        if (classId && resource.class_id !== classId) return false;
        const state = assignmentState(resource, now);
        if (filter === "all") return true;
        if (filter === "open") return state !== "completed";
        if (filter === "overdue")
          return state === "overdue" || state === "missing";
        return state === filter;
      })
      .sort((a, b) => {
        if (sort === "title") return a.title.localeCompare(b.title);
        if (sort === "priority")
          return (
            (a.data.priority === "high"
              ? 0
              : a.data.priority === "normal"
                ? 1
                : 2) -
              (b.data.priority === "high"
                ? 0
                : b.data.priority === "normal"
                  ? 1
                  : 2) || a.title.localeCompare(b.title)
          );
        return (
          (a.data.dueDate
            ? new Date(String(a.data.dueDate)).getTime()
            : Infinity) -
            (b.data.dueDate
              ? new Date(String(b.data.dueDate)).getTime()
              : Infinity) || a.title.localeCompare(b.title)
        );
      });
    const next = new Map<string, SchoolResource[]>();
    for (const resource of resources) {
      const className =
        board?.classes.find((item) => item.id === resource.class_id)?.name ??
        "Class";
      const label =
        group === "none"
          ? "Assignments"
          : group === "folder"
            ? `${className} / ${board?.folders.find((item) => item.id === resource.parent_id)?.title ?? "Class root"}`
            : className;
      next.set(label, [...(next.get(label) ?? []), resource]);
    }
    return Array.from(next.entries());
  }, [board, filter, sort, group, classId]);
  return (
    <section className={styles.stack} aria-label="Assignment planner">
      <h2>Assignment planner</h2>
      <p className={styles.muted}>
        Missing means a past deadline with work not started. Completed work
        stays in your history.
      </p>
      <div className={styles.row}>
        <label>
          Filter
          <select
            aria-label="Assignment filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["open", "all", "upcoming", "overdue", "missing", "completed"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Sort
          <select
            aria-label="Assignment sort"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="title">Title</option>
          </select>
        </label>
        <label>
          Group
          <select
            aria-label="Assignment grouping"
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="class">Class</option>
            <option value="folder">Class and folder</option>
            <option value="none">No groups</option>
          </select>
        </label>
        <label>
          Class
          <select
            aria-label="Planner class"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
          >
            <option value="">All classes</option>
            {board?.classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {groups.map(([label, items]) => (
        <section key={label} className={styles.stack}>
          <h3>{label}</h3>
          <div className={styles.grid}>
            {items.map((resource) => (
              <article className={styles.card} key={resource.id}>
                <strong>{resource.title}</strong>
                <span
                  className={
                    assignmentState(resource) === "missing" ||
                    assignmentState(resource) === "overdue"
                      ? styles.error
                      : styles.muted
                  }
                >
                  {assignmentState(resource)} ·{" "}
                  {String(resource.data.priority ?? "normal")} priority
                </span>
                <span>
                  {resource.data.dueDate
                    ? new Date(String(resource.data.dueDate)).toLocaleString()
                    : "No deadline"}
                </span>
                <button onClick={() => onOpen(resource)}>
                  Open assignment
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
      {board && !groups.length && <p>No assignments match this filter.</p>}
    </section>
  );
}
