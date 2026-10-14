import remarkGfm, { type Options as RemarkGfmOptions } from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * GFM as Takode renders it. A single `~` stays literal, so paths such as
 * `com~apple~CloudDocs` or prose like `~/a and ~/b` and `~5 min` are not struck
 * through; `~~text~~` still is.
 */
export const REMARK_GFM_OPTIONS: RemarkGfmOptions = { singleTilde: false };

/** Parse-only processor with the renderer's syntax, for reading Markdown source structure before rendering. */
export const markdownSourceParser =
  typeof remarkGfm === "function"
    ? unified().use(remarkParse).use(remarkGfm, REMARK_GFM_OPTIONS).freeze()
    : unified().use(remarkParse).freeze();
