"use client";
import { useEffect, useState } from "react";
import { api } from "../classes/api";
type Report = {
  id: string;
  title: string | null;
  reason: string;
  details: string;
  status: string;
  reporter: string | null;
  created_at: string;
  review_note: string | null;
};
export default function ReportReview() {
  const [reports, setReports] = useState<Report[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setReports(await api("admin/creator-reports"));
  }
  useEffect(() => {
    let active = true;
    api<Report[]>("admin/creator-reports")
      .then((rows) => {
        if (active) setReports(rows);
      })
      .catch((error) => {
        if (active) setMessage(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  async function review(id: string, status: "reviewed" | "dismissed") {
    if (busy) return;
    setBusy(true);
    try {
      await api(`admin/creator-reports/${id}`, "POST", {
        status,
        note: notes[id] ?? "",
      });
      await refresh();
      setMessage("Review saved in the administrative audit trail.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Creator reports</h2>
      <p>
        Review reports without changing the level. Private draft titles and
        level contents are withheld.
      </p>
      {reports.length === 0 && <p>No reports to review.</p>}
      {reports.map((report) => (
        <article className="admin-result" key={report.id}>
          <h3>
            {report.title ?? "Unpublished level"} · {report.status}
          </h3>
          <p>
            {report.reason} · {report.reporter ?? "Deleted account"} ·{" "}
            {new Date(report.created_at).toLocaleString()}
          </p>
          <p>{report.details}</p>
          {report.status === "open" ? (
            <>
              <label>
                Review note
                <input
                  aria-label={`Review note ${report.id}`}
                  maxLength={500}
                  value={notes[report.id] ?? ""}
                  onChange={(event) =>
                    setNotes({ ...notes, [report.id]: event.target.value })
                  }
                />
              </label>
              <button
                className="button"
                disabled={busy || !notes[report.id]?.trim()}
                onClick={() => void review(report.id, "reviewed")}
              >
                Mark reviewed
              </button>
              <button
                className="button"
                disabled={busy || !notes[report.id]?.trim()}
                onClick={() => void review(report.id, "dismissed")}
              >
                Dismiss report
              </button>
            </>
          ) : (
            <p>{report.review_note}</p>
          )}
        </article>
      ))}
      <p role="status">{message}</p>
    </section>
  );
}
