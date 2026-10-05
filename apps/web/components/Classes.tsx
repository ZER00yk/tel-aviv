"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, type SchoolClass, type SchoolResource } from "./classes/api";
import ClassManagement from "./classes/ClassManagement";
import ResourceEditor from "./classes/ResourceEditor";
import AssignmentBoard from "./classes/AssignmentBoard";
import styles from "./classes/Workspace.module.css";
type Overview = {
  classes: SchoolClass[];
  upcoming: SchoolResource[];
  shared: SchoolResource[];
  usageBytes: number;
  quotaBytes: number;
};
const defaults: Record<string, Record<string, unknown>> = {
  folder: {},
  note: { markdown: "" },
  assignment: {
    description: "",
    status: "not-started",
    priority: "normal",
    dueDate: null,
    links: [],
    attachments: [],
  },
  flashcards: { cards: [] },
  quiz: {
    questions: [
      {
        prompt: "What are you learning?",
        type: "short-answer",
        options: [],
        answer: "Your answer",
      },
    ],
    randomOrder: true,
  },
  link: { url: "https://example.com", description: "" },
};
function ClassesWorkspace() {
  const requestedResource = useSearchParams().get("resource") ?? "";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [classId, setClassId] = useState("");
  const [resources, setResources] = useState<SchoolResource[]>([]);
  const [trash, setTrash] = useState<SchoolResource[]>([]);
  const [selected, setSelected] = useState<SchoolResource | null>(null);
  const [selectedAvailable, setSelectedAvailable] = useState<SchoolResource[]>(
    [],
  );
  const [planner, setPlanner] = useState(false);
  const [reminders, setReminders] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [manageClass, setManageClass] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SchoolResource[] | null>(
    null,
  );
  const [newClass, setNewClass] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("note");
  const [linkUrl, setLinkUrl] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const refreshOverview = useCallback(async () => {
    const next = await api<Overview>("classes");
    setOverview(next);
    return next;
  }, []);
  useEffect(() => {
    refreshOverview()
      .then((next) => {
        if (next.classes[0]) setClassId(next.classes[0].id);
      })
      .catch((error) => setError(String(error)));
  }, [refreshOverview]);
  const refreshClass = useCallback(async () => {
    if (!classId) return;
    const next = await api<{
      resources: SchoolResource[];
      trash: SchoolResource[];
    }>(`classes/${classId}`);
    setResources(next.resources);
    setTrash(next.trash);
  }, [classId]);
  useEffect(() => {
    refreshClass().catch((error) => setError(String(error)));
    setFolder(null);
    setSelected(null);
    setShowTrash(false);
    setManageClass(false);
    setCreateOpen(false);
  }, [refreshClass]);
  const ready = overview !== null;
  useEffect(() => {
    if (
      !ready ||
      !requestedResource ||
      !/^[0-9a-f-]{36}$/.test(requestedResource)
    )
      return;
    let active = true;
    void api<SchoolResource>(`classes/resources/${requestedResource}`)
      .then(async (resource) => {
        const available = resource.owned
          ? (
              await api<{ resources: SchoolResource[] }>(
                `classes/${resource.class_id}`,
              )
            ).resources
          : [];
        if (active) {
          setSelected(resource);
          setSelectedAvailable(available);
          setPlanner(false);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [requestedResource, ready]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function open(resource: SchoolResource) {
    await action(async () => {
      setSelected(await api(`classes/resources/${resource.id}`));
      setPlanner(false);
      if (resource.class_id !== classId && resource.owned) {
        const next = await api<{ resources: SchoolResource[] }>(
          `classes/${resource.class_id}`,
        );
        setSelectedAvailable(next.resources);
      } else setSelectedAvailable(resources);
    });
  }
  const saved = useCallback((next: SchoolResource) => {
    setSelected((previous) =>
      previous?.id === next.id ? { ...previous, ...next } : previous,
    );
    setResources((previous) =>
      previous.map((resource) =>
        resource.id === next.id ? { ...resource, ...next } : resource,
      ),
    );
  }, []);
  async function addClass() {
    await action(async () => {
      const next = await api<SchoolClass>("classes", "POST", {
        name: newClass,
      });
      setNewClass("");
      await refreshOverview();
      setClassId(next.id);
    });
  }
  async function create() {
    await action(async () => {
      const content =
        kind === "link" ? { url: linkUrl, description: "" } : defaults[kind];
      const next = await api<SchoolResource>(
        `classes/${classId}/resources`,
        "POST",
        { kind, title, parentId: folder, data: content },
      );
      setCreateOpen(false);
      setTitle("");
      setLinkUrl("");
      await refreshClass();
      if (kind !== "folder") await open(next);
    });
  }
  async function upload(file: File) {
    await action(async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("classId", classId);
      if (folder) form.set("parentId", folder);
      const response = await fetch("/api/classes/files/upload", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Upload failed");
      await refreshClass();
      await refreshOverview();
    });
  }
  async function doSearch() {
    await action(async () => {
      setSearchResults(
        await api(`classes/search?q=${encodeURIComponent(search)}`),
      );
      setSelected(null);
    });
  }
  const visible =
    searchResults ??
    resources.filter((resource) => resource.parent_id === folder);
  const currentClass = overview?.classes.find((cls) => cls.id === classId);
  const currentFolder = resources.find((resource) => resource.id === folder);
  return (
    <div className={styles.workspace}>
      <div className={styles.header}>
        <div>
          <h1>Classes</h1>
          <p className={styles.muted}>Your notes, deadlines and study space.</p>
          <div className={styles.row}>
            <button
              onClick={() => {
                setPlanner(!planner);
                setSelected(null);
              }}
            >
              Assignment planner
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api<{ generated: number }>(
                    "classes/reminders",
                    "POST",
                    {},
                  );
                  setReminders(
                    result.generated
                      ? `${result.generated} private reminders delivered.`
                      : "Your reminders are up to date.",
                  );
                })
              }
            >
              Check reminders
            </button>
            <span role="status">{reminders}</span>
          </div>
        </div>
        <span className={styles.notice}>
          Private by default · explicit sharing
        </span>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.row}>
        <input
          aria-label="Search school resources"
          placeholder="Search your accessible notes and files"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void doSearch();
          }}
        />
        <button onClick={doSearch}>Search</button>
        {searchResults && (
          <button
            onClick={() => {
              setSearchResults(null);
              setSearch("");
            }}
          >
            Clear results
          </button>
        )}
      </div>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <strong>My classes</strong>
          {overview?.classes.map((cls) => (
            <button
              className={classId === cls.id ? styles.active : ""}
              key={cls.id}
              style={{ borderLeftColor: cls.color, borderLeftWidth: 4 }}
              onClick={() => {
                setClassId(cls.id);
                setSearchResults(null);
              }}
            >
              {cls.name}
            </button>
          ))}
          <label>
            New class
            <input
              placeholder="Physics, English…"
              value={newClass}
              onChange={(event) => setNewClass(event.target.value)}
            />
          </label>
          <button disabled={busy || !newClass.trim()} onClick={addClass}>
            Create class
          </button>
          <hr className={styles.divider} />
          <strong>Shared with me</strong>
          {overview?.shared.map((resource) => (
            <button key={resource.id} onClick={() => open(resource)}>
              {resource.title}
            </button>
          ))}
          {!overview?.shared.length && (
            <span className={styles.muted}>No shared resources yet.</span>
          )}
          <hr className={styles.divider} />
          <span className={styles.muted}>
            Storage: {((overview?.usageBytes ?? 0) / 1024 ** 2).toFixed(1)} MB /{" "}
            {((overview?.quotaBytes ?? 2 * 1024 ** 3) / 1024 ** 3).toFixed(0)}{" "}
            GB
          </span>
        </aside>
        <section className={styles.panel}>
          {planner ? (
            <AssignmentBoard onOpen={(resource) => void open(resource)} />
          ) : selected ? (
            <>
              <button
                onClick={() => {
                  setSelected(null);
                  void refreshClass();
                }}
              >
                ← Back to resources
              </button>
              <ResourceEditor
                key={selected.id}
                resource={selected}
                onSaved={saved}
                available={selectedAvailable}
                owner={selected.owned === true}
                refresh={() => void open(selected)}
                onDelete={() =>
                  void action(async () => {
                    await api(`classes/resources/${selected.id}`, "DELETE");
                    setSelected(null);
                    await refreshClass();
                    await refreshOverview();
                  })
                }
              />
            </>
          ) : (
            <div className={styles.stack}>
              <div className={styles.header}>
                <h2>
                  {searchResults
                    ? "Search results"
                    : showTrash
                      ? "Trash"
                      : (currentFolder?.title ??
                        currentClass?.name ??
                        "Your workspace")}
                </h2>
                <div className={styles.row}>
                  {classId && (
                    <>
                      {currentClass && (
                        <button onClick={() => setManageClass(!manageClass)}>
                          Manage class
                        </button>
                      )}
                      <button onClick={() => setCreateOpen(!createOpen)}>
                        + New resource
                      </button>
                      <label>
                        <span>Upload file</span>
                        <input
                          type="file"
                          accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif"
                          disabled={busy}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void upload(file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                      <button onClick={() => setShowTrash(!showTrash)}>
                        {showTrash ? "Resources" : `Trash (${trash.length})`}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {manageClass && currentClass && (
                <ClassManagement
                  key={`${currentClass.id}:${currentClass.name}`}
                  schoolClass={currentClass}
                  onUpdated={async () => {
                    await refreshOverview();
                  }}
                  onDeleted={async () => {
                    const next = await refreshOverview();
                    setSelected(null);
                    setResources([]);
                    setTrash([]);
                    setFolder(null);
                    setSearchResults(null);
                    setManageClass(false);
                    setClassId(next.classes[0]?.id ?? "");
                  }}
                />
              )}
              {folder && !searchResults && (
                <button
                  onClick={() => setFolder(currentFolder?.parent_id ?? null)}
                >
                  ← Parent folder
                </button>
              )}
              {createOpen && classId && (
                <div className={styles.card}>
                  <div className={styles.row}>
                    <select
                      aria-label="Resource type"
                      value={kind}
                      onChange={(event) => setKind(event.target.value)}
                    >
                      {Object.keys(defaults).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="New resource title"
                      placeholder="Resource title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </div>
                  {kind === "link" && (
                    <input
                      aria-label="Resource URL"
                      placeholder="https://…"
                      value={linkUrl}
                      onChange={(event) => setLinkUrl(event.target.value)}
                    />
                  )}
                  <button
                    className={styles.primary}
                    disabled={busy || !title.trim()}
                    onClick={create}
                  >
                    Create {kind}
                  </button>
                </div>
              )}
              {!classId && !searchResults && (
                <div className={styles.empty}>
                  Create a class to start your private workspace.
                </div>
              )}
              {showTrash ? (
                <div className={styles.stack}>
                  <p className={styles.muted}>
                    Trash is retained for 30 days before scheduled removal.
                    Restore a resource or permanently delete it. Folder deletion
                    includes its contents.
                  </p>
                  {trash.map((resource) => (
                    <div className={styles.card} key={resource.id}>
                      <strong>{resource.title}</strong>
                      <div className={styles.row}>
                        <button
                          onClick={() =>
                            void action(async () => {
                              await api(
                                `classes/resources/${resource.id}/restore`,
                                "POST",
                                {},
                              );
                              await refreshClass();
                            })
                          }
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                "Permanently delete this resource and its contents?",
                              )
                            )
                              void action(async () => {
                                await api(
                                  `classes/resources/${resource.id}/permanent`,
                                  "DELETE",
                                );
                                await refreshClass();
                                await refreshOverview();
                              });
                          }}
                        >
                          Delete forever
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.grid}>
                  {visible.map((resource) => (
                    <div className={styles.card} key={resource.id}>
                      <span className={styles.muted}>{resource.kind}</span>
                      <h3>{resource.title}</h3>
                      {resource.kind === "assignment" && (
                        <span className={styles.muted}>
                          {String(resource.data.status)}{" "}
                          {resource.data.dueDate
                            ? `· ${new Date(String(resource.data.dueDate)).toLocaleDateString()}`
                            : ""}
                        </span>
                      )}
                      <div className={styles.row}>
                        <button onClick={() => open(resource)}>Open</button>
                        {resource.kind === "folder" && !searchResults && (
                          <button onClick={() => setFolder(resource.id)}>
                            Browse folder
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!showTrash &&
                overview?.upcoming.length !== 0 &&
                !folder &&
                !searchResults && (
                  <>
                    <hr className={styles.divider} />
                    <h3>Upcoming deadlines</h3>
                    {overview?.upcoming.map((assignment) => (
                      <button
                        key={assignment.id}
                        onClick={() => open(assignment)}
                      >
                        {assignment.title} ·{" "}
                        {assignment.data.dueDate
                          ? new Date(
                              String(assignment.data.dueDate),
                            ).toLocaleString()
                          : "No due date"}
                      </button>
                    ))}
                  </>
                )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
export default function Classes() {
  return (
    <Suspense fallback={<p>Loading your private workspace…</p>}>
      <ClassesWorkspace />
    </Suspense>
  );
}
