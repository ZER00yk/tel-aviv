"use client";
import { useEffect, useState } from "react";
import { type LevelData } from "../../../packages/platform/src/classes/models";
import { api } from "./classes/api";
import LevelEditor from "./creator/LevelEditor";
import Playtest from "./creator/Playtest";
import CommunityPanel, {
  type CreationStatistics,
} from "./creator/CommunityPanel";
import { objectTypes } from "../../../packages/creator-runtime/src/index";
import { levelTemplate, templateChoices } from "./creator/templates";
const categories = [
  "platformer",
  "puzzle",
  "action",
  "exploration",
  "challenge",
  "other",
] as const;
import styles from "./classes/Workspace.module.css";
type Creation = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  tags: string[];
  level: LevelData;
  version: number;
  published: boolean;
  plays: number;
  likes: number;
  category?: string;
  completions?: number;
  completed?: boolean;
  can_edit?: boolean;
  collaborator_permission?: string | null;
  statistics?: CreationStatistics;
  liked?: boolean;
  favorited?: boolean;
  creator?: string;
  comments?: {
    id: string;
    username: string;
    body: string;
    created_at: string;
  }[];
};
function CreationDetail({
  creation,
  owned,
  onSaved,
  onClose,
}: {
  creation: Creation;
  owned: boolean;
  onSaved: (creation: Creation) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(creation.title);
  const [description, setDescription] = useState(creation.description);
  const [tags, setTags] = useState(creation.tags.join(", "));
  const [category, setCategory] = useState(creation.category ?? "platformer");
  const [level, setLevel] = useState(creation.level);
  const [message, setMessage] = useState("");
  const [comment, setComment] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [versions, setVersions] = useState<
    { version: number; created_at: string }[]
  >([]);
  const editable = owned || !!creation.can_edit;
  async function reload() {
    try {
      const next = await api<Creation>(`creations/${creation.id}`);
      setTitle(next.title);
      setDescription(next.description);
      setTags(next.tags.join(", "));
      setCategory(next.category ?? "platformer");
      setLevel(next.level);
      setEditorKey((value) => value + 1);
      onSaved(next);
      setMessage("Loaded the latest revision. Review it before saving.");
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function refreshDetail() {
    try {
      onSaved(await api(`creations/${creation.id}`));
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function save() {
    try {
      const next = await api<Creation>(
        creation.id ? `creations/${creation.id}` : "creations",
        creation.id ? "PATCH" : "POST",
        {
          title,
          description,
          category,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          level,
          ...(creation.id ? { expectedVersion: creation.version } : {}),
        },
      );
      onSaved(next);
      setMessage("Level saved");
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function publish() {
    try {
      if (!creation.id) {
        setMessage("Save the draft first.");
        return;
      }
      const next = await api<Creation>(
        `creations/${creation.id}/publish`,
        "POST",
        { published: !creation.published },
      );
      onSaved(next);
      setMessage(
        next.published ? "Published to the community" : "Returned to draft",
      );
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function postComment() {
    try {
      await api(`creations/${creation.id}/comments`, "POST", { body: comment });
      setComment("");
      onSaved(await api(`creations/${creation.id}`));
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function toggle(action: "like" | "favorite") {
    try {
      await api(
        `creations/${creation.id}/${action}`,
        "POST",
        action === "like"
          ? { liked: !creation.liked }
          : { favorited: !creation.favorited },
      );
      onSaved({
        ...(await api<Creation>(`creations/${creation.id}`)),
        liked: action === "like" ? !creation.liked : creation.liked,
        favorited:
          action === "favorite" ? !creation.favorited : creation.favorited,
      });
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function history() {
    try {
      setVersions(await api(`creations/${creation.id}/versions`));
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.header}>
        <button onClick={onClose}>← My creations & community</button>
        <span className={styles.muted}>
          {creation.published ? "Published" : "Draft"} · schema v
          {level.schemaVersion} · revision {creation.version}
        </span>
      </div>
      {editable ? (
        <>
          <label>
            Level title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Tags, comma separated
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <div className={styles.row}>
            <button className={styles.primary} onClick={save}>
              Save {creation.id ? "level" : "draft"}
            </button>
            <button disabled={!creation.id || !owned} onClick={publish}>
              {creation.published ? "Unpublish" : "Publish"}
            </button>
            <button disabled={!creation.id} onClick={history}>
              Version history
            </button>
          </div>
          {creation.id && (
            <button onClick={reload}>Reload latest revision</button>
          )}
          <LevelEditor key={editorKey} initial={level} onChange={setLevel} />
          {versions.length > 0 && (
            <div className={styles.card}>
              {versions.map((version) => (
                <div className={styles.row} key={version.version}>
                  <span>
                    Version {version.version} ·{" "}
                    {new Date(version.created_at).toLocaleString()}
                  </span>
                  <button
                    disabled={!owned}
                    onClick={async () => {
                      try {
                        const next = await api<Creation>(
                          `creations/${creation.id}/restore-version`,
                          "POST",
                          { version: version.version },
                        );
                        setLevel(next.level);
                        setEditorKey((value) => value + 1);
                        onSaved(next);
                        setMessage("Restored previous version.");
                      } catch (error) {
                        setMessage(String(error));
                      }
                    }}
                  >
                    Restore version
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <h2>{creation.title}</h2>
          <p>{creation.description}</p>
          <Playtest
            level={creation.level}
            creationId={creation.published ? creation.id : undefined}
            onVerifiedComplete={() => void refreshDetail()}
          />
        </>
      )}
      {creation.id && (
        <CommunityPanel
          id={creation.id}
          ownerId={creation.owner_id}
          owner={owned}
          permission={creation.collaborator_permission}
          published={creation.published}
          statistics={creation.statistics}
          onRefresh={() => void refreshDetail()}
        />
      )}
      {creation.published && (
        <>
          <div className={styles.row}>
            <span>
              {creation.plays} plays · {creation.completions ?? 0} verified
              completions
            </span>
            <button onClick={() => toggle("like")}>
              {creation.liked ? "Unlike" : "Like"}
            </button>
            <button onClick={() => toggle("favorite")}>
              {creation.favorited ? "Unfavorite" : "Favorite"}
            </button>
          </div>
          <div className={styles.card}>
            <h3>Comments</h3>
            {creation.comments?.map((item) => (
              <p key={item.id}>
                <strong>{item.username}</strong> · {item.body}
              </p>
            ))}
            <textarea
              aria-label="Community comment"
              placeholder="Leave a comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <button onClick={postComment}>Post comment</button>
          </div>
        </>
      )}
      <p role="status" className={styles.muted}>
        {message}
      </p>
    </div>
  );
}
export default function Creator() {
  const [list, setList] = useState<{
    mine: Creation[];
    collaborations: Creation[];
    community: Creation[];
    total: number;
    pageSize: number;
  }>({ mine: [], collaborations: [], community: [], total: 0, pageSize: 24 });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("recent");
  const [favorites, setFavorites] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [creator, setCreator] = useState("");
  const [offset, setOffset] = useState(0);
  const [template, setTemplate] = useState("starter");
  const params = new URLSearchParams({
    q: query,
    sort,
    favorites: String(favorites),
    followed: String(followed),
    offset: String(offset),
    ...(category ? { category } : {}),
    ...(creator ? { creator } : {}),
  }).toString();
  const [selected, setSelected] = useState<Creation | null>(null);
  const [selectionKey, setSelectionKey] = useState(0);
  const [owned, setOwned] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setList(await api(`creations?${params}`));
  }
  useEffect(() => {
    let active = true;
    api<typeof list>(`creations?${params}`)
      .then((value) => {
        if (active) {
          setList(value);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [params]);
  function newLevel() {
    setSelectionKey((value) => value + 1);
    setOwned(true);
    setSelected({
      id: "",
      owner_id: "",
      title: "Untitled level",
      description: "",
      tags: [],
      level: levelTemplate(template),
      category:
        templateChoices.find((choice) => choice.id === template)?.category ??
        "platformer",
      version: 1,
      published: false,
      plays: 0,
      likes: 0,
    });
  }
  async function open(creation: Creation, mine: boolean) {
    try {
      const next = await api<Creation>(`creations/${creation.id}`);
      setSelectionKey((value) => value + 1);
      setSelected(next);
      setOwned(mine);
      if (!mine && next.published)
        await api(`creations/${creation.id}/play`, "POST", {});
    } catch (error) {
      setError(String(error));
    }
  }
  function saved(creation: Creation) {
    setSelected((previous) =>
      previous ? { ...previous, ...creation } : creation,
    );
    void refresh();
  }
  return (
    <div className={styles.workspace}>
      <div className={styles.header}>
        <div>
          <h1>Creator</h1>
          <p className={styles.muted}>
            Build a small world. Test it. Share it.
          </p>
        </div>
        <div className={styles.row}>
          <select
            aria-label="Level template"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          >
            {templateChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.title}
              </option>
            ))}
          </select>
          <button className={styles.primary} onClick={newLevel}>
            + New level
          </button>
        </div>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.notice}>
        Build with {objectTypes.length} object types and visual events,
        conditions and actions. Community completions are checked by the server
        from your play inputs.
      </div>
      <div className={styles.panel}>
        {selected ? (
          <CreationDetail
            key={selectionKey}
            creation={selected}
            owned={owned}
            onSaved={saved}
            onClose={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <div className={styles.stack}>
            <h2>My creations</h2>
            {!list.mine.length && (
              <p className={styles.muted}>
                Your first world starts with a platform and a finish zone.
              </p>
            )}
            <div className={styles.grid}>
              {list.mine.map((creation) => (
                <button
                  className={styles.card}
                  key={creation.id}
                  onClick={() => open(creation, true)}
                >
                  <span className={styles.muted}>
                    {creation.published ? "Published" : "Draft"} · v
                    {creation.version}
                  </span>
                  <h3>{creation.title}</h3>
                  <span>
                    {creation.plays} plays · {creation.likes} likes
                  </span>
                </button>
              ))}
            </div>
            {list.collaborations?.length > 0 && (
              <>
                <h2>Shared projects</h2>
                <div className={styles.grid}>
                  {list.collaborations.map((creation) => (
                    <button
                      className={styles.card}
                      key={creation.id}
                      onClick={() => open(creation, false)}
                    >
                      <h3>{creation.title}</h3>
                      <span>
                        by {creation.creator} ·{" "}
                        {creation.collaborator_permission} · v{creation.version}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <hr className={styles.divider} />
            <h2>Community creations</h2>
            <form
              className={styles.row}
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search);
                setOffset(0);
              }}
            >
              <input
                aria-label="Search creations"
                placeholder="Title, tag or creator"
                value={search}
                maxLength={80}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="submit">Search</button>
              <select
                aria-label="Filter category"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort creations"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="recent">Newest</option>
                <option value="trending">Trending · past 7 days</option>
                <option value="popular">Most played</option>
                <option value="liked">Most liked</option>
                <option value="completed">Most completed</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={favorites}
                  onChange={(event) => {
                    setFavorites(event.target.checked);
                    setOffset(0);
                  }}
                />
                Favorites
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={followed}
                  onChange={(event) => {
                    setFollowed(event.target.checked);
                    setOffset(0);
                  }}
                />
                Followed creators
              </label>
              {creator && (
                <button
                  type="button"
                  onClick={() => {
                    setCreator("");
                    setOffset(0);
                  }}
                >
                  Show all creators
                </button>
              )}
            </form>
            {!list.community.length && (
              <p className={styles.muted}>
                Publish a level to start the community collection.
              </p>
            )}
            <div className={styles.grid}>
              {list.community.map((creation) => (
                <div className={styles.card} key={creation.id}>
                  <button onClick={() => open(creation, false)}>
                    <h3>{creation.title}</h3>
                    <p>{creation.description.slice(0, 120)}</p>
                    <span className={styles.muted}>
                      by {creation.creator} · {creation.plays} plays ·{" "}
                      {creation.likes} likes · {creation.completions ?? 0}{" "}
                      completions{creation.completed ? " · Completed" : ""}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setCreator(creation.owner_id);
                      setOffset(0);
                    }}
                  >
                    More by {creation.creator}
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.row}>
              <button
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - list.pageSize))}
              >
                Previous
              </button>
              <span>
                {list.total ? offset + 1 : 0}–
                {Math.min(offset + list.pageSize, list.total)} of {list.total}
              </span>
              <button
                disabled={
                  offset + list.pageSize >= list.total ||
                  offset + list.pageSize > 5000
                }
                onClick={() => setOffset(offset + list.pageSize)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
