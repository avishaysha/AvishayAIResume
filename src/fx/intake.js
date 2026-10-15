// Package `intake`: the hero's chaos-to-order field (spec/intake.md).
// The visitor's mess goes in, a running system comes out, and there is a person at the centre.
//
// - A hero-scoped WebGL2 points field (one program, one static VBO, drawArrays(POINTS)) in hero-local
//   CSS px, so it scrolls natively with the DOM. Raw blue-white specks drift; on power-on an order
//   front expands from the portrait and captured specks spiral into three lime lanes that circulate
//   clockwise around the card (the bottom edge flows right to left); a trickle peels off at the output
//   port toward the rail. Scrolling settles the field (calmer chaos, more capture).
// - Order brush: pointer trail, touch ring + drag wake, and an idle ghost brush (no instruction text).
//   Brushed raw specks snap onto concentric rounded-rect contours around the card and turn lime.
// - Attractor: raw specks lean toward the WhatsApp CTA while it is hovered or focused (spring).
// - Plate power-on: the lime plate goes from a dashed "idea" outline to solid, wiping out from the
//   input port; then the order front runs (uPower 0 -> 1 over 1.4s).
// - Input chips: idle drift (CSS) and a reversible scroll-scrubbed ingest along the card's edge into
//   the input port (never across the face); each landing flashes the port.
// Loop gating: renders only while the hero intersects the viewport, the tab is visible and the page is
// not paused; otherwise the last frame stays and the loop sleeps. No layout reads per frame.
// Fallback: no WebGL2 or a lost context -> html.intake-static (foundation's static lane + crossed chips).
// Reduced motion: init() returns before doing anything; the foundation's static hero is the result.
import '../styles/intake.css'
import { animateMini, scroll, cubicBezier } from 'motion'
import { motionOk, tier } from '../core/env.js'
import { isPaused, onPause } from '../core/state.js'
import { onArrive, flowState, EVT } from '../core/flow.js'
import { onRefresh } from '../core/refresh.js'

const root = document.documentElement

const TIERS = {
  high: { count: 9000, dpr: 1.75 },
  mid: { count: 4000, dpr: 1.5 },
  low: { count: 1800, dpr: 1 },
}
const CARD_R = 28
const LANES_WIDE = [7, 12, 17] // the card -> rail gap is 28px on desktop: the outer lane keeps 11px clear of the rail
const LANES_STACKED = [6, 11, 16] // < 1024px
const POWER_S = 1.4
const BRUSH_N = 12
const RING_N = 3
const MASK_N = 6
const BRUSH_LIFE = 1.4
const RING_LIFE = 0.9
const GHOST_AFTER = 4
const FADE_S = 1.1 // the field fades in over its first second of running
const GROUPS = 40 // capture thresholds are bucketed, so no speck ever rests half-way between raw and lane
const GROUP_S = 0.8 // seconds for a group to join (or leave) the lanes
const MAX_BACKING = 4.6e6 // device px cap for the canvas backing store on very large screens

const easePower = cubicBezier(0.22, 1, 0.36, 1) // --ease-out
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t

// ---------------------------------------------------------------------------------------------
// Shaders. All positions are hero-local CSS px; uDpr converts point sizes to device px.
const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeed;
layout(location = 1) in float aLane; // lane index + fract = capture threshold
uniform float uTime, uDpr, uCardR, uPower, uSettle, uMaxDist, uFade;
uniform float uGroup[${GROUPS}]; // capture groups: 0 = raw, 1 = on a lane (eased in JS over time)
uniform vec2 uRes;
uniform vec4 uCard;      // centre x, centre y, half w, half h
uniform vec3 uLaneOff;
uniform vec4 uMask[${MASK_N}];  // x0, y0, x1, y1 (padded hero-text rects)
uniform vec4 uBrush[${BRUSH_N}]; // x, y, age, radius (radius 0 = off)
uniform vec3 uRing[${RING_N}];   // x, y, age
uniform vec3 uAttract;   // x, y, strength
uniform vec3 uExit;      // y, run length, on
out vec4 vCol;
out float vSize;

const float PI = 3.141592653589793;
const vec3 RAW_A = vec3(0.616, 0.733, 1.0);   // #9DBBFF
const vec3 RAW_B = vec3(0.953, 0.949, 0.933); // #F3F2EE
const vec3 LIME  = vec3(0.784, 0.941, 0.192); // #C8F031
const vec3 CORE  = vec3(0.894, 1.0, 0.478);   // #E4FF7A

float perim(vec2 h, float R) { return 4.0 * (h.x - R) + 4.0 * (h.y - R) + 2.0 * PI * R; }

// arc length s -> point on a rounded rect, clockwise on screen (y down) from the top edge's left end
vec2 contour(float s, vec2 c, vec2 h, float R) {
  float lx = 2.0 * (h.x - R), ly = 2.0 * (h.y - R), q = 0.5 * PI * R;
  if (s < lx) return vec2(c.x - h.x + R + s, c.y - h.y);
  s -= lx;
  if (s < q) { float a = -0.5 * PI + s / R; return vec2(c.x + h.x - R, c.y - h.y + R) + R * vec2(cos(a), sin(a)); }
  s -= q;
  if (s < ly) return vec2(c.x + h.x, c.y - h.y + R + s);
  s -= ly;
  if (s < q) { float a = s / R; return vec2(c.x + h.x - R, c.y + h.y - R) + R * vec2(cos(a), sin(a)); }
  s -= q;
  if (s < lx) return vec2(c.x + h.x - R - s, c.y + h.y);
  s -= lx;
  if (s < q) { float a = 0.5 * PI + s / R; return vec2(c.x - h.x + R, c.y + h.y - R) + R * vec2(cos(a), sin(a)); }
  s -= q;
  if (s < ly) return vec2(c.x - h.x, c.y + h.y - R - s);
  s -= ly;
  float a = PI + s / R;
  return vec2(c.x - h.x + R, c.y - h.y + R) + R * vec2(cos(a), sin(a));
}

// 1 inside any padded hero-text rect (soft 6px edge), else 0
float textMask(vec2 p) {
  float m = 0.0;
  for (int i = 0; i < ${MASK_N}; i++) {
    vec4 r = uMask[i];
    vec2 dd = max(r.xy - p, p - r.zw);
    m = max(m, 1.0 - smoothstep(-6.0, 6.0, max(dd.x, dd.y)));
  }
  return m;
}

// order brush strength at a point: pointer/ghost trail (gaussian, fading over its life) + touch rings
float brushAt(vec2 q) {
  float o = 0.0;
  for (int i = 0; i < ${BRUSH_N}; i++) {
    vec4 b = uBrush[i];
    if (b.w <= 0.0) continue;
    vec2 d = q - b.xy;
    o = max(o, exp(-dot(d, d) / (b.w * b.w)) * max(0.0, 1.0 - b.z / ${BRUSH_LIFE.toFixed(2)}));
  }
  for (int i = 0; i < ${RING_N}; i++) {
    vec3 r = uRing[i];
    if (r.z >= ${RING_LIFE.toFixed(2)}) continue;
    float d = abs(distance(q, r.xy) - r.z * 700.0);
    o = max(o, (1.0 - smoothstep(0.0, 60.0, d)) * (1.0 - r.z / ${RING_LIFE.toFixed(2)}));
  }
  return o;
}

float sdRBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec2 gradRBox(vec2 p, vec2 b, float r) {
  vec2 sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  vec2 q = abs(p) - b + r;
  if (q.x > 0.0 && q.y > 0.0) return sg * normalize(q);
  return q.x > q.y ? vec2(sg.x, 0.0) : vec2(0.0, sg.y);
}

void main() {
  vec4 sd = aSeed;
  float lane = floor(aLane);
  float capT = fract(aLane);
  float t = uTime;
  vec2 c = uCard.xy;

  // ---- chaos: wrapped drift over the hero plus a 3-sine flow displacement
  float amp = mix(70.0, 18.0, uSettle);
  vec2 M = vec2(90.0);
  vec2 span = uRes + 2.0 * M;
  vec2 vel = vec2((sd.z - 0.5) * 16.0 - 4.0, (sd.w - 0.5) * 11.0); // a faint right-to-left bias
  vec2 p = mod(sd.xy * span + vel * t, span) - M;
  vec2 n = vec2(
    sin(p.y * 0.0105 + t * 0.31 + sd.z * 6.2832) + 0.6 * sin((p.x + p.y) * 0.0062 - t * 0.23) + 0.35 * sin(p.x * 0.017 + t * 0.47 + sd.w * 4.0),
    sin(p.x * 0.0093 - t * 0.27 + sd.w * 6.2832) + 0.6 * sin((p.x - p.y) * 0.0071 + t * 0.21) + 0.35 * sin(p.y * 0.015 - t * 0.41 + sd.z * 4.0));
  vec2 chaos = p + n * (amp / 1.95);

  // attractor: raw specks within 220px of the CTA lean up to 40px toward it
  vec2 toA = uAttract.xy - chaos;
  float dA = length(toA);
  float pull = uAttract.z * 40.0 * (1.0 - smoothstep(40.0, 220.0, dA));
  chaos += toA / max(dA, 1.0) * min(pull, dA * 0.6);

  // ---- lane target: arc-length position on a rounded rect around the card
  float off = lane < 0.5 ? uLaneOff.x : (lane < 1.5 ? uLaneOff.y : uLaneOff.z);
  vec2 h = uCard.zw + off;
  float R = uCardR + off;
  float P = perim(h, R);
  float spdN = 0.035 + 0.01 * lane;
  float spd = spdN * (0.95 + 0.1 * sd.z);
  float u = fract(sd.x * 7.31 + sd.y * 3.17 + t * spd);
  vec2 laneP = contour(u * P, c, h, R);
  laneP += gradRBox(laneP - c, h, R) * (sd.w - 0.5) * 1.2;
  // packets: a brightness pattern that travels with the lane, so the circulation reads
  float nPk = lane < 0.5 ? 7.0 : (lane < 1.5 ? 5.0 : 9.0);
  float ph = fract((u - t * spdN) * nPk + lane * 0.37);
  float laneB = mix(0.2, 1.0, smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.3, 0.62, ph)));
  laneB *= lane < 0.5 ? 1.0 : (lane < 1.5 ? 0.78 : 0.58);
  float isCore = 0.0;
  // exit trickle: some lane-0 specks peel off at the output port and run left toward the rail
  if (lane < 0.5 && sd.w > 0.85 && uExit.z > 0.5) {
    float sL = 4.0 * (h.x - R) + 2.0 * (h.y - R) + 1.5 * PI * R; // start of the left edge (going up)
    float uE = (sL + (c.y + h.y - R - uExit.x)) / P;
    float wRun = max(uExit.y, 1.0) / P;
    float k = fract(u - uE);
    if (k < wRun) {
      float r = k / wRun;
      laneP = vec2(c.x - h.x - r * uExit.y, uExit.x + (sd.w - 0.925) * 14.0 * r);
      laneB = 1.25 * (1.0 - r * r);
      isCore = 1.0;
    } else {
      laneB *= clamp((k - wRun) / 0.03, 0.0, 1.0);
    }
  }

  // ---- global order: expands outward from the person as the plate powers on
  float cap = uGroup[int(min(capT * ${GROUPS}.0, ${GROUPS - 1}.0))];
  float band = 380.0;
  float front = uPower * (uMaxDist + band);
  float oG = cap * (1.0 - smoothstep(front - band, front, distance(chaos, c)));

  // ---- brush order (pointer trail, touch rings, ghost)
  float oB = brushAt(chaos);
  // the same brush makes the lanes it crosses flare (visible even where the copy leaves no room)
  float flare = brushAt(laneP) * 0.85;
  laneB = max(laneB, flare);
  // brushed specks snap to the nearest concentric rounded-rect contour (14px steps, outside the lanes).
  // Never under the hero copy: snapping concentrates specks, and lime there would cost contrast.
  vec2 pc = chaos - c;
  float dist = sdRBox(pc, uCard.zw, uCardR);
  // Only raw (uncaptured) specks are brushed: lane specks keep circulating.
  oB *= smoothstep(uLaneOff.z, uLaneOff.z + 16.0, dist) * (1.0 - textMask(chaos)) * (1.0 - oG);
  float qd = max(floor(dist / 14.0 + 0.5) * 14.0, uLaneOff.z + 14.0);
  vec2 ctr = chaos - gradRBox(pc, uCard.zw, uCardR) * (dist - qd);

  float w = oG / max(oG + oB, 1e-4);
  vec2 target = mix(ctr, laneP, w);
  float o = max(oG, oB);
  float e = o < 0.5 ? 4.0 * o * o * o : 1.0 - pow(-2.0 * o + 2.0, 3.0) * 0.5;
  vec2 dv = target - chaos;
  vec2 pos = chaos + dv * e + vec2(-dv.y, dv.x) * sin(PI * e) * 0.25;

  // ---- colour, alpha, size
  // the hero copy is a quiet zone: anything not resting on a lane (lanes hug the card, never the copy)
  // stays raw and nearly dark there, so the text keeps its contrast (lead >= 7:1)
  float onLane = w * oG;
  float resting = onLane * smoothstep(0.96, 1.0, oG);
  float quiet = textMask(pos) * (1.0 - resting);
  vec3 raw = mix(RAW_A, RAW_B, sd.z);
  float rawA = 0.5 * (0.42 + 0.58 * fract(sd.w * 13.7 + sd.z * 3.1));
  float ol = o * (1.0 - quiet);
  // colour turns lime early in the transition, so the size flash below reads as a lime spark, not olive
  vec3 col = mix(raw, mix(LIME, CORE, max(isCore, flare) * onLane), smoothstep(0.0, 0.42, ol));
  float a = mix(rawA, 0.95 * mix(1.0, laneB, w), ol);
  float edges = smoothstep(0.0, 36.0, pos.x) * smoothstep(0.0, 36.0, uRes.x - pos.x)
              * (1.0 - smoothstep(uRes.y - 160.0, uRes.y - 12.0, pos.y));
  a *= mix(1.0, edges, 1.0 - resting) * mix(1.0, 0.08, quiet);
  a *= uFade;

  float flash = 1.0 + 1.2 * smoothstep(0.4, 0.5, ol) * (1.0 - smoothstep(0.56, 0.66, ol));
  float size = mix(1.3, 2.1, ol) * flash * (1.0 + 0.5 * flare * onLane) * uDpr;
  // never rasterise below 2 device px (sub-pixel points twinkle); dim the enlarged ones to match
  float drawn = max(size, 2.0);
  a *= size / drawn;
  vSize = drawn;
  vCol = vec4(col, a);
  vec2 cl = pos / uRes * 2.0 - 1.0;
  bool hide = a < 0.003;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(cl.x, -cl.y, 0.0, 1.0);
  gl_PointSize = hide ? 0.0 : drawn;
}`

const FRAG = `#version 300 es
precision mediump float;
in vec4 vCol;
in float vSize;
out vec4 frag;
void main() {
  // an anti-aliased disc: coverage falls off over the last device pixel of the radius
  float r = length(gl_PointCoord - 0.5) * vSize;
  float a = vCol.a * clamp(vSize * 0.5 - r + 0.5, 0.0, 1.0);
  if (a < 0.003) discard;
  frag = vec4(vCol.rgb * a, a); // premultiplied, additive
}`

const UNIFORMS = ['uTime', 'uDpr', 'uCardR', 'uPower', 'uGroup', 'uSettle', 'uMaxDist', 'uFade', 'uRes',
  'uCard', 'uLaneOff', 'uMask', 'uBrush', 'uRing', 'uAttract', 'uExit']

// deterministic seeds (mulberry32): the same field on every load
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildSeeds(count) {
  const r = rng(0x1043)
  const data = new Float32Array(count * 5)
  for (let i = 0; i < count; i++) {
    const o = i * 5
    data[o] = r(); data[o + 1] = r(); data[o + 2] = r(); data[o + 3] = r()
    const l = r()
    const lane = l < 0.44 ? 0 : l < 0.76 ? 1 : 2 // the inner lane is the busiest
    data[o + 4] = lane + 0.06 + 0.93 * r()      // capture threshold in [.06, .99)
  }
  return data
}

// Compiling is split in two so the link can finish off the main thread (KHR_parallel_shader_compile):
// startCompile() only queues the work; finishCompile() reads the status and builds the buffers.
function startCompile(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()
  const vs = sh(gl.VERTEX_SHADER, VERT)
  const fs = sh(gl.FRAGMENT_SHADER, FRAG)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  return { prog, vs, fs, ext: gl.getExtension('KHR_parallel_shader_compile') }
}
const compileDone = (gl, job) => !job.ext || gl.getProgramParameter(job.prog, job.ext.COMPLETION_STATUS_KHR)

function finishCompile(gl, job, count) {
  const { prog, vs, fs } = job
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error('intake shaders: ' + (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || '') + gl.getProgramInfoLog(prog))
  }
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, buildSeeds(count), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16)
  gl.useProgram(prog)
  const u = {}
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name)
  gl.disable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  gl.clearColor(0, 0, 0, 0)
  return { prog, vao, vbo, u }
}

// ---------------------------------------------------------------------------------------------
// Rounded-rect contour helpers (JS mirror of the shader's, for the chip paths)
function makeContour(x, y, w, h, R) {
  const hx = w / 2, hy = h / 2, cx = x + hx, cy = y + hy
  const lx = 2 * (hx - R), ly = 2 * (hy - R), q = (Math.PI / 2) * R
  const S = [0, lx, lx + q, lx + q + ly, lx + 2 * q + ly, 2 * lx + 2 * q + ly, 2 * lx + 3 * q + ly, 2 * lx + 3 * q + 2 * ly]
  const P = 2 * lx + 2 * ly + 4 * q
  const corner = (ccx, ccy, a) => ({ x: ccx + R * Math.cos(a), y: ccy + R * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) })
  function at(s) {
    s = ((s % P) + P) % P
    if (s < S[1]) return { x: cx - hx + R + s, y: cy - hy, nx: 0, ny: -1 }
    if (s < S[2]) return corner(cx + hx - R, cy - hy + R, -Math.PI / 2 + (s - S[1]) / R)
    if (s < S[3]) return { x: cx + hx, y: cy - hy + R + (s - S[2]), nx: 1, ny: 0 }
    if (s < S[4]) return corner(cx + hx - R, cy + hy - R, (s - S[3]) / R)
    if (s < S[5]) return { x: cx + hx - R - (s - S[4]), y: cy + hy, nx: 0, ny: 1 }
    if (s < S[6]) return corner(cx - hx + R, cy + hy - R, Math.PI / 2 + (s - S[5]) / R)
    if (s < S[7]) return { x: cx - hx, y: cy + hy - R - (s - S[6]), nx: -1, ny: 0 }
    return corner(cx - hx + R, cy - hy + R, Math.PI + (s - S[7]) / R)
  }
  // nearest arc length for a point
  function project(px, py) {
    const dx = px - cx, dy = py - cy
    const qx = Math.abs(dx) - hx + R, qy = Math.abs(dy) - hy + R
    if (qx > 0 && qy > 0) {
      const ccx = cx + Math.sign(dx) * (hx - R), ccy = cy + Math.sign(dy) * (hy - R)
      const a = Math.atan2(py - ccy, px - ccx)
      if (dx > 0 && dy < 0) return S[1] + (a + Math.PI / 2) * R
      if (dx > 0 && dy > 0) return S[3] + a * R
      if (dx < 0 && dy > 0) return S[5] + (a - Math.PI / 2) * R
      return S[7] + (((a + 2 * Math.PI) % (2 * Math.PI)) - Math.PI) * R
    }
    if (qx > qy) {
      const yy = clamp(dy, -(hy - R), hy - R)
      return dx > 0 ? S[2] + (yy + hy - R) : S[6] + (hy - R - yy)
    }
    const xx = clamp(dx, -(hx - R), hx - R)
    return dy < 0 ? S[0] + (xx + hx - R) : S[4] + (hx - R - xx)
  }
  return { at, project, P, cx, cy }
}

// The tight box of what is actually painted in a text block: text runs (via ranges) and inline-level or
// flex-item boxes, not the block's full width. Right-aligned (RTL) lines leave their left side free.
function contentRect(el) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  const add = (rc) => {
    if (!rc.width || !rc.height) return
    l = Math.min(l, rc.left); t = Math.min(t, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom)
  }
  const range = document.createRange()
  const walk = (n, inFlex) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        if (!c.data.trim()) continue
        range.selectNodeContents(c)
        for (const rc of range.getClientRects()) add(rc)
      } else if (c.nodeType === 1 && !c.classList.contains('sr-only')) {
        const d = getComputedStyle(c).display
        if (d === 'none') continue
        if (inFlex || !/^(block|flex|grid|contents|list-item|flow-root)$/.test(d)) add(c.getBoundingClientRect())
        else walk(c, /flex|grid/.test(d))
      }
    }
  }
  walk(el, /flex|grid/.test(getComputedStyle(el).display))
  if (l === Infinity) {
    const rc = el.getBoundingClientRect()
    return rc.width && rc.height ? { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom } : null
  }
  return { left: l, top: t, right: r, bottom: b }
}

// ---------------------------------------------------------------------------------------------
export function init() {
  if (!motionOk) return
  const hero = document.querySelector('[data-hero]')
  const node = hero && hero.querySelector('[data-node="portrait"]')
  const img = node && node.querySelector('img')
  if (!hero || !node || !img) return
  root.classList.add('fx-intake')

  const canvas = hero.querySelector('[data-intake-canvas]')
  const plate = node.querySelector('.node__plate')
  const chipList = hero.querySelector('[data-intake-chips]')
  const chips = chipList ? [...chipList.querySelectorAll('.intake__chip')] : []
  const period = hero.querySelector('[data-period]')
  const cta = hero.querySelector('[data-attract]')
  const texts = [...hero.querySelectorAll('[data-hero-text]')].slice(0, MASK_N)
  const mqStacked = window.matchMedia('(max-width: 1023px)')

  // ---------------- state ----------------
  let tierName = tier()
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get('intake-tier')
    if (q && TIERS[q]) tierName = q
  }
  const T = TIERS[tierName] || TIERS.mid
  let dprCap = T.dpr
  let drawCount = T.count
  let gl = null
  let glr = null // { prog, vao, vbo, u }
  let glOk = false
  let lost = false

  const geo = {
    ready: false, heroTop: 0, heroLeft: 0, w: 1, h: 1, dpr: 1,
    card: { x: 0, y: 0, w: 1, h: 1 }, port: { x: 0, y: 0, edge: 'right' },
    maxDist: 1, exitY: 0, exitLen: 0, railX: 12, stacked: mqStacked.matches,
    cta: { x: -1e5, y: -1e5 }, navH: 0,
  }
  const masks = new Float32Array(MASK_N * 4).fill(-1e5)
  const brush = new Float32Array(BRUSH_N * 4) // x, y, t0 (sim s), r
  const rings = new Float32Array(RING_N * 3).fill(-1e3) // x, y, t0
  const brushU = new Float32Array(BRUSH_N * 4)
  const ringU = new Float32Array(RING_N * 3)
  let brushI = 0
  let ringI = 0

  let simT = 0
  let lastNow = 0
  let raf = 0
  let drawReq = 0
  let heroVisible = false
  let frames = 0 // drawn frames (debug / QA)

  let powered = false
  let powerT0 = -1
  let settle = 0
  let settleS = 0
  let progress = 0
  let attractTarget = 0
  let attractS = 0
  let attractV = 0
  let lastInputT = -1e3
  let ghostT0 = -1
  let ghostNext = 0
  let lastSample = { x: -1e5, y: -1e5, t: -1e3 }
  const groups = new Float32Array(GROUPS) // per capture group: 0 raw .. 1 on a lane

  // ---------------- WebGL ----------------
  let job = null // a compile in flight
  function setupGL() {
    if (!canvas || typeof WebGL2RenderingContext === 'undefined') return false
    const t0 = performance.now()
    gl = gl || canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power',
    })
    if (!gl || gl.isContextLost()) return false
    job = startCompile(gl)
    initMs = performance.now() - t0
    return true
  }
  let initMs = 0
  // the program is usable once the (possibly parallel) link is done; polled once per frame
  function pollCompile() {
    if (!job || lost) return
    if (!compileDone(gl, job)) { requestAnimationFrame(pollCompile); return }
    try {
      glr = finishCompile(gl, job, T.count)
      job = null
      glOk = true
      sizeCanvas(true)
      requestDraw()
      kick()
    } catch (e) {
      job = null
      if (import.meta.env.DEV) console.error('[fx:intake] WebGL program failed', e)
      goStatic()
    }
  }

  function goStatic() {
    glOk = false
    root.classList.add('intake-static')
    stopLoop()
  }

  // GL boots after the first frame has been presented, so it never delays first paint or the other
  // packages' init (the field fades in anyway)
  function bootGL() {
    let started = false
    try {
      started = setupGL()
    } catch (e) {
      // a broken driver or shader is not a package failure: the static lanes take over
      if (import.meta.env.DEV) console.error('[fx:intake] WebGL unavailable', e)
    }
    if (!started) { goStatic(); return }
    if (job.ext) requestAnimationFrame(pollCompile)
    else pollCompile()
  }

  if (canvas) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault() // allow a restore
      lost = true
      job = null
      goStatic()
    })
    canvas.addEventListener('webglcontextrestored', () => {
      lost = false
      try {
        glr = finishCompile(gl, startCompile(gl), T.count)
        glOk = true
        root.classList.remove('intake-static')
        sizeCanvas(true)
        requestDraw()
        kick()
      } catch (e) { goStatic() }
    })
  }

  // ---------------- geometry (layout reads only here, on refresh) ----------------
  function readRailX(contentLeft) {
    const inline = root.style.getPropertyValue('--rail-x')
    const v = parseFloat(inline)
    if (inline && inline.trim().endsWith('px') && Number.isFinite(v)) return v
    return Math.max(12, contentLeft - 28)
  }

  function measure() {
    const sy = window.scrollY
    const hr = hero.getBoundingClientRect()
    geo.heroTop = hr.top + sy
    geo.heroLeft = hr.left
    geo.w = Math.max(1, hero.clientWidth)
    geo.h = Math.max(1, hero.clientHeight)
    geo.stacked = mqStacked.matches
    geo.navH = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 0
    const cr = img.getBoundingClientRect()
    const card = { x: cr.left - hr.left, y: cr.top - hr.top, w: cr.width, h: cr.height }
    geo.card = card
    const cx = card.x + card.w / 2, cy = card.y + card.h / 2
    geo.maxDist = Math.max(Math.hypot(cx, cy), Math.hypot(geo.w - cx, cy), Math.hypot(cx, geo.h - cy), Math.hypot(geo.w - cx, geo.h - cy))

    // the input port: where the thread's intro edge enters the card (straight across from the
    // period when the card's vertical span contains it, otherwise a drop into the top edge)
    let px = card.x + card.w, py = card.y + card.h * 0.4
    if (period) {
      const pr = period.getBoundingClientRect()
      px = pr.left + pr.width / 2 - hr.left
      py = pr.top + pr.height / 2 - hr.top
    }
    if (py >= card.y && py <= card.y + card.h) {
      geo.port = { x: card.x + card.w, y: clamp(py, card.y + CARD_R, card.y + card.h - CARD_R), edge: 'right' }
    } else {
      geo.port = { x: clamp(px, card.x + CARD_R, card.x + card.w - CARD_R), y: card.y, edge: 'top' }
    }

    // the output port (railStart) and the rail
    const first = document.querySelector('.container')
    let contentLeft = 40
    if (first) {
      const fr = first.getBoundingClientRect()
      const fs = getComputedStyle(first)
      contentLeft = fr.left + (parseFloat(fs.paddingLeft) || 0) + (parseFloat(fs.borderLeftWidth) || 0)
    }
    geo.railX = readRailX(contentLeft) - hr.left
    const lanes = geo.stacked ? LANES_STACKED : LANES_WIDE
    geo.lanes = lanes
    geo.exitY = card.y + card.h * 0.7
    geo.exitLen = clamp(card.x - lanes[0] - geo.railX - 3, 0, 60) // toward the rail, at most 60px

    // dimming masks: the hero text blocks, padded 20px
    masks.fill(-1e5)
    texts.forEach((el, i) => {
      const r = contentRect(el)
      if (!r) return
      // the headline widens as it compiles (300 -> 900): leave room on its line-end (left) side
      const grow = el.hasAttribute('data-compile') ? (r.right - r.left) * 0.12 : 0
      masks.set([r.left - hr.left - 20 - grow, r.top - hr.top - 20, r.right - hr.left + 20, r.bottom - hr.top + 20], i * 4)
    })
    if (cta) {
      const r = cta.getBoundingClientRect()
      geo.cta = { x: r.left + r.width / 2 - hr.left, y: r.top + r.height / 2 - hr.top }
    }

    // CSS hooks: the plate's wipe origin + radius (plate-local, unrotated) and the port ring (figure-local)
    const fr = node.getBoundingClientRect()
    const portFx = geo.port.x - (fr.left - hr.left)
    const portFy = geo.port.y - (fr.top - hr.top)
    node.style.setProperty('--port-x', portFx.toFixed(1) + 'px')
    node.style.setProperty('--port-y', portFy.toFixed(1) + 'px')
    if (plate) {
      const pw = plate.offsetWidth, ph = plate.offsetHeight
      const pcx = plate.offsetLeft + pw / 2, pcy = plate.offsetTop + ph / 2
      const m = getComputedStyle(plate).transform
      let ang = 0
      if (m && m !== 'none') {
        const v = m.match(/matrix\(([^)]+)\)/)
        if (v) { const [a, b] = v[1].split(',').map(parseFloat); ang = Math.atan2(b, a) }
      }
      // undo the plate's rotation around its centre
      const dx = portFx - pcx, dy = portFy - pcy
      const lx = Math.cos(-ang) * dx - Math.sin(-ang) * dy + pw / 2
      const ly = Math.sin(-ang) * dx + Math.cos(-ang) * dy + ph / 2
      const far = Math.max(Math.hypot(lx, ly), Math.hypot(pw - lx, ly), Math.hypot(lx, ph - ly), Math.hypot(pw - lx, ph - ly))
      plate.style.setProperty('--plate-px', lx.toFixed(1) + 'px')
      plate.style.setProperty('--plate-py', ly.toFixed(1) + 'px')
      plate.style.setProperty('--plate-r', Math.ceil(far + 4) + 'px')
    }
    geo.ready = true
  }

  function sizeCanvas(force) {
    if (!glOk || !canvas) return
    let dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    if (geo.w * geo.h * dpr * dpr > MAX_BACKING) dpr = Math.max(1, Math.sqrt(MAX_BACKING / (geo.w * geo.h)))
    const bw = Math.max(1, Math.round(geo.w * dpr))
    const bh = Math.max(1, Math.round(geo.h * dpr))
    if (force || canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    geo.dpr = bw / geo.w
  }

  // ---------------- chips: scroll-scrubbed ingest into the input port ----------------
  let chipCtl = [] // { li, stop, anim, end, landed }
  let chipKey = ''

  // detach + cancel WITHOUT committing styles (motion's stop() would commit the current frame inline)
  function stopChips() {
    for (const c of chipCtl) {
      try { c.stop() } catch (e) { /* already detached */ }
      try { c.anim.cancel() } catch (e) { /* already gone */ }
    }
    chipCtl = []
  }

  function buildChips() {
    const live = chips.filter((li) => li.offsetParent !== null)
    if (!live.length || !geo.ready) { stopChips(); return }
    const hr = { left: geo.heroLeft, top: geo.heroTop - window.scrollY }
    const ul = chipList.getBoundingClientRect()
    const ox = ul.left - hr.left, oy = ul.top - hr.top
    const { card, port } = geo
    const C = makeContour(card.x, card.y, card.w, card.h, CARD_R)
    const sP = C.project(port.x, port.y)

    const avoidTop = port.edge === 'right' // the card's top edge scrolls under the nav first
    const routeCost = (s0, ds) => {
      // length, plus a penalty for the part that runs along the top edge (it leaves the viewport early)
      let top = 0
      const N = 24
      for (let k = 0; k < N; k++) if (C.at(s0 + ds * (k + 0.5) / N).ny < -0.5) top += Math.abs(ds) / N
      return Math.abs(ds) + (avoidTop ? 1.6 * top : 0)
    }
    const specs = live.map((li) => {
      // layout position (offset*), so the running transform never feeds back into the path
      const x0 = ox + li.offsetLeft, y0 = oy + li.offsetTop
      const hw = li.offsetWidth / 2, hh = li.offsetHeight / 2
      const s0 = C.project(x0, y0)
      const cw = (((sP - s0) % C.P) + C.P) % C.P // clockwise distance
      const ds = routeCost(s0, cw) <= routeCost(s0, cw - C.P) ? cw : cw - C.P
      return { li, x0, y0, hw, hh, s0, ds, len: Math.abs(ds) }
    })
    // every chip starts flowing on the first scroll, at one speed: the nearest land first
    specs.sort((a, b) => a.len - b.len)

    // the ingest window (hero progress, offset start start -> end start): from the first scroll until
    // the port is still comfortably below the nav
    const portDocY = geo.heroTop + port.y
    const pA = 0.012
    const pB = clamp((portDocY - geo.navH - 84 - geo.heroTop) / geo.h, 0.11, 0.5)
    const n = specs.length
    const stg = n > 4 ? 0.008 : 0.012
    const minWin = 0.045
    const maxLen = Math.max(1, specs[n - 1].len)
    const speed = maxLen / Math.max(minWin, pB - pA - (n - 1) * stg) // px per unit of progress

    const key = [geo.w, geo.h, card.x, card.y, card.w, card.h, port.x, port.y, pB, n, ...specs.map((s) => `${s.x0},${s.y0},${s.hw}`)].map((v) => typeof v === 'number' ? v.toFixed(1) : v).join('|')
    if (key === chipKey && chipCtl.length) return
    chipKey = key
    stopChips()

    const K = 16
    specs.forEach((sp, i) => {
      const a = pA + i * stg
      const b = Math.min(pB, a + Math.max(minWin, sp.len / speed))
      const frames = ['translate(0px, 0px) scale(1)']
      const ops = [1]
      const times = [0]
      for (let k = 0; k <= K; k++) {
        const f = k / K
        const g = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2 // ease-in-out along the edge
        const pt = C.at(sp.s0 + sp.ds * g)
        const sc = 1 - 0.2 * smooth(0, 0.35, f) - 0.68 * smooth(0.5, 1, f)
        // keep the pill's outer edge ~6px outside the card: it rides the card's rim, never its face
        const ext = (Math.abs(pt.nx) * sp.hw + Math.abs(pt.ny) * sp.hh) * sc
        const off = (6 - ext) * (1 - smooth(0.72, 1, f))
        let x = pt.x + pt.nx * off, y = pt.y + pt.ny * off
        const blend = smooth(0, 0.3, f)
        x = lerp(sp.x0, x, blend)
        y = lerp(sp.y0, y, blend)
        frames.push(`translate(${(x - sp.x0).toFixed(1)}px, ${(y - sp.y0).toFixed(1)}px) scale(${sc.toFixed(3)})`)
        ops.push(f < 0.78 ? 1 : +(1 - smooth(0.78, 1, f)).toFixed(3))
        times.push(+(a + (b - a) * f).toFixed(4))
      }
      frames.push(frames[frames.length - 1])
      ops.push(0)
      times.push(1)
      // WAAPI only (synchronous, compositor-friendly): a native ViewTimeline where supported, else
      // motion drives it from scroll progress. Reversible by construction.
      const anim = animateMini(sp.li, { transform: frames, opacity: ops }, { duration: 1, ease: 'linear', times })
      const stop = scroll(anim, { target: hero, offset: ['start start', 'end start'] })
      chipCtl.push({ li: sp.li, anim, stop, end: b, landed: progress >= b })
    })
  }

  // ---------------- port flash ----------------
  let flashFlip = false
  let flashTimer = 0
  function portFlash() {
    if (isPaused()) return
    flashFlip = !flashFlip
    node.classList.add('port-flash')
    node.classList.toggle('port-flash--b', flashFlip) // swapping the animation name restarts it
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => node.classList.remove('port-flash', 'port-flash--b'), 700)
    pushBrush(geo.port.x, geo.port.y, 44)
  }

  // ---------------- scroll: hero progress, settle, chip landings ----------------
  function onScroll() {
    if (!geo.ready) return
    progress = (window.scrollY - geo.heroTop) / geo.h
    settle = clamp(progress / 0.6, 0, 1)
    for (const c of chipCtl) {
      const now = progress >= c.end
      if (now && !c.landed) portFlash()
      c.landed = now
    }
    if (!raf && heroVisible && glOk) requestDraw()
  }

  // ---------------- brush input ----------------
  function pushBrush(x, y, r) {
    const o = brushI * 4
    brush[o] = x; brush[o + 1] = y; brush[o + 2] = simT; brush[o + 3] = r
    brushI = (brushI + 1) % BRUSH_N
  }
  function pushRing(x, y) {
    const o = ringI * 3
    rings[o] = x; rings[o + 1] = y; rings[o + 2] = simT
    ringI = (ringI + 1) % RING_N
  }
  const toHero = (cx, cy) => [cx - geo.heroLeft, cy + window.scrollY - geo.heroTop]
  function sample(cx, cy, r) {
    const [x, y] = toHero(cx, cy)
    lastInputT = simT
    ghostT0 = -1
    const d = Math.hypot(x - lastSample.x, y - lastSample.y)
    if (d < 18 && simT - lastSample.t < 0.09) return
    lastSample = { x, y, t: simT }
    pushBrush(x, y, r)
  }

  hero.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !geo.ready) return
    sample(e.clientX, e.clientY, 70)
  }, { passive: true })
  hero.addEventListener('touchstart', (e) => {
    if (!geo.ready || !e.touches.length) return
    const t = e.touches[0]
    const [x, y] = toHero(t.clientX, t.clientY)
    lastInputT = simT
    ghostT0 = -1
    pushRing(x, y)
    lastSample = { x, y, t: simT }
    pushBrush(x, y, 90)
  }, { passive: true })
  hero.addEventListener('touchmove', (e) => {
    if (!geo.ready || !e.touches.length) return
    const t = e.touches[0]
    sample(t.clientX, t.clientY, 90)
  }, { passive: true })

  // attractor: the WhatsApp CTA pulls nearby raw specks while hovered (fine pointers) or focused
  if (cta) {
    cta.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') attractTarget = 1 })
    cta.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && document.activeElement !== cta) attractTarget = 0 })
    cta.addEventListener('focusin', () => { attractTarget = 1; kick() })
    cta.addEventListener('focusout', () => { attractTarget = 0 })
  }

  // ---------------- simulation step + draw ----------------
  function ghostPos(t) {
    // a slow Lissajous around the card (3:2), kept inside the hero
    const { card } = geo
    const cx = card.x + card.w / 2, cy = card.y + card.h / 2
    const ax = card.w / 2 + (geo.stacked ? 40 : 84), ay = card.h / 2 + (geo.stacked ? 46 : 60)
    const th = t * 0.19
    return [clamp(cx + ax * Math.sin(3 * th + 0.6), 24, geo.w - 24), clamp(cy + ay * Math.sin(2 * th), 24, geo.h - 24)]
  }

  // capture: .45 of the specks once powered, up to .9 as the visitor scrolls the hero away.
  // Each group eases in (or out) over GROUP_S; dt = Infinity snaps them.
  function stepGroups(dt) {
    const capture = powered ? 0.45 + 0.45 * settleS : 0
    const k = dt / GROUP_S
    for (let g = 0; g < GROUPS; g++) {
      const want = (g + 0.5) / GROUPS < capture ? 1 : 0
      const v = groups[g]
      groups[g] = want > v ? Math.min(want, v + k) : Math.max(want, v - k)
    }
  }

  function step(dt) {
    settleS += (settle - settleS) * (1 - Math.exp(-dt * 7))
    stepGroups(dt)
    // attractor spring (slightly under-damped)
    attractV += ((attractTarget - attractS) * 160 - attractV * 20) * dt
    attractS += attractV * dt
    // idle ghost brush
    if (powered && simT - lastInputT > GHOST_AFTER) {
      if (ghostT0 < 0) { ghostT0 = simT; ghostNext = simT }
      if (simT >= ghostNext) {
        ghostNext = simT + 0.075
        const [x, y] = ghostPos(simT - ghostT0 + 2.1)
        pushBrush(x, y, (geo.stacked ? 80 : 70) * smooth(0, 2.2, simT - ghostT0))
      }
    }
  }

  function draw() {
    if (!glOk || !glr || !geo.ready || gl.isContextLost()) return
    const { u } = glr
    const { card } = geo
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const pw = powered ? easePower(clamp((simT - powerT0) / POWER_S, 0, 1)) : 0
    const lanes = geo.lanes
    gl.uniform1f(u.uTime, simT)
    gl.uniform1f(u.uDpr, geo.dpr)
    gl.uniform1f(u.uCardR, CARD_R)
    gl.uniform1f(u.uPower, pw)
    gl.uniform1fv(u.uGroup, groups)
    gl.uniform1f(u.uSettle, settleS)
    gl.uniform1f(u.uMaxDist, geo.maxDist)
    gl.uniform1f(u.uFade, smooth(0, FADE_S, simT))
    gl.uniform2f(u.uRes, geo.w, geo.h)
    gl.uniform4f(u.uCard, card.x + card.w / 2, card.y + card.h / 2, card.w / 2, card.h / 2)
    gl.uniform3f(u.uLaneOff, lanes[0], lanes[1], lanes[2])
    gl.uniform4fv(u.uMask, masks)
    for (let i = 0; i < BRUSH_N; i++) {
      const o = i * 4
      const age = simT - brush[o + 2]
      brushU[o] = brush[o]; brushU[o + 1] = brush[o + 1]; brushU[o + 2] = age
      brushU[o + 3] = age >= 0 && age < BRUSH_LIFE ? brush[o + 3] : 0
    }
    gl.uniform4fv(u.uBrush, brushU)
    for (let i = 0; i < RING_N; i++) {
      const o = i * 3
      ringU[o] = rings[o]; ringU[o + 1] = rings[o + 1]
      const age = simT - rings[o + 2]
      ringU[o + 2] = age >= 0 ? age : 99
    }
    gl.uniform3fv(u.uRing, ringU)
    gl.uniform3f(u.uAttract, geo.cta.x, geo.cta.y, clamp(attractS, 0, 1.2))
    gl.uniform3f(u.uExit, geo.exitY, geo.exitLen, pw > 0.6 && geo.exitLen > 6 ? 1 : 0)
    gl.bindVertexArray(glr.vao)
    gl.drawArrays(gl.POINTS, 0, drawCount)
    frames++
  }

  // ---------------- governor: mean frame time over 90 frames ----------------
  const gov = { warm: 0, n: 0, sum: 0, level: 0, means: [] }
  function govern(deltaMs) {
    if (gov.level >= 3) return
    if (gov.warm < 45) { gov.warm++; return }
    if (deltaMs > 120) return // a hitch, not the steady state
    gov.sum += deltaMs
    gov.n++
    if (gov.n < 90) return
    const mean = gov.sum / gov.n
    gov.means.push(+mean.toFixed(1))
    gov.sum = 0
    gov.n = 0
    if (mean <= 22) return
    gov.level++
    gov.warm = 0
    if (gov.level === 2) { dprCap = 1; sizeCanvas() } else drawCount = Math.max(700, drawCount >> 1)
  }

  // ---------------- loop gating ----------------
  let frozen = false // DEV/QA only (seek)
  function guardedFrame(now) { if (dead) return; try { frame(now) } catch (e) { bail(e) } }
  const wantLoop = () => !frozen && glOk && geo.ready && heroVisible && !document.hidden && !isPaused()

  function frame(now) {
    raf = 0
    if (dead) return
    const delta = now - lastNow
    const dt = clamp(delta / 1000, 0, 0.05)
    lastNow = now
    simT += dt
    step(dt)
    draw()
    govern(delta)
    if (wantLoop()) raf = requestAnimationFrame(guardedFrame)
  }
  function kick() {
    if (raf || !wantLoop()) return
    cancelAnimationFrame(drawReq)
    drawReq = 0
    lastNow = performance.now()
    gov.warm = 0
    raf = requestAnimationFrame(guardedFrame)
  }
  function stopLoop() {
    cancelAnimationFrame(raf)
    raf = 0
  }
  // one frame without advancing time (resize, power-on or a scroll while paused)
  function requestDraw() {
    if (raf || drawReq || !glOk) return
    drawReq = requestAnimationFrame(() => {
      drawReq = 0
      if (raf || dead) return
      // a still frame (paused, or drawn while the loop sleeps) shows the finished fade-in
      if (simT < FADE_S) simT = FADE_S
      settleS = settle
      stepGroups(Infinity)
      draw()
    })
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      heroVisible = entries[entries.length - 1].isIntersecting
      if (heroVisible) kick()
      else stopLoop()
    }).observe(hero)
  } else heroVisible = true

  document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else kick() })
  onPause((paused) => {
    if (paused) { stopLoop(); requestDraw() } else kick()
  })

  // ---------------- power-on ----------------
  let instantTimer = 0
  function setInstant() {
    node.classList.add('intake-instant')
    cancelAnimationFrame(instantTimer)
    instantTimer = requestAnimationFrame(() => {
      instantTimer = requestAnimationFrame(() => node.classList.remove('intake-instant'))
    })
  }

  function powerOn({ instant = false } = {}) {
    if (powered) return
    powered = true
    const quiet = instant || isPaused() || !heroVisible || document.hidden
    if (quiet) {
      setInstant()
      powerT0 = simT - POWER_S
    } else {
      powerT0 = simT
    }
    node.classList.add('is-powered')
    lastInputT = simT
    stepGroups(Infinity) // the order front alone reveals the first capture
    disarm()
    requestDraw()
    kick()
  }

  let disarm = () => {}
  function armPower() {
    disarm()
    const timers = []
    let offArrive = () => {}
    const onIgnite = (e) => {
      if (e.detail && e.detail.silent) { powerOn({ instant: true }); return }
      // the flow is off (no thread): the period has landed, power on a beat later
      timers.push(setTimeout(() => powerOn(), 900))
    }
    if (flowState() !== 'off') {
      // the packet arrives at the portrait (thread); a long timer guards a stalled run
      // (a silent arrival = the page loaded mid-run: no animation)
      offArrive = onArrive(node, (d) => powerOn({ instant: !!d && ((d.silent && !d.fallback) || d.fallback === 'latched') }), { fallbackDelay: 3200 })
    } else if (root.classList.contains('fx-ignition')) {
      document.addEventListener(EVT.IGNITE_DONE, onIgnite, { once: true })
      timers.push(setTimeout(() => powerOn(), 3400)) // ignition never reported back
    } else {
      // no packet and no headline wave: power on shortly after the hero is seen
      timers.push(setTimeout(() => powerOn({ instant: !heroVisible }), 900))
    }
    disarm = () => {
      offArrive()
      document.removeEventListener(EVT.IGNITE_DONE, onIgnite)
      timers.forEach(clearTimeout)
      disarm = () => {}
    }
  }
  document.addEventListener(EVT.RESET, () => {
    powered = false
    powerT0 = -1
    groups.fill(0)
    setInstant()
    node.classList.remove('is-powered', 'port-flash', 'port-flash--b')
    ghostT0 = -1
    lastInputT = simT
    for (const c of chipCtl) c.landed = false
    armPower()
    requestDraw()
  })

  // ---------------- failure: callbacks run outside main.js's try/catch ----------------
  // Give the hero back to the foundation's finished static look (crossed chips, hairline lane, solid
  // plate) and stop everything, exactly like main.js does for a failed init().
  let dead = false
  function bail(e) {
    if (dead) return
    dead = true
    console.error('[fx:intake] failed, falling back to the static hero', e)
    stopLoop()
    cancelAnimationFrame(drawReq)
    try { stopChips() } catch (err) { /* nothing left to stop */ }
    root.classList.remove('fx-intake')
    root.classList.add('intake-static')
  }
  const guard = (fn) => (...args) => { if (dead) return; try { fn(...args) } catch (e) { bail(e) } }

  // ---------------- wiring ----------------
  onRefresh(guard(() => {
    measure()
    sizeCanvas()
    buildChips()
    onScroll()
    requestDraw()
    kick()
  }))
  // the period moves while the headline compiles: re-measure the port once it has landed
  document.addEventListener(EVT.IGNITE_DONE, () => {
    requestAnimationFrame(guard(() => {
      if (!root.classList.contains('fx-intake')) return
      measure()
      buildChips()
      onScroll()
    }))
  })
  window.addEventListener('scroll', guard(onScroll), { passive: true })
  armPower()
  requestAnimationFrame(() => setTimeout(guard(bootGL), 0))

  if (import.meta.env.DEV) {
    window.__intake = {
      get state() {
        return {
          tier: tierName, glOk, lost, frames, simT, running: !!raf, heroVisible, powered, settle: settleS,
          progress, drawCount, dpr: geo.dpr, gov: { ...gov }, initMs, parallel: !!(gl && gl.getExtension('KHR_parallel_shader_compile')),
          port: geo.port, card: geo.card, railX: geo.railX, exitLen: geo.exitLen, attract: attractS,
          masks: [...masks].map((v) => Math.round(v)), heroTop: geo.heroTop,
          chips: chipCtl.map((c) => ({ i: c.li.dataset.chipI, end: +c.end.toFixed(3), landed: c.landed })),
        }
      },
      loseContext() { this._x = gl && gl.getExtension('WEBGL_lose_context'); if (this._x) this._x.loseContext(); return !!this._x },
      restoreContext() { if (this._x) this._x.restoreContext(); return !!this._x },
      brush: (x, y, r = 70) => pushBrush(x, y, r),
      ring: (x, y) => pushRing(x, y),
      setIdle: () => { lastInputT = -1e3 },
      // QA: freeze the loop and render the field at an exact sim time (power-on at t0 when given)
      seek(t, t0) {
        frozen = true
        stopLoop()
        if (t0 !== undefined) { powered = true; powerT0 = t0; node.classList.add('is-powered') }
        simT = t
        settleS = settle
        stepGroups(Infinity)
        draw()
      },
    }
  }
}
