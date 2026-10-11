// Living horizon backdrop: one WebGL2 fragment shader models the scene of the
// horizon photo instead of showing it. A camera 30 km above a planet looks at
// its curved edge through a single-scattering atmosphere lit by a sun just
// below the horizon. Stars sit on the celestial sphere, faint high bands drift
// near the horizon, and the world breathes: the glow swells, air shimmers over
// the edge and the camera sways, so stars, bands and the planet edge move at
// different rates. A faint old-TV layer (grain, scanlines, vignette, rare
// flicker) goes on top. Near the pointer the grain gathers, stars twinkle and
// the camera tilts a little toward it.
// The <img> underneath stays the fallback: the canvas only fades in once it
// has drawn, and never runs with reduced motion or without WebGL2.

// ── Tuning knobs ────────────────────────────────────────────────
// Lengths are in km, angles in degrees, screen sizes in CSS px, times in s.
// Camera and planet. The view covers the photo's frame (FRAME_ASPECT) with
// FIELD_OF_VIEW horizontally and is cropped like object-fit: cover, so the
// horizon lands where it is in the photo.
const CAMERA_HEIGHT = 30;
const PLANET_RADIUS = 6371;
const ATMOSPHERE_HEIGHT = 100;
const CAMERA_PITCH = -3.06;
const FIELD_OF_VIEW = 72;
const FRAME_ASPECT = 2560 / 1441;
// Sun, below the visible horizon (which is 5.56 degrees down from 30 km).
const SUN_ELEVATION = -7.79;
const SUN_AZIMUTH = 3;
const SUN_COLOR = [0.81, 0.93, 0.79];
const SUN_INTENSITY = 20;
// Atmosphere: scattering per km at sea level and scale heights. Rayleigh is
// per RGB channel (this planet's air scatters green about as much as blue),
// Mie is grey haze with forward anisotropy MIE_G. OZONE is an absorbing layer
// that takes red out of grazing sunlight; here it sits high, at OZONE_CENTER,
// so the upper sky turns teal while the low glow stays warm.
const RAYLEIGH = [1.95e-3, 27.67e-3, 27.0e-3];
const RAYLEIGH_HEIGHT = 19.9;
const MIE = 2.2e-3;
const MIE_HEIGHT = 11.6;
const MIE_G = 0.54;
const OZONE = [13.85e-3, 4.3e-3, 0.013e-3];
const OZONE_CENTER = 61.6;
const OZONE_WIDTH = 8.8;
// Display: exposure before a soft filmic shoulder, then a film-like grade.
// The atmosphere and grade constants were fitted to the photo (mean OKLab
// error about 3 on the sky, see the task notes); GROUND_COLOR is the land's
// display color before the grade.
const EXPOSURE = 13.6;
// Share of red light that spills into green, of red into blue and of green
// into blue, so a bright red glow turns orange and peach as on film.
const FILM_SPILL = [0.124, 0.02, 0.146];
// Matrix on display colors, row by row (output red, green, blue from input
// red, green, blue), then saturation.
const FILM_GRADE = [0.969, -0.184, 0.184, 0.031, 1.002, 0.008, 0.047, -0.035, 1.039];
const FILM_SATURATION = 1.37;
// Where blue leads red: red taken away and green added, per unit of lead.
const FILM_TEAL = [0.335, 0.155];
// Contrast of the final display colors (above 1 darkens the mid tones).
const FILM_GAMMA = 1.056;
const GROUND_COLOR = [0.082, 0.115, 0.144];
// Blur of the planet edge, rim of glow on the land under it (strength,
// falloff angle, tint).
const EDGE_SOFTNESS = 0.12;
const RIM = 0.8;
const RIM_WIDTH = 2;
const RIM_COLOR = [1, 0.21, 0.17];
// Glare of the limb in the sky above it, like the halation in the photo:
// strength and falloff angle.
const HALO = 0.3;
const HALO_WIDTH = 6.7;
// Stars: cell size on the sky, share of cells with a star, radius range (CSS
// px), brightness, how strongly faint stars dominate, twinkle depth at rest
// and near the pointer, and extra brightness near the pointer.
const STAR_CELL = 0.55;
const STAR_DENSITY = 0.09;
const STAR_RADIUS_MIN = 0.45;
const STAR_RADIUS_MAX = 0.95;
const STAR_BRIGHTNESS = 0.55;
const STAR_FALLOFF = 2.2;
const STAR_TWINKLE = 0.3;
const STAR_TWINKLE_HOVER = 0.85;
const STAR_HOVER_GAIN = 0.5;
// Stars turn about a pole behind and above the camera, in degrees per second.
const STAR_TURN = 0.02;
// Shimmer of the air over the edge: angle, height of the band it fills,
// horizontal scale (features per radian) and speed.
const SHIMMER = 0.04;
const SHIMMER_HEIGHT = 0.6;
const SHIMMER_SCALE = 90;
const SHIMMER_SPEED = 0.3;
// Glow breathing: relative brightness swing of the warm glow and its periods.
const GLOW_BREATH = 0.06;
const GLOW_PERIOD = 9;
const GLOW_PERIOD_2 = 15;
// High bands: altitude, feature size across and along the view, coverage
// threshold, strength, color, how high above the edge they reach, and wind.
const BAND_ALTITUDE = 82;
const BAND_SCALE_X = 160;
const BAND_SCALE_Z = 110;
const BAND_COVERAGE = 0.45;
const BAND_STRENGTH = 0.2;
const BAND_COLOR = [0.62, 0.72, 0.86];
const BAND_HEIGHT = 5;
const BAND_WIND = [0.4, -1];
// Camera sway: amplitudes and periods of yaw, pitch and height.
const DRIFT_YAW = 0.6;
const DRIFT_YAW_PERIOD = 60;
const DRIFT_PITCH = 0.2;
const DRIFT_PITCH_PERIOD = 45;
const DRIFT_HEIGHT = 1.5;
const DRIFT_HEIGHT_PERIOD = 40;
// Pointer: camera tilt toward it, sideways and upward camera shift, follow lag.
const TILT = 0.45;
const TILT_SHIFT = 1.5;
const TILT_RISE = 0.5;
const TILT_LAG = 1.4;
// Per-frame grain amplitude, as a share of full brightness.
const GRAIN = 0.05;
// Darkening at the center of each scanline, and their spacing in CSS px.
const SCANLINE_OPACITY = 0.05;
const SCANLINE_PERIOD = 3;
// Corner darkening.
const VIGNETTE = 0.12;
// Brightness jitter during a flicker, how long one lasts and the gap between.
const FLICKER = 0.01;
const FLICKER_DURATION = 0.22;
const FLICKER_GAP_MIN = 3;
const FLICKER_GAP_MAX = 8;
// Pointer: radius of the noisy spot (CSS px), extra grain at its center,
// pixels pulled toward the pointer, and the follow lag (time constant, s).
const CURSOR_RADIUS = 200;
const CURSOR_GRAIN = 0.05;
const CURSOR_PULL = 1.5;
const CURSOR_LAG = 0.35;
// Intro, like an old TV switching on: snow on a dark screen, the picture
// coming up, a short flash, then settled. The full intro plays once per visit
// (session storage); later pages get a short fade up. Durations in s.
const INTRO_DURATION = 1.8;
const INTRO_SHORT = 0.35;
const INTRO_SNOW = 0.14;
const INTRO_FLASH = 0.22;
const INTRO_SEEN_KEY = "horizon-intro-seen";
// Without a live frame by then (s), show the photo instead of the dark screen.
const FALLBACK_TIMEOUT = 2.5;
// Render resolution: device pixels per CSS pixel and a total pixel budget.
const MAX_DPR = 1.5;
const MAX_PIXELS = 2560 * 1440;
// Sky lookup table: azimuth from the sun by angle from the zenith.
const SKY_WIDTH = 128;
const SKY_HEIGHT = 256;

const DEG = Math.PI / 180;
const glsl = (value: number) => {
  const text = value.toPrecision(7);
  return /[.e]/.test(text) ? text : `${text}.0`;
};
const vec3 = (value: readonly number[]) => `vec3(${value.map(glsl).join(", ")})`;

// The pole the stars turn about, and two axes across it; the view looks far
// from the pole, so the latitude and longitude star grid stays square there.
const STAR_POLE = [0.3, 0.8, -0.52];
const normalize = (v: readonly number[]) => {
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
};
const starPole = normalize(STAR_POLE);
const starAxisA = normalize([
  -starPole[0]! * starPole[2]!,
  -starPole[1]! * starPole[2]!,
  1 - starPole[2]! * starPole[2]!,
]);
const starAxisB = [
  starPole[1]! * starAxisA[2]! - starPole[2]! * starAxisA[1]!,
  starPole[2]! * starAxisA[0]! - starPole[0]! * starAxisA[2]!,
  starPole[0]! * starAxisA[1]! - starPole[1]! * starAxisA[0]!,
];

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const SHARED = `#version 300 es
precision highp float;
precision highp int;

const float PI = 3.14159265;
const float PLANET_RADIUS = ${glsl(PLANET_RADIUS)};
const float CAMERA_HEIGHT = ${glsl(CAMERA_HEIGHT)};
const float SKY_HALF_TEXEL = ${glsl(0.5 / SKY_HEIGHT)};

// Near and far distances along a ray from inside or outside a sphere about
// the planet center, or -1 when it misses.
vec2 sphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
`;

// Renders the sky once into the lookup table: rows from the zenith down to
// the horizon (top half) and from the horizon down to the nadir (bottom half),
// packed tighter near the horizon. RGB is the display color, A how much
// starlight gets through.
const SKY_SHADER = `${SHARED}
out vec4 outColor;

const float TOP_RADIUS = PLANET_RADIUS + ${glsl(ATMOSPHERE_HEIGHT)};
const vec3 SUN_DIR = vec3(0.0, ${glsl(Math.sin(SUN_ELEVATION * DEG))}, ${glsl(Math.cos(SUN_ELEVATION * DEG))});
const vec3 SUN = ${vec3(SUN_COLOR.map((c) => c * SUN_INTENSITY))};
const vec3 RAYLEIGH = ${vec3(RAYLEIGH)};
const float MIE = ${glsl(MIE)};
const float MIE_G = ${glsl(MIE_G)};
const vec3 OZONE = ${vec3(OZONE)};
const float EXPOSURE = ${glsl(EXPOSURE)};
const int VIEW_STEPS = 64;
const int SUN_STEPS = 12;

// Rayleigh, Mie and ozone density at an altitude.
vec3 density(float altitude) {
  altitude = max(altitude, 0.0);
  return vec3(
    exp(-altitude / ${glsl(RAYLEIGH_HEIGHT)}),
    exp(-altitude / ${glsl(MIE_HEIGHT)}),
    max(0.0, 1.0 - abs(altitude - ${glsl(OZONE_CENTER)}) / ${glsl(OZONE_WIDTH)}));
}

vec3 extinction(vec3 depth) {
  return RAYLEIGH * depth.x + MIE * depth.y + OZONE * depth.z;
}

vec3 sunlight(vec3 point) {
  // The planet's shadow, softened over a few km of the sun ray's lowest point.
  float toward = dot(point, SUN_DIR);
  float lowest = (toward < 0.0 ? length(point - SUN_DIR * toward) : length(point)) - PLANET_RADIUS;
  float lit = smoothstep(-2.0, 2.0, lowest);
  if (lit <= 0.0) return vec3(0.0);
  float stride = sphere(point, SUN_DIR, TOP_RADIUS).y / float(SUN_STEPS);
  vec3 depth = vec3(0.0);
  for (int i = 0; i < SUN_STEPS; i++) {
    vec3 along = point + SUN_DIR * (float(i) + 0.5) * stride;
    depth += density(length(along) - PLANET_RADIUS);
  }
  return lit * exp(-extinction(depth * stride));
}

const vec3 FILM_SPILL = ${vec3(FILM_SPILL)};
vec3 toDisplay(vec3 radiance) {
  radiance.g += FILM_SPILL.x * radiance.r;
  radiance.b += FILM_SPILL.y * radiance.r + FILM_SPILL.z * radiance.g;
  return pow(1.0 - exp(-radiance * EXPOSURE), vec3(1.0 / 2.2));
}

const mat3 FILM_GRADE = transpose(mat3(${FILM_GRADE.map(glsl).join(", ")}));

// Radiance that shows as this display color before the grade.
vec3 fromDisplay(vec3 color) {
  return -log(1.0 - pow(color, vec3(2.2))) / EXPOSURE;
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(${SKY_WIDTH}.0, ${SKY_HEIGHT}.0);
  float azimuth = uv.x * PI;
  float beta = asin(PLANET_RADIUS / (PLANET_RADIUS + CAMERA_HEIGHT));
  float horizon = PI - beta;
  bool ground = uv.y >= 0.5;
  float c = ground ? 2.0 * uv.y - 1.0 : 1.0 - 2.0 * uv.y;
  float zenith = ground ? horizon + beta * c * c : horizon * (1.0 - c * c);
  vec3 dir = vec3(sin(zenith) * sin(azimuth), cos(zenith), sin(zenith) * cos(azimuth));
  vec3 camera = vec3(0.0, PLANET_RADIUS + CAMERA_HEIGHT, 0.0);

  // Rays just below the edge can miss the planet by rounding; they end at
  // their lowest point.
  float landing = sphere(camera, dir, PLANET_RADIUS).x;
  float end = ground
    ? (landing > 0.0 ? landing : -dot(camera, dir))
    : sphere(camera, dir, TOP_RADIUS).y;
  float stride = end / float(VIEW_STEPS);
  float mu = dot(dir, SUN_DIR);
  float rayleighPhase = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = MIE_G * MIE_G;
  float miePhase = 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu)
    / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

  vec3 light = vec3(0.0);
  vec3 depth = vec3(0.0);
  for (int i = 0; i < VIEW_STEPS; i++) {
    vec3 point = camera + dir * (float(i) + 0.5) * stride;
    vec3 local = density(length(point) - PLANET_RADIUS);
    vec3 through = exp(-extinction(depth + local * stride * 0.5));
    depth += local * stride;
    vec3 scatter = RAYLEIGH * local.x * rayleighPhase + MIE * local.y * miePhase;
    light += through * sunlight(point) * scatter * stride;
  }
  vec3 through = exp(-extinction(depth));
  light *= SUN;
  if (ground) light += fromDisplay(${vec3(GROUND_COLOR)}) * through;

  // Film grade: matrix, saturation, teal lean of the blue sky, contrast.
  vec3 color = FILM_GRADE * toDisplay(light);
  color = clamp(mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, ${glsl(FILM_SATURATION)}), 0.0, 1.0);
  float cool = max(color.b - color.r, 0.0);
  color = clamp(color + cool * vec3(-${glsl(FILM_TEAL[0]!)}, ${glsl(FILM_TEAL[1]!)}, 0.0), 0.0, 1.0);
  color = pow(color, vec3(${glsl(FILM_GAMMA)}));
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float stars = ground ? 0.0 : dot(through, vec3(1.0 / 3.0)) * (1.0 - smoothstep(0.3, 0.8, brightness));
  outColor = vec4(color, stars);
}`;

const FRAGMENT_SHADER = `${SHARED}
uniform sampler2D u_sky;
uniform vec2 u_resolution;
uniform vec2 u_view;
uniform float u_pixelRatio;
uniform float u_time;
uniform uint u_frame;
uniform vec3 u_cursor;
uniform vec3 u_camera;
uniform vec2 u_offset;
uniform float u_glow;
uniform float u_starTurn;
uniform float u_flicker;
// Intro: picture gain (with the flash on top) and snow strength.
uniform vec2 u_power;

out vec4 outColor;

const float CAMERA_PITCH = ${glsl(CAMERA_PITCH * DEG)};
const float SUN_AZIMUTH = ${glsl(SUN_AZIMUTH * DEG)};
const vec3 STAR_POLE = ${vec3(starPole)};
const vec3 STAR_AXIS_A = ${vec3(starAxisA)};
const vec3 STAR_AXIS_B = ${vec3(starAxisB)};
const float STAR_CELL = ${glsl(STAR_CELL * DEG)};

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 random3(ivec3 seed) {
  return vec3(pcg3d(uvec3(seed))) / 4294967295.0;
}

float valueNoise(vec2 p, int seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = random3(ivec3(i, seed)).x;
  float b = random3(ivec3(i + ivec2(1, 0), seed)).x;
  float c = random3(ivec3(i + ivec2(0, 1), seed)).x;
  float d = random3(ivec3(i + ivec2(1, 1), seed)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 rotateView(vec3 v, float yaw, float pitch) {
  v.yz = vec2(v.y * cos(pitch) + v.z * sin(pitch), v.z * cos(pitch) - v.y * sin(pitch));
  v.xz = vec2(v.x * cos(yaw) + v.z * sin(yaw), v.z * cos(yaw) - v.x * sin(yaw));
  return v;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;

  vec2 toCursor = u_cursor.xy - fragCoord;
  float cursorDistance = length(toCursor) / u_pixelRatio;
  float nearCursor = u_cursor.z * (1.0 - smoothstep(0.0, ${glsl(CURSOR_RADIUS)}, cursorDistance));
  float pull = ${glsl(CURSOR_PULL)} * u_pixelRatio * nearCursor
    * smoothstep(0.0, ${glsl(CURSOR_RADIUS * 0.25)}, cursorDistance);
  vec2 pixel = fragCoord - toCursor / max(length(toCursor), 0.001) * pull;

  // Camera ray; u_view is the half extent of the view in tangent units.
  vec2 screen = pixel / u_resolution * 2.0 - 1.0;
  vec3 dir = rotateView(normalize(vec3(screen * u_view, 1.0)), u_camera.x, CAMERA_PITCH + u_camera.y);
  float pixelAngle = 2.0 * u_view.y / u_resolution.y;

  // The planet edge for the current camera height.
  float height = CAMERA_HEIGHT + u_camera.z;
  float beta = asin(PLANET_RADIUS / (PLANET_RADIUS + height));
  float horizon = PI - beta;
  float zenith = acos(clamp(dir.y, -1.0, 1.0));
  float azimuth = atan(dir.x, dir.z);

  // Slow shimmer of the air just over the edge.
  float overEdge = exp(-abs(zenith - horizon) / ${glsl(SHIMMER_HEIGHT * DEG)});
  zenith += ${glsl(SHIMMER * DEG)} * overEdge
    * (2.0 * valueNoise(vec2(azimuth * ${glsl(SHIMMER_SCALE)}, u_time * ${glsl(SHIMMER_SPEED)}), 3) - 1.0);

  // Sky and land from the lookup table, kept apart at the edge and blended
  // over EDGE_SOFTNESS (at least one pixel).
  float fromSun = abs(azimuth - SUN_AZIMUTH);
  float u = min(fromSun, 2.0 * PI - fromSun) / PI;
  float vSky = 0.5 - 0.5 * sqrt(max(0.0, 1.0 - zenith / horizon));
  float vLand = 0.5 + 0.5 * sqrt(max(0.0, (zenith - horizon) / beta));
  vec4 sky = texture(u_sky, vec2(u, clamp(vSky, SKY_HALF_TEXEL, 0.5 - SKY_HALF_TEXEL)));
  vec4 land = texture(u_sky, vec2(u, clamp(vLand, 0.5 + SKY_HALF_TEXEL, 1.0 - SKY_HALF_TEXEL)));
  // The land catches a faint rim of the glow just under the edge.
  vec3 edge = texture(u_sky, vec2(u, 0.5 - SKY_HALF_TEXEL)).rgb;
  float underEdge = max(zenith - horizon, 0.0) / ${glsl(RIM_WIDTH * DEG)};
  land.rgb = 1.0 - (1.0 - land.rgb) * (1.0 - ${glsl(RIM)} * edge.r * ${vec3(RIM_COLOR)} * exp(-underEdge));
  // Over the edge, glare of the bright limb spreads up into the sky.
  float overSky = max(horizon - zenith, 0.0) / ${glsl(HALO_WIDTH * DEG)};
  sky.rgb = 1.0 - (1.0 - sky.rgb) * (1.0 - ${glsl(HALO)} * edge * exp(-overSky));
  float softness = max(${glsl(EDGE_SOFTNESS * DEG)}, pixelAngle * 0.5);
  float landCover = smoothstep(-softness, softness, zenith - horizon);
  vec4 scene = mix(sky, land, landCover);
  vec3 color = scene.rgb;

  // The warm glow breathes.
  color *= 1.0 + u_glow * smoothstep(0.35, 0.9, dot(color, vec3(0.6, 0.3, 0.1)));

  // Thin high bands: noise on a shell high above, seen grazing near the edge.
  float elevation = horizon - zenith;
  if (elevation > 0.0) {
    vec3 camera = vec3(0.0, PLANET_RADIUS + height, 0.0);
    vec3 hit = camera + dir * sphere(camera, dir, PLANET_RADIUS + ${glsl(BAND_ALTITUDE)}).y;
    vec2 q = (hit.xz + u_offset) / vec2(${glsl(BAND_SCALE_X)}, ${glsl(BAND_SCALE_Z)});
    float n = 0.55 * valueNoise(q, 11) + 0.3 * valueNoise(q * 2.3, 12) + 0.15 * valueNoise(q * 5.1, 13);
    float band = smoothstep(${glsl(BAND_COVERAGE)}, 1.0, n)
      * exp(-elevation / ${glsl(BAND_HEIGHT * DEG)}) * smoothstep(0.0, ${glsl(0.4 * DEG)}, elevation)
      * max(cos(fromSun), 0.0);
    color = 1.0 - (1.0 - color) * (1.0 - ${glsl(BAND_STRENGTH)} * band * ${vec3(BAND_COLOR)});
  }

  // Stars on a latitude and longitude grid about STAR_POLE, at most one per cell.
  if (scene.a > 0.001) {
    float lat = asin(clamp(dot(dir, STAR_POLE), -1.0, 1.0));
    float lon = atan(dot(dir, STAR_AXIS_B), dot(dir, STAR_AXIS_A)) + u_starTurn;
    float row = floor(lat / STAR_CELL);
    float columns = floor(2.0 * PI * cos((row + 0.5) * STAR_CELL) / STAR_CELL);
    float lonCell = 2.0 * PI / columns;
    float column = floor(lon / lonCell);
    ivec3 cell = ivec3(int(row), int(mod(column, columns)), 5);
    vec3 pick = random3(cell);
    if (pick.x < ${glsl(STAR_DENSITY)}) {
      vec3 look = random3(cell + ivec3(0, 0, 4));
      vec2 center = vec2((column + 0.2 + 0.6 * pick.y) * lonCell, (row + 0.2 + 0.6 * pick.z) * STAR_CELL);
      float offCenter = length(vec2((lon - center.x) * cos(lat), lat - center.y)) / pixelAngle;
      float radius = mix(${glsl(STAR_RADIUS_MIN)}, ${glsl(STAR_RADIUS_MAX)}, look.x) * u_pixelRatio;
      float disc = clamp(radius + 0.5 - offCenter, 0.0, 1.0);
      float speed = mix(0.5, 1.4, look.z);
      float twinkle = 0.5 + 0.5 * sin(u_time * speed * (1.0 + 2.0 * nearCursor) + pick.x * 400.0);
      float depth = mix(${glsl(STAR_TWINKLE)}, ${glsl(STAR_TWINKLE_HOVER)}, nearCursor);
      float light = ${glsl(STAR_BRIGHTNESS)} * pow(look.y, ${glsl(STAR_FALLOFF)})
        * (1.0 - depth * twinkle) * (1.0 + ${glsl(STAR_HOVER_GAIN)} * nearCursor);
      color += disc * light * scene.a * mix(vec3(1.0, 0.88, 0.78), vec3(0.78, 0.86, 1.0), look.x);
    }
  }

  // Old TV: grain, scanlines, vignette, flicker, then dither to 8 bits.
  vec2 grainCell = floor(fragCoord / u_pixelRatio);
  vec3 random = vec3(pcg3d(uvec3(uvec2(grainCell), u_frame))) / 4294967295.0;
  float grain = random.x + random.y - 1.0;
  color += grain * (${glsl(GRAIN)} + ${glsl(CURSOR_GRAIN)} * nearCursor);

  float line = 0.5 + 0.5 * cos(2.0 * PI * fragCoord.y / (u_pixelRatio * ${glsl(SCANLINE_PERIOD)}));
  color *= 1.0 - ${glsl(SCANLINE_OPACITY)} * line * line * line;

  vec2 centered = fragCoord / u_resolution - 0.5;
  color *= 1.0 - ${glsl(VIGNETTE)} * smoothstep(0.3, 0.75, length(centered));

  color *= 1.0 + u_flicker;
  color = color * u_power.x + random.z * u_power.y;
  vec3 dither = random3(ivec3(ivec2(fragCoord), int(u_frame) + 7));
  color += (dither.x + dither.y - 1.0) / 255.0;
  outColor = vec4(color, 1.0);
}`;

interface Frame {
  time: number;
  frame: number;
  cursor: readonly number[];
  camera: readonly number[];
  offset: readonly number[];
  glow: number;
  starTurn: number;
  flicker: number;
  power: readonly number[];
}

interface Renderer {
  resize: (width: number, height: number, pixelRatio: number) => void;
  draw: (frame: Frame) => void;
}

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
};

const link = (gl: WebGL2RenderingContext, fragmentSource: string) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "a_position");
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
};

const createRenderer = (canvas: HTMLCanvasElement): Renderer | null => {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const skyProgram = link(gl, SKY_SHADER);
  const program = link(gl, FRAGMENT_SHADER);
  if (!skyProgram || !program) return null;

  // One triangle that covers the whole viewport.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // The sky does not change, so the lookup table is rendered once.
  const skyTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, skyTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    SKY_WIDTH,
    SKY_HEIGHT,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyTexture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
  gl.useProgram(skyProgram);
  gl.viewport(0, 0, SKY_WIDTH, SKY_HEIGHT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteProgram(skyProgram);

  gl.useProgram(program);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    resolution: uniform("u_resolution"),
    view: uniform("u_view"),
    pixelRatio: uniform("u_pixelRatio"),
    time: uniform("u_time"),
    frame: uniform("u_frame"),
    cursor: uniform("u_cursor"),
    camera: uniform("u_camera"),
    offset: uniform("u_offset"),
    glow: uniform("u_glow"),
    starTurn: uniform("u_starTurn"),
    flicker: uniform("u_flicker"),
    power: uniform("u_power"),
  };

  return {
    resize: (width, height, pixelRatio) => {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(u.resolution, width, height);
      gl.uniform1f(u.pixelRatio, pixelRatio);
      // Cover the photo's frame: crop its sides on narrow views, its top and
      // bottom on wide ones.
      const aspect = width / height;
      const halfWidth = Math.tan((FIELD_OF_VIEW / 2) * DEG);
      const halfHeight = aspect > FRAME_ASPECT ? halfWidth / aspect : halfWidth / FRAME_ASPECT;
      gl.uniform2f(u.view, halfHeight * aspect, halfHeight);
    },
    draw: (frame) => {
      gl.uniform1f(u.time, frame.time);
      gl.uniform1ui(u.frame, frame.frame);
      gl.uniform3f(u.cursor, frame.cursor[0]!, frame.cursor[1]!, frame.cursor[2]!);
      gl.uniform3f(u.camera, frame.camera[0]!, frame.camera[1]!, frame.camera[2]!);
      gl.uniform2f(u.offset, frame.offset[0]!, frame.offset[1]!);
      gl.uniform1f(u.glow, frame.glow);
      gl.uniform1f(u.starTurn, frame.starTurn);
      gl.uniform1f(u.flicker, frame.flicker);
      gl.uniform2f(u.power, frame.power[0]!, frame.power[1]!);
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

const wave = (time: number, period: number, phase = 0) =>
  Math.sin((2 * Math.PI * time) / period + phase);
const clamp = (value: number) => Math.min(1, Math.max(-1, value));
const smoothstep = (from: number, to: number, value: number) => {
  const x = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return x * x * (3 - 2 * x);
};

const readIntroSeen = () => {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
};
const markIntroSeen = () => {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // Storage can be unavailable (private modes); the intro then just replays.
  }
};

// Picture gain and snow at intro progress `t` (0..1).
const fullIntro = (t: number) => {
  const flash = INTRO_FLASH * Math.exp(-(((t - 0.84) / 0.05) ** 2));
  const gain = smoothstep(0.22, 0.8, t) + flash;
  const snow = INTRO_SNOW * smoothstep(0, 0.1, t) * (1 - smoothstep(0.45, 0.85, t));
  return [gain, snow];
};
const shortIntro = (t: number) => [smoothstep(0, 1, t), 0];

const mount = (root: HTMLElement) => {
  const canvas = root.querySelector("canvas");
  if (!canvas) return;

  let renderer: Renderer | null = null;
  let failed = false;
  let inView = false;
  let live = false;
  let frameRequest = 0;
  let lastFrame = 0;
  let time = 0;
  let frame = 0;
  let nextFlicker = FLICKER_GAP_MIN;
  let flickerEnd = 0;
  // Followed pointer position (viewport px) and strength of the noisy spot,
  // and the slower followed tilt toward it (-1..1 across the backdrop).
  const follow = { x: 0, y: 0, strength: 0 };
  const tilt = { x: 0, y: 0 };
  const cursor = [0, 0, 0];
  const camera = [0, 0, 0];
  const offset = [0, 0];
  // The page starts dark with the photo hidden (see HorizonBackdrop.astro);
  // the canvas plays the intro over it. A short intro on later pages, none if
  // the photo is already showing as a fallback.
  const booting = document.documentElement.classList.contains("horizon-boot");
  const introDuration = readIntroSeen() ? INTRO_SHORT : INTRO_DURATION;
  const intro = introDuration === INTRO_SHORT ? shortIntro : fullIntro;
  let introTime = booting ? 0 : introDuration;
  const fallback = () => root.classList.add("is-fallback");
  if (booting) {
    window.setTimeout(() => {
      if (!live) {
        fallback();
        introTime = introDuration;
      }
    }, FALLBACK_TIMEOUT * 1000);
  }

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

    const tiltEase = 1 - Math.exp(-dt / TILT_LAG);
    const aimX = clamp(((follow.x - rect.left) / Math.max(rect.width, 1)) * 2 - 1);
    const aimY = clamp(1 - ((follow.y - rect.top) / Math.max(rect.height, 1)) * 2);
    tilt.x += (aimX * follow.strength - tilt.x) * tiltEase;
    tilt.y += (aimY * follow.strength - tilt.y) * tiltEase;

    camera[0] = (DRIFT_YAW * wave(time, DRIFT_YAW_PERIOD) + TILT * tilt.x) * DEG;
    camera[1] = (DRIFT_PITCH * wave(time, DRIFT_PITCH_PERIOD, 1.3) + TILT * tilt.y) * DEG;
    camera[2] = DRIFT_HEIGHT * wave(time, DRIFT_HEIGHT_PERIOD, 0.4) + TILT_RISE * tilt.y;
    offset[0] = BAND_WIND[0]! * time + TILT_SHIFT * tilt.x;
    offset[1] = BAND_WIND[1]! * time;

    // The first frame is drawn with dt 0, so the intro starts from black.
    if (live) introTime = Math.min(introTime + dt, introDuration);
    const power = introTime >= introDuration ? [1, 0] : intro(introTime / introDuration);

    renderer.draw({
      power,
      time,
      frame,
      cursor,
      camera,
      offset,
      glow: GLOW_BREATH * (0.65 * wave(time, GLOW_PERIOD) + 0.35 * wave(time, GLOW_PERIOD_2, 2)),
      starTurn: (STAR_TURN * DEG * time) % (2 * Math.PI),
      flicker: flickerAt(time),
    });
    if (!live) {
      live = true;
      canvas.classList.add("is-live");
      markIntroSeen();
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
      renderer = createRenderer(canvas);
      failed = !renderer;
      resize();
    }
    const run = !failed && renderer && inView && !document.hidden && !reducedMotion.matches;
    if (run && !frameRequest) {
      lastFrame = performance.now();
      frameRequest = requestAnimationFrame(tick);
    } else if (!run && frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    canvas.classList.toggle("is-live", live && !failed && !reducedMotion.matches);
    if (failed || reducedMotion.matches) fallback();
  };

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
