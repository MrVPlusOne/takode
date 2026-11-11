/**
 * GLSL for the living Ink & Paper scene. The whole scene is one fragment shader over a few
 * painted layers, so a frame costs one full-pane pass on the GPU and almost nothing on the CPU.
 * Coordinates are pane pixels with the origin at the top left (`px`), or pane pixels divided by
 * the pane height (`q`) where sizes should follow the pane's height.
 *
 * Everything that moves follows `uTime`, the director's scene clock (which slows while you work),
 * plus the cranes, ink drops and fish rings the director places.
 */

export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/**
 * Painted layers, back to front: paper and sky with the sun or moon, ink clouds blooming in the
 * sky, distant ridges, pale far peaks, tall peaks, a lake mirroring them with a drifting boat,
 * flying cranes, near cliffs with pines. Clouds flow between the layers, the ink of the peaks
 * slowly flows and gathers back as if the paper were wet, and the light breathes around the sun.
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
uniform vec4 uBloom[2];     // ink drops: x, y (pane fractions), start (scene time), seed
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

// The flow of the ink itself, in the spirit of paint flowing in water: a field warped twice, which
// evolves slowly and never resets, so shapes drawn through it melt, stream and curl continuously.
// Returns the warp vector (centred on zero) in .xy and the warped field's value in .z.
vec3 inkFlow(vec2 q, float t) {
  vec2 p = q * vec2(1.8, 3.2) + vec2(-t * 0.016, 0.0);
  vec2 a = vec2(fbm(p + vec2(0.0, t * 0.021)), fbm(p + vec2(5.2, -t * 0.018)));
  vec2 b = vec2(fbm(p + 2.6 * a + vec2(1.7, 9.2) + t * 0.012), fbm(p + 2.6 * a + vec2(8.3, 2.8) - t * 0.01));
  return vec3(b - 0.5, fbm(p + 2.6 * b));
}

float lightAt(sampler2D tex, vec4 rect, vec2 px) {
  vec2 uv = (px - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture2D(tex, uv).r;
}

// A layer's ink density by day (x) and its moonlit brightness at night (y), sampled through the
// ink's flow so the brushwork itself moves.
vec2 flowingInk(sampler2D day, sampler2D night, vec4 rect, vec2 px, vec2 offset) {
  vec2 at = px - offset;
  return vec2(inkAt(day, rect, at), lightAt(night, rect, at));
}

// Paints a moonlit layer over the night scene so far (premultiplied colour and coverage):
// a peak covers what is behind it with its own pale brushwork.
void over(inout vec4 scene, vec3 color, float cover) {
  scene = vec4(color * cover + scene.rgb * (1.0 - cover), cover + scene.a * (1.0 - cover));
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

  // The ink's flow: gentle on the peaks' upper slopes, strong where their feet dissolve into the
  // sea of clouds, so the washes there melt and stream away like paint in water.
  vec3 ink = inkFlow(q, t);
  float feet = band(px.y, uHorizon - 0.3 * h, uHorizon + 0.04 * h, 0.08 * h);
  vec2 inkOffset = ink.xy * h * mix(0.012, 0.06, feet);

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
    float swell = sin(px.y * 0.45 - t * 1.4 + noise(vec2(px.x * 0.01, px.y * 0.05)) * 4.0);
    float wobble = swell * (2.0 + depth * 60.0)
      + (noise(vec2(px.x * 0.02 + t * 0.05, px.y * 0.25 - t * 0.6)) - 0.5) * (6.0 + depth * 40.0);
    at = vec2(px.x + wobble + rings * 4.0, uHorizon - (px.y - uHorizon) * 1.15 + rings * 2.0);
    mirror = 0.42 * (1.0 - smoothstep(0.0, 0.24, depth));
  }

  // Back to front, each layer covering what is behind it like ink washes on paper.
  vec3 moon = vec3(0.9, 0.92, 0.97);
  vec3 fog = vec3(0.26, 0.27, 0.29);
  vec4 moonlit = vec4(0.0);
  vec2 farS = flowingInk(uFar, uFarNight, uFarRect, at + drift * 0.25, inkOffset * 0.5);
  float far = farS.x * 0.7;
  over(moonlit, moon * farS.y * 0.5, smoothstep(0.02, 0.3, farS.x) * 0.85);
  float hazeFar = cloud(q, 0.006, 1.1, 0.5, 3.0) * band(at.y, uHorizon - 0.24 * h, uHorizon, 0.06 * h);
  far *= 1.0 - hazeFar * 0.8;
  over(moonlit, fog, hazeFar * 0.55);
  vec2 midFarS = flowingInk(uMidFar, uMidFarNight, uMidFarRect, at + drift * 0.5, inkOffset * 0.75);
  float midFar = midFarS.x * 0.75;
  over(moonlit, moon * midFarS.y * 0.76, smoothstep(0.02, 0.3, midFarS.x) * 0.9);
  float peaks = 1.0 - (1.0 - far) * (1.0 - midFar);
  float hazeMid = cloud(q, 0.009, 1.25, 0.48, 9.0) * band(at.y, uHorizon - 0.3 * h, uHorizon + 0.02 * h, 0.07 * h);
  peaks *= 1.0 - hazeMid * 0.85;
  over(moonlit, fog, hazeMid * 0.6);
  vec2 midS = flowingInk(uMid, uMidNight, uMidRect, at + drift, inkOffset);
  float mid = midS.x;
  over(moonlit, moon * midS.y, smoothstep(0.02, 0.28, midS.x));
  peaks = 1.0 - (1.0 - peaks) * (1.0 - mid);
  peaks *= mirror;
  moonlit *= mirror;

  // Clouds through the peaks: thin streams high up and a thick sea of clouds at their feet.
  float high = cloud(q, 0.011, 1.3, 0.5, 1.0) * band(px.y, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h);
  float sea = cloud(q, 0.015, 1.0, 0.42, 7.0) * band(px.y, uHorizon - 0.2 * h, uHorizon + 0.05 * h, 0.07 * h);
  float mist = max(high * 0.85, sea * 0.92);
  peaks *= 1.0 - mist;
  over(moonlit, fog * 1.25, mist * 0.75);
  // Clouds are painted by leaving paper and washing grey under their lower edges.
  float under = cloud(q - vec2(0.0, 0.018), 0.015, 1.0, 0.42, 7.0)
    * band(px.y - 0.018 * h, uHorizon - 0.2 * h, uHorizon + 0.05 * h, 0.07 * h);
  float underHigh = cloud(q - vec2(0.0, 0.014), 0.011, 1.3, 0.5, 1.0)
    * band(px.y - 0.014 * h, uHorizon - 0.5 * h, uHorizon - 0.26 * h, 0.08 * h);
  float shading = max(under - sea, 0.0) * 0.3 + max(underHigh - high, 0.0) * 0.22;

  // Ink currents: thin marbled streams of grey ink carried through the sea of clouds, fed by the
  // peaks' washes upstream, as if the painting's ink were slowly flowing away in water.
  float upstream = inkAt(uMid, uMidRect, px + vec2(0.05 * h, 0.0) - inkOffset * 2.0)
    + inkAt(uMidFar, uMidFarRect, px + vec2(0.08 * h, 0.0) - inkOffset * 1.5) * 0.6;
  // Broad, soft streams rather than thin lines: wet ink spreads, it does not scratch.
  float filaments = pow(1.0 - abs(sin(ink.z * 9.0 + ink.x * 5.0)), 3.0) * smoothstep(0.3, 0.6, ink.z);
  float wash = smoothstep(0.52, 0.78, ink.z);
  float currents = (filaments * 0.55 + wash * 0.5) * feet * (0.35 + 0.65 * clamp(upstream, 0.0, 1.0));
  currents *= (1.0 - sea * 0.5) * 0.32;

  // Ink drops blooming in the sky: each curls into an ink-wash cloud, drifts with the wind and
  // thins away. They stay in the upper sky and fade near the sun.
  float blooms = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 drop = uBloom[i];
    float age = t - drop.z;
    float k = drop.w;
    vec2 center = vec2(drop.x * size.x - age * 0.0035 * h, drop.y * h);
    if (age < 0.0 || age > 42.0 || length(px - center) > 0.26 * h) continue;
    vec2 p = (px - center) / h / (0.009 + 0.0028 * age);
    p.y += age * 0.008;
    for (int j = 0; j < 3; j++) {
      p += (vec2(fbm(p * 1.2 + k + age * 0.024), fbm(p * 1.2 + k + 3.1 - age * 0.024)) - 0.5) * 0.9;
    }
    float smoke = exp(-dot(p, p) * 0.12) * smoothstep(0.38, 0.8, fbm(p * 1.4 + k));
    float fade = smoothstep(0.0, 5.0, age) * (1.0 - smoothstep(16.0, 42.0, age));
    blooms = max(blooms, smoke * fade * 0.28);
  }
  blooms *= smoothstep(uSun.z * 1.5, uSun.z * 4.0, length(px - uSun.xy));

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
  near = 1.0 - (1.0 - near) * (1.0 - boat);

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
  vec3 night = vec3(0.13, 0.132, 0.138) * sky + paper * 0.045 + vec3(0.11, 0.115, 0.125) * glow;
  vec3 color = mix(day, night, uDark);
  float rim = uSun.z * (1.0 + (fbm(vec2(atan(px.y - uSun.y, px.x - uSun.x) * 2.0, t * 0.02)) - 0.5) * 0.08);
  float disc = 1.0 - smoothstep(rim * 0.86, rim * 1.04, sunDist);
  float sunWash = 0.88 + 0.12 * fbm((px - uSun.xy) / uSun.z * 1.6);
  vec3 sunColor = mix(vec3(0.83, 0.42, 0.31), vec3(0.9, 0.9, 0.86), uDark);
  float halo = exp(-max(0.0, sunDist - uSun.z) / (uSun.z * 1.6)) * mix(0.1, 0.18, uDark);
  float open = (1.0 - peaks) * (1.0 - blooms);
  color = mix(color, sunColor, (disc * sunWash * mix(0.72, 0.85, uDark) + halo) * open);
  if (lake) {
    float column = exp(-abs(px.x - uSun.x + sin(px.y * 0.7 + t * 0.6) * 3.0) / (uSun.z * 1.1));
    float shimmer = smoothstep(0.45, 0.8, noise(vec2(px.x * 0.05, px.y * 0.35 - t * 0.45)));
    float fall = 1.0 - smoothstep(0.0, 0.2, (px.y - uHorizon) / h);
    color = mix(color, sunColor, column * shimmer * fall * mix(0.35, 0.45, uDark));
  }

  // By day everything is dark ink on paper. At night the distant peaks are pale ink lit by the
  // moon, the clouds glow, and the near cliffs stand dark in front.
  float inked = 1.0 - (1.0 - max(peaks, shading)) * (1.0 - blooms) * (1.0 - water) * (1.0 - currents);
  vec3 dayInk = vec3(0.11, 0.105, 0.1);
  vec3 dayColor = mix(color, dayInk, inked);
  vec3 nightColor = color * (1.0 - moonlit.a) + moonlit.rgb;
  nightColor = mix(nightColor, vec3(0.3, 0.31, 0.33), water * 2.0);
  // At night the ink clouds are moonlit smoke.
  nightColor = mix(nightColor, vec3(0.36, 0.37, 0.4), blooms * 0.85);
  // The ink currents glow faintly in the moonlit fog.
  nightColor = mix(nightColor, vec3(0.42, 0.43, 0.46), currents * 1.2);
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

  vec3 nearInk = mix(dayInk, vec3(0.03, 0.03, 0.033), uDark);
  color = mix(color, nearInk, near * mix(1.0, 0.95, uDark));
  // A warm lantern on the boat at night.
  vec2 lantern = vec2(uBoatRect.x + uBoatRect.z * 0.62, uBoatRect.y + uBoatRect.w * 0.45);
  color += vec3(1.0, 0.72, 0.38) * exp(-length(px - lantern) / 4.0) * 0.4 * uDark;
  gl_FragColor = vec4(color, 1.0);
}
`;
