import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "../apps/web/components/classes/Markdown";
import {
  resourceData,
  scoreQuiz,
} from "../packages/platform/src/classes/models";

describe("school math and quiz depth", () => {
  it("typesets bounded fractions, roots, matrices and scientific notation without interpreting HTML", () => {
    const value =
      "# Physics\nInline $E=mc^2$, $\\frac{a_1}{\\sqrt{b}}$\n$$\n\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\n$$\n<script>alert(1)</script>\n1. First\n2. Second";
    const html = renderToStaticMarkup(React.createElement(Markdown, { value }));
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>First");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("keeps code literal and rejects executable math links and unbounded macro expansion", () => {
    const value =
      "`$literal$` $\\href{javascript:alert(1)}{bad}$ $\\def\\loop{\\loop}\\loop$";
    const html = renderToStaticMarkup(React.createElement(Markdown, { value }));
    expect(html).toContain("<code>$literal$</code>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("katex-error");
  });
  it("caps expensive math expressions while preserving escaped source", () => {
    const html = renderToStaticMarkup(
      React.createElement(Markdown, {
        value: Array(105).fill("$x^2$").join(" "),
      }),
    );
    expect(html.match(/class="katex"/g)).toHaveLength(100);
    expect(html).toContain("<code>$x^2$</code>");
  });
  it("requires exact unordered multi-select sets and preserves the submitted answer in breakdowns", () => {
    const quiz = resourceData.quiz.parse({
      questions: [
        {
          prompt: "Prime numbers?",
          type: "multi-select",
          options: ["2", "3", "4"],
          answer: ["2", "3"],
        },
        { prompt: "True?", type: "true-false", answer: "true" },
      ],
    });
    const score = scoreQuiz(quiz, [["3", "2"], " TRUE "]);
    expect(score.score).toBe(2);
    expect(score.results[0].submitted).toEqual(["3", "2"]);
    expect(scoreQuiz(quiz, [["2"], "true"]).score).toBe(1);
    expect(scoreQuiz(quiz, [["2", "3", "3"], "true"]).score).toBe(1);
  });
  it("rejects wrong or duplicated answer sets and maintains existing assignment compatibility", () => {
    for (const answer of [["2", "2"], ["5"], "2"])
      expect(
        resourceData.quiz.safeParse({
          questions: [
            { prompt: "Q", type: "multi-select", options: ["2", "3"], answer },
          ],
        }).success,
      ).toBe(false);
    expect(
      resourceData.assignment.parse({
        description: "Existing",
        dueDate: null,
        status: "done",
        priority: "normal",
        links: [],
        attachments: [],
      }),
    ).toMatchObject({ notes: "", status: "done" });
  });
});
