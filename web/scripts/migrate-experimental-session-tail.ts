/** One-use offline converter for the experimental tail format from acf493c51709c12b44db7a71581aa5a8e89ae2fb. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  historyCommitFrame,
  HistoryFrameWriter,
  historyPath,
  verifySessionHistory,
  readSessionHistory,
  type HistoryReference,
} from "../server/session-history-journal.js";
import { replaceSessionFile } from "../server/session-persistence-io.js";
import { ExperimentalTailSource, type SourceString } from "./experimental-tail-source.js";

interface FileIdentity {
  name: string;
  bytes: number;
  sha256: string;
}
interface MigrationEntry {
  id: string;
  originals: FileIdentity[];
  output?: { head: HistoryReference; files: FileIdentity[]; contentDigest: string };
  completed: boolean;
}
interface MigrationReceipt {
  version: 1;
  sourceDirectory: string;
  backupDirectory: string;
  inventory: string[];
  entries: MigrationEntry[];
  status: "preparing" | "complete" | "rolled-back";
}
export interface MigrationOptions {
  /** Exact offline session directory, without any implicit home/port default. */
  sessionsDirectory: string;
  /** Separate dedicated recovery directory. Original bundles are never removed. */
  backupDirectory: string;
  /** Operator confirms successful saving and actual server exit; file stability is also checked. */
  serverStopped: true;
  /** Restore only when current state still exactly matches the prepared conversion. */
  rollback?: boolean;
}

/** Validate, back up, stage and publish an offline conversion, or resume its exact receipt. */
export async function migrateExperimentalSessionTail(
  options: MigrationOptions,
): Promise<{ receipt: string; sessions: number; status: string }> {
  if (options.serverStopped !== true)
    throw new Error("Successful saving and actual server exit must be confirmed before conversion");
  if (!isAbsolute(options.sessionsDirectory) || !isAbsolute(options.backupDirectory))
    throw new Error("Explicit absolute source and backup paths are required");
  const sourceDirectory = await realpath(options.sessionsDirectory);
  // Resolve existing parent symlinks before checking that backups cannot overlap source data.
  const backupDirectory = join(await realpath(dirname(options.backupDirectory)), basename(options.backupDirectory));
  if (contains(sourceDirectory, backupDirectory) || contains(backupDirectory, sourceDirectory))
    throw new Error("Source and backup directories must be separate");
  const receiptPath = join(backupDirectory, "migration-receipt.json");
  let receipt: MigrationReceipt;
  try {
    const info = await lstat(backupDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Backup location must be a dedicated directory");
    receipt = JSON.parse(await readFile(receiptPath, "utf8")) as MigrationReceipt;
    if (
      receipt.version !== 1 ||
      receipt.sourceDirectory !== sourceDirectory ||
      receipt.backupDirectory !== backupDirectory ||
      !Array.isArray(receipt.entries)
    )
      throw new Error("Recovery receipt identity mismatch");
    for (const entry of receipt.entries) validateEntry(entry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (options.rollback) throw new Error("Rollback requires an existing verified receipt");
    // A nonempty incomplete directory is preserved for inspection, never adopted blindly.
    try {
      if ((await readdir(backupDirectory)).length) throw new Error("Backup directory has no valid receipt");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const inventory = await hotFiles(sourceDirectory);
    const entries: MigrationEntry[] = [];
    for (const name of inventory) {
      const id = name.slice(0, -5);
      await regularFile(join(sourceDirectory, name));
      const source = await ExperimentalTailSource.inspect(sourceDirectory, id);
      if (!source) continue;
      await source.close();
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Unsupported session filename");
      const originals: FileIdentity[] = [];
      for (const name of [`${id}.json`, `${id}.history.jsonl`, `${id}.tail.jsonl`]) {
        const identity = await optionalIdentity(sourceDirectory, name);
        if (identity) originals.push(identity);
      }
      entries.push({ id, originals, completed: false });
    }
    receipt = { version: 1, sourceDirectory, backupDirectory, inventory, entries, status: "preparing" };
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await saveReceipt(receiptPath, receipt);
  }
  await assertInventory(receipt);
  if (options.rollback) {
    await rollback(receiptPath, receipt);
    return { receipt: receiptPath, sessions: receipt.entries.length, status: receipt.status };
  }
  for (const entry of receipt.entries) {
    const originals = join(backupDirectory, entry.id, "originals");
    const output = join(backupDirectory, entry.id, "output");
    // Check each parent before creating a child, so a changed recovery directory
    // cannot redirect even directory creation outside this dedicated backup.
    for (const dir of [join(backupDirectory, entry.id), originals, output]) {
      try {
        await mkdir(dir, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const info = await lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Recovery directories must not be symlinks");
    }
    for (const identity of entry.originals) {
      const saved = await optionalIdentity(originals, identity.name);
      if (saved) {
        equalIdentity(saved, identity);
        continue;
      }
      if (entry.completed) throw new Error("Completed conversion is missing its original backup");
      equalIdentity(await fileIdentity(sourceDirectory, identity.name), identity);
      await copyVerified(join(sourceDirectory, identity.name), join(originals, identity.name), identity);
    }
    if (entry.output) {
      for (const identity of entry.output.files) equalIdentity(await fileIdentity(output, identity.name), identity);
    } else {
      await assertOriginal(entry, sourceDirectory);
      const source = await ExperimentalTailSource.inspect(originals, entry.id);
      if (!source) throw new Error("Backup lost its committed source reference");
      try {
        entry.output = await stage(source, output);
      } finally {
        await source.close();
      }
      await saveReceipt(receiptPath, receipt);
    }
  }
  // Every selected session is backed up and staged/verified before any head can change.
  await assertInventory(receipt);
  for (const entry of receipt.entries) await assertPublishable(entry, sourceDirectory);
  for (const entry of receipt.entries) {
    await assertInventory(receipt);
    await assertPublishable(entry, sourceDirectory);
    const output = join(backupDirectory, entry.id, "output");
    const prepared = entry.output!;
    const hot = prepared.files.find((f) => f.name === `${entry.id}.json`)!;
    const data = prepared.files.find((f) => f.name !== hot.name)!;
    const installed = await optionalIdentity(sourceDirectory, data.name);
    if (installed) equalIdentity(installed, data);
    else await copyVerified(join(output, data.name), join(sourceDirectory, data.name), data);
    // Recheck the complete physical source bundle immediately before publication.
    await assertPublishable(entry, sourceDirectory);
    await copyAtomic(join(output, hot.name), join(sourceDirectory, hot.name), hot);
    equalIdentity(await fileIdentity(sourceDirectory, hot.name), hot);
    entry.completed = true;
    await saveReceipt(receiptPath, receipt);
  }
  receipt.status = "complete";
  await saveReceipt(receiptPath, receipt);
  return { receipt: receiptPath, sessions: receipt.entries.length, status: receipt.status };
}

async function stage(source: ExperimentalTailSource, output: string): Promise<NonNullable<MigrationEntry["output"]>> {
  const generation = randomUUID(),
    path = historyPath(output, source.id, generation);
  const file = await open(path, "wx", 0o600);
  const writer = new HistoryFrameWriter(file, 0);
  const strings = new Map<string, { id: number; value: SourceString }>();
  const rows = [...source.messages, ...source.tools];
  const digests: string[] = [];
  try {
    await writer.frame(["history", 1, source.id, generation]);
    // Index only referenced values. Obsolete dictionary text remains solely in originals.
    for (const row of rows) {
      digests.push(await source.digest(row));
      for await (const _ of source.tokens(row, async (value) => {
        if (!strings.has(value.identity)) strings.set(value.identity, { id: strings.size, value });
        return strings.get(value.identity)!.id;
      })) {
        /* Discover references without retaining encoded rows or string contents. */
      }
    }
    for (const { id, value } of strings.values()) {
      await writer.frame(["string", id, value.node.chars - value.drop]);
      for await (const part of source.parts(value)) await writer.frame(["part", part]);
      await writer.frame(["endString"]);
    }
    for (let i = 0; i < rows.length; i++) {
      await writer.frame([
        i < source.messages.length ? "message" : "tool",
        i < source.messages.length ? i : i - source.messages.length,
        digests[i],
      ]);
      for await (const token of source.tokens(rows[i], async (value) => strings.get(value.identity)!.id))
        await writer.frame(token);
      await writer.frame(["endRow"]);
    }
    const head: HistoryReference = {
      version: 1,
      generation,
      bytes: 0,
      revision: 1,
      messageCount: source.messages.length,
      toolCount: source.tools.length,
      frozenCount: source.frozenCount,
      frozenToolCount: source.frozenTools,
    };
    await writer.frame(historyCommitFrame(head));
    head.bytes = writer.position;
    await writer.flush();
    await file.sync();
    const verified = await verifySessionHistory(output, source.id, head);
    if (JSON.stringify(verified) !== JSON.stringify(digests)) throw new Error("Staged logical content mismatch");
    await stageHot(source, output, head);
    return {
      head,
      files: [await fileIdentity(output, `${source.id}.json`), await fileIdentity(output, basename(path))],
      contentDigest: createHash("sha256").update(JSON.stringify(digests)).digest("hex"),
    };
  } finally {
    await file.close();
  }
}

async function stageHot(source: ExperimentalTailSource, output: string, head: HistoryReference): Promise<void> {
  const path = join(output, `${source.id}.json`),
    candidate = `${path}.${randomUUID()}.tmp`;
  const file = await open(candidate, "wx", 0o600);
  try {
    await file.writeFile("{");
    let first = true;
    const excluded = new Set([
      "_tailJournal",
      "messageHistory",
      "toolResults",
      "_frozenCount",
      "_frozenToolResultCount",
    ]);
    for (const [key, node] of source.metadata) {
      if (key.chars <= 4096 && excluded.has(await source.hot.text(key))) continue;
      await file.writeFile(first ? "" : ",");
      first = false;
      await copyRange(source.hot.file, file, key.start, key.end);
      await file.writeFile(":");
      await copyRange(source.hot.file, file, node.start, node.end);
    }
    await file.writeFile(
      `${first ? "" : ","}"messageHistory":[],"toolResults":[],"_frozenCount":${head.frozenCount},"_frozenToolResultCount":${head.frozenToolCount},"_historyRef":${JSON.stringify(head)}}`,
    );
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(candidate, path);
  // All unchanged metadata, including pending ownership, was copied byte-for-byte by value range.
  // Verify those ranges independently in the staged hot file, without parsing large metadata strings.
  const { SourceJson } = await import("./experimental-tail-json.js");
  const staged = await SourceJson.open(path);
  try {
    const object = await staged.value();
    if (object.kind !== "object") throw new Error("Invalid staged metadata object");
    let i = 0;
    for (const [key, node] of source.metadata) {
      if (key.chars <= 4096 && excludedField(await source.hot.text(key))) continue;
      const other = object.entries[i++];
      if (!other) throw new Error("Staged metadata missing");
      for (const [before, after] of [
        [key, other[0]],
        [node, other[1]],
      ]) {
        if (
          (await rangeDigest(source.hot.file, before.start, before.end)) !==
          (await rangeDigest(staged.file, after.start, after.end))
        )
          throw new Error("Staged pending ownership/metadata mismatch");
      }
    }
  } finally {
    await staged.file.close();
  }
}

function excludedField(key: string): boolean {
  return ["_tailJournal", "messageHistory", "toolResults", "_frozenCount", "_frozenToolResultCount"].includes(key);
}
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return !path || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}
async function hotFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
}
async function regularFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular source file: ${path}`);
}
async function fileIdentity(dir: string, name: string): Promise<FileIdentity> {
  if (basename(name) !== name) throw new Error("Invalid receipt file name");
  const path = join(dir, name);
  await regularFile(path);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { name, bytes, sha256: hash.digest("hex") };
}
async function optionalIdentity(dir: string, name: string): Promise<FileIdentity | undefined> {
  try {
    return await fileIdentity(dir, name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
function equalIdentity(actual: FileIdentity, expected: FileIdentity): void {
  if (actual.name !== expected.name || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    throw new Error(`File changed or incomplete: ${expected.name}`);
}
async function copyVerified(source: string, destination: string, identity: FileIdentity): Promise<void> {
  const candidate = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, candidate, 1);
    const file = await open(candidate, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    equalIdentity({ ...(await fileIdentity(dirname(candidate), basename(candidate))), name: identity.name }, identity);
    // An interrupted copy leaves only an ignored temporary file; publication is exclusive.
    await link(candidate, destination);
  } finally {
    try {
      await unlink(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
async function copyAtomic(source: string, destination: string, identity: FileIdentity): Promise<void> {
  const candidate = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, candidate, 1);
    const file = await open(candidate, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    equalIdentity({ ...(await fileIdentity(dirname(candidate), basename(candidate))), name: identity.name }, identity);
    await rename(candidate, destination);
  } finally {
    try {
      await unlink(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
async function saveReceipt(path: string, receipt: MigrationReceipt): Promise<void> {
  await replaceSessionFile(path, [JSON.stringify(receipt, null, 2) + "\n"]);
}
async function assertInventory(receipt: MigrationReceipt): Promise<void> {
  if (JSON.stringify(await hotFiles(receipt.sourceDirectory)) !== JSON.stringify(receipt.inventory))
    throw new Error("Session file inventory changed while offline");
}
async function assertOriginal(entry: MigrationEntry, dir: string): Promise<void> {
  for (const identity of entry.originals) equalIdentity(await fileIdentity(dir, identity.name), identity);
}
async function assertPublishable(entry: MigrationEntry, dir: string): Promise<void> {
  for (const original of entry.originals) {
    const actual = await fileIdentity(dir, original.name);
    const output = entry.output?.files.find((f) => f.name === original.name);
    if (output && actual.sha256 === output.sha256 && actual.bytes === output.bytes) continue;
    equalIdentity(actual, original);
  }
  // A new frozen file during conversion is source activity, not an ignorable orphan.
  if (
    !entry.originals.some((f) => f.name === `${entry.id}.history.jsonl`) &&
    (await optionalIdentity(dir, `${entry.id}.history.jsonl`))
  )
    throw new Error("Frozen source bundle changed");
}
function validateEntry(entry: MigrationEntry): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(entry.id) || !Array.isArray(entry.originals)) throw new Error("Invalid recovery entry");
  const names = new Set([`${entry.id}.json`, `${entry.id}.tail.jsonl`, `${entry.id}.history.jsonl`]);
  for (const identity of entry.originals)
    if (!names.has(identity.name)) throw new Error("Invalid recovery source path");
  if (
    !entry.originals.some((f) => f.name === `${entry.id}.json`) ||
    !entry.originals.some((f) => f.name === `${entry.id}.tail.jsonl`)
  )
    throw new Error("Incomplete recovery bundle");
  if (entry.output) {
    const data = basename(historyPath("", entry.id, entry.output.head.generation));
    if (
      entry.output.files.length !== 2 ||
      !entry.output.files.some((f) => f.name === `${entry.id}.json`) ||
      !entry.output.files.some((f) => f.name === data)
    )
      throw new Error("Invalid recovery output paths");
  }
}
async function rollback(path: string, receipt: MigrationReceipt): Promise<void> {
  for (const entry of receipt.entries) {
    await assertPublishable(entry, receipt.sourceDirectory);
    for (const identity of entry.originals)
      equalIdentity(await fileIdentity(join(receipt.backupDirectory, entry.id, "originals"), identity.name), identity);
    for (const identity of entry.output?.files ?? []) {
      if (identity.name.endsWith(".json")) continue;
      const installed = await optionalIdentity(receipt.sourceDirectory, identity.name);
      if (installed) equalIdentity(installed, identity);
    }
  }
  for (const entry of receipt.entries) {
    await assertPublishable(entry, receipt.sourceDirectory);
    // Frozen/journal files have not been changed by conversion. Publish the original hot pointer last.
    const name = `${entry.id}.json`;
    await copyAtomic(
      join(receipt.backupDirectory, entry.id, "originals", name),
      join(receipt.sourceDirectory, name),
      entry.originals.find((f) => f.name === name)!,
    );
    entry.completed = false;
    await saveReceipt(path, receipt);
  }
  receipt.status = "rolled-back";
  await saveReceipt(path, receipt);
}
async function copyRange(
  source: Awaited<ReturnType<typeof open>>,
  target: Awaited<ReturnType<typeof open>>,
  start: number,
  end: number,
): Promise<void> {
  const buffer = Buffer.alloc(64 * 1024);
  for (let position = start; position < end; ) {
    const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, end - position), position);
    if (!bytesRead) throw new Error("Incomplete metadata source range");
    await target.writeFile(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
}
async function rangeDigest(file: Awaited<ReturnType<typeof open>>, start: number, end: number): Promise<string> {
  const hash = createHash("sha256"),
    buffer = Buffer.alloc(64 * 1024);
  for (let position = start; position < end; ) {
    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, end - position), position);
    if (!bytesRead) throw new Error("Incomplete metadata verification range");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

/** Quick CLI preflight uses only a disposable synthetic bundle, including exact rollback. */
export async function migrationSelfTest(): Promise<{ status: string }> {
  const root = await mkdtemp(join(tmpdir(), "experimental-tail-self-test-"));
  try {
    const sessionsDirectory = join(root, "sessions"),
      backupDirectory = join(root, "backup");
    await mkdir(sessionsDirectory);
    const text = "\0😀\ud800".repeat(16384);
    const journal = [
      ["s", 1, text],
      ["m", 0, { type: "user_message", content: "\0" + "1", timestamp: 1 }],
      ["c", 1, 0, 1, 0, 0],
    ]
      .map((r) => JSON.stringify(r) + "\n")
      .join("");
    const hot = JSON.stringify({
      id: "sample",
      state: { session_id: "sample" },
      messageHistory: [],
      toolResults: [],
      pendingMessages: ["owned"],
      pendingPermissions: [],
      _frozenCount: 0,
      _frozenToolResultCount: 0,
      _tailJournal: { version: 1, revision: 1, bytes: Buffer.byteLength(journal) },
    });
    const hotFile = await open(join(sessionsDirectory, "sample.json"), "wx", 0o600);
    try {
      await hotFile.writeFile(hot);
    } finally {
      await hotFile.close();
    }
    const tailFile = await open(join(sessionsDirectory, "sample.tail.jsonl"), "wx", 0o600);
    try {
      await tailFile.writeFile(journal + "uncommitted suffix");
    } finally {
      await tailFile.close();
    }
    const options: MigrationOptions = { sessionsDirectory, backupDirectory, serverStopped: true };
    await migrateExperimentalSessionTail(options);
    await migrateExperimentalSessionTail(options);
    const saved = JSON.parse(await readFile(join(sessionsDirectory, "sample.json"), "utf8"));
    const restored = await readSessionHistory(sessionsDirectory, "sample", saved._historyRef);
    if ((restored.messages[0] as { content: string }).content !== text || saved.pendingMessages[0] !== "owned")
      throw new Error("Self-test content mismatch");
    await migrateExperimentalSessionTail({ ...options, rollback: true });
    if ((await readFile(join(sessionsDirectory, "sample.json"), "utf8")) !== hot)
      throw new Error("Self-test rollback mismatch");
    return { status: "self-test passed" };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "One-use OFFLINE experimental session-tail converter.\nUsage: bun scripts/migrate-experimental-session-tail.ts --sessions-dir /absolute/offline/sessions --backup-dir /absolute/separate/new-backup --server-stopped [--rollback]\nFirst run --self-test for a quick disposable-fixture check. Run conversion only after successful saving and actual server exit. Keep both servers stopped after any failure. Reuse the same paths to resume. No live process control is performed. See docs/experimental-session-tail-migration.md.",
    );
  } else if (args.length === 1 && args[0] === "--self-test") {
    try {
      console.log(JSON.stringify(await migrationSelfTest()));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    try {
      let sessionsDirectory = "",
        backupDirectory = "",
        serverStopped = false,
        rollback = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--sessions-dir") sessionsDirectory = args[++i] ?? "";
        else if (args[i] === "--backup-dir") backupDirectory = args[++i] ?? "";
        else if (args[i] === "--server-stopped") serverStopped = true;
        else if (args[i] === "--rollback") rollback = true;
        else throw new Error(`Unknown argument: ${args[i]}`);
      }
      if (!serverStopped) throw new Error("Read --help and confirm successful saving and server exit");
      console.log(
        JSON.stringify(
          await migrateExperimentalSessionTail({ sessionsDirectory, backupDirectory, serverStopped: true, rollback }),
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(
        `Conversion stopped. Keep servers down and preserve originals: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
