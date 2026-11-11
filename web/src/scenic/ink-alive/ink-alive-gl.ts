/**
 * Runs the living Ink & Paper scene on a canvas with WebGL: loads its painted layers, lays them
 * out for the pane (`layoutScene`), lets the director (`InkDirector`) decide what moves, and draws
 * 20 frames a second while the page is visible, 6 while another window is in front. With
 * reduced motion it draws a single still frame. Returns a stop function, or null when WebGL is
 * unavailable; `onFail` reports a later failure (layers that do not load, a lost context).
 */
import { useStore } from "../../store.js";
import { type ActivityKind, InkDirector, type MomentKind } from "./ink-alive-director.js";
import { type ImageSize, layoutScene } from "./ink-alive-layout.js";
import { INK_ALIVE_SHADER, VERTEX_SHADER } from "./ink-alive-shaders.js";

/** Dispatch with a `MomentKind` as detail to start a moment now (the Playground's buttons). */
export const SCENIC_INK_MOMENT_EVENT = "scenic-ink-moment";

const alive = (name: string) => `/scenic/${name}.v1.webp`;

const TEXTURES = {
  uPaper: alive("ink-paper"),
  uFar: alive("ink-far"),
  uMidFar: alive("ink-midfar"),
  uMid: alive("ink-mid"),
  uFarNight: alive("ink-far-night"),
  uMidFarNight: alive("ink-midfar-night"),
  uMidNight: alive("ink-mid-night"),
  uNear: alive("ink-near"),
  uBoat: alive("ink-boat"),
  uCrane: alive("ink-crane"),
};

type TextureName = keyof typeof TEXTURES;

export function startInkAlive(
  canvas: HTMLCanvasElement,
  options: { dark: boolean; motion: boolean; onFail: () => void },
): (() => void) | null {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
  if (!gl) return null;
  const program = link(gl, INK_ALIVE_SHADER);
  if (!program) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const textures: WebGLTexture[] = [];

  let stopped = false;
  let frame = 0;
  let ready = false;
  let pane = { width: 1, height: 1 };
  let scale = 1;
  const sizes = {} as Record<TextureName, ImageSize>;
  const started = performance.now();
  const now = () => (performance.now() - started) / 1000;
  const director = new InkDirector(Math.floor(Math.random() * 2 ** 31));

  // A weak GPU that cannot keep up would stall the page itself, so the scene steps down to fewer
  // pixels and frames when its frames run long, and stays there.
  const levels = [
    { scale: 1, fps: 20 },
    { scale: 0.75, fps: 20 },
    { scale: 0.5, fps: 15 },
    { scale: 0.5, fps: 8 },
  ];
  let level = 0;
  let strain = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    // At most one canvas pixel per CSS pixel: the paintings are soft, and this keeps the GPU work
    // at a quarter of the device resolution on high-density screens.
    scale = Math.min(1, window.devicePixelRatio || 1) * levels[level]!.scale;
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    pane = { width: rect.width, height: rect.height };
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();

  const locations = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };

  const draw = () => {
    if (!ready || stopped) return;
    const time = now();
    const frameState = director.update(time, pane.width, pane.height);
    const layout = layoutScene(
      pane,
      {
        far: sizes.uFar,
        midFar: sizes.uMidFar,
        mid: sizes.uMid,
        near: sizes.uNear,
        boat: sizes.uBoat,
        crane: sizes.uCrane,
      },
      time,
      frameState,
    );
    gl.uniform2f(uniform("uRes"), canvas.width, canvas.height);
    gl.uniform1f(uniform("uScale"), scale);
    gl.uniform1f(uniform("uTime"), frameState.sceneTime);
    gl.uniform1f(uniform("uDark"), options.dark ? 1 : 0);
    gl.uniform1f(uniform("uHorizon"), layout.horizon);
    gl.uniform3fv(uniform("uSun"), layout.sun);
    gl.uniform4fv(uniform("uFarRect"), layout.far);
    gl.uniform4fv(uniform("uMidFarRect"), layout.midFar);
    gl.uniform4fv(uniform("uMidRect"), layout.mid);
    gl.uniform4fv(uniform("uNearRect"), layout.near);
    gl.uniform4fv(uniform("uBoatRect"), layout.boat);
    gl.uniform4fv(uniform("uCraneRect"), layout.craneRects);
    gl.uniform4fv(uniform("uCranePose"), layout.cranePoses);
    const blooms = frameState.blooms.slice(-2).flatMap((bloom) => [bloom.x, bloom.y, bloom.start, bloom.seed]);
    while (blooms.length < 8) blooms.push(0, 0, -1e4, 0);
    gl.uniform4fv(uniform("uBloom"), blooms);
    const rings = frameState.rings.slice(-2).flatMap((ring) => [ring.x, ring.depth, ring.start, 0]);
    while (rings.length < 8) rings.push(0, 0, -1e4, 0);
    gl.uniform4fv(uniform("uRing"), rings);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Frames are scheduled with a timer at the scene's own rate, then drawn in the next animation
  // frame. Looping on requestAnimationFrame instead would wake the page at the display's rate
  // (120 times a second on ProMotion screens) just to skip most of those wake-ups.
  let timer = 0;
  let last = 0;
  const schedule = () => {
    // Full rate while the window has focus; a slow drift while another app is in front.
    const rate = Math.min(levels[level]!.fps, document.hasFocus() ? levels[level]!.fps : 6);
    timer = window.setTimeout(() => {
      frame = requestAnimationFrame(loop);
    }, 1000 / rate);
  };
  const loop = (stamp: number) => {
    schedule();
    if (document.hidden) return;
    const rate = levels[level]!.fps;
    const late = last > 0 && document.hasFocus() && stamp - last > 3000 / rate;
    last = stamp;
    const begin = performance.now();
    draw();
    // Drawing that blocks the page, or frames arriving far apart, means the GPU is behind.
    strain = performance.now() - begin > 12 || late ? strain + 1 : Math.max(0, strain - 1);
    if (strain > 20 && level < levels.length - 1) {
      level += 1;
      strain = 0;
      resize();
    }
  };

  const texture = (unit: number, setup: () => void) => {
    const handle = gl.createTexture()!;
    textures.push(handle);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    setup();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  };

  // Random values for the shader's noise, tiling so they can wrap. Seeded, so the same moment
  // always looks the same.
  const noise = new Uint8Array(256 * 256);
  let seed = 0x9e3779b9;
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    noise[i] = (seed >>> 0) & 255;
  }
  const noiseUnit = Object.keys(TEXTURES).length;
  texture(noiseUnit, () => {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 256, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  });
  gl.uniform1i(uniform("uNoise"), noiseUnit);

  const loads = (Object.entries(TEXTURES) as [TextureName, string][]).map(
    ([name, url], unit) =>
      new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          if (stopped) return resolve();
          texture(unit, () => {
            // The crane is cut out with transparency; premultiplying keeps its edges clean.
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, name === "uCrane");
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            // Non-power-of-two textures need clamping in WebGL 1; the paper repeats in the shader.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          });
          gl.uniform1i(uniform(name), unit);
          sizes[name] = { width: image.naturalWidth, height: image.naturalHeight };
          resolve();
        };
        image.onerror = () => reject(new Error(`could not load ${url}`));
        image.src = url;
      }),
  );
  Promise.all(loads)
    .then(() => {
      ready = true;
      draw();
      if (options.motion) schedule();
    })
    .catch((error) => {
      console.warn("[scenic] living ink layers failed to load:", error);
      if (!stopped) options.onFail();
    });
  const lost = (event: Event) => {
    event.preventDefault();
    console.warn("[scenic] living ink lost its WebGL context");
    if (!stopped) options.onFail();
  };
  canvas.addEventListener("webglcontextlost", lost);

  const observer = new ResizeObserver(() => {
    resize();
    draw();
  });
  observer.observe(canvas);

  // Typing, scrolling and arriving replies hush the scene; moments wait until you pause.
  const note = (kind: ActivityKind) => director.noteActivity(kind, now());
  const typing = () => note("typing");
  const scrolling = () => note("scrolling");
  window.addEventListener("keydown", typing, { capture: true, passive: true });
  window.addEventListener("wheel", scrolling, { capture: true, passive: true });
  window.addEventListener("touchmove", scrolling, { capture: true, passive: true });
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.messages !== previous.messages) note("message");
  });
  const moment = (event: Event) => director.spawn((event as CustomEvent<MomentKind>).detail, now());
  window.addEventListener(SCENIC_INK_MOMENT_EVENT, moment);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("keydown", typing, { capture: true });
    window.removeEventListener("wheel", scrolling, { capture: true });
    window.removeEventListener("touchmove", scrolling, { capture: true });
    unsubscribe();
    window.removeEventListener(SCENIC_INK_MOMENT_EVENT, moment);
    canvas.removeEventListener("webglcontextlost", lost);
    // The context stays with the canvas: losing it here would break a restart on the same canvas.
    for (const handle of textures) gl.deleteTexture(handle);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
  };
}

function link(gl: WebGLRenderingContext, fragmentSource: string): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[scenic] shader failed to compile:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[scenic] shader failed to link:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
