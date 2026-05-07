import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type OverlayOptions } from "sharp";
import type { LeaderProfilePoolId, LeaderProfilePortrait } from "../shared/leader-profile-portraits.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_ROOT = join(PROJECT_ROOT, "public", "leader-profile-portraits");
const GENERATED_METADATA_PATH = join(PROJECT_ROOT, "shared", "leader-profile-portraits.generated.ts");
const VALIDATION_ROOT = "/tmp/takode-leader-profile-portrait-validation";
const VALIDATION_MANIFEST_PATH = join(VALIDATION_ROOT, "leader-profile-portrait-validation.json");
const CONTACT_SHEET_PATH = join(VALIDATION_ROOT, "leader-profile-contact-sheet.png");
const COMPARISON_CONTACT_SHEET_PATH = join(VALIDATION_ROOT, "leader-profile-source-comparison-sheet.png");
const ZOOM_REVIEW_ROOT = join(VALIDATION_ROOT, "zoomed-assets");
const ZOOM_REVIEW_INDEX_PATH = join(VALIDATION_ROOT, "leader-profile-zoom-review-index.html");
const ZOOM_REVIEW_MANIFEST_PATH = join(VALIDATION_ROOT, "leader-profile-zoom-review.json");
const GRID_SIZE = 4;
const ASSET_VERSION = "v2";
const ANALYSIS_SIZE = 192;
const CROP_PADDING_RATIO = 0.18;
const MIN_CROP_RATIO = 0.58;
const MAX_CROP_RATIO = 0.84;
const SOURCE_ALPHA_THRESHOLD = 8;
const EMPTY_BOUNDARY_MAX_RATIO = 0.28;
const EMPTY_BOUNDARY_SECTOR_MAX_RATIO = 0.36;
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
  visualCenterOffsetX: number;
  visualCenterOffsetY: number;
  transparentRatio: number;
  opaqueRatio: number;
  emptyBoundaryRatio: number;
  maxEmptyBoundarySectorRatio: number;
}

interface PortraitCrop {
  sourceLeft: number;
  sourceTop: number;
  sourceSize: number;
  analysis: CropAnalysis;
}

interface CropAnalysis {
  score: number;
  cropRatio: number;
  subjectOffsetX: number;
  subjectOffsetY: number;
  emptyBoundaryRatio: number;
  maxEmptyBoundarySectorRatio: number;
  retainedSubjectRatio: number;
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
  comparisonContactSheetPath: string;
  zoomReviewRoot: string;
  zoomReviewIndexPath: string;
  zoomReviewManifestPath: string;
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
        const cellBounds = gridCellBounds(width, row, column);
        const crop = await computeCenteredPortraitCrop(sheet.sourcePath, cellBounds);
        const small = await writePortraitVariant(sheet, id, cellBounds, crop, VARIANTS[0].size);
        const large = await writePortraitVariant(sheet, id, cellBounds, crop, VARIANTS[1].size);
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
  await writeSourceComparisonSheet(portraits, fallback);
  await writeZoomReviewArtifacts(portraits, fallback, validationAssets);

  return {
    portraits,
    fallback,
    validationManifestPath: VALIDATION_MANIFEST_PATH,
    contactSheetPath: CONTACT_SHEET_PATH,
    comparisonContactSheetPath: COMPARISON_CONTACT_SHEET_PATH,
    zoomReviewRoot: ZOOM_REVIEW_ROOT,
    zoomReviewIndexPath: ZOOM_REVIEW_INDEX_PATH,
    zoomReviewManifestPath: ZOOM_REVIEW_MANIFEST_PATH,
  };
}

export async function validateLeaderProfilePortraitAssets(
  portraits: LeaderProfilePortrait[],
  fallback: LeaderProfilePortrait,
): Promise<ValidationAsset[]> {
  const assets: ValidationAsset[] = [];
  for (const portrait of [...portraits, fallback]) {
    const validateVisualCenter = portrait.poolId !== "fallback";
    assets.push({
      id: portrait.id,
      poolId: portrait.poolId,
      label: portrait.label,
      small: await validateVariant(portrait.smallUrl, portrait.smallSize, portrait.smallBytes, validateVisualCenter),
      large: await validateVariant(portrait.largeUrl, portrait.largeSize, portrait.largeBytes, validateVisualCenter),
    });
  }
  return assets;
}

async function prepareOutputDirectories(): Promise<void> {
  await rm(ASSET_ROOT, { recursive: true, force: true });
  await rm(VALIDATION_ROOT, { recursive: true, force: true });
  await mkdir(ASSET_ROOT, { recursive: true });
  await mkdir(VALIDATION_ROOT, { recursive: true });
  await mkdir(ZOOM_REVIEW_ROOT, { recursive: true });
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
  cellBounds: { left: number; top: number; width: number; height: number },
  crop: PortraitCrop,
  size: number,
): Promise<{ url: string; bytes: number }> {
  const relativePath = join(sheet.poolId, `${id}.${ASSET_VERSION}.${size}.webp`);
  const outputPath = join(ASSET_ROOT, relativePath);
  const padding = Math.round(Math.max(cellBounds.width, cellBounds.height) * CROP_PADDING_RATIO);
  await mkdir(join(ASSET_ROOT, sheet.poolId), { recursive: true });
  const extendedCell = await sharp(sheet.sourcePath)
    .extract(cellBounds)
    .extend({ top: padding, right: padding, bottom: padding, left: padding, extendWith: "mirror" })
    .toBuffer();
  await sharp(extendedCell)
    .extract({
      left: crop.sourceLeft + padding,
      top: crop.sourceTop + padding,
      width: crop.sourceSize,
      height: crop.sourceSize,
    })
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

async function computeCenteredPortraitCrop(
  sourcePath: string,
  cellBounds: { left: number; top: number; width: number; height: number },
): Promise<PortraitCrop> {
  const { data, info } = await sharp(sourcePath)
    .extract(cellBounds)
    .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const candidate = choosePortraitCrop(data, info.width, info.height);
  const scaleX = cellBounds.width / info.width;
  const scaleY = cellBounds.height / info.height;
  return {
    sourceLeft: Math.round(candidate.left * scaleX),
    sourceTop: Math.round(candidate.top * scaleY),
    sourceSize: Math.round(candidate.size * Math.max(scaleX, scaleY)),
    analysis: candidate.analysis,
  };
}

function choosePortraitCrop(
  raw: Buffer,
  width: number,
  height: number,
): { left: number; top: number; size: number; analysis: CropAnalysis } {
  const gray = grayscale(raw, width, height);
  const background = estimateBackgroundColor(raw, width, height);
  const scoredPixels = scorePortraitPixels(raw, gray, width, height, background);
  if (scoredPixels.length === 0) {
    const size = Math.round(Math.min(width, height) * MAX_CROP_RATIO);
    const left = Math.round((width - size) / 2);
    const top = Math.round((height - size) / 2);
    return {
      left,
      top,
      size,
      analysis: {
        score: 0,
        cropRatio: size / Math.min(width, height),
        subjectOffsetX: 0,
        subjectOffsetY: 0,
        emptyBoundaryRatio: 0,
        maxEmptyBoundarySectorRatio: 0,
        retainedSubjectRatio: 1,
      },
    };
  }

  const subject = robustSubjectCore(scoredPixels, width, height);
  const minSize = Math.round(Math.min(width, height) * MIN_CROP_RATIO);
  const maxSize = Math.round(Math.min(width, height) * MAX_CROP_RATIO);
  const idealSize = clamp(Math.max(subject.width, subject.height) * 1.18, minSize, maxSize);
  const candidateSizes = uniqueSortedNumbers([
    minSize,
    Math.round(idealSize * 0.9),
    Math.round(idealSize),
    Math.round(idealSize * 1.08),
    Math.round((minSize + maxSize) / 2),
    maxSize,
  ]).filter((size) => size >= minSize && size <= maxSize);
  const shifts = [-0.1, -0.05, 0, 0.05, 0.1];
  const totalSubjectWeight = subject.pixels.reduce((sum, pixel) => sum + pixel.weight, 0);
  let best: {
    left: number;
    top: number;
    size: number;
    analysis: CropAnalysis;
  } | null = null;

  for (const size of candidateSizes) {
    for (const shiftX of shifts) {
      for (const shiftY of shifts) {
        const left = Math.round(clamp(subject.centerX - size / 2 + size * shiftX, 0, width - size));
        const top = Math.round(clamp(subject.centerY - size / 2 + size * shiftY, 0, height - size));
        const analysis = analyzeCropCandidate(raw, width, height, subject.pixels, totalSubjectWeight, left, top, size);
        if (!best || analysis.score < best.analysis.score) best = { left, top, size, analysis };
      }
    }
  }

  if (!best) throw new Error("failed to choose portrait crop");
  return best;
}

function analyzePortraitContent(
  raw: Buffer,
  width: number,
  height: number,
): { centerX: number; centerY: number; minX: number; minY: number; maxX: number; maxY: number } {
  const gray = grayscale(raw, width, height);
  const background = estimateBackgroundColor(raw, width, height);
  const scoredPixels = scorePortraitPixels(raw, gray, width, height, background);
  const maxScore = Math.max(...scoredPixels.map((pixel) => pixel.score), 0);
  const threshold = maxScore * 0.38;
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (const pixel of scoredPixels) {
    const weight = Math.max(0, pixel.score - threshold);
    if (weight <= 0) continue;
    totalWeight += weight;
    weightedX += pixel.x * weight;
    weightedY += pixel.y * weight;
    minX = Math.min(minX, pixel.x);
    minY = Math.min(minY, pixel.y);
    maxX = Math.max(maxX, pixel.x);
    maxY = Math.max(maxY, pixel.y);
  }

  if (totalWeight === 0) {
    return { centerX: width / 2, centerY: height / 2, minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  }

  const weightedCenterX = weightedX / totalWeight;
  const weightedCenterY = weightedY / totalWeight;
  const boundsCenterX = (minX + maxX) / 2;
  const boundsCenterY = (minY + maxY) / 2;
  return {
    centerX: weightedCenterX * 0.35 + boundsCenterX * 0.65,
    centerY: weightedCenterY * 0.35 + boundsCenterY * 0.65,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function robustSubjectCore(
  scoredPixels: Array<{ x: number; y: number; score: number }>,
  width: number,
  height: number,
): {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  pixels: Array<{ x: number; y: number; weight: number }>;
} {
  const sortedScores = scoredPixels.map((pixel) => pixel.score).sort((a, b) => a - b);
  const threshold = sortedScores[Math.floor(sortedScores.length * 0.68)] ?? 0;
  const pixels = scoredPixels
    .map((pixel) => ({ x: pixel.x, y: pixel.y, weight: Math.max(0, pixel.score - threshold) }))
    .filter((pixel) => pixel.weight > 0);
  const weighted = pixels.length > 0 ? pixels : scoredPixels.map((pixel) => ({ ...pixel, weight: pixel.score }));
  const centerX = weightedMean(
    weighted.map((pixel) => ({ value: pixel.x, weight: pixel.weight })),
    width / 2,
  );
  const centerY = weightedMean(
    weighted.map((pixel) => ({ value: pixel.y, weight: pixel.weight })),
    height / 2,
  );
  const minX = weightedQuantile(
    weighted.map((pixel) => ({ value: pixel.x, weight: pixel.weight })),
    0.04,
    0,
  );
  const maxX = weightedQuantile(
    weighted.map((pixel) => ({ value: pixel.x, weight: pixel.weight })),
    0.96,
    width - 1,
  );
  const minY = weightedQuantile(
    weighted.map((pixel) => ({ value: pixel.y, weight: pixel.weight })),
    0.04,
    0,
  );
  const maxY = weightedQuantile(
    weighted.map((pixel) => ({ value: pixel.y, weight: pixel.weight })),
    0.96,
    height - 1,
  );
  return {
    centerX,
    centerY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
    pixels: weighted,
  };
}

function analyzeCropCandidate(
  raw: Buffer,
  width: number,
  height: number,
  subjectPixels: Array<{ x: number; y: number; weight: number }>,
  totalSubjectWeight: number,
  left: number,
  top: number,
  size: number,
): CropAnalysis {
  let retainedWeight = 0;
  let subjectX = 0;
  let subjectY = 0;
  for (const pixel of subjectPixels) {
    const inside = pixel.x >= left && pixel.y >= top && pixel.x < left + size && pixel.y < top + size;
    if (!inside) continue;
    retainedWeight += pixel.weight;
    subjectX += ((pixel.x - left) / size) * pixel.weight;
    subjectY += ((pixel.y - top) / size) * pixel.weight;
  }
  const retainedSubjectRatio = totalSubjectWeight > 0 ? retainedWeight / totalSubjectWeight : 1;
  const normalizedSubjectX = retainedWeight > 0 ? subjectX / retainedWeight : 0.5;
  const normalizedSubjectY = retainedWeight > 0 ? subjectY / retainedWeight : 0.5;
  const subjectOffsetX = (normalizedSubjectX - 0.5) * 2;
  const subjectOffsetY = (normalizedSubjectY - 0.5) * 2;
  const boundary = measureEmptyBoundary(raw, width, height, left, top, size);
  const score =
    boundary.emptyBoundaryRatio * 5 +
    boundary.maxEmptyBoundarySectorRatio * 2.5 +
    Math.hypot(subjectOffsetX, subjectOffsetY) * 2 +
    (1 - retainedSubjectRatio) * 6 +
    (size / Math.min(width, height)) * 0.2;

  return {
    score,
    cropRatio: size / Math.min(width, height),
    subjectOffsetX: roundMetric(subjectOffsetX),
    subjectOffsetY: roundMetric(subjectOffsetY),
    emptyBoundaryRatio: roundMetric(boundary.emptyBoundaryRatio),
    maxEmptyBoundarySectorRatio: roundMetric(boundary.maxEmptyBoundarySectorRatio),
    retainedSubjectRatio: roundMetric(retainedSubjectRatio),
  };
}

function measureEmptyBoundary(
  raw: Buffer,
  width: number,
  height: number,
  left: number,
  top: number,
  size: number,
): { emptyBoundaryRatio: number; maxEmptyBoundarySectorRatio: number } {
  const sectors = [
    { total: 0, empty: 0 },
    { total: 0, empty: 0 },
    { total: 0, empty: 0 },
    { total: 0, empty: 0 },
  ];
  let total = 0;
  let empty = 0;
  const center = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.hypot(dx, dy);
      if (distance > radius - 2 || distance < radius * 0.68) continue;
      const sourceX = Math.round(left + x);
      const sourceY = Math.round(top + y);
      if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;
      const index = (sourceY * width + sourceX) * 4;
      if (raw[index + 3] <= SOURCE_ALPHA_THRESHOLD) continue;
      const sectorIndex = dx < 0 ? (dy < 0 ? 0 : 2) : dy < 0 ? 1 : 3;
      total += 1;
      sectors[sectorIndex].total += 1;
      if (isEmptyBoundaryPixel(raw[index], raw[index + 1], raw[index + 2], raw[index + 3])) {
        empty += 1;
        sectors[sectorIndex].empty += 1;
      }
    }
  }
  return {
    emptyBoundaryRatio: total > 0 ? empty / total : 0,
    maxEmptyBoundarySectorRatio: Math.max(
      ...sectors.map((sector) => (sector.total > 0 ? sector.empty / sector.total : 0)),
    ),
  };
}

function isEmptyBoundaryPixel(red: number, green: number, blue: number, alpha: number): boolean {
  if (alpha < 200) return false;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const saturation = max - min;
  return (red > 218 && green > 210 && blue > 192 && saturation < 62) || (red > 228 && green > 220 && blue > 210);
}

function scorePortraitPixels(
  raw: Buffer,
  gray: Float32Array,
  width: number,
  height: number,
  background: [number, number, number],
): Array<{ x: number; y: number; score: number }> {
  const pixels: Array<{ x: number; y: number; score: number }> = [];
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (x < margin || y < margin || x >= width - margin || y >= height - margin) continue;
      const index = (y * width + x) * 4;
      if (raw[index + 3] <= SOURCE_ALPHA_THRESHOLD) continue;
      const luminance = gray[y * width + x];
      pixels.push({
        x,
        y,
        score:
          colorDistance(raw, index, background) * 0.9 +
          edgeMagnitude(gray, width, x, y) * 0.5 +
          Math.max(0, 210 - luminance) * 0.25,
      });
    }
  }
  return pixels;
}

function grayscale(raw: Buffer, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      gray[y * width + x] = raw[index] * 0.299 + raw[index + 1] * 0.587 + raw[index + 2] * 0.114;
    }
  }
  return gray;
}

function estimateBackgroundColor(raw: Buffer, width: number, height: number): [number, number, number] {
  const borderSize = Math.max(4, Math.round(Math.min(width, height) * 0.1));
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderSize && y >= borderSize && x < width - borderSize && y < height - borderSize) continue;
      const index = (y * width + x) * 4;
      if (raw[index + 3] <= SOURCE_ALPHA_THRESHOLD) continue;
      red.push(raw[index]);
      green.push(raw[index + 1]);
      blue.push(raw[index + 2]);
    }
  }
  return [median(red), median(green), median(blue)];
}

function colorDistance(raw: Buffer, index: number, background: [number, number, number]): number {
  return Math.hypot(raw[index] - background[0], raw[index + 1] - background[1], raw[index + 2] - background[2]);
}

function edgeMagnitude(gray: Float32Array, width: number, x: number, y: number): number {
  const top = (y - 1) * width;
  const middle = y * width;
  const bottom = (y + 1) * width;
  const gx =
    -gray[top + x - 1] +
    gray[top + x + 1] -
    2 * gray[middle + x - 1] +
    2 * gray[middle + x + 1] -
    gray[bottom + x - 1] +
    gray[bottom + x + 1];
  const gy =
    -gray[top + x - 1] -
    2 * gray[top + x] -
    gray[top + x + 1] +
    gray[bottom + x - 1] +
    2 * gray[bottom + x] +
    gray[bottom + x + 1];
  return Math.hypot(gx, gy);
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

async function validateVariant(
  url: string,
  expectedSize: number,
  expectedBytes: number,
  validateVisualCenter = true,
): Promise<ValidationVariant> {
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
  const emptyBoundary = measureEmptyBoundary(raw, expectedSize, expectedSize, 0, 0, expectedSize);
  const content = analyzePortraitContent(raw, expectedSize, expectedSize);
  const visualCenterOffsetX = (content.centerX / expectedSize - 0.5) * 2;
  const visualCenterOffsetY = (content.centerY / expectedSize - 0.5) * 2;
  if (cornerAlphaMax > 8 || centerAlpha < 240 || transparentRatio < 0.18 || opaqueRatio < 0.74) {
    throw new Error(`${path} failed round-alpha validation`);
  }
  if (
    validateVisualCenter &&
    (emptyBoundary.emptyBoundaryRatio > EMPTY_BOUNDARY_MAX_RATIO ||
      emptyBoundary.maxEmptyBoundarySectorRatio > EMPTY_BOUNDARY_SECTOR_MAX_RATIO)
  ) {
    throw new Error(`${path} failed empty-boundary validation`);
  }
  if (validateVisualCenter && (Math.abs(visualCenterOffsetX) > 0.24 || Math.abs(visualCenterOffsetY) > 0.24)) {
    throw new Error(`${path} failed visual-centering validation`);
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
    visualCenterOffsetX: roundMetric(visualCenterOffsetX),
    visualCenterOffsetY: roundMetric(visualCenterOffsetY),
    transparentRatio: roundMetric(transparentRatio),
    opaqueRatio: roundMetric(opaqueRatio),
    emptyBoundaryRatio: roundMetric(emptyBoundary.emptyBoundaryRatio),
    maxEmptyBoundarySectorRatio: roundMetric(emptyBoundary.maxEmptyBoundarySectorRatio),
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
        comparisonContactSheetPath: COMPARISON_CONTACT_SHEET_PATH,
        zoomReviewRoot: ZOOM_REVIEW_ROOT,
        zoomReviewIndexPath: ZOOM_REVIEW_INDEX_PATH,
        zoomReviewManifestPath: ZOOM_REVIEW_MANIFEST_PATH,
        emptyBoundaryLimits: {
          emptyBoundaryRatio: EMPTY_BOUNDARY_MAX_RATIO,
          maxEmptyBoundarySectorRatio: EMPTY_BOUNDARY_SECTOR_MAX_RATIO,
        },
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

async function writeSourceComparisonSheet(
  portraits: LeaderProfilePortrait[],
  fallback: LeaderProfilePortrait,
): Promise<void> {
  const sourceSize = 96;
  const outputSize = 96;
  const labelHeight = 22;
  const tileWidth = sourceSize + outputSize + 18;
  const tileHeight = outputSize + labelHeight + 12;
  const gap = 14;
  const columns = 4;
  const assets = [...portraits, fallback];
  const rows = Math.ceil(assets.length / columns);
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;
  const composites: OverlayOptions[] = [];

  for (const [index, portrait] of assets.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const left = gap + column * (tileWidth + gap);
    const top = gap + row * (tileHeight + gap);
    if (portrait.poolId === "fallback") {
      composites.push({
        input: Buffer.from(emptySourcePlaceholderSvg(sourceSize, "fallback")),
        left,
        top,
      });
    } else {
      const source = await sourceCellForPortrait(portrait);
      composites.push({
        input: await sharp(source.sheet.sourcePath)
          .extract(source.cellBounds)
          .resize(sourceSize, sourceSize)
          .png()
          .toBuffer(),
        left,
        top,
      });
    }
    composites.push({
      input: Buffer.from(arrowSvg(18, outputSize)),
      left: left + sourceSize,
      top,
    });
    composites.push({
      input: join(PROJECT_ROOT, "public", portrait.smallUrl.replace(/^\//, "")),
      left: left + sourceSize + 18,
      top,
    });
    composites.push({
      input: Buffer.from(labelSvg(tileWidth, labelHeight, portrait.id)),
      left,
      top: top + outputSize + 2,
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
    .toFile(COMPARISON_CONTACT_SHEET_PATH);
}

async function writeZoomReviewArtifacts(
  portraits: LeaderProfilePortrait[],
  fallback: LeaderProfilePortrait,
  validationAssets: ValidationAsset[],
): Promise<void> {
  const assets = [...portraits, fallback];
  const validationById = new Map(validationAssets.map((asset) => [asset.id, asset]));
  const entries: Array<{
    id: string;
    label: string;
    poolId: string;
    largeAssetPath: string;
    zoomReviewPath: string;
    emptyBoundaryRatio: number;
    maxEmptyBoundarySectorRatio: number;
  }> = [];
  const zoomSize = 560;
  const canvasWidth = 680;
  const canvasHeight = 740;
  const imageLeft = Math.round((canvasWidth - zoomSize) / 2);
  const imageTop = 72;

  for (const portrait of assets) {
    const largeAssetPath = join(PROJECT_ROOT, "public", portrait.largeUrl.replace(/^\//, ""));
    const zoomReviewPath = join(ZOOM_REVIEW_ROOT, `${portrait.id}.png`);
    const validation = validationById.get(portrait.id);
    if (!validation) throw new Error(`missing validation entry for ${portrait.id}`);
    const metrics = [
      `empty boundary ${validation.large.emptyBoundaryRatio}`,
      `max sector ${validation.large.maxEmptyBoundarySectorRatio}`,
      `center x ${validation.large.visualCenterOffsetX}`,
      `center y ${validation.large.visualCenterOffsetY}`,
    ].join(" | ");

    await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: "#111827",
      },
    })
      .composite([
        { input: Buffer.from(zoomHeaderSvg(canvasWidth, 56, portrait.label, metrics)), left: 0, top: 10 },
        { input: checkerboardSvg(zoomSize), left: imageLeft, top: imageTop },
        {
          input: await sharp(largeAssetPath).resize(zoomSize, zoomSize).png().toBuffer(),
          left: imageLeft,
          top: imageTop,
        },
        { input: Buffer.from(zoomCrosshairSvg(zoomSize)), left: imageLeft, top: imageTop },
      ])
      .png()
      .toFile(zoomReviewPath);

    entries.push({
      id: portrait.id,
      label: portrait.label,
      poolId: portrait.poolId,
      largeAssetPath,
      zoomReviewPath,
      emptyBoundaryRatio: validation.large.emptyBoundaryRatio,
      maxEmptyBoundarySectorRatio: validation.large.maxEmptyBoundarySectorRatio,
    });
  }

  await writeFile(
    ZOOM_REVIEW_MANIFEST_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        description:
          "One zoom/open-scale review image per generated 320px profile asset. Reviewers should inspect these images, not only the thumbnail contact sheet.",
        entries,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    ZOOM_REVIEW_INDEX_PATH,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Leader profile zoom review</title>
  <style>
    body { margin: 0; background: #0f172a; color: #e5e7eb; font-family: Inter, Arial, sans-serif; }
    main { padding: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }
    figure { margin: 0; padding: 12px; border: 1px solid #334155; border-radius: 8px; background: #111827; }
    img { display: block; width: 100%; height: auto; }
    figcaption { margin-top: 8px; font-size: 13px; color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <h1>Leader profile zoom review</h1>
    <p>Inspect each generated 320px profile asset at open/zoom scale. Reject visible white or empty boundaries inside the round portrait.</p>
    <div class="grid">
${entries
  .map(
    (entry) => `      <figure>
        <img src="zoomed-assets/${entry.id}.png" alt="${escapeXml(entry.label)} zoom review" />
        <figcaption>${escapeXml(entry.label)} | empty boundary ${entry.emptyBoundaryRatio} | max sector ${entry.maxEmptyBoundarySectorRatio}</figcaption>
      </figure>`,
  )
  .join("\n")}
    </div>
  </main>
</body>
</html>
`,
  );
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

async function sourceCellForPortrait(portrait: LeaderProfilePortrait): Promise<{
  sheet: PortraitSheet;
  cellBounds: { left: number; top: number; width: number; height: number };
}> {
  const [sheetName, cellNumberText] = portrait.id.split("-");
  const cellNumber = Number(cellNumberText);
  const sheet = PORTRAIT_SHEETS.find(
    (candidate) =>
      basename(candidate.sourcePath)
        .replace(/\.[^.]+$/, "")
        .toLowerCase() === sheetName,
  );
  if (!sheet || !Number.isInteger(cellNumber) || cellNumber < 1 || cellNumber > GRID_SIZE * GRID_SIZE) {
    throw new Error(`cannot map portrait ${portrait.id} back to source cell`);
  }
  const metadata = await sharp(sheet.sourcePath).metadata();
  const width = requirePositiveDimension(metadata.width, sheet.sourcePath, "width");
  const height = requirePositiveDimension(metadata.height, sheet.sourcePath, "height");
  if (width !== height) {
    throw new Error(`${sheet.sourcePath} must be a square sheet`);
  }
  const zeroBased = cellNumber - 1;
  const row = Math.floor(zeroBased / GRID_SIZE);
  const column = zeroBased % GRID_SIZE;
  return {
    sheet,
    cellBounds: gridCellBounds(width, row, column),
  };
}

function emptySourcePlaceholderSvg(size: number, label: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#1F2937"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="600" fill="#CBD5E1">${escapeXml(label)}</text>
</svg>`;
}

function arrowSvg(width: number, height: number): string {
  const y = Math.round(height / 2);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 ${y}H${width - 6}" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/>
  <path d="M${width - 7} ${y - 5}L${width - 2} ${y}L${width - 7} ${y + 5}" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function zoomHeaderSvg(width: number, height: number, label: string, metrics: string): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${width / 2}" y="21" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700" fill="#F8FAFC">${escapeXml(label)}</text>
  <text x="${width / 2}" y="43" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" fill="#CBD5E1">${escapeXml(metrics)}</text>
</svg>`;
}

function checkerboardSvg(size: number): Buffer {
  const square = 20;
  const rects: string[] = [];
  for (let y = 0; y < size; y += square) {
    for (let x = 0; x < size; x += square) {
      const fill = (x / square + y / square) % 2 === 0 ? "#0F172A" : "#1E293B";
      rects.push(`<rect x="${x}" y="${y}" width="${square}" height="${square}" fill="${fill}"/>`);
    }
  }
  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${rects.join("")}</svg>`,
  );
}

function zoomCrosshairSvg(size: number): string {
  const center = size / 2;
  const radius = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${center}" cy="${center}" r="${radius - 1}" fill="none" stroke="#F8FAFC" stroke-opacity="0.95" stroke-width="2"/>
  <path d="M${center} 0V${size}M0 ${center}H${size}" stroke="#38BDF8" stroke-opacity="0.55" stroke-width="1"/>
</svg>`;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function weightedMean(values: Array<{ value: number; weight: number }>, fallback: number): number {
  let totalWeight = 0;
  let weightedTotal = 0;
  for (const item of values) {
    if (item.weight <= 0) continue;
    totalWeight += item.weight;
    weightedTotal += item.value * item.weight;
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : fallback;
}

function weightedQuantile(
  values: Array<{ value: number; weight: number }>,
  quantile: number,
  fallback: number,
): number {
  const sorted = values.filter((item) => item.weight > 0).sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return fallback;
  const target = totalWeight * quantile;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.value;
  }
  return sorted.at(-1)?.value ?? fallback;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  console.log(`source comparison sheet: ${result.comparisonContactSheetPath}`);
  console.log(`zoom review index: ${result.zoomReviewIndexPath}`);
  console.log(`zoom review manifest: ${result.zoomReviewManifestPath}`);
  console.log(`zoom review assets: ${result.zoomReviewRoot}`);
}
