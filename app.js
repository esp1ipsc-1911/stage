/**
 * STAGEFORGE — IPSC Stage Designer
 * Full canvas-based stage editor with save/load
 * IPSC Terminology (per IPSC Handgun Competition Rules)
 */

'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'stageforge_stages';
const GRID_PX = 50; // pixels per meter at 1:1

const ELEMENT_DEFS = {
  target_paper: { label: 'IPSC Target',    color: '#c8a04a', dot: '#f5e8c8', w: 18, h: 30 },
  target_metal: { label: 'Steel Popper',   color: '#7a8090', dot: '#a0b0c0', w: 16, h: 28 },
  target_plate: { label: 'Steel Plate',    color: '#5a6070', dot: '#8090a0', w: 20, h: 20 },
  no_shoot:     { label: 'No-Shoot',       color: '#c03030', dot: '#ff6060', w: 18, h: 30 },
  wall:         { label: 'Hard Cover',     color: '#5055a0', dot: '#8888ff', w: 80, h: 10 },
  barrel:       { label: 'Barrel',         color: '#786030', dot: '#a08040', w: 20, h: 28 },
  port:         { label: 'Shooting Port',  color: '#556655', dot: '#88aa88', w: 50, h: 40 },
  start_box:    { label: 'Shooting Box',   color: '#2ecc71', dot: '#2ecc71', w: 80, h: 60 },
  fault_line:   { label: 'Fault Line',     color: '#e03030', dot: '#ff4040', w: 120, h: 8 },
  text_note:    { label: 'Note',           color: '#e8eaed', dot: '#aaaaaa', w: 80, h: 30 },
};

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
let isPanning = false;
let dragStart = null;
let dragStartPositions = null;
let panStart = null;
let isMarquee = false;
let marqueeStart = null;

// ── Canvas setup ──────────────────────────────────────────────────────────

const canvas = document.getElementById('stageCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  render();
}

window.addEventListener('resize', resizeCanvas);

// ── Coordinate helpers ────────────────────────────────────────────────────

function screenToWorld(sx, sy) {
  return {
    x: (sx - state.panX) / state.zoom,
    y: (sy - state.panY) / state.zoom,
  };
}

function worldToScreen(wx, wy) {
  return {
    x: wx * state.zoom + state.panX,
    y: wy * state.zoom + state.panY,
  };
}

function snapToGrid(v) {
  if (!state.snapGrid) return v;
  const g = state.gridSize;
  return Math.round(v / g) * g;
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { cx, cy };
}

// ── Render ────────────────────────────────────────────────────────────────

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#0e0f11';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(state.panX, state.panY);
  ctx.scale(state.zoom, state.zoom);

  if (state.showGrid) drawGrid(W, H);
  drawRulers();

  for (const el of state.elements) {
    drawElement(el);
  }

  ctx.restore();
}

function drawGrid(W, H) {
  const g = state.gridSize;
  const startX = Math.floor(-state.panX / state.zoom / g) * g;
  const startY = Math.floor(-state.panY / state.zoom / g) * g;
  const endX = startX + W / state.zoom + g;
  const endY = startY + H / state.zoom + g;

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1 / state.zoom;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += g) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += g) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();

  // Major grid every 5 m
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1 / state.zoom;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += g * 5) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += g * 5) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();
}

function drawRulers() {
  ctx.fillStyle = 'rgba(140,144,152,0.4)';
  ctx.font = `${9 / state.zoom}px Barlow Condensed`;
  ctx.textAlign = 'center';
  const g = state.gridSize;
  const startX = Math.floor(-state.panX / state.zoom / g) * g;
  const endX = startX + canvas.width / state.zoom + g;
  for (let x = startX; x <= endX; x += g * 5) {
    const m = Math.round(x / g);
    ctx.fillText(`${m} m`, x, -state.panY / state.zoom + 10 / state.zoom);
  }
}

function drawElement(el) {
  const def = ELEMENT_DEFS[el.type] || ELEMENT_DEFS.text_note;
  const isSelected = state.selectedIds.includes(el.id);
  const alpha = el.opacity !== undefined ? el.opacity : 1;

  ctx.save();
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
  ctx.rotate((el.angle || 0) * Math.PI / 180);
  ctx.globalAlpha = alpha;

  const x = -el.w / 2, y = -el.h / 2;

  switch (el.type) {
    case 'target_paper': drawPaperTarget(x, y, el.w, el.h, el.color || '#c8a04a', el.zone || 'A'); break;
    case 'target_metal': drawMetalPopper(x, y, el.w, el.h, el.color || '#7a8090'); break;
    case 'target_plate': drawPlate(x, y, el.w, el.h, el.color || '#5a6070'); break;
    case 'no_shoot':     drawNoShoot(x, y, el.w, el.h); break;
    case 'wall':         drawHardCover(x, y, el.w, el.h, el.color || '#5055a0'); break;
    case 'barrel':       drawBarrel(x, y, el.w, el.h); break;
    case 'port':         drawShootingPort(x, y, el.w, el.h); break;
    case 'start_box':    drawShootingBox(x, y, el.w, el.h); break;
    case 'fault_line':   drawFaultLine(x, y, el.w, el.h); break;
    case 'text_note':    drawTextNote(x, y, el.w, el.h, el.text || 'Note'); break;
    default:
      ctx.fillStyle = '#555';
      ctx.fillRect(x, y, el.w, el.h);
  }

  // Element label
  if (el.label && el.type !== 'text_note') {
    ctx.fillStyle = 'rgba(232,234,237,0.9)';
    ctx.font = `bold ${Math.max(7, 9)}px Barlow Condensed`;
    ctx.textAlign = 'center';
    ctx.fillText(el.label, 0, y - 4);
  }

  // Selection highlight
  if (isSelected) {
    ctx.strokeStyle = '#e8a020';
    ctx.lineWidth = 2 / state.zoom;
    ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
    ctx.strokeRect(x - 3, y - 3, el.w + 6, el.h + 6);
    ctx.setLineDash([]);

    const handles = [
      { hx: x,        hy: y },
      { hx: x + el.w, hy: y },
      { hx: x,        hy: y + el.h },
      { hx: x + el.w, hy: y + el.h },
      { hx: x + el.w / 2, hy: y - 3 },
    ];
    handles.forEach(({ hx, hy }) => {
      ctx.fillStyle = '#e8a020';
      ctx.fillRect(hx - 4 / state.zoom, hy - 4 / state.zoom, 8 / state.zoom, 8 / state.zoom);
    });
  }

  ctx.restore();
}

// ── Element drawing functions ─────────────────────────────────────────────

function drawPaperTarget(x, y, w, h, color, zone) {
  // Body — standard IPSC cardboard color
  ctx.fillStyle = '#f5e8c8';
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  // A-zone (upper thoracic)
  ctx.fillStyle = 'rgba(220,60,60,0.3)';
  ctx.fillRect(x + w * 0.15, y + h * 0.1, w * 0.7, h * 0.35);
  ctx.strokeStyle = '#cc4444';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + w * 0.15, y + h * 0.1, w * 0.7, h * 0.35);
  // C-zone outer scoring line
  ctx.strokeStyle = 'rgba(139,105,20,0.5)';
  ctx.strokeRect(x + w * 0.05, y + h * 0.08, w * 0.9, h * 0.6);
  // Zone label
  ctx.fillStyle = '#8b6914';
  ctx.font = `bold ${Math.max(5, w * 0.25)}px Barlow Condensed`;
  ctx.textAlign = 'center';
  ctx.fillText('A', x + w / 2, y + h * 0.35);
}

function drawMetalPopper(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#a0b0c0';
  ctx.lineWidth = 1.5;
  const r = w * 0.45;
  // Head
  ctx.beginPath();
  ctx.arc(x + w / 2, y + r + 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Body
  ctx.fillRect(x + w * 0.2, y + r * 2 + 2, w * 0.6, h - r * 2 - 6);
  ctx.strokeRect(x + w * 0.2, y + r * 2 + 2, w * 0.6, h - r * 2 - 6);
  // Shine
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(x + w / 2 - r * 0.2, y + r * 0.5 + 2, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlate(x, y, w, h, color) {
  const r = Math.min(w, h) / 2;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#8090a0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.arc(x + w / 2 - r * 0.2, y + h / 2 - r * 0.2, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawNoShoot(x, y, w, h) {
  ctx.fillStyle = 'rgba(224,48,48,0.15)';
  ctx.strokeStyle = '#e03030';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#e03030';
  ctx.font = `bold ${h * 0.3}px Bebas Neue`;
  ctx.textAlign = 'center';
  ctx.fillText('NS', x + w / 2, y + h * 0.65);
}

function drawHardCover(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#8888ff';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  // Hatch pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < w; i += 8) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i, y + h);
    ctx.stroke();
  }
}

function drawBarrel(x, y, w, h) {
  ctx.fillStyle = '#3d3520';
  ctx.strokeStyle = '#786030';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#a08040';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.strokeRect(x + 2, y + (h / 4) * i, w - 4, 2);
  }
}

function drawShootingPort(x, y, w, h) {
  ctx.strokeStyle = '#556655';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
  const pw = w * 0.4, ph = h * 0.4;
  const px2 = x + (w - pw) / 2, py2 = y + (h - ph) / 2;
  ctx.fillStyle = 'rgba(136,170,136,0.2)';
  ctx.fillRect(px2, py2, pw, ph);
  ctx.strokeStyle = '#88aa88';
  ctx.lineWidth = 1;
  ctx.strokeRect(px2, py2, pw, ph);
  ctx.fillStyle = '#88aa88';
  ctx.font = `${Math.min(ph * 0.7, 8)}px Barlow Condensed`;
  ctx.textAlign = 'center';
  ctx.fillText('PORT', x + w / 2, py2 + ph * 0.75);
}

function drawShootingBox(x, y, w, h) {
  // Per IPSC rules: Shooting Box = defined area where shooter must start
  ctx.fillStyle = 'rgba(46,204,113,0.08)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#2ecc71';
  ctx.font = `bold ${Math.min(h * 0.3, 10)}px Bebas Neue`;
  ctx.textAlign = 'center';
  ctx.fillText('SHOOTING BOX', x + w / 2, y + h * 0.65);
}

function drawFaultLine(x, y, w, h) {
  // Per IPSC rules: Fault Lines define the Shooting Area boundary
  ctx.strokeStyle = '#e03030';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e03030';
  ctx.font = `${Math.min(h, 8)}px Barlow Condensed`;
  ctx.textAlign = 'center';
  ctx.fillText('FAULT LINE', x + w / 2, y - 2);
}

function drawTextNote(x, y, w, h, text) {
  ctx.fillStyle = 'rgba(40,42,46,0.8)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#e8eaed';
  ctx.font = `${Math.min(h * 0.35, 12)}px Barlow`;
  ctx.textAlign = 'center';

  const words = text.split(' ');
  let line = '', lines = [], lh = Math.min(h * 0.35, 12) + 2;
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > w - 6) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const startY = y + h / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, startY + i * lh));
}

// ── Element factory ───────────────────────────────────────────────────────

function createElement(type, wx, wy) {
  const def = ELEMENT_DEFS[type] || ELEMENT_DEFS.text_note;
  const id = nextId++;
  const label = type === 'text_note' ? '' : `${def.label} ${id}`;
  return {
    id,
    type,
    x: snapToGrid(wx - def.w / 2),
    y: snapToGrid(wy - def.h / 2),
    w: def.w,
    h: def.h,
    angle: 0,
    color: def.color,
    label,
    text: type === 'text_note' ? 'Note' : '',
    opacity: 1,
    zone: 'A',
  };
}

// ── Hit testing ───────────────────────────────────────────────────────────

function hitTest(el, wx, wy) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const a = -(el.angle || 0) * Math.PI / 180;
  const dx = wx - cx, dy = wy - cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= el.w / 2 + 3 && Math.abs(ry) <= el.h / 2 + 3;
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
canvas.addEventListener('mouseup', onMouseUp);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('dblclick', onDblClick);

function onMouseDown(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const { x: wx, y: wy } = screenToWorld(cx, cy);

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
      if (e.shiftKey) {
        toggleSelect(hit.id);
      } else {
        if (!state.selectedIds.includes(hit.id)) selectOnly(hit.id);
      }
      isDragging = true;
      dragStart = { wx, wy };
      dragStartPositions = state.elements
        .filter(el => state.selectedIds.includes(el.id))
        .map(el => ({ id: el.id, x: el.x, y: el.y }));
    } else {
      if (!e.shiftKey) clearSelection();
      isMarquee = true;
      marqueeStart = { cx, cy, wx, wy };
    }
    return;
  }

  if (ELEMENT_DEFS[state.activeTool]) {
    pushUndo();
    const el = createElement(state.activeTool, wx, wy);
    state.elements.push(el);
    selectOnly(el.id);
    markModified();
    render();
    updateUI();
  }
}

function onMouseMove(e) {
  const { cx, cy } = getCanvasPos(e);
  const { x: wx, y: wy } = screenToWorld(cx, cy);

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
        el.x = snapToGrid(x + dx);
        el.y = snapToGrid(y + dy);
      }
    });
    markModified();
    render();
    return;
  }

  if (isMarquee) {
    const ms = marqueeStart;
    const rx = Math.min(cx, ms.cx), ry = Math.min(cy, ms.cy);
    const rw = Math.abs(cx - ms.cx), rh = Math.abs(cy - ms.cy);
    const box = document.getElementById('selectionBox');
    box.style.cssText = `display:block;left:${rx}px;top:${ry}px;width:${rw}px;height:${rh}px;`;
    return;
  }

  if (state.activeTool === 'select') {
    const hit = getElementAt(wx, wy);
    canvas.style.cursor = hit ? 'move' : 'default';
  } else if (ELEMENT_DEFS[state.activeTool]) {
    canvas.style.cursor = 'crosshair';
  }
}

function onMouseUp(e) {
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = state.activeTool === 'move' ? 'grab' : 'default';
  }

  if (isDragging) {
    isDragging = false;
    dragStart = null;
    dragStartPositions = null;
    updateUI();
  }

  if (isMarquee) {
    isMarquee = false;
    document.getElementById('selectionBox').style.display = 'none';
    const { cx, cy } = getCanvasPos(e);
    const ms = marqueeStart;
    const rx = Math.min(cx, ms.cx), ry = Math.min(cy, ms.cy);
    const rw = Math.abs(cx - ms.cx), rh = Math.abs(cy - ms.cy);

    if (rw > 5 || rh > 5) {
      const wx1 = (rx - state.panX) / state.zoom;
      const wy1 = (ry - state.panY) / state.zoom;
      const wx2 = wx1 + rw / state.zoom;
      const wy2 = wy1 + rh / state.zoom;
      state.elements.forEach(el => {
        if (el.x >= wx1 && el.y >= wy1 && el.x + el.w <= wx2 && el.y + el.h <= wy2) {
          if (!state.selectedIds.includes(el.id)) state.selectedIds.push(el.id);
        }
      });
      updateUI();
      render();
    }
    marqueeStart = null;
  }
}

function onWheel(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.min(4, Math.max(0.1, state.zoom * factor));
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
  if (hit) {
    if (!state.selectedIds.includes(hit.id)) selectOnly(hit.id);
    showContextMenu(e.clientX, e.clientY);
  }
}

function onDblClick(e) {
  const { cx, cy } = getCanvasPos(e);
  const { x: wx, y: wy } = screenToWorld(cx, cy);
  const hit = getElementAt(wx, wy);
  if (hit && hit.type === 'text_note') {
    const text = prompt('Edit note text:', hit.text || '');
    if (text !== null) {
      pushUndo();
      hit.text = text;
      markModified();
      render();
    }
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

  const nudge = e.shiftKey ? state.gridSize : 1;
  if (state.selectedIds.length && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    pushUndo();
    const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
    const dy = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0;
    state.selectedIds.forEach(id => {
      const el = state.elements.find(el => el.id === id);
      if (el) { el.x += dx; el.y += dy; }
    });
    markModified();
    render();
  }
});

// ── Selection helpers ─────────────────────────────────────────────────────

function selectOnly(id) {
  state.selectedIds = [id];
  updatePropertiesPanel();
  updateElementsList();
  render();
}

function toggleSelect(id) {
  const i = state.selectedIds.indexOf(id);
  if (i >= 0) state.selectedIds.splice(i, 1);
  else state.selectedIds.push(id);
  updatePropertiesPanel();
  updateElementsList();
  render();
}

function clearSelection() {
  state.selectedIds = [];
  updatePropertiesPanel();
  updateElementsList();
  render();
}

function setTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  canvas.style.cursor = tool === 'move' ? 'grab' : 'default';
  document.getElementById('canvasHint').textContent =
    tool === 'select' ? 'Click to select · Drag to move' :
    tool === 'move'   ? 'Drag to pan the canvas' :
    `Click to place: ${ELEMENT_DEFS[tool]?.label || tool}`;
}

// ── Undo / Redo ───────────────────────────────────────────────────────────

function pushUndo() {
  undoStack.push(JSON.stringify(state.elements));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state.elements));
  state.elements = JSON.parse(undoStack.pop());
  state.selectedIds = [];
  markModified();
  updateUI();
  render();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state.elements));
  state.elements = JSON.parse(redoStack.pop());
  state.selectedIds = [];
  markModified();
  updateUI();
  render();
}

// ── Delete / Duplicate ────────────────────────────────────────────────────

function deleteSelected() {
  if (!state.selectedIds.length) return;
  pushUndo();
  state.elements = state.elements.filter(el => !state.selectedIds.includes(el.id));
  state.selectedIds = [];
  markModified();
  updateUI();
  render();
}

function duplicateSelected() {
  if (!state.selectedIds.length) return;
  pushUndo();
  const newIds = [];
  state.selectedIds.forEach(id => {
    const el = state.elements.find(e => e.id === id);
    if (el) {
      const copy = { ...el, id: nextId++, x: el.x + 20, y: el.y + 20 };
      state.elements.push(copy);
      newIds.push(copy.id);
    }
  });
  state.selectedIds = newIds;
  markModified();
  updateUI();
  render();
}

// ── Context menu ──────────────────────────────────────────────────────────

const ctxMenu = document.getElementById('contextMenu');

function showContextMenu(x, y) {
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
  ctxMenu.classList.remove('hidden');
}

function hideContextMenu() { ctxMenu.classList.add('hidden'); }

ctxMenu.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'duplicate') duplicateSelected();
    else if (action === 'delete') deleteSelected();
    else if (action === 'bringFront') {
      pushUndo();
      state.selectedIds.forEach(id => {
        const i = state.elements.findIndex(e => e.id === id);
        if (i >= 0) state.elements.push(state.elements.splice(i, 1)[0]);
      });
      render();
    } else if (action === 'sendBack') {
      pushUndo();
      state.selectedIds.forEach(id => {
        const i = state.elements.findIndex(e => e.id === id);
        if (i > 0) state.elements.unshift(state.elements.splice(i, 1)[0]);
      });
      render();
    }
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

  let html = `<div class="prop-element-type">${def.label || el.type}</div><div class="prop-group">`;

  if (el.type !== 'text_note') {
    html += propInput('Label', 'label', el.label || '');
  }
  if (el.type === 'text_note') {
    html += `<div class="prop-row"><div class="prop-label">Text</div>
      <textarea data-prop="text">${el.text || ''}</textarea></div>`;
  }

  html += `
    <div class="prop-row">
      <div class="prop-label">Position</div>
      <div class="prop-row-inline">
        <label>X</label><input type="number" data-prop="x" value="${Math.round(el.x)}" />
        <label>Y</label><input type="number" data-prop="y" value="${Math.round(el.y)}" />
      </div>
    </div>
    <div class="prop-row">
      <div class="prop-label">Size</div>
      <div class="prop-row-inline">
        <label>W</label><input type="number" data-prop="w" value="${Math.round(el.w)}" min="4" />
        <label>H</label><input type="number" data-prop="h" value="${Math.round(el.h)}" min="4" />
      </div>
    </div>
    <div class="prop-row">
      <div class="prop-label">Rotation °</div>
      <input type="number" data-prop="angle" value="${el.angle || 0}" min="-180" max="180" step="5" />
    </div>
    <div class="prop-row">
      <div class="prop-label">Opacity</div>
      <input type="range" data-prop="opacity" value="${el.opacity !== undefined ? el.opacity : 1}"
        min="0.1" max="1" step="0.05" />
    </div>
  `;

  if (el.type === 'target_paper') {
    html += `
      <div class="prop-row"><div class="prop-label">Scoring Zone</div>
        <select data-prop="zone">
          <option ${el.zone === 'A' ? 'selected' : ''} value="A">A-Zone</option>
          <option ${el.zone === 'B' ? 'selected' : ''} value="B">B-Zone (Hard Cover)</option>
          <option ${el.zone === 'C' ? 'selected' : ''} value="C">C-Zone</option>
          <option ${el.zone === 'D' ? 'selected' : ''} value="D">D-Zone</option>
        </select>
      </div>`;
  }

  html += '</div>';
  panel.innerHTML = html;

  panel.querySelectorAll('[data-prop]').forEach(input => {
    const prop = input.dataset.prop;
    const update = () => {
      pushUndo();
      const val = (input.type === 'number' || input.type === 'range')
        ? parseFloat(input.value) : input.value;
      el[prop] = val;
      markModified();
      render();
      updateElementsList();
    };
    input.addEventListener('change', update);
    if (input.type === 'range') input.addEventListener('input', update);
  });
}

function propInput(labelText, prop, value) {
  return `<div class="prop-row"><div class="prop-label">${labelText}</div>
    <input type="text" data-prop="${prop}" value="${value.replace(/"/g, '&quot;')}" /></div>`;
}

// ── Elements list ─────────────────────────────────────────────────────────

function updateElementsList() {
  const list = document.getElementById('elementsList');
  list.innerHTML = '';
  [...state.elements].reverse().forEach(el => {
    const def = ELEMENT_DEFS[el.type] || {};
    const div = document.createElement('div');
    div.className = 'element-list-item' + (state.selectedIds.includes(el.id) ? ' selected' : '');
    div.innerHTML = `
      <span class="element-list-dot" style="background:${def.dot || '#888'}"></span>
      <span>${el.label || def.label || el.type}</span>
    `;
    div.addEventListener('click', () => selectOnly(el.id));
    list.appendChild(div);
  });
}

// ── Saved stages panel ────────────────────────────────────────────────────

function updateSavedStagesList() {
  const list = document.getElementById('savedStagesList');
  const stages = loadAllStages();
  list.innerHTML = '';

  if (!stages.length) {
    list.innerHTML = `<div style="color:var(--text-dim);font-size:11px;text-align:center;padding:8px">No saved stages</div>`;
    return;
  }

  stages.forEach(s => {
    const div = document.createElement('div');
    div.className = 'saved-stage-item';
    div.innerHTML = `
      <div>
        <div class="saved-stage-name">${s.name}</div>
        <div class="saved-stage-meta">${s.elements.length} elem · ${new Date(s.savedAt).toLocaleDateString('en-US')}</div>
      </div>
      <div class="saved-stage-actions">
        <button data-action="load" data-id="${s.id}" title="Load stage">↓</button>
        <button data-action="del"  data-id="${s.id}" title="Delete stage">✕</button>
      </div>
    `;
    div.querySelector('[data-action=load]').addEventListener('click', e => {
      e.stopPropagation();
      if (state.modified && !confirm('You have unsaved changes. Discard and load?')) return;
      loadStageById(s.id);
    });
    div.querySelector('[data-action=del]').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete stage "${s.name}"? This cannot be undone.`)) {
        deleteStageById(s.id);
        updateSavedStagesList();
        toast('Stage deleted.');
      }
    });
    div.addEventListener('click', () => {
      if (state.modified && !confirm('You have unsaved changes. Discard and load?')) return;
      loadStageById(s.id);
    });
    list.appendChild(div);
  });
}

// ── Storage ───────────────────────────────────────────────────────────────

function loadAllStages() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveAllStages(stages) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stages));
}

function saveStage() {
  const name = document.getElementById('stageName').value.trim() || 'Untitled Stage';
  const stages = loadAllStages();
  const id = state.stageId || ('stage_' + Date.now());
  state.stageId = id;

  const idx = stages.findIndex(s => s.id === id);
  const saved = {
    id,
    name,
    elements: state.elements,
    nextId,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    stageInfo: {
      minRounds: document.getElementById('minRounds').value,
      maxRounds: document.getElementById('maxRounds').value,
      scoring: document.getElementById('scoring').value,
      division: document.getElementById('division').value,
    },
    savedAt: Date.now(),
  };

  if (idx >= 0) stages[idx] = saved;
  else stages.unshift(saved);

  saveAllStages(stages);
  state.modified = false;
  document.getElementById('stageMeta').textContent =
    `Saved ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  updateSavedStagesList();
  toast('Stage saved!', 'success');
}

function loadStageById(id) {
  const stages = loadAllStages();
  const s = stages.find(s => s.id === id);
  if (!s) return;

  state.elements = s.elements || [];
  state.stageId = s.id;
  state.modified = false;
  nextId = s.nextId || (Math.max(0, ...state.elements.map(e => e.id)) + 1);
  state.zoom = s.zoom || 1;
  state.panX = s.panX || canvas.width / 2 - 200;
  state.panY = s.panY || canvas.height / 2 - 200;
  state.selectedIds = [];

  document.getElementById('stageName').value = s.name;
  document.getElementById('stageMeta').textContent =
    `Loaded · ${new Date(s.savedAt).toLocaleDateString('en-US')}`;

  if (s.stageInfo) {
    document.getElementById('minRounds').value = s.stageInfo.minRounds;
    document.getElementById('maxRounds').value = s.stageInfo.maxRounds;
    document.getElementById('scoring').value = s.stageInfo.scoring;
    document.getElementById('division').value = s.stageInfo.division;
  }

  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  updateUI();
  render();
  toast(`Loaded: ${s.name}`);
}

function deleteStageById(id) {
  saveAllStages(loadAllStages().filter(s => s.id !== id));
}

function newStage() {
  if (state.modified && !confirm('You have unsaved changes. Discard and create a new stage?')) return;
  state.elements = [];
  state.selectedIds = [];
  state.stageId = null;
  state.modified = false;
  nextId = 1;
  state.panX = canvas.width / 2 - 300;
  state.panY = canvas.height / 2 - 200;
  state.zoom = 1;
  document.getElementById('stageName').value = 'New Stage';
  document.getElementById('stageMeta').textContent = 'Unsaved';
  document.getElementById('zoomLevel').textContent = '100%';
  updateUI();
  render();
}

function exportStage() {
  const name = document.getElementById('stageName').value.trim() || 'stage';
  const data = {
    name,
    elements: state.elements,
    stageInfo: {
      minRounds: document.getElementById('minRounds').value,
      maxRounds: document.getElementById('maxRounds').value,
      scoring: document.getElementById('scoring').value,
      division: document.getElementById('division').value,
    },
    exportedAt: new Date().toISOString(),
    appVersion: 1,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/\s+/g, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Stage exported as JSON.');
}

function importStage(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.elements) throw new Error('Invalid stage file format.');
      if (state.modified && !confirm('You have unsaved changes. Discard and import?')) return;
      state.elements = data.elements;
      nextId = Math.max(0, ...state.elements.map(e => e.id)) + 1;
      state.stageId = null;
      state.selectedIds = [];
      state.modified = true;
      document.getElementById('stageName').value = data.name || 'Imported Stage';
      document.getElementById('stageMeta').textContent = 'Imported (unsaved)';
      if (data.stageInfo) {
        document.getElementById('minRounds').value = data.stageInfo.minRounds || 12;
        document.getElementById('maxRounds').value = data.stageInfo.maxRounds || 12;
        document.getElementById('scoring').value   = data.stageInfo.scoring   || 'Comstock';
        document.getElementById('division').value  = data.stageInfo.division  || 'Open';
      }
      updateUI();
      render();
      toast('Stage imported successfully!', 'success');
    } catch (err) {
      toast('Error: Invalid or unrecognized file format.', 'error');
    }
  };
  reader.readAsText(file);
}

// ── UI updates ────────────────────────────────────────────────────────────

function updateUI() {
  updatePropertiesPanel();
  updateElementsList();
  updateSavedStagesList();
}

function markModified() {
  state.modified = true;
  document.getElementById('stageMeta').textContent = 'Unsaved changes';
}

// ── Zoom controls ─────────────────────────────────────────────────────────

function zoom(factor) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const newZoom = Math.min(4, Math.max(0.1, state.zoom * factor));
  state.panX = cx - (cx - state.panX) * (newZoom / state.zoom);
  state.panY = cy - (cy - state.panY) * (newZoom / state.zoom);
  state.zoom = newZoom;
  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  render();
}

function zoomFit() {
  if (!state.elements.length) {
    state.zoom = 1; state.panX = 100; state.panY = 100; render(); return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.elements.forEach(el => {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  });
  const pad = 80;
  const zx = (canvas.width - pad * 2) / (maxX - minX);
  const zy = (canvas.height - pad * 2) / (maxY - minY);
  state.zoom = Math.min(4, Math.max(0.1, Math.min(zx, zy)));
  state.panX = pad - minX * state.zoom;
  state.panY = pad - minY * state.zoom;
  document.getElementById('zoomLevel').textContent = Math.round(state.zoom * 100) + '%';
  render();
}

// ── Toast notifications ───────────────────────────────────────────────────

let toastTimer;

function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = type;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── Button wiring ─────────────────────────────────────────────────────────

document.getElementById('btnNew').addEventListener('click', newStage);
document.getElementById('btnSave').addEventListener('click', saveStage);
document.getElementById('btnExport').addEventListener('click', exportStage);
document.getElementById('btnLoad').addEventListener('click', () => {
  document.getElementById('loadModal').classList.remove('hidden');
  renderLoadModal();
});
document.getElementById('closeLoadModal').addEventListener('click', () => {
  document.getElementById('loadModal').classList.add('hidden');
});
document.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  document.getElementById('loadModal').classList.add('hidden');
});
document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', e => {
  if (e.target.files[0]) importStage(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('btnZoomIn').addEventListener('click', () => zoom(1.2));
document.getElementById('btnZoomOut').addEventListener('click', () => zoom(0.8));
document.getElementById('btnZoomFit').addEventListener('click', zoomFit);
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnDelete').addEventListener('click', deleteSelected);
document.getElementById('btnDuplicate').addEventListener('click', duplicateSelected);

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

document.getElementById('toggleGrid').addEventListener('change', e => {
  state.showGrid = e.target.checked;
  render();
});
document.getElementById('snapGrid').addEventListener('change', e => {
  state.snapGrid = e.target.checked;
});
document.getElementById('gridSize').addEventListener('change', e => {
  state.gridSize = parseInt(e.target.value);
});

function renderLoadModal() {
  const list = document.getElementById('loadModalList');
  const stages = loadAllStages();
  if (!stages.length) {
    list.innerHTML = `<div style="color:var(--text-dim);padding:20px;text-align:center">No saved stages found.</div>`;
    return;
  }
  list.innerHTML = stages.map(s => `
    <div class="saved-stage-item" style="margin-bottom:6px">
      <div>
        <div class="saved-stage-name">${s.name}</div>
        <div class="saved-stage-meta">${s.elements.length} elements · Saved ${new Date(s.savedAt).toLocaleString('en-US')}</div>
      </div>
      <div class="saved-stage-actions">
        <button class="btn btn-primary" data-action="load" data-id="${s.id}">Load</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action=load]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.modified && !confirm('You have unsaved changes. Discard and load?')) return;
      loadStageById(btn.dataset.id);
      document.getElementById('loadModal').classList.add('hidden');
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────

function init() {
  resizeCanvas();
  state.panX = canvas.width / 2 - 300;
  state.panY = canvas.height / 2 - 200;
  updateUI();
  render();
}

init();
