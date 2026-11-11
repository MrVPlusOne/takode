/**
 * Where the living Ink & Paper scene puts its painted layers in a pane of any shape, and how its
 * cranes fly. Pure functions of the pane size and the time, so the same moment always looks the
 * same. Rects are pane pixels: x and y of the top left corner (the centre for cranes), width,
 * height; a negative width mirrors the layer.
 */

import { type CraneFlight, craneWidth, type DirectorFrame, flightPosition } from "./ink-alive-director.js";

export interface PaneSize {
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface SceneLayout {
  horizon: number;
  sun: [number, number, number];
  far: number[];
  midFar: number[];
  mid: number[];
  near: number[];
  boat: number[];
  /** Up to three cranes: centre x, y, width (negative to mirror), height. */
  craneRects: number[];
  /** Three cranes: frame a, frame b, blend between them, tilt in radians. */
  cranePoses: number[];
}

/**
 * Lays the scene out for the pane it is in, whatever its shape: the sun, the cranes' paths and
 * the two clusters of peaks always sit inside the pane, so a narrow conversation next to the side
 * column shows the same painting as a wide one, composed for its shape. `now` is real seconds
 * (cranes fly in real time); `scene` is the director's frame.
 */
export function layoutScene(
  pane: PaneSize,
  images: { far: ImageSize; midFar: ImageSize; mid: ImageSize; near: ImageSize; boat: ImageSize; crane: ImageSize },
  now: number,
  scene: DirectorFrame,
): SceneLayout {
  const { width: w, height: h } = pane;
  const aspect = w / h;
  const narrow = aspect < 0.75;
  const horizon = h * (narrow ? 0.84 : 0.8);
  // Narrower panes get the peaks larger, so their two clusters still frame the pane's edges.
  const midWidth = w * Math.min(2.1, Math.max(1.15, 1.15 + (1.05 - aspect) * 1.3));
  const nearWidth = w * (narrow ? 1.7 : aspect < 1.1 ? 1.15 : 1.02);
  return {
    horizon,
    sun: sunOrMoon(pane, narrow),
    far: placed(images.far, pane, Math.max(w * 1.15, h * 1.4), horizon - h * 0.1),
    midFar: placed(images.midFar, pane, Math.max(w * 1.1, h * 1.6), horizon - h * 0.02),
    mid: placed(images.mid, pane, midWidth, horizon + h * 0.03, narrow ? -0.1 : 0),
    near: placed(images.near, pane, nearWidth, h * (narrow ? 1.04 : 1.1)),
    boat: boatRect(pane, images.boat, horizon, scene.sceneTime),
    ...cranes(pane, images.crane, now, scene.cranes),
  };
}

/** The sun by day or the moon by night, in the upper right of the pane. */
function sunOrMoon(pane: PaneSize, narrow: boolean): [number, number, number] {
  const { width: w, height: h } = pane;
  return [
    w - Math.min(260, Math.max(70, w * 0.16)),
    h * (narrow ? 0.11 : 0.14),
    Math.min(34, Math.max(12, Math.min(w, h) * 0.024)),
  ];
}

/** A layer `width` wide whose bottom edge sits at `bottom`, shifted sideways by `shift` of its width. */
function placed(image: ImageSize, pane: PaneSize, width: number, bottom: number, shift = 0): number[] {
  const height = (width * image.height) / image.width;
  return [(pane.width - width) / 2 + shift * width, bottom - height, width, height];
}

/** The boat drifts across the lake and back over about five minutes, facing the way it goes. */
function boatRect(pane: PaneSize, boat: ImageSize, horizon: number, time: number): number[] {
  const { width: w, height: h } = pane;
  const boatWidth = Math.min(110, Math.max(56, w * 0.07));
  const boatHeight = (boatWidth * boat.height) / boat.width;
  const leg = (time % 300) / 150;
  const going = leg < 1;
  const along = going ? leg : 2 - leg;
  const eased = along * along * (3 - 2 * along);
  // Over open water, clear of the cliffs at both sides.
  const x = w * 0.24 + eased * (w * 0.5 - boatWidth);
  const top = horizon + h * 0.045 - boatHeight;
  return going ? [x, top, boatWidth, boatHeight] : [x + boatWidth, top, -boatWidth, boatHeight];
}

/** Up to three cranes from the flights in the air; unused slots are drawn nowhere. */
function cranes(
  pane: PaneSize,
  strip: ImageSize,
  now: number,
  flights: CraneFlight[],
): { craneRects: number[]; cranePoses: number[] } {
  const { width: w, height: h } = pane;
  const craneRects: number[] = [];
  const cranePoses: number[] = [];
  for (const flight of flights) {
    const lead = craneWidth(flight, w);
    const { x, along } = flightPosition(flight, now, w);
    // Ease from the entry height to the exit height, with a slow, shallow meander.
    const eased = along * along * (3 - 2 * along);
    const y =
      h * (flight.fromY + (flight.toY - flight.fromY) * eased) + Math.sin((now - flight.start) * 0.21) * h * 0.008;
    for (const bird of flight.birds) {
      if (craneRects.length >= 12) break;
      const width = lead * bird.scale;
      const height = (width * strip.height * 6) / strip.width;
      const pose = wingbeat(now - flight.start + bird.seed, bird.seed, bird.glide);
      // Followers trail behind the lead, whichever way the flock flies.
      const bx = x - flight.direction * bird.dx * lead;
      // The sprite faces left; a negative width mirrors it for flights to the right.
      craneRects.push(bx, y + bird.dy * lead + pose.lift * height, width * -flight.direction, height);
      cranePoses.push(pose.frameA, pose.frameB, pose.blend, pose.tilt * -flight.direction);
    }
  }
  while (craneRects.length < 12) {
    craneRects.push(-1e5, -1e5, 1, 1);
    cranePoses.push(0, 0, 0, 0);
  }
  return { craneRects, cranePoses };
}

// The six frames of the sprite, in flight order from wings level: down, rising halfway, up, up,
// sweeping down halfway, level again. The downstroke is quicker than the upstroke.
const CYCLE = [
  { frame: 2, share: 0.13 },
  { frame: 3, share: 0.14 },
  { frame: 4, share: 0.19 },
  { frame: 5, share: 0.18 },
  { frame: 0, share: 0.16 },
  { frame: 1, share: 0.2 },
];
const BEAT = 1.15;
const BEATS = 2;

/**
 * One crane's wings: two slow wingbeats, then a long glide on level wings (`glide` seconds), again
 * and again, as large cranes fly. The body rises on each downstroke and sinks slowly while
 * gliding; it pitches with the beats and banks a little while gliding.
 */
export function wingbeat(time: number, seed: number, glide: number) {
  const period = BEAT * BEATS + glide;
  const at = (((time + seed * 2.3) % period) + period) % period;
  // A slow bank that carries through beats and glides alike, so the tilt never jumps.
  const bank = Math.sin(time * 0.4 + seed) * 0.035;
  if (at >= BEAT * BEATS) {
    const gliding = (at - BEAT * BEATS) / glide;
    return {
      frameA: 2,
      frameB: 2,
      blend: 0,
      lift: Math.sin(gliding * Math.PI) * 0.045 - 0.03,
      tilt: bank - Math.sin(gliding * Math.PI) * 0.025,
    };
  }
  const phase = (at % BEAT) / BEAT;
  let start = 0;
  let index = 0;
  while (index < CYCLE.length - 1 && phase >= start + CYCLE[index]!.share) {
    start += CYCLE[index]!.share;
    index += 1;
  }
  return {
    frameA: CYCLE[index]!.frame,
    frameB: CYCLE[index]!.frame,
    // Whole frames, like hand-drawn animation: a cross-fade would show ghost wings.
    blend: 0,
    // Lifts on the downstroke (the first part of the cycle), settles on the upstroke.
    lift: -Math.sin(phase * Math.PI * 2) * 0.035 - 0.03,
    tilt: bank + Math.sin(phase * Math.PI * 2) * 0.025,
  };
}
