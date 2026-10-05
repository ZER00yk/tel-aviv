"use client";
import { useEffect, useState } from "react";
import { games } from "../../../games/catalog";
import { leaderboardCategories } from "../../../games/leaderboards";
import {
  api,
  Empty,
  Panel,
  ResourceState,
  useResource,
  useSession,
} from "./ui";
import styles from "./Seasons.module.css";

type Mode = { gameId: string; category: string };
type Season = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  state: "active" | "ended";
  awaitingFinalization: boolean;
  rewards: number[];
  modes: Mode[];
};
type Detail = {
  season: Season;
  unclaimedCoins: number;
  standings: {
    gameId: string;
    category: string;
    rank: number;
    score: number;
    username: string | null;
    mine: boolean;
    reward: number;
    claimed: boolean;
  }[];
};
type StartPreview = {
  confirmation: string;
  startsAt: string;
  maxRewardCoins: number;
};
type ClosePreview = {
  confirmation: string;
  eligibleEntries: number;
  endingEarly: boolean;
};

export function SeasonsPanel({ gameId }: { gameId?: string }) {
  const list = useResource<{ seasons: Season[] }>(
      `seasons${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`,
    ),
    [selected, setSelected] = useState(""),
    detail = useResource<Detail>(selected ? `seasons/${selected}` : null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    session = useSession();
  useEffect(() => {
    if (
      list.data &&
      !list.data.seasons.some((season) => season.id === selected)
    )
      setSelected(list.data.seasons[0]?.id ?? "");
  }, [list.data, selected]);
  const season = detail.data?.season;
  return (
    <Panel title="Competition seasons">
      <p className="muted">
        Validated results earn a place in each eligible mode. Closed seasons
        keep their standings; rewards are fictional Tell Coins.
      </p>
      <ResourceState
        loading={list.loading}
        error={list.error}
        retry={list.refresh}
      />
      {list.data?.seasons.length ? (
        <>
          <label>
            Competition season{" "}
            <select
              aria-label="Competition season"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setNotice("");
                setError("");
              }}
            >
              {list.data.seasons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ·{" "}
                  {item.state === "ended"
                    ? "Ended"
                    : item.awaitingFinalization
                      ? "Awaiting results"
                      : "Active"}
                </option>
              ))}
            </select>
          </label>
          <ResourceState
            loading={detail.loading}
            error={detail.error}
            retry={detail.refresh}
          />
          {season && (
            <>
              <p>
                <strong>{season.title}</strong> ·{" "}
                {season.state === "ended"
                  ? "Finalized standings"
                  : season.awaitingFinalization
                    ? "Scoring ended; awaiting finalization"
                    : "Scoring is open"}
              </p>
              <p className="muted">
                {new Date(season.startsAt).toLocaleString()} –{" "}
                {new Date(season.endsAt).toLocaleString()} · podium rewards{" "}
                {season.rewards.join(" / ")} Tell Coins per mode.
              </p>
              {detail.data!.standings.length ? (
                <div className={styles.standings}>
                  <table>
                    <caption>
                      {season.state === "ended"
                        ? "Finalized season results"
                        : "Current season standings"}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Mode</th>
                        <th scope="col">Rank</th>
                        <th scope="col">Player</th>
                        <th scope="col">Score</th>
                        <th scope="col">Reward</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data!.standings.map((row) => (
                        <tr key={`${row.gameId}/${row.category}/${row.rank}`}>
                          <td>
                            {games.find((game) => game.id === row.gameId)
                              ?.name ?? row.gameId}{" "}
                            · {row.category.replaceAll("-", " ")}
                          </td>
                          <td>{row.rank}</td>
                          <td>
                            {row.username ?? "Removed player"}
                            {row.mine ? " (you)" : ""}
                          </td>
                          <td>{Number(row.score).toLocaleString()}</td>
                          <td>
                            {season.state === "ended"
                              ? `${row.reward}${row.claimed ? " · claimed" : ""}`
                              : "Pending"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No eligible results yet">
                  Start a new verified run during this season, or earn fresh
                  cumulative progress.
                </Empty>
              )}
              {season.state === "ended" && detail.data!.unclaimedCoins > 0 && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setNotice("");
                    try {
                      const result = await api<{ claimedCoins: number }>(
                        `seasons/${selected}/claim`,
                        "POST",
                        {},
                      );
                      setNotice(
                        `${result.claimedCoins} fictional Tell Coins claimed.`,
                      );
                      await detail.refresh();
                      await session.refresh();
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? "Claiming…"
                    : `Claim ${detail.data!.unclaimedCoins} Tell Coins`}
                </button>
              )}
            </>
          )}
        </>
      ) : (
        !list.loading &&
        !list.error && (
          <Empty title="No seasons announced">
            An administrator can start a competition for this game's verified
            modes.
          </Empty>
        )
      )}
      <div className="button-row">
        <button
          className="button"
          onClick={async () => {
            await list.refresh();
            if (selected) await detail.refresh();
          }}
        >
          Refresh seasons
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** Scoped, previewed operations; the server independently checks current admin role. */
export function SeasonAdminPanel() {
  const ranked = games.filter(
      (game) => game.ranked && leaderboardCategories[game.id],
    ),
    list = useResource<{ seasons: Season[] }>("seasons"),
    [slug, setSlug] = useState(""),
    [title, setTitle] = useState(""),
    [gameId, setGameId] = useState("ego-trip"),
    [category, setCategory] = useState("campaign"),
    [endsAt, setEndsAt] = useState(""),
    [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [closeId, setCloseId] = useState(""),
    [preview, setPreview] = useState<StartPreview | null>(null),
    [closePreview, setClosePreview] = useState<ClosePreview | null>(null),
    [operationId, setOperationId] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const resetPreview = () => {
    setPreview(null);
    setClosePreview(null);
    setConfirmation("");
    setOperationId("");
    setError("");
    setNotice("");
  };
  const proposal = () => ({
    slug,
    title,
    endsAt: new Date(endsAt).toISOString(),
    modes: [{ gameId, category }],
    rewards: [100, 50, 25],
  });
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Season administration">
      <p className="muted">
        Preview an immediate competition with one eligible mode and bounded
        podium rewards of 100, 50 and 25 fictional Tell Coins. The API also
        supports up to 12 modes.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            setPreview(
              await api<StartPreview>(
                "admin/seasons/preview-start",
                "POST",
                proposal(),
              ),
            );
            setClosePreview(null);
            setConfirmation("");
            setOperationId(crypto.randomUUID());
          });
        }}
      >
        <div className="form-grid">
          <label>
            Season identifier
            <input
              aria-label="Season identifier"
              value={slug}
              required
              minLength={3}
              maxLength={40}
              pattern="[a-z0-9][a-z0-9-]{2,39}"
              onChange={(event) => {
                setSlug(event.target.value);
                resetPreview();
              }}
            />
          </label>
          <label>
            Season title
            <input
              aria-label="Season title"
              value={title}
              required
              minLength={3}
              maxLength={80}
              onChange={(event) => {
                setTitle(event.target.value);
                resetPreview();
              }}
            />
          </label>
          <label>
            Eligible game
            <select
              aria-label="Season eligible game"
              value={gameId}
              onChange={(event) => {
                setGameId(event.target.value);
                setCategory(leaderboardCategories[event.target.value][0]);
                resetPreview();
              }}
            >
              {ranked.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Eligible mode
            <select
              aria-label="Season eligible mode"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                resetPreview();
              }}
            >
              {leaderboardCategories[gameId].map((mode) => (
                <option key={mode} value={mode}>
                  {mode.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Season ends
            <input
              aria-label="Season ends"
              type="datetime-local"
              value={endsAt}
              required
              onChange={(event) => {
                setEndsAt(event.target.value);
                resetPreview();
              }}
            />
          </label>
        </div>
        <button className="button" disabled={busy} type="submit">
          Preview season start
        </button>
      </form>
      <ResourceState
        loading={list.loading}
        error={list.error}
        retry={list.refresh}
      />
      <label>
        Season to finalize
        <select
          aria-label="Season to finalize"
          value={closeId}
          onChange={(event) => {
            setCloseId(event.target.value);
            resetPreview();
          }}
        >
          <option value="">Choose an active season</option>
          {list.data?.seasons
            .filter((season) => season.state === "active")
            .map((season) => (
              <option key={season.id} value={season.id}>
                {season.title}
              </option>
            ))}
        </select>
      </label>
      <button
        className="button"
        disabled={busy || !closeId}
        onClick={() =>
          void perform(async () => {
            setClosePreview(
              await api<ClosePreview>(
                `admin/seasons/${closeId}/preview-close`,
                "POST",
                {},
              ),
            );
            setPreview(null);
            setConfirmation("");
            setOperationId(crypto.randomUUID());
          })
        }
      >
        Preview season finalization
      </button>
      {(preview || closePreview) && (
        <fieldset>
          <legend>{preview ? "Start preview" : "Finalization preview"}</legend>
          <p>
            {preview
              ? `Maximum rewards: ${preview.maxRewardCoins} fictional Tell Coins. Starts when confirmed.`
              : `${closePreview!.eligibleEntries} eligible results will be frozen.${closePreview!.endingEarly ? " This ends scoring before the scheduled deadline." : ""}`}
          </p>
          <p>
            Type{" "}
            <strong>
              {preview?.confirmation ?? closePreview!.confirmation}
            </strong>{" "}
            to confirm this scope.
          </p>
          <label>
            Season operation confirmation
            <input
              aria-label="Season operation confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <label>
            Season operation reason
            <input
              aria-label="Season operation reason"
              value={reason}
              minLength={5}
              maxLength={240}
              onChange={(event) => {
                setReason(event.target.value);
                setOperationId(crypto.randomUUID());
              }}
            />
          </label>
          <button
            className="button primary"
            disabled={
              busy ||
              confirmation !==
                (preview?.confirmation ?? closePreview?.confirmation) ||
              reason.trim().length < 5
            }
            onClick={() =>
              void perform(async () => {
                if (preview)
                  await api("admin/seasons/start", "POST", {
                    ...proposal(),
                    operationId,
                    confirmation,
                    reason,
                  });
                else
                  await api(`admin/seasons/${closeId}/close`, "POST", {
                    operationId,
                    confirmation,
                    reason,
                  });
                setNotice(
                  preview
                    ? "Season started."
                    : "Standings finalized; eligible players can claim their fictional rewards.",
                );
                setPreview(null);
                setClosePreview(null);
                setConfirmation("");
                await list.refresh();
              })
            }
          >
            {preview ? "Start confirmed season" : "Finalize confirmed season"}
          </button>
        </fieldset>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </Panel>
  );
}
