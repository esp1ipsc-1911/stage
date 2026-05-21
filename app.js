/**
 * STAGEFORGE — IPSC Stage Designer
 * Isometric 45° perspective view (rear-facing)
 * IPSC Terminology per IPSC Handgun Competition Rules
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'stageforge_stages';
const GRID_PX = 60; // world units per meter

// Isometric projection constants
// Camera looks from rear-right at 45° horizontal, ~30° vertical
// World X = right, World Y = into screen (depth), Z = up
// Screen x = (wx - wy) * cos30
// Screen y = (wx + wy) * sin30 - wz * 1
const ISO_X  =  Math.cos(Math.PI / 6); // 0.866 — x contribution to screen x
const ISO_YX = -Math.cos(Math.PI / 6); // y contribution to screen x (negative)
const ISO_YY =  Math.sin(Math.PI / 6); // 0.5   — y contribution to screen y
const ISO_XY =  Math.sin(Math.PI / 6); // x contribution to screen y
const ISO_Z  =  1.0;                   // z (height) contribution to screen y

// Convert world (x, y, z) → screen (sx, sy)
function iso(wx, wy, wz = 0) {
  return {
    sx: wx * ISO_X  + wy * ISO_YX,
    sy: wx * ISO_XY + wy * ISO_YY - wz * ISO_Z,
  };
}

const ELEMENT_DEFS = {
  target_paper: { label: 'IPSC Target',   dot: '#c8a44a', w: 1,   d: 0.05, h_m: 1.55 },
  target_metal: { label: 'Steel Popper',  dot: '#c0c8d4', w: 0.5, d: 0.3,  h_m: 1.0  },
  target_plate: { label: 'Steel Plate',   dot: '#c0c8d4', w: 0.5, d: 0.3,  h_m: 0.8  },
  no_shoot:     { label: 'No-Shoot',      dot: '#e8e8dc', w: 1,   d: 0.05, h_m: 1.55 },
  wall:         { label: 'Hard Cover',    dot: '#6668a8', w: 2,   d: 0.1,  h_m: 1.5  },
  barrel:       { label: 'Barrel',        dot: '#786030', w: 0.6, d: 0.6,  h_m: 0.9  },
  port:         { label: 'Shooting Port', dot: '#88aa88', w: 1.5, d: 0.15, h_m: 1.6  },
  start_box:    { label: 'Shooting Box',  dot: '#2ecc71', w: 1.5, d: 2.0,  h_m: 0    },
  fault_line:   { label: 'Fault Line',    dot: '#e03030', w: 3,   d: 0.05, h_m: 0    },
  text_note:    { label: 'Note',          dot: '#aaaaaa', w: 1.2, d: 0.8,  h_m: 0    },
};

// World element stores world position in meters: { x, y } = floor position
// w_m, d_m = footprint width & depth in meters
// h_m = height in meters
// angle = rotation degrees (around Z)

// ── State ─────────────────────────────────────────────────────────────────

let state = {
  elements: [],
  selectedIds: [],
  zoom: 1,
  panX: 0,
  panY: 0,
  activeTool: 'select',
  showGrid: true,
  snapGrid: true,
  gridSize: GRID_PX,
  stageId: null,
  stageName: 'New Stage',
  modified: false,
};

let undoStack = [];
let redoStack = [];
let nextId = 1;

let isDragging = false;
let isPanning  = false;
let dragStart  = null;
let dragStartPositions = null;
let panStart   = null;

// ── Canvas ────────────────────────────────────────────────────────────────

const canvas = document.getElementById('stageCanvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  render();
}
window.addEventListener('resize', resizeCanvas);

// ── Coordinate helpers ────────────────────────────────────────────────────

// Screen → flat world (z=0 floor)
// Inverse of iso(): solve for wx, wy given sx, sy with wz=0
//   sx = wx*ISO_X  + wy*ISO_YX
//   sy = wx*ISO_XY + wy*ISO_YY
// det = ISO_X*ISO_YY - ISO_YX*ISO_XY
const ISO_DET = ISO_X * ISO_YY - ISO_YX * ISO_XY; // 0.866*0.5 - (-0.866)*0.5 = 0.866

function screenToWorld(sx, sy) {
  const lx = (sx - state.panX) / state.zoom;
  const ly = (sy - state.panY) / state.zoom;
  return {
    x: ( lx * ISO_YY - ly * ISO_YX) / ISO_DET,
    y: (-lx * ISO_XY + ly * ISO_X ) / ISO_DET,
  };
}

function toScreen(wx, wy, wz = 0) {
  const s = iso(wx, wy, wz);
  return {
    sx: s.sx * state.zoom + state.panX,
    sy: s.sy * state.zoom + state.panY,
  };
}

function snapV(v) {
  if (!state.snapGrid) return v;
  const g = 0.5; // snap to 0.5 m
  return Math.round(v / g) * g;
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    cx: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
    cy: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top,
  };
}

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Sky-floor gradient background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141618');
  bg.addColorStop(1, '#0e0f11');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(state.panX, state.panY);
  ctx.scale(state.zoom, state.zoom);

  if (state.showGrid) drawIsoGrid();

  // Sort elements back-to-front for painter's algorithm
  const sorted = [...state.elements].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const el of sorted) drawElement(el);

  ctx.restore();
}

function drawIsoGrid() {
  const g = 1; // 1 meter grid
  const range = 20; // draw ±20 m

  ctx.lineWidth = 1 / state.zoom;

  for (let i = -range; i <= range; i++) {
    const isMajor = (i % 5 === 0);
    ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.035)';
    ctx.beginPath();
    // Lines along X axis
    const a = iso(i * GRID_PX, -range * GRID_PX);
    const b = iso(i * GRID_PX,  range * GRID_PX);
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();

    ctx.beginPath();
    // Lines along Y axis
    const c = iso(-range * GRID_PX, i * GRID_PX);
    const d = iso( range * GRID_PX, i * GRID_PX);
    ctx.moveTo(c.sx, c.sy);
    ctx.lineTo(d.sx, d.sy);
    ctx.stroke();

    // Meter labels on major lines
    if (isMajor) {
      const m = Math.round(i);
      ctx.fillStyle = 'rgba(140,144,152,0.35)';
      ctx.font = `${8 / state.zoom}px Barlow Condensed`;
      ctx.textAlign = 'center';
      const lp = iso(i * GRID_PX, range * GRID_PX);
      ctx.fillText(`${m}m`, lp.sx, lp.sy + 10 / state.zoom);
    }
  }
}

// ── Element drawing ───────────────────────────────────────────────────────

function drawElement(el) {
  const isSelected = state.selectedIds.includes(el.id);
  const def = ELEMENT_DEFS[el.type];
  if (!def) return;

  // World units: el.x, el.y in GRID_PX units (like before), el.w/el.d in px too
  // We convert to meters for drawing
  const wx = el.x;           // world x in px units
  const wy = el.y;           // world y in px units
  const ww = el.w_px || def.w * GRID_PX;
  const wd = el.d_px || def.d * GRID_PX;
  const wh = el.h_px || def.h_m * GRID_PX;

  ctx.save();
  ctx.globalAlpha = el.opacity !== undefined ? el.opacity : 1;

  switch (el.type) {
    case 'target_paper': drawISOPaperTarget(wx, wy, ww, wd, wh, false); break;
    case 'no_shoot':     drawISOPaperTarget(wx, wy, ww, wd, wh, true);  break;
    case 'target_metal': drawISOPopper(wx, wy, ww, wd, wh); break;
    case 'target_plate': drawISOPlate(wx, wy, ww, wd, wh); break;
    case 'wall':         drawISOWall(wx, wy, ww, wd, wh); break;
    case 'port':         drawISOPort(wx, wy, ww, wd, wh); break;
    case 'barrel':       drawISOBarrel(wx, wy, ww, wd, wh); break;
    case 'start_box':    drawISOStartBox(wx, wy, ww, wd); break;
    case 'fault_line':   drawISOFaultLine(wx, wy, ww); break;
    case 'text_note':    drawISONote(wx, wy, ww, wd, el.text || 'Note'); break;
  }

  // Selection ring on floor
  if (isSelected) {
    ctx.strokeStyle = '#e8a020';
    ctx.lineWidth = 2 / state.zoom;
    ctx.setLineDash([5 / state.zoom, 3 / state.zoom]);
    const pad = 8;
    const corners = [
      iso(wx - pad,      wy - pad),
      iso(wx + ww + pad, wy - pad),
      iso(wx + ww + pad, wy + wd + pad),
      iso(wx - pad,      wy + wd + pad),
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0].sx, corners[0].sy);
    corners.slice(1).forEach(c => ctx.lineTo(c.sx, c.sy));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Label above element
  if (el.label && el.type !== 'text_note') {
    const top = iso(wx + ww / 2, wy + wd / 2, wh + 8);
    ctx.fillStyle = 'rgba(232,234,237,0.85)';
    ctx.font = `bold ${9 / state.zoom}px Barlow Condensed`;
    ctx.textAlign = 'center';
    ctx.fillText(el.label, top.sx, top.sy);
  }

  ctx.restore();
}

// ── ISO drawing helpers ───────────────────────────────────────────────────

// Draw an isometric box face by face
// wx,wy = floor position (world px), ww=width(x), wd=depth(y), wh=height(z)
function isoBox(wx, wy, ww, wd, wh, colTop, colLeft, colRight, strokeCol) {
  const tl  = iso(wx,      wy,      wh);
  const tr  = iso(wx + ww, wy,      wh);
  const br  = iso(wx + ww, wy + wd, wh);
  const bl  = iso(wx,      wy + wd, wh);
  const ftl = iso(wx,      wy,      0);
  const ftr = iso(wx + ww, wy,      0);
  const fbr = iso(wx + ww, wy + wd, 0);
  const fbl = iso(wx,      wy + wd, 0);

  ctx.lineWidth = 0.8 / state.zoom;
  ctx.strokeStyle = strokeCol || 'rgba(0,0,0,0.4)';

  // Left face (y+)
  if (colLeft) {
    ctx.fillStyle = colLeft;
    ctx.beginPath();
    ctx.moveTo(bl.sx,  bl.sy);
    ctx.lineTo(tl.sx,  tl.sy); // Actually front-left going up — but in ISO:
    ctx.lineTo(fbl.sx, fbl.sy);
    // Left face: bl→fbl→ftl→tl
    ctx.beginPath();
    ctx.moveTo(tl.sx,  tl.sy);
    ctx.lineTo(bl.sx,  bl.sy);
    ctx.lineTo(fbl.sx, fbl.sy);
    ctx.lineTo(ftl.sx, ftl.sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Right face (x+)
  if (colRight) {
    ctx.fillStyle = colRight;
    ctx.beginPath();
    ctx.moveTo(tr.sx,  tr.sy);
    ctx.lineTo(br.sx,  br.sy);
    ctx.lineTo(fbr.sx, fbr.sy);
    ctx.lineTo(ftr.sx, ftr.sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Top face
  if (colTop) {
    ctx.fillStyle = colTop;
    ctx.beginPath();
    ctx.moveTo(tl.sx, tl.sy);
    ctx.lineTo(tr.sx, tr.sy);
    ctx.lineTo(br.sx, br.sy);
    ctx.lineTo(bl.sx, bl.sy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// Draw the IPSC cardboard target silhouette in ISO 3D
// The face of the target is a flat panel facing the viewer (front = -y direction)
// We draw it as a flat vertical surface at wy position, spanning x and z
function drawISOPaperTarget(wx, wy, ww, wd, wh, isNS) {
  const tan   = isNS ? '#e8e8dc' : '#c8a44a';
  const black = '#111';
  const sh    = ww * 0.15; // shoulder cut
  const fc    = ww * 0.07; // foot cut
  const paintZ = wh * 0.42; // black starts from bottom, covers 42% of height

  // Shadow on floor
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  const s1 = iso(wx + sh,      wy, 0);
  const s2 = iso(wx + ww - sh, wy, 0);
  const s3 = iso(wx + ww - sh, wy + wd * 0.8, 0);
  const s4 = iso(wx + sh,      wy + wd * 0.8, 0);
  ctx.moveTo(s1.sx, s1.sy);
  ctx.lineTo(s2.sx, s2.sy);
  ctx.lineTo(s3.sx, s3.sy);
  ctx.lineTo(s4.sx, s4.sy);
  ctx.closePath();
  ctx.fill();

  // Stand legs
  const legW = ww * 0.06;
  const legX1 = wx + ww * 0.22;
  const legX2 = wx + ww * 0.72;
  drawStandLeg(legX1, wy, legW, wd, wh * 0.06);
  drawStandLeg(legX2, wy, legW, wd, wh * 0.06);
  // Cross bar
  isoBox(legX1, wy + wd * 0.3, legX2 - legX1 + legW, wd * 0.06, wh * 0.03, '#3a3020', '#2a2010', '#2a2010');

  // Target face — build polygon in iso space
  // Shape: octagon with shoulder cuts at top, foot cuts at bottom
  // Points go from bottom-left, counter-clockwise at face z-positions
  function facePoint(fxFrac, fzFrac) {
    // Target face is at wy (front face), x spans wx..wx+ww, z spans 0..wh
    return iso(wx + ww * fxFrac, wy, wh * fzFrac);
  }

  // Tan (upper) part — from paintZ/wh to top
  const pf = paintZ / wh; // paint fraction from bottom
  ctx.fillStyle = tan;
  ctx.beginPath();
  // Bottom of tan area (paint line)
  let p = facePoint(0, pf); ctx.moveTo(p.sx, p.sy);
  p = facePoint(1, pf);     ctx.lineTo(p.sx, p.sy);
  // Right side up to shoulder
  p = facePoint(1, 1 - sh / ww); ctx.lineTo(p.sx, p.sy);
  // Right shoulder cut
  p = facePoint(1 - sh / ww, 1); ctx.lineTo(p.sx, p.sy);
  // Top across
  p = facePoint(sh / ww, 1);     ctx.lineTo(p.sx, p.sy);
  // Left shoulder
  p = facePoint(0, 1 - sh / ww); ctx.lineTo(p.sx, p.sy);
  ctx.closePath();
  ctx.fill();

  // Black (lower) part — from foot to paintZ
  ctx.fillStyle = black;
  ctx.beginPath();
  p = facePoint(fc / ww, 0);  ctx.moveTo(p.sx, p.sy);
  p = facePoint(1 - fc / ww, 0); ctx.lineTo(p.sx, p.sy);
  p = facePoint(1 - fc / ww, fc / wh); ctx.lineTo(p.sx, p.sy); // foot cut right
  p = facePoint(1, fc / wh);          ctx.lineTo(p.sx, p.sy);
  p = facePoint(1, pf);               ctx.lineTo(p.sx, p.sy);
  p = facePoint(0, pf);               ctx.lineTo(p.sx, p.sy);
  p = facePoint(0, fc / wh);          ctx.lineTo(p.sx, p.sy);
  p = facePoint(fc / ww, fc / wh);    ctx.lineTo(p.sx, p.sy);
  ctx.closePath();
  ctx.fill();

  // Full outline
  ctx.strokeStyle = isNS ? '#888870' : '#7a6018';
  ctx.lineWidth = 1 / state.zoom;
  ctx.beginPath();
  p = facePoint(fc / ww, 0);         ctx.moveTo(p.sx, p.sy);
  p = facePoint(1 - fc / ww, 0);     ctx.lineTo(p.sx, p.sy);
  p = facePoint(1 - fc / ww, fc/wh); ctx.lineTo(p.sx, p.sy);
  p = facePoint(1, fc / wh);         ctx.lineTo(p.sx, p.sy);
  p = facePoint(1, 1 - sh / ww);     ctx.lineTo(p.sx, p.sy);
  p = facePoint(1 - sh / ww, 1);     ctx.lineTo(p.sx, p.sy);
  p = facePoint(sh / ww, 1);         ctx.lineTo(p.sx, p.sy);
  p = facePoint(0, 1 - sh / ww);     ctx.lineTo(p.sx, p.sy);
  p = facePoint(0, fc / wh);         ctx.lineTo(p.sx, p.sy);
  p = facePoint(fc / ww, fc / wh);   ctx.lineTo(p.sx, p.sy);
  ctx.closePath();
  ctx.stroke();

  // "NS" label on No-Shoot
  if (isNS) {
    const mid = iso(wx + ww / 2, wy, wh * 0.5);
    ctx.fillStyle = '#555540';
    ctx.font = `bold ${wh * state.zoom * 0.14}px Bebas Neue`;
    ctx.textAlign = 'center';
    ctx.fillText('NS', mid.sx, mid.sy);
  }
}

function drawStandLeg(lx, ly, lw, ld, lh) {
  isoBox(lx, ly, lw, ld, lh, '#4a3820', '#3a2810', '#3a2810');
}

// Steel Popper: disc head on tapered body, T-stand
function drawISOPopper(wx, wy, ww, wd, wh) {
  const cx = wx + ww / 2;
  const cy = wy + wd / 2;

  // Stand base (floor level)
  isoBox(wx, wy, ww, wd, wh * 0.04, '#2a2e32', '#1e2226', '#1e2226');
  // Post
  const pw = ww * 0.1, pd = wd * 0.15;
  isoBox(cx - pw/2, cy - pd/2, pw, pd, wh * 0.55, '#3a3e44', '#2a2e32', '#2a2e32');

  // Body (tapered box)
  const bw = ww * 0.35, bd = wd * 0.3;
  const bz = wh * 0.3;
  const bh = wh * 0.3;
  isoBox(cx - bw/2, cy - bd/2, bw, bd, bh + bz,
    '#b8c4cc', '#8090a0', '#909aa8');

  // Disc head (approximate with iso ellipse)
  const dz   = wh * 0.72;
  const dr   = ww * 0.42;
  const dctr = iso(cx, cy, dz);

  // Draw disc as iso ellipse — front-facing circle becomes an ellipse in iso
  // Front face of disc (facing -y) as an ellipse
  const rx = dr * ISO_X;   // horizontal radius in screen space
  const ry = dr * ISO_XY;  // vertical squeeze

  ctx.fillStyle = '#c8d4dc';
  ctx.strokeStyle = '#6a7888';
  ctx.lineWidth = 1 / state.zoom;
  ctx.beginPath();
  ctx.ellipse(dctr.sx, dctr.sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Highlight
  const hctr = iso(cx - dr * 0.2, cy, dz + dr * 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.ellipse(hctr.sx, hctr.sy, rx * 0.32, ry * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Steel plate: flat disc on stand
function drawISOPlate(wx, wy, ww, wd, wh) {
  const cx = wx + ww / 2, cy = wy + wd / 2;

  // Post
  const pw = ww * 0.1, pd = wd * 0.15;
  isoBox(cx - pw/2, cy - pd/2, pw, pd, wh * 0.6, '#3a3e44', '#2a2e32', '#2a2e32');
  // Base
  isoBox(wx, wy, ww, wd, wh * 0.04, '#2a2e32', '#1e2226', '#1e2226');

  // Plate disc
  const dz = wh * 0.72;
  const dr = ww * 0.44;
  const dctr = iso(cx, cy, dz);
  const rx = dr * ISO_X;
  const ry = dr * ISO_XY;

  ctx.fillStyle = '#c0c8d4';
  ctx.strokeStyle = '#6a7888';
  ctx.lineWidth = 1.5 / state.zoom;
  ctx.beginPath();
  ctx.ellipse(dctr.sx, dctr.sy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// Hard Cover / Barricade — solid ISO box
function drawISOWall(wx, wy, ww, wd, wh) {
  isoBox(wx, wy, ww, wd, wh,
    '#4a4c7a',  // top
    '#2a2c5a',  // left face
    '#383a6a',  // right face
    'rgba(0,0,0,0.5)');
  // Wood grain lines on front face
  ctx.strokeStyle = 'rgba(150,150,200,0.1)';
  ctx.lineWidth = 0.6 / state.zoom;
  const steps = Math.max(3, Math.floor(wh / 10));
  for (let i = 1; i < steps; i++) {
    const zf = (wh / steps) * i;
    const a = iso(wx,      wy, zf);
    const b = iso(wx + ww, wy, zf);
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  }
}

// Shooting Port — wall with hole
function drawISOPort(wx, wy, ww, wd, wh) {
  // Draw as wall with opening
  // Left section
  const portX = wx + ww * 0.28, portW = ww * 0.44;
  const portZ1 = wh * 0.28, portZ2 = wh * 0.72;

  // Left slab
  isoBox(wx, wy, portX - wx, wd, wh, '#4a4c7a', '#2a2c5a', '#383a6a');
  // Right slab
  isoBox(portX + portW, wy, wx + ww - portX - portW, wd, wh, '#4a4c7a', '#2a2c5a', '#383a6a');
  // Below opening
  isoBox(portX, wy, portW, wd, portZ1, '#4a4c7a', '#2a2c5a', '#383a6a');
  // Above opening
  isoBox(portX, wy, portW, wd, wh, '#4a4c7a', '#2a2c5a', '#383a6a');
  // Re-draw above as only the top part
  // Actually just draw a full wall and then cut with background color
  const dark = '#0e0f11';
  isoBox(portX, wy, portW, wd, portZ2, dark, dark, dark);
  isoBox(portX, wy, portW, wd, portZ1, '#4a4c7a', '#2a2c5a', '#383a6a');
}

// Barrel — cylinder approximated as ISO box with rounded top
function drawISOBarrel(wx, wy, ww, wd, wh) {
  isoBox(wx, wy, ww, wd, wh,
    '#5a5040',  // top
    '#3a2e1a',  // left
    '#4a3c26',  // right
    'rgba(0,0,0,0.5)');
  // Hoop rings
  ctx.strokeStyle = 'rgba(100,80,30,0.5)';
  ctx.lineWidth = 1.5 / state.zoom;
  [0.3, 0.6].forEach(f => {
    const rz = wh * f;
    const rl = iso(wx,      wy, rz);
    const rr = iso(wx + ww, wy, rz);
    const rb = iso(wx + ww, wy + wd, rz);
    const rbl= iso(wx,      wy + wd, rz);
    ctx.beginPath();
    ctx.moveTo(rl.sx, rl.sy);
    ctx.lineTo(rr.sx, rr.sy);
    ctx.lineTo(rb.sx, rb.sy);
    ctx.lineTo(rbl.sx, rbl.sy);
    ctx.closePath();
    ctx.stroke();
  });
}

// Shooting Box — floor marking only
function drawISOStartBox(wx, wy, ww, wd) {
  const corners = [
    iso(wx,      wy,      0),
    iso(wx + ww, wy,      0),
    iso(wx + ww, wy + wd, 0),
    iso(wx,      wy + wd, 0),
  ];

  // Fill
  ctx.fillStyle = 'rgba(46,204,113,0.07)';
  ctx.beginPath();
  ctx.moveTo(corners[0].sx, corners[0].sy);
  corners.slice(1).forEach(c => ctx.lineTo(c.sx, c.sy));
  ctx.closePath();
  ctx.fill();

  // Dashed outline
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 1.5 / state.zoom;
  ctx.setLineDash([6 / state.zoom, 4 / state.zoom]);
  ctx.beginPath();
  ctx.moveTo(corners[0].sx, corners[0].sy);
  corners.slice(1).forEach(c => ctx.lineTo(c.sx, c.sy));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Label
  const mid = iso(wx + ww / 2, wy + wd / 2, 4);
  ctx.fillStyle = 'rgba(46,204,113,0.7)';
  ctx.font = `bold ${9 / state.zoom}px Bebas Neue`;
  ctx.textAlign = 'center';
  ctx.fillText('SHOOTING BOX', mid.sx, mid.sy);
}

// Fault Line — line on the floor
function drawISOFaultLine(wx, wy, ww) {
  const a = iso(wx,      wy, 2);
  const b = iso(wx + ww, wy, 2);

  ctx.strokeStyle = '#e03030';
  ctx.lineWidth = 2 / state.zoom;
  ctx.setLineDash([10 / state.zoom, 5 / state.zoom]);
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
  ctx.setLineDash([]);

  const mid = iso(wx + ww / 2, wy, 8);
  ctx.fillStyle = 'rgba(224,48,48,0.85)';
  ctx.font = `bold ${8 / state.zoom}px Barlow Condensed`;
  ctx.textAlign = 'center';
  ctx.fillText('FAULT LINE', mid.sx, mid.sy);
}

// Text note — flat sign standing up
function drawISONote(wx, wy, ww, wd, text) {
  // Small sign post
  const cx = wx + ww / 2;
  const ph = 30;
  isoBox(cx - 2, wy, 4, wd * 0.4, ph, '#555', '#444', '#444');

  // Sign face
  const sz = ph;
  const sw = ww;
  const sh_n = 22;
  function fp(fxFrac, fzFrac) { return iso(wx + sw * fxFrac, wy, sz + sh_n * fzFrac); }
  ctx.fillStyle = 'rgba(40,42,46,0.9)';
  const p0 = fp(0,0), p1 = fp(1,0), p2 = fp(1,1), p3 = fp(0,1);
  ctx.beginPath();
  ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy);
  ctx.lineTo(p2.sx, p2.sy); ctx.lineTo(p3.sx, p3.sy);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5 / state.zoom;
  ctx.stroke();

  const mid = iso(wx + ww / 2, wy, sz + sh_n / 2);
  ctx.fillStyle = '#e8eaed';
  ctx.font = `${7 / state.zoom}px Barlow`;
  ctx.textAlign = 'center';
  ctx.fillText(text.substring(0, 18), mid.sx, mid.sy);
}

// ── Element factory ───────────────────────────────────────────────────────

function createElement(type, wx, wy) {
  const def = ELEMENT_DEFS[type];
  if (!def) return null;
  const id = nextId++;
  const label = type === 'text_note' ? '' : `${def.label} ${id}`;
  return {
    id, type, label,
    x: snapV(wx / GRID_PX) * GRID_PX,
    y: snapV(wy / GRID_PX) * GRID_PX,
    w_px: def.w  * GRID_PX,
    d_px: def.d  * GRID_PX,
    h_px: def.h_m * GRID_PX,
    angle: 0,
    text: type === 'text_note' ? 'Note' : '',
    opacity: 1,
    // legacy compat
    w: def.w  * GRID_PX,
    h: def.h_m * GRID_PX,
  };
}

// ── Hit testing ───────────────────────────────────────────────────────────

function hitTest(el, wx, wy) {
  const x1 = el.x, x2 = el.x + (el.w_px || el.w);
  const y1 = el.y, y2 = el.y + (el.d_px || (el.h_m_def || 60));
  return wx >= x1 && wx <= x2 && wy >= y1 && wy <= y2;
}

function getElementAt(wx, wy) {
  for (let i = state.elements.length - 1; i >= 0; i--) {
    if (hitTest(state.elements[i], wx, wy)) return state.elements[i];
  }
  return null;
}

// ── Input handlers ────────────────────────────────────────────────────────

canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup',   onMouseUp);
canvas.addEventListener('wheel',     onWheel, { passive: false });
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('dblclick',  onDblClick);

function onMouseDown(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const world = screenToWorld(cx, cy);
  const wx = world.x, wy = world.y;

  hideContextMenu();

  if (e.button === 1 || state.activeTool === 'move') {
    isPanning = true;
    panStart = { cx, cy, panX: state.panX, panY: state.panY };
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (state.activeTool === 'select') {
    const hit = getElementAt(wx, wy);
    if (hit) {
      if (e.shiftKey) toggleSelect(hit.id);
      else if (!state.selectedIds.includes(hit.id)) selectOnly(hit.id);
      isDragging = true;
      dragStart  = { wx, wy };
      dragStartPositions = state.elements
        .filter(el => state.selectedIds.includes(el.id))
        .map(el => ({ id: el.id, x: el.x, y: el.y }));
    } else {
      if (!e.shiftKey) clearSelection();
    }
    return;
  }

  if (ELEMENT_DEFS[state.activeTool]) {
    pushUndo();
    const el = createElement(state.activeTool, wx, wy);
    if (el) {
      state.elements.push(el);
      selectOnly(el.id);
      markModified();
      render();
      updateUI();
    }
  }
}

function onMouseMove(e) {
  const { cx, cy } = getCanvasPos(e);
  const world = screenToWorld(cx, cy);
  const wx = world.x, wy = world.y;

  if (isPanning) {
    state.panX = panStart.panX + (cx - panStart.cx);
    state.panY = panStart.panY + (cy - panStart.cy);
    render();
    return;
  }

  if (isDragging && dragStart) {
    const dx = wx - dragStart.wx;
    const dy = wy - dragStart.wy;
    dragStartPositions.forEach(({ id, x, y }) => {
      const el = state.elements.find(e => e.id === id);
      if (el) {
        el.x = snapV(( x + dx) / GRID_PX) * GRID_PX;
        el.y = snapV(( y + dy) / GRID_PX) * GRID_PX;
      }
    });
    markModified();
    render();
    return;
  }

  if (state.activeTool === 'select') {
    canvas.style.cursor = getElementAt(wx, wy) ? 'move' : 'default';
  } else if (ELEMENT_DEFS[state.activeTool]) {
    canvas.style.cursor = 'crosshair';
  }
}

function onMouseUp() {
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = state.activeTool === 'move' ? 'grab' : 'default';
  }
  if (isDragging) {
    isDragging = false;
    dragStart  = null;
    dragStartPositions = null;
    updateUI();
  }
}

function onWheel(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const factor  = e.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.min(6, Math.max(0.1, state.zoom * factor));
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  render();
}

function onContextMenu(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const { x: wx, y: wy } = screenToWorld(cx, cy);
  const hit = getElementAt(wx, wy);
  if (hit) { if (!state.selectedIds.includes(hit.id)) selectOnly(hit.id); showContextMenu(e.clientX, e.clientY); }
}

function onDblClick(e) {
  const { cx, cy } = getCanvasPos(e);
  const { x: wx, y: wy } = screenToWorld(cx, cy);
  const hit = getElementAt(wx, wy);
  if (hit && hit.type === 'text_note') {
    const text = prompt('Edit note text:', hit.text || '');
    if (text !== null) { pushUndo(); hit.text = text; markModified(); render(); }
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveStage(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (e.key === 'Escape') { clearSelection(); setTool('select'); render(); updateUI(); return; }
  if (e.key === 'v' || e.key === 'V') setTool('select');
  if (e.key === 'h' || e.key === 'H') setTool('move');

  const nudge = (e.shiftKey ? GRID_PX : GRID_PX / 2);
  if (state.selectedIds.length && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    pushUndo();
    state.selectedIds.forEach(id => {
      const el = state.elements.find(el => el.id === id);
      if (!el) return;
      if (e.key === 'ArrowLeft')  el.x -= nudge;
      if (e.key === 'ArrowRight') el.x += nudge;
      if (e.key === 'ArrowUp')    el.y -= nudge;
      if (e.key === 'ArrowDown')  el.y += nudge;
    });
    markModified(); render();
  }
});

// ── Selection helpers ─────────────────────────────────────────────────────

function selectOnly(id) { state.selectedIds = [id]; updatePropertiesPanel(); updateElementsList(); render(); }
function toggleSelect(id) {
  const i = state.selectedIds.indexOf(id);
  if (i >= 0) state.selectedIds.splice(i, 1); else state.selectedIds.push(id);
  updatePropertiesPanel(); updateElementsList(); render();
}
function clearSelection() { state.selectedIds = []; updatePropertiesPanel(); updateElementsList(); render(); }

function setTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.style.cursor = tool === 'move' ? 'grab' : 'default';
  document.getElementById('canvasHint').textContent =
    tool === 'select' ? 'Click to select · Drag to move' :
    tool === 'move'   ? 'Drag to pan the canvas' :
    `Click to place: ${ELEMENT_DEFS[tool]?.label || tool}`;
}

// ── Undo / Redo ───────────────────────────────────────────────────────────

function pushUndo() { undoStack.push(JSON.stringify(state.elements)); if (undoStack.length > 50) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(state.elements)); state.elements = JSON.parse(undoStack.pop()); state.selectedIds = []; markModified(); updateUI(); render(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(state.elements)); state.elements = JSON.parse(redoStack.pop()); state.selectedIds = []; markModified(); updateUI(); render(); }

// ── Delete / Duplicate ────────────────────────────────────────────────────

function deleteSelected() {
  if (!state.selectedIds.length) return;
  pushUndo();
  state.elements = state.elements.filter(el => !state.selectedIds.includes(el.id));
  state.selectedIds = []; markModified(); updateUI(); render();
}

function duplicateSelected() {
  if (!state.selectedIds.length) return;
  pushUndo();
  const newIds = [];
  state.selectedIds.forEach(id => {
    const el = state.elements.find(e => e.id === id);
    if (el) { const copy = { ...el, id: nextId++, x: el.x + GRID_PX, y: el.y + GRID_PX }; state.elements.push(copy); newIds.push(copy.id); }
  });
  state.selectedIds = newIds; markModified(); updateUI(); render();
}

// ── Context menu ──────────────────────────────────────────────────────────

const ctxMenu = document.getElementById('contextMenu');
function showContextMenu(x, y) { ctxMenu.style.left = x+'px'; ctxMenu.style.top = y+'px'; ctxMenu.classList.remove('hidden'); }
function hideContextMenu() { ctxMenu.classList.add('hidden'); }
ctxMenu.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = btn.dataset.action;
    if (a === 'duplicate') duplicateSelected();
    else if (a === 'delete') deleteSelected();
    else if (a === 'bringFront') { pushUndo(); state.selectedIds.forEach(id => { const i = state.elements.findIndex(e => e.id===id); if(i>=0) state.elements.push(state.elements.splice(i,1)[0]); }); render(); }
    else if (a === 'sendBack')   { pushUndo(); state.selectedIds.forEach(id => { const i = state.elements.findIndex(e => e.id===id); if(i>0) state.elements.unshift(state.elements.splice(i,1)[0]); }); render(); }
    hideContextMenu();
  });
});
document.addEventListener('click', hideContextMenu);

// ── Properties panel ──────────────────────────────────────────────────────

function updatePropertiesPanel() {
  const panel = document.getElementById('propertiesPanel');
  if (state.selectedIds.length !== 1) {
    panel.innerHTML = state.selectedIds.length > 1
      ? `<div class="no-selection">${state.selectedIds.length} elements selected</div>`
      : `<div class="no-selection">Select an element<br/>to edit its properties</div>`;
    return;
  }
  const el = state.elements.find(e => e.id === state.selectedIds[0]);
  if (!el) return;
  const def = ELEMENT_DEFS[el.type] || {};
  const w_m = ((el.w_px || el.w || 0) / GRID_PX).toFixed(2);
  const d_m = ((el.d_px || 0) / GRID_PX).toFixed(2);
  const h_m = ((el.h_px || el.h || 0) / GRID_PX).toFixed(2);

  let html = `<div class="prop-element-type">${def.label || el.type}</div><div class="prop-group">`;
  if (el.type !== 'text_note') html += `<div class="prop-row"><div class="prop-label">Label</div><input type="text" data-prop="label" value="${(el.label||'').replace(/"/g,'&quot;')}" /></div>`;
  if (el.type === 'text_note') html += `<div class="prop-row"><div class="prop-label">Text</div><textarea data-prop="text">${el.text||''}</textarea></div>`;
  html += `
    <div class="prop-row"><div class="prop-label">Width (m)</div><input type="number" data-prop="w_m" value="${w_m}" min="0.1" step="0.1" /></div>
    <div class="prop-row"><div class="prop-label">Depth (m)</div><input type="number" data-prop="d_m" value="${d_m}" min="0.05" step="0.05" /></div>
    <div class="prop-row"><div class="prop-label">Height (m)</div><input type="number" data-prop="h_m_val" value="${h_m}" min="0" step="0.1" /></div>
    <div class="prop-row"><div class="prop-label">Opacity</div><input type="range" data-prop="opacity" value="${el.opacity !== undefined ? el.opacity : 1}" min="0.1" max="1" step="0.05" /></div>
  `;
  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll('[data-prop]').forEach(input => {
    const prop = input.dataset.prop;
    const update = () => {
      pushUndo();
      if (prop === 'w_m')     el.w_px = el.w = parseFloat(input.value) * GRID_PX;
      else if (prop === 'd_m')     el.d_px = parseFloat(input.value) * GRID_PX;
      else if (prop === 'h_m_val') el.h_px = el.h = parseFloat(input.value) * GRID_PX;
      else if (prop === 'opacity') el.opacity = parseFloat(input.value);
      else el[prop] = input.value;
      markModified(); render(); updateElementsList();
    };
    input.addEventListener('change', update);
    if (input.type === 'range') input.addEventListener('input', update);
  });
}

function propInput(labelText, prop, value) {
  return `<div class="prop-row"><div class="prop-label">${labelText}</div><input type="text" data-prop="${prop}" value="${String(value).replace(/"/g,'&quot;')}" /></div>`;
}

// ── Elements list ─────────────────────────────────────────────────────────

function updateElementsList() {
  const list = document.getElementById('elementsList');
  list.innerHTML = '';
  [...state.elements].reverse().forEach(el => {
    const def = ELEMENT_DEFS[el.type] || {};
    const div = document.createElement('div');
    div.className = 'element-list-item' + (state.selectedIds.includes(el.id) ? ' selected' : '');
    div.innerHTML = `<span class="element-list-dot" style="background:${def.dot||'#888'}"></span><span>${el.label || def.label || el.type}</span>`;
    div.addEventListener('click', () => selectOnly(el.id));
    list.appendChild(div);
  });
}

// ── Saved stages panel ────────────────────────────────────────────────────

function updateSavedStagesList() {
  const list = document.getElementById('savedStagesList');
  const stages = loadAllStages();
  list.innerHTML = '';
  if (!stages.length) { list.innerHTML = `<div style="color:var(--text-dim);font-size:11px;text-align:center;padding:8px">No saved stages</div>`; return; }
  stages.forEach(s => {
    const div = document.createElement('div');
    div.className = 'saved-stage-item';
    div.innerHTML = `<div><div class="saved-stage-name">${s.name}</div><div class="saved-stage-meta">${s.elements.length} elem · ${new Date(s.savedAt).toLocaleDateString('en-US')}</div></div>
      <div class="saved-stage-actions">
        <button data-action="load" data-id="${s.id}" title="Load stage">↓</button>
        <button data-action="del"  data-id="${s.id}" title="Delete stage">✕</button>
      </div>`;
    div.querySelector('[data-action=load]').addEventListener('click', e => { e.stopPropagation(); if (state.modified && !confirm('Discard unsaved changes?')) return; loadStageById(s.id); });
    div.querySelector('[data-action=del]').addEventListener('click',  e => { e.stopPropagation(); if (confirm(`Delete "${s.name}"?`)) { deleteStageById(s.id); updateSavedStagesList(); toast('Stage deleted.'); } });
    div.addEventListener('click', () => { if (state.modified && !confirm('Discard unsaved changes?')) return; loadStageById(s.id); });
    list.appendChild(div);
  });
}

// ── Storage ───────────────────────────────────────────────────────────────

function loadAllStages() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveAllStages(stages) { localStorage.setItem(STORAGE_KEY, JSON.stringify(stages)); }

function saveStage() {
  const name = document.getElementById('stageName').value.trim() || 'Untitled Stage';
  const stages = loadAllStages();
  const id = state.stageId || ('stage_' + Date.now());
  state.stageId = id;
  const saved = { id, name, elements: state.elements, nextId, zoom: state.zoom, panX: state.panX, panY: state.panY,
    stageInfo: { minRounds: document.getElementById('minRounds').value, maxRounds: document.getElementById('maxRounds').value, scoring: document.getElementById('scoring').value, division: document.getElementById('division').value },
    savedAt: Date.now() };
  const idx = stages.findIndex(s => s.id === id);
  if (idx >= 0) stages[idx] = saved; else stages.unshift(saved);
  saveAllStages(stages);
  state.modified = false;
  document.getElementById('stageMeta').textContent = `Saved ${new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' })}`;
  updateSavedStagesList();
  toast('Stage saved!', 'success');
}

function loadStageById(id) {
  const s = loadAllStages().find(s => s.id === id);
  if (!s) return;
  state.elements = s.elements || []; state.stageId = s.id; state.modified = false;
  nextId = s.nextId || (Math.max(0, ...state.elements.map(e => e.id)) + 1);
  state.zoom = s.zoom || 1; state.panX = s.panX || canvas.width/2 - 200; state.panY = s.panY || canvas.height/2 - 200;
  state.selectedIds = [];
  document.getElementById('stageName').value = s.name;
  document.getElementById('stageMeta').textContent = `Loaded · ${new Date(s.savedAt).toLocaleDateString('en-US')}`;
  if (s.stageInfo) { document.getElementById('minRounds').value = s.stageInfo.minRounds; document.getElementById('maxRounds').value = s.stageInfo.maxRounds; document.getElementById('scoring').value = s.stageInfo.scoring; document.getElementById('division').value = s.stageInfo.division; }
  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  updateUI(); render(); toast(`Loaded: ${s.name}`);
}

function deleteStageById(id) { saveAllStages(loadAllStages().filter(s => s.id !== id)); }

function newStage() {
  if (state.modified && !confirm('Discard unsaved changes?')) return;
  state.elements = []; state.selectedIds = []; state.stageId = null; state.modified = false; nextId = 1;
  state.panX = canvas.width / 2 - 100; state.panY = canvas.height / 2 - 100; state.zoom = 1;
  document.getElementById('stageName').value = 'New Stage';
  document.getElementById('stageMeta').textContent = 'Unsaved';
  document.getElementById('zoomLevel').textContent = '100%';
  updateUI(); render();
}

function exportStage() {
  const name = document.getElementById('stageName').value.trim() || 'stage';
  const data = { name, elements: state.elements, stageInfo: { minRounds: document.getElementById('minRounds').value, maxRounds: document.getElementById('maxRounds').value, scoring: document.getElementById('scoring').value, division: document.getElementById('division').value }, exportedAt: new Date().toISOString(), appVersion: 2 };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name.replace(/\s+/g,'_') + '.json'; a.click();
  URL.revokeObjectURL(url); toast('Stage exported as JSON.');
}

function importStage(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.elements) throw new Error('Invalid format.');
      if (state.modified && !confirm('Discard unsaved changes?')) return;
      state.elements = data.elements; nextId = Math.max(0, ...state.elements.map(e => e.id)) + 1;
      state.stageId = null; state.selectedIds = []; state.modified = true;
      document.getElementById('stageName').value = data.name || 'Imported Stage';
      document.getElementById('stageMeta').textContent = 'Imported (unsaved)';
      if (data.stageInfo) { document.getElementById('minRounds').value = data.stageInfo.minRounds||12; document.getElementById('maxRounds').value = data.stageInfo.maxRounds||12; document.getElementById('scoring').value = data.stageInfo.scoring||'Comstock'; document.getElementById('division').value = data.stageInfo.division||'Open'; }
      updateUI(); render(); toast('Stage imported!', 'success');
    } catch { toast('Error: Invalid or unrecognized file format.', 'error'); }
  };
  reader.readAsText(file);
}

// ── UI helpers ────────────────────────────────────────────────────────────

function updateUI() { updatePropertiesPanel(); updateElementsList(); updateSavedStagesList(); }
function markModified() { state.modified = true; document.getElementById('stageMeta').textContent = 'Unsaved changes'; }

function zoom(factor) {
  const cx = canvas.width/2, cy = canvas.height/2;
  const nz = Math.min(6, Math.max(0.1, state.zoom * factor));
  state.panX = cx - (cx - state.panX) * (nz / state.zoom);
  state.panY = cy - (cy - state.panY) * (nz / state.zoom);
  state.zoom = nz;
  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  render();
}

function zoomFit() {
  if (!state.elements.length) { state.zoom = 1; render(); return; }
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  state.elements.forEach(el => {
    const ww = el.w_px || el.w || 60;
    const wd = el.d_px || 60;
    const wh = el.h_px || el.h || 60;
    [iso(el.x,el.y,0), iso(el.x+ww,el.y,0), iso(el.x+ww,el.y+wd,0), iso(el.x,el.y+wd,0), iso(el.x+ww/2,el.y+wd/2,wh)].forEach(p => {
      minX = Math.min(minX, p.sx); maxX = Math.max(maxX, p.sx);
      minY = Math.min(minY, p.sy); maxY = Math.max(maxY, p.sy);
    });
  });
  const pad = 80;
  const zx = (canvas.width - pad*2)  / (maxX - minX);
  const zy = (canvas.height - pad*2) / (maxY - minY);
  state.zoom = Math.min(6, Math.max(0.1, Math.min(zx, zy)));
  state.panX = pad - minX * state.zoom;
  state.panY = pad - minY * state.zoom;
  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  render();
}

let toastTimer;
function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = type;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── Button wiring ─────────────────────────────────────────────────────────

document.getElementById('btnNew').addEventListener('click', newStage);
document.getElementById('btnSave').addEventListener('click', saveStage);
document.getElementById('btnExport').addEventListener('click', exportStage);
document.getElementById('btnLoad').addEventListener('click', () => { document.getElementById('loadModal').classList.remove('hidden'); renderLoadModal(); });
document.getElementById('closeLoadModal').addEventListener('click', () => document.getElementById('loadModal').classList.add('hidden'));
document.querySelector('.modal-backdrop')?.addEventListener('click', () => document.getElementById('loadModal').classList.add('hidden'));
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => { if (e.target.files[0]) importStage(e.target.files[0]); e.target.value = ''; });

document.getElementById('btnZoomIn').addEventListener('click', () => zoom(1.2));
document.getElementById('btnZoomOut').addEventListener('click', () => zoom(0.8));
document.getElementById('btnZoomFit').addEventListener('click', zoomFit);
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnDelete').addEventListener('click', deleteSelected);
document.getElementById('btnDuplicate').addEventListener('click', duplicateSelected);

document.querySelectorAll('.tool-btn').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

document.getElementById('toggleGrid').addEventListener('change', e => { state.showGrid = e.target.checked; render(); });
document.getElementById('snapGrid').addEventListener('change',   e => { state.snapGrid  = e.target.checked; });
document.getElementById('gridSize').addEventListener('change',   e => { state.gridSize  = parseInt(e.target.value); });

function renderLoadModal() {
  const list = document.getElementById('loadModalList');
  const stages = loadAllStages();
  if (!stages.length) { list.innerHTML = `<div style="color:var(--text-dim);padding:20px;text-align:center">No saved stages found.</div>`; return; }
  list.innerHTML = stages.map(s => `
    <div class="saved-stage-item" style="margin-bottom:6px">
      <div><div class="saved-stage-name">${s.name}</div><div class="saved-stage-meta">${s.elements.length} elements · Saved ${new Date(s.savedAt).toLocaleString('en-US')}</div></div>
      <div class="saved-stage-actions"><button class="btn btn-primary" data-action="load" data-id="${s.id}">Load</button></div>
    </div>`).join('');
  list.querySelectorAll('[data-action=load]').forEach(btn => btn.addEventListener('click', () => {
    if (state.modified && !confirm('Discard unsaved changes?')) return;
    loadStageById(btn.dataset.id);
    document.getElementById('loadModal').classList.add('hidden');
  }));
}

// ── Init ──────────────────────────────────────────────────────────────────

function init() {
  resizeCanvas();
  // Center view on origin
  state.panX = canvas.width  * 0.5;
  state.panY = canvas.height * 0.55;
  state.zoom = 1.0;
  updateUI();
  render();
}

init();
