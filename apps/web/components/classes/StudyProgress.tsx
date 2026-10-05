"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import styles from "./Workspace.module.css";
interface Review {
  id: string;
  card_key: string;
  rating: string;
  front: string;
  back: string;
  interval_seconds: number;
  due_at: string;
  created_at: string;
}
interface Stats {
  totalCards: number;
  dueCount: number;
  total_reviews: number;
  successful_reviews: number;
  last_week_reviews: number;
  studied_cards: number;
  mastered_cards: number;
  successRate: number | null;
  cards: {
    card_key: string;
    front: string;
    review_count: number;
    successes: number;
    due_at: string;
    interval_seconds: number;
  }[];
}
export default function StudyProgress({
  resourceId,
  refreshKey = 0,
  cardKey,
}: {
  resourceId: string;
  refreshKey?: string | number;
  cardKey?: string;
}) {
  const [stats, setStats] = useState<Stats | null>(null),
    [history, setHistory] = useState<Review[]>([]),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(cardKey ?? "");
  const [more, setMore] = useState(false),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    setSelected(cardKey ?? "");
  }, [cardKey]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Stats>(`classes/resources/${resourceId}/study/stats`),
      api<Review[]>(
        `classes/resources/${resourceId}/study/history${selected ? `?cardKey=${selected}` : ""}`,
      ),
    ])
      .then(([next, events]) => {
        if (active) {
          setStats(next);
          setHistory(events);
          setMore(events.length === 50);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [resourceId, refreshKey, selected]);
  async function older() {
    const last = history.at(-1);
    if (!last || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        before: last.created_at,
        beforeId: last.id,
      });
      if (selected) params.set("cardKey", selected);
      const events = await api<Review[]>(
        `classes/resources/${resourceId}/study/history?${params}`,
      );
      setHistory((previous) => [...previous, ...events]);
      setMore(events.length === 50);
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className={styles.card} aria-label="Private study statistics">
      <h3>Your deck progress</h3>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {stats && (
        <>
          <div className={styles.row}>
            <span>
              {stats.dueCount} due / {stats.totalCards} cards
            </span>
            <span>{stats.studied_cards} studied</span>
            <span>{stats.mastered_cards} mastered</span>
          </div>
          <p>
            {stats.total_reviews} reviews ·{" "}
            {stats.successRate === null
              ? "No recall statistics yet"
              : `${stats.successRate}% Good/Easy responses`}{" "}
            · {stats.last_week_reviews} this week
          </p>
          <p className={styles.muted}>
            Mastery means three consecutive non-Again reviews and an interval of
            at least seven days. Ratings are your own reports; no public score
            is awarded.
          </p>
          <label>
            Card history
            <select
              aria-label="Card review history"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">All cards</option>
              {stats.cards.map((card) => (
                <option key={card.card_key} value={card.card_key}>
                  {card.front.slice(0, 80)} · {card.review_count} reviews
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>Per-card scheduling and progress</summary>
            {stats.cards.map((card) => (
              <p key={card.card_key}>
                <strong>{card.front}</strong> · {card.review_count} reviews,{" "}
                {card.successes} Good/Easy · due{" "}
                {new Date(card.due_at).toLocaleString()}
              </p>
            ))}
          </details>
        </>
      )}
      <strong>Most recent reviews</strong>
      {history.map((review) => (
        <article key={review.id}>
          <strong>{review.front}</strong>
          <p>
            {new Date(review.created_at).toLocaleString()} · {review.rating} ·
            next due {new Date(review.due_at).toLocaleString()}
          </p>
          <details>
            <summary>Reviewed answer</summary>
            {review.back}
          </details>
        </article>
      ))}
      {!history.length && <p>No review events yet.</p>}
      {more && (
        <button disabled={loading} onClick={() => void older()}>
          Load older reviews
        </button>
      )}
      <p className={styles.muted}>
        Your reviews appear newest first. Your learning history stays private.
      </p>
    </section>
  );
}
