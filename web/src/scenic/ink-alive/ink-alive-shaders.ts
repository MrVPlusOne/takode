/**
 * GLSL for the living Ink & Paper scene. The whole scene is one fragment shader over a few
 * painted layers, so a frame costs one full-pane pass on the GPU and almost nothing on the CPU.
 * Coordinates are pane pixels with the origin at the top left (`px`), or pane pixels divided by
 * the pane height (`q`) where sizes should follow the pane's height.
 *
 * Everything that moves follows `uTime`, the director's scene clock (which slows while you work),
 * plus the cranes and fish rings the director places and the clouds the fluid simulation carries.
 */

export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * Painted layers, back to front: paper and sky with the sun or moon, distant ridges, pale far
 * peaks, tall peaks, a lake mirroring them with a drifting boat, flying cranes, near cliffs with
 * pines. A sea of clouds streams through the valleys and around the peaks, carried by a small
 * fluid simulation, and the light breathes around the sun. The painting itself never moves.
 */
export const INK_ALIVE_SHADER = `
precision highp float;
uniform vec2 uRes;      // canvas size in pixels
uniform float uScale;   // canvas pixels per pane pixel
uniform float uTime;    // seconds
uniform float uDark;    // 0 light theme, 1 dark theme

uniform sampler2D uNoise;
uniform sampler2D uPaper;
uniform sampler2D uFar;
uniform sampler2D uMidFar;
uniform sampler2D uMid;
uniform sampler2D uFarNight;    // the same peaks painted moonlit, pale ink on black
uniform sampler2D uMidFarNight;
uniform sampler2D uMidNight;
uniform sampler2D uNear;
uniform sampler2D uBoat;
uniform sampler2D uCrane;   // six wingbeat frames side by side, premultiplied alpha
uniform vec4 uFarRect;
uniform vec4 uMidFarRect;
uniform vec4 uMidRect;
uniform vec4 uNearRect;
uniform vec4 uBoatRect;
uniform float uHorizon;     // lake line, pane pixels
uniform vec3 uSun;          // x, y, radius in pane pixels
uniform vec4 uCraneRect[3]; // centre x, y, width (negative to mirror), height
uniform vec4 uCranePose[3]; // frame a, frame b, blend, tilt (radians)
uniform sampler2D uClouds;  // cloud carried by the fluid simulation (density in red), pane-sized
uniform float uHasClouds;   // 1 when the simulation runs
uniform vec4 uRing[2];      // fish rings on the lake: x (fraction), depth below the lake line (fraction), start, unused


// Value noise from a tiling texture of random values, smoothstepped between texels.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  return texture2D(uNoise, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 256.0).r;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

vec2 paneSize() { return uRes / uScale; }

float band(float y, float top, float bottom, float soft) {
  return smoothstep(top - soft, top + soft, y) * (1.0 - smoothstep(bottom - soft, bottom + soft, y));
}

// Ink density (0 paper, 1 black ink) of a layer painted as dark ink on white.
float inkAt(sampler2D tex, vec4 rect, vec2 px) {
  vec2 uv = (px - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return 1.0 - texture2D(tex, uv).r;
}

// Clouds drifting sideways at a pace you can follow (speed in pane heights a second), billowing
// as they go: the warp that shapes them evolves on its own, so their forms roll and change.
float cloud(vec2 q, float speed, float scale, float threshold, float seed) {
  vec2 flow = vec2(uTime * speed, sin(uTime * speed * 3.0 + seed) * 0.02);
  vec2 p = q - flow;
  vec2 warp = vec2(fbm(p * 1.7 + seed + uTime * 0.012), fbm(p * 1.7 + seed + 5.2 - uTime * 0.01));
  float n = fbm(p * vec2(scale, scale * 2.4) + warp * 0.9 + seed);
  return smoothstep(threshold, threshold + 0.16, n);
}

float lightAt(sampler2D tex, vec4 rect, vec2 px) {
  vec2 uv = (px - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture2D(tex, uv).r;
}

// A layer's ink density by day (x) and its moonlit brightness at night (y). The painting itself
// never moves: the ink that moves is the simulation's, drawn over it.
vec2 layerInk(sampler2D day, sampler2D night, vec4 rect, vec2 px) {
  return vec2(inkAt(day, rect, px), lightAt(night, rect, px));
}

// Paints a moonlit layer over the night scene so far (premultiplied colour and coverage):
// a peak covers what is behind it with its own pale brushwork.
void over(inout vec4 scene, vec3 color, float cover) {
  scene = vec4(color * cover + scene.rgb * (1.0 - cover), cover + scene.a * (1.0 - cover));
}

// Mist or cloud over the moonlit layers: it can only lighten what it covers. A veil darker than
// bright rock left a sooty fringe on the peaks, which read as smoke.
void veil(inout vec4 scene, vec3 color, float cover) {
  vec3 behind = scene.a > 0.001 ? scene.rgb / scene.a : color;
  over(scene, max(color, behind), cover);
}

// One crane's colour (premultiplied) and coverage at px.
vec4 crane(vec4 rect, vec4 pose, vec2 px) {
  vec2 d = px - rect.xy;
  float c = cos(-pose.w);
  float s = sin(-pose.w);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  vec2 uv = d / rect.zw + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  vec4 a = texture2D(uCrane, vec2((pose.x + uv.x) / 6.0, uv.y));
  vec4 b = texture2D(uCrane, vec2((pose.y + uv.x) / 6.0, uv.y));
  return mix(a, b, pose.z);
}

void main() {
  vec2 size = paneSize();
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float h = size.y;
  vec2 q = px / h;
  float t = uTime;
  // A slow camera breath; nearer layers move more.
  vec2 drift = vec2(sin(t * 0.014) * 0.008 * size.x, 0.0);
  bool lake = px.y > uHorizon;

  // Where the peaks are sampled from: themselves, or their mirror image in the lake.
  vec2 at = px;
  float mirror = 1.0;
  // Rings where a fish touched the water: they spread, bend the reflection and fade.
  float rings = 0.0;
  if (lake) {
    for (int i = 0; i < 2; i++) {
      vec4 ring = uRing[i];
      float age = t - ring.z;
      if (age < 0.0 || age > 9.0) continue;
      vec2 d = (px - vec2(ring.x * size.x, uHorizon + ring.y * h)) * vec2(1.0, 3.2) / h;
      float r = length(d) - age * 0.022;
      rings += sin(r * 180.0) * exp(-r * r / 0.0006) * exp(-age * 0.45);
    }
  }
  if (lake) {
    float depth = (px.y - uHorizon) / h;
    // Gentle swell: rows of small waves travelling toward you, breaking the reflection into
    // softly moving bands.
    // Broad, gentle bands: narrow ones broke every reflected edge into sawtooth zigzags.
    float swell = sin(px.y * 0.16 - t * 0.9 + noise(vec2(px.x * 0.01, px.y * 0.03)) * 4.0);
    float wobble = swell * (1.0 + depth * 14.0)
      + (noise(vec2(px.x * 0.02 + t * 0.05, px.y * 0.08 - t * 0.3)) - 0.5) * (2.0 + depth * 10.0);
    at = vec2(px.x + wobble + rings * 4.0, uHorizon - (px.y - uHorizon) * 1.15 + rings * 2.0);
    // Faint by day, fainter at night, where reflected peaks read as wavy stripes on dark water.
    mirror = mix(0.32, 0.18, uDark) * (1.0 - smoothstep(0.0, 0.24, depth));
  }

  // Back to front, each layer covering what is behind it like ink washes on paper.
  vec3 moon = vec3(0.9, 0.92, 0.97);
  vec3 fog = vec3(0.36, 0.375, 0.4);
  vec4 moonlit = vec4(0.0);
  vec2 farS = layerInk(uFar, uFarNight, uFarRect, at + drift * 0.25);
  float far = farS.x * 0.7;
  // At night the distant ridges sink toward the sky's tone, so distance reads as it does by day.
  over(moonlit, moon * (0.16 + farS.y * 0.3), smoothstep(0.02, 0.3, farS.x) * 0.7);
  float hazeFar = cloud(q, 0.006, 1.1, 0.5, 3.0) * band(at.y, uHorizon - 0.24 * h, uHorizon, 0.06 * h);
  far *= 1.0 - hazeFar * 0.8;
  veil(moonlit, fog, hazeFar * 0.55);
  vec2 midFarS = layerInk(uMidFar, uMidFarNight, uMidFarRect, at + drift * 0.5);
  float midFar = midFarS.x * 0.75;
  over(moonlit, moon * (0.13 + midFarS.y * 0.5), smoothstep(0.02, 0.3, midFarS.x) * 0.85);
  float peaks = 1.0 - (1.0 - far) * (1.0 - midFar);
  float hazeMid = cloud(q, 0.009, 1.25, 0.48, 9.0) * band(at.y, uHorizon - 0.3 * h, uHorizon + 0.02 * h, 0.07 * h);
  peaks *= 1.0 - hazeMid * 0.85;
  veil(moonlit, fog, hazeMid * 0.6);
  vec2 midS = layerInk(uMid, uMidNight, uMidRect, at + drift);
  float mid = midS.x;
  over(moonlit, moon * midS.y, smoothstep(0.02, 0.28, midS.x));
  peaks = 1.0 - (1.0 - peaks) * (1.0 - mid);
  peaks *= mirror;
  moonlit *= mirror;

  // Clouds through the peaks: thin streams high up, and the sea of clouds at their feet.
  float high = cloud(q, 0.011, 1.3, 0.5, 1.0) * band(px.y, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h);
  high *= mix(1.0, 0.5, uHasClouds);
  // The sea of clouds has a body and a top. Its top rests higher in the open valley in the middle
  // than against the big masses at the sides, and lobes rise and sink along it. Lumps and wisps
  // inside it travel left with the breeze at a pace you can follow, the far ones (near the top)
  // slower than the near ones; each layer moves as a whole, as a sheared pattern would smear
  // into streaks over time. The fluid simulation adds the banks streaming through the valleys
  // and the slow swells. A painter leaves the cloud as paper and washes a little grey under the
  // top lobes; at night the moon lights the tops silver and the body thins to show dark rock.
  float xr = px.x / size.x;
  float valley = smoothstep(0.08, 0.38, xr) * (1.0 - smoothstep(0.62, 0.92, xr));
  float lobes = fbm(vec2(q.x * 1.4 + t * 0.012, t * 0.015)) - 0.5;
  float topY = uHorizon - h * (0.13 + 0.07 * valley + lobes * 0.12);
  vec2 warp = vec2(fbm(q * 1.5 + vec2(t * 0.01, -t * 0.008)), fbm(q * 1.5 + vec2(5.2, 1.3) - t * 0.009)) - 0.5;
  float far2 = fbm(vec2((q.x + t * 0.009) * 5.0, q.y * 9.0) + warp * 0.8 + 13.0);
  float near2 = fbm(vec2((q.x + t * 0.018) * 4.0, q.y * 7.5) + warp * 0.8);
  // fbm stays near its middle; stretch it so lumps and gaps are clearly shaped.
  float n = clamp((mix(far2, near2, smoothstep(topY - 0.02 * h, topY + 0.14 * h, px.y)) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float below = (px.y - topY) / h;
  // Inside, the sea is solid; its top breaks into lumps and wisps that travel and change.
  float seaBody = smoothstep(-0.05, 0.06, below + (n - 0.5) * 0.15);
  // Over the water the sea thins out with a soft, uneven lower edge, not a ruled line.
  // Its waviness is measured across the pane's width, so a narrow phone pane gets as much as a wide one.
  float edge = uHorizon + h * (0.035 + (fbm(vec2(xr * 5.0 + t * 0.015, 3.7)) - 0.5) * 0.07 + (n - 0.5) * 0.04);
  seaBody *= 1.0 - smoothstep(edge - 0.03 * h, edge + 0.08 * h, px.y);
  float sim = texture2D(uClouds, gl_FragCoord.xy / uRes).r * uHasClouds
    * (1.0 - smoothstep(uHorizon - 0.03 * h, uHorizon + 0.05 * h, px.y))
    // The banks it carries cling to the peaks just above the sea, not up in the open sky.
    * smoothstep(topY - 0.14 * h, topY - 0.02 * h, px.y);
  float density = seaBody * (0.5 + 0.75 * n) + sim * (0.3 + 0.7 * n);
  float cover = smoothstep(0.2, 0.9, density) * uHasClouds;
  float mist = max(high * 0.85, cover * 0.96);
  peaks *= 1.0 - mist;
  // In the water, peaks hidden by the sea are hidden in their reflection too.
  float mirrorBody = lake ? smoothstep(-0.02, 0.06, (at.y - topY) / h) * uHasClouds : 0.0;
  peaks *= 1.0 - mirrorBody * 0.9;
  moonlit *= 1.0 - mirrorBody * 0.9;
  // At night the moon lights the lumpy tops silver and they are the most solid part. Lower down,
  // against the peaks, the cloud thins so the rock shows faintly through, as by day. Over the
  // water it stays thick: thinning there only revealed the dark lake, as holes in the cloud.
  float tops = 1.0 - smoothstep(0.02, 0.18, below);
  float onWater = smoothstep(uHorizon - 0.08 * h, uHorizon - 0.01 * h, px.y) * seaBody;
  float nightCover = max(cover, onWater * 0.9);
  float nightOpacity = mix(mix(0.72 + 0.18 * n, 0.88, tops), 0.86, onWater);
  float lit = 0.45 + tops * 0.35 + n * 0.2;
  // A thin moonlit mist hangs around the sea's top, so the gaps between lumps read as mist over
  // rock rather than dark holes in the cloud.
  veil(moonlit, mix(fog * 1.35, moon * 0.62, 0.5), exp(-below * below / 0.012) * 0.65 * uHasClouds);
  veil(moonlit, mix(fog * 1.2, moon * 0.82, lit), max(high * 0.6, nightCover * nightOpacity));
  // A painter's wash in the shadow under each lump: where there is more cloud just above than
  // here, as under an overhang.
  float nAbove = clamp((mix(fbm(vec2((q.x + t * 0.009) * 5.0, (q.y - 0.025) * 9.0) + warp * 0.8 + 13.0),
    fbm(vec2((q.x + t * 0.018) * 4.0, (q.y - 0.025) * 7.5) + warp * 0.8),
    smoothstep(topY - 0.02 * h, topY + 0.14 * h, px.y - 0.025 * h)) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float lobeWash = clamp((nAbove - n) * 2.0, 0.0, 1.0) * seaBody * (1.0 - cover * 0.6) * (lake ? 0.0 : 1.0);
  float underHigh = cloud(q - vec2(0.0, 0.014), 0.011, 1.3, 0.5, 1.0)
    * band(px.y - 0.014 * h, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h) * mix(1.0, 0.5, uHasClouds);
  float shading = max(underHigh - high, 0.0) * 0.22 + lobeWash * 0.14;

  // The lake: faint moving strokes of water.
  float water = 0.0;
  if (lake) {
    // Water painted as thin ink lines that drift and break, as in ink-wash water.
    float streak = smoothstep(0.62, 0.9, noise(vec2(px.x * 0.005 - t * 0.09, px.y * 0.11 - t * 0.06)))
      * smoothstep(0.25, 0.75, noise(vec2(px.x * 0.012 + t * 0.04, px.y * 0.02)));
    water = streak * 0.13 + max(rings, 0.0) * 0.1;
  }

  float boat = inkAt(uBoat, uBoatRect, px);
  float keel = uBoatRect.y + uBoatRect.w * 0.92;
  if (px.y > keel) {
    vec2 m = vec2(px.x + sin(px.y * 0.8 + t * 0.8) * 1.5, keel - (px.y - keel));
    boat = max(boat, inkAt(uBoat, uBoatRect, m) * 0.28);
  }

  // Near cliffs and pines; the pine tops sway in a slow wind.
  vec2 nearAt = px + drift * 1.6;
  float above = clamp((uNearRect.y + uNearRect.w - px.y) / uNearRect.w, 0.0, 1.0);
  nearAt.x += (noise(vec2(t * 0.2, px.y * 0.004)) - 0.5) * 7.0 * above * above;
  float near = inkAt(uNear, uNearRect, nearAt);
  float lowMist = cloud(q, 0.022, 1.1, 0.5, 13.0) * band(px.y, uHorizon - 0.02 * h, size.y + 0.1 * h, 0.06 * h);
  near *= 1.0 - lowMist * 0.6;
  // The boat passes behind the cliffs rather than over them.
  near = 1.0 - (1.0 - near) * (1.0 - boat * (1.0 - smoothstep(0.15, 0.4, near)));

  // Paper texture, and ink soaking unevenly into its fibres.
  float paper = texture2D(uPaper, fract(px / vec2(1024.0, 683.0))).r - 0.5;
  peaks = clamp(peaks * (0.86 + paper * 0.55), 0.0, 1.0);
  near = clamp(near * (0.92 + paper * 0.3), 0.0, 1.0);

  // Paper and sky, with warm light around the sun that slowly breathes.
  float sunDist = length(px - uSun.xy);
  float breath = 0.5 + 0.5 * sin(t * 0.05);
  float glow = exp(-sunDist / (h * (0.35 + 0.15 * breath)));
  float sky = 1.0 - smoothstep(0.0, uHorizon, px.y) * 0.35;
  vec3 day = vec3(0.958, 0.944, 0.905) + paper * 0.05 + vec3(0.03, 0.018, -0.01) * glow;
  // A moonlit night, not a black one: a luminous blue-grey sky that brightens toward the moon.
  vec3 night = vec3(0.2, 0.21, 0.235) * sky + paper * 0.05 + vec3(0.16, 0.17, 0.19) * glow;
  vec3 color = mix(day, night, uDark);
  float rim = uSun.z * (1.0 + (fbm(vec2(atan(px.y - uSun.y, px.x - uSun.x) * 2.0, t * 0.02)) - 0.5) * 0.08);
  float disc = 1.0 - smoothstep(rim * 0.86, rim * 1.04, sunDist);
  float sunWash = 0.88 + 0.12 * fbm((px - uSun.xy) / uSun.z * 1.6);
  vec3 sunColor = mix(vec3(0.83, 0.42, 0.31), vec3(0.9, 0.9, 0.86), uDark);
  float halo = exp(-max(0.0, sunDist - uSun.z) / (uSun.z * 1.6)) * mix(0.1, 0.18, uDark);
  float open = 1.0 - peaks;
  color = mix(color, sunColor, (disc * sunWash * mix(0.72, 0.85, uDark) + halo) * open);
  if (lake) {
    float column = exp(-abs(px.x - uSun.x + sin(px.y * 0.7 + t * 0.6) * 3.0) / (uSun.z * 1.1));
    float shimmer = smoothstep(0.45, 0.8, noise(vec2(px.x * 0.05, px.y * 0.35 - t * 0.45)));
    float fall = 1.0 - smoothstep(0.0, 0.2, (px.y - uHorizon) / h);
    color = mix(color, sunColor, column * shimmer * fall * mix(0.35, 0.45, uDark));
  }

  // By day everything is dark ink on paper. At night the distant peaks are pale ink lit by the
  // moon, the clouds glow, and the near cliffs stand dark in front.
  float inked = 1.0 - (1.0 - max(peaks, shading)) * (1.0 - water);
  vec3 dayInk = vec3(0.11, 0.105, 0.1);
  vec3 dayColor = mix(color, dayInk, inked);
  // The washes under lumps belong to the day painting; at night they made a sooty rim.
  vec3 nightColor = (color * (1.0 - moonlit.a) + moonlit.rgb) * (1.0 - max(underHigh - high, 0.0) * 0.09);
  nightColor = mix(nightColor, vec3(0.4, 0.41, 0.44), water * 2.0);
  // Moonlit water, lifted toward the sky's tone so the bottom of the picture is not a black band.
  // The lift starts under the cloud's uneven lower edge; starting at the lake line drew a ruled line.
  nightColor += vec3(0.06, 0.063, 0.07) * smoothstep(edge - 0.02 * h, edge + 0.1 * h, px.y);
  color = mix(dayColor, nightColor, uDark);

  // Cranes fly in front of the peaks and behind the near cliffs; thin cloud can veil them.
  for (int i = 0; i < 3; i++) {
    vec4 bird = crane(uCraneRect[i], uCranePose[i], px);
    if (bird.a <= 0.001) continue;
    vec3 body = bird.rgb / bird.a;
    // Moonlit at night: white feathers stay pale, black ones stay dark.
    vec3 nightBody = mix(vec3(0.04), vec3(0.7, 0.71, 0.74), dot(body, vec3(0.3, 0.55, 0.15)));
    body = mix(body, nightBody, uDark);
    // Far away, so a touch of the sky's haze settles on them; they stay opaque.
    body = mix(body, mix(vec3(0.93, 0.92, 0.88), vec3(0.16, 0.165, 0.175), uDark), 0.18);
    color = mix(color, body, bird.a * (1.0 - high * 0.45));
  }

  vec3 nearInk = mix(dayInk, vec3(0.09, 0.095, 0.11), uDark);
  color = mix(color, nearInk, near * mix(1.0, 0.95, uDark));
  // A warm lantern on the boat at night.
  vec2 lantern = vec2(uBoatRect.x + uBoatRect.z * 0.62, uBoatRect.y + uBoatRect.w * 0.45);
  color += vec3(1.0, 0.72, 0.38) * exp(-length(px - lantern) / 4.0) * 0.4 * uDark;
  gl_FragColor = vec4(color, 1.0);
}
`;
