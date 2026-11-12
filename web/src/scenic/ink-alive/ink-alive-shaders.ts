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
 * peaks, tall peaks, flying cranes, near cliffs with pines, and a drifting boat. A sea of clouds
 * streams through the valleys and around the peaks, carried by a small fluid simulation, and lies
 * on a rippling lake that mirrors the scene and carries a path of light from the sun or moon.
 * The pines sway in the same breeze; the rest of the painting never moves. By day the ink is
 * washed with light colour; by moonlight it is ink alone.
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
// By day the ink is glazed with light ochre and blue (浅绛山水): the hue each layer's pale washes
// take. Distant ridges, rock, the peaks' tops, the pines, and the water.
const vec3 TINT_FAR = vec3(0.36, 0.47, 0.56);
const vec3 TINT_ROCK = vec3(0.6, 0.43, 0.27);
const vec3 TINT_TOP = vec3(0.38, 0.48, 0.5);
const vec3 TINT_PINE = vec3(0.3, 0.42, 0.36);
const vec3 WATER_TONE = vec3(0.68, 0.73, 0.74);


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

// Lays a wash of colour over ink as a painter glazes: the hue changes and the lightness stays, so
// the brushwork reads exactly as in the ink painting.
vec3 glaze(vec3 c, vec3 tint, float amount) {
  return mix(c, c * mix(vec3(1.0), tint / dot(tint, vec3(0.3, 0.59, 0.11)), 0.45), amount);
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

// The sea of clouds' lumps and gaps at p (0 a gap, 1 a lump), given where its top lies and the
// slow warp that shapes it. Lumps and wisps travel left with the breeze at a pace you can follow,
// the far ones (near the top) slower than the near ones; each layer moves as a whole, as a
// sheared pattern would smear into streaks over time.
float seaTexture(vec2 p, float topY, vec2 warp) {
  float h = paneSize().y;
  vec2 q = p / h;
  float t = uTime;
  // A finer warp frays every edge: plain value noise leaves lone lumps shaped like diamonds.
  vec2 fray = vec2(noise(q * 14.0 + t * 0.05), noise(q * 14.0 + vec2(7.1, 3.3) - t * 0.05)) - 0.5;
  float far2 = fbm(vec2((q.x + t * 0.009) * 5.0, q.y * 9.0) + warp * 0.8 + fray * 0.45 + 13.0);
  float near2 = fbm(vec2((q.x + t * 0.018) * 4.0, q.y * 7.5) + warp * 0.8 + fray * 0.45);
  // fbm stays near its middle; stretch it so lumps and gaps are clearly shaped.
  return clamp((mix(far2, near2, smoothstep(topY - 0.02 * h, topY + 0.14 * h, p.y)) - 0.5) * 2.4 + 0.5, 0.0, 1.0);
}

void main() {
  vec2 size = paneSize();
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float h = size.y;
  float t = uTime;
  // A slow camera breath; nearer layers move more.
  vec2 drift = vec2(sin(t * 0.014) * 0.008 * size.x, 0.0);
  bool lake = px.y > uHorizon;
  float depth = max(px.y - uHorizon, 0.0) / h;

  // The lake mirrors everything above it, so below the lake line the scene is drawn as seen in
  // the water: from sp, the mirrored point, moved by the ripples.
  vec2 sp = px;
  float rings = 0.0;
  float crest = 0.0;
  float strength = 0.0;
  float glimmer = 0.0;
  if (lake) {
    // Rings where a fish touched the water: they spread, bend the reflection and fade.
    for (int i = 0; i < 2; i++) {
      vec4 ring = uRing[i];
      float age = t - ring.z;
      if (age < 0.0 || age > 9.0) continue;
      vec2 d = (px - vec2(ring.x * size.x, uHorizon + ring.y * h)) * vec2(1.0, 3.2) / h;
      float r = length(d) - age * 0.022;
      rings += sin(r * 180.0) * exp(-r * r / 0.0006) * exp(-age * 0.45);
    }
    // A point on the water itself, so ripples keep their size on the water and crowd together
    // toward the far shore. The perspective is softened, or far ripples would shrink below a
    // pixel and flicker; along the far shore the water lies calm as a mirror.
    float persp = depth + 0.06;
    vec2 wp = vec2((px.x - size.x * 0.5) / h, 1.0) / persp;
    float calm = smoothstep(0.01, 0.07, depth);
    // Rows of small waves running toward you and drifting left with the breeze; their crests
    // waver, and they rise and settle in patches, so the rows break up as real ripples do.
    float swell = noise(vec2(wp.x * 0.7 + t * 0.04, wp.y * 0.6 + t * 0.05));
    // A second, slanting train crosses the first, so the rows never settle into an even pattern.
    float phase = wp.y * 9.0 + t * 0.9 + swell * 7.0;
    float phase2 = wp.y * 13.0 + wp.x * 2.5 + t * 1.2 + swell * 4.0;
    strength = smoothstep(0.25, 0.75, noise(vec2(wp.x * 1.6 + t * 0.06, wp.y * 0.9 - t * 0.04))) * calm;
    crest = sin(phase) * 0.65 + sin(phase2) * 0.35;
    // Each glint lives a second or two, lit and gone at different moments along a row.
    glimmer = smoothstep(0.35, 0.7, noise(vec2(wp.x * 2.5 + wp.y * 0.7, t * 0.6 + wp.y * 1.3)));
    // Each row tilts the mirror image up or down, breaking reflections into soft bands.
    float tilt = (cos(phase) * 0.65 + cos(phase2) * 0.35) * (0.4 + 0.6 * strength) * calm;
    sp = vec2(px.x + (swell - 0.5) * calm * (2.0 + depth * h * 0.08) + rings * 4.0,
      uHorizon - (px.y - uHorizon) * 1.1 + tilt * (2.0 + depth * h * 0.12) + rings * 2.0);
  }
  vec2 sq = sp / h;

  // Back to front, each layer covering what is behind it like ink washes on paper.
  vec3 moon = vec3(0.9, 0.92, 0.97);
  vec3 fog = vec3(0.36, 0.375, 0.4);
  vec4 moonlit = vec4(0.0);
  vec2 farS = layerInk(uFar, uFarNight, uFarRect, sp + drift * 0.25);
  float far = farS.x * 0.7;
  // At night the distant ridges sink toward the sky's tone, so distance reads as it does by day.
  over(moonlit, moon * (0.16 + farS.y * 0.3), smoothstep(0.02, 0.3, farS.x) * 0.7);
  float hazeFar = cloud(sq, 0.006, 1.1, 0.5, 3.0) * band(sp.y, uHorizon - 0.24 * h, uHorizon, 0.06 * h);
  far *= 1.0 - hazeFar * 0.8;
  veil(moonlit, fog, hazeFar * 0.55);
  vec2 midFarS = layerInk(uMidFar, uMidFarNight, uMidFarRect, sp + drift * 0.5);
  float midFar = midFarS.x * 0.75;
  over(moonlit, moon * (0.13 + midFarS.y * 0.5), smoothstep(0.02, 0.3, midFarS.x) * 0.85);
  float peaks = 1.0 - (1.0 - far) * (1.0 - midFar);
  float hazeMid = cloud(sq, 0.009, 1.25, 0.48, 9.0) * band(sp.y, uHorizon - 0.3 * h, uHorizon + 0.02 * h, 0.07 * h);
  peaks *= 1.0 - hazeMid * 0.85;
  veil(moonlit, fog, hazeMid * 0.6);
  vec2 midS = layerInk(uMid, uMidNight, uMidRect, sp + drift);
  float mid = midS.x;
  // The brightest moonlit touches, mostly on the pines' crowns, are held back: drawn large they
  // looked like snow.
  over(moonlit, moon * (midS.y - max(midS.y - 0.6, 0.0) * 0.5), smoothstep(0.02, 0.28, midS.x));
  peaks = 1.0 - (1.0 - peaks) * (1.0 - mid);
  // By day each layer's pale washes take its tint and its darkest strokes stay ink: the far
  // ridges washed blue, the rock warm, the peaks' tops cooler, as a painter lays colour over ink.
  float upper = smoothstep(uHorizon - 0.22 * h, uHorizon - 0.45 * h, sp.y);
  vec3 tint = mix(TINT_FAR, mix(TINT_ROCK, TINT_TOP, upper), clamp(mid * 2.0, 0.0, 1.0));

  // Clouds through the peaks: thin streams high up, and the sea of clouds at their feet.
  float high = cloud(sq, 0.011, 1.3, 0.5, 1.0) * band(sp.y, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h);
  high *= mix(1.0, 0.5, uHasClouds);
  // The sea of clouds has a body and a top. Its top rests higher in the open valley in the middle
  // than against the big masses at the sides, and lobes rise and sink along it. The fluid
  // simulation adds the banks streaming through the valleys and the slow swells. It thins out
  // before the water, so the lake shows below it. A painter leaves the cloud as paper and washes
  // a little grey under the top lobes; at night the moon lights the tops silver.
  float xr = sp.x / size.x;
  float valley = smoothstep(0.08, 0.38, xr) * (1.0 - smoothstep(0.62, 0.92, xr));
  float lobes = fbm(vec2(sq.x * 1.4 + t * 0.012, t * 0.015)) - 0.5;
  float topY = uHorizon - h * (0.13 + 0.07 * valley + lobes * 0.12);
  vec2 warp = vec2(fbm(sq * 1.5 + vec2(t * 0.01, -t * 0.008)), fbm(sq * 1.5 + vec2(5.2, 1.3) - t * 0.009)) - 0.5;
  float n = seaTexture(sp, topY, warp);
  float below = (sp.y - topY) / h;
  // Inside, the sea is solid; its top breaks into lumps and wisps that travel and change.
  float seaBody = smoothstep(-0.05, 0.06, below + (n - 0.5) * 0.15);
  // It lies on the water, with a soft, uneven lower edge that dips and lifts along the shore. Its
  // waviness is measured across the pane's width, so a narrow phone pane gets as much as a wide one.
  float edge = uHorizon + h * (0.045 + (fbm(vec2(xr * 5.0 + t * 0.015, 3.7)) - 0.5) * 0.04 + (n - 0.5) * 0.02);
  seaBody *= 1.0 - smoothstep(edge - 0.03 * h, edge + 0.01 * h, sp.y);
  float sim = texture2D(uClouds, vec2(sp.x, size.y - sp.y) * uScale / uRes).r * uHasClouds
    * (1.0 - smoothstep(uHorizon - 0.02 * h, uHorizon + 0.02 * h, sp.y))
    // The banks it carries cling to the peaks just above the sea, not up in the open sky.
    * smoothstep(topY - 0.14 * h, topY - 0.02 * h, sp.y);
  float density = seaBody * (0.5 + 0.75 * n) + sim * (0.3 + 0.7 * n);
  float cover = smoothstep(0.2, 0.9, density) * uHasClouds;
  // The lumpy tops are the most solid part. Lower down the cloud is thin enough by day and night
  // to show the peaks behind it faintly, as mist does.
  float tops = 1.0 - smoothstep(0.02, 0.18, below);
  peaks *= 1.0 - max(high * 0.85, cover * mix(0.38 + 0.42 * n, 0.92, tops));
  float lit = 0.45 + tops * 0.35 + n * 0.2;
  // A thin moonlit mist hangs around the sea's top, so the gaps between lumps read as mist over
  // rock rather than dark holes in the cloud.
  veil(moonlit, mix(fog * 1.35, moon * 0.62, 0.5), exp(-below * below / 0.02) * 0.8 * uHasClouds);
  // Gaps inside the body stay veiled, and where it meets the water it stays whole: at night,
  // rock seen through a gap, or its reflection, reads as a bruise in the cloud.
  float shoreline = smoothstep(uHorizon - 0.07 * h, uHorizon - 0.01 * h, sp.y);
  // A lone puff floating clear of the sea is faded: by moonlight it stood out as a bright blob.
  float afloat = 1.0 - 0.75 * (1.0 - smoothstep(-0.08, 0.0, below));
  float nightCover = max(cover * mix(0.62 + 0.22 * n, 0.88, tops) * afloat, seaBody * mix(0.65, 0.85, shoreline) * uHasClouds);
  veil(moonlit, mix(fog * 1.2, moon * 0.82, lit), max(high * 0.6, nightCover));
  // A painter's wash in the shadow under each lump: where there is more cloud just above than
  // here, as under an overhang.
  float nAbove = seaTexture(sp - vec2(0.0, 0.025 * h), topY, warp);
  float lobeWash = clamp((nAbove - n) * 2.0, 0.0, 1.0) * seaBody * (1.0 - cover * 0.6);
  float underHigh = cloud(sq - vec2(0.0, 0.014), 0.011, 1.3, 0.5, 1.0)
    * band(sp.y - 0.014 * h, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h) * mix(1.0, 0.5, uHasClouds);
  float shading = max(underHigh - high, 0.0) * 0.22 + lobeWash * 0.14;

  float boat = inkAt(uBoat, uBoatRect, px);
  float keel = uBoatRect.y + uBoatRect.w * 0.92;
  if (px.y > keel) {
    vec2 m = vec2(px.x + sin(px.y * 0.8 + t * 0.8) * 1.5, keel - (px.y - keel));
    boat = max(boat, inkAt(uBoat, uBoatRect, m) * 0.28);
  }

  // Near cliffs and pines. Where things stand is this painting's own geometry, in its uv: a
  // cliff at each side with pines on top, and mist at their feet.
  vec2 nearAt = px + drift * 1.6;
  vec2 nuv = (nearAt - uNearRect.xy) / uNearRect.zw;
  // The pines sway in the breeze that carries the clouds left: they lean a little with each gust
  // and their needles stir, more toward the crowns, while trunks and rock stay rooted. Gusts
  // reach the right-hand pine a moment before the left one.
  float pine = nuv.x < 0.5 ? 1.0 - smoothstep(0.06, 0.33, nuv.y) : 1.0 - smoothstep(0.34, 0.52, nuv.y);
  float gust = noise(vec2(t * 0.35 + nuv.x * 1.5, 7.3));
  float bob = sin(t * 0.9 + nuv.x * 3.0 + nuv.y * 4.0) * (0.3 + gust);
  float stir = noise(vec2(px.x * 0.04 + t * 0.9, px.y * 0.05)) - 0.5;
  nearAt.x += ((0.3 + gust) * 0.006 + bob * 0.0015 + stir * 0.002) * uNearRect.z * pine * pine;
  float near = inkAt(uNear, uNearRect, nearAt);
  // The moon catches the upper edges of the cliffs and the pines' needles at night, so their
  // silhouettes, and the pines' sway, show against the dark peaks behind them.
  // Only on the side facing the moon, upper right, and faintly: a full rim made the pines look snowy.
  float nearRim = clamp(near - inkAt(uNear, uNearRect, nearAt + vec2(1.5, -1.5)), 0.0, 1.0);
  float lowMist = cloud(sq, 0.022, 1.1, 0.5, 13.0) * band(px.y, uHorizon - 0.02 * h, size.y + 0.1 * h, 0.06 * h);
  // By day the low mist thins the cliffs' ink. At night it veils them in pale mist instead, since
  // thinning dark rock left dark scalloped lumps that read as smoke.
  near *= 1.0 - lowMist * 0.6 * (1.0 - uDark);
  // The boat passes behind the cliffs rather than over them.
  near = 1.0 - (1.0 - near) * (1.0 - boat * (1.0 - smoothstep(0.15, 0.4, near)));
  // Where the cliffs and the mist at their feet stand in front of the lake, no water shows.
  // Its edge wavers like mist, and the mist thins toward the far shore of the water.
  float waver = (noise(vec2(nuv.y * 9.0, 2.0)) - 0.5) * 0.03 + (noise(vec2(nuv.y * 23.0 + t * 0.05, 5.0)) - 0.5) * 0.012;
  float leftShore = 0.215 + 0.03 * smoothstep(0.6, 0.78, nuv.y) + waver;
  float rightShore = 0.9 - 0.045 * smoothstep(0.5, 0.95, nuv.y) - waver;
  float shore = max(1.0 - smoothstep(leftShore - 0.025, leftShore + 0.015, nuv.x), smoothstep(rightShore - 0.015, rightShore + 0.025, nuv.x))
    * smoothstep(uHorizon - 0.02 * h, uHorizon + 0.1 * h, px.y);

  // Paper texture, and ink soaking unevenly into its fibres.
  float paper = texture2D(uPaper, fract(px / vec2(1024.0, 683.0))).r - 0.5;
  peaks = clamp(peaks * (0.86 + paper * 0.55), 0.0, 1.0);
  near = clamp(near * (0.92 + paper * 0.3), 0.0, 1.0);

  // Paper and sky, with warm light around the sun that slowly breathes.
  float sunDist = length(sp - uSun.xy);
  float breath = 0.5 + 0.5 * sin(t * 0.05);
  float glow = exp(-sunDist / (h * (0.35 + 0.15 * breath)));
  float sky = 1.0 - smoothstep(0.0, uHorizon, sp.y) * 0.35;
  vec3 day = vec3(0.958, 0.944, 0.905) + paper * 0.05;
  // A moonlit night, not a black one: a luminous blue-grey sky that brightens toward the moon.
  vec3 night = vec3(0.2, 0.21, 0.235) * sky + paper * 0.05;
  vec3 color = mix(day, night, uDark) + mix(vec3(0.03, 0.018, -0.01), vec3(0.16, 0.17, 0.19), uDark) * glow;
  float rim = uSun.z * (1.0 + (fbm(vec2(atan(sp.y - uSun.y, sp.x - uSun.x) * 2.0, t * 0.02)) - 0.5) * 0.08);
  float disc = 1.0 - smoothstep(rim * 0.86, rim * 1.04, sunDist);
  float sunWash = 0.88 + 0.12 * fbm((sp - uSun.xy) / uSun.z * 1.6);
  vec3 sunColor = mix(vec3(0.83, 0.42, 0.31), vec3(0.9, 0.9, 0.86), uDark);
  float halo = exp(-max(0.0, sunDist - uSun.z) / (uSun.z * 1.6)) * mix(0.1, 0.18, uDark);
  // The sun or moon stands behind every rock, even pale painted rock.
  float clear = (1.0 - smoothstep(0.03, 0.2, peaks)) * (1.0 - smoothstep(0.03, 0.2, near));
  color = mix(color, sunColor, (disc * sunWash * mix(0.72, 0.85, uDark) + halo) * clear);

  // By day everything is dark ink on paper. At night the distant peaks are pale ink lit by the
  // moon, the clouds glow, and the near cliffs stand dark in front.
  vec3 dayInk = vec3(0.11, 0.105, 0.1);
  // Colour is a day painting: by moonlight it read as floodlit stone, so night stays ink.
  float daylight = 1.0 - uDark;
  vec3 dayColor = mix(glaze(mix(color, dayInk, peaks), tint, daylight * smoothstep(0.03, 0.3, peaks) * (1.0 - smoothstep(0.45, 0.85, peaks))), dayInk, shading);
  // The washes under lumps belong to the day painting; at night they made a sooty rim.
  vec3 nightColor = (color * (1.0 - moonlit.a) + moonlit.rgb) * (1.0 - max(underHigh - high, 0.0) * 0.09);

  // The water: it reflects more of the scene toward the far shore and shows more of itself, a
  // light ink wash, toward you. Ripples facing the sky catch its light in fine lines that break
  // the reflections, and their shaded sides read as faint ink strokes.
  if (lake) {
    float toward = smoothstep(0.0, 0.12, depth);
    // At the cliffs' misty feet the mist hides the ripples.
    float open = 1.0 - shore;
    float reflectance = mix(1.0, 0.35, toward);
    float wash = fbm(vec2(px.x / h * 1.6 - t * 0.008, depth * 12.0)) - 0.5;
    dayColor = mix(WATER_TONE + wash * 0.07, dayColor, reflectance);
    nightColor = mix(vec3(0.17, 0.18, 0.205) + wash * 0.04, nightColor, reflectance);
    float facing = (smoothstep(0.8, 0.95, crest) * strength * glimmer + max(rings, 0.0) * 0.6) * open;
    float shaded = smoothstep(0.8, 0.95, -crest) * strength * toward * open;
    dayColor = mix(dayColor, vec3(0.975, 0.965, 0.935), facing * 0.6);
    dayColor = mix(dayColor, dayInk, shaded * 0.1);
    nightColor = mix(nightColor, vec3(0.5, 0.52, 0.57), facing * 0.35);
    nightColor *= 1.0 - shaded * 0.15;
    // The sun or moon is not mirrored whole: it is high above, so the lake shows it as a path
    // of light toward you, glinting on every wave facing it and widening as it nears.
    float path = exp(-pow((px.x - uSun.x) / (uSun.z * (1.0 + depth * 16.0)), 2.0)) * open;
    float sparkle = smoothstep(0.2, 0.95, crest) * (0.3 + 0.7 * strength) * (0.25 + 0.75 * glimmer);
    float light = path * (0.2 + 0.8 * sparkle) * smoothstep(-0.005, 0.02, depth);
    // By day it glints white on the water; a red path read as streaks.
    dayColor = mix(dayColor, vec3(1.0, 0.985, 0.95), light * 0.7);
    nightColor = mix(nightColor, moon * 0.95, light * 0.6);
  }
  // Mist lying on the water along the far shore, joining the sea of clouds to its reflection.
  float lying = exp(-pow(((px.y - uHorizon) / h - 0.004) / 0.02, 2.0))
    * (0.55 + 0.45 * fbm(vec2(px.x / h * 3.0 + t * 0.02, px.y / h * 20.0)));
  vec3 dayMist = day;
  vec3 nightMist = vec3(0.32, 0.33, 0.365) + paper * 0.04;
  dayColor = mix(dayColor, dayMist, max(lying * 0.6, shore * 0.85));
  // At night the mist on the water can only lighten it; a mist darker than the cloud above drew
  // a dark rule along the shore.
  nightColor = mix(nightColor, max(nightColor, vec3(0.55, 0.57, 0.62) + paper * 0.04), lying * 0.75);
  nightColor = mix(nightColor, nightMist, shore * 0.3);
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
  color = mix(color, moon * 0.45, nearRim * 0.25 * uDark);
  color = mix(color, max(color, vec3(0.42, 0.44, 0.48)), lowMist * 0.5 * smoothstep(0.1, 0.4, near) * uDark);
  // By day the cliffs' pale washes are warm and the pines' needles a muted green.
  vec3 nearTint = mix(TINT_ROCK, TINT_PINE, smoothstep(0.2, 0.6, pine));
  color = glaze(color, nearTint, daylight * smoothstep(0.05, 0.3, near) * (1.0 - smoothstep(0.45, 0.85, near)));
  // A warm lantern on the boat at night.
  vec2 lantern = vec2(uBoatRect.x + uBoatRect.z * 0.62, uBoatRect.y + uBoatRect.w * 0.45);
  color += vec3(1.0, 0.72, 0.38) * exp(-length(px - lantern) / 4.0) * 0.4 * uDark;
  gl_FragColor = vec4(color, 1.0);
}
`;
