"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import styles from "./Workspace.module.css";
interface Attempt {
  id: string;
  score: number;
  total: number;
  resource_version: number | null;
  created_at: string;
  breakdown: {
    index: number;
    prompt: string;
    submitted: string | string[];
    answer: string | string[];
    correct: boolean;
  }[];
}
interface Analytics {
  attempts: number;
  learners: number;
  average_percent: string | null;
  resourceVersion: number;
  questions: { index: number; attempts: number; correct: number }[];
}
export default function QuizInsights({
  resourceId,
  owner,
  refreshKey,
}: {
  resourceId: string;
  owner: boolean;
  refreshKey: string | number;
}) {
  const [attempts, setAttempts] = useState<Attempt[]>([]),
    [analytics, setAnalytics] = useState<Analytics | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Attempt[]>(`classes/resources/${resourceId}/attempts`),
      owner
        ? api<Analytics>(`classes/resources/${resourceId}/analytics`)
        : Promise.resolve(null),
    ])
      .then(([rows, summary]) => {
        if (active) {
          setAttempts(rows);
          setAnalytics(summary);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [resourceId, owner, refreshKey]);
  const display = (value: string | string[]) =>
    Array.isArray(value) ? value.join(", ") : value;
  return (
    <section className={styles.card} aria-label="Quiz results and analytics">
      <h3>Your result history</h3>
      {error && <p role="alert">{error}</p>}
      {attempts.map((attempt) => (
        <details key={attempt.id}>
          <summary>
            {new Date(attempt.created_at).toLocaleString()} · {attempt.score} /{" "}
            {attempt.total}
            {attempt.resource_version
              ? ` · quiz v${attempt.resource_version}`
              : ""}
          </summary>
          {attempt.breakdown.length ? (
            attempt.breakdown.map((question) => (
              <div key={question.index}>
                <strong>{question.prompt}</strong>
                <p className={question.correct ? styles.success : styles.muted}>
                  {question.correct ? "Correct" : "Incorrect"} · Your answer:{" "}
                  {display(question.submitted) || "No answer"} · Expected:{" "}
                  {display(question.answer)}
                </p>
              </div>
            ))
          ) : (
            <p>Question breakdown was not recorded for this older attempt.</p>
          )}
        </details>
      ))}
      {!attempts.length && <p>No attempts yet.</p>}
      {analytics && (
        <>
          <h3>Quiz owner analytics</h3>
          <p>
            {analytics.attempts} attempts · {analytics.learners} learners ·{" "}
            {analytics.average_percent ?? "—"}% average
          </p>
          <p className={styles.muted}>
            Only aggregate counts are shown. Question accuracy covers the
            current quiz version; your own attempt details remain private.
          </p>
          {analytics.questions.map((question) => (
            <p key={question.index}>
              Question {question.index + 1}: {question.correct} /{" "}
              {question.attempts} correct (
              {Math.round((100 * question.correct) / question.attempts)}%)
            </p>
          ))}
        </>
      )}
    </section>
  );
}
