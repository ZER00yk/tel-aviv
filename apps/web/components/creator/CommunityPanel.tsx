"use client";
import { useEffect, useState } from "react";
import { api } from "../classes/api";
import styles from "../classes/Workspace.module.css";
export type CreationStatistics = {
  total_attempts: number;
  total_completions: number;
  unique_account_completions: number;
  published_version_completions: number;
  completion_percentage: number;
  fastest_verified_seconds: number | null;
  difficulty: number | null;
  difficulty_ratings: number;
};
type Collaborator = {
  user_id: string;
  username: string;
  permission: "viewer" | "editor";
  active: boolean;
};
type Ranking = {
  version: number;
  runtimeRevision: string;
  entries: {
    rank: number;
    username: string;
    seconds: number;
    deaths: number;
  }[];
};
export default function CommunityPanel({
  id,
  ownerId,
  owner,
  permission,
  published,
  statistics,
  onRefresh,
}: {
  id: string;
  ownerId: string;
  owner: boolean;
  permission?: string | null;
  published: boolean;
  statistics?: CreationStatistics;
  onRefresh: () => void;
}) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [username, setUsername] = useState("");
  const [grant, setGrant] = useState<"viewer" | "editor">("editor");
  const [rating, setRating] = useState("3");
  const [reason, setReason] = useState("broken");
  const [details, setDetails] = useState("");
  const [followed, setFollowed] = useState(false);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [message, setMessage] = useState("");
  const shared = owner || !!permission;
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        if (shared) {
          if (!owner)
            await api(`creations/${id}/collaborators/presence`, "POST");
          const rows = await api<Collaborator[]>(
            `creations/${id}/collaborators`,
          );
          if (active) setCollaborators(rows);
        }
      } catch (error) {
        if (active) setMessage(String(error));
      }
    }
    void refresh();
    const timer = shared
      ? window.setInterval(() => {
          void refresh();
        }, 20_000)
      : undefined;
    return () => {
      active = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [id, shared, owner]);
  useEffect(() => {
    let active = true;
    if (published) {
      void api<Ranking>(`creations/${id}/rankings`)
        .then((value) => {
          if (active) setRanking(value);
        })
        .catch((error) => {
          if (active) setMessage(String(error));
        });
      if (!owner)
        void api<{ followed: boolean }>(`creations/creators/${ownerId}`)
          .then((value) => {
            if (active) setFollowed(value.followed);
          })
          .catch((error) => {
            if (active) setMessage(String(error));
          });
    }
    return () => {
      active = false;
    };
  }, [id, ownerId, owner, published, statistics?.total_completions]);
  async function action(work: () => Promise<unknown>, success: string) {
    try {
      await work();
      setMessage(success);
      onRefresh();
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      {shared && (
        <section className={styles.card} aria-label="Project collaborators">
          <h3>Project collaborators</h3>
          <p className={styles.muted}>
            Editors save shared revisions. Viewers can play drafts. Publishing
            and restoring versions belong to the creator. Concurrent saves
            require reloading the latest revision.
          </p>
          {collaborators.length === 0 && <p>No collaborators yet.</p>}
          {collaborators.map((person) => (
            <div className={styles.row} key={person.user_id}>
              <span>
                {person.username} · {person.permission}
                {person.active ? " · Editing workspace open" : ""}
              </span>
              {owner && (
                <button
                  onClick={() =>
                    action(async () => {
                      await api(
                        `creations/${id}/collaborators/${person.user_id}`,
                        "DELETE",
                      );
                      setCollaborators(
                        await api(`creations/${id}/collaborators`),
                      );
                    }, "Collaborator removed")
                  }
                >
                  Remove {person.username}
                </button>
              )}
            </div>
          ))}
          {owner && (
            <form
              className={styles.row}
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await api(`creations/${id}/collaborators`, "POST", {
                    username,
                    permission: grant,
                  });
                  setUsername("");
                  setCollaborators(await api(`creations/${id}/collaborators`));
                }, "Collaborator access saved");
              }}
            >
              <input
                aria-label="Collaborator username"
                value={username}
                minLength={3}
                maxLength={24}
                required
                onChange={(event) => setUsername(event.target.value)}
              />
              <select
                aria-label="Collaborator permission"
                value={grant}
                onChange={(event) =>
                  setGrant(event.target.value as "viewer" | "editor")
                }
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button>Add collaborator</button>
            </form>
          )}
        </section>
      )}
      {published && (
        <section className={styles.card} aria-label="Verified level statistics">
          <h3>Verified level statistics</h3>
          {statistics && (
            <p>
              {statistics.total_attempts} attempts ·{" "}
              {statistics.total_completions} completed attempts ·{" "}
              {statistics.unique_account_completions} unique account completions
              across revisions · {statistics.published_version_completions} on
              this revision · {statistics.completion_percentage}% of attempts
              completed
            </p>
          )}
          <p className={styles.muted}>
            Accounts can complete several revisions. Unique completions count
            each retained account once. Rankings compare server-verified inputs
            on this revision and runtime.
          </p>
          {statistics && (
            <p>
              Difficulty:{" "}
              {statistics.difficulty === null
                ? "Unrated"
                : `${statistics.difficulty}/5 (${statistics.difficulty_ratings} ratings)`}
              . Fastest current run:{" "}
              {statistics.fastest_verified_seconds === null
                ? "None yet"
                : `${statistics.fastest_verified_seconds.toFixed(2)}s`}
              .
            </p>
          )}
          {!owner && (
            <div className={styles.row}>
              <button
                onClick={() =>
                  action(
                    async () => {
                      await api(
                        `creations/creators/${ownerId}/follow`,
                        "POST",
                        { followed: !followed },
                      );
                      setFollowed(!followed);
                    },
                    followed ? "Creator unfollowed" : "Creator followed",
                  )
                }
              >
                {followed ? "Unfollow creator" : "Follow creator"}
              </button>
              <label>
                Level difficulty
                <select
                  aria-label="Level difficulty"
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                >
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>
                      {value}
                      {value === 1
                        ? " · Easy"
                        : value === 5
                          ? " · Very hard"
                          : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() =>
                  action(
                    () =>
                      api(`creations/${id}/rating`, "POST", {
                        rating: Number(rating),
                      }),
                    "Difficulty rating saved",
                  )
                }
              >
                Rate difficulty
              </button>
            </div>
          )}
          <h4>Speed rankings · revision {ranking?.version}</h4>
          {ranking?.entries.length ? (
            <ol>
              {ranking.entries.map((entry) => (
                <li key={entry.username}>
                  #{entry.rank} {entry.username} · {entry.seconds.toFixed(2)}s ·{" "}
                  {entry.deaths} deaths
                </li>
              ))}
            </ol>
          ) : (
            <p>No verified runs for this revision yet.</p>
          )}
          <details>
            <summary>Report this level</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action(
                  () =>
                    api(`creations/${id}/report`, "POST", { reason, details }),
                  "Report received for administrator review",
                );
              }}
            >
              <label>
                Report reason
                <select
                  aria-label="Report reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                >
                  {[
                    "inappropriate",
                    "harassment",
                    "exploit",
                    "misleading",
                    "broken",
                    "other",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Report details
                <textarea
                  aria-label="Report details"
                  value={details}
                  maxLength={1000}
                  onChange={(event) => setDetails(event.target.value)}
                />
              </label>
              <button>Submit report</button>
            </form>
          </details>
        </section>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
