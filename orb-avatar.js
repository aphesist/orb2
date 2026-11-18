/*!
 * <orb-avatar> v2 — expressive geometric avatars with custom body silhouettes & heavy shape-shifting eyes.
 * Zero-dependency Web Component rendered on <canvas> with crisp SVG export.
 * Docs: https://github.com/aphesist/orb2 · Demo: https://aphesist.github.io/orb2/
 * MIT License © 2026 Enzo Vasconcelos
 */
(() => {
'use strict';
if (typeof window === 'undefined' || !window.customElements || customElements.get('orb-avatar')) return;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, p) => a + (b - a) * p;
const f4 = n => n.toFixed(4);
const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const on = v => v !== null && v !== 'false' && v !== 'off';

/* Smooth C2 quintic & asymmetric cushion curves — no acceleration jerk at endpoints */
const smooth5 = x => { const t = clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const lush = x => {                 // brisk launch (~26%), long silky cushion (~74%)
  const t = clamp(x, 0, 1);
  return t < .28 ? 0.5 * Math.pow(t / .28, 2.2) * .38 : 1 - 0.81 * Math.pow((1 - t) / .72, 3.1);
};
const easeMorph = x => { const t = clamp(x, 0, 1); return .45 * smooth5(t) + .55 * (1 - Math.pow(1 - t, 3.4)); };
const backOut = (x, c = 1.45) => { const t = clamp(x, 0, 1) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const env = (e, a, b, c, d) => e < a ? 0 : e < b ? smooth5((e - a) / (b - a)) : e < c ? 1 : e < d ? 1 - smooth5((e - c) / (d - c)) : 0;
const pulse = (e, at, dur) => { const q = (e - at) / dur; return q > 0 && q < 1 ? Math.sin(q * Math.PI) : 0; };

/* ==========================================================================
   1. POLYGON RESAMPLING & GEOMETRIC PRIMITIVES
   ========================================================================== */

function signedArea(P) {
  let A = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    A += a[0] * b[1] - b[0] * a[1];
  }
  return A * 0.5;
}

function polyCentroid(P) {
  let A = 0, cx = 0, cy = 0, n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], cross = a[0] * b[1] - b[0] * a[1];
    A += cross; cx += (a[0] + b[0]) * cross; cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(A) < 1e-7) {
    for (const p of P) { cx += p[0]; cy += p[1]; }
    return [cx / (n || 1), cy / (n || 1)];
  }
  return [cx / (3 * A), cy / (3 * A)];
}

/**
 * Resample any closed outline to `N` arc-length-uniform points with consistent winding
 * and starting anchor at top-center (12 o'clock) so symmetric shapes morph symmetrically.
 * `yUp = true` for face space (+b is up), `yUp = false` for canvas body space (+y is down).
 */
function resample(P, N, yUp = true) {
  if (!P || P.length < 3) return Array.from({ length: N }, () => [0, 0]);
  const area = signedArea(P);
  // Clockwise visually: in yUp (+y up) signedArea < 0; in yDown (+y down) signedArea > 0
  if (yUp ? area > 0 : area < 0) P = P.slice().reverse();
  const [cx, cy] = polyCentroid(P);
  const topY = yUp ? 1 : -1;

  // Insert exact intersection or closest vertex near 12 o'clock (dx = 0, dy in top direction)
  let bestIdx = 0, bestScore = 1e9;
  for (let i = 0; i < P.length; i++) {
    const dx = P[i][0] - cx, dy = (P[i][1] - cy) * topY;
    const ang = Math.abs(Math.atan2(dx, dy));
    if (ang < bestScore) { bestScore = ang; bestIdx = i; }
  }
  const Q = P.slice(bestIdx).concat(P.slice(0, bestIdx));
  const n = Q.length, L = [0];
  for (let i = 1; i <= n; i++) {
    const a = Q[i - 1], b = Q[i % n];
    L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const tot = L[n] || 1, out = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const d = tot * k / N;
    while (j < n - 1 && L[j + 1] < d) j++;
    const a = Q[j], b = Q[(j + 1) % n], seg = L[j + 1] - L[j];
    const t = seg > 1e-8 ? (d - L[j]) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/* ---------- Heavy, bold face-space primitives (+a right, +b up, units = ball radii) ---------- */

function rotPt(x, y, cx, cy, ang) {
  if (!ang) return [x, y];
  const c = Math.cos(ang), s = Math.sin(ang), dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/**
 * Rounded rectangle / true stadium capsule.
 * When `r >= min(w, h)/2`, produces an exact geometric pill with semicircular caps.
 */
function rrect(cx, cy, w, h, r = Math.min(w, h) / 2, ang = 0, capSegs = 14) {
  const hw = w / 2, hh = h / 2, cr = clamp(r, 0.002, Math.min(hw, hh));
  const ix = hw - cr, iy = hh - cr, pts = [];
  // Clockwise in y-up space: top-center -> top-right -> bottom-right -> bottom-left -> top-left
  const arc = (ox, oy, a0, a1, n) => {
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      pts.push(rotPt(cx + ox + Math.cos(a) * cr, cy + oy + Math.sin(a) * cr, cx, cy, ang));
    }
  };
  const line = (x0, y0, x1, y1, n = 4) => {
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push(rotPt(cx + lerp(x0, x1, t), cy + lerp(y0, y1, t), cx, cy, ang));
    }
  };
  if (ix > 1e-4) line(0, hh, ix, hh, 3);
  arc(ix, iy, Math.PI / 2, 0, capSegs);
  if (iy > 1e-4) line(hw, iy, hw, -iy, 6);
  arc(ix, -iy, 0, -Math.PI / 2, capSegs);
  if (ix > 1e-4) line(ix, -hh, -ix, -hh, 6);
  arc(-ix, -iy, -Math.PI / 2, -Math.PI, capSegs);
  if (iy > 1e-4) line(-hw, -iy, -hw, iy, 6);
  arc(-ix, iy, Math.PI, Math.PI / 2, capSegs);
  if (ix > 1e-4) line(-ix, hh, 0, hh, 3);
  return pts;
}

const pill = (cx, cy, w, h, ang = 0) => rrect(cx, cy, w, h, Math.min(w, h) / 2, ang, 16);
const superE = (cx, cy, w, h, n = 2.8, N = 64, ang = 0) => {
  const p = [];
  for (let i = 0; i < N; i++) {
    const t = Math.PI / 2 - i / N * TAU, c = Math.cos(t), s = Math.sin(t);
    p.push(rotPt(cx + w / 2 * Math.sign(c) * Math.abs(c) ** (2 / n), cy + h / 2 * Math.sign(s) * Math.abs(s) ** (2 / n), cx, cy, ang));
  }
  return p;
};
const ell = (cx, cy, rx, ry = rx, N = 56) => superE(cx, cy, rx * 2, ry * 2, 2, N);
const qb = (a, b, c, N = 24) => {
  const p = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    p.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
  }
  return p;
};
const polyline = (pts, N = 12) => {
  const p = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    for (let k = 0; k < N; k++) { const t = k / N; p.push([lerp(A[0], B[0], t), lerp(A[1], B[1], t)]); }
  }
  p.push(pts[pts.length - 1]);
  return p;
};

/** Heavy round-capped stroke outline in face space */
function stroke(pts, w) {
  const h = w / 2, n = pts.length, L = [], R = [];
  const tan = i => {
    const A = pts[Math.max(0, i - 1)], B = pts[Math.min(n - 1, i + 1)];
    const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  for (let i = 0; i < n; i++) {
    const [tx, ty] = tan(i);
    L.push([pts[i][0] - ty * h, pts[i][1] + tx * h]);
    R.push([pts[i][0] + ty * h, pts[i][1] - tx * h]);
  }
  const out = L.slice(), tE = tan(n - 1), tS = tan(0), PE = pts[n - 1], PS = pts[0];
  for (let k = 1; k < 14; k++) {
    const a = Math.PI * k / 14, c = Math.cos(a), s = Math.sin(a);
    out.push([PE[0] + (-tE[1] * c + tE[0] * s) * h, PE[1] + (tE[0] * c + tE[1] * s) * h]);
  }
  for (let i = n - 1; i >= 0; i--) out.push(R[i]);
  for (let k = 1; k < 14; k++) {
    const a = Math.PI * k / 14, c = Math.cos(a), s = Math.sin(a);
    out.push([PS[0] + (tS[1] * c - tS[0] * s) * h, PS[1] + (-tS[0] * c - tS[1] * s) * h]);
  }
  return out;
}

function heavyPlus(cx, cy, span = .30, thick = .135) {
  const h = span / 2, t = thick / 2, ir = .022, pts = [];
  const arc = (ox, oy, rad, a0, a1, n = 8) => {
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([cx + ox + Math.cos(a) * rad, cy + oy + Math.sin(a) * rad]); }
  };
  arc(0, h - t, t, Math.PI, 0, 10);                                  // top round cap
  arc(t + ir, t + ir, ir, Math.PI, Math.PI * 1.5, 4);                // inner TR fillet
  arc(h - t, 0, t, Math.PI * 0.5, -Math.PI * 0.5, 10);               // right round cap
  arc(t + ir, -t - ir, ir, Math.PI * 0.5, Math.PI, 4);               // inner BR fillet
  arc(0, -h + t, t, 0, -Math.PI, 10);                                // bottom round cap
  arc(-t - ir, -t - ir, ir, 0, Math.PI * 0.5, 4);                    // inner BL fillet
  arc(-h + t, 0, t, -Math.PI * 0.5, -Math.PI * 1.5, 10);             // left round cap (clockwise via -PI)
  arc(-t - ir, t + ir, ir, -Math.PI * 0.5, 0, 4);                    // inner TL fillet
  return pts;
}

/**
 * Plush, zero-pointy Bauhaus capsule heart: union of two perpendicular round-capped pills
 * rotated 45°, with a full circular bottom cap and smooth concave top fillet.
 */
function pillHeart(cx, cy, s = 1) {
  const R = .080 * s, L = .112 * s, ir = .022 * s, S2 = Math.SQRT1_2;
  const yOff = L * S2 * 0.48, pts = [];
  const pushUV = (u, v) => pts.push([cx + (u - v) * S2, cy + (u + v) * S2 - yOff]);
  const arcUV = (ou, ov, rad, a0, a1, n) => {
    for (let i = 0; i <= n; i++) {
      const a = lerp(a0, a1, i / n);
      pushUV(ou + Math.cos(a) * rad, ov + Math.sin(a) * rad);
    }
  };
  const lineUV = (u0, v0, u1, v1, n = 5) => {
    for (let i = 1; i < n; i++) { const t = i / n; pushUV(lerp(u0, u1, t), lerp(v0, v1, t)); }
  };
  arcUV(R + ir, R + ir, ir, Math.PI, Math.PI * 1.5, 6);     // smooth concave top cleft
  lineUV(R + ir, R, L, R, 3);
  arcUV(L, 0, R, Math.PI * 0.5, -Math.PI * 0.5, 14);        // right pill lobe
  lineUV(L, -R, 0, -R, 6);
  arcUV(0, 0, R, -Math.PI * 0.5, -Math.PI, 10);             // plush circular bottom cap (no point!)
  lineUV(-R, 0, -R, L, 6);
  arcUV(0, L, R, Math.PI, 0, 14);                           // left pill lobe
  lineUV(R, L, R, R + ir, 3);
  return pts;
}

/** Plush round-nosed chevron (`>` or `<`) built from two round-capped capsules with circular vertex */
function pillChevron(cx, cy, pointDir = 1, arm = .20, R = .058, halfAng = 0.66) {
  const ca = Math.cos(halfAng), sa = Math.sin(halfAng), xOff = pointDir * arm * ca * 0.42;
  const vx = cx + xOff, vy = cy, outA = Math.PI * 0.5 - halfAng, inA = Math.PI * 1.5 - halfAng, pts = [];
  const push = (dx, dy) => pts.push([vx + dx * pointDir, vy + dy]);
  const arc = (ox, oy, rad, a0, a1, n = 10) => {
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); push(ox + Math.cos(a) * rad, oy + Math.sin(a) * rad); }
  };
  const line = (x0, y0, x1, y1, n = 4) => {
    for (let i = 1; i < n; i++) { const t = i / n; push(lerp(x0, x1, t), lerp(y0, y1, t)); }
  };
  const ir = .018, dIn = (R + ir) / sa;
  arc(0, 0, R, outA, -outA, 10);                                              // plush round nose cap
  line(R * Math.cos(-outA), R * Math.sin(-outA), -arm * ca + R * Math.cos(-outA), -arm * sa + R * Math.sin(-outA), 5);
  arc(-arm * ca, -arm * sa, R, -outA, -inA, 12);                              // lower arm round cap
  line(-arm * ca - R * sa, -arm * sa + R * ca, -dIn + ir * sa, -ir * ca, 4);
  arc(-dIn, 0, ir, -outA, outA, 6);                                           // smooth inner nook
  line(-dIn + ir * sa, ir * ca, -arm * ca - R * sa, arm * sa - R * ca, 4);
  arc(-arm * ca, arm * sa, R, inA, outA, 12);                                 // upper arm round cap
  line(-arm * ca + R * Math.cos(outA), arm * sa + R * Math.sin(outA), R * Math.cos(outA), R * Math.sin(outA), 5);
  return pts;
}

const heart = (cx, cy, s = .30) => pillHeart(cx, cy, s / .30);

/* ==========================================================================
   2. SVG PATH PARSER & BODY SHAPE SYSTEM (Presets + Custom SVG Compatibility)
   ========================================================================== */

const BODY_N = 192;

function svgArcToPts(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-6 || ry < 1e-6) return [[x2, y2]];
  const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cp * dx2 + sp * dy2, y1p = -sp * dx2 + cp * dy2;
  let rxSq = rx * rx, rySq = ry * ry;
  const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
  const lam = x1pSq / rxSq + y1pSq / rySq;
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rxSq = rx * rx; rySq = ry * ry; }
  const sign = (fa === fs) ? -1 : 1;
  const numr = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
  const den = rxSq * y1pSq + rySq * x1pSq || 1;
  const coef = sign * Math.sqrt(numr / den);
  const cxp = coef * (rx * y1p / ry), cyp = coef * (-ry * x1p / rx);
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const vAng = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(clamp(dot / len, -1, 1));
  };
  const th1 = vAng(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = vAng((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= TAU;
  if (fs && dth < 0) dth += TAU;
  const steps = Math.max(8, Math.ceil(Math.abs(dth) / (Math.PI / 18))), pts = [];
  for (let i = 1; i <= steps; i++) {
    const a = th1 + dth * i / steps, ex = rx * Math.cos(a), ey = ry * Math.sin(a);
    pts.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
  return pts;
}

/** Parse any SVG `d` path string into dense contours; returns largest outer contour */
function parseSVGPath(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return null;
  const contours = [];
  let cur = [], x = 0, y = 0, sx = 0, sy = 0, cx2 = 0, cy2 = 0, qx2 = 0, qy2 = 0, cmd = '', prev = '', idx = 0;
  const next = () => parseFloat(tokens[idx++]);
  const nextFlag = () => {
    const tok = tokens[idx];
    if (tok === '0' || tok === '1') { idx++; return +tok; }
    // Compact arc flag syntax like `a10 10 0 015 5`
    if (/^[01]/.test(tok)) {
      const f = +tok[0];
      tokens[idx] = tok.slice(1);
      return f;
    }
    return next();
  };
  const isCmd = t => /^[a-zA-Z]$/.test(t);

  while (idx < tokens.length) {
    if (isCmd(tokens[idx])) cmd = tokens[idx++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    else if (!cmd) break;

    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'M') {
      if (cur.length > 2) contours.push(cur);
      const nx = next() + (rel ? x : 0), ny = next() + (rel ? y : 0);
      x = sx = nx; y = sy = ny; cur = [[x, y]];
    } else if (C === 'Z') {
      if (cur.length > 2) { contours.push(cur); cur = []; }
      x = sx; y = sy;
    } else if (C === 'L' || C === 'H' || C === 'V') {
      const nx = C === 'V' ? x : next() + (rel ? x : 0);
      const ny = C === 'H' ? y : next() + (rel ? y : 0);
      const dist = Math.hypot(nx - x, ny - y), n = Math.max(1, Math.ceil(dist / 4));
      for (let i = 1; i <= n; i++) cur.push([lerp(x, nx, i / n), lerp(y, ny, i / n)]);
      x = nx; y = ny;
    } else if (C === 'C' || C === 'S') {
      const x1 = C === 'S' ? ((prev === 'C' || prev === 'S') ? 2 * x - cx2 : x) : next() + (rel ? x : 0);
      const y1 = C === 'S' ? ((prev === 'C' || prev === 'S') ? 2 * y - cy2 : y) : next() + (rel ? y : 0);
      const x2 = next() + (rel ? x : 0), y2 = next() + (rel ? y : 0);
      const x3 = next() + (rel ? x : 0), y3 = next() + (rel ? y : 0);
      for (let i = 1; i <= 20; i++) {
        const t = i / 20, u = 1 - t;
        cur.push([
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
        ]);
      }
      cx2 = x2; cy2 = y2; x = x3; y = y3;
    } else if (C === 'Q' || C === 'T') {
      const x1 = C === 'T' ? ((prev === 'Q' || prev === 'T') ? 2 * x - qx2 : x) : next() + (rel ? x : 0);
      const y1 = C === 'T' ? ((prev === 'Q' || prev === 'T') ? 2 * y - qy2 : y) : next() + (rel ? y : 0);
      const x2 = next() + (rel ? x : 0), y2 = next() + (rel ? y : 0);
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        cur.push([u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2]);
      }
      qx2 = x1; qy2 = y1; x = x2; y = y2;
    } else if (C === 'A') {
      const rx = next(), ry = next(), rot = next(), fa = nextFlag(), fs = nextFlag();
      const nx = next() + (rel ? x : 0), ny = next() + (rel ? y : 0);
      for (const p of svgArcToPts(x, y, rx, ry, rot, fa, fs, nx, ny)) cur.push(p);
      x = nx; y = ny;
    } else {
      break;
    }
    prev = C;
  }
  if (cur.length > 2) contours.push(cur);
  if (!contours.length) return null;
  contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  return contours[0];
}

/** Extract points from an `<svg>` element or markup string (supports path, circle, ellipse, rect, polygon) */
function extractFromSVGElement(svgEl) {
  const candidates = [];
  for (const el of svgEl.querySelectorAll('path,polygon,rect,circle,ellipse')) {
    const tag = el.tagName.toLowerCase();
    let pts = null;
    if (tag === 'path') {
      const d = el.getAttribute('d');
      if (d) pts = parseSVGPath(d);
    } else if (tag === 'polygon') {
      const raw = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      if (raw.length >= 6) {
        const poly = [];
        for (let i = 0; i + 1 < raw.length; i += 2) poly.push([raw[i], raw[i + 1]]);
        pts = polyline([...poly, poly[0]], 16);
      }
    } else if (tag === 'rect') {
      const w = num(el.getAttribute('width'), 100), h = num(el.getAttribute('height'), 100);
      const x = num(el.getAttribute('x'), 0) + w / 2, y = num(el.getAttribute('y'), 0) + h / 2;
      const rx = num(el.getAttribute('rx') ?? el.getAttribute('ry'), 0);
      pts = rrect(x, y, w, h, rx, 0, 14);
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = num(el.getAttribute('cx'), 0), cy = num(el.getAttribute('cy'), 0);
      const rx = num(el.getAttribute('rx') ?? el.getAttribute('r'), 50);
      const ry = num(el.getAttribute('ry') ?? el.getAttribute('r'), 50);
      pts = ell(cx, cy, rx, ry, 96);
    }
    if (pts && pts.length > 2) candidates.push(pts);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  return candidates[0];
}

/** Signed distance from `(px, py)` to polygon `P` (+ inside, - outside) */
function signedDistPoly(px, py, P) {
  let inside = false, minD2 = Infinity;
  for (let i = 0, n = P.length, j = n - 1; i < n; j = i++) {
    const ax = P[i][0], ay = P[i][1], bx = P[j][0], by = P[j][1];
    if (((ay > py) !== (by > py)) && (px < (bx - ax) * (py - ay) / (by - ay || 1e-9) + ax)) inside = !inside;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    const ex = ax + t * dx - px, ey = ay + t * dy - py, d2 = ex * ex + ey * ey;
    if (d2 < minD2) minD2 = d2;
  }
  return (inside ? 1 : -1) * Math.sqrt(minD2);
}

/** Normalize raw contour into `[-1, 1]²` canvas body space (+y down) and compute 3D face placement metadata */
function compileBodyShape(rawPts, opts = {}) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of rawPts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const bw = (maxX - minX) || 1, bh = (maxY - minY) || 1, scale = 2 / Math.max(bw, bh);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const norm = rawPts.map(([x, y]) => [(x - midX) * scale, (y - midY) * scale]);
  const pts = resample(norm, BODY_N, false);

  // Find visual face center: blend area centroid + pole of inaccessibility (largest inscribed circle)
  const [cx, cy] = polyCentroid(pts);
  let bestX = cx, bestY = cy, bestR = signedDistPoly(cx, cy, pts);
  for (let step of [0.28, 0.08, 0.025]) {
    let bx = bestX, by = bestY;
    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -3; gy <= 3; gy++) {
        const tx = bx + gx * step, ty = by + gy * step;
        if (Math.abs(tx) > .95 || Math.abs(ty) > .95) continue;
        const d = signedDistPoly(tx, ty, pts);
        if (d > bestR) { bestR = d; bestX = tx; bestY = ty; }
      }
    }
  }
  const ox = opts.faceCenter ? opts.faceCenter[0] : (Math.abs(cx * .4 + bestX * .6) < .03 ? 0 : cx * .4 + bestX * .6);
  const oy = opts.faceCenter ? opts.faceCenter[1] : (Math.abs(cy * .35 + bestY * .65) < .03 ? 0 : cy * .35 + bestY * .65);

  // Measure horizontal & vertical clearance from `(ox, oy)` for natural 3D gaze travel
  const rayDist = (dx, dy) => {
    let lo = 0, hi = 1.4;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (signedDistPoly(ox + dx * m, oy + dy * m, pts) > 0) lo = m; else hi = m;
    }
    return lo;
  };
  const rx = clamp(Math.min(rayDist(1, 0), rayDist(-1, 0)), 0.42, 1.05);
  const ry = clamp(Math.min(rayDist(0, 1), rayDist(0, -1)), 0.42, 1.05);
  const inR = clamp(bestR, 0.45, 1.0);
  const fScale = opts.faceScale ?? clamp(Math.pow(inR, 0.68), 0.68, 1.04);

  // Floor Y (maximum y in canvas space) for grounded shadow & squash
  let floorY = -Infinity;
  for (const p of pts) if (p[1] > floorY) floorY = p[1];

  return { pts, ox, oy, rx, ry, fScale, floorY, label: opts.label || 'Custom' };
}

/* ---------- Built-in Body Silhouettes ---------- */
const SHAPES = {};
const customShapeCache = new Map();

function regShape(name, label, pts, opts = {}) {
  SHAPES[name] = compileBodyShape(pts, { label, ...opts });
}

// Polar generator in canvas space (+y down, starting from top -PI/2 clockwise)
function polarBody(fn, N = 192) {
  const p = [];
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + i / N * TAU, r = fn(a);
    p.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return p;
}
function superBody(w, h, n = 2, rot = 0, N = 192) {
  const p = [];
  for (let i = 0; i < N; i++) {
    const t = -Math.PI / 2 + i / N * TAU, c = Math.cos(t), s = Math.sin(t);
    const x = w * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = h * Math.sign(s) * Math.abs(s) ** (2 / n);
    p.push(rotPt(x, y, 0, 0, rot));
  }
  return p;
}
function roundedPolyBody(sides, radius = 1, cornerR = 0.28, rotOffset = -Math.PI / 2) {
  const verts = [];
  for (let i = 0; i < sides; i++) {
    const a = rotOffset + i / sides * TAU;
    verts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const pts = [], halfAng = Math.PI * (sides - 2) / (2 * sides), dTrim = cornerR / Math.tan(halfAng);
  for (let i = 0; i < sides; i++) {
    const prev = verts[(i - 1 + sides) % sides], cur = verts[i], next = verts[(i + 1) % sides];
    const ux = prev[0] - cur[0], uy = prev[1] - cur[1], ul = Math.hypot(ux, uy) || 1;
    const vx = next[0] - cur[0], vy = next[1] - cur[1], vl = Math.hypot(vx, vy) || 1;
    const p1 = [cur[0] + ux / ul * dTrim, cur[1] + uy / ul * dTrim];
    const p2 = [cur[0] + vx / vl * dTrim, cur[1] + vy / vl * dTrim];
    const bx = ux / ul + vx / vl, by = uy / ul + vy / vl, bl = Math.hypot(bx, by) || 1;
    const distC = cornerR / Math.sin(halfAng);
    const cx = cur[0] + bx / bl * distC, cy = cur[1] + by / bl * distC;
    const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
    let da = Math.atan2(p2[1] - cy, p2[0] - cx) - a1;
    while (da <= -Math.PI) da += TAU;
    while (da > Math.PI) da -= TAU;
    for (let k = 0; k <= 16; k++) {
      const a = a1 + da * k / 16;
      pts.push([cx + Math.cos(a) * cornerR, cy + Math.sin(a) * cornerR]);
    }
    const nextPrev = verts[i], nextCur = next;
    const nux = nextPrev[0] - nextCur[0], nuy = nextPrev[1] - nextCur[1], nul = Math.hypot(nux, nuy) || 1;
    const np1 = [nextCur[0] + nux / nul * dTrim, nextCur[1] + nuy / nul * dTrim];
    for (let k = 1; k < 8; k++) pts.push([lerp(p2[0], np1[0], k / 8), lerp(p2[1], np1[1], k / 8)]);
  }
  return pts;
}

regShape('circle', 'Circle', polarBody(() => 1), { faceCenter: [0, 0], faceScale: 1 });
regShape('squircle', 'Squircle', superBody(1, 1, 3.7), { faceCenter: [0, 0], faceScale: 1 });
regShape('soft', 'Soft', (() => {
  // Plush mallow pillow: gently wider, warm grounded base
  const p = [];
  for (let i = 0; i < 192; i++) {
    const t = -Math.PI / 2 + i / 192 * TAU, s = Math.sin(t), c = Math.cos(t);
    const bulge = 1 + 0.08 * Math.max(0, s) - 0.04 * Math.max(0, -s);
    p.push([c * 1.02 * bulge, s * 0.94]);
  }
  return p;
})(), { faceCenter: [0, 0.03], faceScale: 0.98 });
regShape('tall', 'Tall', rrect(0, 0, 1.46, 2.0, 0.73, 0, 24).map(([x, y]) => [x, -y]), { faceCenter: [0, -0.06], faceScale: 0.84 });
regShape('wide', 'Wide', rrect(0, 0, 2.0, 1.44, 0.72, 0, 24).map(([x, y]) => [x, -y]), { faceCenter: [0, 0], faceScale: 0.92 });
regShape('drop', 'Drop', (() => {
  // Tactile mallow teardrop: smooth rounded crown, plush belly
  const p = [];
  for (let i = 0; i < 192; i++) {
    const t = -Math.PI / 2 + i / 192 * TAU, c = Math.cos(t), s = Math.sin(t);
    const w = 0.88 * (0.76 + 0.28 * s);
    const y = s - 0.07 * c * c * (s < 0 ? 1 : 0);
    p.push([c * w, y]);
  }
  return p;
})(), { faceCenter: [0, 0.14], faceScale: 0.88 });
regShape('ghost', 'Dome', (() => {
  // Arch dome top with softly cushioned base corners
  const d = 'M 0 -96 C 56 -96 90 -56 90 12 L 90 62 C 90 86 72 96 46 96 L -46 96 C -72 96 -90 86 -90 62 L -90 12 C -90 -56 -56 -96 0 -96 Z';
  return parseSVGPath(d);
})(), { faceCenter: [0, 0.04], faceScale: 0.94 });
regShape('clover', 'Clover', polarBody(a => 0.91 + 0.09 * Math.cos(4 * a)), { faceCenter: [0, 0], faceScale: 0.92 });
regShape('diamond', 'Lozenge', superBody(0.92, 0.92, 2.7, Math.PI / 4), { faceCenter: [0, 0], faceScale: 0.88 });
regShape('hexagon', 'Hexagon', roundedPolyBody(6, 1, 0.26, -Math.PI / 2), { faceCenter: [0, 0], faceScale: 0.92 });
regShape('star', 'Spark', polarBody(a => 0.85 + 0.15 * Math.cos(5 * (a + Math.PI / 2))), { faceCenter: [0, 0.04], faceScale: 0.86 });

function resolveBodyShape(spec, slottedSVG) {
  if (slottedSVG) {
    const key = 'slot:' + slottedSVG.innerHTML;
    if (!customShapeCache.has(key)) {
      const raw = extractFromSVGElement(slottedSVG);
      if (raw) customShapeCache.set(key, compileBodyShape(raw));
    }
    if (customShapeCache.has(key)) return customShapeCache.get(key);
  }
  if (!spec || SHAPES[spec]) return SHAPES[spec] || SHAPES.circle;
  const trimmed = spec.trim();
  if (customShapeCache.has(trimmed)) return customShapeCache.get(trimmed);

  let raw = null;
  if (trimmed.startsWith('#') && typeof document !== 'undefined') {
    const el = document.querySelector(trimmed);
    if (el) raw = el.tagName.toLowerCase() === 'svg' ? extractFromSVGElement(el) : extractFromSVGElement({ querySelectorAll: () => [el] });
  } else if (trimmed.startsWith('<')) {
    const tpl = document.createElement('template');
    tpl.innerHTML = trimmed;
    const svg = tpl.content.querySelector('svg') || tpl.content;
    raw = extractFromSVGElement(svg);
  } else if (/^[mM]/.test(trimmed)) {
    raw = parseSVGPath(trimmed);
  }
  if (raw && raw.length > 2) {
    const compiled = compileBodyShape(raw);
    if (customShapeCache.size > 64) customShapeCache.clear();
    customShapeCache.set(trimmed, compiled);
    return compiled;
  }
  return SHAPES.circle;
}

function mixBody(A, B, p) {
  if (p <= 0) return A;
  if (p >= 1) return B;
  const pts = new Array(BODY_N);
  for (let i = 0; i < BODY_N; i++) {
    pts[i] = [lerp(A.pts[i][0], B.pts[i][0], p), lerp(A.pts[i][1], B.pts[i][1], p)];
  }
  return {
    pts,
    ox: lerp(A.ox, B.ox, p),
    oy: lerp(A.oy, B.oy, p),
    rx: lerp(A.rx, B.rx, p),
    ry: lerp(A.ry, B.ry, p),
    fScale: lerp(A.fScale, B.fScale, p),
    floorY: lerp(A.floorY, B.floorY, p),
    label: B.label
  };
}

/* ==========================================================================
   3. MULTI-CELL EYE PRIMITIVES & TOPOLOGICAL MORPHING ENGINE
   ==========================================================================
   Every eye (`L` or `R`) is a cluster of 1..9 solid, bold closed cells (`CELL_N = 64` pts).
   No thin lines, no hollow outlines — optical ink weight stays constant across states!
   ========================================================================== */

const CELL_N = 64;
const EX_X = 0.24;     // Horizontal eye center spacing (±0.24 in sphere radii)
const EX_Y = 0.05;     // Slightly above midline for friendly proportion
const SW = 0.145;      // Heavy stroke width for curved/chevron states (matches pill weight!)

function makeCell(pts, cx, cy, fill = 'eye', opts = {}) {
  return { pts: resample(pts, CELL_N, true), c: [cx, cy], fill, op: opts.op ?? 1, noBlink: !!opts.noBlink };
}

/* ---------- 16 Heavy Solid Eye Shape Builders (`eyeShape(side, opts)`) ---------- */
const EYE_SHAPES = {
  /** Iconic vertical capsule pill (default) */
  pill: (s, o = {}) => {
    const cx = (o.x ?? s * EX_X), cy = (o.y ?? EX_Y);
    return [makeCell(pill(cx, cy, o.w ?? .19, o.h ?? .42, o.ang ?? 0), cx, cy)];
  },
  /** Extra-tall expressive pill */
  tall: (s, o = {}) => {
    const cx = (o.x ?? s * EX_X), cy = (o.y ?? EX_Y);
    return [makeCell(pill(cx, cy, o.w ?? .18, o.h ?? .50, o.ang ?? 0), cx, cy)];
  },
  /** Chunky solid circle (matches optical ink area of vertical pill) */
  circle: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .005)), cy = (o.y ?? EX_Y), r = o.r ?? .152;
    return [makeCell(ell(cx, cy, r, r, 64), cx, cy)];
  },
  /** Bold horizontal / sideways pill */
  wide: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .018)), cy = (o.y ?? EX_Y);
    return [makeCell(pill(cx, cy, o.w ?? .35, o.h ?? .175, o.ang ?? 0), cx, cy)];
  },
  /** Half-height heavy squint capsule */
  squint: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .01)), cy = (o.y ?? EX_Y);
    return [makeCell(pill(cx, cy, o.w ?? .28, o.h ?? .185, o.ang ?? 0), cx, cy)];
  },
  /** Heavy rounded square block */
  square: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .008)), cy = (o.y ?? EX_Y), sz = o.sz ?? .275;
    return [makeCell(rrect(cx, cy, sz, sz, sz * .28, o.ang ?? 0, 12), cx, cy)];
  },
  /** 2x2 matrix of 4 bold rounded sub-blocks per eye */
  grid: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .018)), cy = (o.y ?? EX_Y);
    const off = o.off ?? .098, sz = o.sz ?? .144, scales = o.scales;
    const cells = [];
    let idx = 0;
    for (const dy of [off, -off]) {
      for (const dx of [-off, off]) {
        const k = scales ? scales[idx] : 1;
        const w = sz * k;
        cells.push(makeCell(rrect(cx + dx, cy + dy, w, w, w * .36, 0, 10), cx + dx, cy + dy));
        idx++;
      }
    }
    return cells;
  },
  /** 3x3 pixel dot-matrix per eye */
  matrix: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .024)), cy = (o.y ?? EX_Y);
    const off = o.off ?? .112, sz = o.sz ?? .088, scales = o.scales;
    const cells = [];
    let idx = 0;
    for (const dy of [off, 0, -off]) {
      for (const dx of [-off, 0, off]) {
        const k = scales ? scales[idx] : 1;
        const w = sz * k;
        cells.push(makeCell(rrect(cx + dx, cy + dy, w, w, w * .42, 0, 8), cx + dx, cy + dy));
        idx++;
      }
    }
    return cells;
  },
  /** Dual vertical capsule bars (`||` per eye — voice / equalizer) */
  bars: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .012)), cy = (o.y ?? EX_Y);
    const off = o.off ?? .084, w = o.w ?? .118, h1 = o.h1 ?? .36, h2 = o.h2 ?? .36;
    return [
      makeCell(pill(cx - off, cy, w, h1), cx - off, cy),
      makeCell(pill(cx + off, cy, w, h2), cx + off, cy)
    ];
  },
  /** Dual horizontal capsule stack (`=` per eye) */
  stack: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .015)), cy = (o.y ?? EX_Y);
    const off = o.off ?? .086, w = o.w ?? .31, h = o.h ?? .118;
    return [
      makeCell(pill(cx, cy + off, w, h), cx, cy + off),
      makeCell(pill(cx, cy - off, w, h), cx, cy - off)
    ];
  },
  /** Bold happy upward arc `^` */
  arc: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .01)), cy = (o.y ?? EX_Y);
    return [makeCell(stroke(qb([cx - .13, cy - .055], [cx, cy + .14], [cx + .13, cy - .055], 20), o.sw ?? SW), cx, cy, 'eye', { noBlink: true })];
  },
  /** Bold calm resting curve `︶` */
  rest: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .01)), cy = (o.y ?? (EX_Y - .03));
    return [makeCell(stroke(qb([cx - .13, cy + .04], [cx, cy - .11], [cx + .13, cy + .04], 20), o.sw ?? (SW * .95)), cx, cy, 'eye', { noBlink: true })];
  },
  /** Bold inward chevrons `> <` with plush round nose */
  chevron: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .016)), cy = (o.y ?? EX_Y), dir = -s * (o.dir ?? 1);
    return [makeCell(pillChevron(cx, cy, dir, o.arm ?? .20, o.r ?? .058), cx, cy, 'eye', { noBlink: true })];
  },
  /** Focused slanted heavy pill (`\ /` inward slant by default, `dir: -1` for sad `/ \`) */
  slant: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .012)), cy = (o.y ?? EX_Y);
    const ang = (o.ang ?? 0.42) * s * (o.dir ?? 1);
    return [makeCell(pill(cx, cy, o.w ?? .33, o.h ?? .17, ang), cx, cy)];
  },
  /** Bold geometric cross `+` */
  plus: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .016)), cy = (o.y ?? EX_Y), span = o.span ?? .34, thick = o.thick ?? .15;
    const poly = heavyPlus(cx, cy, span, thick);
    const pts = o.ang ? poly.map(([x, y]) => rotPt(x, y, cx, cy, o.ang)) : poly;
    return [makeCell(pts, cx, cy)];
  },
  /** Chunky rotated diamond */
  diamond: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .012)), cy = (o.y ?? EX_Y), sz = o.sz ?? .27;
    return [makeCell(rrect(cx, cy, sz, sz, sz * .26, Math.PI / 4 + (o.ang ?? 0), 12), cx, cy)];
  },
  /** Bold plush capsule heart (no pointy bottom!) */
  heart: (s, o = {}) => {
    const cx = (o.x ?? s * (EX_X + .018)), cy = (o.y ?? EX_Y);
    return [makeCell(pillHeart(cx, cy, (o.sz ?? .32) / .30), cx, cy)];
  }
};

const STATIC_EYE_CACHE = new Map();
function buildEye(name, side, opts) {
  const fn = EYE_SHAPES[name] || EYE_SHAPES.pill;
  if (!opts) {
    const key = name + ':' + side;
    let c = STATIC_EYE_CACHE.get(key);
    if (!c) { c = fn(side); STATIC_EYE_CACHE.set(key, c); }
    return c;
  }
  return fn(side, opts);
}

function pairEyes(leftSpec, rightSpec) {
  if (rightSpec === undefined) {
    if (typeof leftSpec === 'string' && /\s/.test(leftSpec.trim())) {
      const parts = leftSpec.trim().split(/\s+/);
      leftSpec = parts[0]; rightSpec = parts[1] || parts[0];
    } else {
      rightSpec = leftSpec;
    }
  }
  const resolveSide = (spec, s) => {
    if (typeof spec === 'string') return buildEye(spec, s);
    if (Array.isArray(spec)) return buildEye(spec[0], s, spec[1]);
    return spec;
  };
  return { L: resolveSide(leftSpec, -1), R: resolveSide(rightSpec, 1), extras: [] };
}

function mixCell(a, b, p) {
  if (p <= 0) return a;
  if (p >= 1) return b;
  const pts = new Array(CELL_N);
  for (let i = 0; i < CELL_N; i++) {
    pts[i] = [lerp(a.pts[i][0], b.pts[i][0], p), lerp(a.pts[i][1], b.pts[i][1], p)];
  }
  return {
    pts,
    c: [lerp(a.c[0], b.c[0], p), lerp(a.c[1], b.c[1], p)],
    fill: p < .5 ? a.fill : b.fill,
    op: lerp(a.op ?? 1, b.op ?? 1, p),
    noBlink: p < .5 ? a.noBlink : b.noBlink
  };
}

/**
 * Multi-cell Fission / Fusion morph between cell cluster `A` (M cells) and `B` (K cells).
 * Because cells are opaque solid shapes, overlapping cells at p=0 or p=1 have zero seam,
 * and splitting/merging cells peel apart or coalesce with smooth per-cell micro-stagger!
 */
function mixCluster(A, B, p) {
  if (p <= 0.0005) return A;
  if (p >= 0.9995) return B;
  const m = A.length, k = B.length;
  if (m === k) {
    const out = new Array(m);
    const stg = m > 1 ? 0.12 / (m - 1) : 0;
    for (let i = 0; i < m; i++) {
      const pi = m > 1 ? easeMorph(clamp((p - i * stg) / (1 - 0.12), 0, 1)) : p;
      out[i] = mixCell(A[i], B[i], pi);
    }
    return out;
  }
  if (m === 1) {
    // Fission: 1 solid shape splits cleanly into K cells
    const out = new Array(k), span = Math.min(0.18, 0.045 * (k - 1));
    const stg = k > 1 ? span / (k - 1) : 0;
    for (let j = 0; j < k; j++) {
      const pj = easeMorph(clamp((p - j * stg) / (1 - span), 0, 1));
      out[j] = mixCell(A[0], B[j], pj);
    }
    return out;
  }
  if (k === 1) {
    // Fusion: M cells coalesce cleanly into 1 solid shape
    const out = new Array(m), span = Math.min(0.18, 0.045 * (m - 1));
    const stg = m > 1 ? span / (m - 1) : 0;
    for (let i = 0; i < m; i++) {
      const pi = easeMorph(clamp((p - i * stg) / (1 - span), 0, 1));
      out[i] = mixCell(A[i], B[0], pi);
    }
    return out;
  }
  // General M <-> K correspondence by spatial proximity
  const pairs = [];
  if (m < k) {
    for (let j = 0; j < k; j++) {
      let best = 0, bestD = 1e9;
      for (let i = 0; i < m; i++) {
        const d = Math.hypot(A[i].c[0] - B[j].c[0], A[i].c[1] - B[j].c[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      pairs.push([A[best], B[j]]);
    }
  } else {
    for (let i = 0; i < m; i++) {
      let best = 0, bestD = 1e9;
      for (let j = 0; j < k; j++) {
        const d = Math.hypot(A[i].c[0] - B[j].c[0], A[i].c[1] - B[j].c[1]);
        if (d < bestD) { bestD = d; best = j; }
      }
      pairs.push([A[i], B[best]]);
    }
  }
  return pairs.map(([ca, cb], idx) => {
    const span = 0.14, stg = pairs.length > 1 ? span / (pairs.length - 1) : 0;
    return mixCell(ca, cb, easeMorph(clamp((p - idx * stg) / (1 - span), 0, 1)));
  });
}

/** Mix complete face `{ L, R, extras }` with subtle L->R lead-follow stagger */
function mixFaces(FA, FB, rawP, stagger = 0.055) {
  if (rawP <= 0.0005) return FA;
  if (rawP >= 0.9995) return FB;
  const pL = easeMorph(clamp(rawP / (1 - stagger), 0, 1));
  const pR = easeMorph(clamp((rawP - stagger) / (1 - stagger), 0, 1));
  const pE = easeMorph(rawP);

  // Extra features (e.g. optional blush)
  const exMap = new Map();
  for (const f of (FA.extras || [])) exMap.set(f.key, [f, null]);
  for (const f of (FB.extras || [])) {
    const cur = exMap.get(f.key);
    if (cur) cur[1] = f; else exMap.set(f.key, [null, f]);
  }
  const extras = [];
  for (const [key, [a, b]] of exMap) {
    if (a && b) extras.push({ ...mixCell(a, b, pE), key });
    else {
      const f = a || b, s = a ? Math.max(0, 1 - pE * 1.4) : backOut(Math.min(1, pE * 1.15));
      const op = (f.op ?? 1) * (a ? Math.max(0, 1 - pE * 1.6) : Math.min(1, pE * 1.8));
      extras.push({ ...f, key, op, pts: f.pts.map(q => [f.c[0] + (q[0] - f.c[0]) * s, f.c[1] + (q[1] - f.c[1]) * s]) });
    }
  }
  return { L: mixCluster(FA.L, FB.L, pL), R: mixCluster(FA.R, FB.R, pR), extras };
}

/** Step through timed face keyframes with silky overlapping morphs: `seqFace(e, [[0, F0], [0.9, F1], ...], morphDur)` */
function seqFace(e, steps, blend = 0.28) {
  let i = 0;
  while (i + 1 < steps.length && e >= steps[i + 1][0]) i++;
  const cur = typeof steps[i][1] === 'function' ? steps[i][1](e) : steps[i][1];
  if (i === 0) return cur;
  const dt = e - steps[i][0], dur = steps[i][2] ?? blend;
  if (dt >= dur) return cur;
  const prev = typeof steps[i - 1][1] === 'function' ? steps[i - 1][1](e) : steps[i - 1][1];
  return mixFaces(prev, cur, dt / dur, 0.05);
}

/** Step through timed eye-gaze targets `[time, eyeYaw, eyePitch, eyeRoll]` with smooth quintic glide */
function seqGaze(e, stops, glide = 0.24) {
  let i = 0;
  while (i + 1 < stops.length && e >= stops[i + 1][0]) i++;
  const cur = stops[i];
  if (i === 0) return { eyaw: cur[1], epitch: cur[2], eroll: cur[3] || 0 };
  const prev = stops[i - 1], dur = cur[4] ?? glide, p = lush(clamp((e - cur[0]) / dur, 0, 1));
  return {
    eyaw: lerp(prev[1], cur[1], p),
    epitch: lerp(prev[2], cur[2], p),
    eroll: lerp(prev[3] || 0, cur[3] || 0, p)
  };
}

/* ==========================================================================
   4. REACTIONS & PURE EYE-CHOREOGRAPHY EMOTES
   ========================================================================== */

const hop = (t, period, dur, amp) => { const p = (t % period) / dur; return p > 1 ? {} : { dy: -amp * Math.sin(p * Math.PI) }; };

const F_PILL = pairEyes('pill');
const F_CIRCLE = pairEyes('circle');
const F_WIDE = pairEyes('wide');
const F_SQUARE = pairEyes('square');
const F_GRID = pairEyes('grid');
const F_MATRIX = pairEyes('matrix');
const F_BARS = pairEyes('bars');
const F_STACK = pairEyes('stack');
const F_ARC = pairEyes('arc');
const F_REST = pairEyes('rest');
const F_CHEVRON = pairEyes('chevron');
const F_PLUS = pairEyes('plus');
const F_DIAMOND = pairEyes('diamond');
const F_SQUINT = pairEyes('squint');
const F_TALL = pairEyes('tall');
const F_HEART = pairEyes('heart');

const EX = {
  idle: {
    label: 'Idle', blink: true, useEyeShape: true,
    face: (t, e, eyeShape) => pairEyes(eyeShape || 'pill'),
    motion: null
  },
  listening: {
    label: 'Listening', blink: true,
    face: () => F_CIRCLE,
    motion: t => ({ eyaw: 0, epitch: .08, w: .65, s: 1 + .012 * Math.sin(t * 2.2) })
  },
  thinking: {
    label: 'Thinking', blink: true, extra: 'dots',
    face: () => pairEyes(['pill', { h: .38, y: EX_Y + .02 }], ['wide', { w: .30, h: .17, y: EX_Y + .01 }]),
    motion: t => {
      const g = Math.sin(t * .85) > .35 ? -.44 : -.30;
      return { eyaw: g, epitch: .40, w: .88, bodyRoll: -.06 + .02 * Math.sin(t * 1.2) };
    }
  },
  compute: {
    label: 'Compute', extra: 'dots',
    face: t => {
      // 2x2 grid per eye with smooth traveling wave modulation across cells
      const sc = off => [0, 1, 2, 3].map(i => .82 + .26 * Math.sin(t * 5.2 - i * 1.1 - off));
      return pairEyes(['grid', { scales: sc(0) }], ['grid', { scales: sc(1.4) }]);
    },
    motion: t => ({ eyaw: .22 * Math.sin(t * 1.1), epitch: .06 * Math.cos(t * 1.7), w: .8 })
  },
  working: {
    label: 'Working', blink: true,
    face: () => pairEyes(['slant', { w: .33, h: .175, ang: .24 }], ['slant', { w: .33, h: .175, ang: .24 }]),
    motion: t => {
      // Smooth reading scan left->right with crisp carriage-return saccade
      const cyc = (t * .55) % 1;
      const x = cyc < .82 ? lerp(-.38, .38, smooth5(cyc / .82)) : lerp(.38, -.38, smooth5((cyc - .82) / .18));
      return { eyaw: x, epitch: -.16, w: .9 };
    }
  },
  speaking: {
    label: 'Speaking',
    face: t => {
      const a = .22 + .22 * (.5 + .5 * Math.sin(t * 9.5));
      const b = .22 + .22 * (.5 + .5 * Math.sin(t * 9.5 + 1.3));
      const c = .22 + .22 * (.5 + .5 * Math.sin(t * 9.5 + 2.5));
      const d = .22 + .22 * (.5 + .5 * Math.sin(t * 9.5 + 0.6));
      return pairEyes(['bars', { h1: a, h2: b }], ['bars', { h1: c, h2: d }]);
    },
    motion: t => ({ epitch: .05, w: .4, s: 1 + .014 * Math.sin(t * 9.5) })
  },
  happy: {
    label: 'Happy',
    face: () => F_ARC,
    motion: t => ({ dy: -.08 * Math.abs(Math.sin(t * 1.55 * Math.PI)), epitch: .12, w: .35 })
  },
  done: {
    label: 'Done', extra: 'sparkle',
    face: () => F_ARC,
    motion: t => ({ ...hop(t, 2.4, .46, .11), epitch: .28, w: .45 })
  },
  needs: {
    label: 'Needs you', blink: true, extra: 'ring',
    face: () => F_TALL,
    motion: t => ({ ...hop(t, 2.0, .42, .07), eyaw: 0, epitch: .08, w: .7 })
  },
  sleeping: {
    label: 'Sleeping', extra: 'zzz',
    face: () => F_REST,
    motion: t => ({ eyaw: .08, epitch: -.34, bodyRoll: .10, w: .92, s: 1 + .014 * Math.sin(t * 1.5) })
  },
  error: {
    label: 'Error',
    face: () => F_CHEVRON,
    motion: t => {
      const b = Math.max(0, Math.sin(t * 2.2)) ** 10;
      return { epitch: .02, w: .55, yawAdd: .12 * Math.sin(t * 42) * b, bodyRoll: .05 * Math.sin(t * 42) * b };
    }
  },
  wink: {
    label: 'Wink',
    face: () => pairEyes('pill', 'arc'),
    motion: () => ({ bodyRoll: .09, eyaw: .16, epitch: .14, w: .5 })
  },
  skeptic: {
    label: 'Skeptic', blink: true,
    face: () => pairEyes('pill', 'wide'),
    motion: () => ({ bodyRoll: -.06, eyaw: -.18, epitch: .08, w: .6 })
  },
  love: {
    label: 'Love', extra: 'heart',
    face: () => F_HEART,
    motion: t => ({ epitch: .20, w: .4, bodyRoll: .08 * Math.sin(t * 2.1), s: 1 + .02 * Math.sin(t * 5.2) })
  },
  sad: {
    label: 'Sad', blink: true,
    face: () => pairEyes(['slant', { dir: -1, ang: .30, y: EX_Y - .03 }], ['slant', { dir: -1, ang: .30, y: EX_Y - .03 }]),
    motion: () => ({ epitch: -.30, eyaw: -.12, bodyRoll: -.05, w: .75 })
  },
  dizzy: {
    label: 'Dizzy', extra: 'orbit',
    face: t => pairEyes(['plus', { ang: t * 3.4 }], ['plus', { ang: -t * 3.4 }]),
    motion: t => ({ bodyRoll: .10 * Math.sin(t * 2.4), eyaw: .14 * Math.cos(t * 2.4), epitch: .08 * Math.sin(t * 2.4), w: .75 })
  },
  // Hidden poke reactions (clean, heavy geometric states)
  surprised: {
    label: 'Surprised', hidden: true,
    face: () => pairEyes(['circle', { r: .17 }], ['circle', { r: .17 }]),
    motion: (t, e) => ({ dy: e < .34 ? -.09 * Math.sin(e / .34 * Math.PI) : 0, eyaw: 0, epitch: .12, w: .8 })
  },
  giggle: {
    label: 'Giggle', hidden: true,
    face: () => F_ARC,
    motion: (t, e) => ({ dy: -.045 * Math.abs(Math.sin(e * 11)) * Math.exp(-e * 2.2), bodyRoll: .09 * Math.sin(e * 15) * Math.exp(-e * 2.4), eyaw: 0, epitch: .16, w: .6 })
  }
};

/* ---------- Pure Eye-Movement & Shape-Shifting Choreographies (Emotes) ---------- */
const defEmote = (label, dur, weight, def) => ({ label, hidden: true, emote: { dur, weight, kicks: def.kicks || [] }, ...def });

Object.assign(EX, {
  /** Signature cycle: Pill -> Circle -> 2x2 Grid -> Sideways Pill -> Pill */
  shapeshift: defEmote('Shape shift', 4.4, 5, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.35, F_CIRCLE, .34],
      [1.30, F_GRID, .38],
      [2.45, F_WIDE, .38],
      [3.55, pairEyes(eyeShape || 'pill'), .38]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .05], [.4, .22, .14], [1.35, -.24, .06], [2.5, .20, -.06], [3.55, 0, .05]], .32),
      w: .92
    })
  }),

  /** Pill -> Square -> Rippling 2x2 Grid -> Circle -> Pill */
  pixelate: defEmote('Pixelate', 4.2, 4, {
    face: (t, e, eyeShape) => {
      const waveGrid = u => {
        const sc = off => [0, 1, 2, 3].map(i => .78 + .30 * Math.sin(u * 8 - i * 1.2 - off));
        return pairEyes(['grid', { scales: sc(0) }], ['grid', { scales: sc(1.2) }]);
      };
      return seqFace(e, [
        [0, F_PILL],
        [0.30, F_SQUARE, .30],
        [1.05, waveGrid, .34],
        [2.65, F_CIRCLE, .34],
        [3.45, pairEyes(eyeShape || 'pill'), .36]
      ]);
    },
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .04], [.35, -.16, .12], [1.1, .18, .08], [2.7, 0, .14], [3.5, 0, .04]], .28),
      w: .88
    })
  }),

  /** Crisp eye-only saccade scan in sideways-pill focus mode */
  scan: defEmote('Scan lines', 3.4, 4, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.22, F_WIDE, .26],
      [2.75, pairEyes(eyeShape || 'pill'), .32]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [
        [0, 0, .04],
        [0.25, -.46, .16, 0, .20],
        [0.85, .46, .16, 0, .42],
        [1.45, -.46, -.10, 0, .18],
        [2.05, .46, -.10, 0, .42],
        [2.75, 0, .04, 0, .26]
      ]),
      w: .96
    })
  }),

  /** Staggered L/R mechanical-yet-silky calibration: Pill -> Wide -> Plus -> Circle -> Pill */
  calibrate: defEmote('Calibrate', 4.0, 3, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.30, pairEyes('wide', 'pill'), .26],
      [0.65, F_WIDE, .26],
      [1.35, F_PLUS, .32],
      [2.25, F_DIAMOND, .30],
      [2.90, F_CIRCLE, .30],
      [3.45, pairEyes(eyeShape || 'pill'), .34]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .05], [.35, -.18, .06], [.7, .18, .06], [1.4, 0, .12], [2.9, 0, .05]], .24),
      w: .9
    })
  }),

  /** Double-take: quick glance, snap back wide-eyed Circle, narrow Sideways Pill, relax */
  doubletake: defEmote('Double take', 3.2, 4, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.75, pairEyes(['circle', { r: .168 }], ['circle', { r: .168 }]), .20],
      [1.75, F_WIDE, .28],
      [2.60, pairEyes(eyeShape || 'pill'), .32]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [
        [0, 0, .04],
        [0.18, .45, .06, 0, .18],
        [0.50, -.05, .06, 0, .18],
        [0.72, .48, .14, 0, .15],
        [1.75, .42, .04, 0, .24],
        [2.60, 0, .04, 0, .30]
      ]),
      w: .95
    })
  }),

  /** 3x3 Matrix sweep across both eyes -> Sideways Pill -> Pill */
  matrix: defEmote('Matrix sweep', 4.3, 3, {
    face: (t, e, eyeShape) => {
      const sweep = u => {
        const wave = xPos => .72 + .36 * Math.exp(-Math.pow(xPos - ((u - 1.0) * 2.4 - 1.2), 2) * 4.5);
        const lSc = [], rSc = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
          lSc.push(wave(-0.8 + c * .25));
          rSc.push(wave(0.3 + c * .25));
        }
        return pairEyes(['matrix', { scales: lSc }], ['matrix', { scales: rSc }]);
      };
      return seqFace(e, [
        [0, F_PILL],
        [0.35, sweep, .38],
        [2.65, F_STACK, .34],
        [3.45, pairEyes(eyeShape || 'pill'), .36]
      ]);
    },
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .05], [.4, -.22, .08], [2.2, .22, .08], [2.7, 0, .05]], .35),
      w: .9
    })
  }),

  /** Pill splits into dual vertical equalizer bars that dance, then fuse back */
  equalize: defEmote('Equalize', 3.5, 3, {
    face: (t, e, eyeShape) => {
      const barsAnim = u => pairEyes(
        ['bars', { h1: .22 + .22 * Math.abs(Math.sin(u * 6.5)), h2: .22 + .22 * Math.abs(Math.cos(u * 6.5)) }],
        ['bars', { h1: .22 + .22 * Math.abs(Math.sin(u * 6.5 + 1)), h2: .22 + .22 * Math.abs(Math.cos(u * 6.5 + 1)) }]
      );
      return seqFace(e, [
        [0, F_PILL],
        [0.30, barsAnim, .32],
        [2.75, pairEyes(eyeShape || 'pill'), .34]
      ]);
    },
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .06], [.4, -.14, .10], [1.6, .14, .10], [2.75, 0, .06]], .34),
      w: .85
    })
  }),

  /** Asymmetric curious swap: (Circle | Sideways Pill) <-> (Sideways Pill | Circle) */
  curious: defEmote('Curious swap', 3.6, 3, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.28, pairEyes('circle', 'wide'), .30],
      [1.45, pairEyes('wide', 'circle'), .34],
      [2.65, F_CIRCLE, .28],
      [3.15, pairEyes(eyeShape || 'pill'), .30]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .05], [.3, -.26, .14, -.04], [1.45, .26, .14, .04], [2.65, 0, .10, 0], [3.15, 0, .05, 0]], .30),
      w: .9
    })
  }),

  /** Smooth 360 rim glance with chunky Circle eyes */
  orbit: defEmote('Orbit gaze', 3.4, 3, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.25, F_CIRCLE, .28],
      [2.75, pairEyes(eyeShape || 'pill'), .32]
    ]),
    motion: (t, e) => {
      const m = env(e, .2, .55, 2.45, 2.85), a = (e - .2) * 2.6;
      return { eyaw: Math.cos(a) * .46 * m, epitch: Math.sin(a) * .34 * m + .05 * (1 - m), w: .94 };
    }
  }),

  /** Suspicious horizontal-pill side-to-side glare (pure eye movement) */
  glare: defEmote('Sideways glare', 3.4, 3, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.25, F_WIDE, .28],
      [2.80, pairEyes(eyeShape || 'pill'), .32]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .03], [.32, -.52, -.02, 0, .32], [1.45, .52, -.02, 0, .42], [2.55, 0, .03, 0, .30]]),
      w: .96
    })
  }),

  /** Alternating crisp heavy winks */
  winkswap: defEmote('Wink swap', 2.8, 3, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_PILL],
      [0.22, pairEyes('arc', 'pill'), .22],
      [0.95, pairEyes('pill', 'arc'), .24],
      [1.75, F_ARC, .24],
      [2.35, pairEyes(eyeShape || 'pill'), .28]
    ]),
    motion: (t, e) => ({
      ...seqGaze(e, [[0, 0, .06], [.25, -.15, .12], [.98, .15, .12], [1.75, 0, .18], [2.35, 0, .06]], .22),
      w: .85
    })
  }),

  /** Weighty, calm slow blink into bold horizontal capsules */
  slowblink: defEmote('Slow blink', 2.2, 2, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, pairEyes(eyeShape || 'pill')],
      [0.25, F_SQUINT, .28],
      [0.55, F_WIDE, .30],
      [1.45, pairEyes(eyeShape || 'pill'), .38]
    ]),
    motion: (t, e) => ({ epitch: -.14 * env(e, .2, .6, 1.3, 1.8), w: .75 })
  }),

  /** Alive-mode sleep transition & wake */
  doze: defEmote('Dozing off', 4.4, 0, {
    face: (t, e, eyeShape) => seqFace(e, [
      [0, pairEyes(eyeShape || 'pill')],
      [0.5, F_SQUINT, .45],
      [1.4, F_WIDE, .45],
      [2.05, F_CIRCLE, .16],
      [2.55, F_SQUINT, .42],
      [3.35, F_REST, .48]
    ]),
    motion: (t, e) => e < 2.0
      ? { epitch: -.32 * (e / 2), bodyRoll: .08 * (e / 2), w: .9 }
      : e < 2.45
        ? { epitch: .12, dy: -.035 * pulse(e, 2.02, .3), w: .9 }
        : { epitch: -.34 * Math.min(1, (e - 2.45) / 1.4), bodyRoll: .10 * Math.min(1, (e - 2.45) / 1.4), eyaw: .08, w: .92 }
  }),
  wake: defEmote('Waking up', 1.5, 0, {
    kicks: [[0, .85]],
    face: (t, e, eyeShape) => seqFace(e, [
      [0, F_CIRCLE],
      [0.55, F_TALL, .22],
      [1.05, pairEyes(eyeShape || 'pill'), .28]
    ]),
    motion: (t, e) => ({
      dy: -.07 * pulse(e, 0, .32),
      ...seqGaze(e, [[0, 0, .14], [.35, -.32, .10, 0, .18], [.70, .32, .10, 0, .20], [1.05, 0, .06, 0, .24]]),
      w: .92
    })
  })
});

/* ---------- Optional Subtle Geometric Extras (off by default; enabled via `extras`) ---------- */
const tracePts = (c, pts) => {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
};
const starPts = (x, y, r) => {
  const p = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 - Math.PI / 2, rr = k % 2 ? r * .34 : r;
    p.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  return p;
};
const HEART_EX = heart(0, 0, .24);
const EXTRA = {
  dots: (R, t) => {
    const c = R.c; c.fillStyle = R.ink;
    for (let i = 0; i < 3; i++) {
      c.globalAlpha = R.a * (.25 + .75 * Math.max(0, Math.sin(t * 3 - i * .8)));
      c.beginPath(); c.arc(.66 + i * .22, -.98 - i * .1, .05 + i * .018, 0, TAU); c.fill();
    }
  },
  zzz: (R, t) => {
    const c = R.c; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = R.ink;
    for (let i = 0; i < 3; i++) {
      const p = (t * .32 + i / 3) % 1;
      c.globalAlpha = R.a * Math.sin(p * Math.PI) * .85;
      c.font = `700 ${((.20 + p * .14) * R.k).toFixed(1)}px system-ui, sans-serif`;
      c.fillText('z', (.68 + p * .38) * R.k + R.W / 2, (-.68 - p * .52 + R.dy) * R.k + R.W / 2);
    }
    c.restore();
  },
  sparkle: (R, t, pal) => {
    const c = R.c; c.fillStyle = pal.spark; c.globalAlpha = R.a;
    for (const [x, y, r, ph] of [[.95, -.82, .15, 0], [-.96, -.52, .10, 1.7], [.68, -1.14, .08, 3.1]]) {
      tracePts(c, starPts(x, y, r * (.35 + .65 * Math.abs(Math.sin(t * 2.2 + ph))))); c.fill();
    }
  },
  heart: (R, t, pal) => {
    const c = R.c, p = (t * .48) % 1, ox = .86 + .05 * Math.sin(t * 3), oy = -.62 - p * .56;
    c.globalAlpha = R.a * Math.sin(p * Math.PI); c.fillStyle = pal.blush; c.beginPath();
    HEART_EX.forEach(([a, b], i) => i ? c.lineTo(ox + a, oy - b) : c.moveTo(ox + a, oy - b));
    c.closePath(); c.fill();
  },
  orbit: (R, t, pal) => {
    const c = R.c; c.fillStyle = pal.spark; c.globalAlpha = R.a;
    for (let i = 0; i < 3; i++) {
      const a = t * 2.5 + i * TAU / 3;
      if (Math.sin(a) > -.2) {
        c.beginPath(); c.arc(Math.cos(a) * .60, -1.04 + Math.sin(a) * .13, .055 + .018 * Math.sin(a), 0, TAU); c.fill();
      }
    }
  }
};
const BACK = {
  ring: (R, t, pal) => {
    const c = R.c, p = (t * .75) % 1;
    c.globalAlpha = R.a * (1 - p) * .65; c.strokeStyle = pal.color; c.lineWidth = .055;
    c.beginPath();
    const pts = R.bodyPts, sc = 1 + .30 * p;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i][0] * sc, y = pts[i][1] * sc + R.sh;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath(); c.stroke();
  }
};

/* ==========================================================================
   5. 3D SPHERE FRAME, SURFACE PROJECTION & SOFT-BODY HARMONICS
   ========================================================================== */

function frame3D(yaw, pitch, roll) {
  const cp = Math.cos(pitch), f = [Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp];
  const rl = Math.hypot(f[2], f[0]) || 1, r = [f[2] / rl, 0, -f[0] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const c = Math.cos(roll), s = Math.sin(roll);
  return {
    f,
    r: [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s],
    u: [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s]
  };
}

const P3 = [0, 0, 0];
/**
 * Project face-space point `(a, b)` onto the curved 3D surface of `body`:
 * - Preserves exact 1:1 eye proportions at rest (`yaw=0, pitch=0`) on ANY shape (`tall`, `wide`, `drop`, etc.)
 * - Foreshortens naturally along the 3D sphere tangent as `yaw`/`pitch` turn toward the horizon
 * - Adapts gaze travel proportionally to the body's `(rx, ry)` clearance around `(ox, oy)`
 */
function projSurface(a, b, Fr, body, faceScale) {
  const S = faceScale * body.fScale;
  const sa = a * S, sb = b * S, rho = Math.hypot(sa, sb);
  const f = Fr.f, r = Fr.r, u = Fr.u;
  let x, y, z;
  if (rho < 1e-6) {
    x = body.ox + f[0] * body.rx;
    y = body.oy + f[1] * body.ry;
    z = f[2];
  } else {
    const k = Math.sin(rho) / rho, cr = Math.cos(rho), ra = sa * k, rb = sb * k;
    const dx = r[0] * ra + u[0] * rb, dy = r[1] * ra + u[1] * rb, dz = r[2] * ra + u[2] * rb;
    // Clamp horizon wrap so features past 90 deg stay cleanly on the rim before fading
    const zz = f[2] * cr + dz;
    x = body.ox + f[0] * cr * body.rx + dx;
    y = body.oy + f[1] * cr * body.ry + dy;
    z = zz;
  }
  P3[0] = x; P3[1] = y; P3[2] = z;
  return P3;
}

const jellyScale = (jx, th) =>
  1 + jx[0] * Math.cos(2 * th) + jx[1] * Math.sin(2 * th) +
  jx[2] * Math.cos(3 * th) + jx[3] * Math.sin(3 * th) +
  jx[4] * Math.cos(4 * th) + jx[5] * Math.sin(4 * th);

/** Build deformed body contour in canvas units (with soft-body harmonics, bodyRoll, floor contact & hop) */
function buildBodyContour(body, s, dy, bodyRoll, jx, jiggle, stride) {
  const src = body.pts, n = src.length, out = [];
  const rc = Math.cos(bodyRoll), rs = Math.sin(bodyRoll);
  let maxY = -9;
  for (let i = 0; i < n; i += stride) {
    let x = src[i][0] * s, y = src[i][1] * s;
    if (jiggle) {
      const th = Math.atan2(y, x), jr = jellyScale(jx, th);
      x *= jr; y *= jr;
    }
    if (bodyRoll) {
      const nx = x * rc - y * rs, ny = x * rs + y * rc;
      x = nx; y = ny;
    }
    if (y > maxY) maxY = y;
    out.push([x, y]);
  }
  const shift = body.floorY - maxY;
  const flat = (jiggle && dy > -.01) ? clamp(jx[0], 0, .24) * .85 : 0;
  const fy = body.floorY - flat;
  for (let i = 0; i < out.length; i++) {
    let py = out[i][1] + shift;
    if (flat > 0 && py > fy) py = fy + (py - fy) * .25;
    out[i][1] = py + dy;
  }
  return { pts: out, sh: shift + dy, rc, rs };
}

/**
 * Draw all eye & extra face cells onto `<canvas>`, clipped cleanly to the live body silhouette!
 * Blinks morph smoothly into heavy horizontal capsules (`F_WIDE`) so eyes NEVER become thin hairlines.
 */
function drawFaceCells(c, Fr, rawFace, blinkAmt, pal, body, faceScale, warp, jx, jiggle, stride) {
  const face = blinkAmt > .002 ? {
    L: rawFace.L[0]?.noBlink ? rawFace.L : mixCluster(rawFace.L, F_WIDE.L, blinkAmt),
    R: rawFace.R[0]?.noBlink ? rawFace.R : mixCluster(rawFace.R, F_WIDE.R, blinkAmt),
    extras: rawFace.extras
  } : rawFace;
  const groups = [face.L, face.R, face.extras || []];
  for (const grp of groups) {
    if (!grp || !grp.length) continue;
    for (const cell of grp) {
      const op0 = cell.op ?? 1;
      if (op0 <= .01) continue;
      const cp = projSurface(cell.c[0], cell.c[1], Fr, body, faceScale);
      const vis = clamp((cp[2] + .10) / .22, 0, 1);
      if (vis <= 0) continue;

      const P = cell.pts, n = P.length;
      c.beginPath();
      for (let i = 0; i < n; i += stride) {
        const p = projSurface(P[i][0], P[i][1], Fr, body, faceScale);
        let X = p[0] * warp.s, Y = p[1] * warp.s;
        if (jiggle) {
          const r = jellyScale(jx, Math.atan2(Y, X));
          X *= r; Y *= r;
        }
        if (warp.bodyRoll) {
          const nx = X * warp.rc - Y * warp.rs, ny = X * warp.rs + Y * warp.rc;
          X = nx; Y = ny;
        }
        Y += warp.sh;
        i ? c.lineTo(X, Y) : c.moveTo(X, Y);
      }
      c.closePath();
      c.globalAlpha = op0 * vis;
      c.fillStyle = pal[cell.fill] || cell.fill;
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

/* ==========================================================================
   6. SHARED POINTER, QUALITY GOVERNOR & SINGLE ANIMATION LOOP
   ========================================================================== */

const pointer = { x: 0, y: 0, active: false, t: 0 };
let listening = false, layoutVer = 0, frameNo = 0, clipSeq = 0;
function listen() {
  if (listening) return;
  listening = true;
  addEventListener('pointermove', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; pointer.t = performance.now();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer.active = false; });
  addEventListener('blur', () => { pointer.active = false; });
  const bump = () => { layoutVer++; };
  addEventListener('scroll', bump, { capture: true, passive: true });
  addEventListener('resize', bump, { passive: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { for (const o of live) o._colors(); });
}

const LEVELS = [{ stride: 1, dpr: 2 }, { stride: 2, dpr: 1.5 }, { stride: 2, dpr: 1 }];
const Q = { level: 0, auto: true, ema: 1, iv: 16.7, bad: 0, good: 0 };
function setLevel(l) { Q.level = clamp(l, 0, 2); Q.bad = Q.good = 0; for (const o of live) { o._fit(); o._sig = null; } }
function govern(cost, iv) {
  if (!Q.auto || iv > 120) return;
  Q.ema += (cost - Q.ema) * .08; Q.iv += (iv - Q.iv) * .08;
  const slow = Q.ema > 6.5 || Q.iv > 24, fast = Q.ema < 2.5 && Q.iv < 19;
  Q.bad = slow ? Q.bad + 1 : 0; Q.good = fast ? Q.good + 1 : 0;
  if (Q.bad > 45 && Q.level < 2) setLevel(Q.level + 1);
  else if (Q.good > 360 && Q.level > 0) setLevel(Q.level - 1);
}

const live = new Set();
let raf = 0, last = 0;
function loop(ms) {
  const iv = ms - last, dtRaw = Math.min(.08, Math.max(0, iv / 1000)), t = ms / 1000;
  last = ms; frameNo++;
  if (pointer.active && ms - pointer.t > 6000) pointer.active = false;
  const t0 = performance.now(), half = Q.level >= 2, act = [];
  for (const o of live) if (o._visible && !o._static && o._cw) act.push(o);
  for (const o of act) {
    if ((o._target || (o._followMode() || o._alive) && pointer.active) && (o._rectVer !== layoutVer || frameNo % 30 === 0)) {
      o._rect = o.getBoundingClientRect(); o._rectVer = layoutVer;
    }
  }
  for (const o of act) {
    if (half && (frameNo + o._slot) & 1) { o._acc += dtRaw; continue; }
    const dt = Math.min(.08, dtRaw + o._acc); o._acc = 0;
    o._update(dt, t);
  }
  govern(performance.now() - t0, iv);
  raf = live.size ? requestAnimationFrame(loop) : 0;
}
const wake = () => { if (!raf && live.size) { last = performance.now(); raf = requestAnimationFrame(loop); } };

const io = new IntersectionObserver(es => {
  for (const e of es) { const o = e.target; o._visible = e.isIntersecting; if (o._visible) o._sig = null; }
}, { rootMargin: '120px' });
const ro = new ResizeObserver(es => { for (const e of es) e.target._resized(e.contentRect.width); });
const parseGaze = v => {
  if (!v) return null;
  const p = v.split(/[\s,]+/).map(Number);
  return p.length >= 2 && p.every(Number.isFinite) ? [p[0] * Math.PI / 180, p[1] * Math.PI / 180] : null;
};

const CANVAS_SCALE = 3.2 / 2.08;
let slots = 0;

const MKEYS = { dy: 0, s: 1, bodyRoll: 0, yawAdd: 0, eroll: 0, w: 0 };
function mixMotion(a, b, p) {
  const o = {};
  for (const [k, d] of Object.entries(MKEYS)) o[k] = lerp(a[k] ?? d, b[k] ?? d, p);
  for (const k of ['eyaw', 'epitch']) {
    const va = a[k] ?? a[k.slice(1)], vb = b[k] ?? b[k.slice(1)];
    if (va != null || vb != null) o[k] = lerp(va ?? vb, vb ?? va, p);
  }
  return o;
}

/* ==========================================================================
   7. <orb-avatar> WEB COMPONENT
   ========================================================================== */

const ATTRS = [
  'reaction', 'shape', 'eye-shape', 'mode', 'color', 'eye-color', 'size', 'follow',
  'shadow', 'extras', 'face-scale', 'morph', 'jelly', 'gaze', 'static', 'label',
  'alive', 'idle-time', 'sleep-after', 'emotes', 'particle-color', 'spark-color'
];

class OrbAvatar extends HTMLElement {
  static get observedAttributes() { return ATTRS; }

  /** Registered reactions */
  static get reactions() { return Object.keys(EX).filter(k => !EX[k].hidden); }
  static reactionLabel(name) { return (EX[name] || {}).label || name; }
  static defineReaction(name, def) {
    const faceFn = def.face || (def.feats ? (t, e) => {
      const list = def.feats(t, e), L = [], R = [], extras = [];
      for (const f of list) {
        const cell = makeCell(f.pts, f.c[0], f.c[1], f.fill || 'eye', { op: f.op, noBlink: f.fixed });
        if (f.key === 'L') L.push(cell);
        else if (f.key === 'R') R.push(cell);
        else extras.push({ ...cell, key: f.key });
      }
      return { L: L.length ? L : F_PILL.L, R: R.length ? R : F_PILL.R, extras };
    } : () => F_PILL);
    EX[name] = { label: name, ...def, face: faceFn };
  }

  /** Registered body silhouettes & custom SVG shape registration */
  static get bodyShapes() { return Object.keys(SHAPES); }
  static shapeLabel(name) { return (SHAPES[name] || {}).label || name; }
  static defineShape(name, svgOrPath, opts = {}) {
    const raw = typeof svgOrPath === 'string'
      ? (svgOrPath.trim().startsWith('<') ? resolveBodyShape(svgOrPath).pts : parseSVGPath(svgOrPath))
      : svgOrPath;
    if (raw && raw.length > 2) {
      regShape(name, opts.label || name, raw, opts);
      customShapeCache.delete(name);
      for (const o of live) if (o._shapeSpec === name) o._setBodyTarget(SHAPES[name], true);
    }
  }

  /** Registered solid heavy eye shapes */
  static get eyeShapes() { return Object.keys(EYE_SHAPES); }
  static defineEyeShape(name, builder) { EYE_SHAPES[name] = builder; STATIC_EYE_CACHE.clear(); }

  /** Autonomous eye-choreography emotes */
  static get emotes() { return Object.keys(EX).filter(k => EX[k].emote && EX[k].emote.weight > 0); }
  static defineEmote(name, { duration = 3, weight = 1, kicks = [], ...def }) {
    OrbAvatar.defineReaction(name, { ...def, hidden: true, emote: { dur: duration, weight, kicks } });
  }

  static get quality() { return Q.auto ? 'auto' : Q.level; }
  static set quality(v) { if (v === 'auto') { Q.auto = true; setLevel(0); } else { Q.auto = false; setLevel(+v || 0); } }
  static get qualityLevel() { return Q.level; }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>:host{display:inline-block;position:relative;width:64px;aspect-ratio:1;flex:none;vertical-align:middle;line-height:0;-webkit-tap-highlight-color:transparent}' +
      `canvas{position:absolute;left:50%;top:50%;width:${(CANVAS_SCALE * 100).toFixed(2)}%;height:${(CANVAS_SCALE * 100).toFixed(2)}%;transform:translate(-50%,-50%);pointer-events:none}` +
      'i,slot{display:none}</style>' +
      '<canvas part="canvas"></canvas><i></i><slot name="shape"></slot><slot></slot>';
    this._canvas = root.querySelector('canvas');
    this._probe = root.querySelector('i');
    this._ctx = this._canvas.getContext('2d');
    this._slots = root.querySelectorAll('slot');
    for (const sl of this._slots) sl.addEventListener('slotchange', () => this._syncSlotShape());

    this._cw = 0; this._cssW = 0; this._sig = null; this._slot = slots++; this._acc = 0; this._rectVer = -1; this._inkAt = 0; this._colorVer = 0;
    this._expr = 'idle'; this._base = 'idle'; this._eyeShape = 'pill';
    this._shapeSpec = 'circle'; this._slottedSVG = null;
    this._bodyFrom = SHAPES.circle; this._bodyTo = SHAPES.circle; this._bodyCur = SHAPES.circle; this._btp = 1;

    this._override = null; this._overrideUntil = 0; this._overrideAt = 0; this._kickIdx = 0;
    this._customSeq = null;
    this._pokeAt = -9; this._pokes = [];
    this._alive = false; this._idleTime = 7; this._sleepAfter = 60; this._emoteList = null;
    this._lastAttn = performance.now() / 1000; this._nextEmote = this._lastAttn + 4; this._asleep = false; this._lastEmote = null; this._ptrSeen = 0;

    this._mode = 'drift'; this._wTarget = null; this._wNext = 0; this._ph = Math.random() * 20;
    this._raw = { color: '#f1efe9', eye: '#141418' };
    this._pal = { color: '#f1efe9', eye: '#141418', blush: '#ff6f91', spark: '#ffe08a' };
    this._ink = '#888';

    this._face = 1; this._morph = .38; this._jelly = .55; this._gaze = null;
    this._follow = false; this._shadow = false; this._extras = false; this._static = false; this._visible = true; this._target = null;

    // Dual-rate gaze physics: agile eye gaze (`_eyaw, _epitch, _eroll`) + cushioned body attitude (`_bRoll`)
    this._eyaw = .20; this._epitch = .14; this._eroll = 0; this._vey = 0; this._vep = 0; this._ver = 0;
    this._bRoll = 0; this._vbr = 0; this._init = false;

    // Face morph state
    this._tp = 1; this._fromFace = null; this._fromM = {}; this._curFace = F_PILL; this._m = {};
    this._jx = [0, 0, 0, 0, 0, 0]; this._jv = [0, 0, 0, 0, 0, 0];

    const now = performance.now() / 1000;
    this._t = now; this._nextBlink = now + 1.4 + Math.random() * 3.2; this._blinkAt = -9; this._spinAt = -9;
  }

  connectedCallback() {
    listen(); live.add(this); io.observe(this); ro.observe(this);
    if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
    this._syncSlotShape(false);
    this._colors(); this._aria(); this._update(0, performance.now() / 1000); wake();
  }
  disconnectedCallback() { live.delete(this); io.unobserve(this); ro.unobserve(this); }

  _syncSlotShape(animate = true) {
    let found = null;
    for (const sl of this._slots) {
      for (const el of sl.assignedElements({ flatten: true })) {
        if (el.tagName && el.tagName.toLowerCase() === 'svg') { found = el; break; }
      }
      if (found) break;
    }
    if (found !== this._slottedSVG) {
      this._slottedSVG = found;
      this._setBodyTarget(resolveBodyShape(this._shapeSpec, this._slottedSVG), animate);
    }
  }

  _setBodyTarget(nextBody, animate = true) {
    if (nextBody === this._bodyTo) return;
    if (animate && this._init && !this._static && this._morph > 0) {
      this._bodyFrom = this._bodyCur || this._bodyTo;
      this._btp = 0;
      const j = this._jelly * .55;
      this._jv[0] += 1.5 * j; this._jv[4] += (Math.random() - .5) * 1.2 * j;
    } else {
      this._bodyFrom = this._bodyCur = nextBody;
      this._btp = 1;
    }
    this._bodyTo = nextBody;
    this._sig = null;
    wake();
  }

  attributeChangedCallback(n, _, v) {
    const now = performance.now() / 1000;
    switch (n) {
      case 'reaction': {
        const e = v && EX[v] && !EX[v].hidden ? v : 'idle', from = this._base;
        this._base = e; this._override = null; this._customSeq = null; this._asleep = false; this._lastAttn = now;
        this._show(e, true);
        if (from !== e) this.dispatchEvent(new CustomEvent('reactionchange', { detail: { from, to: e }, bubbles: true }));
        break;
      }
      case 'shape': {
        const prev = this._shapeSpec;
        this._shapeSpec = v || 'circle';
        this._setBodyTarget(resolveBodyShape(this._shapeSpec, this._slottedSVG), true);
        if (prev !== this._shapeSpec) this.dispatchEvent(new CustomEvent('shapechange', { detail: { from: prev, to: this._shapeSpec }, bubbles: true }));
        break;
      }
      case 'eye-shape': {
        const raw = (v || 'pill').trim(), parts = raw.split(/\s+/);
        const valid = parts.every(p => EYE_SHAPES[p]);
        const next = valid ? raw : 'pill', prev = this._eyeShape;
        this._eyeShape = next;
        if (prev !== next && this._init && !this._static) {
          this._fromFace = this._curFace; this._fromM = this._m || {}; this._tp = 0;
          wake();
          this.dispatchEvent(new CustomEvent('eyeshapechange', { detail: { from: prev, to: next }, bubbles: true }));
        }
        break;
      }
      case 'mode': this._mode = ['follow', 'wander', 'fixed', 'drift'].includes(v) ? v : 'drift'; break;
      case 'color': this._raw.color = v || '#f1efe9'; this._colors(); break;
      case 'eye-color': this._raw.eye = v || '#141418'; this._colors(); break;
      case 'size': this.style.width = v == null ? '' : (/^\d+(\.\d+)?$/.test(v) ? v + 'px' : v); break;
      case 'follow': this._follow = on(v); break;
      case 'shadow': this._shadow = on(v); break;
      case 'extras': this._extras = on(v); break;      // Clean & geometric by default (opt-in extras)
      case 'face-scale': {
        // Accept v2 scale (default 1.0) seamlessly; if someone passes legacy ~1.6, normalize gently or direct multiplier
        this._face = clamp(num(v, 1), 0.4, 2.2);
        break;
      }
      case 'morph': this._morph = Math.max(0, num(v, .38)); break;
      case 'jelly': this._jelly = clamp(num(v, .55), 0, 1); break;
      case 'gaze': this._gaze = parseGaze(v); break;
      case 'static': this._static = on(v); break;
      case 'alive': this._alive = on(v); this._nextEmote = now + this._idleTime * (.5 + Math.random() * .6); this._lastAttn = now; break;
      case 'idle-time': this._idleTime = Math.max(.5, num(v, 7)); this._nextEmote = now + this._idleTime * (.5 + Math.random() * .6); break;
      case 'sleep-after': this._sleepAfter = Math.max(0, num(v, 60)); break;
      case 'particle-color': case 'spark-color': this._colors(); break;
      case 'emotes': this._emoteList = v ? v.split(/[\s,]+/).filter(Boolean) : null; break;
    }
    this._sig = null; this._aria();
    if (this.isConnected && (this._static || !raf)) this._update(0, now);
  }

  /* ---------- Public JavaScript API ---------- */
  get reaction() { return this._base; }
  set reaction(v) { this.setAttribute('reaction', v); }
  get shape() { return this._shapeSpec; }
  set shape(v) { this.setAttribute('shape', v); }
  get eyeShape() { return this._eyeShape; }
  set eyeShape(v) { this.setAttribute('eye-shape', v); }
  get mode() { return this._mode; }
  set mode(v) { this.setAttribute('mode', v); }

  react(name) { this.reaction = name; return this; }
  setShape(shape) { this.shape = shape; return this; }
  morphEyes(eyeShape) {
    this._customSeq = null;
    this._override = null;
    if (this._base !== 'idle') {
      this._fromFace = this._curFace; this._fromM = this._m || {};
      this.setAttribute('reaction', 'idle');
    }
    this.eyeShape = eyeShape;
    return this;
  }

  /**
   * Play a custom sequence of eye shapes & gazes on the fly!
   * Example: `orb.sequence(['pill', 'circle', 'grid', 'wide', 'pill'], { stepDuration: 0.75 })`
   * Or detailed steps: `[{ eyes: ['circle', 'wide'], gaze: [20, 10], hold: 0.8 }, ...]`
   */
  sequence(steps, { stepDuration = 0.72, morphDuration = 0.34 } = {}) {
    if (!Array.isArray(steps) || !steps.length || this._static) return this;
    const now = performance.now() / 1000;
    const fSteps = [], gStops = [];
    let tCursor = 0;
    for (const st of steps) {
      const dur = (typeof st === 'object' && !Array.isArray(st) && st.hold != null) ? st.hold : stepDuration;
      let face;
      if (typeof st === 'string') face = pairEyes(st);
      else if (Array.isArray(st)) face = pairEyes(st[0], st[1]);
      else {
        const es = st.eyes || 'pill';
        face = Array.isArray(es) ? pairEyes(es[0], es[1]) : pairEyes(es);
      }
      fSteps.push([tCursor, face, morphDuration]);
      const gz = (typeof st === 'object' && !Array.isArray(st) && st.gaze) ? st.gaze : [0, 4];
      gStops.push([tCursor, gz[0] * Math.PI / 180, gz[1] * Math.PI / 180, (gz[2] || 0) * Math.PI / 180, morphDuration]);
      tCursor += dur;
    }
    this._asleep = false;
    this._customSeq = {
      start: now,
      until: now + tCursor,
      face: e => seqFace(e, fSteps, morphDuration),
      motion: e => ({ ...seqGaze(e, gStops, morphDuration), w: .92 })
    };
    this._fromFace = this._curFace; this._fromM = this._m || {}; this._tp = 0;
    this._lastAttn = now;
    wake();
    return this;
  }

  poke(force = 1, { react = true } = {}) {
    const j = this._jelly * force, now = performance.now() / 1000;
    this._jv[0] += 3.1 * j; this._jv[2] += (Math.random() - .5) * 2.2 * j; this._jv[3] += (Math.random() - .5) * 2.2 * j;
    this._lastAttn = now;
    if (react && !this._static) {
      if (this._asleep) { this._asleep = false; this._play('wake', now); }
      else {
        this._pokes = this._pokes.filter(p => now - p < 1.3); this._pokes.push(now);
        const n = this._pokes.length, e = n >= 3 ? 'dizzy' : n === 2 ? 'giggle' : 'surprised';
        this._pokeAt = now; this._override = e; this._overrideAt = now; this._kickIdx = 0;
        this._overrideUntil = now + (e === 'dizzy' ? 1.85 : e === 'giggle' ? 1.15 : .9);
        this._show(e, false);
        this.dispatchEvent(new CustomEvent('poke', { detail: { count: n, reaction: e }, bubbles: true }));
      }
    }
    wake(); return this;
  }

  spin() { this._spinAt = performance.now() / 1000; this.poke(.45, { react: false }); return this; }
  blink() { this._blinkAt = performance.now() / 1000; wake(); return this; }
  emote(name) {
    if (EX[name] && EX[name].emote && !this._static) {
      this._asleep = false; this._customSeq = null; this._play(name, performance.now() / 1000);
    }
    return this;
  }
  sleep() { return this.emote('doze'); }
  wakeUp() {
    const now = performance.now() / 1000;
    if (this._asleep) { this._asleep = false; this._play('wake', now); }
    this._lastAttn = now; return this;
  }
  get asleep() { return this._asleep; }
  lookAt(x, y) { this._target = (x == null || y == null) ? null : { x, y }; this._rectVer = -1; wake(); return this; }

  /** Crisp standalone SVG string of the current silhouette, 3D pose, and multi-cell eyes */
  toSVG({ size = 512 } = {}) {
    const Fr = this._Fr || frame3D(.20, .14, 0), body = this._bodyCur || SHAPES.circle;
    const face = this._curFace || pairEyes(this._eyeShape), pal = this._pal;
    const clipId = 'orb-clip-' + (++clipSeq);
    let bd = '';
    body.pts.forEach(([x, y], i) => { bd += (i ? 'L' : 'M') + f4(x) + ' ' + f4(y); });
    bd += 'Z';

    let fd = '';
    for (const grp of [face.L, face.R, face.extras || []]) {
      for (const cell of (grp || [])) {
        const op0 = cell.op ?? 1; if (op0 <= .01) continue;
        const cp = projSurface(cell.c[0], cell.c[1], Fr, body, this._face);
        const vis = clamp((cp[2] + .10) / .22, 0, 1); if (vis <= 0) continue;
        let d = '';
        cell.pts.forEach(([a, b], i) => {
          const p = projSurface(a, b, Fr, body, this._face);
          d += (i ? 'L' : 'M') + f4(p[0]) + ' ' + f4(p[1]);
        });
        const op = op0 * vis;
        fd += `<path d="${d}Z" fill="${pal[cell.fill] || cell.fill}"${op < .999 ? ` opacity="${op.toFixed(2)}"` : ''}/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.05 -1.05 2.1 2.1" width="${size}" height="${size}">` +
      `<defs><clipPath id="${clipId}"><path d="${bd}"/></clipPath></defs>` +
      `<path d="${bd}" fill="${pal.color}"/>` +
      `<g clip-path="url(#${clipId})">${fd}</g></svg>`;
  }

  /* ---------- Internals ---------- */
  _play(name, t) {
    const em = EX[name].emote || {};
    this._override = name; this._overrideAt = t; this._overrideUntil = t + (em.dur ?? 2); this._kickIdx = 0; this._lastEmote = name;
    this._show(name, false); wake();
    this.dispatchEvent(new CustomEvent('emote', { detail: { name }, bubbles: true }));
  }

  _pickEmote() {
    const pool = Object.keys(EX).filter(k => {
      const em = EX[k].emote;
      return em && em.weight > 0 && k !== this._lastEmote && (!this._emoteList || this._emoteList.includes(k));
    });
    let r = Math.random() * pool.reduce((a, k) => a + EX[k].emote.weight, 0);
    for (const k of pool) { r -= EX[k].emote.weight; if (r <= 0) return k; }
    return pool[0] || null;
  }

  _life(t) {
    if (pointer.active && pointer.t > this._ptrSeen && this._rect) {
      this._ptrSeen = pointer.t; const b = this._rect;
      if (Math.hypot(pointer.x - b.left - b.width / 2, pointer.y - b.top - b.height / 2) < Math.max(140, b.width * 2)) {
        this._lastAttn = t;
        if (this._asleep) { this._asleep = false; this._play('wake', t); }
      }
    }
    if (this._base !== 'idle' || this._override || this._customSeq) return;
    if (this._sleepAfter > 0 && t - this._lastAttn > this._sleepAfter) this._play('doze', t);
    else if (t > this._nextEmote) {
      const k = this._pickEmote();
      if (k) this._play(k, t); else this._nextEmote = t + this._idleTime;
    }
  }

  _followMode() { return this._mode === 'follow' || (this._follow && this._mode === 'drift'); }
  _aria() { if (this.isConnected) this.setAttribute('aria-label', this.getAttribute('label') || OrbAvatar.reactionLabel(this._base)); }

  _colors() {
    if (!this.isConnected) return;
    const pr = this._probe;
    const resolve = v => { pr.style.color = ''; pr.style.color = v; return getComputedStyle(pr).color || v; };
    for (const k of ['color', 'eye']) this._pal[k] = resolve(this._raw[k]);
    const cs = getComputedStyle(this);
    const pick = (attr, prop, fallback) => { const v = this.getAttribute(attr) || cs.getPropertyValue(prop).trim(); return v ? resolve(v) : fallback; };
    this._ink = pick('particle-color', '--orb-particle-color', cs.color);
    this._pal.spark = pick('spark-color', '--orb-spark-color', '#ffe08a');
    this._colorVer++; this._sig = null;
  }

  _resized(w) { this._cssW = w; this._fit(); this._sig = null; if (this._static || !raf) this._update(0, performance.now() / 1000); }
  _fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, LEVELS[Q.level].dpr);
    const px = Math.max(0, Math.round(this._cssW * CANVAS_SCALE * dpr));
    if (px !== this._cw) { this._canvas.width = this._canvas.height = px; this._cw = px; this._sig = null; }
  }

  _show(e, kick = true) {
    if (e === this._expr && !this._customSeq) return;
    const from = this._expr;
    this._colors();
    if (this._curFace && !this._static && this._morph > 0) {
      this._fromFace = this._curFace; this._fromM = this._m || {}; this._fromExpr = from; this._tp = 0;
    } else {
      this._tp = 1;
    }
    this._expr = e;
    if (kick && from !== e && this._init && !this._static) {
      const j = this._jelly * .75;
      this._jv[0] += 1.9 * j; this._jv[2] += (Math.random() - .5) * 1.4 * j; this._jv[5] += (Math.random() - .5) * 1.1 * j;
    }
    wake();
  }

  _wander(t) {
    if (!this._wTarget || t > this._wNext) {
      const center = Math.random() < .24, g = this._gaze || [.18, .12];
      // Crisp micro-saccades mixed with wider glances
      const micro = this._wTarget && Math.random() < .42;
      this._wTarget = center
        ? [g[0], g[1]]
        : micro
          ? [clamp(this._wTarget[0] + (Math.random() - .5) * .32, -.68, .68), clamp(this._wTarget[1] + (Math.random() - .5) * .24, -.35, .48)]
          : [(Math.random() * 2 - 1) * .62, -.28 + Math.random() * .72];
      this._wNext = t + (micro ? .35 + Math.random() * .45 : 1.1 + Math.random() * 2.4);
    }
    return this._wTarget;
  }

  _update(dt, t) {
    this._t = t;
    const st = this._static, calm = RMQ.matches || st, dur = RMQ.matches ? .18 : this._morph;
    this._tp = (st || dur <= 0) ? 1 : Math.min(1, this._tp + dt / dur);
    this._btp = (st || dur <= 0) ? 1 : Math.min(1, this._btp + dt / (dur * 1.15));
    this._bodyCur = this._btp < 1 ? mixBody(this._bodyFrom, this._bodyTo, easeMorph(this._btp)) : this._bodyTo;

    if (!st && t > this._nextBlink) {
      this._blinkAt = t;
      this._nextBlink = t + (Math.random() < .18 ? .30 : 2.6 + Math.random() * 4.2);
    }

    if (this._customSeq && t > this._customSeq.until) {
      this._customSeq = null;
      this._fromFace = this._curFace; this._fromM = this._m || {}; this._tp = 0;
    }
    if (this._override && t > this._overrideUntil) {
      const ended = this._override; this._override = null;
      if (ended === 'doze') {
        this._asleep = true; this._override = 'sleeping'; this._overrideAt = t; this._overrideUntil = Infinity;
        this._show('sleeping', false);
      } else {
        this._show(this._base, false);
        this._nextEmote = t + this._idleTime * (.75 + Math.random() * .85);
      }
    }
    if (this._alive && !st) this._life(t);

    if (this._override) {
      const kicks = (EX[this._override].emote || {}).kicks || [], e = t - this._overrideAt;
      while (this._kickIdx < kicks.length && e >= kicks[this._kickIdx][0]) {
        const j = this._jelly * kicks[this._kickIdx][1];
        this._jv[0] += 2.6 * j; this._jv[2] += (Math.random() - .5) * 1.8 * j;
        this._kickIdx++;
      }
    }

    const mode = this._followMode() ? 'follow' : this._mode, fixed = mode === 'fixed' && !this._override && !this._customSeq;
    const ex = EX[this._expr] || EX.idle;
    const lt = calm ? 0 : t + this._ph, ft = st ? 0 : t + this._ph;
    const p = easeMorph(this._tp);
    const since = this._customSeq ? (t - this._customSeq.start) : (this._override ? t - this._overrideAt : t - this._pokeAt);
    this._since = since;

    const rawM = this._customSeq ? this._customSeq.motion(since) : ((ex.motion && !fixed) ? ex.motion(lt, since) : {});
    const m = this._tp < 1 ? mixMotion(fixed ? {} : this._fromM, rawM, p) : rawM;
    this._m = m;

    // Base gaze from mode (`follow`, `wander`, `drift`, or `fixed`)
    let ly, lp;
    const g = this._gaze || [.18, .12];
    const look = this._target || (mode === 'follow' && pointer.active ? pointer : null);
    if (look && this._rect) {
      const b = this._rect, cx = b.left + b.width / 2, cy = b.top + b.height / 2, D = Math.max(320, b.width * 2.1);
      ly = clamp(Math.atan((look.x - cx) / D), -.74, .74);
      lp = clamp(Math.atan((cy - look.y) / D), -.58, .58);
    } else if (mode === 'wander' && !st) {
      [ly, lp] = this._wander(t);
    } else {
      const a = (st || mode === 'fixed') ? 0 : 1, ph = this._ph;
      ly = g[0] + a * (.24 * Math.sin(t * .48 + ph) + .06 * Math.sin(t * 1.25 + ph * 2));
      lp = g[1] + a * (.13 * Math.sin(t * .64 + ph * 1.7) + .04 * Math.sin(t * 1.65 + ph * .6));
    }

    const tgtOf = q => {
      const w = q.w ?? 0, qy = q.eyaw ?? q.yaw, qp = q.epitch ?? q.pitch;
      return [ly + ((qy ?? ly) - ly) * w, lp + ((qp ?? lp) - lp) * w, q.eroll ?? 0, q.bodyRoll ?? q.roll ?? 0];
    };
    let T = tgtOf(rawM);
    if (this._tp < 1) {
      const A = tgtOf(this._fromM);
      T = T.map((v, i) => lerp(A[i], v, p));
    }
    // Subtle sympathetic body lean when eyes gaze strongly sideways in follow/wander
    const symRoll = calm ? 0 : clamp(T[0] * 0.055, -.045, .045);

    if (st || !this._init) {
      this._eyaw = T[0]; this._epitch = T[1]; this._eroll = T[2]; this._bRoll = T[3] + symRoll;
      this._init = true;
    } else {
      // Agile critically-cushioned eye spring (K=155, D=19.5 -> crisp saccades, tiny ~2% lifelike settle)
      const stepEye = (x, v, goal) => { v += (goal - x) * 155 * dt; v *= Math.exp(-19.5 * dt); return [x + v * dt, v]; };
      // Soft secondary body-attitude spring (K=68, D=13 -> plush, weighty follow-through)
      const stepBody = (x, v, goal) => { v += (goal - x) * 68 * dt; v *= Math.exp(-13 * dt); return [x + v * dt, v]; };
      [this._eyaw, this._vey] = stepEye(this._eyaw, this._vey, T[0]);
      [this._epitch, this._vep] = stepEye(this._epitch, this._vep, T[1]);
      [this._eroll, this._ver] = stepEye(this._eroll, this._ver, T[2]);
      [this._bRoll, this._vbr] = stepBody(this._bRoll, this._vbr, T[3] + symRoll);
    }

    this._jellyStep(dt);

    // Evaluate target face & smooth multi-cell morph
    const targetFace = this._customSeq
      ? this._customSeq.face(since)
      : ex.face(ft, since, this._eyeShape);
    this._curFace = (this._tp < 1 && this._fromFace) ? mixFaces(this._fromFace, targetFace, this._tp) : targetFace;

    const isAnim = !!this._customSeq || (ex.face.length > 0 && !ex.useEyeShape) || this._tp < 1 || this._btp < 1;
    this._render(p, m, calm, isAnim);
  }

  _jellyStep(dt) {
    const j = this._jelly, x = this._jx, v = this._jv;
    if (this._static) { for (let i = 0; i < 6; i++) x[i] = v[i] = 0; return; }
    const w = lerp(25, 14.5, j), D = lerp(11.5, 4.0, j), n = Math.ceil(dt * 60 - 1e-6), h = n ? dt / n : 0;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < 6; i++) {
        const k = i > 1 ? w * 1.32 : w;
        v[i] += (-k * k * x[i] - D * v[i]) * h;
        x[i] = clamp(x[i] + v[i] * h, -.28, .28);
      }
    }
  }

  _render(p, m, calm, dyn) {
    const c = this._ctx, W = this._cw;
    if (!W) return;
    const t = this._t, ex = EX[this._expr] || EX.idle, pal = this._pal, jx = this._jx, body = this._bodyCur;
    const sp = (t - this._spinAt) / 1.45, spin = (sp >= 0 && sp < 1) ? TAU * smooth5(sp) : 0;
    const yaw = this._eyaw + spin + (m.yawAdd || 0);
    const pitch = clamp(this._epitch, -1.2, 1.2);
    const bodyRoll = calm ? 0 : this._bRoll;
    const eyeRoll = this._eroll;

    // Blink envelope: smooth symmetric cushion, never thin
    const bl = (t - this._blinkAt) / .165;
    const blinkAmt = (ex.blink && !this._customSeq && this._tp >= 1 && bl >= 0 && bl < 1)
      ? Math.pow(Math.sin(bl * Math.PI), 0.85) : 0;

    const breath = (!calm && this._alive && !this._override) ? .007 * Math.sin(t * 1.6 + this._ph) : 0;
    const s = (m.s ?? 1) + breath, dy = calm ? 0 : (m.dy || 0);

    let energy = 0;
    for (let i = 0; i < 6; i++) energy += Math.abs(jx[i]) + Math.abs(this._jv[i]) * .02;
    const jiggle = energy > 2e-4;
    const fx = this._tp < 1 ? EX[this._fromExpr] : null;
    const extras = this._extras && ((ex.extra && (EXTRA[ex.extra] || BACK[ex.extra])) || (fx && fx.extra));
    const stride = Math.max(LEVELS[Q.level].stride, this._cssW < 44 ? 2 : 1);

    const sig = [yaw, pitch, eyeRoll, bodyRoll, blinkAmt, s, dy, W, this._colorVer, stride, this._shadow ? 1 : 0];
    if (!dyn && !jiggle && !extras && this._sig && sig.every((v, i) => Math.abs(v - this._sig[i]) < 1e-4)) return;
    this._sig = sig;
    if (extras && ++this._inkAt % 120 === 0) this._colors();

    const Fr = frame3D(yaw, pitch, eyeRoll), k = W / 3.2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.setTransform(k, 0, 0, k, W / 2, W / 2);
    c.globalAlpha = 1;

    const contour = buildBodyContour(body, s, dy, bodyRoll, jx, jiggle, stride);
    const R = { c, k, W, a: 1, dy, sh: contour.sh, bodyPts: contour.pts, ink: this._ink, e: this._since, s };
    const layer = (tbl, e, op) => {
      if (extras && e && e.extra && tbl[e.extra] && op > .01) {
        R.a = op; tbl[e.extra](R, t + this._ph, pal); c.globalAlpha = 1;
      }
    };
    layer(BACK, fx, 1 - p); layer(BACK, ex, p);

    if (this._shadow) {
      c.globalAlpha = .20 * clamp(1 + dy * 1.5, .25, 1.3);
      c.fillStyle = pal.color; c.beginPath();
      c.ellipse(0, body.floorY + .16, .62 * body.rx * (1 + dy * .85) * (1 + jx[0] * .5), .058, 0, 0, TAU);
      c.fill(); c.globalAlpha = 1;
    }

    // Draw body silhouette & clip face strictly inside it
    c.save();
    tracePts(c, contour.pts);
    c.fillStyle = pal.color;
    c.fill();
    c.clip();

    const warp = { s, sh: contour.sh, bodyRoll, rc: contour.rc, rs: contour.rs };
    drawFaceCells(c, Fr, this._curFace, blinkAmt, pal, body, this._face, warp, jx, jiggle, stride);
    c.restore();

    if (extras) {
      c.save();
      c.translate(0, dy);
      layer(EXTRA, fx, 1 - p); layer(EXTRA, ex, p);
      c.restore();
    }
    this._Fr = Fr;
  }
}

OrbAvatar.shapes = {
  EX_X, EX_Y, SW,
  pill, rrect, superE, ell, qb, polyline, stroke, heavyPlus, heart,
  makeCell, buildEye, pairEyes, seqFace, seqGaze, hop, parseSVGPath
};
window.OrbAvatar = OrbAvatar;
customElements.define('orb-avatar', OrbAvatar);
if (typeof module !== 'undefined' && module.exports) module.exports = OrbAvatar;
})();
