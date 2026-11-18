import { splitMessage } from "./telegram-rendering";

export function escapeMarkdownV2(text: string) {
  return text.replace(/[\\_*[\]()~\x60>#+\-=|{}.!]/g, "\\$&");
}

const escapeCode = (text: string) => text.replace(/[\\\x60]/g, "\\$&");
const inline =
  /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_\x60{|}~])|(\x60+)([^\n]+?)\2|(?<!!)\[([^\]\n]+)\]\((<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)\)|(\*\*|__|~~|\|\||\*|_)(?=\S)(.+?)(?<=\S)\6/g;

function span(text: string): string {
  let end = 0;
  let output = "";
  for (const match of text.matchAll(inline)) {
    output += escapeMarkdownV2(text.slice(end, match.index));
    end = match.index + match[0].length;
    const [source, escaped, ticks, code, title, destination, marker, body] =
      match;
    if (escaped) output += escapeMarkdownV2(escaped);
    else if (ticks) output += "\x60" + escapeCode(code!) + "\x60";
    else if (title && destination) {
      const url = destination.replace(/^<|>$/g, "");
      if (/^https?:\/\/[^\s]+$/i.test(url)) {
        output +=
          "[" +
          escapeMarkdownV2(title) +
          "](" +
          url.replace(/[)\\]/g, "\\$&") +
          ")";
      } else {
        output += escapeMarkdownV2(source);
      }
    } else {
      const delimiter =
        marker === "**" || marker === "__"
          ? "*"
          : marker === "~~"
            ? "~"
            : marker === "||"
              ? "||"
              : "_";
      output += delimiter + escapeMarkdownV2(body!) + delimiter;
    }
  }
  return output + escapeMarkdownV2(text.slice(end));
}

function line(text: string) {
  const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(text);
  if (heading) return "*" + escapeMarkdownV2(heading[1]!) + "*";
  const quote = /^ {0,3}> ?(.*)$/.exec(text);
  return quote ? ">" + span(quote[1]!) : span(text);
}

// Chunk source before adding Telegram escapes, and close/reopen long code
// blocks at chunk boundaries so each message is independently parseable.
export function markdownV2Messages(source: string) {
  const chunks: { plain: string; markdown: string }[] = [];
  const add = (plain: string, markdown: string) => {
    if (!plain.trim()) return;
    const previous = chunks.at(-1);
    if (
      previous &&
      previous.plain.length + plain.length <= 3800 &&
      previous.markdown.length + markdown.length <= 3800
    ) {
      previous.plain += plain;
      previous.markdown += markdown;
    } else chunks.push({ plain, markdown });
  };
  const addText = (text: string) => {
    for (const part of splitMessage(text, 1750))
      add(part, part.split("\n").map(line).join("\n"));
  };
  const text = source.replace(/\r\n?/g, "\n").replace(/\0/g, "�");
  const fences =
    /^ {0,3}(\x60{3,}|~{3,}) *([\w+-]{0,30})[^\n]*\n([\s\S]*?)^ {0,3}\1(?:\x60|~)*[ \t]*(?=\n|$)/gm;
  let end = 0;
  for (const match of text.matchAll(fences)) {
    addText(text.slice(end, match.index));
    const language = /^[a-z0-9_]{1,30}$/i.test(match[2]!) ? match[2]! : "";
    const fence = "\x60\x60\x60";
    for (const part of splitMessage(match[3]!, 1750)) {
      const block =
        fence +
        language +
        "\n" +
        part +
        (part.endsWith("\n") ? "" : "\n") +
        fence;
      add(
        block + "\n",
        fence +
          language +
          "\n" +
          escapeCode(part) +
          (part.endsWith("\n") ? "" : "\n") +
          fence +
          "\n",
      );
    }
    end = match.index + match[0].length;
  }
  addText(text.slice(end));
  return chunks;
}
