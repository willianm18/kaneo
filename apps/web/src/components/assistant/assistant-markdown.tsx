import type { ReactNode } from "react";

/**
 * Small, dependency-free markdown renderer for assistant chat messages.
 *
 * The content comes from a language model whose behaviour can be steered by
 * task titles/descriptions it reads, so this MUST build React elements
 * directly — never `dangerouslySetInnerHTML` or string-concatenated HTML —
 * and must never throw on malformed input. Anything not explicitly
 * recognised falls back to plain visible text.
 */

type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; content: string };

const FENCE_RE = /^```/;
const HEADING_RE = /^(#{2,3})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;

function isBlockStart(line: string): boolean {
  return (
    line.trim() === "" ||
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line)
  );
}

function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (FENCE_RE.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      // If the fence was never closed, we've simply consumed the rest of the
      // input as code — that's fine, it still renders as visible text.
      if (i < lines.length) {
        i++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length === 2 ? 2 : 3,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    const ulMatch = line.match(UL_RE);
    if (ulMatch) {
      const items: string[] = [ulMatch[1]];
      i++;
      while (i < lines.length) {
        const m = lines[i].match(UL_RE);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const olMatch = line.match(OL_RE);
    if (olMatch) {
      const items: string[] = [olMatch[1]];
      i++;
      while (i < lines.length) {
        const m = lines[i].match(OL_RE);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join("\n") });
  }

  return blocks;
}

const INLINE_RE =
  /`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function isSafeHref(href: string): boolean {
  try {
    // A base is only needed for relative URLs; if `href` itself carries a
    // scheme (e.g. "javascript:...") it wins over the base, which is exactly
    // the case we need to catch.
    const url = new URL(href, "https://kaneo.invalid");
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  INLINE_RE.lastIndex = 0;

  let match: RegExpExecArray | null = INLINE_RE.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const [full, code, linkText, linkHref, bold, italic] = match;
    const nodeKey = `${keyPrefix}-i${key++}`;

    if (code !== undefined) {
      nodes.push(
        <code
          key={nodeKey}
          className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10"
        >
          {code}
        </code>,
      );
    } else if (linkText !== undefined && linkHref !== undefined) {
      if (isSafeHref(linkHref)) {
        nodes.push(
          <a
            key={nodeKey}
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {linkText}
          </a>,
        );
      } else {
        nodes.push(linkText);
      }
    } else if (bold !== undefined) {
      nodes.push(<strong key={nodeKey}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={nodeKey}>{italic}</em>);
    } else {
      nodes.push(full);
    }

    lastIndex = match.index + full.length;
    match = INLINE_RE.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

type AssistantMarkdownProps = {
  content: string;
};

function AssistantMarkdown({ content }: AssistantMarkdownProps) {
  let blocks: Block[];
  try {
    blocks = parseBlocks(content);
  } catch {
    return <p className="whitespace-pre-wrap">{content}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        const key = `b${index}`;

        switch (block.type) {
          case "heading":
            return block.level === 2 ? (
              <h2 key={key} className="font-semibold text-sm">
                {renderInline(block.text, key)}
              </h2>
            ) : (
              <h3 key={key} className="font-semibold text-sm">
                {renderInline(block.text, key)}
              </h3>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded bg-black/10 p-2 font-mono text-xs dark:bg-white/10"
              >
                <code>{block.content}</code>
              </pre>
            );
          case "ul":
            return (
              <ul key={key} className="list-disc space-y-0.5 pl-4">
                {block.items.map((item) => (
                  <li key={`${key}-${item}`}>
                    {renderInline(item, `${key}-${item}`)}
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal space-y-0.5 pl-4">
                {block.items.map((item) => (
                  <li key={`${key}-${item}`}>
                    {renderInline(item, `${key}-${item}`)}
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={key} className="whitespace-pre-wrap">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

export default AssistantMarkdown;
