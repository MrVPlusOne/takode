import { deflateRawSync } from "node:zlib";

/**
 * A minimal PowerPoint (.pptx) file for tests: the presentation, its slides (title placeholders or
 * plain text boxes with font sizes), hidden slides and speaker notes, zipped as PowerPoint does
 * (deflated entries, a central directory). Enough for the Library's slide text reader.
 */

export interface TestSlide {
  /** Text in the slide's title placeholder. */
  title?: string;
  /** Text boxes, with a font size in hundredths of a point. */
  boxes?: Array<{ text: string; size?: number }>;
  notes?: string;
  hidden?: boolean;
}

export function makePptx(slides: TestSlide[]): Uint8Array {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
      .join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships>${slides
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 2}" Type="http://schemas/slide" Target="slides/slide${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  };
  slides.forEach((slide, index) => {
    const number = index + 1;
    const shapes = [
      slide.title !== undefined && shape(`<p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`, slide.title),
      ...(slide.boxes ?? []).map((box) => shape("", box.text, box.size)),
    ].filter(Boolean);
    files[`ppt/slides/slide${number}.xml`] =
      `<p:sld xmlns:p="p" xmlns:a="a"${slide.hidden ? ' show="0"' : ""}><p:cSld><p:spTree>${shapes.join("")}</p:spTree></p:cSld></p:sld>`;
    if (slide.notes === undefined) return;
    files[`ppt/slides/_rels/slide${number}.xml.rels`] =
      `<Relationships><Relationship Id="rId1" Type="http://schemas/notesSlide" Target="../notesSlides/notesSlide${number}.xml"/></Relationships>`;
    files[`ppt/notesSlides/notesSlide${number}.xml`] = `<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${shape(
      `<p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr>`,
      "",
    )}${shape(`<p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>`, slide.notes)}</p:spTree></p:cSld></p:notes>`;
  });
  return zip(files);
}

/** A shape whose text has one paragraph per line, XML-escaped. */
function shape(properties: string, text: string, size?: number): string {
  const paragraphs = text
    .split("\n")
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US"${size ? ` sz="${size}"` : ""}/><a:t>${line
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</a:t></a:r></a:p>`,
    )
    .join("");
  return `<p:sp>${properties}<p:txBody>${paragraphs}</p:txBody></p:sp>`;
}

/** A zip archive of deflated entries (CRCs are left zero: the reader under test does not check them). */
function zip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf-8");
    const raw = Buffer.from(text, "utf-8");
    const data = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
