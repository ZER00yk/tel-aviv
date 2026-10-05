"use client";
import { useCallback, useEffect, useState } from "react";
import { api, type SchoolResource } from "./api";
import StudyProgress from "./StudyProgress";
import StudyCardEditor from "./StudyCardEditor";
import styles from "./Workspace.module.css";
interface DueCard {
  index: number;
  cardKey: string;
  front: string;
  back: string;
  imageResourceId: string | null;
  reviewToken: string;
  reviewVersion: number;
  reviewCount: number;
}
interface StudyQueue {
  cards: DueCard[];
  totalCards: number;
  dueCount: number;
  nextDueAt: string | null;
}
interface ReviewResult {
  dueAt: string;
  intervalSeconds: number;
  dueCount: number;
  totalCards: number;
  nextDueAt: string | null;
}
type Rating = "again" | "hard" | "good" | "easy";
export default function ScheduledStudy({
  resourceId,
  resourceVersion,
  resource,
  onSaved,
  images = [],
}: {
  resourceId: string;
  resourceVersion: number;
  resource?: SchoolResource;
  onSaved?: (next: SchoolResource) => void;
  images?: SchoolResource[];
}) {
  const [queue, setQueue] = useState<StudyQueue | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [progress, setProgress] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setQueue(await api(`classes/resources/${resourceId}/study`));
      setFlipped(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Study queue unavailable",
      );
    } finally {
      setBusy(false);
    }
  }, [resourceId]);
  useEffect(() => {
    void refresh();
  }, [refresh, resourceVersion]);
  const card = queue?.cards[0];
  async function review(rating: Rating) {
    if (!card || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<ReviewResult>(
        `classes/resources/${resourceId}/study/review`,
        "POST",
        {
          cardKey: card.cardKey,
          reviewToken: card.reviewToken,
          reviewVersion: card.reviewVersion,
          rating,
        },
      );
      setQueue((previous) =>
        previous
          ? {
              ...previous,
              totalCards: result.totalCards,
              dueCount: result.dueCount,
              nextDueAt: result.nextDueAt,
              cards: previous.cards.filter(
                (item) => item.cardKey !== card.cardKey,
              ),
            }
          : previous,
      );
      setFlipped(false);
      setMessage(
        `Review saved. Next due ${new Date(result.dueAt).toLocaleString()}.`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <strong>Scheduled study</strong>
        <span className={styles.muted}>
          {queue
            ? `${queue.dueCount} due · ${queue.totalCards} cards`
            : "Loading your due cards…"}
        </span>
        <button disabled={busy} onClick={() => void refresh()}>
          Refresh due queue
        </button>
        <button onClick={() => setProgress(!progress)}>
          {progress ? "Hide progress" : "Review history and statistics"}
        </button>
      </div>
      <p className={styles.muted}>
        Your review history is private. Flip the card, then choose how well you
        recalled it.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {card ? (
        <>
          {resource?.editable && onSaved && (
            <button disabled={busy} onClick={() => setEditing(!editing)}>
              Edit current card
            </button>
          )}
          {editing && resource && onSaved && (
            <StudyCardEditor
              key={`${card.cardKey}:${resource.version}`}
              resource={resource}
              index={card.index}
              images={images}
              onCancel={() => setEditing(false)}
              onSaved={(next) => {
                setEditing(false);
                onSaved(next);
              }}
            />
          )}
          <button
            className={styles.study}
            disabled={busy}
            onClick={() => setFlipped(!flipped)}
          >
            <span className={styles.muted}>
              {flipped ? "Answer" : "Question"} · reviewed {card.reviewCount}{" "}
              times
            </span>
            {card.imageResourceId && (
              <img
                src={`/api/classes/files/${card.imageResourceId}`}
                alt="Flashcard illustration"
                style={{ maxWidth: "100%", maxHeight: 180, margin: "auto" }}
              />
            )}
            <strong>{flipped ? card.back : card.front}</strong>
            <span>Tap to flip</span>
          </button>
          <div className={styles.row}>
            {(["again", "hard", "good", "easy"] as Rating[]).map((rating) => (
              <button
                key={rating}
                disabled={busy || !flipped}
                onClick={() => void review(rating)}
              >
                {rating.charAt(0).toUpperCase() + rating.slice(1)}
              </button>
            ))}
          </div>
        </>
      ) : queue ? (
        <div className={styles.notice}>
          {queue.dueCount > 0 ? (
            <>
              <p>More due cards are ready.</p>
              <button disabled={busy} onClick={() => void refresh()}>
                Load more due cards
              </button>
            </>
          ) : (
            <>
              <strong>No cards due right now.</strong>
              {queue.nextDueAt && (
                <p>Next due {new Date(queue.nextDueAt).toLocaleString()}.</p>
              )}
              {!queue.totalCards && (
                <p>Add flashcards to begin scheduled study.</p>
              )}
            </>
          )}
        </div>
      ) : null}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {progress && (
        <StudyProgress
          resourceId={resourceId}
          refreshKey={`${resourceVersion}:${message}`}
        />
      )}
    </div>
  );
}
