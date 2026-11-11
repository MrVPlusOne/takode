/**
 * A small 2D fluid simulation that carries the living Ink & Paper's sea of clouds: banks of cloud
 * enter at one side and are carried through the valleys by slowly moving air, curling around and
 * thinning away. The painting itself stays still.
 *
 * It is the classic GPU "stable fluids" scheme (semi-Lagrangian advection, vorticity confinement
 * and a Jacobi pressure projection) with two resolutions, as in most WebGL fluid demos: the flow
 * lives on a coarse grid, because air moves smoothly and the pressure solve scales with cells,
 * while the cloud lives on a finer grid that keeps its edges. Cloud diffuses a little on its own
 * and fades, so the sky never fills up.
 *
 * Needs WebGL 2 with renderable half-float textures; `createCloudFluid` returns null otherwise and
 * the scene runs without moving clouds.
 */

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 uTexel;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const HEAD = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
`;

// Carries a field along the flow: each cell looks back along the velocity and takes what was there.
const ADVECT = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelocityTexel;
uniform float uDt;
uniform float uKeep;
// The band (fractions of the pane height from the top) where the field lasts; outside it, it
// keeps only uOutside a step. Cloud above the valleys meets drier air and evaporates, which is
// what keeps a real sea of clouds lying in the valleys under the peaks.
uniform vec2 uLayer;
uniform float uOutside;
uniform float uPhase;
void main() {
  vec2 back = vUv - uDt * texture2D(uVelocity, vUv).xy * uVelocityTexel;
  float y = 1.0 - vUv.y;
  // The top of the layer rolls gently and slowly, so the sea of clouds has no ruled edge.
  float top = uLayer.x + 0.035 * sin(vUv.x * 7.0 + uPhase) + 0.02 * sin(vUv.x * 17.0 - uPhase * 1.7);
  float outside = 1.0 - smoothstep(top - 0.1, top + 0.1, y) * (1.0 - smoothstep(uLayer.y - 0.03, uLayer.y + 0.03, y));
  gl_FragColor = uKeep * mix(1.0, uOutside, outside) * texture2D(uSource, back);
}
`;

// Cloud spreading a little into the air around it.
const DIFFUSE = `${HEAD}
uniform sampler2D uSource;
uniform float uRate;
void main() {
  vec4 c = texture2D(uSource, vUv);
  vec4 around = (texture2D(uSource, vL) + texture2D(uSource, vR) + texture2D(uSource, vT) + texture2D(uSource, vB)) * 0.25;
  gl_FragColor = mix(c, around, uRate);
}
`;

const CURL = `${HEAD}
uniform sampler2D uVelocity;
void main() {
  float l = texture2D(uVelocity, vL).y;
  float r = texture2D(uVelocity, vR).y;
  float t = texture2D(uVelocity, vT).x;
  float b = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}
`;

// Gives back the small swirls that the coarse grid smooths away, so the clouds keep curling.
const VORTICITY = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uStrength;
uniform float uDt;
void main() {
  float l = texture2D(uCurl, vL).x;
  float r = texture2D(uCurl, vR).x;
  float t = texture2D(uCurl, vT).x;
  float b = texture2D(uCurl, vB).x;
  float c = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  force /= length(force) + 0.0001;
  force *= uStrength * c * vec2(1.0, -1.0);
  vec2 v = texture2D(uVelocity, vUv).xy + force * uDt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}
`;

const DIVERGENCE = `${HEAD}
uniform sampler2D uVelocity;
void main() {
  float l = texture2D(uVelocity, vL).x;
  float r = texture2D(uVelocity, vR).x;
  float t = texture2D(uVelocity, vT).y;
  float b = texture2D(uVelocity, vB).y;
  vec2 c = texture2D(uVelocity, vUv).xy;
  // The sky and the lake are walls the air turns along; the sides stay open, so the breeze blows
  // through instead of piling the clouds up against the far side.
  if (vT.y > 1.0) t = -c.y;
  if (vB.y < 0.0) b = -c.y;
  gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}
`;

const PRESSURE = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float l = texture2D(uPressure, vL).x;
  float r = texture2D(uPressure, vR).x;
  float t = texture2D(uPressure, vT).x;
  float b = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

const SUBTRACT = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float l = texture2D(uPressure, vL).x;
  float r = texture2D(uPressure, vR).x;
  float t = texture2D(uPressure, vT).x;
  float b = texture2D(uPressure, vB).x;
  vec2 v = texture2D(uVelocity, vUv).xy - vec2(r - l, t - b);
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

const SCALE = `${HEAD}
uniform sampler2D uSource;
uniform float uKeep;
void main() {
  gl_FragColor = uKeep * texture2D(uSource, vUv);
}
`;

// Adds a soft round amount of something (cloud, or a push of the air) around a point.
const SPLAT = `${HEAD}
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 d = vUv - uPoint;
  d.x *= uAspect;
  vec3 add = uValue * exp(-dot(d, d) / uRadius);
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + add, 1.0);
}
`;

// A gentle, slowly changing current over the whole pane: a breeze plus meandering eddies.
const CURRENT = `${HEAD}
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uDt;
uniform vec2 uWind;
uniform float uEddies;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 p = vUv * vec2(3.0, 2.0) + vec2(uTime * 0.02, -uTime * 0.013);
  float e = 0.05;
  float n = noise(p);
  vec2 swirl = vec2(noise(p + vec2(0.0, e)) - n, -(noise(p + vec2(e, 0.0)) - n)) / e;
  vec2 v = texture2D(uVelocity, vUv).xy + (uWind + swirl * uEddies) * uDt;
  gl_FragColor = vec4(v, 0.0, 1.0);
}
`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface PingPong {
  read: Target;
  write: Target;
  swap: () => void;
}

export interface CloudSplat {
  /** Position in the pane, 0..1 from the left and from the top. */
  x: number;
  y: number;
  /** Cloud added at the centre. */
  amount: number;
  /** Radius as a fraction of the pane height. */
  radius: number;
  /** A push of the air, in flow-grid cells a second (x right, y down the pane). */
  push: [number, number];
}

/** How the air moves and how long the cloud it carries lasts. */
export interface FluidWeather {
  /** Steady push of the air, flow-grid cells a second per second (x right, y up). */
  wind: [number, number];
  /** Strength of the slowly meandering eddies. */
  eddies: number;
  /** Seconds for cloud to fade to about a third. */
  fade: number;
}

export interface CloudFluid {
  /**
   * Advances by `dt` seconds of scene time after adding `splats`. Cloud lasts within `layer` (its
   * top and bottom as fractions of the pane height from the top) and evaporates outside it.
   */
  step: (dt: number, time: number, splats: CloudSplat[], weather: FluidWeather, layer: [number, number]) => void;
  /** Sizes the grids for a pane; call when the pane changes shape. */
  resize: (width: number, height: number) => void;
  /** Binds the cloud field (density in red) to a texture unit for the scene shader. */
  bindClouds: (unit: number) => void;
  dispose: () => void;
}

const FLOW_CELLS = 112;
const CLOUD_CELLS = 448;
const PRESSURE_ITERATIONS = 18;

export function createCloudFluid(gl: WebGL2RenderingContext): CloudFluid | null {
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) return null;
  const programs = {
    advect: program(gl, ADVECT),
    diffuse: program(gl, DIFFUSE),
    curl: program(gl, CURL),
    vorticity: program(gl, VORTICITY),
    divergence: program(gl, DIVERGENCE),
    pressure: program(gl, PRESSURE),
    subtract: program(gl, SUBTRACT),
    scale: program(gl, SCALE),
    splat: program(gl, SPLAT),
    current: program(gl, CURRENT),
  };
  if (Object.values(programs).some((p) => !p)) return null;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  let aspect = 1;
  let velocity: PingPong | null = null;
  let pressure: PingPong | null = null;
  let cloud: PingPong | null = null;
  let divergence: Target | null = null;
  let curl: Target | null = null;
  const all: Target[] = [];

  const target = (width: number, height: number, format: number, internal: number): Target => {
    const texture = gl.createTexture()!;
    // Its own unit: binding on whatever unit happens to be active would replace one of the
    // scene's textures (it once replaced the noise, flattening every drawn cloud and ripple).
    gl.activeTexture(gl.TEXTURE0 + 15);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const made = { texture, framebuffer, width, height };
    all.push(made);
    return made;
  };
  const pingPong = (width: number, height: number, format: number, internal: number): PingPong => {
    const pair = { read: target(width, height, format, internal), write: target(width, height, format, internal) };
    return {
      get read() {
        return pair.read;
      },
      get write() {
        return pair.write;
      },
      swap() {
        [pair.read, pair.write] = [pair.write, pair.read];
      },
    } as PingPong;
  };

  const release = () => {
    for (const t of all.splice(0)) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
  };

  const resize = (width: number, height: number) => {
    aspect = Math.max(0.2, width / Math.max(1, height));
    const old = all.splice(0);
    const before = { velocity: velocity?.read, cloud: cloud?.read };
    const size = (cells: number) =>
      aspect >= 1 ? [cells, Math.max(8, Math.round(cells / aspect))] : [Math.max(8, Math.round(cells * aspect)), cells];
    const [fw, fh] = size(FLOW_CELLS) as [number, number];
    const [iw, ih] = size(CLOUD_CELLS) as [number, number];
    velocity = pingPong(fw, fh, gl.RG, gl.RG16F);
    pressure = pingPong(fw, fh, gl.RED, gl.R16F);
    divergence = target(fw, fh, gl.RED, gl.R16F);
    curl = target(fw, fh, gl.RED, gl.R16F);
    cloud = pingPong(iw, ih, gl.RED, gl.R16F);
    // Keep the sky as it was, stretched to the new shape, so resizing the window or opening a side
    // column does not wipe the clouds away.
    const carry = (from: Target | undefined, to: Target) => {
      if (!from) return;
      run(programs.scale!, to, to, (u) => {
        gl.uniform1i(u("uSource"), bind(13, from));
        gl.uniform1f(u("uKeep"), 1);
      });
    };
    carry(before.velocity, velocity.read);
    carry(before.cloud, cloud.read);
    for (const t of old) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
  };

  const run = (
    p: WebGLProgram,
    output: Target,
    texel: Target,
    setup: (u: (n: string) => WebGLUniformLocation | null) => void,
  ) => {
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const position = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniform2f(u("uTexel"), 1 / texel.width, 1 / texel.height);
    setup(u);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    gl.viewport(0, 0, output.width, output.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // Units 13-15 are the simulation's own, clear of the scene's textures.
  const bind = (unit: number, t: Target) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    return unit;
  };

  const splat = (field: PingPong, s: CloudSplat, value: [number, number, number]) => {
    run(programs.splat!, field.write, field.read, (u) => {
      gl.uniform1i(u("uTarget"), bind(13, field.read));
      gl.uniform2f(u("uPoint"), s.x, 1 - s.y);
      gl.uniform3f(u("uValue"), value[0], value[1], value[2]);
      gl.uniform1f(u("uRadius"), s.radius * s.radius);
      gl.uniform1f(u("uAspect"), aspect);
    });
    field.swap();
  };

  const step = (dt: number, time: number, splats: CloudSplat[], weather: FluidWeather, layer: [number, number]) => {
    if (!velocity || !pressure || !cloud || !divergence || !curl) return;
    const v = velocity;
    const p = pressure;
    const k = cloud;
    const div = divergence;
    const cu = curl;
    for (const s of splats) {
      if (s.push[0] || s.push[1]) splat(v, { ...s, radius: s.radius * 1.6 }, [s.push[0], -s.push[1], 0]);
      if (s.amount) splat(k, s, [s.amount, 0, 0]);
    }
    if (dt <= 0) return;
    // A slow breeze from right to left with meandering eddies.
    run(programs.current!, v.write, v.read, (u) => {
      gl.uniform1i(u("uVelocity"), bind(13, v.read));
      gl.uniform1f(u("uTime"), time);
      gl.uniform1f(u("uDt"), dt);
      gl.uniform2f(u("uWind"), weather.wind[0], weather.wind[1]);
      gl.uniform1f(u("uEddies"), weather.eddies);
    });
    v.swap();
    run(programs.curl!, cu, v.read, (u) => gl.uniform1i(u("uVelocity"), bind(13, v.read)));
    run(programs.vorticity!, v.write, v.read, (u) => {
      gl.uniform1i(u("uVelocity"), bind(13, v.read));
      gl.uniform1i(u("uCurl"), bind(14, cu));
      gl.uniform1f(u("uStrength"), 1.2);
      gl.uniform1f(u("uDt"), dt);
    });
    v.swap();
    run(programs.divergence!, div, v.read, (u) => gl.uniform1i(u("uVelocity"), bind(13, v.read)));
    run(programs.scale!, p.write, p.read, (u) => {
      gl.uniform1i(u("uSource"), bind(13, p.read));
      gl.uniform1f(u("uKeep"), 0.8);
    });
    p.swap();
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      run(programs.pressure!, p.write, p.read, (u) => {
        gl.uniform1i(u("uPressure"), bind(13, p.read));
        gl.uniform1i(u("uDivergence"), bind(14, div));
      });
      p.swap();
    }
    run(programs.subtract!, v.write, v.read, (u) => {
      gl.uniform1i(u("uPressure"), bind(13, p.read));
      gl.uniform1i(u("uVelocity"), bind(14, v.read));
    });
    v.swap();
    run(programs.advect!, v.write, v.read, (u) => {
      gl.uniform1i(u("uVelocity"), bind(13, v.read));
      gl.uniform1i(u("uSource"), bind(13, v.read));
      gl.uniform2f(u("uVelocityTexel"), 1 / v.read.width, 1 / v.read.height);
      gl.uniform1f(u("uDt"), dt);
      // The air calms quickly, which keeps everything slow.
      gl.uniform1f(u("uKeep"), Math.exp(-dt / 4));
      gl.uniform2f(u("uLayer"), -1, 2);
      gl.uniform1f(u("uOutside"), 1);
      gl.uniform1f(u("uPhase"), 0);
    });
    v.swap();
    run(programs.advect!, k.write, k.read, (u) => {
      gl.uniform1i(u("uVelocity"), bind(13, v.read));
      gl.uniform1i(u("uSource"), bind(14, k.read));
      gl.uniform2f(u("uVelocityTexel"), 1 / v.read.width, 1 / v.read.height);
      gl.uniform1f(u("uDt"), dt);
      // Cloud thins away over the weather's fade time, and quickly outside its layer.
      gl.uniform1f(u("uKeep"), Math.exp(-dt / weather.fade));
      gl.uniform2f(u("uLayer"), layer[0], layer[1]);
      gl.uniform1f(u("uPhase"), time * 0.03);
      gl.uniform1f(u("uOutside"), Math.exp(-dt / 4));
    });
    k.swap();
    run(programs.diffuse!, k.write, k.read, (u) => {
      gl.uniform1i(u("uSource"), bind(13, k.read));
      gl.uniform1f(u("uRate"), Math.min(0.5, dt * 0.6));
    });
    k.swap();
  };

  return {
    step,
    resize,
    bindClouds: (unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, cloud ? cloud.read.texture : null);
    },
    dispose: () => {
      release();
      gl.deleteBuffer(quad);
      for (const p of Object.values(programs)) if (p) gl.deleteProgram(p);
    },
  };
}

function program(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[scenic] cloud fluid shader failed to compile:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const made = gl.createProgram()!;
  gl.attachShader(made, vertex);
  gl.attachShader(made, fragment);
  gl.linkProgram(made);
  return gl.getProgramParameter(made, gl.LINK_STATUS) ? made : null;
}
