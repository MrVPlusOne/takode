import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { LeaderProfilePoolId, LeaderProfilePortrait } from "../shared/leader-profile-portraits.js";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const ASSET_ROOT = join(PROJECT_ROOT, "public", "leader-profile-portraits");
const GENERATED_METADATA_PATH = join(PROJECT_ROOT, "shared", "leader-profile-portraits.generated.ts");
const VALIDATION_ROOT = "/tmp/takode-leader-profile-portrait-validation";
const VALIDATION_MANIFEST_PATH = join(VALIDATION_ROOT, "leader-profile-portrait-validation.json");
const CONTACT_SHEET_PATH = join(VALIDATION_ROOT, "leader-profile-contact-sheet.png");
const GRID_SIZE = 4;
const ASSET_VERSION = "v2";
const VARIANTS = [
  { name: "small", size: 96 },
  { name: "large", size: 320 },
] as const;

interface PortraitSheet {
  poolId: LeaderProfilePoolId;
  sourcePath: string;
}

interface ValidationVariant {
  path: string;
  width: number;
  height: number;
  bytes: number;
  cornerAlphaMax: number;
  centerAlpha: number;
  transparentRatio: number;
  opaqueRatio: number;
}

interface ValidationAsset {
  id: string;
  poolId: LeaderProfilePoolId | "fallback";
  label: string;
  small: ValidationVariant;
  large: ValidationVariant;
}

interface GenerationResult {
  portraits: LeaderProfilePortrait[];
  fallback: LeaderProfilePortrait;
  validationManifestPath: string;
  contactSheetPath: string;
}

const PORTRAIT_SHEETS: PortraitSheet[] = [
  { poolId: "tako", sourcePath: "/Users/jiayiwei/Downloads/Tako-portraits/tako1.PNG" },
  { poolId: "tako", sourcePath: "/Users/jiayiwei/Downloads/Tako-portraits/tako2.PNG" },
  { poolId: "tako", sourcePath: "/Users/jiayiwei/Downloads/Tako-portraits/tako3.PNG" },
  { poolId: "shmi", sourcePath: "/Users/jiayiwei/Downloads/Shmi-portraits/shmi1.PNG" },
  { poolId: "shmi", sourcePath: "/Users/jiayiwei/Downloads/Shmi-portraits/shmi2.PNG" },
  { poolId: "shmi", sourcePath: "/Users/jiayiwei/Downloads/Shmi-portraits/shmi3.PNG" },
];

export async function generateLeaderProfilePortraitAssets(): Promise<GenerationResult> {
  await prepareOutputDirectories();
  const portraits: LeaderProfilePortrait[] = [];

  for (const sheet of PORTRAIT_SHEETS) {
    const source = sharp(sheet.sourcePath);
    const metadata = await source.metadata();
    const width = requirePositiveDimension(metadata.width, sheet.sourcePath, "width");
    const height = requirePositiveDimension(metadata.height, sheet.sourcePath, "height");
    if (width !== height) {
      throw new Error(`${sheet.sourcePath} must be a square sheet`);
    }

    const sheetBaseName = basename(sheet.sourcePath)
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let column = 0; column < GRID_SIZE; column += 1) {
        const cellNumber = row * GRID_SIZE + column + 1;
        const id = `${sheetBaseName}-${String(cellNumber).padStart(2, "0")}`;
        const label = `${titleCase(sheet.poolId)} ${sheetBaseName.replace(/^[a-z]+/, "")}.${cellNumber}`;
        const small = await writePortraitVariant(sheet, id, width, row, column, VARIANTS[0].size);
        const large = await writePortraitVariant(sheet, id, width, row, column, VARIANTS[1].size);
        portraits.push({
          id,
          poolId: sheet.poolId,
          label,
          smallUrl: small.url,
          largeUrl: large.url,
          smallSize: VARIANTS[0].size,
          largeSize: VARIANTS[1].size,
          smallBytes: small.bytes,
          largeBytes: large.bytes,
        });
      }
    }
  }

  const fallback = await writeFallbackPortrait();
  await writeGeneratedMetadata(portraits, fallback);
  const validationAssets = await validateLeaderProfilePortraitAssets(portraits, fallback);
  await writeValidationManifest(validationAssets);
  await writeContactSheet(portraits, fallback);

  return {
    portraits,
    fallback,
    validationManifestPath: VALIDATION_MANIFEST_PATH,
    contactSheetPath: CONTACT_SHEET_PATH,
  };
}

export async function validateLeaderProfilePortraitAssets(
  portraits: LeaderProfilePortrait[],
  fallback: LeaderProfilePortrait,
): Promise<ValidationAsset[]> {
  const assets: ValidationAsset[] = [];
  for (const portrait of [...portraits, fallback]) {
    assets.push({
      id: portrait.id,
      poolId: portrait.poolId,
      label: portrait.label,
      small: await validateVariant(portrait.smallUrl, portrait.smallSize, portrait.smallBytes),
      large: await validateVariant(portrait.largeUrl, portrait.largeSize, portrait.largeBytes),
    });
  }
  return assets;
}

async function prepareOutputDirectories(): Promise<void> {
  await rm(ASSET_ROOT, { recursive: true, force: true });
  await mkdir(ASSET_ROOT, { recursive: true });
  await mkdir(VALIDATION_ROOT, { recursive: true });
}

function requirePositiveDimension(value: number | undefined, path: string, dimension: string): number {
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`${path} is missing a readable ${dimension}`);
  }
  return value;
}

async function writePortraitVariant(
  sheet: PortraitSheet,
  id: string,
  sheetSize: number,
  row: number,
  column: number,
  size: number,
): Promise<{ url: string; bytes: number }> {
  const relativePath = join(sheet.poolId, `${id}.${ASSET_VERSION}.${size}.webp`);
  const outputPath = join(ASSET_ROOT, relativePath);
  const bounds = gridCellBounds(sheetSize, row, column);
  await mkdir(join(ASSET_ROOT, sheet.poolId), { recursive: true });
  await sharp(sheet.sourcePath)
    .extract(bounds)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: circleMask(size), blend: "dest-in" }])
    .webp({ quality: 84, alphaQuality: 100, effort: 5 })
    .toFile(outputPath);
  return { url: `/leader-profile-portraits/${relativePath}`, bytes: (await stat(outputPath)).size };
}

function gridCellBounds(
  sheetSize: number,
  row: number,
  column: number,
): { left: number; top: number; width: number; height: number } {
  const left = gridBoundary(sheetSize, column);
  const right = gridBoundary(sheetSize, column + 1);
  const top = gridBoundary(sheetSize, row);
  const bottom = gridBoundary(sheetSize, row + 1);
  return { left, top, width: right - left, height: bottom - top };
}

function gridBoundary(sheetSize: number, index: number): number {
  return Math.round((sheetSize * index) / GRID_SIZE);
}

async function writeFallbackPortrait(): Promise<LeaderProfilePortrait> {
  const small = await writeFallbackVariant(VARIANTS[0].size);
  const large = await writeFallbackVariant(VARIANTS[1].size);
  return {
    id: "leader-fallback",
    poolId: "fallback",
    label: "Default leader",
    smallUrl: small.url,
    largeUrl: large.url,
    smallSize: VARIANTS[0].size,
    largeSize: VARIANTS[1].size,
    smallBytes: small.bytes,
    largeBytes: large.bytes,
  };
}

async function writeFallbackVariant(size: number): Promise<{ url: string; bytes: number }> {
  const relativePath = join("fallback", `leader-fallback.${ASSET_VERSION}.${size}.webp`);
  const outputPath = join(ASSET_ROOT, relativePath);
  await mkdir(join(ASSET_ROOT, "fallback"), { recursive: true });
  await sharp(Buffer.from(fallbackSvg(size)))
    .resize(size, size)
    .webp({ quality: 88, alphaQuality: 100, effort: 5 })
    .toFile(outputPath);
  return { url: `/leader-profile-portraits/${relativePath}`, bytes: (await stat(outputPath)).size };
}

async function writeGeneratedMetadata(
  portraits: LeaderProfilePortrait[],
  fallback: LeaderProfilePortrait,
): Promise<void> {
  const content = `import type { LeaderProfilePortrait } from "./leader-profile-portraits.js";

export const GENERATED_LEADER_PROFILE_PORTRAITS: LeaderProfilePortrait[] = [
${portraits.map((portrait) => formatPortraitLiteral(portrait, "  ")).join(",\n")},
];

export const GENERATED_FALLBACK_LEADER_PROFILE_PORTRAIT: LeaderProfilePortrait = ${formatPortraitLiteral(fallback, "")};
`;
  await writeFile(GENERATED_METADATA_PATH, content);
}

function formatPortraitLiteral(portrait: LeaderProfilePortrait, indent: string): string {
  const innerIndent = `${indent}  `;
  return `${indent}{
${innerIndent}id: ${JSON.stringify(portrait.id)},
${innerIndent}poolId: ${JSON.stringify(portrait.poolId)},
${innerIndent}label: ${JSON.stringify(portrait.label)},
${innerIndent}smallUrl: ${JSON.stringify(portrait.smallUrl)},
${innerIndent}largeUrl: ${JSON.stringify(portrait.largeUrl)},
${innerIndent}smallSize: ${portrait.smallSize},
${innerIndent}largeSize: ${portrait.largeSize},
${innerIndent}smallBytes: ${portrait.smallBytes},
${innerIndent}largeBytes: ${portrait.largeBytes},
${indent}}`;
}

async function validateVariant(url: string, expectedSize: number, expectedBytes: number): Promise<ValidationVariant> {
  const path = join(PROJECT_ROOT, "public", url.replace(/^\//, ""));
  const metadata = await sharp(path).metadata();
  const width = requirePositiveDimension(metadata.width, path, "width");
  const height = requirePositiveDimension(metadata.height, path, "height");
  if (width !== expectedSize || height !== expectedSize) {
    throw new Error(`${path} expected ${expectedSize}x${expectedSize}, got ${width}x${height}`);
  }

  const raw = await sharp(path).ensureAlpha().raw().toBuffer();
  const alphaValues: number[] = [];
  for (let index = 3; index < raw.length; index += 4) alphaValues.push(raw[index]);

  const cornerCoordinates = [
    [0, 0],
    [expectedSize - 1, 0],
    [0, expectedSize - 1],
    [expectedSize - 1, expectedSize - 1],
  ] as const;
  const cornerAlphaMax = Math.max(...cornerCoordinates.map(([x, y]) => raw[(y * expectedSize + x) * 4 + 3]));
  const centerAlpha = raw[(Math.floor(expectedSize / 2) * expectedSize + Math.floor(expectedSize / 2)) * 4 + 3];
  const transparentRatio = alphaValues.filter((alpha) => alpha <= 8).length / alphaValues.length;
  const opaqueRatio = alphaValues.filter((alpha) => alpha >= 240).length / alphaValues.length;
  if (cornerAlphaMax > 8 || centerAlpha < 240 || transparentRatio < 0.18 || opaqueRatio < 0.74) {
    throw new Error(`${path} failed round-alpha validation`);
  }

  const bytes = (await stat(path)).size;
  if (bytes !== expectedBytes) {
    throw new Error(`${path} metadata bytes ${expectedBytes} did not match actual ${bytes}`);
  }

  return {
    path,
    width,
    height,
    bytes,
    cornerAlphaMax,
    centerAlpha,
    transparentRatio: roundMetric(transparentRatio),
    opaqueRatio: roundMetric(opaqueRatio),
  };
}

async function writeValidationManifest(assets: ValidationAsset[]): Promise<void> {
  const filesByDirectory = await Promise.all(
    ["tako", "shmi", "fallback"].map(async (directory) => ({
      directory,
      files: (await readdir(join(ASSET_ROOT, directory))).sort(),
    })),
  );
  await writeFile(
    VALIDATION_MANIFEST_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceSheets: PORTRAIT_SHEETS.map((sheet) => ({
          poolId: sheet.poolId,
          sourcePath: sheet.sourcePath,
          grid: `${GRID_SIZE}x${GRID_SIZE}`,
          portraits: GRID_SIZE * GRID_SIZE,
        })),
        assetRoot: ASSET_ROOT,
        totalPortraitAssets: assets.length - 1,
        totalFallbackAssets: 1,
        filesByDirectory,
        assets,
        contactSheetPath: CONTACT_SHEET_PATH,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeContactSheet(portraits: LeaderProfilePortrait[], fallback: LeaderProfilePortrait): Promise<void> {
  const tileSize = 96;
  const labelHeight = 22;
  const gap = 12;
  const columns = 9;
  const assets = [...portraits, fallback];
  const rows = Math.ceil(assets.length / columns);
  const width = columns * tileSize + (columns + 1) * gap;
  const height = rows * (tileSize + labelHeight) + (rows + 1) * gap;
  const composites: OverlayOptions[] = [];

  for (const [index, portrait] of assets.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const left = gap + column * (tileSize + gap);
    const top = gap + row * (tileSize + labelHeight + gap);
    composites.push({ input: join(PROJECT_ROOT, "public", portrait.smallUrl.replace(/^\//, "")), left, top });
    composites.push({
      input: Buffer.from(labelSvg(tileSize, labelHeight, portrait.id)),
      left,
      top: top + tileSize + 2,
    });
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#111827",
    },
  })
    .composite(composites)
    .png()
    .toFile(CONTACT_SHEET_PATH);
}

function circleMask(size: number): Buffer {
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/>
</svg>`);
}

function fallbackSvg(size: number): string {
  const fontSize = Math.round(size * 0.44);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="leaderFallbackGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1F6F78"/>
      <stop offset="100%" stop-color="#D69E2E"/>
    </linearGradient>
  </defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#leaderFallbackGradient)"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#F8FAFC">L</text>
</svg>`;
}

function labelSvg(width: number, height: number, label: string): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="50%" y="14" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="10" font-weight="600" fill="#E5E7EB">${escapeXml(label)}</text>
</svg>`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

if (import.meta.main) {
  const result = await generateLeaderProfilePortraitAssets();
  const smallBytes = result.portraits.map((portrait) => portrait.smallBytes);
  const largeBytes = result.portraits.map((portrait) => portrait.largeBytes);
  console.log(`generated ${result.portraits.length} portraits plus fallback`);
  console.log(`96px bytes: ${Math.min(...smallBytes)}-${Math.max(...smallBytes)}`);
  console.log(`320px bytes: ${Math.min(...largeBytes)}-${Math.max(...largeBytes)}`);
  console.log(`metadata: ${GENERATED_METADATA_PATH}`);
  console.log(`validation manifest: ${result.validationManifestPath}`);
  console.log(`contact sheet: ${result.contactSheetPath}`);
}
