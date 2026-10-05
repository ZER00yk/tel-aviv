"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type SchoolResource } from "./api";
import ScheduledStudy from "./ScheduledStudy";
import StudyProgress from "./StudyProgress";
import QuizInsights from "./QuizInsights";
import styles from "./Workspace.module.css";
type Card = {
  front: string;
  back: string;
  tags?: string[];
  imageResourceId?: string | null;
};
type Question = {
  prompt: string;
  type: "multiple-choice" | "multi-select" | "true-false" | "short-answer";
  options: string[];
  answer?: string | string[];
};
export function Flashcards({
  resource,
  onSaved,
  images = [],
}: {
  resource: SchoolResource;
  onSaved: (resource: SchoolResource) => void;
  images?: SchoolResource[];
}) {
  const [cards, setCards] = useState((resource.data.cards ?? []) as Card[]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState(false);
  useEffect(() => {
    setCards((resource.data.cards ?? []) as Card[]);
    setIndex(0);
    setFlipped(false);
  }, [resource.version]);
  const filtered = cards.filter((card) =>
    `${card.front} ${card.back} ${(card.tags ?? []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const current = filtered[index % Math.max(1, filtered.length)];
  async function save() {
    try {
      const next = await api<SchoolResource>(
        `classes/resources/${resource.id}`,
        "PATCH",
        { expectedVersion: resource.version, data: { cards } },
      );
      onSaved(next);
      setCards(next.data.cards as Card[]);
      setIndex(0);
      setEditing(false);
      setMessage("Deck saved");
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <span>{cards.length} cards</span>
        {!scheduled && (
          <button onClick={() => setProgress(!progress)}>
            {progress ? "Hide progress" : "Deck statistics"}
          </button>
        )}
        <button
          onClick={() => {
            setScheduled(!scheduled);
            setEditing(false);
          }}
        >
          {scheduled ? "Study all cards" : "Study due cards"}
        </button>
        {resource.editable && (
          <button onClick={() => setEditing(!editing)}>
            {editing ? "Study" : "Edit deck"}
          </button>
        )}
      </div>
      {scheduled && !editing ? (
        <ScheduledStudy
          resourceId={resource.id}
          resourceVersion={resource.version}
          resource={resource}
          onSaved={onSaved}
          images={images}
        />
      ) : editing ? (
        <>
          <p className={styles.muted}>
            One card per line: front | back | optional comma-separated tags
          </p>
          <textarea
            aria-label="Flashcard deck"
            value={cards
              .map(
                (card) =>
                  `${card.front} | ${card.back} | ${(card.tags ?? []).join(",")}`,
              )
              .join("\n")}
            onChange={(event) =>
              setCards(
                event.target.value.split("\n").map((line, cardIndex) => {
                  const [front = "", back = "", tags = ""] = line.split("|");
                  return {
                    front: front.trim(),
                    back: back.trim(),
                    imageResourceId: cards[cardIndex]?.imageResourceId ?? null,
                    tags: tags
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  };
                }),
              )
            }
          />
          {cards.map((card, cardIndex) => (
            <label key={cardIndex}>
              Image for card {cardIndex + 1}
              <select
                aria-label={`Image for card ${cardIndex + 1}`}
                value={card.imageResourceId ?? ""}
                onChange={(event) =>
                  setCards(
                    cards.map((item, i) =>
                      i === cardIndex
                        ? {
                            ...item,
                            imageResourceId: event.target.value || null,
                          }
                        : item,
                    ),
                  )
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
          ))}
          <p className={styles.muted}>
            Images use protected class uploads. Share the image itself or its
            folder to let a deck recipient view it.
          </p>
          <button className={styles.primary} onClick={save}>
            Save deck
          </button>
        </>
      ) : cards.length ? (
        <>
          <input
            aria-label="Search flashcards"
            placeholder="Search questions, answers and tags"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setIndex(0);
              setFlipped(false);
            }}
          />
          {!filtered.length ? (
            <p>No cards match this search.</p>
          ) : (
            <>
              <button
                className={styles.study}
                onClick={() => setFlipped(!flipped)}
              >
                <span className={styles.muted}>
                  {(index % filtered.length) + 1} / {filtered.length} ·{" "}
                  {flipped ? "Answer" : "Question"}
                </span>
                {current?.imageResourceId && (
                  <img
                    src={`/api/classes/files/${current.imageResourceId}`}
                    alt="Flashcard illustration"
                    style={{ maxWidth: "100%", maxHeight: 180, margin: "auto" }}
                  />
                )}
                <strong>{flipped ? current?.back : current?.front}</strong>
                <span>Tap to flip</span>
              </button>
              <div className={styles.row}>
                <button
                  onClick={() => {
                    setIndex((index + filtered.length - 1) % filtered.length);
                    setFlipped(false);
                  }}
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    setIndex((index + 1) % filtered.length);
                    setFlipped(false);
                  }}
                >
                  Next
                </button>
                <button
                  onClick={() => {
                    setIndex(Math.floor(Math.random() * filtered.length));
                    setFlipped(false);
                  }}
                >
                  Random card
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <p>Add cards to begin studying.</p>
      )}
      <span role="status" className={styles.muted}>
        {message}
      </span>
      {progress && !scheduled && (
        <StudyProgress resourceId={resource.id} refreshKey={resource.version} />
      )}
    </div>
  );
}
export function Quiz({
  resource,
  onSaved,
}: {
  resource: SchoolResource;
  onSaved: (resource: SchoolResource) => void;
}) {
  const [questions, setQuestions] = useState(
    (resource.data.questions ?? []) as Question[],
  );
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<{
    score: number;
    total: number;
    results: { index: number; correct: boolean; answer: string | string[] }[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [insights, setInsights] = useState(false);
  const order = useMemo(() => {
    const indices = questions.map((_, index) => index);
    if (resource.data.randomOrder !== false) {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
    }
    return indices;
  }, [questions, resource.data.randomOrder, round]);
  function update(index: number, value: Partial<Question>) {
    setQuestions(
      questions.map((question, i) =>
        i === index ? { ...question, ...value } : question,
      ),
    );
  }
  async function save() {
    try {
      const next = await api<SchoolResource>(
        `classes/resources/${resource.id}`,
        "PATCH",
        {
          expectedVersion: resource.version,
          data: { questions, randomOrder: true },
        },
      );
      onSaved(next);
      setQuestions(next.data.questions as Question[]);
      setResult(null);
      setAnswers({});
      setEditing(false);
      setMessage("Quiz saved");
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function submit() {
    try {
      setResult(
        await api(`classes/resources/${resource.id}/attempt`, "POST", {
          answers: questions.map((_, index) => answers[index] ?? ""),
        }),
      );
    } catch (error) {
      setMessage(String(error));
    }
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <span>{questions.length} questions</span>
        <button onClick={() => setInsights(!insights)}>
          {insights ? "Hide result history" : "Results and analytics"}
        </button>
        {resource.editable && (
          <button onClick={() => setEditing(!editing)}>
            {editing ? "Take quiz" : "Edit questions"}
          </button>
        )}
      </div>
      {editing ? (
        <>
          {questions.map((question, index) => (
            <div className={styles.card} key={index}>
              <label>
                Question
                <input
                  value={question.prompt}
                  onChange={(event) =>
                    update(index, { prompt: event.target.value })
                  }
                />
              </label>
              <select
                aria-label="Question type"
                value={question.type}
                onChange={(event) =>
                  update(index, {
                    type: event.target.value as Question["type"],
                    options: [],
                    answer: event.target.value === "multi-select" ? [] : "",
                  })
                }
              >
                <option value="short-answer">Short answer</option>
                <option value="multiple-choice">Multiple choice</option>
                <option value="multi-select">Multi-select</option>
                <option value="true-false">True / false</option>
              </select>
              {["multiple-choice", "multi-select"].includes(question.type) && (
                <label>
                  Choices, one per line
                  <textarea
                    value={question.options.join("\n")}
                    onChange={(event) =>
                      update(index, { options: event.target.value.split("\n") })
                    }
                  />
                </label>
              )}
              {question.type === "multi-select" ? (
                <fieldset>
                  <legend>Correct choices</legend>
                  {question.options.map((option) => (
                    <label key={option}>
                      <span>
                        <input
                          type="checkbox"
                          checked={
                            Array.isArray(question.answer) &&
                            question.answer.includes(option)
                          }
                          onChange={(event) =>
                            update(index, {
                              answer: event.target.checked
                                ? [
                                    ...(Array.isArray(question.answer)
                                      ? question.answer
                                      : []),
                                    option,
                                  ]
                                : (Array.isArray(question.answer)
                                    ? question.answer
                                    : []
                                  ).filter((answer) => answer !== option),
                            })
                          }
                        />
                        {option}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <label>
                  Correct answer
                  <input
                    value={
                      typeof question.answer === "string" ? question.answer : ""
                    }
                    onChange={(event) =>
                      update(index, { answer: event.target.value })
                    }
                  />
                </label>
              )}
              <button
                onClick={() =>
                  setQuestions(questions.filter((_, i) => i !== index))
                }
              >
                Remove question
              </button>
            </div>
          ))}
          <div className={styles.row}>
            <button
              onClick={() =>
                setQuestions([
                  ...questions,
                  { prompt: "", type: "short-answer", options: [], answer: "" },
                ])
              }
            >
              Add question
            </button>
            <button className={styles.primary} onClick={save}>
              Save quiz
            </button>
          </div>
        </>
      ) : (
        <>
          {order.map((index, displayIndex) => {
            const question = questions[index];
            return (
              <div className={styles.card} key={index}>
                <strong>
                  {displayIndex + 1}. {question.prompt}
                </strong>
                {question.type === "short-answer" ? (
                  <input
                    aria-label={`Answer ${displayIndex + 1}`}
                    disabled={!!result}
                    value={
                      typeof answers[index] === "string" ? answers[index] : ""
                    }
                    onChange={(event) =>
                      setAnswers({ ...answers, [index]: event.target.value })
                    }
                  />
                ) : (
                  <div className={styles.row}>
                    {(question.type === "true-false"
                      ? ["true", "false"]
                      : question.options
                    ).map((option) => (
                      <button
                        disabled={!!result}
                        className={
                          answers[index] === option ||
                          (Array.isArray(answers[index]) &&
                            answers[index].includes(option))
                            ? styles.active
                            : ""
                        }
                        key={option}
                        onClick={() =>
                          setAnswers({
                            ...answers,
                            [index]:
                              question.type === "multi-select"
                                ? Array.isArray(answers[index]) &&
                                  answers[index].includes(option)
                                  ? answers[index].filter(
                                      (answer) => answer !== option,
                                    )
                                  : [
                                      ...(Array.isArray(answers[index])
                                        ? answers[index]
                                        : []),
                                      option,
                                    ]
                                : option,
                          })
                        }
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {result && (
                  <span
                    className={
                      result.results[index].correct
                        ? styles.success
                        : styles.muted
                    }
                  >
                    {result.results[index].correct
                      ? "Correct"
                      : `Answer: ${Array.isArray(result.results[index].answer) ? result.results[index].answer.join(", ") : result.results[index].answer}`}
                  </span>
                )}
              </div>
            );
          })}
          {result ? (
            <div className={styles.notice}>
              <strong>
                Score: {result.score} / {result.total}
              </strong>
              <button
                onClick={() => {
                  setAnswers({});
                  setResult(null);
                  setRound(round + 1);
                }}
              >
                Retry with new order
              </button>
            </div>
          ) : (
            <button className={styles.primary} onClick={submit}>
              Submit answers
            </button>
          )}
        </>
      )}
      <span role="status">{message}</span>
      {insights && (
        <QuizInsights
          resourceId={resource.id}
          owner={resource.owned === true}
          refreshKey={`${resource.version}:${result?.score ?? "none"}:${round}`}
        />
      )}
    </div>
  );
}
