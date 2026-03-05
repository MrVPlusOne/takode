import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import diff from "highlight.js/lib/languages/diff";
import markdown from "highlight.js/lib/languages/markdown";

let languagesRegistered = false;

function ensureLanguagesRegistered() {
  if (languagesRegistered) return;
  languagesRegistered = true;

  hljs.registerLanguage("python", python);
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("shell", bash);
  hljs.registerLanguage("sh", bash);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("cpp", cpp);
  hljs.registerLanguage("c", cpp);
  hljs.registerLanguage("yaml", yaml);
  hljs.registerLanguage("yml", yaml);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("diff", diff);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("md", markdown);
  hljs.registerLanguage("js", javascript);
  hljs.registerLanguage("ts", typescript);
  hljs.registerLanguage("py", python);
}

function normalizeFileName(filePath: string | null | undefined): string {
  if (!filePath) return "";
  const normalized = filePath.trim().replace(/\\/g, "/");
  const parts = normalized.split("/");
  return (parts[parts.length - 1] || "").toLowerCase();
}

function normalizeExt(filePath: string | null | undefined): string {
  const fileName = normalizeFileName(filePath);
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot);
}

export function inferLanguageFromPath(filePath: string | null | undefined): string | null {
  const fileName = normalizeFileName(filePath);
  const ext = normalizeExt(filePath);

  if (!fileName) return null;
  if (fileName === "dockerfile") return "bash";
  if (fileName === "makefile") return "bash";

  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "bash";
    case ".json":
      return "json";
    case ".html":
    case ".xml":
    case ".svg":
      return "xml";
    case ".css":
    case ".scss":
    case ".less":
      return "css";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".c":
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".h":
    case ".hpp":
      return "cpp";
    case ".yml":
    case ".yaml":
      return "yaml";
    case ".sql":
      return "sql";
    case ".md":
      return "markdown";
    case ".diff":
    case ".patch":
      return "diff";
    default:
      return null;
  }
}

export function highlightCode(code: string, language: string | null | undefined): string | null {
  if (!language) return null;
  ensureLanguagesRegistered();
  if (!hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return null;
  }
}

interface OpenTag {
  name: string;
  html: string;
}

function parseTagName(tag: string): string | null {
  const m = tag.match(/^<\/?\s*([a-zA-Z0-9:-]+)/);
  return m ? m[1].toLowerCase() : null;
}

function isClosingTag(tag: string): boolean {
  return /^<\//.test(tag);
}

function isSelfClosingTag(tag: string): boolean {
  return /\/>$/.test(tag) || /^<!/.test(tag);
}

function reopenTags(stack: OpenTag[]): string {
  return stack.map((item) => item.html).join("");
}

export function splitHighlightedHtmlByLine(highlightedHtml: string): string[] {
  const tokens = highlightedHtml.split(/(<[^>]+>)/g).filter(Boolean);
  const stack: OpenTag[] = [];
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    if (token.startsWith("<")) {
      const name = parseTagName(token);
      current += token;
      if (!name) continue;

      if (isClosingTag(token)) {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === name) {
            stack.splice(i, 1);
            break;
          }
        }
      } else if (!isSelfClosingTag(token)) {
        stack.push({ name, html: token });
      }
      continue;
    }

    let rest = token;
    while (rest.length > 0) {
      const newline = rest.indexOf("\n");
      if (newline < 0) {
        current += rest;
        break;
      }
      current += rest.slice(0, newline);
      lines.push(current);
      current = reopenTags(stack);
      rest = rest.slice(newline + 1);
    }
  }

  lines.push(current);
  return lines;
}

export function splitSourceToLines(source: string): string[] {
  if (!source) return [];
  const lines = source.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function buildHighlightedLines(source: string, language: string | null | undefined): string[] | null {
  if (!source || !language) return null;
  const sourceLines = splitSourceToLines(source);
  if (sourceLines.length === 0) return null;
  const highlighted = highlightCode(source, language);
  if (!highlighted) return null;

  const highlightedLines = splitHighlightedHtmlByLine(highlighted);
  if (highlightedLines.length > sourceLines.length) {
    highlightedLines.length = sourceLines.length;
  }
  while (highlightedLines.length < sourceLines.length) {
    highlightedLines.push("");
  }
  return highlightedLines;
}
