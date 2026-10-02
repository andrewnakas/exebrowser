// Parkhaven - tiny WebGL2 toolkit: shaders, meshes, instancing, matrices and a mesh builder.

export function mat4() { return new Float32Array(16); }
export function ident(m = mat4()) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }
export function mul(a, b, out = mat4()) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  out.set(o); return out;
}
export function ortho(l, r, b, t, n, f, m = mat4()) {
  m.fill(0);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
  return m;
}
export function lookAt(eye, at, up, m = mat4()) {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}
/** Model matrix from a basis (forward f, side s, up u) and translation. */
export function basis(px, py, pz, f, s, u, sc = 1, m = mat4()) {
  m[0] = f[0] * sc; m[1] = f[1] * sc; m[2] = f[2] * sc; m[3] = 0;
  m[4] = s[0] * sc; m[5] = s[1] * sc; m[6] = s[2] * sc; m[7] = 0;
  m[8] = u[0] * sc; m[9] = u[1] * sc; m[10] = u[2] * sc; m[11] = 0;
  m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
  return m;
}
export function trs(px, py, pz, yaw = 0, sc = 1, m = mat4(), pitch = 0, roll = 0) {
  // yaw about z, then pitch about the local y (side) axis, then roll about local x
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const f = [cy * cp, sy * cp, sp];
  let s = [-sy, cy, 0];
  let u = [-cy * sp, -sy * sp, cp];
  if (roll) {
    const s2 = [s[0] * cr + u[0] * sr, s[1] * cr + u[1] * sr, s[2] * cr + u[2] * sr];
    const u2 = [u[0] * cr - s[0] * sr, u[1] * cr - s[1] * sr, u[2] * cr - s[2] * sr];
    s = s2; u = u2;
  }
  return basis(px, py, pz, f, s, u, sc, m);
}

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform mat4 uM; uniform vec3 uSun; uniform vec3 uLight; uniform vec4 uTint;
out vec3 vCol;
void main(){
  vec3 n = normalize(mat3(uM) * aNor);
  float d = max(dot(n, uSun), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  vec3 c = aCol * (0.34 + 0.26 * hemi + 0.58 * d) * uLight;
  vCol = mix(c, uTint.rgb, uTint.a);
  gl_Position = uVP * uM * vec4(aPos, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
in vec3 vCol; uniform float uAlpha; out vec4 o;
void main(){ o = vec4(vCol, uAlpha); }`;

// instanced people / small props. aPart selects which instance colour is used.
const VSI = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aCol;
layout(location=3) in vec4 iPos; layout(location=4) in vec3 iA; layout(location=5) in vec3 iB; layout(location=6) in vec4 iF;
uniform mat4 uVP; uniform vec3 uSun; uniform vec3 uLight;
out vec3 vCol;
void main(){
  // aCol.r encodes the part: 0 body(iA) 1 legs(iB) 2 skin 3 fixed colour in aCol.gb? -> use parts
  float part = aCol.r;
  vec3 col = part < 0.5 ? iA : part < 1.5 ? iB : part < 2.5 ? vec3(0.96, 0.78, 0.62) : part < 3.5 ? vec3(0.25, 0.18, 0.12) : vec3(0.2, 0.3, 0.75);
  vec3 p = aPos * iF.y;
  // leg swing: parts tagged 1 with aCol.g = side (+/-)
  if (part > 0.5 && part < 1.5) { float sw = sin(iF.x) * 0.06 * (aCol.g - 0.5) * 2.0; p.x += sw * (0.3 - aPos.z) * 3.0; }
  if (part > 3.5 && iF.z < 0.5) p = vec3(0.0, 0.0, -50.0);
  p.z += abs(sin(iF.x)) * 0.012 + iF.w;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 q = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z) + iPos.xyz;
  vec3 n = vec3(c * aNor.x - s * aNor.y, s * aNor.x + c * aNor.y, aNor.z);
  float d = max(dot(n, uSun), 0.0);
  vCol = col * (0.42 + 0.22 * (0.5 + 0.5 * n.z) + 0.5 * d) * uLight;
  gl_Position = uVP * vec4(q, 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

export class GL {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.main = compile(gl, VS, FS);
    this.inst = compile(gl, VSI, FS);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
  }
  mesh(data) { return new Mesh(this.gl, data); }
}

export class Mesh {
  constructor(gl, data) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (let a = 0; a < 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, a * 12); }
    gl.bindVertexArray(null);
    this.count = 0;
    if (data) this.set(data);
  }
  set(data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = data.length / 9;
  }
  /** set up per-instance attributes (vec4 pos, vec3 A, vec3 B, vec4 F = 14 floats) */
  enableInstancing() {
    const gl = this.gl;
    this.ibuf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    const st = 56;
    const lay = [[3, 4, 0], [4, 3, 16], [5, 3, 28], [6, 4, 40]];
    for (const [loc, n, off] of lay) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, st, off); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    this.icount = 0;
    return this;
  }
  setInstances(data, n) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 14), gl.DYNAMIC_DRAW);
    this.icount = n;
  }
  dispose() { const gl = this.gl; gl.deleteBuffer(this.buf); if (this.ibuf) gl.deleteBuffer(this.ibuf); gl.deleteVertexArray(this.vao); }
}

// ---------------------------------------------------------------- mesh builder
export class MB {
  constructor(cap = 4096) { this.a = new Float32Array(cap * 9); this.n = 0; }
  grow(k) {
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2;
    while (c < this.n + k) c *= 2;
    const b = new Float32Array(c); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  v(x, y, z, nx, ny, nz, c) {
    this.grow(9);
    const a = this.a, n = this.n;
    a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = nx; a[n + 4] = ny; a[n + 5] = nz; a[n + 6] = c[0]; a[n + 7] = c[1]; a[n + 8] = c[2];
    this.n = n + 9;
  }
  /** triangle with computed flat normal; if up is set, flips so normal.z >= 0 */
  tri(p, q, r, c, up = false) {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (up && nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    this.v(p[0], p[1], p[2], nx, ny, nz, c); this.v(q[0], q[1], q[2], nx, ny, nz, c); this.v(r[0], r[1], r[2], nx, ny, nz, c);
  }
  /** quad p q r s (in order) with explicit normal */
  quadN(p, q, r, s, n, c) {
    this.v(p[0], p[1], p[2], n[0], n[1], n[2], c); this.v(q[0], q[1], q[2], n[0], n[1], n[2], c); this.v(r[0], r[1], r[2], n[0], n[1], n[2], c);
    this.v(p[0], p[1], p[2], n[0], n[1], n[2], c); this.v(r[0], r[1], r[2], n[0], n[1], n[2], c); this.v(s[0], s[1], s[2], n[0], n[1], n[2], c);
  }
  quad(p, q, r, s, c, up = false) { this.tri(p, q, r, c, up); this.tri(p, r, s, c, up); }
  /** axis-aligned box from (x0,y0,z0) to (x1,y1,z1); colTop optional */
  box(x0, y0, z0, x1, y1, z1, c, cTop = c) {
    this.quadN([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], cTop);
    this.quadN([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], c);
    this.quadN([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], c);
    this.quadN([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], c);
    this.quadN([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], c);
    this.quadN([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], c);
  }
  /** box centred at (cx,cy) with half sizes, rotated by yaw */
  rbox(cx, cy, z0, hx, hy, z1, yaw, c, cTop = c) {
    if (!yaw) return this.box(cx - hx, cy - hy, z0, cx + hx, cy + hy, z1, c, cTop);
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * co - y * si, cy + x * si + y * co, z];
    const R = (x, y) => [x * co - y * si, x * si + y * co, 0];
    const a = P(-hx, -hy, z0), b = P(hx, -hy, z0), cc = P(hx, hy, z0), d = P(-hx, hy, z0);
    const A = P(-hx, -hy, z1), B = P(hx, -hy, z1), C = P(hx, hy, z1), D = P(-hx, hy, z1);
    this.quadN(A, B, C, D, [0, 0, 1], cTop);
    this.quadN(a, d, cc, b, [0, 0, -1], c);
    this.quadN(a, b, B, A, R(0, -1), c);
    this.quadN(d, D, C, cc, R(0, 1), c);
    this.quadN(a, A, D, d, R(-1, 0), c);
    this.quadN(b, cc, C, B, R(1, 0), c);
  }
  /** vertical cylinder / prism */
  cyl(cx, cy, z0, z1, r, seg, c, cTop = c, r1 = r) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p = [cx + c0 * r, cy + s0 * r, z0], q = [cx + c1 * r, cy + s1 * r, z0];
      const P = [cx + c0 * r1, cy + s0 * r1, z1], Q = [cx + c1 * r1, cy + s1 * r1, z1];
      const am = (a0 + a1) / 2;
      const slope = (r - r1) / Math.max(1e-3, z1 - z0);
      const nl = Math.hypot(1, slope);
      const n = [Math.cos(am) / nl, Math.sin(am) / nl, slope / nl];
      this.quadN(p, q, Q, P, n, c);
      if (r1 > 0) this.v(cx, cy, z1, 0, 0, 1, cTop), this.v(P[0], P[1], z1, 0, 0, 1, cTop), this.v(Q[0], Q[1], z1, 0, 0, 1, cTop);
    }
  }
  cone(cx, cy, z0, z1, r, seg, c) { this.cyl(cx, cy, z0, z1, r, seg, c, c, 0.001); }
  /** low-poly blob (octahedron-ish sphere) */
  blob(cx, cy, cz, rx, ry, rz, c, seg = 6) {
    const rings = 4;
    const pt = (i, j) => {
      const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
      return [cx + Math.sin(th) * Math.cos(ph) * rx, cy + Math.sin(th) * Math.sin(ph) * ry, cz + Math.cos(th) * rz];
    };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      const mx = (a[0] + cc[0]) / 2 - cx, my = (a[1] + cc[1]) / 2 - cy, mz = (a[2] + cc[2]) / 2 - cz;
      const l = Math.hypot(mx / rx, my / ry, mz / rz) || 1;
      const n = [mx / rx / l, my / ry / l, mz / rz / l];
      if (j === 0) { this.v(a[0], a[1], a[2], n[0], n[1], n[2], c); this.v(cc[0], cc[1], cc[2], n[0], n[1], n[2], c); this.v(d[0], d[1], d[2], n[0], n[1], n[2], c); }
      else if (j === rings - 1) { this.v(a[0], a[1], a[2], n[0], n[1], n[2], c); this.v(b[0], b[1], b[2], n[0], n[1], n[2], c); this.v(d[0], d[1], d[2], n[0], n[1], n[2], c); }
      else this.quadN(a, b, cc, d, n, c);
    }
  }
  /** a beam between two points with square cross-section w, oriented with 'up' hint */
  beam(p, q, w, c, up = [0, 0, 1]) {
    let fx = q[0] - p[0], fy = q[1] - p[1], fz = q[2] - p[2];
    const l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    let sx = fy * up[2] - fz * up[1], sy = fz * up[0] - fx * up[2], sz = fx * up[1] - fy * up[0];
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) { sx = 1; sy = 0; sz = 0; sl = 1; }
    sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
    const h = w / 2;
    const corner = (o, a, b) => [o[0] + (sx * a + ux * b) * h, o[1] + (sy * a + uy * b) * h, o[2] + (sz * a + uz * b) * h];
    const P = [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
    const Q = [corner(q, -1, -1), corner(q, 1, -1), corner(q, 1, 1), corner(q, -1, 1)];
    const N = [[-ux, -uy, -uz], [sx, sy, sz], [ux, uy, uz], [-sx, -sy, -sz]];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) & 3;
      this.quadN(P[k], P[k2], Q[k2], Q[k], N[k], c);
    }
  }
  data() { return this.a.subarray(0, this.n); }
}

export function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }
export function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
