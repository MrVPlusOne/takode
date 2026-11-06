import * as z from "zod";
import { INPUT_TRACE_BATCH_SIZE } from "../shared/input-trace.js";

const count = z.number().int().nonnegative();
// Only the documented diagnostic fields cross this automatic-upload boundary. In particular,
// InputEvent.data, clipboard contents and arbitrary extra properties are never accepted.
const event = z
  .object({
    seq: count,
    trusted: z.boolean().optional(),
    t: count,
    type: z.enum([
      "keydown",
      "keyup",
      "pointerdown",
      "focusin",
      "focusout",
      "beforeinput",
      "textInput",
      "input",
      "paste",
      "compositionstart",
      "compositionend",
      "window-focus",
      "window-blur",
      "page-hidden",
      "page-visible",
      "composer-expanded",
      "composer-collapsed",
      "composer-paste",
      "draft-sync",
    ]),
    key: z.string().max(80).optional(),
    composing: z.boolean().optional(),
    target: z.string().max(200).optional(),
    active: z.string().max(200).optional(),
    length: count.optional(),
    selection: z.tuple([count, count]).optional(),
    inputType: z.string().max(80).optional(),
    clipboard: z
      .object({ types: z.array(z.string().max(100)).max(32), textLength: count, files: count })
      .strict()
      .optional(),
    outcome: z.enum(["default", "prevented", "stopped"]).optional(),
    before: count.optional(),
    after: count.optional(),
    detail: z.string().max(300).optional(),
  })
  .strict();

/** Validates automatic batches independently of the preserved manual-report log format. */
export const inputTraceBatchSchema = z
  .object({
    traceId: z.uuid(),
    recordingSince: count,
    userAgent: z.string().max(500),
    platform: z.string().max(100),
    events: z.array(event).min(1).max(INPUT_TRACE_BATCH_SIZE),
  })
  .strict();
