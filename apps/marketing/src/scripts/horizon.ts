// Starry horizon backdrop: redraws the horizon photo as fine dots on a
// WebGL2 canvas laid over the <img>. Colors come from the photo itself, read
// with the same object-fit: cover mapping the <img> uses, so swapping the
// image updates the backdrop. The photo stays visible without JS, with
// reduced motion, and whenever WebGL is unavailable or the context is lost.
//
// Each grid cell holds at most one dot at a random spot inside the cell. A
// blurred copy of the photo, dimmed by what the dots add on average, fills
// the gaps, so from a normal distance the page keeps the photo's gradient.

// Tuning knobs. Sizes are in CSS pixels.
/** Grid cell per dot; smaller is denser (dot count grows with 1 / CELL_SIZE^2). */
const CELL_SIZE = 3;
/** Dot radius range: 0.45 to 0.9 gives dots of about 1 to 2 px. */
const DOT_RADIUS_MIN = 0.45;
const DOT_RADIUS_MAX = 0.9;
/** Dot brightness relative to the photo, in linear light. */
const DOT_GAIN = 1.5;
/** Share of cells with a dot in the darkest sky and in bright areas. */
const DENSITY_DARK = 0.55;
const DENSITY_BRIGHT = 1;
/** Share of dark-sky cells whose dot is a pale twinkling star. */
const STAR_CHANCE = 0.012;
/** Pointer reach, how far dots move away, and how much they brighten. */
const POINTER_RADIUS = 150;
const POINTER_PUSH = 7;
const POINTER_BRIGHTEN = 0.6;
/** Seconds for pointer energy to halve once the pointer rests. */
const POINTER_HALF_LIFE = 0.45;
/** Frame rate cap while only the stars twinkle. */
const IDLE_FPS = 30;
/** Backing store limits. */
const MAX_DPR = 2;
const MAX_BACKING_PIXELS = 8_300_000;
/** Mip level of the dot grid used as the blurred base (3.5 is about 34 px). */
const BLUR_LOD = 3.5;

const SHARED_GLSL = /* glsl */ `
vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float luminance(vec3 lin) { return dot(lin, vec3(0.2126, 0.7152, 0.0722)); }
float dotDensity(vec3 blurLin) {
  return mix(${DENSITY_DARK.toFixed(3)}, ${DENSITY_BRIGHT.toFixed(3)},
    smoothstep(0.004, 0.06, luminance(blurLin)));
}
// Brightens a color by DOT_GAIN, less where that would clip, keeping its hue.
vec3 dotGain(vec3 lin) {
  float peak = max(max(lin.r, lin.g), max(lin.b, 1e-4));
  return lin * min(${DOT_GAIN.toFixed(3)}, 1.0 / peak);
}
// The color between dots, chosen so that dots and gaps average out to the
// photo: photo = coverage * dot + (1 - coverage) * base.
vec3 baseColor(vec3 blurLin) {
  float rMin = ${DOT_RADIUS_MIN.toFixed(3)};
  float rMax = ${DOT_RADIUS_MAX.toFixed(3)};
  float meanArea = 3.14159 * (rMin * rMin + rMin * rMax + rMax * rMax) / 3.0;
  float coverage = dotDensity(blurLin) * meanArea / ${(CELL_SIZE * CELL_SIZE).toFixed(3)};
  return max(blurLin - coverage * dotGain(blurLin), vec3(0.0)) / (1.0 - coverage);
}
`;

const BASE_VERTEX = /* glsl */ `#version 300 es
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(corner * 4.0 - 1.0, 0.0, 1.0);
}`;

const BASE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform vec2 uBacking;
out vec4 outColor;
${SHARED_GLSL}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uBacking.y - gl_FragCoord.y) / uBacking;
  vec3 blurLin = toLinear(textureLod(uColor, uv, ${BLUR_LOD.toFixed(2)}).rgb);
  outColor = vec4(toSrgb(baseColor(blurLin)), 1.0);
}`;

const DOT_VERTEX = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform vec2 uGrid;
uniform vec2 uView;
uniform float uScale;
uniform float uTime;
uniform vec3 uPointer;
out vec3 vColor;
out float vRadius;
${SHARED_GLSL}
uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float random(inout uint state) {
  state = hash(state);
  return float(state >> 8) / 16777216.0;
}
void main() {
  int cols = int(uGrid.x);
  ivec2 cell = ivec2(gl_VertexID % cols, gl_VertexID / cols);
  uint state = uint(gl_VertexID) * 0x9e3779b9u + 0x632be5abu;
  vec2 jitter = vec2(random(state), random(state));
  float presence = random(state);
  float kind = random(state);
  float size = random(state);
  float speed = random(state);
  float phase = random(state) * 6.2832;

  vec3 lin = toLinear(texelFetch(uColor, cell, 0).rgb);
  vec3 blurLin = toLinear(textureLod(uColor, (vec2(cell) + 0.5) / uGrid, ${BLUR_LOD.toFixed(2)}).rgb);
  if (presence > dotDensity(blurLin)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec2 pos = (vec2(cell) + jitter) * uView / uGrid;
  vec2 away = pos - uPointer.xy;
  float near = uPointer.z * pow(1.0 - smoothstep(0.0, ${POINTER_RADIUS.toFixed(1)}, length(away)), 2.0);
  // The push tapers to zero under the pointer so it opens no hole there.
  pos += away / max(length(away), 1.0) * min(length(away) / 30.0, 1.0) * ${POINTER_PUSH.toFixed(2)} * near;

  // Stars live in the dark blue sky: blue over red, and dim.
  vec3 blur = toSrgb(blurLin);
  float sky = smoothstep(0.0, 0.08, blur.b - blur.r) * (1.0 - smoothstep(0.015, 0.09, luminance(blurLin)));
  bool star = kind < ${STAR_CHANCE.toFixed(4)} * sky;

  vec3 dotLin = dotGain(lin);
  float radius = mix(${DOT_RADIUS_MIN.toFixed(3)}, ${DOT_RADIUS_MAX.toFixed(3)}, size);
  if (star) {
    float twinkle = 0.5 + 0.5 * sin(uTime * mix(0.5, 1.4, speed) * (1.0 + 2.0 * near) + phase);
    dotLin = mix(dotLin, vec3(0.55, 0.62, 0.8), 0.7) * mix(0.15, 1.0, twinkle);
    radius = mix(0.75, 1.0, size);
  }
  dotLin *= 1.0 + ${POINTER_BRIGHTEN.toFixed(3)} * near;

  vColor = toSrgb(dotLin);
  vRadius = radius * uScale;
  gl_PointSize = ceil(vRadius * 2.0 + 2.0);
  gl_Position = vec4(pos / uView * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const DOT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
in float vRadius;
out vec4 outColor;
void main() {
  float size = ceil(vRadius * 2.0 + 2.0);
  float distance = length(gl_PointCoord - 0.5) * size;
  float alpha = clamp(vRadius + 0.5 - distance, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  outColor = vec4(vColor, alpha);
}`;

interface Programs {
  base: WebGLProgram;
  dots: WebGLProgram;
  texture: WebGLTexture;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const compile = (gl: WebGL2RenderingContext, vertex: string, fragment: string) => {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "Shader compile failed");
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
  }
  return program;
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

const mountHorizon = (root: HTMLElement) => {
  const img = root.querySelector("img");
  if (!img) return;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });
  if (!gl) return;
  root.append(canvas);

  const sampler = document.createElement("canvas");
  const sampleContext = sampler.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) return;

  let programs: Programs | null = null;
  let view = { width: 0, height: 0, cols: 0, rows: 0, scale: 1 };
  let sampled = false;
  let visible = document.visibilityState === "visible";
  let inView = false;
  let frame = 0;
  let lastDraw = 0;
  let lastTick = 0;
  const pointer = { x: -1e4, y: -1e4, targetX: -1e4, targetY: -1e4, energy: 0 };

  const setup = () => {
    try {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const base = compile(gl, BASE_VERTEX, BASE_FRAGMENT);
      const dots = compile(gl, DOT_VERTEX, DOT_FRAGMENT);
      const uniforms: Programs["uniforms"] = {
        baseColor: gl.getUniformLocation(base, "uColor"),
        baseBacking: gl.getUniformLocation(base, "uBacking"),
      };
      for (const name of ["uColor", "uGrid", "uView", "uScale", "uTime", "uPointer"]) {
        uniforms[name] = gl.getUniformLocation(dots, name);
      }
      programs = { base, dots, texture, uniforms };
      sampled = false;
    } catch (error) {
      console.warn("Horizon backdrop disabled:", error);
      programs = null;
    }
  };

  // Reads the photo's colors for the current size, one pixel per grid cell.
  const sample = () => {
    if (!programs || !img.complete || img.naturalWidth === 0) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width === 0 || height === 0) return;
    const scale = Math.min(
      window.devicePixelRatio || 1,
      MAX_DPR,
      Math.sqrt(MAX_BACKING_PIXELS / (width * height)),
    );
    const cols = Math.max(1, Math.round(width / CELL_SIZE));
    const rows = Math.max(1, Math.round(height / CELL_SIZE));
    view = { width, height, cols, rows, scale };
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    // object-fit: cover, object-position: 50% 50%.
    const cover = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const sourceWidth = width / cover;
    const sourceHeight = height / cover;
    sampler.width = cols;
    sampler.height = rows;
    sampleContext.imageSmoothingQuality = "high";
    sampleContext.drawImage(
      img,
      (img.naturalWidth - sourceWidth) / 2,
      (img.naturalHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      cols,
      rows,
    );
    const pixels = sampleContext.getImageData(0, 0, cols, rows);
    gl.bindTexture(gl.TEXTURE_2D, programs.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    sampled = true;
  };

  const draw = (time: number) => {
    if (!programs || !sampled) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, programs.texture);

    const { uniforms } = programs;

    gl.disable(gl.BLEND);
    gl.useProgram(programs.base);
    gl.uniform1i(uniforms.baseColor!, 0);
    gl.uniform2f(uniforms.baseBacking!, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(programs.dots);
    gl.uniform1i(uniforms.uColor!, 0);
    gl.uniform2f(uniforms.uGrid!, view.cols, view.rows);
    gl.uniform2f(uniforms.uView!, view.width, view.height);
    gl.uniform1f(uniforms.uScale!, view.scale);
    gl.uniform1f(uniforms.uTime!, time / 1000);
    gl.uniform3f(uniforms.uPointer!, pointer.x, pointer.y, pointer.energy);
    gl.drawArrays(gl.POINTS, 0, view.cols * view.rows);

    if (!canvas.classList.contains("is-ready")) canvas.classList.add("is-ready");
  };

  const tick = (time: number) => {
    frame = 0;
    const dt = Math.min(0.1, lastTick ? (time - lastTick) / 1000 : 0);
    lastTick = time;
    if (pointer.energy > 0) {
      // Ease toward the pointer and let the effect fade when it rests.
      const rect = canvas.getBoundingClientRect();
      const follow = 1 - Math.exp(-dt / 0.08);
      pointer.x += (pointer.targetX - rect.left - pointer.x) * follow;
      pointer.y += (pointer.targetY - rect.top - pointer.y) * follow;
      pointer.energy *= 0.5 ** (dt / POINTER_HALF_LIFE);
      if (pointer.energy < 0.01) pointer.energy = 0;
    }
    if (pointer.energy > 0 || time - lastDraw >= 1000 / IDLE_FPS - 2) {
      lastDraw = time;
      draw(time);
    }
    schedule();
  };

  const running = () => programs !== null && sampled && visible && inView && !reducedMotion.matches;

  const schedule = () => {
    if (frame || !running()) return;
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
  };

  const refresh = () => {
    if (reducedMotion.matches) {
      stop();
      canvas.classList.remove("is-ready");
      return;
    }
    if (!programs) return;
    sample();
    // Resizing clears the canvas; repaint now rather than on the next tick.
    if (running()) draw(performance.now());
    schedule();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    const moved = Math.hypot(event.clientX - pointer.targetX, event.clientY - pointer.targetY);
    if (pointer.energy === 0) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    }
    pointer.targetX = event.clientX;
    pointer.targetY = event.clientY;
    pointer.energy = Math.min(1, pointer.energy + Math.min(moved, 60) / 120);
    schedule();
  };

  const updatePointerListener = () => {
    if (finePointer.matches)
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    else window.removeEventListener("pointermove", onPointerMove);
  };

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    programs = null;
    canvas.classList.remove("is-ready");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    setup();
    refresh();
  });

  document.addEventListener("visibilitychange", () => {
    visible = document.visibilityState === "visible";
    if (visible) schedule();
    else stop();
  });
  new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    if (inView) schedule();
    else stop();
  }).observe(root);

  let resizeFrame = 0;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      refresh();
    });
  }).observe(root);

  // The <picture> swaps sources across the 899px breakpoint; resample then.
  img.addEventListener("load", refresh);
  reducedMotion.addEventListener("change", refresh);
  finePointer.addEventListener("change", updatePointerListener);
  updatePointerListener();

  setup();
  if (img.complete) img.decode().then(refresh, refresh);
};

for (const root of document.querySelectorAll<HTMLElement>("[data-horizon]")) {
  mountHorizon(root);
}
