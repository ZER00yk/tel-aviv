"use client";
import { useState } from "react";
import { api, type SchoolResource } from "./api";
import styles from "./Workspace.module.css";
interface Card {
  front: string;
  back: string;
  tags?: string[];
  imageResourceId?: string | null;
}
export default function StudyCardEditor({
  resource,
  index,
  images,
  onSaved,
  onCancel,
}: {
  resource: SchoolResource;
  index: number;
  images: SchoolResource[];
  onSaved: (next: SchoolResource) => void;
  onCancel: () => void;
}) {
  const cards = resource.data.cards as Card[];
  const [card, setCard] = useState(cards[index]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const next = await api<SchoolResource>(
        `classes/resources/${resource.id}`,
        "PATCH",
        {
          expectedVersion: resource.version,
          data: {
            cards: cards.map((current, i) => (i === index ? card : current)),
          },
        },
      );
      onSaved(next);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  if (!card) return null;
  return (
    <section className={styles.card} aria-label="Edit current flashcard">
      <h3>Edit this card</h3>
      <p className={styles.muted}>
        Changing its question, answer or image starts a new schedule. Your past
        review events remain in your private history.
      </p>
      <label>
        Question
        <textarea
          aria-label="Review card question"
          maxLength={2000}
          value={card.front}
          onChange={(event) => setCard({ ...card, front: event.target.value })}
        />
      </label>
      <label>
        Answer
        <textarea
          aria-label="Review card answer"
          maxLength={5000}
          value={card.back}
          onChange={(event) => setCard({ ...card, back: event.target.value })}
        />
      </label>
      <label>
        Image
        <select
          value={card.imageResourceId ?? ""}
          onChange={(event) =>
            setCard({ ...card, imageResourceId: event.target.value || null })
          }
        >
          <option value="">No image</option>
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.title}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.row}>
        <button
          disabled={busy || !card.front.trim() || !card.back.trim()}
          onClick={() => void save()}
        >
          Save card changes
        </button>
        <button disabled={busy} onClick={onCancel}>
          Cancel card changes
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
