/**
 * Procedural sky backdrop for the landing page (WebGL 1, no dependencies).
 *
 * Cloud shader adapted from Aceternity UI (ui.aceternity.com/components/cloud-shader):
 * asymmetric cloud envelopes filled with domain-warped billow noise and a
 * second density sample for self-shadowing. Ported to vanilla JS and extended
 * with two original scenes drawn on transparent canvases in front of the page
 * content: a grassy hill ("hill") and a rounded rock on grass ("rock").
 */

const VERT = 'attribute vec2 a_pos;varying vec2 v_uv;void main(){v_uv=a_pos*0.5+0.5;gl_Position=vec4(a_pos,0.0,1.0);}';

const COMMON = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 26737.367); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = R * p * 2.03 + 19.19; a *= 0.5; }
  return s;
}
`;

const SKY = `${COMMON}
uniform vec3 u_cloud;
uniform vec3 u_skyTop;
uniform vec3 u_skyBottom;
float billow(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * (1.0 - abs(2.0 * vnoise(p) - 1.0)); p = R * p * 2.11 + 13.37; a *= 0.5; }
  return s;
}
float cloudDensity(vec2 p, vec2 c, vec2 r, float seed, float t) {
  vec2 q = p - c;
  float ry = q.y > 0.0 ? r.y : r.y * 0.42;
  float env = 1.0 - length(vec2(q.x / r.x, q.y / ry));
  if (env < -0.35) return 0.0;
  vec2 dp = q * (2.4 / r.x) + seed;
  dp += 0.6 * vec2(fbm(dp * 1.4 + t * 0.04), fbm(dp * 1.4 + 7.7 - t * 0.03));
  return env + (billow(dp * 1.6) - 0.62) * 0.62;
}
vec3 shadeCloud(vec3 color, vec3 sky, vec2 p, vec2 c, vec2 r, float seed, float t, float dist) {
  float d = cloudDensity(p, c, r, seed, t);
  if (d < 0.02) return color;
  float dUp = cloudDensity(p + vec2(0.0, r.y * 0.55), c, r, seed, t);
  float occl = clamp((dUp - d) * 1.1 + d * 0.55, 0.0, 1.0);
  vec3 cloudCol = mix(u_cloud * 1.03, mix(u_cloud * 0.72, sky, 0.45), occl * 0.7);
  float alpha = smoothstep(0.02, 0.45, d) * 0.82;
  cloudCol += smoothstep(0.02, 0.14, d) * (1.0 - smoothstep(0.14, 0.40, d)) * 0.08;
  cloudCol = mix(cloudCol, sky, dist * 0.45);
  alpha *= mix(1.0, 0.7, dist);
  return mix(color, cloudCol, alpha);
}
vec3 cloudPass(vec3 color, vec3 sky, vec2 p, float aspect, float t, float spd, float phase, float y, vec2 r, float seed, float dist) {
  float cx = mix(-r.x - 0.25, aspect + r.x + 0.25, fract(t * spd + phase));
  float cy = y + sin(t * 0.05 + phase * 6.2831) * 0.012;
  return shadeCloud(color, sky, p, vec2(cx, cy), r, seed, t, dist);
}
void main() {
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  float t = u_time;
  vec3 sky = mix(u_skyBottom, u_skyTop, smoothstep(0.0, 1.0, v_uv.y));
  vec3 color = sky;
  color = mix(color, u_skyBottom * 1.04, smoothstep(0.45, 0.0, v_uv.y) * 0.55);
  float sunDist = length(p - vec2(aspect * 0.78, 0.92));
  color += vec3(1.0, 0.96, 0.86) * exp(-sunDist * sunDist * 5.0) * 0.16;
  float band = smoothstep(0.5, 0.78, v_uv.y) * (1.0 - smoothstep(0.92, 1.0, v_uv.y));
  if (band > 0.01) {
    float wisp = smoothstep(0.5, 0.8, fbm(vec2(p.x * 1.6 - t * 0.006, p.y * 12.0))) * band;
    color = mix(color, u_cloud, wisp * 0.32);
  }
  color = cloudPass(color, sky, p, aspect, t, 0.006, 0.10, 0.84, vec2(0.20, 0.10), 43.7, 1.0);
  color = cloudPass(color, sky, p, aspect, t, 0.008, 0.62, 0.73, vec2(0.24, 0.12), 71.3, 0.85);
  color = cloudPass(color, sky, p, aspect, t, 0.011, 0.33, 0.60, vec2(0.34, 0.16), 17.3, 0.55);
  color = cloudPass(color, sky, p, aspect, t, 0.013, 0.80, 0.47, vec2(0.30, 0.15), 29.9, 0.45);
  color = cloudPass(color, sky, p, aspect, t, 0.016, 0.05, 0.35, vec2(0.46, 0.20), 91.1, 0.15);
  color = cloudPass(color, sky, p, aspect, t, 0.020, 0.48, 0.20, vec2(0.56, 0.24), 57.2, 0.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

// Original: layered grass blades (back to front) with swaying tips, returned premultiplied.
const GRASS = `${COMMON}
vec4 grass(vec2 px, float base, float t, float seed) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float sc = 0.8 + fi * 0.35;
    float lb = base - fi * 11.0;
    float bend = clamp((px.y - lb + 10.0) / 30.0, 0.0, 1.0);
    float lean = (vnoise(vec2(px.x * 0.09, fi + seed)) - 0.5) * (px.y - lb) * 0.55;
    float xs = px.x + (sin(t * 0.9 + px.x * 0.01 + fi * 1.9) * (1.0 + fi * 0.6) + lean) * bend;
    float f = 0.55 / sc;
    float n1 = vnoise(vec2(xs * f + seed + fi * 31.0, fi * 7.0));
    float n3 = vnoise(vec2(xs * f * 2.3 + seed + fi * 11.0, fi * 2.0));
    float n2 = vnoise(vec2(xs * 0.05 / sc + seed * 1.7 + fi * 13.0, fi * 3.0));
    float tall = pow(n1, 1.8) * 0.7 + pow(n3, 2.0) * 0.3;
    float edge = lb + tall * 20.0 * sc + n2 * 14.0;
    float cover = clamp(edge - px.y + 0.5, 0.0, 1.0);
    if (cover <= 0.0) continue;
    float depth = clamp((edge - px.y) / (40.0 * sc), 0.0, 1.0);
    float streak = vnoise(vec2(xs * f * 1.7 + fi * 5.0, px.y * 0.03 / sc));
    float patch = fbm(px * 0.006 + vec2(fi * 3.1 + seed, 1.3));
    vec3 col = mix(vec3(0.84, 0.9, 0.6), vec3(0.6, 0.77, 0.37), smoothstep(0.0, 0.3, depth));
    col = mix(col, vec3(0.42, 0.62, 0.26), smoothstep(0.3, 1.0, depth) * 0.6);
    col *= (0.74 + 0.4 * tall) * (0.86 + 0.24 * streak) * (0.88 + 0.24 * patch) * (0.86 + 0.2 * n2);
    col = mix(col, vec3(0.82, 0.88, 0.84), (3.0 - fi) * 0.05);
    acc = acc * (1.0 - cover) + vec4(col, 1.0) * cover;
  }
  return acc;
}
`;

const HILL = `${GRASS}
void main() {
  vec2 px = gl_FragCoord.xy / u_dpr;
  float h = u_res.y / u_dpr;
  float x = v_uv.x;
  float k = clamp(u_res.x / u_res.y / 1.6, 0.5, 1.0); // gentler slope on tall, narrow screens
  float base = h * (0.045 + 0.2 * pow(x, 1.5)) * k + 22.0 * (fbm(vec2(x * 2.2, 4.2)) - 0.5);
  if (px.y > base + 48.0) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = grass(px, base, u_time, 0.0);
}
`;

const ROCK = `${GRASS}
float rockD(vec2 q, vec2 r) {
  q.y -= q.x * 0.07;
  float ry = q.y > 0.0 ? r.y : r.y * 0.7;
  vec2 k = abs(vec2(q.x / r.x, q.y / ry));
  float d = pow(pow(k.x, 3.2) + pow(k.y, 2.6), 1.0 / 2.9);
  return d + (fbm(q * vec2(4.0, 8.0) + 3.0) - 0.5) * 0.24;
}
float rockZ(vec2 q, vec2 r) {
  float d = rockD(q, r);
  return sqrt(max(0.0, 1.0 - d * d)) * r.y + (fbm(q * vec2(16.0, 24.0)) - 0.5) * 0.014;
}
void main() {
  vec2 px = gl_FragCoord.xy / u_dpr;
  vec2 size = u_res / u_dpr;
  float aspect = size.x / size.y;
  vec2 p = vec2(v_uv.x * aspect, v_uv.y);
  vec2 r = vec2(0.46 * aspect, 0.15);
  vec2 q = p - vec2(0.66 * aspect, 0.2);
  vec4 col = vec4(0.0);
  float d = rockD(q, r);
  if (d < 1.02) {
    float e = 1.5 / size.y;
    float z = rockZ(q, r);
    vec3 n = normalize(vec3((z - rockZ(q + vec2(e, 0.0), r)) / e, (z - rockZ(q + vec2(0.0, e), r)) / e, 1.0));
    float tex = fbm(q * vec2(5.0, 32.0) + 11.0) * 0.6 + fbm(q * 20.0) * 0.4;
    vec3 alb = mix(vec3(0.56, 0.56, 0.53), vec3(0.9, 0.89, 0.85), tex);
    float cr = 1.0 - abs(2.0 * fbm(q * vec2(5.0, 12.0) + 2.0) - 1.0);
    alb *= 1.0 - smoothstep(0.95, 0.995, cr) * 0.18;
    alb = mix(alb, vec3(0.72, 0.73, 0.6), smoothstep(0.6, 0.74, fbm(q * 26.0 + 5.0)) * 0.45);
    float dif = clamp(dot(n, normalize(vec3(-0.35, 0.8, 0.55))), 0.0, 1.0);
    vec3 rc = alb * (0.48 + 0.62 * dif) + vec3(0.85, 0.92, 1.0) * pow(max(n.y, 0.0), 3.0) * 0.07;
    rc = mix(rc, rc * 0.7, smoothstep(0.0, -r.y * 0.7, q.y));
    float a = smoothstep(1.0, 0.975, d);
    col = vec4(rc * a, a);
  }
  float base = size.y * (0.1 + 0.03 * v_uv.x) + 14.0 * (fbm(vec2(v_uv.x * 3.0, 1.0)) - 0.5);
  if (px.y < base + 48.0) {
    vec4 g = grass(px, base, u_time, 7.0);
    float sh = 1.0 - smoothstep(0.0, 1.0, length(vec2(q.x / (r.x * 1.02), (q.y + r.y * 0.85) / (r.y * 0.55))));
    g.rgb *= 1.0 - sh * 0.4;
    col = g + col * (1.0 - g.a);
  }
  gl_FragColor = col;
}
`;

const SOURCES = { sky: SKY, hill: HILL, rock: ROCK };

/** Parses `#rgb` or `#rrggbb` into 0..1 floats. */
export function parseColor(hex) {
  const v = hex.length === 4 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

/**
 * Renders a scene into `canvas`. Returns `destroy()`. Falls back to the
 * element's CSS background (class `is-fallback`) when WebGL is unavailable.
 */
export function mountClouds(canvas, options = {}) {
  const scene = SOURCES[options.scene] ? options.scene : 'sky';
  const opts = {
    speed: 1,
    cloudColor: '#fbfbf8',
    skyTopColor: '#7fb0dc',
    skyBottomColor: '#dfeaf3',
    reducedMotion: false,
    maxDpr: 1.5,
    resolution: scene === 'sky' ? 0.5 : 1,
    fps: 30,
    timeOffset: 24,
    ...options,
  };
  const fail = () => {
    canvas.classList.add('is-fallback');
    return () => {};
  };

  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: scene !== 'sky', antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  } catch {
    gl = null;
  }
  if (!gl) return fail();

  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, SOURCES[scene]);
  const program = vert && frag ? gl.createProgram() : null;
  if (!program) return fail();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail();
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const loc = (name) => gl.getUniformLocation(program, name);
  const uRes = loc('u_res');
  const uTime = loc('u_time');
  const uDpr = loc('u_dpr');
  if (scene === 'sky') {
    gl.uniform3fv(loc('u_cloud'), parseColor(opts.cloudColor));
    gl.uniform3fv(loc('u_skyTop'), parseColor(opts.skyTopColor));
    gl.uniform3fv(loc('u_skyBottom'), parseColor(opts.skyBottomColor));
  }

  let elapsed = opts.timeOffset;
  let frame = 0;
  let last = 0;
  let visible = true;

  const draw = () => {
    gl.uniform1f(uTime, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr) * opts.resolution;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uDpr, w / Math.max(1, canvas.clientWidth));
    draw();
  };

  const canRun = () => visible && !document.hidden && !opts.reducedMotion;
  const tick = (now) => {
    frame = 0;
    if (!canRun()) return;
    const dt = Math.min(now - last, 100);
    if (dt >= 1000 / opts.fps - 2) {
      elapsed += (dt / 1000) * opts.speed;
      last = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (frame || !canRun()) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const resizer = new ResizeObserver(resize);
  resizer.observe(canvas);
  const viewport = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    start();
  });
  viewport.observe(canvas);
  const onVisibility = () => start();
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    canvas.classList.add('is-fallback');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  resize();
  canvas.classList.add('is-live');
  start();

  return () => {
    cancelAnimationFrame(frame);
    frame = 0;
    visible = false;
    resizer.disconnect();
    viewport.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onLost);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
  };
}
