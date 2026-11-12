import { inflateRawSync } from "node:zlib";

/**
 * The text of a PowerPoint file's slides, for the Library: each shown slide's title, the rest of
 * its text and its speaker notes, in presentation order. Hidden slides are left out, as LibreOffice
 * leaves them out of the slide pictures agents publish with a deck. Read with a small zip reader
 * and pattern matching on the slide XML, which is all this needs; text in charts, tables drawn as
 * pictures and SmartArt is not read.
 */

export interface PptxSlideText {
  /** The title placeholder's text; empty when the slide has none. */
  title: string;
  /** The slide's other text, one paragraph per line. */
  text: string;
  /** The speaker notes, one paragraph per line. */
  notes: string;
}

/** Reads the slides of a .pptx file; throws when it is not one. */
export function readPptxSlides(data: Uint8Array): PptxSlideText[] {
  const files = readZip(data);
  const text = (path: string) => {
    const entry = files.get(path);
    return entry ? new TextDecoder().decode(entry()) : null;
  };
  const presentation = text("ppt/presentation.xml");
  const presentationRels = text("ppt/_rels/presentation.xml.rels");
  if (!presentation || !presentationRels) throw new Error("This is not a PowerPoint (.pptx) file.");
  const targets = relationshipTargets(presentationRels);
  const slides: PptxSlideText[] = [];
  for (const match of presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const target = targets.get(match[1]!);
    if (!target) continue;
    const path = joinPath("ppt", target);
    const xml = text(path);
    if (!xml || /<p:sld\b[^>]*\bshow="(?:0|false)"/.test(xml)) continue;
    const slideRels = text(relsPathOf(path));
    const notesTarget = slideRels ? notesTargetOf(slideRels) : undefined;
    const notesXml = notesTarget ? text(joinPath(dirOf(path), notesTarget)) : null;
    const shapes = shapesOf(xml);
    const isTitle = (shape: string) => /<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/.test(shape);
    let titleLines = shapes.filter(isTitle).flatMap(paragraphsOf);
    let bodyLines = shapes.filter((shape) => !isTitle(shape)).flatMap(paragraphsOf);
    // Slides built from text boxes have no title placeholder: their title is the largest text.
    if (titleLines.length === 0) {
      const largest = Math.max(0, ...bodyLines.map((line) => line.size));
      const index = largest > 0 ? bodyLines.findIndex((line) => line.size === largest) : -1;
      if (index >= 0) {
        titleLines = [bodyLines[index]!];
        bodyLines = bodyLines.filter((_, position) => position !== index);
      }
    }
    slides.push({
      title: titleLines
        .map((line) => line.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      text: bodyLines.map((line) => line.text).join("\n"),
      notes: notesXml
        ? shapesOf(notesXml)
            .filter((shape) => /<p:ph\b[^>]*\btype="body"/.test(shape))
            .flatMap(paragraphsOf)
            .map((line) => line.text)
            .join("\n")
        : "",
    });
  }
  return slides;
}

/** The files of a zip archive, by path, each read (and inflated) on demand. */
function readZip(data: Uint8Array): Map<string, () => Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  // The end record sits in the last 22 bytes plus at most a 64 KiB comment.
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 65_535); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("This is not a PowerPoint (.pptx) file.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, () => Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > data.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new Error("The .pptx file is damaged.");
    }
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength));
    files.set(name, () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const stored = data.subarray(start, start + size);
      if (method === 0) return stored;
      if (method === 8) return inflateRawSync(stored);
      throw new Error(`Unsupported compression in ${name}.`);
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function relationshipTargets(rels: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(match[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(match[0])?.[1];
    if (id && target) targets.set(id, target);
  }
  return targets;
}

function notesTargetOf(rels: string): string | undefined {
  for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (/\bType="[^"]*\/notesSlide"/.test(match[0])) return /\bTarget="([^"]+)"/.exec(match[0])?.[1];
  }
  return undefined;
}

/** Shapes holding text (`p:sp`), in document order. */
function shapesOf(xml: string): string[] {
  return [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);
}

/** A shape's non-empty paragraphs, each with its largest font size (hundredths of a point; 0 when unset). */
function paragraphsOf(shape: string): Array<{ text: string; size: number }> {
  return [...shape.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
    .map((paragraph) => ({
      text: [...paragraph[1]!.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
        .map((run) => decodeEntities(run[1]!))
        .join("")
        .trim(),
      size: Math.max(0, ...[...paragraph[1]!.matchAll(/\bsz="(\d+)"/g)].map((size) => Number(size[1]))),
    }))
    .filter((line) => line.text);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name.toLowerCase()] ?? whole;
  });
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function relsPathOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return `${path.slice(0, slash)}/_rels/${path.slice(slash + 1)}.rels`;
}

/** A relationship target resolved against its part's folder (targets may start with `../` or `/`). */
function joinPath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}
