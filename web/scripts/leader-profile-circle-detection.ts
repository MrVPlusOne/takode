/**
 * Finds the round portraits on a sheet of circular avatars drawn on a plain light background.
 *
 * Portraits are found from the image itself rather than from a fixed grid: each one is a
 * region that differs from the sheet background, and its usable circle is the largest circle
 * that fits inside that region. Hand-drawn sheets have slightly irregular circles and pale
 * halos, so the largest inscribed circle (shrunk by a small inset that drops the soft
 * antialiased edge) is what keeps the background out of the final round avatar.
 */

/** A portrait circle found on a sheet, in source-pixel coordinates. */
export interface DetectedPortraitCircle {
  /** Center of the usable circle. */
  centerX: number;
  centerY: number;
  /** Radius of the usable circle after the edge inset. */
  radius: number;
  /**
   * Usable radius divided by the radius of a circle with the region's area. Near 1 for a
   * round region; lower values mean the region is irregular and the avatar crops into it.
   */
  fillRatio: number;
  /** Share of pixels in the outer ring of the usable circle that look like sheet background. */
  rimBackgroundRatio: number;
}

/**
 * Color distance from the sheet background above which a pixel belongs to a portrait. Sheet
 * background sits within about 8 of its median color; pale content painted at a portrait's
 * rim (snow, white fur) starts around 15, so a higher threshold eats into those portraits.
 */
const PORTRAIT_DISTANCE_THRESHOLD = 12;
/** Color distance within which a pixel counts as plain background when checking the rim. */
const RIM_BACKGROUND_DISTANCE = 10;
/** Regions smaller than this share of the largest region are specks, not portraits. */
const MIN_REGION_AREA_RATIO = 0.25;
/** Inner edge of the ring checked for background, as a share of the usable radius. */
const RIM_INNER_RATIO = 0.94;

/**
 * Detects every portrait circle on a sheet and returns them in reading order (rows top to
 * bottom, left to right within a row).
 *
 * `raw` holds interleaved pixels with `channels` values each (RGB or RGBA; alpha is ignored).
 */
export function detectPortraitCircles(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
): DetectedPortraitCircle[] {
  const background = estimateBackgroundColor(raw, width, height, channels);
  const distance = (index: number) =>
    Math.hypot(
      raw[index * channels] - background[0],
      raw[index * channels + 1] - background[1],
      raw[index * channels + 2] - background[2],
    );
  const outside = floodOutsideBackground(width, height, (index) => distance(index) <= PORTRAIT_DISTANCE_THRESHOLD);
  const regions = labelRegions(outside, width, height);
  const largestArea = Math.max(0, ...regions.map((region) => region.points.length));
  const circles = regions
    .filter((region) => region.points.length >= largestArea * MIN_REGION_AREA_RATIO)
    .map((region) => {
      // Pale content touching the rim (snow, white fur) reads as background and cuts notches
      // into the region; the convex hull closes them because portraits are round.
      const hull = convexHull(region.points, width);
      const inscribed = largestInscribedCircle(hull);
      const inset = Math.max(2, Math.round(inscribed.radius * 0.02));
      const radius = inscribed.radius - inset;
      return {
        centerX: inscribed.centerX,
        centerY: inscribed.centerY,
        radius,
        fillRatio: radius / Math.sqrt(region.points.length / Math.PI),
        rimBackgroundRatio: measureRimBackground(
          inscribed.centerX,
          inscribed.centerY,
          radius,
          width,
          height,
          (index) => distance(index) <= RIM_BACKGROUND_DISTANCE,
        ),
      };
    });
  return sortInReadingOrder(circles);
}

function estimateBackgroundColor(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
): [number, number, number] {
  const values: [number[], number[], number[]] = [[], [], []];
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, 1, height - 2, height - 1]) {
      const index = (y * width + x) * channels;
      for (let channel = 0; channel < 3; channel += 1) values[channel].push(raw[index + channel]);
    }
  }
  return values.map((channelValues) => {
    channelValues.sort((a, b) => a - b);
    return channelValues[channelValues.length >> 1] ?? 0;
  }) as [number, number, number];
}

/** Marks background-colored pixels reachable from the sheet edge; enclosed pale areas stay inside portraits. */
function floodOutsideBackground(width: number, height: number, isBackground: (index: number) => boolean): Uint8Array {
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (outside[index] || !isBackground(index)) continue;
    outside[index] = 1;
    for (const next of neighbors(index, width, height)) stack.push(next);
  }
  return outside;
}

function labelRegions(outside: Uint8Array, width: number, height: number): Array<{ points: number[] }> {
  const seen = new Uint8Array(width * height);
  const regions: Array<{ points: number[] }> = [];
  for (let start = 0; start < width * height; start += 1) {
    if (outside[start] || seen[start]) continue;
    const points: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() as number;
      points.push(index);
      for (const next of neighbors(index, width, height)) {
        if (outside[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    regions.push({ points });
  }
  return regions;
}

function neighbors(index: number, width: number, height: number): number[] {
  const x = index % width;
  const y = (index - x) / width;
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x < width - 1) result.push(index + 1);
  if (y > 0) result.push(index - width);
  if (y < height - 1) result.push(index + width);
  return result;
}

type Point = [number, number];

/** Convex hull (counter-clockwise) of a region, built from each row's leftmost and rightmost pixel. */
function convexHull(points: number[], width: number): Point[] {
  const rowExtents = new Map<number, [number, number]>();
  for (const index of points) {
    const x = index % width;
    const y = (index - x) / width;
    const extent = rowExtents.get(y);
    if (!extent) rowExtents.set(y, [x, x]);
    else rowExtents.set(y, [Math.min(extent[0], x), Math.max(extent[1], x)]);
  }
  // Pixel edges (+1) so the hull covers whole pixels rather than their top-left corners.
  const candidates: Point[] = [];
  for (const [y, [minX, maxX]] of rowExtents) {
    candidates.push([minX, y], [minX, y + 1], [maxX + 1, y], [maxX + 1, y + 1]);
  }
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const point of candidates) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...candidates].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Largest circle inside a convex polygon, found with a Euclidean distance transform of its raster. */
function largestInscribedCircle(hull: Point[]): { centerX: number; centerY: number; radius: number } {
  const minX = Math.floor(Math.min(...hull.map((point) => point[0]))) - 1;
  const minY = Math.floor(Math.min(...hull.map((point) => point[1]))) - 1;
  const maxX = Math.ceil(Math.max(...hull.map((point) => point[0]))) + 1;
  const maxY = Math.ceil(Math.max(...hull.map((point) => point[1]))) + 1;
  const width = maxX - minX;
  const height = maxY - minY;
  const squared = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      squared[y * width + x] = insideConvexPolygon(hull, minX + x + 0.5, minY + y + 0.5) ? Number.MAX_SAFE_INTEGER : 0;
    }
  }
  squaredDistanceTransform(squared, width, height);
  let best = 0;
  let bestIndex = 0;
  for (let index = 0; index < squared.length; index += 1) {
    if (squared[index] > best) {
      best = squared[index];
      bestIndex = index;
    }
  }
  const x = bestIndex % width;
  const y = (bestIndex - x) / width;
  return { centerX: minX + x + 0.5, centerY: minY + y + 0.5, radius: Math.sqrt(best) };
}

function insideConvexPolygon(hull: Point[], x: number, y: number): boolean {
  for (let index = 0; index < hull.length; index += 1) {
    const [ax, ay] = hull[index];
    const [bx, by] = hull[(index + 1) % hull.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}

/** In-place squared Euclidean distance to the nearest zero cell (Felzenszwalb-Huttenlocher). */
function squaredDistanceTransform(grid: Float64Array, width: number, height: number): void {
  const column = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) column[y] = grid[y * width + x];
    const result = distanceTransform1d(column);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = result[y];
  }
  const row = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) row[x] = grid[y * width + x];
    const result = distanceTransform1d(row);
    for (let x = 0; x < width; x += 1) grid[y * width + x] = result[x];
  }
}

function distanceTransform1d(values: Float64Array): Float64Array {
  const length = values.length;
  const result = new Float64Array(length);
  const vertices = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  const intersection = (q: number, v: number) => (values[q] + q * q - (values[v] + v * v)) / (2 * q - 2 * v);
  let k = 0;
  boundaries[0] = -Infinity;
  boundaries[1] = Infinity;
  for (let q = 1; q < length; q += 1) {
    let s = intersection(q, vertices[k]);
    while (s <= boundaries[k]) {
      k -= 1;
      s = intersection(q, vertices[k]);
    }
    k += 1;
    vertices[k] = q;
    boundaries[k] = s;
    boundaries[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q += 1) {
    while (boundaries[k + 1] < q) k += 1;
    result[q] = (q - vertices[k]) ** 2 + values[vertices[k]];
  }
  return result;
}

function measureRimBackground(
  centerX: number,
  centerY: number,
  radius: number,
  width: number,
  height: number,
  isBackground: (index: number) => boolean,
): number {
  let total = 0;
  let background = 0;
  for (let y = Math.floor(centerY - radius); y <= Math.ceil(centerY + radius); y += 1) {
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (distance > radius || distance < radius * RIM_INNER_RATIO) continue;
      total += 1;
      if (isBackground(y * width + x)) background += 1;
    }
  }
  return total > 0 ? background / total : 0;
}

/** Groups circles into rows (a new row starts when a center sits below the row by more than a radius). */
function sortInReadingOrder(circles: DetectedPortraitCircle[]): DetectedPortraitCircle[] {
  const rows: DetectedPortraitCircle[][] = [];
  for (const circle of [...circles].sort((a, b) => a.centerY - b.centerY)) {
    const row = rows.at(-1);
    if (row && circle.centerY - row[0].centerY < circle.radius) row.push(circle);
    else rows.push([circle]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.centerX - b.centerX));
}
