"use client";
import type {
  HomeData,
  HistoryEntry,
  Announcement,
  GamesData,
  GameDetailData,
  LeaderboardData,
} from "./models";
import { SeasonsPanel } from "./Seasons";
import { useEffect, useState } from "react";
import { leaderboardCategories } from "../../../games/leaderboards";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Gamepad2,
  Heart,
  Users,
  Sparkles,
  BookOpen,
  MessageCircle,
  ChevronRight,
  Trophy,
} from "lucide-react";
import { games, gameById, type GameManifest } from "@tell-aviv/games";
import type { SchoolClass, SchoolResource } from "./classes/api";
import {
  api,
  Avatar,
  Empty,
  Heading,
  Notice,
  Panel,
  ResourceState,
  time,
  useResource,
  useSession,
} from "./ui";

export function GameArt({
  game,
  className = "",
}: {
  game: GameManifest;
  className?: string;
}) {
  return (
    <div className={`game-art art-${game.id} ${className}`}>
      <div className="game-art-grid" />
      <span className="game-art-symbol">{game.icon}</span>
      <span className="game-art-orbit" />
      <span className="game-art-name">{game.name.toUpperCase()}</span>
      <span className="game-art-code">TA / {game.category.toUpperCase()}</span>
    </div>
  );
}
export function GameCard({
  game,
  favorite,
  onFavorite,
}: {
  game: GameManifest;
  favorite?: boolean;
  onFavorite?: () => void;
}) {
  return (
    <article className="game-card">
      <Link href={`/games/${game.id}`} aria-label={`View ${game.name}`}>
        <GameArt game={game} />
      </Link>
      <div className="game-card-body">
        <div className="game-card-heading">
          <h3>
            <Link href={`/games/${game.id}`}>{game.name}</Link>
          </h3>
          {onFavorite && (
            <button
              onClick={onFavorite}
              className={`icon-button favorite ${favorite ? "selected" : ""}`}
              aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${game.name}`}
            >
              <Heart size={17} fill={favorite ? "currentColor" : "none"} />
            </button>
          )}
        </div>
        <p>{game.description}</p>
        <div className="game-meta">
          <span>
            {game.multiplayer ? (
              <>
                <Users size={12} /> {game.players[0]}–{game.players[1]} players
              </>
            ) : (
              <>
                <Gamepad2 size={12} /> Single player
              </>
            )}
          </span>
          <Link href={`/games/${game.id}/play`}>
            Play <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}
export function HomePage() {
  const { user } = useSession(),
    home = useResource<HomeData>("home"),
    history = useResource<HistoryEntry[]>("games/history"),
    announcements = useResource<Announcement[]>("announcements");
  const focused = Boolean(user.settings.focusMode);
  const school = useResource<{
    classes: SchoolClass[];
    upcoming: SchoolResource[];
  }>(focused ? "classes" : null);
  const recent = Array.isArray(history.data)
    ? history.data
    : history.data || [];
  const recentIds = [...new Set(recent.map((item) => item.gameId))].slice(
    0,
    3,
  ) as string[];
  if (focused)
    return (
      <>
        <Heading
          eyebrow="FOCUS MODE"
          title={`Room to focus, ${user.displayName}.`}
          description="Your notes, files and assignments are close at hand."
        />
        <ResourceState
          loading={school.loading}
          error={school.error}
          retry={school.refresh}
        />
        <Panel
          title="Your workspace"
          action={
            <Link className="text-link" href="/classes">
              Open Classes →
            </Link>
          }
        >
          {school.data?.classes.length ? (
            <div className="quick-paths">
              {school.data.classes.map((cls) => (
                <Link key={cls.id} href="/classes">
                  <BookOpen />
                  <span>
                    {cls.name}
                    <small>Notes, files and study tools</small>
                  </span>
                  <ArrowRight />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="Make room for your subjects">
              <Link className="button" href="/classes">
                Create a class
              </Link>
            </Empty>
          )}
        </Panel>
        <Panel title="Upcoming assignments">
          {school.data?.upcoming.length ? (
            <div className="activity-list">
              {school.data.upcoming.map((assignment) => (
                <Link
                  className="activity-item"
                  key={assignment.id}
                  href="/classes"
                >
                  <BookOpen />
                  <div>
                    <strong>{assignment.title}</strong>
                    <small>
                      {typeof assignment.data.dueDate === "string"
                        ? new Date(assignment.data.dueDate).toLocaleDateString()
                        : "No deadline"}{" "}
                      · {String(assignment.data.status || "not-started")}
                    </small>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="A little breathing room">
              No unfinished assignments with deadlines.
            </Empty>
          )}
        </Panel>
      </>
    );
  return (
    <>
      <Heading
        eyebrow="YOUR SPACE, YOUR PACE"
        title={`Hey, ${user.displayName}.`}
        description="Good to have you here. What are we getting into?"
      />
      <div className="home-hero">
        <div>
          <span className="hero-label">
            <span className="status-dot" /> THE GOOD STUFF STARTS HERE
          </span>
          <h2>
            A world of games.
            <br />
            <em>A space for you.</em>
          </h2>
          <p>
            Play something new. Catch up with your people.
            <br />
            Make a little room for your next idea.
          </p>
          <Link href="/games" className="button">
            Find your next game <ArrowUpRight size={17} />
          </Link>
          <Link href="/chat" className="hero-second">
            Meet in global chat <ArrowRight size={15} />
          </Link>
        </div>
        <div className="hero-graphic" aria-hidden="true">
          <div className="hero-tile tile-one">
            ✦<small>PLAY TOGETHER</small>
          </div>
          <div className="hero-tile tile-two">
            ↗<small>MAKE YOUR MARK</small>
          </div>
          <div className="hero-tile tile-three">ta</div>
          <span className="hero-dot" />
        </div>
      </div>
      <div className="quick-paths">
        <Link href="/chat">
          <MessageCircle />
          <span>
            Join the conversation<small>Global chat & your DMs</small>
          </span>
          <ArrowUpRight size={18} />
        </Link>
        <Link href="/create">
          <Sparkles />
          <span>
            Make something yours<small>Build & share creations</small>
          </span>
          <ArrowUpRight size={18} />
        </Link>
        <Link href="/classes">
          <BookOpen />
          <span>
            A little more organized<small>Notes, files & assignments</small>
          </span>
          <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="home-columns">
        <div>
          <Panel
            title={
              recentIds.length
                ? "Pick up where you left off"
                : "Find a new favorite"
            }
            action={
              <Link className="text-link" href="/games">
                All games <ArrowRight size={14} />
              </Link>
            }
          >
            <div className="game-grid compact">
              {(recentIds.length
                ? (recentIds
                    .map((id) => gameById(id))
                    .filter(Boolean) as GameManifest[])
                : games.slice(0, 3)
              ).map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </Panel>
          <Panel
            title="Around your circle"
            action={<span className="pill">ACTIVITY</span>}
          >
            <ResourceState
              loading={home.loading}
              error={home.error}
              retry={home.refresh}
            />
            {home.data?.activity?.length ? (
              <div className="activity-list">
                {home.data.activity.map((item) => (
                  <Link
                    className="activity-item"
                    key={item.id}
                    href={item.link || "/profile"}
                  >
                    <Avatar user={item} />
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.displayName} · {time(item.createdAt)}
                      </small>
                    </div>
                    <ChevronRight size={16} />
                  </Link>
                ))}
              </div>
            ) : (
              !home.loading && (
                <Empty title="The next story starts with you">
                  Play a game or publish a creation. Your circle’s activity will
                  appear here.
                </Empty>
              )
            )}
          </Panel>
          <Panel title="From Tell Aviv">
            <ResourceState
              loading={announcements.loading}
              error={announcements.error}
              retry={announcements.refresh}
            />
            {announcements.data?.length
              ? announcements.data.map((item) => (
                  <article className="announcement" key={item.id}>
                    <span className="eyebrow">{time(item.created_at)}</span>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                ))
              : !announcements.loading && (
                  <div className="quiet-message">
                    No announcements right now. Enjoy your space.
                  </div>
                )}
          </Panel>
        </div>
        <aside>
          <Panel
            title="Your people"
            action={
              <Link className="text-link" href="/friends">
                <Users size={15} />
              </Link>
            }
          >
            {home.data?.friends?.length ? (
              home.data.friends.slice(0, 7).map((friend) => (
                <Link
                  className="person-row"
                  href={`/profile/${friend.id}`}
                  key={friend.id}
                >
                  <Avatar user={friend} />
                  <span>
                    <strong>{friend.nickname || friend.displayName}</strong>
                    <small>{friend.status || `@${friend.username}`}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </Link>
              ))
            ) : (
              <Empty title="Your circle starts here" icon="☺">
                Find a friend by username and send a request.
                <br />
                <Link href="/friends" className="text-link">
                  Find your people <ArrowRight size={14} />
                </Link>
              </Empty>
            )}
          </Panel>
          <Link href="/create" className="creator-callout">
            <span className="eyebrow">
              A LITTLE IMAGINATION GOES A LONG WAY
            </span>
            <Sparkles size={31} />
            <h3>
              From “what if”
              <br />
              to “I made this.”
            </h3>
            <p>Your next world starts with a blank canvas.</p>
            <span>
              Open the studio <ArrowUpRight size={18} />
            </span>
          </Link>
          <div className="small-footnote">
            <span>✦</span>
            <p>Good company makes everything a little better.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
export function GamesPage() {
  const state = useResource<GamesData>("games"),
    [tab, setTab] = useState("All games"),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const serverGames = state.data?.games || [];
  const favoriteIds: string[] =
    state.data?.favorites ||
    serverGames.filter((g) => g.favorite).map((g) => g.id);
  const history = useResource<HistoryEntry[]>("games/history");
  const recentIds = new Set(
    (Array.isArray(history.data) ? history.data : history.data || []).map(
      (item) => item.gameId,
    ),
  );
  const filtered = games.filter(
    (game) =>
      `${game.name} ${game.category} ${game.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (tab === "Multiplayer"
        ? game.multiplayer
        : tab === "Solo play"
          ? !game.multiplayer
          : tab === "Favorites"
            ? favoriteIds.includes(game.id)
            : tab === "Recent"
              ? recentIds.has(game.id)
              : true),
  );
  async function favorite(game: GameManifest) {
    try {
      await api(`games/${game.id}/favorite`, "POST", {
        favorite: !favoriteIds.includes(game.id),
      });
      await state.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Heading
        eyebrow="ONE MORE ROUND?"
        title="Find your next obsession."
        description="Big adventures. Quick breaks. Better with friends."
      />
      <div className="featured-game">
        <GameArt game={games[6]} />
        <div>
          <span className="eyebrow">SPOTLIGHT / ORIGINAL GAMES</span>
          <h2>{games[6].name}</h2>
          <p>{games[6].description}</p>
          <div className="tag-row">
            {games[6].tags.map((tag) => (
              <span className="pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <Link className="button" href={`/games/${games[6].id}/play`}>
            Jump in <ArrowUpRight size={17} />
          </Link>
          <Link className="text-link" href={`/games/${games[6].id}`}>
            Take a closer look <ArrowRight size={15} />
          </Link>
        </div>
      </div>
      <div className="catalog-toolbar">
        <div className="tabs">
          {["All games", "Multiplayer", "Solo play", "Favorites", "Recent"].map(
            (value) => (
              <button
                className={tab === value ? "active" : ""}
                onClick={() => setTab(value)}
                key={value}
              >
                {value}
              </button>
            ),
          )}
        </div>
        <input
          aria-label="Filter games"
          placeholder="Search games…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Notice>{error || state.error}</Notice>
      <div className="game-grid">
        {filtered.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            favorite={favoriteIds.includes(game.id)}
            onFavorite={() => void favorite(game)}
          />
        ))}
      </div>
      {!filtered.length && (
        <Empty
          title={
            tab === "Favorites"
              ? "A favorite is waiting to happen"
              : tab === "Recent"
                ? "Your first adventure awaits"
                : "No games found"
          }
        >
          Try a different filter or discover something new.
        </Empty>
      )}
      <div className="catalog-footer">
        <span>BUILT FOR THE BROWSER. READY WHEN YOU ARE.</span>
        <span>{games.length} original experiences</span>
      </div>
    </>
  );
}
export function GameDetail({ id }: { id: string }) {
  const game = gameById(id),
    [category, setCategory] = useState("default"),
    [period, setPeriod] = useState("all"),
    [scope, setScope] = useState("all"),
    detail = useResource<GameDetailData>(game ? `games/${id}` : null),
    leaderboard = useResource<LeaderboardData>(
      game
        ? `games/${id}/leaderboard?category=${category}&period=${period}&scope=${scope}`
        : null,
    ),
    [tab, setTab] = useState("Overview"),
    [error, setError] = useState("");
  useEffect(() => {
    setCategory("default");
  }, [id]);
  if (!game)
    return (
      <Empty title="Game not found">
        <Link href="/games">Explore games</Link>
      </Empty>
    );
  const scores = leaderboard.data?.entries || [];
  return (
    <>
      <Link className="breadcrumb" href="/games">
        ← Back to games
      </Link>
      <div className="game-detail-top">
        <GameArt game={game} />
        <div>
          <span className="eyebrow">
            {game.category.toUpperCase()} / TELL AVIV ORIGINAL
          </span>
          <h1>{game.name}</h1>
          <p>{game.description}</p>
          <div className="tag-row">
            {game.tags.map((tag) => (
              <span key={tag} className="pill">
                {tag}
              </span>
            ))}
          </div>
          <div className="button-row">
            <Link className="button" href={`/games/${id}/play`}>
              <Gamepad2 size={18} /> Play now
            </Link>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await api(`games/${id}/favorite`, "POST", {
                    favorite: !detail.data?.favorite,
                  });
                  await detail.refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Heart
                size={16}
                fill={detail.data?.favorite ? "currentColor" : "none"}
              />{" "}
              {detail.data?.favorite ? "Favorited" : "Favorite"}
            </button>
            <Link
              href="/chat"
              className="icon-button"
              aria-label="Discuss in global chat"
            >
              <MessageCircle size={19} />
            </Link>
          </div>
          <Notice>{error}</Notice>
        </div>
      </div>
      <div className="tabs detail-tabs">
        {["Overview", "Leaderboards", "Achievements", "Patch notes"].map(
          (value) => (
            <button
              onClick={() => setTab(value)}
              className={tab === value ? "active" : ""}
              key={value}
            >
              {value}
            </button>
          ),
        )}
      </div>
      {tab === "Overview" ? (
        <div className="two-column">
          <Panel title="About this game">
            <p>{game.description}</p>
            <dl className="detail-list">
              <div>
                <dt>Developer</dt>
                <dd>{game.developer}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{game.version}</dd>
              </div>
              <div>
                <dt>Players</dt>
                <dd>
                  {game.players[0] === game.players[1]
                    ? game.players[0]
                    : `${game.players[0]}–${game.players[1]}`}
                </dd>
              </div>
              <div>
                <dt>Input</dt>
                <dd>
                  Keyboard & pointer{game.controller ? " · controller" : ""}
                </dd>
              </div>
              <div>
                <dt>Cloud saves</dt>
                <dd>Saved to your account</dd>
              </div>
              <div>
                <dt>Leaderboard</dt>
                <dd>
                  {game.id === "ego-trip"
                    ? "Server-validated solo gauntlet"
                    : game.ranked
                      ? "Server-validated outcomes"
                      : "Casual play · unranked"}
                </dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Your progress">
            <ResourceState
              loading={detail.loading}
              error={detail.error}
              retry={detail.refresh}
            />
            {detail.data?.stats && Object.keys(detail.data.stats).length ? (
              <dl className="detail-list">
                {Object.entries(detail.data.stats)
                  .filter(([, value]) => typeof value !== "object")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/_/g, " ")}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <Empty title="Your story begins here" icon="◈">
                Play to build your history, progress, and achievements.
              </Empty>
            )}
          </Panel>
        </div>
      ) : tab === "Leaderboards" ? (
        <Panel title="The leaderboard">
          <SeasonsPanel gameId={id} />
          {game.ranked && (
            <div className="button-row">
              <label>
                Category{" "}
                <select
                  aria-label="Leaderboard category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {(leaderboardCategories[id] ?? ["default"]).map((value) => (
                    <option value={value} key={value}>
                      {value === "default"
                        ? "Standard"
                        : value.replaceAll("-", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Period{" "}
                <select
                  aria-label="Leaderboard period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option value="all">All time</option>
                  <option value="daily">Today</option>
                  <option value="weekly">This week</option>
                </select>
              </label>
              <label>
                Players{" "}
                <select
                  aria-label="Leaderboard players"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                >
                  <option value="all">Everyone</option>
                  <option value="friends">Friends and me</option>
                </select>
              </label>
            </div>
          )}
          <ResourceState
            loading={leaderboard.loading}
            error={leaderboard.error}
            retry={leaderboard.refresh}
          />
          {scores.length ? (
            <div className="leaderboard">
              {scores.map((entry, index: number) => (
                <div
                  className="leaderboard-row"
                  key={entry.userId || entry.user_id || index}
                >
                  <span className="rank">{index + 1}</span>
                  <Avatar user={entry} />
                  <Link href={`/profile/${entry.userId || entry.user_id}`}>
                    {entry.displayName || entry.display_name || entry.username}
                  </Link>
                  <strong>{Number(entry.score).toLocaleString()}</strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="An open podium" icon="♜">
              No validated scores yet.{" "}
              {game.id === "ego-trip"
                ? "Finish a ranked campaign or gauntlet to submit a score."
                : game.ranked
                  ? "Start a run to make your mark."
                  : "This casual game does not submit competitive scores."}
            </Empty>
          )}
        </Panel>
      ) : tab === "Achievements" ? (
        <Panel title="Things worth chasing">
          {detail.data?.achievements?.length ? (
            <div className="achievement-grid">
              {detail.data.achievements.map((entry) => (
                <div className="achievement" key={entry.id}>
                  <Trophy />
                  <div>
                    <strong>{entry.name || entry.title || entry.id}</strong>
                    <p>
                      {entry.description ||
                        "Unlocked through validated gameplay."}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Discover it by doing it" icon="★">
              Game achievements appear here as you earn them.
            </Empty>
          )}
        </Panel>
      ) : (
        <Panel title="Latest changes">
          {detail.data?.changelog?.length ? (
            detail.data.changelog.map((entry, index: number) => (
              <article className="announcement" key={index}>
                <span className="pill">{entry.version}</span>
                <h3>{entry.title || "Game update"}</h3>
                <p>{entry.body || entry.notes}</p>
              </article>
            ))
          ) : (
            <article className="announcement">
              <span className="pill">{game.version}</span>
              <h3>The first chapter</h3>
              <p>
                Initial playable release with platform sessions, settings, and
                cloud services. Gameplay controls appear in the game.
              </p>
            </article>
          )}
        </Panel>
      )}
    </>
  );
}
