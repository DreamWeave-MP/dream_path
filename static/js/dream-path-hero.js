// dream-path's hero: the normalizer as a machine. A spelling arrives as a row of tiles, one tile per
// byte (É is two bytes, so a double tile), and drops through four gates, one per rule, in the order
// the crate documents them:
//
//   1. `\` becomes `/`: a backslash tile turns over, and a backslash seen from behind is a slash.
//   2. ASCII `A` to `Z` become `a` to `z`: capitals are stamped lowercase. Non-ASCII bytes and raw
//      bytes (0xFF, NUL) are data, not letters: they shimmer and pass through unchanged.
//   3. Two or more separators in a row become one: the later ones slide into the first.
//   4. Separators at the start go: the leading one falls away.
//
// Every other byte passes untouched, `..` included. The row lands in the key slot at the bottom,
// where the key waits engraved: every spelling of one resource fits the same key, and a pip lights
// for each. Then come the literal surprises: `..` survives, a trailing separator stays, `///` is
// the empty path, and NUL and 0xFF come through as they went in.
//
// The scene renders to a half-float target; a bright pass and four blur passes make the bloom, and
// the composite applies ACES tone mapping, a vignette and dithering. Colours come from the site's
// CSS tokens. The machine stands beside the hero's text, or above it where sass/brand.sass leaves
// room. Nothing runs off screen or in a hidden tab, the resolution drops when frames run slow, and
// under prefers-reduced-motion one frame is drawn. Until the first frame, and without WebGL, a still
// of the machine stands in its place.

import * as THREE from './vendor/three.module.min.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The machine, in its own units: one unit is one byte's pitch.
const TILE = { w: 0.86, h: 1.08, d: 0.28, bevel: 0.05 };
const HALF = 12.7;
const GATES = [4.3, 1.9, -0.5, -2.9];
const SPAWN_Y = 6.05;
const INPUT_Y = 7.28;
const SLOT_TOP = -5.0;
const REST = 0.05 + TILE.h / 2 + 0.03;
const GHOST_Y = SLOT_TOP + TILE.h / 2 - 0.34;
const LAND_Y = SLOT_TOP + TILE.h / 2 + 0.03;
const MACHINE = { top: 7.9, bottom: -6.5, halfWidth: HALF + 1.55 };
const MACHINE_HEIGHT = MACHINE.top - MACHINE.bottom;
const MACHINE_CENTER_Y = (MACHINE.top + MACHINE.bottom) / 2;
export const MACHINE_ASPECT = (MACHINE.halfWidth * 2) / MACHINE_HEIGHT;
const MAX_TILES = 72;
const MAX_WIDE = 12;
const SPARKS = 900;

// What goes through, grouped by the key they share. Backslashes are written doubled; \xff and \0
// are single raw bytes.
const FAMILIES = [
  ['Textures\\Wood.DDS', '//TEXTURES//wood.dds', 'textures\\\\\\Wood.DDS', '/Textures/WOOD.dds'],
  ['//Meshes\\x\\Ex_Door.NIF', 'MESHES/X/EX_DOOR.nif'],
  ['Sound\\..\\Door.WAV'],
  ['Été/Ärger.DDS'],
  ['Music\\Explore\\\\'],
  ['///'],
  ['DIR/\\xff/FILE'],
  ['FOO\\0BAR'],
];

// The model -----------------------------------------------------------------------------------------

export function parseSpelling(source) {
  const units = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\' && source[i + 1] === 'x' && /^[0-9a-f]{2}$/i.test(source.slice(i + 2, i + 4))) {
      units.push({ glyph: `x${source.slice(i + 2, i + 4).toLowerCase()}`, bytes: [parseInt(source.slice(i + 2, i + 4), 16)], raw: true });
      i += 3;
    } else if (ch === '\\' && source[i + 1] === '0') {
      units.push({ glyph: 'x00', bytes: [0], raw: true });
      i += 1;
    } else {
      units.push({ glyph: ch, bytes: [...new TextEncoder().encode(ch)], raw: false });
    }
  }
  return units;
}

const isSeparator = (unit) => unit.bytes.length === 1 && (unit.bytes[0] === 0x2f || unit.bytes[0] === 0x5c);
const isUpper = (unit) => unit.bytes.length === 1 && unit.bytes[0] >= 0x41 && unit.bytes[0] <= 0x5a;
const isData = (unit) => unit.raw || unit.bytes.length > 1 || unit.bytes[0] > 0x7f;

// The four rules as four stages. Each stage says what it does to each unit of its input; applying
// them in order gives exactly what the crate's one pass gives (checked against its documented table).
export function stages(units) {
  let row = units.map((unit) => ({ ...unit }));
  const out = [];
  const flips = row.map((unit) => (unit.bytes.length === 1 && unit.bytes[0] === 0x5c ? 'flip' : null));
  row = row.map((unit, i) => (flips[i] ? { ...unit, glyph: '/', bytes: [0x2f] } : unit));
  out.push({ rule: 'flip', effects: flips, keep: flips.map(() => true) });
  const folds = row.map((unit) => (isUpper(unit) ? 'fold' : isData(unit) ? 'data' : null));
  row = row.map((unit, i) => (folds[i] === 'fold' ? { ...unit, glyph: unit.glyph.toLowerCase(), bytes: [unit.bytes[0] + 32] } : unit));
  out.push({ rule: 'fold', effects: folds, keep: folds.map(() => true) });
  const merges = row.map((unit, i) => (i > 0 && isSeparator(unit) && isSeparator(row[i - 1]) ? 'merge' : null));
  row = row.filter((_, i) => !merges[i]);
  out.push({ rule: 'merge', effects: merges, keep: merges.map((m) => !m) });
  const drops = row.map((unit, i) => (i === 0 && isSeparator(unit) ? 'drop' : null));
  row = row.filter((_, i) => !drops[i]);
  out.push({ rule: 'drop', effects: drops, keep: drops.map((d) => !d) });
  return { stages: out, key: row };
}

// Colours and small helpers ------------------------------------------------------------------------

function cssColor(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const color = new THREE.Color(fallback);
  if (raw) {
    try { color.setStyle(raw); } catch { /* an unparsable token keeps the fallback */ }
  }
  return color;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const ease = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const easeIn = (t) => { const x = clamp01(t); return x * x; };
const easeOutBack = (t) => { const x = clamp01(t) - 1; return 1 + x * x * (2.6 * x + 1.6); };
const bump = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));

// The glyph atlas -----------------------------------------------------------------------------------

// Every glyph a tile can carry, drawn white on black: printable ASCII, the non-ASCII letters the
// spellings use (on double cells, with their UTF-8 bytes underneath), and raw bytes as boxed hex.
const CELL_W = 96;
const CELL_H = 128;
const ATLAS_W = 2048;
const ATLAS_H = 1024;
const WIDE_GLYPHS = { 'É': 'c3 89', 'é': 'c3 a9', 'Ä': 'c3 84' };

function buildAtlas(anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const context = canvas.getContext('2d');
  context.fillStyle = '#000';
  context.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--dw-font-mono').trim() || 'ui-monospace, monospace';
  const cells = new Map();
  const columns = Math.floor(ATLAS_W / CELL_W);
  let column = 0;
  let row = 0;
  const claim = (span) => {
    if (column + span > columns) {
      column = 0;
      row += 1;
    }
    const cell = { x: column * CELL_W, y: row * CELL_H, w: span * CELL_W, h: CELL_H };
    column += span;
    return cell;
  };
  const record = (key, cell) => cells.set(key, [cell.x / ATLAS_W, 1 - (cell.y + cell.h) / ATLAS_H, cell.w / ATLAS_W, cell.h / ATLAS_H]);
  context.fillStyle = '#fff';
  context.strokeStyle = '#fff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (let code = 33; code < 127; code++) {
    const cell = claim(1);
    const ch = String.fromCharCode(code);
    context.font = `600 84px ${mono}`;
    context.fillText(ch, cell.x + cell.w / 2, cell.y + cell.h / 2 + 4);
    record(ch, cell);
  }
  record(' ', claim(1));
  for (const [ch, bytes] of Object.entries(WIDE_GLYPHS)) {
    const cell = claim(2);
    context.font = `600 84px ${mono}`;
    context.fillText(ch, cell.x + cell.w / 2, cell.y + cell.h / 2 - 6);
    context.font = `500 22px ${mono}`;
    context.globalAlpha = 0.62;
    context.fillText(bytes, cell.x + cell.w / 2, cell.y + cell.h - 18);
    context.globalAlpha = 1;
    record(ch, cell);
  }
  for (const hex of ['ff', '00']) {
    const cell = claim(1);
    context.lineWidth = 3;
    context.setLineDash([7, 6]);
    context.strokeRect(cell.x + 12, cell.y + 22, cell.w - 24, cell.h - 44);
    context.setLineDash([]);
    context.font = `500 18px ${mono}`;
    context.globalAlpha = 0.62;
    context.fillText(hex === '00' ? 'NUL' : 'byte', cell.x + cell.w / 2, cell.y + 38);
    context.globalAlpha = 1;
    context.font = `600 44px ${mono}`;
    context.fillText(hex.toUpperCase(), cell.x + cell.w / 2, cell.y + cell.h / 2 + 12);
    record(`x${hex}`, cell);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return { texture, cells };
}

// Geometry ---------------------------------------------------------------------------------------------

function roundedRect(width, height, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function slab(width, height, depth, radius, bevel, curveSegments = 4) {
  const geometry = new THREE.ExtrudeGeometry(roundedRect(width - bevel * 2, height - bevel * 2, radius), {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

// A tile's material: smoked, clear-coated metal, whose front and back faces carry a glyph from the
// atlas, lit from within. Each instance says which glyph it shows now and which it becomes, how far
// the change has gone, how hot it glows and in what colour.
function tileMaterial(atlas, width, envMap) {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.075, 0.05, 0.046),
    metalness: 0.7,
    roughness: 0.28,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    envMap,
    envMapIntensity: 1.7,
    emissive: new THREE.Color(1, 1, 1),
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tAtlas = { value: atlas };
    shader.uniforms.uTileSize = { value: new THREE.Vector2(width, TILE.h) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aGlyphA;
        attribute vec4 aGlyphB;
        attribute vec4 aState;
        attribute vec3 aTint;
        varying vec4 vGlyphA;
        varying vec4 vGlyphB;
        varying vec4 vState;
        varying vec3 vTint;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlyphA = aGlyphA;
        vGlyphB = aGlyphB;
        vState = aState;
        vTint = aTint;
        vObjPos = position;
        vObjNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAtlas;
        uniform vec2 uTileSize;
        varying vec4 vGlyphA;
        varying vec4 vGlyphB;
        varying vec4 vState;
        varying vec3 vTint;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        float faceMask() {
          return smoothstep(0.72, 0.96, abs(vObjNormal.z));
        }
        float glyphAt(vec4 rect, vec2 local) {
          vec2 uv = rect.xy + clamp(local, vec2(0.0), vec2(1.0)) * rect.zw;
          return texture2D(tAtlas, uv).r;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tileFace = faceMask();
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.35, tileFace);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 local = vObjPos.xy / uTileSize + 0.5;
        float glyph = mix(glyphAt(vGlyphA, local), glyphAt(vGlyphB, local), clamp(vState.x, 0.0, 1.0));
        vec2 edge = max(min(local, 1.0 - local), vec2(0.0)) * uTileSize;
        float rim = 1.0 - smoothstep(0.0, 0.07, min(edge.x, edge.y) - 0.02);
        float hot = max(vState.y, 0.0);
        vec3 face = vTint * (glyph * (0.95 + hot * 2.2) + rim * (0.07 + hot * 0.45)) * vState.z;
        totalEmissiveRadiance = face * tileFace;`);
  };
  material.customProgramCacheKey = () => `dream-path-tile-${width}`;
  return material;
}

function tileMesh(width, capacity, material) {
  const geometry = slab(width, TILE.h, TILE.d, 0.13, TILE.bevel);
  const attribute = (size) => {
    const buffer = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    buffer.setUsage(THREE.DynamicDrawUsage);
    return buffer;
  };
  geometry.setAttribute('aGlyphA', attribute(4));
  geometry.setAttribute('aGlyphB', attribute(4));
  geometry.setAttribute('aState', attribute(4));
  geometry.setAttribute('aTint', attribute(3));
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

export function environment(renderer, accent) {
  const scene = new THREE.Scene();
  const disposables = [];
  const add = (geometry, color, position) => {
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    disposables.push(geometry, material);
  };
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 18, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.024, 0.022), side: THREE.BackSide }));
  scene.add(room);
  disposables.push(room.geometry, room.material);
  add(new THREE.PlaneGeometry(14, 6), new THREE.Color(1.0, 0.78, 0.62).multiplyScalar(3.2), [-8, 7, 8]);
  add(new THREE.PlaneGeometry(10, 5), new THREE.Color(0.8, 0.9, 1.0).multiplyScalar(1.6), [9, 3, 9]);
  add(new THREE.PlaneGeometry(16, 0.6), accent.clone().multiplyScalar(6), [0, 5, -11]);
  add(new THREE.PlaneGeometry(16, 0.5), accent.clone().multiplyScalar(3.5), [-10, -1, -7]);
  add(new THREE.PlaneGeometry(0.6, 12), new THREE.Color(0.55, 0.85, 1.0).multiplyScalar(2.4), [11, 0, -6]);
  add(new THREE.PlaneGeometry(26, 26), new THREE.Color(0.3, 0.14, 0.1).multiplyScalar(0.4), [0, -8.5, 0]);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(scene, 0.04);
  generator.dispose();
  for (const item of disposables) item.dispose();
  return target;
}

// Shaders ----------------------------------------------------------------------------------------------

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amplitude * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return sum;
  }
`;

// The backdrop: the hero's own gradient, an ember glow behind the machine, slow haze, and faint
// streaks of bytes falling behind it, the way the rows fall in front.
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uGlow;
  uniform vec3 uAccent;
  uniform vec2 uCenter;
  uniform vec2 uHalf;
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec3 color = mix(uBottom, uTop, vUv.y);
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec2 d = (vUv - uCenter) / max(uHalf, vec2(0.001));
    float r2 = dot(d, d);
    float glow = exp(-r2 * 0.9);
    float haze = fbm(d * vec2(1.1, 1.8) + vec2(uTime * 0.01, uTime * 0.018));
    color += uGlow * glow * (0.5 + 0.5 * haze);
    vec2 p = (vUv - uCenter) * aspect * 26.0;
    float column = floor(p.x);
    float speed = 0.35 + hash(vec2(column, 3.1)) * 0.9;
    float y = p.y + uTime * speed * 2.0 + hash(vec2(column, 7.7)) * 40.0;
    float cell = fract(y / 3.0);
    float streak = smoothstep(0.0, 0.08, cell) * (1.0 - smoothstep(0.08, 0.9, cell));
    float lane = 1.0 - smoothstep(0.0, 0.18, abs(fract(p.x) - 0.5) - 0.02);
    float present = step(0.62, hash(vec2(column, floor(y / 3.0))));
    float mask = exp(-r2 * 0.55) * (1.0 - smoothstep(0.35, 1.35, abs(d.x) * 0.9));
    color += uAccent * streak * lane * present * mask * 0.05;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// A gate: a sheet of light, brighter at its edges, with its rails, the glow of the row resting on it,
// and the scan that sweeps across the row while the rule acts.
const GATE_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GATE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform vec2 uSize;
  uniform float uScanX;
  uniform float uScan;
  uniform vec2 uRow;
  uniform float uRowOn;
  uniform float uFlash;
  uniform float uTime;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  float sq(float x) { return x * x; }
  void main() {
    vec3 v = normalize(vView + vec3(0.0, 0.0, 1e-4));
    float facing = clamp(abs(dot(normalize(vNormal), v)), 0.0, 1.0);
    float fresnel = 1.0 - facing;
    fresnel = fresnel * fresnel * fresnel;
    // Multisampling evaluates varyings at pixel centres, which can lie just outside a thin face;
    // clamped, an edge distance cannot go negative and blow the exponentials up.
    vec2 edge = max(uSize * 0.5 - abs(vLocal.xz), vec2(0.0));
    float front = step(0.0, vLocal.z);
    float rail = exp(-edge.y * 12.0) * (0.35 + 0.65 * front) * (0.6 + 0.4 * exp(-edge.x * 2.0));
    float under = uRowOn * smoothstep(uRow.x - 0.8, uRow.x, vLocal.x) * (1.0 - smoothstep(uRow.y, uRow.y + 0.8, vLocal.x));
    float scan = exp(-sq((vLocal.x - uScanX) / 0.45)) * uScan;
    float ripple = 0.5 + 0.5 * sin(vLocal.x * 3.0 - uTime * 4.0);
    vec3 color = uColor * (0.025 + fresnel * 0.35 + rail * 0.55 + under * (0.07 + 0.04 * ripple));
    color += uHot * (scan * 0.55 + uFlash * rail * 0.5);
    gl_FragColor = vec4(min(color, vec3(3.0)), 1.0);
  }
`;

// The curtain of light the rows fall through, brightest under the input slit, with faint streaks
// running down it and a band of light behind wherever the row is.
const CURTAIN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uRowY;
  uniform float uTop;
  uniform float uBottom;
  varying vec2 vUv;
  varying vec3 vLocal;
  ${NOISE}
  void main() {
    float fall = clamp((vLocal.y - uBottom) / max(uTop - uBottom, 1e-3), 0.0, 1.0);
    float sides = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    float streaks = noise(vec2(vLocal.x * 3.1, vLocal.y * 0.25 + uTime * 0.9));
    streaks = smoothstep(0.55, 0.95, streaks);
    float band = exp(-(vLocal.y - uRowY) * (vLocal.y - uRowY) * 0.9);
    float glow = (0.035 + 0.13 * fall * fall) * (0.7 + 0.6 * streaks) + band * 0.09;
    gl_FragColor = vec4(uColor * glow * sides, 1.0);
  }
`;

const LOCAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The slot's top: a ring of light that runs out along it when a key fits.
const SHOCK_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRing;
  uniform float uHalf;
  varying vec2 vUv;
  varying vec3 vLocal;
  void main() {
    vec2 p = vec2(vLocal.x / uHalf, vLocal.y * 1.6 / uHalf);
    float r = length(p * vec2(1.0, 6.0));
    float d = r - uRing * 1.15;
    float ring = exp(-d * d * 160.0) * (1.0 - uRing) * step(0.001, uRing);
    float core = exp(-r * r * 12.0) * (1.0 - uRing) * step(0.001, uRing);
    gl_FragColor = vec4(uColor * (ring * 2.4 + core * 0.8), 1.0);
  }
`;

// Sparks and dust: points sized in the machine's units.
const POINT_VERTEX = /* glsl */ `
  uniform float uPixel;
  uniform float uScale;
  attribute vec3 aColor;
  attribute float aSize;
  varying vec3 vColor;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    vColor = aColor;
    gl_PointSize = uPixel * aSize * uScale / max(-view.z, 0.1);
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float falloff = exp(-dot(d, d) * 20.0);
    gl_FragColor = vec4(vColor * falloff, 1.0);
  }
`;

const DUST_VERTEX = /* glsl */ `
  uniform float uPixel;
  uniform float uScale;
  uniform float uTime;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * (0.12 + aSeed.x * 0.2) + aSeed.y * 30.0) * 0.8;
    p.y = mod(p.y - uTime * (0.15 + aSeed.z * 0.35) + 8.0, 16.0) - 8.0;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    vAlpha = (0.25 + 0.75 * aSeed.w) * (1.0 - smoothstep(5.5, 8.0, abs(p.y)));
    gl_PointSize = uPixel * (0.05 + aSeed.w * 0.07) * uScale / max(-view.z, 0.1);
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    gl_FragColor = vec4(uColor * exp(-dot(d, d) * 18.0) * vAlpha, 1.0);
  }
`;

// The stroke a visitor draws across the hero, in screen pixels.
const TRAIL_VERTEX = /* glsl */ `
  uniform vec2 uViewport;
  attribute float aGlow;
  varying float vGlow;
  void main() {
    vGlow = aGlow;
    vec2 ndc = position.xy / max(uViewport, vec2(1.0)) * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vGlow;
  void main() {
    gl_FragColor = vec4(uColor * max(vGlow, 0.0), 1.0);
  }
`;

// Any NaN or infinity a driver produces is zeroed and bright values capped before the bloom, which
// would otherwise smear a single bad pixel into a black square.
const SCRUB = /* glsl */ `
  vec3 scrub(vec3 c) {
    if (any(isnan(c)) || any(isinf(c)) || c.r != c.r || c.g != c.g || c.b != c.b) return vec3(0.0);
    return clamp(c, 0.0, 64.0);
  }
`;

const BRIGHT_FRAGMENT = /* glsl */ `
  uniform sampler2D tInput;
  uniform float uThreshold;
  varying vec2 vUv;
  ${SCRUB}
  void main() {
    vec3 c = scrub(texture2D(tInput, vUv).rgb);
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.7, luma), 1.0);
  }
`;

const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uDirection;
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tInput, vUv).rgb * 0.2270270270;
    sum += texture2D(tInput, vUv + uDirection * 1.3846153846).rgb * 0.3162162162;
    sum += texture2D(tInput, vUv - uDirection * 1.3846153846).rgb * 0.3162162162;
    sum += texture2D(tInput, vUv + uDirection * 3.2307692308).rgb * 0.0702702703;
    sum += texture2D(tInput, vUv - uDirection * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COPY_FRAGMENT = /* glsl */ `
  uniform sampler2D tInput;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(tInput, vUv).rgb, 1.0); }
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloomNear;
  uniform sampler2D tBloomFar;
  uniform vec2 uCenter;
  uniform vec2 uHalf;
  uniform float uTime;
  varying vec2 vUv;
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  float dither(vec2 p) {
    return fract(sin(dot(p + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  }
  ${SCRUB}
  void main() {
    vec3 color = scrub(texture2D(tScene, vUv).rgb);
    color += scrub(texture2D(tBloomNear, vUv).rgb) * 0.6 + scrub(texture2D(tBloomFar, vUv).rgb) * 0.35;
    vec2 d = (vUv - uCenter) / max(uHalf * 1.9, vec2(0.001));
    color *= 1.0 - 0.28 * smoothstep(0.6, 1.6, length(d));
    color = aces(color * 0.95);
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
    color += dither(gl_FragCoord.xy) / 255.0;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function fullscreenMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

// Layout ---------------------------------------------------------------------------------------------

// Where the hero's words and controls are, so the machine can stand clear of them.
function textRects(text) {
  const rects = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) rects.push(rect);
  }
  for (const element of text.querySelectorAll('a, button, input, select, img, svg, .dw-command, .dw-badge')) rects.push(element.getBoundingClientRect());
  return rects.filter((rect) => rect.width > 0 && rect.height > 0);
}

// The largest box of the machine's shape clear of the text: beside all of it, beside the title rows
// above the summary, or above it all where the stylesheet has left room. Relative to the art.
function placement(root) {
  const hero = root.closest('.dw-hero') || root.parentElement;
  const box = root.getBoundingClientRect();
  const text = hero.querySelector('.dw-hero__text') || hero.querySelector('.dw-shell');
  const strip = hero.querySelector('.dw-strip');
  const shellElement = hero.querySelector('.dw-hero__grid') || hero.querySelector('.dw-shell') || hero;
  const shellStyle = getComputedStyle(shellElement);
  const shellBox = shellElement.getBoundingClientRect();
  const shell = strip ? strip.getBoundingClientRect() : { left: shellBox.left + parseFloat(shellStyle.paddingLeft), right: shellBox.right - parseFloat(shellStyle.paddingRight) };
  const summary = hero.querySelector('.dw-hero__summary');
  const floor = strip ? strip.getBoundingClientRect().top : box.bottom - 24;
  const rects = text ? textRects(text) : [];
  if (!rects.length) return { x: box.width * 0.72, y: box.height * 0.45, width: box.width * 0.4, height: box.width * 0.4 / MACHINE_ASPECT, above: false };
  const gap = 36;
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const summaryTop = summary ? summary.getBoundingClientRect().top : floor;
  const headRects = rects.filter((rect) => rect.bottom <= summaryTop + 1);
  const headRight = headRects.length ? Math.max(...headRects.map((rect) => rect.right)) : right;
  const candidates = [
    { x0: right + gap, x1: shell.right, y0: box.top + 16, y1: floor - 16, above: false },
    { x0: headRight + gap, x1: shell.right, y0: box.top + 12, y1: summaryTop - 12, above: false },
    { x0: shell.left, x1: shell.right, y0: box.top + 8, y1: top - 16, above: true },
  ].map((region) => {
    const width = region.x1 - region.x0;
    const height = region.y1 - region.y0;
    return { ...region, height: Math.max(0, Math.min(height, width / MACHINE_ASPECT)) };
  });
  const best = candidates.reduce((a, b) => (b.height > a.height ? b : a));
  const height = Math.min(best.height * (best.above ? 0.94 : 0.9), 360);
  const width = height * MACHINE_ASPECT;
  const x = best.above ? (best.x0 + best.x1) / 2 : Math.min(best.x1 - width / 2, (best.x0 + best.x1) / 2 + (best.x1 - best.x0 - width) * 0.3);
  return { x: x - box.left, y: (best.y0 + best.y1) / 2 - box.top, width, height, above: best.above };
}

// The staircase gesture ---------------------------------------------------------------------------------

// A stroke, reduced to runs along the axes: right, left, down, up. Short wobbles are dropped and a
// long diagonal spoils it; what is left must alternate between one horizontal direction and down,
// three steps at least. That is a staircase going down, into directories.
export function readStaircase(points) {
  if (points.length < 8) return null;
  const spaced = [points[0]];
  for (const point of points) {
    const last = spaced[spaced.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= 4) spaced.push(point);
  }
  if (spaced.length < 8) return null;
  const runs = [];
  let diagonal = 0;
  for (let i = 1; i < spaced.length; i++) {
    const dx = spaced[i].x - spaced[i - 1].x;
    const dy = spaced[i].y - spaced[i - 1].y;
    const length = Math.hypot(dx, dy);
    let kind = null;
    if (Math.abs(dx) >= Math.abs(dy) * 1.7) kind = dx > 0 ? 'R' : 'L';
    else if (Math.abs(dy) >= Math.abs(dx) * 1.7) kind = dy > 0 ? 'D' : 'U';
    if (!kind) {
      diagonal += length;
      if (diagonal > 26) return null;
      continue;
    }
    diagonal = 0;
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) {
      last.length += length;
      last.end = spaced[i];
    } else {
      runs.push({ kind, length, start: spaced[i - 1], end: spaced[i] });
    }
  }
  const merged = [];
  for (const run of runs.filter((r) => r.length >= 11)) {
    const last = merged[merged.length - 1];
    if (last && last.kind === run.kind) {
      last.length += run.length;
      last.end = run.end;
    } else merged.push({ ...run });
  }
  if (merged.length < 5) return null;
  const across = merged.find((run) => run.kind === 'R' || run.kind === 'L')?.kind;
  if (!across) return null;
  let steps = 0;
  let treads = 0;
  for (let i = 0; i < merged.length; i++) {
    const run = merged[i];
    if (run.kind !== across && run.kind !== 'D') return null;
    if (run.length < 16) return null;
    if (i > 0 && merged[i - 1].kind === run.kind) return null;
    if (run.kind === 'D') steps += 1;
    else treads += 1;
  }
  if (steps < 3 || treads < 2) return null;
  // The stroke tidied: the same runs, square to the axes, from where it began.
  const corners = [{ x: merged[0].start.x, y: merged[0].start.y }];
  for (const run of merged) {
    const last = corners[corners.length - 1];
    const sign = run.kind === 'L' ? -1 : 1;
    corners.push(run.kind === 'D' ? { x: last.x, y: last.y + run.length } : { x: last.x + sign * run.length, y: last.y });
  }
  return { steps, corners };
}

// The machine ----------------------------------------------------------------------------------------------

function mount(root) {
  const still = document.createElement('img');
  still.className = 'dp-hero__still';
  still.alt = '';
  still.decoding = 'async';
  still.src = new URL('../img/dream-path-hero.webp', import.meta.url).href;
  root.append(still);

  function placeStill() {
    const spot = placement(root);
    Object.assign(still.style, {
      left: `${spot.x - spot.width / 2}px`,
      top: `${spot.y - spot.height / 2}px`,
      width: `${spot.width}px`,
      height: `${spot.height}px`,
    });
    root.classList.add('is-placed');
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'dp-hero__canvas';
  // Asked first, quietly: three.js reports a failed context as console errors.
  let supported = false;
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    supported = !!probe;
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL 2 */ }
  if (!supported) {
    placeStill();
    new ResizeObserver(placeStill).observe(root);
    return;
  }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch {
    placeStill();
    new ResizeObserver(placeStill).observe(root);
    return;
  }
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    placeStill();
    new ResizeObserver(placeStill).observe(root);
    return;
  }
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  root.append(canvas);

  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const floatTargets = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const targetType = floatTargets ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const makeTarget = () => new THREE.WebGLRenderTarget(1, 1, { type: targetType, depthBuffer: false });
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: targetType, samples: small ? 2 : 4 });
  const bloomTargets = [makeTarget(), makeTarget(), makeTarget(), makeTarget()];
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const quality = { level: 1, slow: 0 };

  // Colours from the site.
  const accent = cssColor('--dw-accent', '#ff9d7a');
  const bg0 = cssColor('--dw-bg-0', '#120c0b');
  const bg1 = cssColor('--dw-bg-1', '#1a1210');
  const text = cssColor('--dw-text', '#f4ebe6');
  const linear = (color) => color.clone().convertSRGBToLinear();
  const accentLinear = linear(accent);
  const warm = linear(text).lerp(new THREE.Color(1.0, 0.72, 0.5), 0.35);
  const separatorTint = accentLinear.clone().multiplyScalar(1.25);
  const dataTint = new THREE.Color(0.45, 0.82, 1.0);
  const gold = new THREE.Color(1.0, 0.72, 0.28);

  const scene = new THREE.Scene();
  const envTarget = environment(renderer, accentLinear);
  scene.environment = envTarget.texture;
  const camera = new THREE.PerspectiveCamera(34, 1, 1, 400);
  camera.position.set(0, 0, 40);
  camera.lookAt(0, 0, 0);

  const machine = new THREE.Group();
  scene.add(machine);

  scene.add(new THREE.HemisphereLight(new THREE.Color(0.55, 0.42, 0.38), new THREE.Color(0.05, 0.03, 0.03), 0.5));
  const key = new THREE.DirectionalLight(new THREE.Color(1.0, 0.86, 0.74), 2.2);
  key.position.set(-6, 9, 12);
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(0.55, 0.8, 1.0), 1.1);
  rim.position.set(9, 4, -8);
  scene.add(rim);
  const lamp = new THREE.PointLight(new THREE.Color(1.0, 0.8, 0.62), 0, 0, 2);
  scene.add(lamp);

  // The atlas waits for the site's fonts, so the glyphs are the page's own monospace.
  let atlas = buildAtlas(anisotropy);
  const narrowMaterial = tileMaterial(atlas.texture, TILE.w, envTarget.texture);
  const wideMaterial = tileMaterial(atlas.texture, TILE.w * 2 + 0.14, envTarget.texture);
  const narrow = tileMesh(TILE.w, MAX_TILES, narrowMaterial);
  const wide = tileMesh(TILE.w * 2 + 0.14, MAX_WIDE, wideMaterial);
  machine.add(narrow, wide);
  const rebuildAtlas = () => {
    const next = buildAtlas(anisotropy);
    for (const material of [narrowMaterial, wideMaterial]) {
      if (material.userData.shader) material.userData.shader.uniforms.tAtlas.value = next.texture;
    }
    atlas.texture.dispose();
    atlas = next;
  };
  for (const material of [narrowMaterial, wideMaterial]) {
    const compile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, gl) => {
      compile(shader, gl);
      shader.uniforms.tAtlas.value = atlas.texture;
      material.userData.shader = shader;
    };
  }

  // The frame: two pillars carrying the gates, and the slot bar with the key.
  const metal = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.05, 0.035, 0.032), metalness: 0.9, roughness: 0.46, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.9,
  });
  const pillarGeometry = slab(1.2, MACHINE.top - MACHINE.bottom - 0.3, 1.5, 0.3, 0.08);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeometry, metal);
    pillar.position.set(side * (HALF + 0.85), (MACHINE.top + MACHINE.bottom) / 2 + 0.15, 0);
    machine.add(pillar);
  }
  const bar = new THREE.Mesh(slab(HALF * 2 + 0.9, 1.5, 2.0, 0.25, 0.08), metal);
  bar.position.set(0, SLOT_TOP - 0.75, 0);
  machine.add(bar);
  const input = new THREE.Mesh(slab(HALF * 2 + 0.9, 0.95, 1.9, 0.22, 0.08), metal);
  input.position.set(0, INPUT_Y, 0.15);
  machine.add(input);
  // The input's slit, glowing where the rows come through.
  const slit = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 - 0.6, 0.06, 0.08), new THREE.MeshBasicMaterial({ color: accentLinear.clone().multiplyScalar(1.6) }));
  slit.position.set(0, INPUT_Y - 0.5, 1.02);
  machine.add(slit);

  // A reader head on each gate's front rail: it rides the scan and does the rule to each tile it
  // passes, and casts a fan of light up across the row.
  const headGeometry = slab(0.95, 0.46, 0.7, 0.14, 0.05);
  const lensGeometry = new THREE.BoxGeometry(0.5, 0.08, 0.1);
  const heads = GATES.map((y) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(headGeometry, metal);
    const lensMaterial = new THREE.MeshBasicMaterial({ color: accentLinear.clone() });
    const lens = new THREE.Mesh(lensGeometry, lensMaterial);
    lens.position.set(0, 0.16, 0.38);
    group.add(body, lens);
    group.position.set(-HALF + 0.6, y - 0.12, 1.2);
    machine.add(group);
    return { group, lensMaterial, x: -HALF + 0.6, rest: -HALF + 0.6 };
  });
  const fanGeometry = new THREE.BufferGeometry();
  fanGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.18, 0, 0, 0.18, 0, 0, -0.9, 1.25, -1.2, 0.9, 1.25, -1.2]), 3));
  fanGeometry.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array([1, 1, 0, 0]), 1));
  fanGeometry.setIndex([0, 1, 2, 1, 3, 2]);
  const fanMaterial = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOn;
      varying float vFade;
      void main() { float f = clamp(vFade, 0.0, 1.0); gl_FragColor = vec4(uColor * f * f * uOn * 0.45, 1.0); }`,
    uniforms: { uColor: { value: accentLinear.clone().lerp(new THREE.Color(1, 0.85, 0.7), 0.4) }, uOn: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const fans = heads.map((head) => {
    const fan = new THREE.Mesh(fanGeometry, fanMaterial.clone());
    fan.position.set(0, 0.2, 0.3);
    fan.renderOrder = 4;
    head.group.add(fan);
    return fan;
  });

  // Lights on the frame: a column of LEDs on each pillar's face, the slot's edge, and four pips that
  // count the spellings that fit the current key.
  const ledsPerPillar = 22;
  const ledCount = ledsPerPillar * 2 + 4 + 2;
  const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), ledCount);
  const ledBase = [];
  {
    const m = new THREE.Matrix4();
    let index = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < ledsPerPillar; i++) {
        const y = MACHINE.bottom + 0.8 + (i + 0.5) * (MACHINE_HEIGHT - 1.6) / ledsPerPillar;
        m.compose(new THREE.Vector3(side * (HALF + 0.85), y, 0.86), new THREE.Quaternion(), new THREE.Vector3(0.34, 0.2, 0.06));
        leds.setMatrixAt(index, m);
        ledBase.push({ kind: 'pillar', side, y, index });
        index += 1;
      }
    }
    for (let i = 0; i < 4; i++) {
      m.compose(new THREE.Vector3(HALF - 1.6 + i * 0.55, SLOT_TOP - 0.75, 1.1), new THREE.Quaternion(), new THREE.Vector3(0.3, 0.3, 0.06));
      leds.setMatrixAt(index, m);
      ledBase.push({ kind: 'pip', slot: i, index });
      index += 1;
    }
    for (const side of [-1, 1]) {
      m.compose(new THREE.Vector3(side * HALF * 0.5, SLOT_TOP - 0.04, 1.1), new THREE.Quaternion(), new THREE.Vector3(HALF - 0.4, 0.05, 0.05));
      leds.setMatrixAt(index, m);
      ledBase.push({ kind: 'edge', index });
      index += 1;
    }
    for (let i = 0; i < ledCount; i++) leds.setColorAt(i, new THREE.Color(0, 0, 0));
  }
  machine.add(leds);

  // The gates.
  const gateGeometry = new THREE.BoxGeometry(HALF * 2 + 0.3, 0.14, 1.9);
  const gates = GATES.map((y, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: GATE_VERTEX,
      fragmentShader: GATE_FRAGMENT,
      uniforms: {
        uColor: { value: accentLinear.clone().lerp(new THREE.Color(1, 0.8, 0.7), 0.25 + index * 0.05) },
        uHot: { value: new THREE.Color(1.0, 0.82, 0.62) },
        uSize: { value: new THREE.Vector2(HALF * 2 + 0.3, 1.9) },
        uScanX: { value: -99 },
        uScan: { value: 0 },
        uRow: { value: new THREE.Vector2(0, 0) },
        uRowOn: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(gateGeometry, material);
    mesh.position.set(0, y, 0);
    mesh.renderOrder = 2;
    machine.add(mesh);
    return { mesh, uniforms: material.uniforms, y };
  });

  // The curtain behind the rows, and the shockwave on the slot's top.
  const curtainUniforms = {
    uColor: { value: accentLinear.clone().lerp(new THREE.Color(1, 0.8, 0.65), 0.3) },
    uTime: { value: 0 },
    uRowY: { value: SPAWN_Y },
    uTop: { value: INPUT_Y - 0.5 },
    uBottom: { value: SLOT_TOP },
  };
  const curtainHeight = INPUT_Y - 0.5 - SLOT_TOP;
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, curtainHeight, 1, 1), new THREE.ShaderMaterial({
    vertexShader: LOCAL_VERTEX, fragmentShader: CURTAIN_FRAGMENT, uniforms: curtainUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  curtain.geometry.translate(0, SLOT_TOP + curtainHeight / 2, 0);
  curtain.position.z = -0.75;
  curtain.renderOrder = 1;
  machine.add(curtain);
  const shockUniforms = { uColor: { value: accentLinear.clone().lerp(new THREE.Color(1, 0.85, 0.7), 0.35) }, uRing: { value: 0 }, uHalf: { value: HALF } };
  const shock = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 0.6, 1.9), new THREE.ShaderMaterial({
    vertexShader: LOCAL_VERTEX, fragmentShader: SHOCK_FRAGMENT, uniforms: shockUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  shock.rotation.x = -Math.PI / 2;
  shock.position.set(0, SLOT_TOP + 0.015, 0);
  shock.renderOrder = 3;
  machine.add(shock);
  let shockAge = -1;

  // Readouts in the frame's own lights: the key's bytes in hex across the slot's face, and the
  // spellings still to come running along the input bar.
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--dw-font-mono').trim() || 'ui-monospace, monospace';
  function readout(width, height, planeWidth, planeHeight, color) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = anisotropy;
    const material = new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), material);
    mesh.renderOrder = 3;
    return { canvas, context: canvas.getContext('2d'), texture, material, mesh };
  }
  const hex = readout(2048, 96, HALF * 2 - 4.2, 0.46, accentLinear.clone());
  hex.mesh.position.set(-1.1, SLOT_TOP - 0.78, 1.09);
  machine.add(hex.mesh);
  function drawHex(keyUnits) {
    const { context, canvas } = hex;
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const bytes = keyUnits.flatMap((unit) => unit.bytes);
    const text = bytes.length ? bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ') : '_';
    context.font = `500 56px ${mono}`;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = '#fff';
    const size = Math.min(56, 56 * (canvas.width - 40) / Math.max(1, context.measureText(text).width));
    context.font = `500 ${size}px ${mono}`;
    context.fillText(text, 20, canvas.height / 2);
    hex.texture.needsUpdate = true;
  }
  const ticker = readout(4096, 64, HALF * 2 - 2, 0.3, accentLinear.clone().multiplyScalar(0.55));
  ticker.mesh.position.set(0, INPUT_Y - 0.02, 1.17);
  ticker.texture.wrapS = THREE.RepeatWrapping;
  ticker.texture.repeat.set(0.5, 1);
  machine.add(ticker.mesh);
  {
    const { context, canvas } = ticker;
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = `500 34px ${mono}`;
    context.textBaseline = 'middle';
    context.fillStyle = '#fff';
    const line = FAMILIES.flat().join('   \u00b7   ');
    let x = 0;
    while (x < canvas.width) {
      context.fillText(line + '   \u00b7   ', x, canvas.height / 2);
      x += context.measureText(line + '   \u00b7   ').width;
    }
    ticker.texture.needsUpdate = true;
  }

  // Sparks.
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkColors = new Float32Array(SPARKS * 3);
  const sparkSizes = new Float32Array(SPARKS);
  const sparkState = Array.from({ length: SPARKS }, () => ({ life: 0, age: 0, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, size: 0 }));
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('aColor', new THREE.BufferAttribute(sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('aSize', new THREE.BufferAttribute(sparkSizes, 1).setUsage(THREE.DynamicDrawUsage));
  const pointUniforms = { uPixel: { value: 1 }, uScale: { value: 1 } };
  const sparks = new THREE.Points(sparkGeometry, new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT, uniforms: pointUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 3;
  machine.add(sparks);
  let sparkCursor = 0;
  const rng = random(0xd7ea3);
  function burst(x, y, z, count, color, speed = 3, lift = 1.5, size = 0.16) {
    if (reduceMotion) return;
    for (let n = 0; n < count; n++) {
      const s = sparkState[sparkCursor];
      sparkCursor = (sparkCursor + 1) % SPARKS;
      const angle = rng() * Math.PI * 2;
      const up = rng() * 2 - 0.4;
      const v = speed * (0.35 + rng() * 0.8);
      s.life = 0.45 + rng() * 0.8;
      s.age = 0;
      s.vx = Math.cos(angle) * v;
      s.vy = up * v * 0.6 + lift;
      s.vz = Math.sin(angle) * v * 0.6;
      const i = (sparkCursor + SPARKS - 1) % SPARKS;
      sparkPositions[i * 3] = x;
      sparkPositions[i * 3 + 1] = y;
      sparkPositions[i * 3 + 2] = z;
      s.r = color.r;
      s.g = color.g;
      s.b = color.b;
      s.size = size * (0.6 + rng() * 0.8);
    }
  }
  function updateSparks(dt) {
    for (let i = 0; i < SPARKS; i++) {
      const s = sparkState[i];
      if (s.age >= s.life) {
        sparkColors[i * 3] = sparkColors[i * 3 + 1] = sparkColors[i * 3 + 2] = 0;
        sparkSizes[i] = 0;
        continue;
      }
      s.age += dt;
      const drag = Math.exp(-dt * 2.2);
      s.vx *= drag;
      s.vz *= drag;
      s.vy = s.vy * drag - dt * 5.5;
      sparkPositions[i * 3] += s.vx * dt;
      sparkPositions[i * 3 + 1] += s.vy * dt;
      sparkPositions[i * 3 + 2] += s.vz * dt;
      const k = 1 - s.age / s.life;
      const heat = k * k;
      sparkColors[i * 3] = s.r * (1.5 + heat * 3);
      sparkColors[i * 3 + 1] = s.g * (1.2 + heat * 3);
      sparkColors[i * 3 + 2] = s.b * (1.0 + heat * 2.5);
      sparkSizes[i] = s.size * (0.3 + 0.7 * k);
    }
    sparkGeometry.attributes.position.needsUpdate = true;
    sparkGeometry.attributes.aColor.needsUpdate = true;
    sparkGeometry.attributes.aSize.needsUpdate = true;
  }

  // Dust drifting through the frame.
  const dustCount = small ? 90 : 200;
  const dustGeometry = new THREE.BufferGeometry();
  {
    const positions = new Float32Array(dustCount * 3);
    const seeds = new Float32Array(dustCount * 4);
    const next = random(0x5eed);
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] = (next() - 0.5) * (HALF * 2 + 6);
      positions[i * 3 + 1] = (next() - 0.5) * 16;
      positions[i * 3 + 2] = (next() - 0.5) * 7 - 1;
      for (let j = 0; j < 4; j++) seeds[i * 4 + j] = next();
    }
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  }
  const dustUniforms = { uPixel: pointUniforms.uPixel, uScale: pointUniforms.uScale, uTime: { value: 0 }, uColor: { value: accentLinear.clone().lerp(new THREE.Color(1, 0.9, 0.8), 0.4).multiplyScalar(0.8) } };
  const dust = new THREE.Points(dustGeometry, new THREE.ShaderMaterial({
    vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT, uniforms: dustUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  machine.add(dust);

  // The backdrop, drawn first into the scene target.
  const skyUniforms = {
    uTop: { value: linear(bg1).multiplyScalar(0.95) },
    uBottom: { value: linear(bg0).multiplyScalar(0.85) },
    uGlow: { value: accentLinear.clone().multiplyScalar(0.08) },
    uAccent: { value: accentLinear.clone() },
    uCenter: { value: new THREE.Vector2(0.7, 0.5) },
    uHalf: { value: new THREE.Vector2(0.3, 0.4) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
  };
  const skyMaterial = fullscreenMaterial(SKY_FRAGMENT, skyUniforms);
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(quadGeometry, skyMaterial));

  // The stroke overlay.
  const TRAIL_MAX = 512;
  const trailPositions = new Float32Array(TRAIL_MAX * 2 * 3);
  const trailGlow = new Float32Array(TRAIL_MAX * 2);
  const trailIndex = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    const a = i * 2;
    trailIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setAttribute('aGlow', new THREE.BufferAttribute(trailGlow, 1).setUsage(THREE.DynamicDrawUsage));
  trailGeometry.setIndex(trailIndex);
  trailGeometry.setDrawRange(0, 0);
  const trailUniforms = { uViewport: { value: new THREE.Vector2(1, 1) }, uColor: { value: accentLinear.clone().lerp(new THREE.Color(1, 0.85, 0.65), 0.3) } };
  const trailMesh = new THREE.Mesh(trailGeometry, new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERTEX, fragmentShader: TRAIL_FRAGMENT, uniforms: trailUniforms,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  trailMesh.frustumCulled = false;
  const trailScene = new THREE.Scene();
  trailScene.add(trailMesh);
  const trailCamera = new THREE.Camera();

  // Post-processing.
  const brightMaterial = fullscreenMaterial(BRIGHT_FRAGMENT, { tInput: { value: null }, uThreshold: { value: 1.05 } });
  const blurMaterial = fullscreenMaterial(BLUR_FRAGMENT, { tInput: { value: null }, uDirection: { value: new THREE.Vector2() } });
  const copyMaterial = fullscreenMaterial(COPY_FRAGMENT, { tInput: { value: null } });
  const compositeMaterial = fullscreenMaterial(COMPOSITE_FRAGMENT, {
    tScene: { value: sceneTarget.texture },
    tBloomNear: { value: bloomTargets[0].texture },
    tBloomFar: { value: bloomTargets[2].texture },
    uCenter: skyUniforms.uCenter,
    uHalf: skyUniforms.uHalf,
    uTime: { value: 0 },
  });
  brightMaterial.uniforms.tInput.value = sceneTarget.texture;
  const postScene = new THREE.Scene();
  const postQuad = new THREE.Mesh(quadGeometry, brightMaterial);
  postScene.add(postQuad);
  const postCamera = new THREE.Camera();
  function pass(material, target) {
    postQuad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCamera);
  }
  function blur(target, scratch, radius) {
    blurMaterial.uniforms.tInput.value = target.texture;
    blurMaterial.uniforms.uDirection.value.set(radius / target.width, 0);
    pass(blurMaterial, scratch);
    blurMaterial.uniforms.tInput.value = scratch.texture;
    blurMaterial.uniforms.uDirection.value.set(0, radius / target.height);
    pass(blurMaterial, target);
  }

  // The rows --------------------------------------------------------------------------------------------

  const glyphRect = (glyph) => atlas.cells.get(glyph) || atlas.cells.get('?');
  const tintOf = (unit) => (unit.gold ? gold : isData(unit) ? dataTint : isSeparator(unit) ? separatorTint : warm);

  function layoutX(units) {
    const total = units.reduce((sum, unit) => sum + unit.bytes.length, 0);
    let cursor = -total / 2;
    return units.map((unit) => {
      const x = cursor + unit.bytes.length / 2;
      cursor += unit.bytes.length;
      return x;
    });
  }

  function makeTile(unit, x, y) {
    return {
      unit, glyphA: unit.glyph, glyphB: unit.glyph, morph: 0, x, y, z: 0, targetX: x,
      rotY: 0, rotZ: 0, sx: 1, sy: 1, sz: 1, glow: 0, dim: 1, alive: true,
      effect: null, effectStart: 0, fromX: x, lift: 0, tumble: null, tint: tintOf(unit),
    };
  }

  // The key waiting in the slot.
  let ghost = [];
  let ghostKey = null;
  let ghostRise = 1;
  let pips = 0;
  function setGhost(keyUnits, keyText) {
    if (keyText === ghostKey) return false;
    ghostKey = keyText;
    const xs = layoutX(keyUnits);
    ghost = keyUnits.map((unit, i) => ({ ...makeTile(unit, xs[i], GHOST_Y), dim: 0.28 }));
    ghostRise = 0;
    pips = 0;
    drawHex(keyUnits);
    return true;
  }

  // The current row and its timeline, in seconds at normal speed.
  const T = { enter: 0.9, fall: 0.55, scan: 0.62, settle: 0.34, land: 0.6, lock: 1.5, sink: 0.55 };
  const queue = [];
  let order = 0;
  for (const family of FAMILIES) for (const spelling of family) queue.push({ spelling, family: FAMILIES.indexOf(family) });
  let current = null;
  let falling = [];
  let stairs = null;
  let stairsAge = 0;

  function start(entry) {
    const units = parseSpelling(entry.spelling).map((unit) => ({ ...unit, gold: !!entry.gold }));
    const { stages: plan, key: keyUnits } = stages(units);
    const xs = layoutX(units);
    current = {
      entry, plan, keyUnits, keyText: keyUnits.map((u) => u.bytes.join(',')).join(' '),
      tiles: units.map((unit, i) => makeTile(unit, xs[i], SPAWN_Y + 1.8)),
      phase: 'enter', phaseTime: 0, gate: -1, speed: entry.gold ? 0.62 : 1,
      from: SPAWN_Y, to: SPAWN_Y,
    };
    current.tiles.forEach((tile, i) => { tile.sy = 0; tile.stagger = i * 0.028; });
    setGhost(keyUnits, current.keyText);
  }

  let pending = null;
  function nextEntry() {
    if (pending) {
      const entry = pending;
      pending = null;
      return entry;
    }
    const entry = queue[order % queue.length];
    order += 1;
    return entry;
  }

  function rowSpan(tiles) {
    const alive = tiles.filter((tile) => tile.alive && !tile.tumble);
    if (!alive.length) return [0, 0];
    return [Math.min(...alive.map((tile) => tile.x - tile.unit.bytes.length / 2)), Math.max(...alive.map((tile) => tile.x + tile.unit.bytes.length / 2))];
  }

  function applyEffect(tile, effect, now, row) {
    tile.effect = effect;
    tile.effectStart = now;
    if (heads[row.gate]) heads[row.gate].pulse = 1;
    const hot = row.entry.gold ? 2 : 1;
    const y = tile.y;
    if (effect === 'flip') burst(tile.x, y, 0.4, 10 * hot, separatorTint, 2.4, 1.2, 0.14);
    if (effect === 'fold') burst(tile.x, y + 0.6, 0.35, 8 * hot, warm, 2.2, 0.4, 0.12);
    if (effect === 'data') burst(tile.x, y, 0.4, 4 * hot, dataTint, 1.2, 0.8, 0.1);
    if (effect === 'drop') {
      tile.tumble = { vx: -2.2 - rng() * 1.5, vy: 3.4, spin: (rng() > 0.5 ? 1 : -1) * (5 + rng() * 4), age: 0 };
      burst(tile.x, y, 0.4, 16 * hot, separatorTint, 3.4, 1.6, 0.16);
    }
  }

  // Advance the row by dt; returns whether it is done.
  function stepRow(row, dt, now) {
    row.phaseTime += dt * row.speed;
    const t = row.phaseTime;
    const tiles = row.tiles;
    const gateIndex = row.gate;
    if (row.phase === 'enter') {
      for (const tile of tiles) {
        const k = easeOutBack((t - tile.stagger) / (T.enter - 0.3));
        tile.y = SPAWN_Y + (1 - clamp01((t - tile.stagger) / (T.enter - 0.3))) * 1.8;
        tile.sy = clamp01(k);
        tile.sx = tile.sz = clamp01(k * 1.2);
      }
      if (t >= T.enter) {
        row.phase = 'fall';
        row.phaseTime = 0;
        row.from = SPAWN_Y;
        row.to = GATES[0] + REST;
        row.gate = 0;
        for (const tile of tiles) tile.sx = tile.sy = tile.sz = 1;
      }
    } else if (row.phase === 'fall') {
      const k = easeIn(t / T.fall);
      for (const tile of tiles) if (tile.alive && !tile.tumble) tile.y = row.from + (row.to - row.from) * k;
      if (t >= T.fall) {
        row.phaseTime = 0;
        const [x0, x1] = rowSpan(tiles);
        if (gateIndex < GATES.length) {
          row.phase = 'scan';
          const gate = gates[gateIndex];
          gate.uniforms.uFlash.value = 1;
          burst(x0 - 0.2, row.to - REST + 0.1, 0.5, 6, accentLinear, 1.6, 0.6, 0.12);
          burst(x1 + 0.2, row.to - REST + 0.1, 0.5, 6, accentLinear, 1.6, 0.6, 0.12);
          row.scanFrom = x0 - 0.8;
          row.scanTo = x1 + 0.8;
          row.stage = row.plan[gateIndex];
          row.stageTiles = tiles.filter((tile) => tile.alive && !tile.tumble);
          row.triggered = new Set();
        } else {
          row.phase = 'lock';
          burst(0, LAND_Y - 0.5, 0.6, 18, accentLinear, 3, 0.8, 0.14);
        }
      }
    } else if (row.phase === 'scan') {
      const gate = gates[gateIndex];
      const sweep = clamp01(t / T.scan);
      const scanX = row.scanFrom + (row.scanTo - row.scanFrom) * ease(sweep);
      gate.uniforms.uScanX.value = scanX;
      gate.uniforms.uScan.value = bump(sweep) * 1.2 + (sweep < 1 ? 0.2 : 0);
      const aliveTiles = row.stageTiles;
      aliveTiles.forEach((tile, i) => {
        const effect = row.stage.effects[i];
        if (effect && !row.triggered.has(tile) && scanX >= tile.x) {
          row.triggered.add(tile);
          applyEffect(tile, effect, now, row);
        }
      });
      if (t >= T.scan + 0.3) {
        // Merges slide into their neighbour; drops have left; the survivors close up.
        const keep = row.stage.keep;
        const survivors = [];
        aliveTiles.forEach((tile, i) => {
          if (keep[i]) survivors.push(tile);
          else if (tile.effect === 'merge') {
            const into = [...aliveTiles.slice(0, i)].reverse().find((other, j) => keep[i - 1 - j]);
            tile.mergeInto = into || null;
          }
        });
        const xs = layoutX(survivors.map((tile) => tile.unit));
        survivors.forEach((tile, i) => { tile.fromX = tile.x; tile.targetX = xs[i]; });
        for (const tile of aliveTiles) {
          if (tile.effect === 'merge') { tile.fromX = tile.x; tile.targetX = tile.mergeInto ? tile.mergeInto.x : tile.x; }
        }
        row.phase = 'settle';
        row.phaseTime = 0;
        gate.uniforms.uScan.value = 0;
      }
    } else if (row.phase === 'settle') {
      const k = ease(t / T.settle);
      for (const tile of tiles) {
        if (!tile.alive || tile.tumble) continue;
        if (tile.effect === 'merge' && row.stage.rule === 'merge') {
          const target = tile.mergeInto ? tile.mergeInto.fromX + (tile.mergeInto.targetX - tile.mergeInto.fromX) * k : tile.targetX;
          tile.x = tile.fromX + (target - tile.fromX) * k;
          tile.sx = tile.sy = tile.sz = 1 - k;
          if (k >= 1) {
            tile.alive = false;
            burst(target, tile.y, 0.4, 14 * (row.entry.gold ? 2 : 1), separatorTint, 2.8, 1.2, 0.15);
          }
        } else tile.x = tile.fromX + (tile.targetX - tile.fromX) * k;
      }
      if (t >= T.settle) {
        for (const tile of tiles) if (tile.effect === 'merge' && tile.alive && row.stage.rule === 'merge') tile.alive = false;
        row.phase = 'fall';
        row.phaseTime = 0;
        row.from = GATES[gateIndex] + REST;
        row.gate = gateIndex + 1;
        row.to = row.gate < GATES.length ? GATES[row.gate] + REST : LAND_Y;
      }
    } else if (row.phase === 'lock') {
      const aliveTiles = tiles.filter((tile) => tile.alive && !tile.tumble);
      const press = ease(t / 0.4);
      aliveTiles.forEach((tile, i) => {
        tile.y = LAND_Y + (GHOST_Y - LAND_Y) * press;
        const g = ghost[i];
        if (g && t > 0.3 + i * 0.045 && !g.matched) {
          g.matched = now;
          burst(g.x, SLOT_TOP + 0.2, 0.7, 3 * (row.entry.gold ? 3 : 1), tile.tint, 1.4, 1.2, 0.12);
        }
      });
      if (!row.counted && t > 0.5) {
        row.counted = true;
        shockAge = 0;
        pips = Math.min(4, pips + 1);
        slotPulse = 1;
        if (row.entry.gold) celebrate(row);
      }
      if (t >= T.lock) {
        row.phase = 'sink';
        row.phaseTime = 0;
      }
    } else if (row.phase === 'sink') {
      const k = ease(t / T.sink);
      for (const tile of tiles) if (tile.alive && !tile.tumble) tile.dim = 1 - k;
      if (t >= T.sink) return true;
    }
    return false;
  }

  // Timing of tile effects, shared by the row and whatever tumbles out of it.
  function shapeTile(tile, now, dt) {
    const age = now - tile.effectStart;
    tile.glow = Math.max(0, tile.glow - dt * 1.8);
    if (tile.effect === 'flip') {
      const k = ease(age / 0.45);
      tile.rotY = Math.PI * k;
      tile.lift = bump(age / 0.45) * 0.45;
      tile.glow = Math.max(tile.glow, bump(age / 0.6) * 1.2);
    } else if (tile.effect === 'fold') {
      const k = clamp01(age / 0.28);
      tile.glyphB = tile.unit.glyph.toLowerCase();
      tile.morph = ease(k);
      tile.sy = 1 - bump(age / 0.3) * 0.22;
      tile.glow = Math.max(tile.glow, bump(age / 0.5) * 1.4);
    } else if (tile.effect === 'data') {
      tile.glow = Math.max(tile.glow, bump(age / 0.7) * 0.9);
      tile.rotZ = Math.sin(age * 22) * 0.06 * bump(age / 0.7);
    } else if (tile.effect === 'merge') {
      tile.glow = Math.max(tile.glow, 0.8);
    }
    if (tile.tumble) {
      const tumble = tile.tumble;
      tumble.age += dt;
      tumble.vy -= dt * 16;
      tile.x += tumble.vx * dt;
      tile.y += tumble.vy * dt;
      tile.rotZ += tumble.spin * dt;
      const shrink = clamp01(1 - (tumble.age - 0.5) / 0.5);
      tile.sx = tile.sy = tile.sz = shrink;
      tile.glow = Math.max(tile.glow, 0.6 * shrink);
      if (shrink <= 0) tile.alive = false;
    }
  }

  // The staircase: what a visitor drew, tidied, turned into a path of its own, and normalized in slow
  // motion. Afterwards its directories stand in the slot as the steps they were drawn as.
  const STAIR_WORDS = ['Deep', 'Down', 'Step', 'Low', 'Sub', 'Dir', 'Dark', 'Well'];
  function staircasePath(steps) {
    const next = random((Date.now() & 0xffff) ^ 0x5a17);
    const mangle = (word) => [...word].map((ch) => (next() < 0.45 ? ch.toUpperCase() : ch.toLowerCase())).join('');
    const separators = ['\\', '/', '\\\\', '//', '\\/'];
    for (let count = Math.min(steps, 6); count >= 2; count--) {
      let path = next() < 0.6 ? '\\\\' : '//';
      const words = [];
      for (let i = 0; i < count; i++) words.push(STAIR_WORDS[Math.floor(next() * STAIR_WORDS.length)]);
      path += words.map((word, i) => mangle(word) + separators[Math.floor(next() * separators.length)]).join('');
      path += mangle('You') + '.DDS';
      if (parseSpelling(path).reduce((sum, unit) => sum + unit.bytes.length, 0) <= 24) return path;
    }
    return '\\\\Down\\You.DDS';
  }

  let celebration = 0;
  let slotPulse = 0;
  function celebrate(row) {
    celebration = 1;
    const [x0, x1] = rowSpan(row.tiles);
    for (let i = 0; i < 6; i++) burst(x0 + (x1 - x0) * (i / 5), SLOT_TOP + 0.3, 0.8, 22, gold, 5.5, 3.5, 0.2);
    // The directories rise as steps: each segment one step higher than the next.
    const keyUnits = row.keyUnits;
    const xs = layoutX(keyUnits);
    let segment = 0;
    const segments = keyUnits.map((unit) => {
      const index = segment;
      if (isSeparator(unit)) segment += 1;
      return index;
    });
    const depth = Math.max(1, segment);
    stairs = keyUnits.map((unit, i) => ({
      ...makeTile({ ...unit, gold: true }, xs[i], GHOST_Y),
      stepY: GHOST_Y + 0.9 + (depth - segments[i]) * 1.15,
      dim: 1,
    }));
    stairsAge = 0;
  }

  // The hint: now and then a spark hops down four steps beside the machine, and fizzles.
  let hintAt = 14;
  function hint(now) {
    if (now < hintAt || reduceMotion) return;
    const age = now - hintAt;
    const steps = 4;
    const k = age / 2.4;
    if (k >= 1) {
      hintAt = now + 26 + rng() * 10;
      hintStep = -1;
      return;
    }
    const step = Math.min(steps - 1, Math.floor(k * steps));
    const within = k * steps - step;
    const x0 = HALF - 1.45 + step * 0.34;
    const y0 = GATES[0] + 2.35 - step * 0.52;
    const x = x0 + Math.min(1, within * 2) * 0.34;
    const y = y0 - Math.max(0, within * 2 - 1) * 0.52;
    if (rng() < 0.55) burst(x, y, 0.3, 1, accentLinear, 0.25, 0.1, 0.1);
    if (step !== hintStep) {
      hintStep = step;
      burst(x0, y0, 0.3, 4, accentLinear, 0.8, 0.4, 0.11);
    }
  }
  let hintStep = -1;

  // Instances ---------------------------------------------------------------------------------------------

  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3();
  const counts = { narrow: 0, wide: 0 };
  function pushTile(tile, hover) {
    if (!tile.alive && !tile.tumble) return;
    const wideTile = tile.unit.bytes.length > 1;
    const mesh = wideTile ? wide : narrow;
    const index = wideTile ? counts.wide : counts.narrow;
    if (index >= (wideTile ? MAX_WIDE : MAX_TILES)) return;
    if (wideTile) counts.wide += 1; else counts.narrow += 1;
    tmpPos.set(tile.x, tile.y + tile.lift + hover, tile.z);
    tmpEuler.set(0, tile.rotY, tile.rotZ);
    tmpQuat.setFromEuler(tmpEuler);
    tmpScale.set(Math.max(1e-4, tile.sx), Math.max(1e-4, tile.sy), Math.max(1e-4, tile.sz));
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(index, tmpMatrix);
    const a = glyphRect(tile.glyphA);
    const b = glyphRect(tile.glyphB);
    mesh.geometry.attributes.aGlyphA.setXYZW(index, a[0], a[1], a[2], a[3]);
    mesh.geometry.attributes.aGlyphB.setXYZW(index, b[0], b[1], b[2], b[3]);
    mesh.geometry.attributes.aState.setXYZW(index, tile.morph, tile.glow + hover * 1.6, tile.dim, 0);
    mesh.geometry.attributes.aTint.setXYZ(index, tile.tint.r, tile.tint.g, tile.tint.b);
  }
  function flushTiles() {
    for (const mesh of [narrow, wide]) {
      mesh.count = mesh === wide ? counts.wide : counts.narrow;
      mesh.instanceMatrix.needsUpdate = true;
      for (const name of ['aGlyphA', 'aGlyphB', 'aState', 'aTint']) mesh.geometry.attributes[name].needsUpdate = true;
    }
  }

  // Layout -------------------------------------------------------------------------------------------------

  let width = 1;
  let height = 1;
  let scale = 1;
  let place = { x: 0, y: 0, width: 0, height: 0, above: false };
  const anchor = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const BASE_TILT = { x: 0.16, y: -0.2 };
  const CORNERS = [];
  for (const x of [-MACHINE.halfWidth, MACHINE.halfWidth]) for (const y of [MACHINE.bottom, MACHINE.top]) for (const z of [-1, 1.6]) CORNERS.push(new THREE.Vector3(x, y, z));
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();

  function layout() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75) * quality.level;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    sceneTarget.setSize(w, h);
    bloomTargets[0].setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    bloomTargets[1].setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    bloomTargets[2].setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
    bloomTargets[3].setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    skyUniforms.uResolution.value.set(width, height);
    trailUniforms.uViewport.value.set(width, height);

    place = placement(root);
    placeStill();
    const heroText = hero.querySelector('.dw-hero__text') || hero.querySelector('.dw-shell');
    textBoxes = heroText ? textRects(heroText).map((box) => ({ left: box.left - rect.left, right: box.right - rect.left, top: box.top - rect.top, bottom: box.bottom - rect.top })) : [];
    ndc.set(place.x / width * 2 - 1, -(place.y / height * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    raycaster.ray.intersectPlane(plane, anchor);
    const unitsPerPixel = 2 * camera.position.distanceTo(anchor) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height;
    scale = Math.max(0.01, place.height * unitsPerPixel / MACHINE_HEIGHT);
    offset.set(0, -MACHINE_CENTER_Y * scale, 0);
    for (let fit = 0; fit < 3; fit++) {
      machine.scale.setScalar(scale);
      machine.rotation.set(BASE_TILT.x, BASE_TILT.y, 0);
      machine.position.copy(anchor).add(offset);
      machine.updateMatrixWorld();
      let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
      for (const corner of CORNERS) {
        tmpPos.copy(corner).applyMatrix4(machine.matrixWorld).project(camera);
        const px = (tmpPos.x + 1) / 2 * width;
        const py = (1 - tmpPos.y) / 2 * height;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const k = Math.min(place.width / Math.max(1, x1 - x0), place.height / Math.max(1, y1 - y0));
      scale *= k;
      offset.multiplyScalar(k);
      offset.x += (place.x - (x0 + x1) / 2) * unitsPerPixel;
      offset.y -= (place.y - (y0 + y1) / 2) * unitsPerPixel;
    }
    machine.scale.setScalar(scale);
    pointUniforms.uScale.value = scale;
    pointUniforms.uPixel.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    skyUniforms.uCenter.value.set(place.x / width, 1 - place.y / height);
    skyUniforms.uHalf.value.set(place.width / width * 0.62, place.height / height * 0.7);
  }

  // Pointer: a lamp in front of the machine, which leans towards it, and the tile under it lifts.
  const pointer = new THREE.Vector2(0, 0);
  const pointerPx = new THREE.Vector2(-1, -1);
  let pointerActive = false;
  let lastPointer = 0;
  let presence = 0;
  const lampTarget = new THREE.Vector3();
  const lean = new THREE.Vector2();
  const hero = root.closest('.dw-hero') || root;
  const localPointer = new THREE.Vector3(999, 999, 0);
  const facePlane = new THREE.Plane();
  const faceNormal = new THREE.Vector3();
  const ledColor = new THREE.Color();
  const ledGold = new THREE.Color();
  const pipOff = new THREE.Color(0.04, 0.02, 0.02);

  // The stroke being drawn, in pixels relative to the art.
  let stroke = null;
  let trail = null;
  function artPoint(event) {
    const rect = root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, t: performance.now() };
  }
  function onPointer(event) {
    const point = artPoint(event);
    pointerPx.set(point.x, point.y);
    pointer.set(point.x / width * 2 - 1, -(point.y / height * 2 - 1));
    pointerActive = true;
    lastPointer = performance.now();
    if (stroke && event.pointerId === stroke.id) {
      const coalesced = event.getCoalescedEvents ? event.getCoalescedEvents() : [];
      for (const sample of coalesced.length ? coalesced : [event]) {
        if (stroke.points.length < 600) stroke.points.push(artPoint(sample));
      }
    }
  }
  // A stroke starts on the art: near the machine, and not on the hero's words or controls, so
  // selecting text and pressing buttons work as they always do.
  let textBoxes = [];
  const drawable = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return false;
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest('a, button, input, select, textarea, summary, label, [contenteditable], .dw-command, .dw-strip')) return false;
    const point = artPoint(event);
    if (textBoxes.some((box) => point.x >= box.left - 6 && point.x <= box.right + 6 && point.y >= box.top - 6 && point.y <= box.bottom + 6)) return false;
    const margin = 0.2;
    return Math.abs(point.x - place.x) <= place.width * (0.5 + margin) && Math.abs(point.y - place.y) <= place.height * (0.5 + margin);
  };
  function onDown(event) {
    onPointer(event);
    if (!drawable(event) || celebrationBusy()) return;
    stroke = { id: event.pointerId, points: [artPoint(event)] };
    if (event.pointerType === 'mouse') event.preventDefault();
    try { hero.setPointerCapture(event.pointerId); } catch { /* the stroke still ends on pointerup */ }
  }
  function onUp(event) {
    if (!stroke || event.pointerId !== stroke.id) return;
    const points = stroke.points;
    stroke = null;
    const shape = readStaircase(points);
    trail = { points, age: 0, snapped: shape ? shape.corners : null, steps: shape ? shape.steps : 0 };
    if (shape) {
      pending = { spelling: staircasePath(shape.steps), gold: true };
      hintAt = Infinity;
    }
  }
  function onCancel(event) {
    if (stroke && event.pointerId === stroke.id) {
      trail = { points: stroke.points, age: 0.4, snapped: null, steps: 0 };
      stroke = null;
    }
  }
  function onLeave() {
    pointerActive = false;
  }
  const celebrationBusy = () => !!pending || !!stairs || (current && current.entry.gold);
  if (!reduceMotion) {
    hero.addEventListener('pointermove', onPointer, { passive: true });
    hero.addEventListener('pointerdown', onDown);
    hero.addEventListener('pointerup', onUp, { passive: true });
    hero.addEventListener('pointercancel', onCancel, { passive: true });
    hero.addEventListener('pointerleave', onLeave, { passive: true });
  }

  // The stroke's ribbon: while drawn it follows the pointer; a staircase snaps square and glows, and
  // anything else fades.
  function resample(points, count) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const total = lengths[lengths.length - 1] || 1;
    const out = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const target = total * i / (count - 1);
      while (j < lengths.length - 2 && lengths[j + 1] < target) j++;
      const span = lengths[j + 1] - lengths[j] || 1;
      const k = clamp01((target - lengths[j]) / span);
      const a = points[j];
      const b = points[Math.min(points.length - 1, j + 1)];
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
    return out;
  }
  function updateTrail(dt) {
    let points = null;
    let glow = 0;
    let widthPx = 3;
    if (stroke && stroke.points.length > 1) {
      points = resample(stroke.points, Math.min(TRAIL_MAX, Math.max(2, stroke.points.length)));
      glow = 0.55;
    } else if (trail) {
      trail.age += dt;
      const count = Math.min(TRAIL_MAX, 160);
      const raw = resample(trail.points, count);
      if (trail.snapped) {
        const square = resample(trail.snapped, count);
        const k = easeOutBack(trail.age / 0.45);
        points = raw.map((p, i) => ({ x: p.x + (square[i].x - p.x) * k, y: p.y + (square[i].y - p.y) * k }));
        glow = trail.age < 1.1 ? 0.8 + bump(trail.age / 1.1) * 2.2 : Math.max(0, 1.8 - (trail.age - 1.1) * 2.4);
        widthPx = 3 + bump(trail.age / 1.1) * 3;
        if (trail.age > 0.5 && !trail.released) {
          trail.released = true;
          for (const corner of trail.snapped) {
            ndc.set(corner.x / width * 2 - 1, -(corner.y / height * 2 - 1));
            raycaster.setFromCamera(ndc, camera);
            if (raycaster.ray.intersectPlane(plane, tmpPos)) {
              machine.worldToLocal(tmpPos);
              burst(tmpPos.x, tmpPos.y, 0.5, 12, gold, 3, 1, 0.2);
            }
          }
        }
        if (trail.age > 2.0) trail = null;
      } else {
        points = raw;
        glow = Math.max(0, 0.55 - trail.age * 1.4);
        if (glow <= 0) trail = null;
      }
    }
    if (!points || points.length < 2) {
      trailGeometry.setDrawRange(0, 0);
      return;
    }
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const len = Math.hypot(tx, ty);
      if (len > 1e-3) { tx /= len; ty /= len; } else { tx = 1; ty = 0; }
      const taper = Math.min(1, i / 6, (n - 1 - i) / 6) * 0.7 + 0.3;
      const half = widthPx * taper * 0.5 * (window.devicePixelRatio > 1 ? 1 : 1);
      trailPositions[i * 6] = points[i].x - ty * half;
      trailPositions[i * 6 + 1] = points[i].y + tx * half;
      trailPositions[i * 6 + 3] = points[i].x + ty * half;
      trailPositions[i * 6 + 4] = points[i].y - tx * half;
      const fade = 0.35 + 0.65 * (i / (n - 1));
      trailGlow[i * 2] = trailGlow[i * 2 + 1] = glow * fade;
    }
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.aGlow.needsUpdate = true;
    trailGeometry.setDrawRange(0, (n - 1) * 6);
  }

  // The loop -----------------------------------------------------------------------------------------------

  const clock = new THREE.Clock();
  let time = 0;
  let visible = false;
  let running = false;
  let first = true;
  let lost = false;

  // Under reduced motion one frame is drawn: the first spelling, resting on the second gate.
  function stillFrame() {
    start(queue[0]);
    order = 1;
    const row = current;
    row.phase = 'still';
    const [flip, fold] = row.plan;
    row.tiles.forEach((tile, i) => {
      tile.y = GATES[1] + REST;
      tile.sx = tile.sy = tile.sz = 1;
      if (flip.effects[i]) tile.rotY = Math.PI;
      if (fold.effects[i] === 'fold') { tile.glyphB = tile.unit.glyph.toLowerCase(); tile.morph = 1; }
    });
    ghostRise = 1;
    pips = 1;
  }

  function frame() {
    running = false;
    if (lost) return;
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    if (!reduceMotion && rawDt < 0.5) {
      quality.slow = rawDt > 1 / 40 ? quality.slow + rawDt : Math.max(0, quality.slow - rawDt * 0.5);
      if (quality.slow > 1.5 && quality.level > 0.5) {
        quality.level = Math.max(0.5, quality.level - 0.2);
        quality.slow = 0;
        layout();
      }
    }
    if (!reduceMotion) time += dt;
    skyUniforms.uTime.value = time;
    dustUniforms.uTime.value = time;
    compositeMaterial.uniforms.uTime.value = time;

    // The lamp and the lean.
    const idle = !pointerActive || performance.now() - lastPointer > 4000;
    if (idle) {
      lampTarget.set(anchor.x + Math.sin(time * 0.35) * 10 * scale, anchor.y + Math.cos(time * 0.23) * 5 * scale, anchor.z + 9 * scale);
    } else {
      raycaster.setFromCamera(pointer, camera);
      plane.constant = -(anchor.z + 8 * scale);
      if (raycaster.ray.intersectPlane(plane, tmpPos)) lampTarget.copy(tmpPos);
      plane.constant = 0;
    }
    presence += ((idle ? 0.4 : 1) - presence) * (reduceMotion ? 1 : Math.min(1, dt * 3));
    lamp.position.lerp(lampTarget, reduceMotion ? 1 : Math.min(1, dt * 6));
    lamp.intensity = presence * 9 * scale * scale;
    const dx = (lamp.position.x - anchor.x) / Math.max(scale, 1e-4);
    const dy = (lamp.position.y - anchor.y) / Math.max(scale, 1e-4);
    const follow = reduceMotion ? 1 : Math.min(1, dt * 2.2);
    lean.x += (THREE.MathUtils.clamp(-dy * 0.006, -0.05, 0.05) - lean.x) * follow;
    lean.y += (THREE.MathUtils.clamp(dx * 0.005, -0.07, 0.07) - lean.y) * follow;
    machine.rotation.set(BASE_TILT.x + lean.x + Math.sin(time * 0.21) * 0.012, BASE_TILT.y + lean.y + Math.sin(time * 0.13) * 0.03, 0);
    machine.position.set(anchor.x + offset.x, anchor.y + offset.y + Math.sin(time * 0.5) * 0.08 * scale, anchor.z + offset.z);
    machine.updateMatrixWorld();

    // Where the pointer is on the machine's face, for the tile it lifts.
    localPointer.set(999, 999, 0);
    if (!idle && pointerActive) {
      raycaster.setFromCamera(pointer, camera);
      faceNormal.set(0, 0, 1).applyQuaternion(machine.quaternion);
      facePlane.setFromNormalAndCoplanarPoint(faceNormal, machine.position);
      if (raycaster.ray.intersectPlane(facePlane, tmpPos)) localPointer.copy(machine.worldToLocal(tmpPos));
    }

    // The rows. A staircase waiting its turn clears the row in progress once its sparks have flown.
    if (pending && current && !current.entry.gold && trail && trail.released) {
      for (const tile of current.tiles) {
        if (tile.alive && !tile.tumble) tile.tumble = { vx: (rng() - 0.5) * 4, vy: 2 + rng() * 2, spin: (rng() - 0.5) * 12, age: 0 };
      }
      falling.push(...current.tiles);
      current = null;
    }
    if (!current && !stairs && !reduceMotion) start(nextEntry());
    else if (!current && reduceMotion) stillFrame();
    if (current && !reduceMotion && current.phase !== 'still') {
      if (stepRow(current, dt, time)) {
        const wasGold = current.entry.gold;
        current = null;
        if (!wasGold && !stairs) start(nextEntry());
      }
    }
    if (current) for (const tile of current.tiles) shapeTile(tile, time, reduceMotion ? 0 : dt);
    falling = falling.filter((tile) => tile.alive);
    for (const tile of falling) shapeTile(tile, time, dt);
    for (const gate of gates) {
      gate.uniforms.uFlash.value = Math.max(0, gate.uniforms.uFlash.value - dt * 2.4);
      gate.uniforms.uTime.value = time;
      gate.uniforms.uRowOn.value = 0;
    }
    for (const [g, head] of heads.entries()) {
      const scanning = !!current && current.phase === 'scan' && current.gate === g;
      const target = scanning ? gates[g].uniforms.uScanX.value : head.rest;
      head.x += (target - head.x) * (reduceMotion ? 1 : Math.min(1, dt * (scanning ? 24 : 1.4)));
      head.pulse = Math.max(0, (head.pulse || 0) - dt * 4);
      head.group.position.set(head.x, GATES[g] - 0.12 + head.pulse * 0.14, 1.2);
      head.group.rotation.z = head.pulse * 0.12 * Math.sin(time * 40);
      head.lensMaterial.color.copy(g === 1 ? warm : accentLinear).multiplyScalar(0.7 + (scanning ? 2.2 : 0) + head.pulse * 3.5);
      fans[g].material.uniforms.uOn.value = scanning ? Math.min(1, gates[g].uniforms.uScan.value) : 0;
    }
    if (current && (current.phase === 'scan' || current.phase === 'settle')) {
      const [x0, x1] = rowSpan(current.tiles);
      const gate = gates[current.gate];
      gate.uniforms.uRow.value.set(x0, x1);
      gate.uniforms.uRowOn.value = 1;
    }
    curtainUniforms.uTime.value = time;
    ticker.texture.offset.x = (time * 0.018) % 1;
    hex.material.color.copy(accentLinear).multiplyScalar(0.45 + ghostRise * 0.4 + slotPulse * 1.6 + celebration * 1.2);
    const rowTile = current?.tiles.find((tile) => tile.alive && !tile.tumble);
    curtainUniforms.uRowY.value += ((rowTile ? rowTile.y : SPAWN_Y) - curtainUniforms.uRowY.value) * Math.min(1, dt * 6);
    if (shockAge >= 0) {
      shockAge += reduceMotion ? 0 : dt;
      shockUniforms.uRing.value = Math.min(1, shockAge / 1.1);
      if (shockAge > 1.1) { shockAge = -1; shockUniforms.uRing.value = 0; }
    }
    ghostRise = Math.min(1, ghostRise + dt * 1.6);
    slotPulse = Math.max(0, slotPulse - dt * 1.3);
    celebration = Math.max(0, celebration - dt * 0.18);

    counts.narrow = 0;
    counts.wide = 0;
    const hoverOf = (tile) => {
      const d = Math.hypot(localPointer.x - tile.x, (localPointer.y - tile.y) * 0.8);
      return reduceMotion ? 0 : Math.max(0, 1 - d / 1.3) * 0.28;
    };
    for (const g of ghost) {
      const flash = g.matched ? Math.max(0, 1 - (time - g.matched) / 0.9) : 0;
      if (g.matched && time - g.matched > 1.4 && (!current || current.phase !== 'lock')) g.matched = 0;
      g.y = GHOST_Y - (1 - ease(ghostRise)) * 1.2;
      g.glow = flash * 1.8;
      g.dim = 0.3 + flash * 0.7 + slotPulse * 0.25;
      pushTile(g, 0);
    }
    if (current) for (const tile of current.tiles) pushTile(tile, current.phase === 'scan' || current.phase === 'settle' || current.phase === 'enter' ? hoverOf(tile) : 0);
    for (const tile of falling) pushTile(tile, 0);
    if (stairs) {
      stairsAge += reduceMotion ? 0 : dt;
      const rise = ease(stairsAge / 1.2);
      const fall = ease((stairsAge - 9) / 1.2);
      for (const [i, tile] of stairs.entries()) {
        tile.y = GHOST_Y + (tile.stepY - GHOST_Y) * rise * (1 - fall) + Math.sin(time * 1.6 + i * 0.4) * 0.06 * rise;
        tile.glow = 0.6 + 0.4 * Math.sin(time * 2 + i * 0.3);
        tile.rotY = Math.sin(time * 0.8 + i * 0.25) * 0.25 * rise * (1 - fall);
        tile.dim = 1 - fall;
        pushTile(tile, 0);
      }
      if (stairsAge > 10.4) {
        stairs = null;
        if (!current) start(nextEntry());
      }
    }
    flushTiles();

    // The frame's lights: LEDs at a gate glow while it acts, a chase runs while a row falls, the pips
    // count the spellings that fit, and gold runs everywhere after a staircase.
    for (const led of ledBase) {
      if (led.kind === 'pillar') {
        let level = 0.12;
        for (const [g, gate] of gates.entries()) {
          const near = Math.exp(-((led.y - GATES[g]) ** 2) * 3);
          level += near * (gate.uniforms.uScan.value * 1.5 + gate.uniforms.uFlash.value * 2);
        }
        const rowY = current?.tiles.find((tile) => tile.alive)?.y ?? SPAWN_Y;
        level += Math.exp(-((led.y - rowY) ** 2) * 1.5) * 0.9;
        const chase = 0.5 + 0.5 * Math.sin(time * 9 - led.y * 1.6 + (led.side > 0 ? Math.PI : 0));
        ledColor.copy(accentLinear).multiplyScalar(level).lerp(ledGold.copy(gold).multiplyScalar(2.5 * chase), celebration * 0.85);
      } else if (led.kind === 'pip') {
        const on = led.slot < pips;
        ledColor.copy(on ? accentLinear : pipOff).multiplyScalar(on ? 2.2 + slotPulse * 3 : 1);
        if (celebration > 0 && on) ledColor.lerp(ledGold.copy(gold).multiplyScalar(3), celebration);
      } else {
        ledColor.copy(accentLinear).multiplyScalar(0.35 + slotPulse * 2.5 + celebration * 2);
      }
      leds.setColorAt(led.index, ledColor);
    }
    leds.instanceColor.needsUpdate = true;

    hint(time);
    updateSparks(reduceMotion ? 0 : dt);
    updateTrail(reduceMotion ? 0 : dt);

    // Draw: backdrop, machine, stroke; then bloom and the composite.
    renderer.setRenderTarget(sceneTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(skyScene, postCamera);
    renderer.render(scene, camera);
    renderer.render(trailScene, trailCamera);

    brightMaterial.uniforms.tInput.value = sceneTarget.texture;
    pass(brightMaterial, bloomTargets[0]);
    blur(bloomTargets[0], bloomTargets[1], 1.0);
    blur(bloomTargets[0], bloomTargets[1], 2.0);
    copyMaterial.uniforms.tInput.value = bloomTargets[0].texture;
    pass(copyMaterial, bloomTargets[2]);
    blur(bloomTargets[2], bloomTargets[3], 1.5);
    blur(bloomTargets[2], bloomTargets[3], 3.0);
    pass(compositeMaterial, null);

    if (first) {
      first = false;
      root.classList.add('is-live');
    }
    if (visible && !reduceMotion && !document.hidden) requestFrame();
  }

  function requestFrame() {
    if (running || lost) return;
    running = true;
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    root.classList.remove('is-live');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    canvas.remove();
    still.remove();
    root.classList.remove('is-live', 'is-placed');
    mount(root);
  });

  layout();
  new ResizeObserver(() => {
    layout();
    requestFrame();
  }).observe(root);
  if (document.fonts) {
    document.fonts.ready.then(() => {
      rebuildAtlas();
      layout();
      requestFrame();
    });
  }
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (visible) {
      clock.getDelta();
      requestFrame();
    }
  }).observe(root);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) {
      clock.getDelta();
      requestFrame();
    }
  });
}

for (const root of document.querySelectorAll('[data-dw-hero-art]')) mount(root);
