// Living horizon backdrop: one WebGL fragment shader redraws the horizon photo
// with a slow, endless drift toward the horizon and a faint old-TV look
// (grain, scanlines, vignette, rare flicker). Grain gathers around the pointer.
// The <img> underneath stays the fallback: the canvas only fades in once it
// has drawn, and never runs with reduced motion or without WebGL2.

// ── Tuning knobs ────────────────────────────────────────────────
// Drift: each of two zoom layers gains ZOOM_AMOUNT of scale per ZOOM_PERIOD
// seconds; they run half a cycle apart and crossfade, so one always takes over
// before the other wraps around.
const ZOOM_AMOUNT = 0.024;
const ZOOM_PERIOD = 30;
// Zoom origin in image coordinates (0..1, y down): the horizon glow.
const ZOOM_ORIGIN_X = 0.5;
const ZOOM_ORIGIN_Y = 0.55;
// Seconds over which the drift eases in, so the canvas starts as the photo.
const ZOOM_INTRO = 16;
// Per-frame grain amplitude, as a share of full brightness.
const GRAIN = 0.03;
// Darkening at the center of each scanline, and their spacing in CSS px.
const SCANLINE_OPACITY = 0.035;
const SCANLINE_PERIOD = 3;
// Corner darkening.
const VIGNETTE = 0.12;
// Brightness jitter during a flicker, how long one lasts and the gap between.
const FLICKER = 0.01;
const FLICKER_DURATION = 0.22;
const FLICKER_GAP_MIN = 5;
const FLICKER_GAP_MAX = 12;
// Pointer: radius of the noisy spot (CSS px), extra grain at its center,
// pixels pulled toward the pointer, and the follow lag (time constant, s).
const CURSOR_RADIUS = 200;
const CURSOR_GRAIN = 0.035;
const CURSOR_PULL = 1.5;
const CURSOR_LAG = 0.35;
// Render resolution: device pixels per CSS pixel and a total pixel budget.
const MAX_DPR = 1.5;
const MAX_PIXELS = 2560 * 1440;

const glsl = (value: number) => value.toFixed(5);

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_image;
uniform vec2 u_imageSize;
uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_time;
uniform float u_zoomMix;
uniform uint u_frame;
uniform vec3 u_cursor;
uniform float u_flicker;

out vec4 outColor;

const float PI = 3.14159265;
const vec2 ZOOM_ORIGIN = vec2(${glsl(ZOOM_ORIGIN_X)}, ${glsl(ZOOM_ORIGIN_Y)});

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

// Canvas pixel to image coordinates, matching object-fit: cover.
vec2 coverUv(vec2 fragCoord) {
  vec2 uv = fragCoord / u_resolution;
  uv.y = 1.0 - uv.y;
  float viewAspect = u_resolution.x / u_resolution.y;
  float imageAspect = u_imageSize.x / u_imageSize.y;
  vec2 visible = viewAspect > imageAspect
    ? vec2(1.0, imageAspect / viewAspect)
    : vec2(viewAspect / imageAspect, 1.0);
  return 0.5 + (uv - 0.5) * visible;
}

// Scaling up around a point inside the image never samples past its edges.
vec3 zoomLayer(vec2 uv, float phase) {
  float scale = 1.0 + ${glsl(ZOOM_AMOUNT)} * phase * u_zoomMix;
  return texture(u_image, ZOOM_ORIGIN + (uv - ZOOM_ORIGIN) / scale).rgb;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;

  vec2 toCursor = u_cursor.xy - fragCoord;
  float cursorDistance = length(toCursor) / u_pixelRatio;
  float nearCursor = u_cursor.z * (1.0 - smoothstep(0.0, ${glsl(CURSOR_RADIUS)}, cursorDistance));
  float pull = ${glsl(CURSOR_PULL)} * u_pixelRatio * nearCursor
    * smoothstep(0.0, ${glsl(CURSOR_RADIUS * 0.25)}, cursorDistance);
  vec2 uv = coverUv(fragCoord - toCursor / max(length(toCursor), 0.001) * pull);

  float phase = fract(u_time / ${glsl(ZOOM_PERIOD)});
  float weight = sin(PI * phase);
  weight *= weight;
  vec3 color = mix(zoomLayer(uv, fract(phase + 0.5)), zoomLayer(uv, phase), weight);

  vec2 grainCell = floor(fragCoord / u_pixelRatio);
  vec3 random = vec3(pcg3d(uvec3(uvec2(grainCell), u_frame))) / 4294967295.0;
  float grain = random.x + random.y - 1.0;
  color += grain * (${glsl(GRAIN)} + ${glsl(CURSOR_GRAIN)} * nearCursor);

  float line = 0.5 + 0.5 * cos(2.0 * PI * fragCoord.y / (u_pixelRatio * ${glsl(SCANLINE_PERIOD)}));
  color *= 1.0 - ${glsl(SCANLINE_OPACITY)} * line * line * line;

  vec2 centered = fragCoord / u_resolution - 0.5;
  color *= 1.0 - ${glsl(VIGNETTE)} * smoothstep(0.3, 0.75, length(centered));

  color *= 1.0 + u_flicker;
  outColor = vec4(color, 1.0);
}`;

interface Renderer {
  upload: () => void;
  resize: (width: number, height: number, pixelRatio: number) => void;
  draw: (
    time: number,
    zoomMix: number,
    frame: number,
    cursor: readonly number[],
    flicker: number,
  ) => void;
}

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
};

const createRenderer = (canvas: HTMLCanvasElement, img: HTMLImageElement): Renderer | null => {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // One triangle that covers the whole viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    imageSize: uniform("u_imageSize"),
    resolution: uniform("u_resolution"),
    pixelRatio: uniform("u_pixelRatio"),
    time: uniform("u_time"),
    zoomMix: uniform("u_zoomMix"),
    frame: uniform("u_frame"),
    cursor: uniform("u_cursor"),
    flicker: uniform("u_flicker"),
  };

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    upload: () => {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform2f(u.imageSize, img.naturalWidth, img.naturalHeight);
    },
    resize: (width, height, pixelRatio) => {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(u.resolution, width, height);
      gl.uniform1f(u.pixelRatio, pixelRatio);
    },
    draw: (time, zoomMix, frame, cursor, flicker) => {
      gl.uniform1f(u.time, time);
      gl.uniform1f(u.zoomMix, zoomMix);
      gl.uniform1ui(u.frame, frame);
      gl.uniform3f(u.cursor, cursor[0]!, cursor[1]!, cursor[2]!);
      gl.uniform1f(u.flicker, flicker);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

// The pointer in viewport coordinates, shared by every backdrop on the page.
const pointer = { x: 0, y: 0, active: false };
window.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerType !== "mouse" || !finePointer.matches) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  },
  { passive: true },
);
window.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) pointer.active = false;
});

const smoothstep = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

const mount = (root: HTMLElement) => {
  const img = root.querySelector("img");
  const canvas = root.querySelector("canvas");
  if (!img || !canvas) return;

  let renderer: Renderer | null = null;
  let failed = false;
  let imageReady = false;
  let imageUploaded = false;
  let inView = false;
  let live = false;
  let frameRequest = 0;
  let lastFrame = 0;
  let time = 0;
  let frame = 0;
  let nextFlicker = FLICKER_GAP_MIN;
  let flickerEnd = 0;
  // Followed pointer position (viewport px) and strength of the noisy spot.
  const follow = { x: 0, y: 0, strength: 0 };
  const cursor = [0, 0, 0];

  const flickerAt = (now: number) => {
    if (now >= nextFlicker) {
      flickerEnd = now + FLICKER_DURATION;
      nextFlicker = now + FLICKER_GAP_MIN + Math.random() * (FLICKER_GAP_MAX - FLICKER_GAP_MIN);
    }
    return now < flickerEnd ? (Math.random() * 2 - 1) * FLICKER : 0;
  };

  const render = (dt: number) => {
    if (!renderer) return;
    time += dt;
    frame = (frame + 1) % 1_000_000;

    const ease = 1 - Math.exp(-dt / CURSOR_LAG);
    if (pointer.active && follow.strength < 0.01) {
      follow.x = pointer.x;
      follow.y = pointer.y;
    }
    follow.x += (pointer.x - follow.x) * ease;
    follow.y += (pointer.y - follow.y) * ease;
    follow.strength += ((pointer.active ? 1 : 0) - follow.strength) * ease;

    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / Math.max(rect.width, 1);
    cursor[0] = (follow.x - rect.left) * scale;
    cursor[1] = (rect.bottom - follow.y) * scale;
    cursor[2] = follow.strength;

    renderer.draw(time, smoothstep(time / ZOOM_INTRO), frame, cursor, flickerAt(time));
    if (!live) {
      live = true;
      canvas.classList.add("is-live");
    }
  };

  const tick = (now: number) => {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    render(dt);
    frameRequest = requestAnimationFrame(tick);
  };

  const resize = () => {
    if (!renderer) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    let pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    pixelRatio = Math.min(pixelRatio, Math.sqrt(MAX_PIXELS / (width * height)));
    renderer.resize(Math.round(width * pixelRatio), Math.round(height * pixelRatio), pixelRatio);
    // Resizing clears the canvas; redraw before it is painted.
    if (live) render(0);
  };

  const sync = () => {
    if (!renderer && !failed && !reducedMotion.matches) {
      renderer = createRenderer(canvas, img);
      failed = !renderer;
      resize();
    }
    if (renderer && !failed && imageReady && !imageUploaded) {
      renderer.upload();
      imageUploaded = true;
    }
    const run = !failed && imageUploaded && inView && !document.hidden && !reducedMotion.matches;
    if (run && !frameRequest) {
      lastFrame = performance.now();
      frameRequest = requestAnimationFrame(tick);
    } else if (!run && frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    canvas.classList.toggle("is-live", live && !failed && !reducedMotion.matches);
  };

  const onImage = () => {
    imageReady = true;
    imageUploaded = false;
    sync();
  };
  // A <source> switch (narrow and wide layouts) loads a new image.
  img.addEventListener("load", onImage);
  if (img.complete && img.naturalWidth) img.decode().then(onImage, () => {});

  canvas.addEventListener("webglcontextlost", () => {
    failed = true;
    live = false;
    sync();
  });

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    sync();
  }).observe(root);
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", sync);
  sync();
};

document.querySelectorAll<HTMLElement>("[data-horizon-backdrop]").forEach(mount);
