import React from "react";
import { renderToString } from "katex";

interface RenderBudget {
  equations: number;
}
function math(source: string, display: boolean, budget: RenderBudget) {
  if (source.length > 4000 || budget.equations++ >= 100)
    return <code>{display ? `$$${source}$$` : `$${source}$`}</code>;
  // KaTeX is the sole HTML producer. User Markdown/HTML is always escaped by React.
  const html = renderToString(source, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: "warn",
    maxExpand: 100,
    maxSize: 20,
    output: "htmlAndMathml",
  });
  return (
    <span
      className={display ? "school-display-math" : "school-inline-math"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
function inline(text: string, budget: RenderBudget): React.ReactNode[] {
  const parts = text.split(
    /(`[^`]+`|\$\$[^$]+\$\$|\$(?:\\.|[^$\\\n])+\$|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|!?\[[^\]]*\]\((?:https?:\/\/[^)]+|\/api\/classes\/files\/[0-9a-f-]{36})\))/g,
  );
  return parts.map((part, index) => {
    let node: React.ReactNode = part;
    if (part.startsWith("`") && part.endsWith("`"))
      node = <code>{part.slice(1, -1)}</code>;
    else if (part.startsWith("$$") && part.endsWith("$$"))
      node = math(part.slice(2, -2), true, budget);
    else if (part.startsWith("$") && part.endsWith("$"))
      node = math(part.slice(1, -1), false, budget);
    else if (part.startsWith("**") && part.endsWith("**"))
      node = <strong>{part.slice(2, -2)}</strong>;
    else if (part.startsWith("__") && part.endsWith("__"))
      node = <u>{part.slice(2, -2)}</u>;
    else if (part.startsWith("*") && part.endsWith("*"))
      node = <em>{part.slice(1, -1)}</em>;
    else {
      const image = part.match(
        /^!\[([^\]]*)\]\((\/api\/classes\/files\/[0-9a-f-]{36})\)$/,
      );
      const link = part.match(
        /^\[([^\]]+)\]\((https?:\/\/[^)]+|\/api\/classes\/files\/[0-9a-f-]{36})\)$/,
      );
      if (image)
        node = (
          <img src={image[2]} alt={image[1]} style={{ maxWidth: "100%" }} />
        );
      else if (link)
        node = (
          <a href={link[2]} rel="noopener noreferrer" target="_blank">
            {link[1]}
          </a>
        );
    }
    return <React.Fragment key={index}>{node}</React.Fragment>;
  });
}
function cells(line: string) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
export default function Markdown({ value }: { value: string }) {
  const allLines=value.split("\n");
  const lines = allLines.slice(0,5000);
  const nodes: React.ReactNode[] = [];
  const budget: RenderBudget = { equations: 0 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const content: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith("```"))
        content.push(lines[i]);
      nodes.push(
        <pre key={i}>
          <code>{content.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.trim() === "$$") {
      const content: string[] = [];
      while (++i < lines.length && lines[i].trim() !== "$$")
        content.push(lines[i]);
      nodes.push(<div key={i}>{math(content.join("\n"), true, budget)}</div>);
      continue;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(
        lines[i + 1] ?? "",
      )
    ) {
      const header = cells(line);
      const align = cells(lines[++i]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":")
          ? "center"
          : cell.endsWith(":")
            ? "right"
            : "left",
      );
      const rows: string[][] = [];
      while ((lines[i + 1] ?? "").includes("|") && (lines[i + 1] ?? "").trim())
        rows.push(cells(lines[++i]));
      nodes.push(
        <div style={{ overflowX: "auto" }} key={i}>
          <table>
            <thead>
              <tr>
                {header.map((cell, k) => (
                  <th
                    key={k}
                    style={{
                      textAlign: align[k] as "left" | "right" | "center",
                    }}
                  >
                    {inline(cell, budget)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, k) => (
                <tr key={k}>
                  {header.map((_, j) => (
                    <td
                      key={j}
                      style={{
                        textAlign: align[j] as "left" | "right" | "center",
                      }}
                    >
                      {inline(row[j] ?? "", budget)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6}) (.*)$/);
    if (heading) {
      nodes.push(
        React.createElement(
          `h${heading[1].length}`,
          { key: i },
          inline(heading[2], budget),
        ),
      );
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      nodes.push(<hr key={i} />);
      continue;
    }
    if (line.startsWith("> ")) {
      const quotes = [line.slice(2)];
      while ((lines[i + 1] ?? "").startsWith("> "))
        quotes.push(lines[++i].slice(2));
      nodes.push(
        <blockquote key={i}>
          {quotes.map((quote, j) => (
            <p key={j}>{inline(quote, budget)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }
    const list = line.match(/^\s*(?:(\d+)\. |[-*+] )(.*)$/);
    if (list) {
      const ordered = !!list[1];
      const items: React.ReactNode[] = [];
      let current: RegExpMatchArray | null = list;
      do {
        const check = current[2].match(/^\[([ xX])\] (.*)$/);
        items.push(
          <li key={items.length}>
            {check ? (
              <>
                <input type="checkbox" readOnly checked={check[1] !== " "} />{" "}
                {inline(check[2], budget)}
              </>
            ) : (
              inline(current[2], budget)
            )}
          </li>,
        );
        const next = (lines[i + 1] ?? "").match(/^\s*(?:(\d+)\. |[-*+] )(.*)$/);
        if (!next || !!next[1] !== ordered) break;
        current = next;
        i++;
      } while (current);
      nodes.push(
        ordered ? (
          <ol key={i} start={Number(list[1])}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        ),
      );
      continue;
    }
    nodes.push(line ? <p key={i}>{inline(line, budget)}</p> : <br key={i} />);
  }
  return <>{nodes}{allLines.length>5000&&<p role="status">Preview shows the first 5,000 lines. All source text is retained in the editor.</p>}</>;
}
