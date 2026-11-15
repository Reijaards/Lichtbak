// Lichtbak — werkruimte Bewerken: lagen, maskers, selecties, penselen, retoucheren
import * as E from './engine.js';

let C = null;                    // hulpfuncties uit app.js
let doc = null;                  // geopend document
const view = {s:1, ox:0, oy:0, fit:true};
let tool = 'brush', seg = 'opties';
let maskTarget = false, maskHide = true;
let hist = [], hi = -1, histBytes = 0;
const HIST_MAX_BYTES = 220*1024*1024;
let stroke = null, preview = null, cloneSrc = null, cloneOff = null;
let saveT = 0, rq = false, flatCache = null;
const opt = {
  brush:{size:40, hard:70, opac:100},
  eraser:{size:60, hard:70, opac:100},
  clone:{size:70, hard:50, opac:100, aligned:true},
  heal:{size:40},
  select:{shape:'rect', mode:'new', tol:32, contig:true, feather:0},
  fill:{mode:'fill', tol:32, contig:true, grad:'fgbg'},
  text:{font:0, size:120},
  move:{keep:true},
};
const BLENDS = [['source-over','Normaal'], ['multiply','Vermenigvuldigen'], ['screen','Bleken'], ['overlay','Bedekken'], ['soft-light','Zacht licht'], ['hard-light','Fel licht'],
  ['darken','Donkerder'], ['lighten','Lichter'], ['color-dodge','Kleur tegenhouden'], ['color-burn','Kleur doordrukken'], ['difference','Verschil'], ['exclusion','Uitsluiting'],
  ['hue','Kleurtoon'], ['saturation','Verzadiging'], ['color','Kleur'], ['luminosity','Lichtsterkte']];

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
function mk(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function cloneCanvas(src){ const c = mk(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
const cx2 = c => c.getContext('2d', {willReadFrequently:false});
const M = l => new DOMMatrix().translateSelf(l.x, l.y).rotateSelf(l.rot).scaleSelf(l.sx, l.sy).translateSelf(-l.canvas.width/2, -l.canvas.height/2);
const active = () => doc && doc.layers.find(l => l.id === doc.active);
const req = () => { if(!rq){ rq = true; requestAnimationFrame(render); } };

/* ================= lagen ================= */
function newLayer(canvas, props = {}){
  return {id:C.uid(), name:'Laag', kind:'pixel', canvas, mask:null, maskOn:true, x:doc.w/2, y:doc.h/2, sx:1, sy:1, rot:0, opacity:1, blend:'source-over', visible:true, text:null, dirty:true, ...props};
}
const PROPS = ['name','kind','canvas','mask','maskOn','x','y','sx','sy','rot','opacity','blend','visible','text'];
const snapProps = l => { const o = {}; PROPS.forEach(k => o[k] = k === 'text' && l.text ? {...l.text} : l[k]); return o; };
function snapDoc(){ return {layers:doc.layers.map(l => ({l, p:snapProps(l)})), active:doc.active, sel:doc.sel}; }
function restoreDoc(s){ doc.layers = s.layers.map(({l, p}) => { if(l.canvas !== p.canvas || l.mask !== p.mask || l.kind !== p.kind) l.dirty = true; Object.assign(l, p); if(p.text) l.text = {...p.text}; return l; }); doc.active = s.active; setSel(s.sel, false); }

/* ================= geschiedenis ================= */
function pushHist(entry){
  hist = hist.slice(0, hi+1); hist.push(entry); hi = hist.length-1; histBytes += entry.bytes || 0;
  while(histBytes > HIST_MAX_BYTES && hist.length > 2){ const e = hist.shift(); histBytes -= e.bytes || 0; hi--; }
  changed();
}
function structural(label, fn){ const before = snapDoc(); const r = fn(); const after = snapDoc(); pushHist({label, undo:() => restoreDoc(before), redo:() => restoreDoc(after)}); return r; }
function pixelEntry(l, target, rect, before, after, label){
  const put = d => { const c = l[target]; if(!c) return; c.getContext('2d').putImageData(d, rect[0], rect[1]); l.dirty = true; flatCache = null; };
  pushHist({label, bytes:before.data.length*2, undo:() => put(before), redo:() => put(after)});
}
function editPixels(l, target, label, fn){
  const c = l[target], x = c.getContext('2d', {willReadFrequently:true});
  const before = x.getImageData(0, 0, c.width, c.height);
  x.save(); fn(x); x.restore();
  const after = x.getImageData(0, 0, c.width, c.height);
  l.dirty = true; pixelEntry(l, target, [0, 0], before, after, label);
}
function undo(){ if(hi < 0) return; hist[hi].undo(); hi--; changed(true); }
function redo(){ if(hi >= hist.length-1) return; hi++; hist[hi].redo(); changed(true); }
function changed(fromHist){
  flatCache = null;
  $('#bwUndo').disabled = hi < 0; $('#bwRedo').disabled = hi >= hist.length-1;
  scheduleSave(); syncLayers(); syncOptions(); req();
}

/* ================= samenstellen ================= */
let tmpA = null, maskWork = null;
function tmp(w, h){ if(!tmpA || tmpA.width !== w || tmpA.height !== h) tmpA = mk(w, h); const x = tmpA.getContext('2d'); x.setTransform(1,0,0,1,0,0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, w, h); return tmpA; }
function filterFor(l, m){
  if(!preview || preview.layer !== l) return 'none';
  const p = preview, k = Math.hypot(m.a, m.b), f = [];
  if(p.bright) f.push(`brightness(${1 + p.bright/100})`);
  if(p.contrast) f.push(`contrast(${1 + p.contrast/100})`);
  if(p.sat) f.push(`saturate(${1 + p.sat/100})`);
  if(p.hue) f.push(`hue-rotate(${p.hue}deg)`);
  if(p.blur) f.push(`blur(${(p.blur*k).toFixed(2)}px)`);
  if(p.gray) f.push('grayscale(1)');
  if(p.invert) f.push('invert(1)');
  return f.join(' ') || 'none';
}
function composite(ctx, layers, base, tw, th){
  for(const l of layers){
    if(!l.visible) continue;
    const m = base.multiply(M(l)), st = stroke && stroke.layer === l ? stroke : null;
    const hasMask = l.mask && l.maskOn;
    if(!hasMask && !st && !(preview && preview.layer === l && preview.sel)){
      ctx.save(); ctx.setTransform(m); ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend; ctx.filter = filterFor(l, m); ctx.drawImage(l.canvas, 0, 0); ctx.restore();
      continue;
    }
    const t = tmp(tw, th), x = t.getContext('2d');
    x.setTransform(m);
    if(preview && preview.layer === l && preview.sel){
      x.drawImage(l.canvas, 0, 0);
      const t2 = mk(tw, th), y = t2.getContext('2d'); y.setTransform(m); y.filter = filterFor(l, m); y.drawImage(l.canvas, 0, 0); y.filter = 'none';
      y.setTransform(base); y.globalCompositeOperation = 'destination-in'; y.drawImage(doc.sel, 0, 0);
      x.setTransform(1,0,0,1,0,0); x.drawImage(t2, 0, 0); x.setTransform(m);
    } else { x.filter = filterFor(l, m); x.drawImage(l.canvas, 0, 0); x.filter = 'none'; }
    if(st && st.target === 'canvas' && st.kind !== 'heal'){ x.globalAlpha = st.opac; x.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'; x.drawImage(st.buf, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; }
    if(hasMask){
      let mc = l.mask;
      if(st && st.target === 'mask'){
        if(!maskWork || maskWork.width !== mc.width || maskWork.height !== mc.height) maskWork = mk(mc.width, mc.height);
        const w = maskWork.getContext('2d'); w.globalCompositeOperation = 'copy'; w.globalAlpha = 1; w.drawImage(mc, 0, 0);
        w.globalAlpha = st.opac; w.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'; w.drawImage(st.buf, 0, 0); w.globalAlpha = 1; w.globalCompositeOperation = 'source-over';
        mc = maskWork;
      }
      x.globalCompositeOperation = 'destination-in'; x.drawImage(mc, 0, 0); x.globalCompositeOperation = 'source-over';
    }
    if(st && st.kind === 'heal'){ x.globalAlpha = .45; x.globalCompositeOperation = 'source-over'; x.drawImage(st.buf, 0, 0); x.globalAlpha = 1; }
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend; ctx.drawImage(t, 0, 0); ctx.restore();
  }
}
export function flattenLayers(layers, w, h, bg = null){
  const c = mk(w, h), x = c.getContext('2d');
  if(bg){ x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  const saveP = preview, saveS = stroke; preview = null; stroke = null;
  composite(x, layers, new DOMMatrix(), w, h);
  preview = saveP; stroke = saveS;
  return c;
}
function flatData(){
  if(!flatCache){ const c = flattenLayers(doc.layers, doc.w, doc.h); flatCache = c.getContext('2d', {willReadFrequently:true}).getImageData(0, 0, doc.w, doc.h); }
  return flatCache;
}

/* ================= weergave ================= */
let checker = null;
function checkerPattern(x){
  if(!checker){ const c = mk(16, 16), y = c.getContext('2d'); y.fillStyle = '#cfd2d6'; y.fillRect(0, 0, 16, 16); y.fillStyle = '#eef0f2'; y.fillRect(0, 0, 8, 8); y.fillRect(8, 8, 8, 8); checker = c; }
  return x.createPattern(checker, 'repeat');
}
function render(){
  rq = false; if(!doc) return;
  const cv = $('#bwView'), st = $('#bwStage'), r = st.getBoundingClientRect(), d = dpr();
  const W = Math.round(r.width*d), H = Math.round(r.height*d);
  if(cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
  const x = cv.getContext('2d'); x.setTransform(1,0,0,1,0,0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H);
  const base = new DOMMatrix([view.s*d, 0, 0, view.s*d, view.ox*d, view.oy*d]);
  const x0 = view.ox*d, y0 = view.oy*d, dw = doc.w*view.s*d, dh = doc.h*view.s*d;
  x.fillStyle = checkerPattern(x); x.fillRect(x0, y0, dw, dh);
  x.save(); x.beginPath(); x.rect(x0, y0, dw, dh); x.clip();
  x.imageSmoothingQuality = view.s < 1 ? 'medium' : 'low';
  composite(x, doc.layers, base, W, H);
  x.restore();
  overlay(x, base, d);
  $('#bwZoom').textContent = Math.round(view.s*100) + '%';
}
function overlay(x, base, d){
  // selectie: buiten de selectie dimmen + rand
  if(doc.sel){
    const t = tmp(x.canvas.width, x.canvas.height), y = t.getContext('2d');
    y.setTransform(base); y.fillStyle = '#000'; y.fillRect(0, 0, doc.w, doc.h);
    y.globalCompositeOperation = 'destination-out'; y.drawImage(doc.sel, 0, 0); y.globalCompositeOperation = 'source-over';
    x.save(); x.globalAlpha = .42; x.drawImage(t, 0, 0); x.restore();
    if(doc.selEdge){ x.save(); x.setTransform(base.scale(doc.w/doc.selEdge.width, doc.h/doc.selEdge.height)); x.imageSmoothingEnabled = false; x.drawImage(doc.selEdge, 0, 0); x.restore(); }
  }
  x.save(); x.setTransform(1,0,0,1,0,0); x.lineWidth = 1.5*d;
  const P = (px, py) => { const p = base.transformPoint({x:px, y:py}); return [p.x, p.y]; };
  const dashLine = draw => { x.setLineDash([]); x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 3*d; draw(); x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 1.5*d; x.setLineDash([6*d, 5*d]); draw(); x.stroke(); x.setLineDash([]); };
  if(drag && drag.kind === 'sel' && drag.cur){
    const a = drag.start, b = drag.cur;
    if(opt.select.shape === 'lasso') dashLine(() => { x.beginPath(); drag.pts.forEach((p, i) => { const [sx, sy] = P(p.x, p.y); i ? x.lineTo(sx, sy) : x.moveTo(sx, sy); }); });
    else { const [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
      dashLine(() => { x.beginPath(); if(opt.select.shape === 'ellipse') x.ellipse((ax+bx)/2, (ay+by)/2, Math.abs(bx-ax)/2, Math.abs(by-ay)/2, 0, 0, Math.PI*2); else x.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx-ax), Math.abs(by-ay)); }); }
  }
  if(drag && drag.kind === 'grad' && drag.cur){ const [ax, ay] = P(drag.start.x, drag.start.y), [bx, by] = P(drag.cur.x, drag.cur.y); dashLine(() => { x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); }); }
  const l = active();
  if(tool === 'move' && l && l.visible){
    const q = corners(l, base); x.strokeStyle = '#fff'; x.lineWidth = 1.5*d; x.setLineDash([]);
    x.beginPath(); q.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)); x.closePath(); x.stroke();
    const rh = rotHandle(q, d); x.beginPath(); x.moveTo((q[0].x+q[1].x)/2, (q[0].y+q[1].y)/2); x.lineTo(rh.x, rh.y); x.stroke();
    [...q, rh].forEach((p, i) => { x.beginPath(); x.arc(p.x, p.y, 7*d, 0, Math.PI*2); x.fillStyle = i === 4 ? '#f0a43a' : '#fff'; x.fill(); x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke(); });
  }
  if(hoverPt && ['brush','eraser','clone','heal'].includes(tool) && !pinch){
    const [hx, hy] = P(hoverPt.x, hoverPt.y), r = opt[tool].size/2*view.s*d;
    x.beginPath(); x.arc(hx, hy, Math.max(2, r), 0, Math.PI*2); x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 3*d; x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 1.2*d; x.stroke();
  }
  if(tool === 'clone' && cloneSrc){
    let sp = cloneSrc; if(stroke && stroke.kind === 'clone' && hoverPt) sp = {x:hoverPt.x + stroke.docOff.x, y:hoverPt.y + stroke.docOff.y};
    const [sx, sy] = P(sp.x, sp.y); x.strokeStyle = '#fff'; x.lineWidth = 1.5*d;
    x.beginPath(); x.moveTo(sx-10*d, sy); x.lineTo(sx+10*d, sy); x.moveTo(sx, sy-10*d); x.lineTo(sx, sy+10*d); x.stroke();
    x.beginPath(); x.arc(sx, sy, opt.clone.size/2*view.s*d, 0, Math.PI*2); x.setLineDash([4*d, 4*d]); x.stroke(); x.setLineDash([]);
  }
  x.restore();
}
function corners(l, base){ const m = base.multiply(M(l)), w = l.canvas.width, h = l.canvas.height; return [[0,0],[w,0],[w,h],[0,h]].map(([a, b]) => m.transformPoint({x:a, y:b})); }
function rotHandle(q, d){ const mx = (q[0].x+q[1].x)/2, my = (q[0].y+q[1].y)/2, cx = (q[0].x+q[2].x)/2, cy = (q[0].y+q[2].y)/2; const L = Math.hypot(mx-cx, my-cy) || 1; return {x:mx + (mx-cx)/L*34*d, y:my + (my-cy)/L*34*d}; }
function fitView(){
  const r = $('#bwStage').getBoundingClientRect(), pad = 20;
  view.s = Math.min((r.width-2*pad)/doc.w, (r.height-2*pad)/doc.h);
  view.ox = (r.width - doc.w*view.s)/2; view.oy = (r.height - doc.h*view.s)/2; view.fit = true; req();
}
function zoomAt(sx, sy, s){ view.fit = false; const p = {x:(sx-view.ox)/view.s, y:(sy-view.oy)/view.s}; view.s = clamp(s, .02, 32); view.ox = sx - p.x*view.s; view.oy = sy - p.y*view.s; req(); }

/* ================= selectie ================= */
function setSel(c, hist = true, label = 'Selectie'){
  const before = doc.sel;
  doc.sel = c; flatCacheSel = null;
  doc.selEdge = c ? edgeOf(c) : null;
  if(hist && before !== c) pushHist({label, undo:() => { doc.sel = before; doc.selEdge = before ? edgeOf(before) : null; }, redo:() => { doc.sel = c; doc.selEdge = c ? edgeOf(c) : null; }});
  syncOptions(); req();
}
let flatCacheSel = null;
function edgeOf(sel){
  const s = Math.min(1, 1400/Math.max(sel.width, sel.height)), w = Math.max(2, Math.round(sel.width*s)), h = Math.max(2, Math.round(sel.height*s));
  const a = mk(w, h), x = a.getContext('2d', {willReadFrequently:true}); x.drawImage(sel, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, out = x.createImageData(w, h), o = out.data;
  const on = i => d[i*4+3] >= 128;
  for(let y = 0; y < h; y++) for(let xx = 0; xx < w; xx++){
    const i = y*w + xx, v = on(i);
    const edge = (xx > 0 && on(i-1) !== v) || (xx < w-1 && on(i+1) !== v) || (y > 0 && on(i-w) !== v) || (y < h-1 && on(i+w) !== v);
    if(edge && v){ const k = i*4, light = ((xx + y) >> 2) & 1; o[k] = o[k+1] = o[k+2] = light ? 255 : 0; o[k+3] = 255; }
  }
  x.putImageData(out, 0, 0); return a;
}
function selCombine(draw, label){
  const t = mk(doc.w, doc.h), x = t.getContext('2d'); x.fillStyle = '#fff'; draw(x);
  let shape = t;
  if(opt.select.feather > 0){ shape = mk(doc.w, doc.h); const y = shape.getContext('2d'); y.filter = `blur(${opt.select.feather}px)`; y.drawImage(t, 0, 0); }
  const mode = opt.select.mode;
  if(mode === 'new' || !doc.sel){ if(mode === 'sub'){ return; } setSel(shape, true, label); return; }
  const s = cloneCanvas(doc.sel), y = s.getContext('2d'); y.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out'; y.drawImage(shape, 0, 0);
  setSel(s, true, label);
}
function floodMask(px, py, tol, contig){
  const img = flatData(), d = img.data, w = doc.w, h = doc.h, x0 = Math.floor(px), y0 = Math.floor(py);
  if(x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  const i0 = (y0*w + x0)*4, r0 = d[i0], g0 = d[i0+1], b0 = d[i0+2], a0 = d[i0+3], T = tol*2.55;
  const ok = i => { const k = i*4; return Math.abs(d[k]-r0) <= T && Math.abs(d[k+1]-g0) <= T && Math.abs(d[k+2]-b0) <= T && Math.abs(d[k+3]-a0) <= T; };
  const m = new Uint8Array(w*h);
  if(contig){
    const stack = [x0, y0];
    while(stack.length){
      const y = stack.pop(); let x = stack.pop(); let i = y*w + x;
      while(x >= 0 && !m[i] && ok(i)){ x--; i--; }
      x++; i++; let up = false, dn = false;
      while(x < w && !m[i] && ok(i)){
        m[i] = 1;
        if(y > 0){ const j = i-w; if(!m[j] && ok(j)){ if(!up){ stack.push(x, y-1); up = true; } } else up = false; }
        if(y < h-1){ const j = i+w; if(!m[j] && ok(j)){ if(!dn){ stack.push(x, y+1); dn = true; } } else dn = false; }
        x++; i++;
      }
    }
  } else { for(let i = 0; i < w*h; i++) if(ok(i)) m[i] = 1; }
  const c = mk(w, h), x = c.getContext('2d'), id = x.createImageData(w, h), o = id.data;
  for(let i = 0; i < w*h; i++) if(m[i]){ const k = i*4; o[k] = o[k+1] = o[k+2] = 255; o[k+3] = 255; }
  x.putImageData(id, 0, 0); return c;
}
function selToLayer(l, target = 'canvas'){ // selectie in laag-coördinaten
  const c = l[target], t = mk(c.width, c.height), x = t.getContext('2d'); x.setTransform(M(l).inverse()); x.drawImage(doc.sel, 0, 0); return t;
}
const selActions = {
  all(){ const c = mk(doc.w, doc.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h); setSel(c, true, 'Alles selecteren'); },
  none(){ if(doc.sel) setSel(null, true, 'Deselecteren'); },
  invert(){ const c = mk(doc.w, doc.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h); if(doc.sel){ x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.sel, 0, 0); } setSel(c, true, 'Selectie omkeren'); },
  feather(px){ if(!doc.sel) return; const c = mk(doc.w, doc.h), x = c.getContext('2d'); x.filter = `blur(${px}px)`; x.drawImage(doc.sel, 0, 0); setSel(c, true, 'Doezelen'); },
  grow(px){ if(!doc.sel) return; const r = Math.abs(px), c = mk(doc.w, doc.h), x = c.getContext('2d', {willReadFrequently:true}); x.filter = `blur(${r/2}px)`; x.drawImage(doc.sel, 0, 0); x.filter = 'none';
    const id = x.getImageData(0, 0, doc.w, doc.h), d = id.data, th = px > 0 ? 20 : 235; for(let i = 3; i < d.length; i += 4){ const on = d[i] > th; d[i-3] = d[i-2] = d[i-1] = 255; d[i] = on ? 255 : 0; } x.putImageData(id, 0, 0); setSel(c, true, px > 0 ? 'Selectie uitbreiden' : 'Selectie inkrimpen'); },
  clear(){ const l = editable(); if(!l || !doc.sel) return; const inv = M(l).inverse(); editPixels(l, 'canvas', 'Selectie wissen', x => { x.setTransform(inv); x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.sel, 0, 0); }); },
  fill(){ const l = editable(); if(!l) return; const s = doc.sel; const inv = M(l).inverse();
    editPixels(l, 'canvas', 'Vullen', x => { const t = mk(doc.w, doc.h), y = t.getContext('2d'); y.fillStyle = doc.fg; y.fillRect(0, 0, doc.w, doc.h); if(s){ y.globalCompositeOperation = 'destination-in'; y.drawImage(s, 0, 0); } x.setTransform(inv); x.drawImage(t, 0, 0); }); },
  copy(cut){
    const l = active(); if(!l) return; if(!doc.sel){ C.toast('Maak eerst een selectie.'); return; }
    const c = flattenLayers([{...l, visible:true, opacity:1, blend:'source-over'}], doc.w, doc.h); const x = c.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(doc.sel, 0, 0);
    structural(cut ? 'Uitknippen naar laag' : 'Kopiëren naar laag', () => {
      if(cut && l.kind === 'pixel'){ const inv = M(l).inverse(), y = l.canvas.getContext('2d'); y.save(); y.setTransform(inv); y.globalCompositeOperation = 'destination-out'; y.drawImage(doc.sel, 0, 0); y.restore(); l.dirty = true; }
      const nl = newLayer(c, {name:(cut ? 'Uitgeknipt' : 'Kopie') + ' van ' + l.name}); insertAbove(nl, l);
    });
    if(cut){ C.toast('Uitgeknipt naar een nieuwe laag'); } else C.toast('Gekopieerd naar een nieuwe laag');
  },
  mask(){
    const l = active(); if(!l) return;
    structural(doc.sel ? 'Masker van selectie' : 'Laagmasker toevoegen', () => {
      if(doc.sel){ l.mask = selToLayer(l); }
      else { const m = mk(l.canvas.width, l.canvas.height), x = m.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, m.width, m.height); l.mask = m; }
      l.maskOn = true; l.dirty = true; maskTarget = true;
    });
    C.toast(doc.sel ? 'Alles buiten de selectie is nu verborgen. Het origineel blijft bewaard in de laag.' : 'Laagmasker toegevoegd. Schilder met zwart om te verbergen.', 4000);
  },
};
function editable(){
  const l = active(); if(!l){ C.toast('Er is geen laag geselecteerd.'); return null; }
  if(l.kind === 'text') rasterize(l);
  return l;
}
function rasterize(l){ structural('Tekst omzetten naar pixels', () => { l.kind = 'pixel'; l.text = null; l.dirty = true; }); C.toast('Tekstlaag omgezet naar pixels, zodat je erop kunt tekenen.'); }

/* ================= penselen ================= */
const tips = new Map();
function tip(d, hard, color){
  const k = `${Math.round(d*2)/2}|${hard}|${color}`; let t = tips.get(k); if(t) return t;
  if(tips.size > 80) tips.clear();
  const s = Math.ceil(d) + 2; t = mk(s, s); const x = t.getContext('2d'), r = d/2, c = s/2;
  const g = x.createRadialGradient(c, c, 0, c, c, r), h = Math.min(.98, hard/100);
  const rgb = hexRgb(color); g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(h, `rgba(${rgb},1)`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.beginPath(); x.arc(c, c, r, 0, Math.PI*2); x.fill(); tips.set(k, t); return t;
}
function hexRgb(h){ const n = parseInt(h.slice(1), 16); return `${n>>16},${(n>>8)&255},${n&255}`; }
let bufC = null, cloneTmp = null;
function beginStroke(p, e){
  const l = active(); if(!l){ C.toast('Voeg eerst een laag toe.'); return false; }
  if(!l.visible){ C.toast('Deze laag is verborgen. Zet het oogje aan om erop te werken.'); return false; }
  if(l.kind === 'text' && !(maskTarget && l.mask)) rasterize(l);
  const o = opt[tool], target = maskTarget && l.mask ? 'mask' : 'canvas', tc = l[target];
  if(tool === 'clone' && !cloneSrc){ C.toast('Kies eerst een bron: tik op "Bron kiezen" (of Alt+klik op de pc).', 4000); return false; }
  if(!bufC || bufC.width !== tc.width || bufC.height !== tc.height) bufC = mk(tc.width, tc.height); else bufC.getContext('2d').clearRect(0, 0, bufC.width, bufC.height);
  const inv = M(l).inverse(), ls = Math.sqrt(Math.abs(l.sx*l.sy)), lp = inv.transformPoint(p);
  let erase = tool === 'eraser', color = doc.fg;
  if(target === 'mask'){ erase = tool === 'eraser' ? !maskHide : maskHide; color = '#ffffff'; }
  if(tool === 'heal') color = '#ff3b30';
  stroke = {layer:l, kind:tool, target, erase, color, opac:(o.opac ?? 100)/100, buf:bufC, inv, size:o.size/ls, hard:o.hard ?? 80, bbox:[1e9, 1e9, -1e9, -1e9], last:lp};
  if(tool === 'clone'){
    if(!opt.clone.aligned || !cloneOff) cloneOff = {x:cloneSrc.x - p.x, y:cloneSrc.y - p.y};
    stroke.docOff = cloneOff; stroke.snap = cloneCanvas(tc);
    const sp = inv.transformPoint({x:p.x + cloneOff.x, y:p.y + cloneOff.y}); stroke.localOff = {x:sp.x - lp.x, y:sp.y - lp.y};
  }
  dab(lp, pressureOf(e)); req(); return true;
}
const pressureOf = e => e && e.pointerType === 'pen' && e.pressure > 0 ? clamp(e.pressure*1.4, .15, 1) : 1;
function dab(p, pr){
  const s = stroke, d = Math.max(1, s.size*pr), b = s.buf.getContext('2d');
  if(s.kind === 'clone'){
    const t = tip(d, s.hard, '#000000'), w = t.width;
    if(!cloneTmp || cloneTmp.width < w) cloneTmp = mk(w*1.5, w*1.5);
    const x = cloneTmp.getContext('2d'); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, cloneTmp.width, cloneTmp.height); x.drawImage(t, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.drawImage(s.snap, p.x + s.localOff.x - w/2, p.y + s.localOff.y - w/2, w, w, 0, 0, w, w);
    b.drawImage(cloneTmp, 0, 0, w, w, p.x - w/2, p.y - w/2, w, w);
  } else { const t = tip(d, s.hard, s.color); b.drawImage(t, p.x - t.width/2, p.y - t.width/2); }
  const r = d/2 + 2, bb = s.bbox; bb[0] = Math.min(bb[0], p.x-r); bb[1] = Math.min(bb[1], p.y-r); bb[2] = Math.max(bb[2], p.x+r); bb[3] = Math.max(bb[3], p.y+r);
}
function moveStroke(p, e){
  const s = stroke, lp = s.inv.transformPoint(p), a = s.last, pr = pressureOf(e), step = Math.max(.5, s.size*pr*.12);
  const dist = Math.hypot(lp.x-a.x, lp.y-a.y); if(dist < step) return;
  const n = Math.floor(dist/step);
  for(let i = 1; i <= n; i++) dab({x:a.x + (lp.x-a.x)*i/n, y:a.y + (lp.y-a.y)*i/n}, pr);
  s.last = lp; req();
}
function endStroke(){
  const s = stroke; if(!s) return; stroke = null;
  const l = s.layer, tc = l[s.target], x = tc.getContext('2d', {willReadFrequently:true});
  if(doc.sel){ const b = s.buf.getContext('2d'); b.save(); b.setTransform(s.inv); b.globalCompositeOperation = 'destination-in'; b.drawImage(doc.sel, 0, 0); b.restore(); }
  const bb = s.bbox, rx = clamp(Math.floor(bb[0]), 0, tc.width), ry = clamp(Math.floor(bb[1]), 0, tc.height), rw = clamp(Math.ceil(bb[2]), 0, tc.width) - rx, rh = clamp(Math.ceil(bb[3]), 0, tc.height) - ry;
  if(rw <= 0 || rh <= 0){ req(); return; }
  if(s.kind === 'heal'){ healRegion(l, s, tc, rx, ry, rw, rh); return; }
  const before = x.getImageData(rx, ry, rw, rh);
  x.save(); x.globalAlpha = s.opac; x.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'; x.drawImage(s.buf, 0, 0); x.restore();
  const after = x.getImageData(rx, ry, rw, rh);
  l.dirty = true; flatCache = null;
  const names = {brush:'Penseel', eraser:'Gum', clone:'Kloonstempel'};
  pixelEntry(l, s.target, [rx, ry], before, after, names[s.kind] || 'Penseel');
  changed();
}

/* vlekverwijderaar: vult het geschilderde gebied vanuit de omgeving */
function healRegion(l, s, tc, rx, ry, rw, rh){
  const m = Math.ceil(s.size*.8) + 4;
  const X = clamp(rx-m, 0, tc.width), Y = clamp(ry-m, 0, tc.height), W = clamp(rx+rw+m, 0, tc.width) - X, H = clamp(ry+rh+m, 0, tc.height) - Y;
  const x = tc.getContext('2d', {willReadFrequently:true});
  const img = x.getImageData(X, Y, W, H), mk2 = s.buf.getContext('2d', {willReadFrequently:true}).getImageData(X, Y, W, H);
  const before = new ImageData(new Uint8ClampedArray(img.data), W, H);
  const N = W*H, known = new Uint8Array(N), alpha = new Float32Array(N);
  for(let i = 0; i < N; i++){ const a = mk2.data[i*4+3]/255; alpha[i] = a; known[i] = a < .04 ? 1 : 0; }
  const v = new Float32Array(N*4); for(let i = 0; i < N*4; i++) v[i] = img.data[i];
  solveFill(v, known, W, H);
  // korrel/structuur van de omgeving terugbrengen
  let sum = 0, cnt = 0;
  for(let y = 0; y < H; y++) for(let xx = 1; xx < W; xx++){ const i = y*W+xx; if(known[i] && known[i-1]){ const k = i*4, j = k-4; const dl = (img.data[k]+img.data[k+1]+img.data[k+2] - img.data[j]-img.data[j+1]-img.data[j+2])/3; sum += dl*dl; cnt++; } }
  const sigma = cnt ? Math.sqrt(sum/cnt/2)*.8 : 0;
  const o = img.data;
  for(let i = 0; i < N; i++){
    if(known[i]) continue;
    const a = Math.min(1, alpha[i]*1.6), n = sigma ? gauss()*sigma : 0, k = i*4;
    for(let c = 0; c < 3; c++) o[k+c] = o[k+c]*(1-a) + (v[k+c] + n)*a;
    o[k+3] = o[k+3]*(1-a) + v[k+3]*a;
  }
  x.putImageData(img, X, Y);
  l.dirty = true; flatCache = null;
  pixelEntry(l, s.target, [X, Y], before, x.getImageData(X, Y, W, H), 'Vlekverwijderaar');
  changed();
}
function gauss(){ let u = 0, v = 0; while(!u) u = Math.random(); while(!v) v = Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function solveFill(v, known, w, h){
  const N = w*h;
  if(N > 48*48 && w > 6 && h > 6){
    const w2 = Math.ceil(w/2), h2 = Math.ceil(h/2), v2 = new Float32Array(w2*h2*4), k2 = new Uint8Array(w2*h2), cnt = new Uint16Array(w2*h2);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){ const i = y*w+x; if(!known[i]) continue; const j = (y>>1)*w2 + (x>>1); for(let c = 0; c < 4; c++) v2[j*4+c] += v[i*4+c]; cnt[j]++; k2[j] = 1; }
    for(let j = 0; j < w2*h2; j++) if(cnt[j]) for(let c = 0; c < 4; c++) v2[j*4+c] /= cnt[j];
    solveFill(v2, k2, w2, h2);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){ const i = y*w+x; if(known[i]) continue; const j = (y>>1)*w2 + (x>>1); for(let c = 0; c < 4; c++) v[i*4+c] = v2[j*4+c]; }
  } else {
    const mean = [0,0,0,0]; let n = 0; for(let i = 0; i < N; i++) if(known[i]){ for(let c = 0; c < 4; c++) mean[c] += v[i*4+c]; n++; }
    for(let i = 0; i < N; i++) if(!known[i]) for(let c = 0; c < 4; c++) v[i*4+c] = n ? mean[c]/n : 0;
  }
  const iters = N > 48*48 ? 40 : 160;
  for(let it = 0; it < iters; it++){
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
      const i = y*w+x; if(known[i]) continue;
      const a = x > 0 ? i-1 : i, b = x < w-1 ? i+1 : i, c0 = y > 0 ? i-w : i, d = y < h-1 ? i+w : i;
      for(let c = 0; c < 4; c++) v[i*4+c] = (v[a*4+c] + v[b*4+c] + v[c0*4+c] + v[d*4+c])*.25;
    }
  }
}

/* ================= tekst ================= */
function renderText(l){
  const t = l.text, F = E.FONTS[t.font] || E.FONTS[0], px = t.size, lines = t.content.split('\n');
  const meas = mk(1, 1).getContext('2d'); meas.font = `${F.weight} ${px}px "${F.family}", system-ui, sans-serif`;
  const tw = Math.max(...lines.map(s => meas.measureText(s).width), px*.5), lh = px*1.25;
  const c = mk(tw + px*.5, lines.length*lh + px*.3), x = c.getContext('2d');
  x.font = meas.font; x.fillStyle = t.color; x.textBaseline = 'middle'; x.textAlign = t.align || 'left';
  const ax = t.align === 'center' ? c.width/2 : t.align === 'right' ? c.width - px*.25 : px*.25;
  lines.forEach((s, i) => x.fillText(s, ax, px*.15 + lh*(i+.5)));
  const oldMask = l.mask; l.canvas = c;
  if(oldMask && (oldMask.width !== c.width || oldMask.height !== c.height)){ const m2 = mk(c.width, c.height), y = m2.getContext('2d'); y.drawImage(oldMask, 0, 0, c.width, c.height); l.mask = m2; }
  l.dirty = true; flatCache = null;
}
function addText(p){
  const t = {content:'Tekst', font:opt.text.font, size:opt.text.size, color:doc.fg, align:'left'};
  structural('Tekstlaag', () => { const l = newLayer(mk(1, 1), {name:'Tekst', kind:'text', text:t, x:p.x, y:p.y}); renderText(l); insertAbove(l, active()); });
  E.loadFont(t.font).then(() => { const l = active(); if(l && l.kind === 'text'){ renderText(l); req(); } });
  setTimeout(() => { const ta = $('#bwText'); if(ta){ ta.focus(); ta.select(); } }, 60);
}

/* ================= aanwijzer op het werkvlak ================= */
const ptrs = new Map(); let drag = null, pinch = null, hoverPt = null, space = false, lastTap = 0;
const toDoc = e => { const r = $('#bwStage').getBoundingClientRect(); return {x:(e.clientX-r.left-view.ox)/view.s, y:(e.clientY-r.top-view.oy)/view.s}; };
function onDown(e){
  if(!doc) return;
  const st = $('#bwStage'); st.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(ptrs.size === 2){
    if(stroke){ stroke = null; } drag = null;
    const [a, b] = [...ptrs.values()]; pinch = {d0:Math.hypot(a.x-b.x, a.y-b.y), m0:{x:(a.x+b.x)/2, y:(a.y+b.y)/2}, s0:view.s, ox0:view.ox, oy0:view.oy}; req(); return;
  }
  if(ptrs.size > 2) return;
  const p = toDoc(e);
  if(e.button === 1 || tool === 'hand' || space || (e.pointerType === 'mouse' && e.button === 2)){ drag = {kind:'pan', sx:e.clientX, sy:e.clientY, ox:view.ox, oy:view.oy}; return; }
  if(tool === 'clone' && (e.altKey || pickingSource)){ cloneSrc = p; cloneOff = null; pickingSource = false; syncOptions(); C.toast('Bron gekozen. Schilder nu over de plek die je wilt bedekken.'); req(); return; }
  if(['brush','eraser','clone','heal'].includes(tool)){ hoverPt = p; if(beginStroke(p, e)) drag = {kind:'stroke'}; return; }
  if(tool === 'select'){
    if(opt.select.shape === 'wand'){ const m = floodMask(p.x, p.y, opt.select.tol, opt.select.contig); if(m) selCombine(x => x.drawImage(m, 0, 0), 'Toverstaf'); return; }
    drag = {kind:'sel', start:p, cur:null, pts:[p]}; return;
  }
  if(tool === 'fill'){
    if(opt.fill.mode === 'grad'){ drag = {kind:'grad', start:p, cur:null}; return; }
    const l = editable(); if(!l) return; const m = floodMask(p.x, p.y, opt.fill.tol, opt.fill.contig); if(!m) return;
    const inv = M(l).inverse();
    editPixels(l, 'canvas', 'Emmer', x => { const t = mk(doc.w, doc.h), y = t.getContext('2d'); y.fillStyle = doc.fg; y.fillRect(0, 0, doc.w, doc.h); y.globalCompositeOperation = 'destination-in'; y.drawImage(m, 0, 0); if(doc.sel) y.drawImage(doc.sel, 0, 0); x.setTransform(inv); x.drawImage(t, 0, 0); });
    changed(); return;
  }
  if(tool === 'picker'){ const d = flatData(), x = Math.floor(p.x), y = Math.floor(p.y); if(x >= 0 && y >= 0 && x < doc.w && y < doc.h){ const k = (y*doc.w + x)*4; setFg('#' + [d.data[k], d.data[k+1], d.data[k+2]].map(v => v.toString(16).padStart(2, '0')).join('')); C.toast('Kleur opgepakt'); } return; }
  if(tool === 'text'){
    const hit = [...doc.layers].reverse().find(l => l.visible && l.kind === 'text' && inside(l, p));
    if(hit){ doc.active = hit.id; syncLayers(); syncOptions(); drag = {kind:'move', h:'move', s:p, l:hit, p0:snapProps(hit), before:snapDoc()}; return; }
    addText(p); return;
  }
  if(tool === 'move'){
    const l = active(); if(!l) return;
    const d = dpr(), base = new DOMMatrix([view.s*d, 0, 0, view.s*d, view.ox*d, view.oy*d]), q = corners(l, base), rh = rotHandle(q, d);
    const r = $('#bwStage').getBoundingClientRect(), sx = (e.clientX - r.left)*d, sy = (e.clientY - r.top)*d, near = (a) => Math.hypot(a.x-sx, a.y-sy) < 20*d;
    let h = null;
    if(near(rh)) h = 'rot'; else { const i = q.findIndex(near); if(i >= 0) h = 'c' + i; else if(inside(l, p)) h = 'move'; }
    if(!h){
      const hit = [...doc.layers].reverse().find(k => k.visible && inside(k, p) && hasPixel(k, p));
      if(hit){ doc.active = hit.id; syncLayers(); syncOptions(); h = 'move'; } else return;
    }
    const L = active(); drag = {kind:'move', h, s:p, l:L, p0:snapProps(L), before:snapDoc()};
  }
  const now = Date.now(); if(now - lastTap < 280 && (tool === 'hand')) fitView(); lastTap = now;
}
function inside(l, p){ const q = M(l).inverse().transformPoint(p); return q.x >= 0 && q.y >= 0 && q.x <= l.canvas.width && q.y <= l.canvas.height; }
function hasPixel(l, p){ const q = M(l).inverse().transformPoint(p); try { return l.canvas.getContext('2d').getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data[3] > 10; } catch(_){ return true; } }
let pickingSource = false;
function onMove(e){
  if(!doc) return;
  if(ptrs.has(e.pointerId)) ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  const p = toDoc(e);
  if(pinch && ptrs.size >= 2){
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x-b.x, a.y-b.y), m = {x:(a.x+b.x)/2, y:(a.y+b.y)/2}, r = $('#bwStage').getBoundingClientRect();
    const s = clamp(pinch.s0*d/pinch.d0, .02, 32), mx = pinch.m0.x - r.left, my = pinch.m0.y - r.top;
    const ux = (mx - pinch.ox0)/pinch.s0, uy = (my - pinch.oy0)/pinch.s0;
    view.s = s; view.ox = mx - ux*s + (m.x - pinch.m0.x); view.oy = my - uy*s + (m.y - pinch.m0.y); view.fit = false; req(); return;
  }
  if(!drag){ if(['brush','eraser','clone','heal'].includes(tool) && e.pointerType !== 'touch'){ hoverPt = p; req(); } return; }
  if(drag.kind === 'pan'){ view.ox = drag.ox + e.clientX - drag.sx; view.oy = drag.oy + e.clientY - drag.sy; view.fit = false; req(); return; }
  if(drag.kind === 'stroke' && stroke){ hoverPt = p; const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for(const ce of (evs.length ? evs : [e])) moveStroke(toDoc(ce), ce); return; }
  if(drag.kind === 'sel'){ drag.cur = p; if(opt.select.shape === 'lasso') drag.pts.push(p); else if(e.shiftKey){ const dx = p.x-drag.start.x, dy = p.y-drag.start.y, m = Math.max(Math.abs(dx), Math.abs(dy)); drag.cur = {x:drag.start.x + Math.sign(dx)*m, y:drag.start.y + Math.sign(dy)*m}; } req(); return; }
  if(drag.kind === 'grad'){ drag.cur = p; req(); return; }
  if(drag.kind === 'move'){
    const l = drag.l, p0 = drag.p0;
    if(drag.h === 'move'){ l.x = p0.x + p.x - drag.s.x; l.y = p0.y + p.y - drag.s.y; }
    else if(drag.h === 'rot'){ const a0 = Math.atan2(drag.s.y - p0.y, drag.s.x - p0.x), a1 = Math.atan2(p.y - p0.y, p.x - p0.x); let r = p0.rot + (a1-a0)*180/Math.PI; if(e.shiftKey) r = Math.round(r/15)*15; l.rot = r; }
    else {
      if(opt.move.keep){ const k = Math.hypot(p.x - p0.x, p.y - p0.y)/Math.max(1e-6, Math.hypot(drag.s.x - p0.x, drag.s.y - p0.y)); l.sx = p0.sx*k; l.sy = p0.sy*k; }
      else { const a = -p0.rot*Math.PI/180, dx = p.x - p0.x, dy = p.y - p0.y, lx = dx*Math.cos(a) - dy*Math.sin(a), ly = dx*Math.sin(a) + dy*Math.cos(a); l.sx = Math.sign(p0.sx)*Math.max(.01, 2*Math.abs(lx)/l.canvas.width); l.sy = Math.sign(p0.sy)*Math.max(.01, 2*Math.abs(ly)/l.canvas.height); }
    }
    flatCache = null; req(); syncOptions(); return;
  }
}
function onUp(e){
  ptrs.delete(e.pointerId);
  if(pinch){ if(ptrs.size < 2) pinch = null; drag = null; return; }
  if(ptrs.size) return;
  const d = drag; drag = null; if(!d) return;
  if(d.kind === 'stroke'){ endStroke(); if(e.pointerType === 'touch') hoverPt = null; req(); return; }
  if(d.kind === 'sel'){
    const a = d.start, b = d.cur;
    if(!b){ if(opt.select.mode === 'new' && doc.sel) setSel(null, true, 'Deselecteren'); return; }
    if(opt.select.shape === 'lasso'){ if(d.pts.length < 3) return; selCombine(x => { x.beginPath(); d.pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)); x.closePath(); x.fill(); }, 'Lasso'); }
    else if(opt.select.shape === 'ellipse') selCombine(x => { x.beginPath(); x.ellipse((a.x+b.x)/2, (a.y+b.y)/2, Math.abs(b.x-a.x)/2, Math.abs(b.y-a.y)/2, 0, 0, Math.PI*2); x.fill(); }, 'Ellipsselectie');
    else selCombine(x => x.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x-a.x), Math.abs(b.y-a.y)), 'Rechthoekselectie');
    return;
  }
  if(d.kind === 'grad' && d.cur){
    const l = editable(); if(!l) return; const inv = M(l).inverse(), a = d.start, b = d.cur;
    editPixels(l, 'canvas', 'Verloop', x => { const t = mk(doc.w, doc.h), y = t.getContext('2d'), g = y.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, doc.fg); g.addColorStop(1, opt.fill.grad === 'fgbg' ? doc.bg : `rgba(${hexRgb(doc.fg)},0)`); y.fillStyle = g; y.fillRect(0, 0, doc.w, doc.h);
      if(doc.sel){ y.globalCompositeOperation = 'destination-in'; y.drawImage(doc.sel, 0, 0); } x.setTransform(inv); x.drawImage(t, 0, 0); });
    changed(); return;
  }
  if(d.kind === 'move'){ const after = snapDoc(), before = d.before; if(JSON.stringify(snapProps(d.l), (k, v) => v instanceof HTMLCanvasElement ? 0 : v) !== JSON.stringify(d.p0, (k, v) => v instanceof HTMLCanvasElement ? 0 : v)) pushHist({label:'Transformeren', undo:() => restoreDoc(before), redo:() => restoreDoc(after)}); return; }
}

/* ================= opslaan & openen ================= */
function scheduleSave(){ clearTimeout(saveT); saveT = setTimeout(() => saveDoc().catch(() => {}), 1500); }
async function saveDoc(){
  clearTimeout(saveT); if(!doc) return;
  const d = doc;
  for(const l of d.layers){
    if(!l.dirty && l.blob) continue;
    l.blob = await C.toBlob(l.canvas, 'image/png'); l.maskBlob = l.mask ? await C.toBlob(l.mask, 'image/png') : null; l.dirty = false;
  }
  const flat = flattenLayers(d.layers, d.w, d.h, '#ffffff'), s = Math.min(1, 480/Math.max(d.w, d.h)), t = mk(d.w*s, d.h*s), x = t.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(flat, 0, 0, t.width, t.height);
  const rec = {id:d.id, name:d.name, w:d.w, h:d.h, added:d.added, updated:Date.now(), fg:d.fg, bg:d.bg, thumb:await C.toBlob(t, 'image/jpeg', .85),
    layers:d.layers.map(l => ({id:l.id, name:l.name, kind:l.kind, x:l.x, y:l.y, sx:l.sx, sy:l.sy, rot:l.rot, opacity:l.opacity, blend:l.blend, visible:l.visible, maskOn:l.maskOn, text:l.text, blob:l.blob, maskBlob:l.maskBlob}))};
  d.updated = rec.updated;
  await C.store.putDoc(rec);
}
async function blobCanvas(b){ const bmp = await createImageBitmap(b); const c = mk(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close(); return c; }
export async function loadLayers(rec){
  const layers = [];
  for(const r of rec.layers){
    const l = {...r, canvas:await blobCanvas(r.blob), mask:r.maskBlob ? await blobCanvas(r.maskBlob) : null, dirty:false};
    layers.push(l);
  }
  return layers;
}
async function openDoc(id){
  const rec = await C.store.getDoc(id); if(!rec){ C.toast('Dit document bestaat niet meer.'); return; }
  C.showView('bewerk');
  doc = {id:rec.id, name:rec.name, w:rec.w, h:rec.h, added:rec.added, fg:rec.fg || '#000000', bg:rec.bg || '#ffffff', sel:null, selEdge:null, layers:await loadLayers(rec)};
  doc.active = doc.layers[doc.layers.length-1]?.id;
  hist = []; hi = -1; histBytes = 0; maskTarget = false; cloneSrc = null; cloneOff = null; preview = null; flatCache = null;
  $('#bwName').textContent = doc.name; $('#bwSize').textContent = `${doc.w} × ${doc.h} px`;
  $('#bwUndo').disabled = true; $('#bwRedo').disabled = true; syncLayers(); syncOptions(); syncColors(); if(seg === 'aanpassen') syncAdjust();
  requestAnimationFrame(() => { fitView(); });
  for(const l of doc.layers) if(l.kind === 'text') E.loadFont(l.text.font).then(() => { renderText(l); l.dirty = false; req(); });
}
async function createDoc(name, w, h, base, bgColor){
  const id = C.uid(); doc = {id, name, w, h, added:Date.now(), fg:'#000000', bg:'#ffffff', layers:[], sel:null};
  const c = mk(w, h);
  if(base) c.getContext('2d').drawImage(base, 0, 0, w, h);
  else if(bgColor){ const x = c.getContext('2d'); x.fillStyle = bgColor; x.fillRect(0, 0, w, h); }
  doc.layers.push(newLayer(c, {name:base ? 'Achtergrond' : bgColor ? 'Achtergrond' : 'Laag 1'}));
  await saveDoc();
  doc = null;
  return id;
}
export async function newFromCanvas(canvas, name){ const id = await createDoc(name, canvas.width, canvas.height, canvas); await openDoc(id); }
async function closeDoc(){
  await saveDoc().catch(() => {});
  doc = null; stroke = null; preview = null;
  C.showView('library'); await C.reloadLibrary();
}

/* ================= laagbewerkingen ================= */
function insertAbove(nl, ref){ const i = ref ? doc.layers.indexOf(ref) : doc.layers.length-1; doc.layers.splice(i+1, 0, nl); doc.active = nl.id; }
const layerOps = {
  add(){ structural('Nieuwe laag', () => insertAbove(newLayer(mk(doc.w, doc.h), {name:'Laag ' + (doc.layers.length+1)}), active())); },
  dup(){ const l = active(); if(!l) return; structural('Laag dupliceren', () => insertAbove(newLayer(cloneCanvas(l.canvas), {...snapProps(l), canvas:cloneCanvas(l.canvas), mask:l.mask ? cloneCanvas(l.mask) : null, text:l.text ? {...l.text} : null, name:l.name + ' kopie'}), l)); },
  del(){ const l = active(); if(!l) return; if(doc.layers.length === 1){ C.toast('Een document heeft minstens één laag nodig.'); return; } structural('Laag verwijderen', () => { const i = doc.layers.indexOf(l); doc.layers.splice(i, 1); doc.active = doc.layers[Math.max(0, i-1)].id; }); },
  up(){ const l = active(), i = doc.layers.indexOf(l); if(i < doc.layers.length-1) structural('Laag omhoog', () => { doc.layers.splice(i, 1); doc.layers.splice(i+1, 0, l); }); },
  down(){ const l = active(), i = doc.layers.indexOf(l); if(i > 0) structural('Laag omlaag', () => { doc.layers.splice(i, 1); doc.layers.splice(i-1, 0, l); }); },
  merge(){ const l = active(), i = doc.layers.indexOf(l); if(i <= 0){ C.toast('Er is geen laag onder deze laag.'); return; } const below = doc.layers[i-1];
    const c = flattenLayers([below, l], doc.w, doc.h);
    structural('Omlaag samenvoegen', () => { const nl = newLayer(c, {name:below.name}); doc.layers.splice(i-1, 2, nl); doc.active = nl.id; }); },
  flatten(){ const c = flattenLayers(doc.layers, doc.w, doc.h); structural('Afvlakken', () => { const nl = newLayer(c, {name:'Achtergrond'}); doc.layers = [nl]; doc.active = nl.id; }); },
  removeMask(){ const l = active(); if(!l || !l.mask) return; structural('Masker verwijderen', () => { l.mask = null; maskTarget = false; }); },
  applyMask(){ const l = active(); if(!l || !l.mask) return; const c = cloneCanvas(l.canvas), x = c.getContext('2d'); x.globalCompositeOperation = 'destination-in'; x.drawImage(l.mask, 0, 0);
    structural('Masker toepassen', () => { l.canvas = c; l.mask = null; l.kind = 'pixel'; l.text = null; maskTarget = false; l.dirty = true; }); },
  fit(){ const l = active(); if(!l) return; structural('Passend maken', () => { const k = Math.min(doc.w/l.canvas.width, doc.h/l.canvas.height); l.sx = Math.sign(l.sx)*k; l.sy = Math.sign(l.sy)*k; l.x = doc.w/2; l.y = doc.h/2; l.rot = 0; }); },
  resetT(){ const l = active(); if(!l) return; structural('Transformatie herstellen', () => { l.sx = 1; l.sy = 1; l.rot = 0; l.x = doc.w/2; l.y = doc.h/2; }); },
  flipH(){ const l = active(); if(l) structural('Horizontaal spiegelen', () => { l.sx = -l.sx; }); },
  flipV(){ const l = active(); if(l) structural('Verticaal spiegelen', () => { l.sy = -l.sy; }); },
};
async function addImageLayer(src, name){
  const s = Math.min(1, Math.max(doc.w, doc.h)*1.5/Math.max(src.width, src.height));
  const c = mk(src.width*s, src.height*s); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  structural('Afbeelding als laag', () => { const k = Math.min(1, doc.w*.8/c.width, doc.h*.8/c.height); insertAbove(newLayer(c, {name, sx:k, sy:k}), active()); });
  setTool('move'); C.toast('Afbeelding toegevoegd. Versleep en schaal hem met de hoekpunten.');
}

/* ================= aanpassingen (filters) ================= */
const ADJ_DEF = {bright:0, contrast:0, sat:0, hue:0, blur:0, gray:false, invert:false};
let adjState = {...ADJ_DEF};
function updatePreview(){ const l = active(); const on = Object.entries(adjState).some(([k, v]) => v !== ADJ_DEF[k]); preview = on && l ? {layer:l, sel:!!doc.sel, ...adjState} : null; req(); }
function applyAdjust(){
  const l = editable(); if(!l || !preview){ C.toast('Verschuif eerst een schuif.'); return; }
  const f = filterFor(l, new DOMMatrix([Math.abs(1), 0, 0, 1, 0, 0])), sel = doc.sel ? selToLayer(l) : null, src = cloneCanvas(l.canvas);
  preview = null;
  editPixels(l, 'canvas', 'Aanpassing', x => {
    const t = mk(src.width, src.height), y = t.getContext('2d'); y.filter = f; y.drawImage(src, 0, 0); y.filter = 'none';
    if(sel){ y.globalCompositeOperation = 'destination-in'; y.drawImage(sel, 0, 0); x.drawImage(t, 0, 0); }
    else { x.globalCompositeOperation = 'copy'; x.drawImage(t, 0, 0); }
  });
  adjState = {...ADJ_DEF}; changed(); C.toast('Aanpassing toegepast');
}

/* ================= kleuren ================= */
function setFg(c){ doc.fg = c; syncColors(); scheduleSave(); }
function syncColors(){ if(!doc) return; $('#bwFg').style.background = doc.fg; $('#bwBg').style.background = doc.bg; document.querySelectorAll('.bw-fgchip').forEach(e => e.style.background = doc.fg); }

/* ================= export ================= */
function openExport(){
  C.dialog((card, close) => {
    card.append(C.el('<h2>Exporteren</h2>'));
    const f = C.el('<div class="field"><label for="bwFmt">Formaat</label><select id="bwFmt"><option value="png">PNG – met transparantie</option><option value="jpeg">JPG – kleinste bestand</option><option value="webp">WebP – met transparantie</option></select></div>');
    const sz = C.el('<div class="field"><label for="bwSz">Afmeting</label><select id="bwSz"><option value="0">Volledig</option><option value="2048">2048 px</option><option value="1440">1440 px</option><option value="1080">1080 px</option></select></div>');
    const what = C.el('<div class="field"><label for="bwWhat">Wat</label><select id="bwWhat"><option value="all">Alle zichtbare lagen</option><option value="layer">Alleen de actieve laag</option></select></div>');
    const nm = C.el('<div class="field"><label for="bwNm">Bestandsnaam</label><input type="text" id="bwNm"></div>'); nm.querySelector('input').value = doc.name;
    const a = C.el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn">Als foto in bibliotheek</button><button class="btn primary">Exporteren</button></div>');
    card.append(f, sz, what, nm, C.el('<p class="hint">"Als foto in bibliotheek" voegt het resultaat toe aan je bibliotheek. Dan kun je het verder bewerken in Ontwikkelen of samen met andere foto\'s exporteren.</p>'), a);
    const make = async () => {
      const fmt = f.querySelector('select').value, layerOnly = what.querySelector('select').value === 'layer', m = +sz.querySelector('select').value;
      const layers = layerOnly ? [{...active(), visible:true}] : doc.layers;
      let c = flattenLayers(layers, doc.w, doc.h, fmt === 'jpeg' ? '#ffffff' : null);
      if(layerOnly){ const b = bbox(c); if(b){ const t = mk(b[2], b[3]); t.getContext('2d').drawImage(c, -b[0], -b[1]); c = t; } }
      if(m && Math.max(c.width, c.height) > m){ const s = m/Math.max(c.width, c.height), t = mk(c.width*s, c.height*s), x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, t.width, t.height); c = t; }
      return {c, fmt};
    };
    a.children[0].onclick = close;
    a.children[1].onclick = async () => { const {c} = await make(); const b = await C.toBlob(c, 'image/png'); await C.importBlob(b, nm.querySelector('input').value || doc.name); close(); C.toast('Toegevoegd aan je bibliotheek als foto'); };
    a.children[2].onclick = async () => {
      const {c, fmt} = await make(); const b = await C.toBlob(c, 'image/' + fmt, .92);
      const file = new File([b], (nm.querySelector('input').value.trim() || doc.name).replace(/[\\/:*?"<>|]/g, '-') + '.' + (fmt === 'jpeg' ? 'jpg' : fmt), {type:b.type});
      close(); C.saveOrShare([file]);
    };
  });
}
function bbox(c){
  const x = c.getContext('2d', {willReadFrequently:true}), d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for(let y = 0; y < c.height; y++) for(let xx = 0; xx < c.width; xx++) if(d[(y*c.width + xx)*4 + 3] > 0){ if(xx < x0) x0 = xx; if(xx > x1) x1 = xx; if(y < y0) y0 = y; if(y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1-x0+1, y1-y0+1];
}

/* ================= UI ================= */
const IC = {
  move:'<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  select:'<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>',
  brush:'<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13z"/><path d="M7 14c-2 0-3.5 1.5-3.5 3.5 0 1.3-.7 2.5-1.5 3 1 .5 2.4.5 3.5.5A4 4 0 0 0 9.5 17"/>',
  eraser:'<path d="M20 20H9l-6-6a2 2 0 0 1 0-3l8-8a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3l-8 8"/><path d="M7 9l8 8"/>',
  clone:'<path d="M9 3h6v4l3 3v3H6v-3l3-3z"/><path d="M5 17h14v4H5z"/>',
  heal:'<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 10h.01M14 14h.01M10 14h.01M14 10h.01"/>',
  fill:'<path d="M19 11 11 3 3 11l8 8z"/><path d="M5 11h14"/><path d="M20 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z"/>',
  text:'<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  picker:'<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>',
  hand:'<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
};
const TOOLS = [['move','Verplaats','V'], ['select','Selectie','M'], ['brush','Penseel','B'], ['eraser','Gum','E'], ['clone','Kloon','S'], ['heal','Vlekken','J'], ['fill','Vullen','G'], ['text','Tekst','T'], ['picker','Pipet','I'], ['hand','Hand','H']];
const svg = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
let optsBox = null, layersBox = null, adjBox = null;

function sliderEl(label, min, max, get, set, fmt = String, step = 1, onChange){
  const id = 'bws' + Math.random().toString(36).slice(2, 7);
  const b = C.el(`<div class="sl"><label for="${id}">${label}</label><output></output><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"></div>`);
  const i = b.querySelector('input'), o = b.querySelector('output');
  const show = () => { o.textContent = fmt(+i.value); const z = (clamp(0, min, max)-min)/(max-min)*100, p = (+i.value-min)/(max-min)*100; i.style.setProperty('--a', Math.min(z, p) + '%'); i.style.setProperty('--b', Math.max(z, p) + '%'); };
  i.value = get(); show();
  i.oninput = () => { set(+i.value); show(); };
  if(onChange) i.onchange = () => onChange(+i.value);
  return b;
}
function chipRow(items, cur, pick){
  const r = C.el('<div class="chips"></div>');
  items.forEach(([v, l]) => { const b = C.el(`<button class="chip" aria-pressed="${v === cur}">${l}</button>`); b.onclick = () => pick(v); r.append(b); });
  return r;
}
function group(title){ return C.el(`<div class="group"><span class="glabel"><span>${title}</span></span></div>`); }
function colorRow(){
  const r = C.el('<div class="row"></div>');
  const fg = C.el('<button class="bw-swatch bw-fgchip" aria-label="Voorgrondkleur kiezen"></button>'); fg.style.background = doc.fg; fg.onclick = () => pickColor('fg');
  const bg = C.el('<button class="bw-swatch" aria-label="Achtergrondkleur kiezen"></button>'); bg.style.background = doc.bg; bg.onclick = () => pickColor('bg');
  const sw = C.el('<button class="btn small">Wissel</button>'); sw.onclick = swapColors;
  r.append(fg, C.el('<span class="hint">voorgrond</span>'), bg, C.el('<span class="hint">achtergrond</span>'), sw);
  return r;
}
function pickColor(which){ const i = $('#bwColorIn'); i.value = doc[which]; i.oninput = () => { doc[which] = i.value; syncColors(); if(which === 'fg' && active()?.kind === 'text'){ textEdit({color:i.value}); } }; i.onchange = () => { syncOptions(); scheduleSave(); }; i.click(); }
function swapColors(){ const t = doc.fg; doc.fg = doc.bg; doc.bg = t; syncColors(); syncOptions(); }
function textEdit(patch){
  const l = active(); if(!l || l.kind !== 'text') return;
  const before = snapDoc(); Object.assign(l.text, patch); renderText(l); const after = snapDoc();
  pushHist({label:'Tekst', undo:() => { restoreDoc(before); renderText(l); }, redo:() => { restoreDoc(after); renderText(l); }});
}

function syncOptions(){
  if(!doc || !optsBox) return;
  const b = optsBox; b.innerHTML = '';
  const l = active(), o = opt[tool];
  const title = {move:'Verplaatsen & transformeren', select:'Selecteren', brush:'Penseel', eraser:'Gum', clone:'Kloonstempel', heal:'Vlekverwijderaar', fill:'Vullen & verloop', text:'Tekst', picker:'Pipet', hand:'Hand'}[tool];
  const g = group(title); b.append(g);
  const hint = t => g.append(C.el(`<p class="hint">${t}</p>`));
  if(['brush','eraser','clone','heal'].includes(tool)){
    g.append(sliderEl('Grootte', 1, 800, () => o.size, v => { o.size = v; hoverPt = hoverPt || {x:doc.w/2, y:doc.h/2}; req(); }, v => v + ' px'));
    if(tool !== 'heal') g.append(sliderEl('Hardheid', 0, 100, () => o.hard, v => o.hard = v, v => v + '%'), sliderEl('Dekking', 1, 100, () => o.opac, v => o.opac = v, v => v + '%'));
    if(tool === 'brush' && !(maskTarget && l?.mask)) g.append(colorRow());
    if(maskTarget && l?.mask && tool !== 'heal'){
      g.append(C.el('<p class="hint"><b>Je schildert op het laagmasker.</b> Verbergen maakt delen van de laag onzichtbaar, tonen haalt ze terug. Het origineel blijft bewaard.</p>'));
      g.append(chipRow([[true,'Verbergen'], [false,'Tonen']], maskHide, v => { maskHide = v; syncOptions(); }));
    }
    if(tool === 'clone'){
      const r = C.el('<div class="row"></div>'), src = C.el(`<button class="btn small ${pickingSource ? 'on' : ''}">${pickingSource ? 'Tik op de bron…' : 'Bron kiezen'}</button>`);
      src.onclick = () => { pickingSource = !pickingSource; syncOptions(); };
      const al = C.el(`<label class="toggle"><input type="checkbox" ${o.aligned ? 'checked' : ''}> Uitgelijnd</label>`); al.querySelector('input').onchange = e => { o.aligned = e.target.checked; cloneOff = null; };
      r.append(src, al); g.append(r);
      hint(cloneSrc ? 'Schilder over de plek die je wilt bedekken. Het kruisje laat zien waar de pixels vandaan komen.' : 'Kies eerst de plek waar je pixels vandaan wilt halen. Op de pc kan dat met Alt+klik.');
    }
    if(tool === 'heal') hint('Schilder over stofjes, krassen of vlekjes. Als je loslaat, vult Lichtbak het gebied op met de omgeving. Werkt het best bij kleine plekken. Gebruik voor grote stukken de kloonstempel.');
    if(tool === 'eraser') hint('Gummen maakt pixels doorzichtig. Wil je het later nog kunnen herstellen, gebruik dan een laagmasker (Lagen → Masker).');
  }
  if(tool === 'select'){
    const S = opt.select;
    g.append(chipRow([['rect','Rechthoek'], ['ellipse','Ellips'], ['lasso','Lasso'], ['wand','Toverstaf']], S.shape, v => { S.shape = v; syncOptions(); }));
    g.append(chipRow([['new','Nieuw'], ['add','Toevoegen'], ['sub','Aftrekken']], S.mode, v => { S.mode = v; syncOptions(); }));
    if(S.shape === 'wand'){
      g.append(sliderEl('Tolerantie', 0, 100, () => S.tol, v => S.tol = v));
      const c = C.el(`<label class="toggle"><input type="checkbox" ${S.contig ? 'checked' : ''}> Alleen aaneengesloten</label>`); c.querySelector('input').onchange = e => S.contig = e.target.checked; g.append(c);
      hint('Tik op een kleurvlak, bijvoorbeeld een effen achtergrond. Met "Toevoegen" kun je meer vlakken erbij tikken. Zet "aaneengesloten" uit om die kleur overal te selecteren.');
    } else {
      g.append(sliderEl('Doezelaar', 0, 100, () => S.feather, v => S.feather = v, v => v + ' px'));
      hint(S.shape === 'lasso' ? 'Trek met je vinger een lijn rond wat je wilt selecteren.' : 'Sleep over de foto. Houd Shift ingedrukt voor een vierkant of cirkel.');
    }
    const a = group('Met de selectie');
    const btns = [['Alles', () => selActions.all()], ['Niets', () => selActions.none()], ['Omkeren', () => selActions.invert()],
      ['Naar nieuwe laag', () => selActions.copy(false)], ['Uitknippen naar laag', () => selActions.copy(true)], ['Laagmasker', () => selActions.mask()],
      ['Wissen', () => selActions.clear()], ['Vullen met kleur', () => selActions.fill()]];
    const r = C.el('<div class="bw-grid2"></div>'); btns.forEach(([t, f]) => { const x = C.el(`<button class="btn small">${t}</button>`); x.onclick = f; if(!doc.sel && !['Alles','Omkeren','Laagmasker','Vullen met kleur'].includes(t)) x.disabled = true; r.append(x); });
    a.append(r);
    if(doc.sel){
      let fv = 4, gv = 4;
      const fr = C.el('<div class="row"></div>'), fb = C.el('<button class="btn small">Doezelen</button>'); fb.onclick = () => selActions.feather(fv);
      fr.append(sliderEl('Rand zachter maken', 1, 60, () => fv, v => fv = v, v => v + ' px'), fb);
      const gr = C.el('<div class="row"></div>'), g1 = C.el('<button class="btn small">Uitbreiden</button>'), g2 = C.el('<button class="btn small">Inkrimpen</button>');
      g1.onclick = () => selActions.grow(gv); g2.onclick = () => selActions.grow(-gv);
      gr.append(sliderEl('Rand verschuiven', 1, 40, () => gv, v => gv = v, v => v + ' px'), g1, g2);
      a.append(fr, gr);
    }
    a.append(C.el('<p class="hint"><b>Iets vrijstaand maken?</b> Selecteer de achtergrond met de toverstaf, kies Omkeren en dan Laagmasker. Exporteer daarna als PNG.</p>'));
    b.append(a);
  }
  if(tool === 'fill'){
    const F = opt.fill;
    g.append(chipRow([['fill','Emmer'], ['grad','Verloop']], F.mode, v => { F.mode = v; syncOptions(); }));
    g.append(colorRow());
    if(F.mode === 'fill'){ g.append(sliderEl('Tolerantie', 0, 100, () => F.tol, v => F.tol = v)); const c = C.el(`<label class="toggle"><input type="checkbox" ${F.contig ? 'checked' : ''}> Alleen aaneengesloten</label>`); c.querySelector('input').onchange = e => F.contig = e.target.checked; g.append(c); hint('Tik op een vlak om het met de voorgrondkleur te vullen. Gebruik "Vullen met kleur" bij Selectie om een hele selectie te vullen.'); }
    else { g.append(chipRow([['fgbg','Voorgrond → achtergrond'], ['fgclear','Voorgrond → transparant']], F.grad, v => { F.grad = v; syncOptions(); })); hint('Sleep een lijn over de foto. Als er een selectie is, komt het verloop alleen daarin.'); }
  }
  if(tool === 'text'){
    if(l && l.kind === 'text'){
      const t = l.text;
      const ta = C.el('<textarea id="bwText"></textarea>'); ta.value = t.content;
      let tT = 0; ta.oninput = () => { clearTimeout(tT); Object.assign(t, {content:ta.value}); renderText(l); req(); tT = setTimeout(() => { scheduleSave(); syncLayers(); }, 400); };
      g.append(ta);
      const fonts = C.el('<div class="fonts"></div>');
      E.FONTS.forEach((F, i) => { const fb = C.el(`<button class="fontbtn" aria-pressed="${i === t.font}">${F.name}</button>`); fb.style.fontFamily = `"${F.family}", system-ui`; fb.style.fontWeight = F.weight; fb.onclick = () => { opt.text.font = i; E.loadFont(i).then(() => { textEdit({font:i}); }); }; fonts.append(fb); });
      g.append(fonts);
      g.append(sliderEl('Grootte', 8, 1200, () => t.size, v => { t.size = v; renderText(l); req(); }, v => v + ' px', 1, v => { opt.text.size = v; textEdit({size:v}); }));
      const cr = C.el('<div class="row"></div>'), cb = C.el('<button class="bw-swatch" aria-label="Tekstkleur"></button>'); cb.style.background = t.color;
      cb.onclick = () => { const i = $('#bwColorIn'); i.value = t.color; i.oninput = () => { t.color = i.value; cb.style.background = i.value; renderText(l); req(); }; i.onchange = () => textEdit({color:i.value}); i.click(); };
      cr.append(cb, C.el('<span class="hint">kleur</span>'));
      g.append(cr, chipRow([['left','Links'], ['center','Midden'], ['right','Rechts']], t.align || 'left', v => textEdit({align:v})));
      hint('Tik ergens op de foto voor een nieuwe tekstlaag. Sleep een bestaande tekst om hem te verplaatsen. Draaien en schalen doe je met het gereedschap Verplaats.');
    } else hint('Tik op de foto waar de tekst moet komen. Er komt dan een nieuwe tekstlaag die je altijd nog kunt aanpassen.');
  }
  if(tool === 'move'){
    if(l){
      const k = C.el(`<label class="toggle"><input type="checkbox" ${opt.move.keep ? 'checked' : ''}> Verhouding vast</label>`); k.querySelector('input').onchange = e => opt.move.keep = e.target.checked;
      g.append(C.el(`<span class="info">Schaal ${Math.round(Math.abs(l.sx)*100)}% × ${Math.round(Math.abs(l.sy)*100)}% · draaiing ${Math.round(l.rot)}°</span>`), k);
      const r = C.el('<div class="bw-grid2"></div>');
      [['Spiegel ↔', layerOps.flipH], ['Spiegel ↕', layerOps.flipV], ['Passend maken', layerOps.fit], ['Herstellen', layerOps.resetT]].forEach(([t, f]) => { const x = C.el(`<button class="btn small">${t}</button>`); x.onclick = f; r.append(x); });
      g.append(r);
      hint('Sleep de laag om hem te verplaatsen. Met de hoekpunten schaal je, met de oranje stip draai je. Tik op iets anders om die laag te pakken. Houd Shift ingedrukt om in stappen van 15° te draaien.');
    } else hint('Selecteer eerst een laag.');
  }
  if(tool === 'picker') { g.append(colorRow()); hint('Tik op de foto om die kleur als voorgrondkleur te nemen.'); }
  if(tool === 'hand') hint('Sleep om te schuiven. Knijp met twee vingers of scroll met de muis om te zoomen. Dubbeltik om alles in beeld te passen.');
}

function syncLayers(){
  if(!doc || !layersBox) return;
  const list = layersBox.querySelector('.bw-layers'); list.innerHTML = '';
  [...doc.layers].reverse().forEach(l => {
    const row = C.el(`<div class="bw-layer" aria-pressed="${l.id === doc.active}">
      <button class="bw-eye" aria-label="${l.visible ? 'Verbergen' : 'Tonen'}">${svg(l.visible ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' : '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>')}</button>
      <canvas class="bw-th" width="88" height="88"></canvas>${l.mask ? '<canvas class="bw-th mask" width="88" height="88"></canvas>' : ''}
      <span class="bw-ln"></span>${l.kind === 'text' ? '<span class="bw-tag">T</span>' : ''}</div>`);
    row.querySelector('.bw-ln').textContent = l.name;
    row.querySelector('.bw-eye').onclick = ev => { ev.stopPropagation(); structural(l.visible ? 'Laag verbergen' : 'Laag tonen', () => { l.visible = !l.visible; }); };
    const th = row.querySelector('.bw-th'); thumb(th, l.canvas, true); th.classList.toggle('on', l.id === doc.active && !maskTarget);
    th.onclick = ev => { ev.stopPropagation(); doc.active = l.id; maskTarget = false; syncLayers(); syncOptions(); req(); };
    const mt = row.querySelector('.mask');
    if(mt){ thumb(mt, l.mask, false, l.maskOn); mt.classList.toggle('on', l.id === doc.active && maskTarget); mt.onclick = ev => { ev.stopPropagation(); doc.active = l.id; maskTarget = true; if(!['brush','eraser'].includes(tool)) setTool('brush'); syncLayers(); syncOptions(); C.toast('Je schildert nu op het masker. Zwart verbergt, wit toont.'); }; }
    row.onclick = () => { if(doc.active !== l.id){ doc.active = l.id; maskTarget = false; adjState = {...ADJ_DEF}; preview = null; syncLayers(); syncOptions(); syncAdjust(); req(); } };
    row.ondblclick = () => renameLayer(l);
    list.append(row);
  });
  const l = active(), props = layersBox.querySelector('.bw-lprops'); props.innerHTML = '';
  if(l){
    props.append(sliderEl('Dekking', 0, 100, () => Math.round(l.opacity*100), v => { l.opacity = v/100; req(); }, v => v + '%'));
    const op = props.querySelector('input'); let startOp = null; op.addEventListener('pointerdown', () => { startOp = snapDoc(); }); op.addEventListener('change', () => { const after = snapDoc(), before = startOp || after; startOp = null; pushHist({label:'Dekking', undo:() => restoreDoc(before), redo:() => restoreDoc(after)}); });
    const bl = C.el('<div class="field"><label for="bwBlend">Overvloeimodus</label><select id="bwBlend"></select></div>'), sel = bl.querySelector('select');
    BLENDS.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; o.selected = v === l.blend; sel.append(o); });
    sel.onchange = () => structural('Overvloeimodus', () => { l.blend = sel.value; });
    props.append(bl);
    if(l.mask){ const r = C.el('<div class="row"></div>'), t = C.el(`<label class="toggle"><input type="checkbox" ${l.maskOn ? 'checked' : ''}> Masker aan</label>`); t.querySelector('input').onchange = e => structural('Masker aan/uit', () => { l.maskOn = e.target.checked; }); r.append(t); props.append(r); }
  }
}
const thumbQ = new Set(); let thumbT = 0;
function thumb(cv, src, checkerBg, on = true){
  const x = cv.getContext('2d'), W = cv.width, H = cv.height; x.clearRect(0, 0, W, H);
  if(checkerBg){ x.fillStyle = checkerPattern(x); x.fillRect(0, 0, W, H); } else { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); }
  const s = Math.min(W/src.width, H/src.height), w = src.width*s, h = src.height*s; x.globalAlpha = on ? 1 : .4; x.drawImage(src, (W-w)/2, (H-h)/2, w, h); x.globalAlpha = 1;
}
function renameLayer(l){
  C.dialog((card, close) => {
    card.append(C.el('<h2>Laag hernoemen</h2>')); const f = C.el('<div class="field"><input type="text" aria-label="Naam"></div>'), i = f.querySelector('input'); i.value = l.name;
    const a = C.el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn primary">Opslaan</button></div>'); a.children[0].onclick = close;
    a.children[1].onclick = () => { const n = i.value.trim(); if(n) structural('Hernoemen', () => { l.name = n; }); close(); };
    card.append(f, a); setTimeout(() => i.select(), 50);
  });
}
function syncAdjust(){
  if(!adjBox) return; adjBox.innerHTML = '';
  const g = group('Aanpassen op de actieve laag'), A = adjState, up = () => updatePreview();
  g.append(
    sliderEl('Helderheid', -100, 100, () => A.bright, v => { A.bright = v; up(); }),
    sliderEl('Contrast', -100, 100, () => A.contrast, v => { A.contrast = v; up(); }),
    sliderEl('Verzadiging', -100, 100, () => A.sat, v => { A.sat = v; up(); }),
    sliderEl('Kleurtoon', -180, 180, () => A.hue, v => { A.hue = v; up(); }, v => v + '°'),
    sliderEl('Vervagen', 0, 60, () => A.blur, v => { A.blur = v; up(); }, v => v + ' px', .5));
  const t1 = C.el(`<label class="toggle"><input type="checkbox" ${A.gray ? 'checked' : ''}> Zwart-wit</label>`); t1.querySelector('input').onchange = e => { A.gray = e.target.checked; up(); };
  const t2 = C.el(`<label class="toggle"><input type="checkbox" ${A.invert ? 'checked' : ''}> Negatief</label>`); t2.querySelector('input').onchange = e => { A.invert = e.target.checked; up(); };
  const r = C.el('<div class="row"></div>'), ap = C.el('<button class="btn primary small">Toepassen</button>'), rs = C.el('<button class="btn small">Herstellen</button>');
  ap.onclick = () => { applyAdjust(); syncAdjust(); }; rs.onclick = () => { adjState = {...ADJ_DEF}; preview = null; syncAdjust(); req(); };
  r.append(rs, ap);
  g.append(t1, t2, r, C.el(`<p class="hint">Je ziet het effect meteen. Het wordt pas vastgelegd als je op Toepassen tikt.${doc && doc.sel ? ' Er is een selectie, dus alleen dat deel verandert.' : ''} Ongedaan maken kan altijd.</p>`));
  adjBox.append(g);
}

function setTool(t){
  if(stroke) return;
  tool = t; pickingSource = false;
  document.querySelectorAll('.bw-tool').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  $('#bwStage').dataset.tool = t;
  if(seg !== 'opties' && window.innerWidth < 900) setSeg('opties');
  syncOptions(); req();
}
function setSeg(s){
  seg = s; $('#bwSide').dataset.seg = s;
  document.querySelectorAll('.bw-seg').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === s));
  if(s === 'aanpassen') syncAdjust();
  if(s !== 'aanpassen' && preview){ preview = null; adjState = {...ADJ_DEF}; req(); }
}

function addLayerMenu(){
  C.dialog((card, close) => {
    card.append(C.el('<h2>Afbeelding als laag toevoegen</h2>'));
    const fromFile = C.el('<button class="btn">Uit een bestand…</button>');
    fromFile.onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const f = i.files[0]; if(!f) return; close(); try { const b = await C.decode(f); await addImageLayer(b, f.name.replace(/\.[^.]+$/, '')); C.free(b); } catch(_){ C.toast('Dit bestand kan niet worden geopend.'); } }; i.click(); };
    card.append(fromFile, C.el('<span class="glabel">Uit je bibliotheek (met je bewerkingen)</span>'));
    const grid = C.el('<div class="bw-pick"></div>');
    C.photos().forEach(p => { const b = C.el('<button><img alt=""></button>'); b.querySelector('img').src = C.thumbURL(p); b.setAttribute('aria-label', p.name);
      b.onclick = async () => { close(); C.toast('Laden…', 0); const c = await C.renderPhoto(p, Math.max(doc.w, doc.h)); await addImageLayer(c, p.name); }; grid.append(b); });
    if(!C.photos().length) card.append(C.el('<p class="hint">Er staan nog geen foto\'s in je bibliotheek.</p>')); else card.append(grid);
    const a = C.el('<div class="dactions"><button class="btn">Annuleren</button></div>'); a.firstElementChild.onclick = close; card.append(a);
  });
}

export function newBlankDlg(){
  C.dialog((card, close) => {
    card.append(C.el('<h2>Nieuw document</h2>'));
    const sizes = [['1080x1080','Instagram vierkant · 1080 × 1080'], ['1080x1350','Instagram staand · 1080 × 1350'], ['1920x1080','Breed (16:9) · 1920 × 1080'], ['2480x3508','A4 staand, 300 dpi · 2480 × 3508'], ['3508x2480','A4 liggend, 300 dpi · 3508 × 2480'], ['custom','Eigen maat…']];
    const f = C.el('<div class="field"><label for="ndSize">Formaat</label><select id="ndSize"></select></div>'), s = f.querySelector('select');
    sizes.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; s.append(o); });
    const cu = C.el('<div class="row" hidden><div class="field" style="flex:1"><label for="ndW">Breedte (px)</label><input type="text" id="ndW" inputmode="numeric" value="2000"></div><div class="field" style="flex:1"><label for="ndH">Hoogte (px)</label><input type="text" id="ndH" inputmode="numeric" value="2000"></div></div>');
    s.onchange = () => cu.hidden = s.value !== 'custom';
    const bg = C.el('<div class="field"><label for="ndBg">Achtergrond</label><select id="ndBg"><option value="#ffffff">Wit</option><option value="">Transparant</option><option value="#000000">Zwart</option></select></div>');
    const nm = C.el('<div class="field"><label for="ndName">Naam</label><input type="text" id="ndName" value="Naamloos"></div>');
    const a = C.el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn primary">Maken</button></div>');
    a.children[0].onclick = close;
    a.children[1].onclick = async () => {
      let [w, h] = s.value === 'custom' ? [+cu.querySelector('#ndW').value, +cu.querySelector('#ndH').value] : s.value.split('x').map(Number);
      if(!(w > 0 && h > 0)){ C.toast('Vul een geldige breedte en hoogte in.'); return; }
      const cap = 6000; if(Math.max(w, h) > cap){ const k = cap/Math.max(w, h); w = Math.round(w*k); h = Math.round(h*k); C.toast(`Verkleind tot ${w} × ${h} px om je apparaat niet te overbelasten.`); }
      close(); const id = await createDoc(nm.querySelector('input').value.trim() || 'Naamloos', Math.round(w), Math.round(h), null, bg.querySelector('select').value || null); await openDoc(id);
    };
    card.append(f, cu, bg, nm, a);
  });
}

function buildUI(){
  const tools = $('#bwTools');
  TOOLS.forEach(([k, l, key]) => { const b = C.el(`<button class="tool bw-tool" data-t="${k}" title="${l} (${key})">${svg(IC[k])}<span>${l}</span></button>`); b.onclick = () => setTool(k); tools.append(b); });
  const colors = C.el('<div class="bw-colors"><button id="bwFg" aria-label="Voorgrondkleur"></button><button id="bwBg" aria-label="Achtergrondkleur"></button></div>');
  colors.querySelector('#bwFg').onclick = () => pickColor('fg'); colors.querySelector('#bwBg').onclick = () => pickColor('bg'); tools.append(colors);
  const side = $('#bwSide');
  optsBox = C.el('<div class="bw-pane bw-opts"></div>'); adjBox = C.el('<div class="bw-pane bw-adj"></div>');
  layersBox = C.el(`<div class="bw-pane bw-lbox"><div class="glabel"><span>Lagen</span></div>
    <div class="bw-lactions">
      <button class="btn icon small" data-a="add" title="Nieuwe laag" aria-label="Nieuwe laag">${svg('<path d="M12 5v14M5 12h14"/>')}</button>
      <button class="btn icon small" data-a="img" title="Afbeelding als laag" aria-label="Afbeelding als laag">${svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>')}</button>
      <button class="btn icon small" data-a="dup" title="Dupliceren" aria-label="Laag dupliceren">${svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>')}</button>
      <button class="btn icon small" data-a="mask" title="Laagmasker" aria-label="Laagmasker toevoegen">${svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="5"/>')}</button>
      <button class="btn icon small" data-a="up" title="Omhoog" aria-label="Laag omhoog">${svg('<path d="M12 19V5M6 11l6-6 6 6"/>')}</button>
      <button class="btn icon small" data-a="down" title="Omlaag" aria-label="Laag omlaag">${svg('<path d="M12 5v14M6 13l6 6 6-6"/>')}</button>
      <button class="btn icon small" data-a="more" title="Meer" aria-label="Meer laagopties">${svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>')}</button>
      <button class="btn icon small danger" data-a="del" title="Verwijderen" aria-label="Laag verwijderen">${svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')}</button>
    </div><div class="bw-layers"></div><div class="bw-lprops"></div></div>`);
  layersBox.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if(a === 'img') return addLayerMenu();
    if(a === 'mask') return selActions.mask();
    if(a === 'more') return layerMore();
    layerOps[a]();
  });
  const segs = C.el('<div class="bw-segs"><button class="bw-seg" data-s="opties">Gereedschap</button><button class="bw-seg" data-s="lagen">Lagen</button><button class="bw-seg" data-s="aanpassen">Aanpassen</button></div>');
  segs.querySelectorAll('.bw-seg').forEach(b => b.onclick = () => setSeg(b.dataset.s));
  const panel = C.el('<div class="panel bw-panel"></div>'); panel.append(optsBox, adjBox, layersBox);
  side.append(segs, panel);
  setSeg('opties');
  const st = $('#bwStage');
  st.addEventListener('pointerdown', onDown); st.addEventListener('pointermove', onMove); st.addEventListener('pointerup', onUp); st.addEventListener('pointercancel', onUp);
  st.addEventListener('pointerleave', e => { if(e.pointerType === 'mouse' && !drag){ hoverPt = null; req(); } });
  st.addEventListener('contextmenu', e => e.preventDefault());
  st.addEventListener('wheel', e => { if(!doc) return; e.preventDefault(); const r = st.getBoundingClientRect(); if(e.ctrlKey || !e.shiftKey) zoomAt(e.clientX - r.left, e.clientY - r.top, view.s*Math.exp(-e.deltaY*.0018)); else { view.ox -= e.deltaX; view.oy -= e.deltaY; req(); } }, {passive:false});
  st.addEventListener('dblclick', () => { if(tool === 'hand') fitView(); });
  let lastSz = null;
  new ResizeObserver(() => { if(!doc) return; const r = st.getBoundingClientRect();
    if(view.fit) fitView(); else if(lastSz){ view.ox += (r.width - lastSz.w)/2; view.oy += (r.height - lastSz.h)/2; req(); }
    lastSz = {w:r.width, h:r.height}; }).observe(st);
  $('#bwBack').onclick = () => history.state && history.state.bewerk ? history.back() : closeDoc();
  $('#bwUndo').onclick = undo; $('#bwRedo').onclick = redo;
  $('#bwExport').onclick = openExport;
  $('#bwZoom').onclick = () => { if(Math.abs(view.s - 1) < .01) fitView(); else { const r = st.getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1); } };
  $('#bwFit').onclick = fitView;
  $('#bwMore').onclick = docMore;
  window.addEventListener('keydown', e => {
    if(!doc || $('#bewerk').hidden || !$('#dlg').hidden) return;
    const a = document.activeElement, typing = a && (/^(TEXTAREA|SELECT)$/.test(a.tagName) || (a.tagName === 'INPUT' && !['range','checkbox'].includes(a.type)));
    if(typing) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if(mod && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if(mod && k === 'y'){ e.preventDefault(); redo(); return; }
    if(mod && k === 'd'){ e.preventDefault(); selActions.none(); return; }
    if(mod && k === 'a'){ e.preventDefault(); selActions.all(); return; }
    if(mod && e.shiftKey && k === 'i'){ e.preventDefault(); selActions.invert(); return; }
    if(mod && k === 'j'){ e.preventDefault(); selActions.copy(false); return; }
    if(mod && k === '0'){ e.preventDefault(); fitView(); return; }
    if(mod) return;
    if(e.key === ' '){ space = true; e.preventDefault(); return; }
    if(e.key === 'Delete' || e.key === 'Backspace'){ if(doc.sel){ e.preventDefault(); selActions.clear(); } return; }
    if(e.key === '['){ const o = opt[tool]; if(o && o.size){ o.size = Math.max(1, Math.round(o.size*.85)); syncOptions(); req(); } return; }
    if(e.key === ']'){ const o = opt[tool]; if(o && o.size){ o.size = Math.min(800, Math.round(o.size*1.18)+1); syncOptions(); req(); } return; }
    if(k === 'x'){ swapColors(); return; }
    const t = TOOLS.find(x => x[2].toLowerCase() === k); if(t) setTool(t[0]);
  });
  window.addEventListener('keyup', e => { if(e.key === ' ') space = false; });
}
function layerMore(){
  const l = active();
  C.dialog((card, close) => {
    card.append(C.el(`<h2>${l ? l.name : 'Lagen'}</h2>`));
    const items = [['Hernoemen…', () => l && renameLayer(l)], ['Omlaag samenvoegen', layerOps.merge], ['Alles afvlakken tot één laag', layerOps.flatten]];
    if(l && l.mask) items.push(['Masker toepassen (definitief)', layerOps.applyMask], ['Masker verwijderen', layerOps.removeMask]);
    if(l && l.kind === 'text') items.push(['Tekst omzetten naar pixels', () => rasterize(l)]);
    const list = C.el('<div class="plist"></div>');
    items.forEach(([t, f]) => { const b = C.el('<button></button>'); b.textContent = t; b.onclick = () => { close(); setTimeout(f, 30); }; list.append(b); });
    const a = C.el('<div class="dactions"><button class="btn">Sluiten</button></div>'); a.firstElementChild.onclick = close;
    card.append(list, a);
  });
}
function docMore(){
  C.dialog((card, close) => {
    card.append(C.el('<h2>Document</h2>'));
    const list = C.el('<div class="plist"></div>');
    const items = [
      ['Hernoemen…', () => C.dialog((c2, cl2) => { c2.append(C.el('<h2>Document hernoemen</h2>')); const f = C.el('<div class="field"><input type="text" aria-label="Naam"></div>'), i = f.querySelector('input'); i.value = doc.name; const a = C.el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn primary">Opslaan</button></div>'); a.children[0].onclick = cl2; a.children[1].onclick = () => { doc.name = i.value.trim() || doc.name; $('#bwName').textContent = doc.name; scheduleSave(); cl2(); }; c2.append(f, a); })],
      ['Passend in beeld', fitView],
      ['Als foto in bibliotheek zetten', async () => { const c = flattenLayers(doc.layers, doc.w, doc.h); await C.importBlob(await C.toBlob(c, 'image/png'), doc.name); C.toast('Toegevoegd aan je bibliotheek'); }],
      ['Alles afvlakken', layerOps.flatten],
    ];
    items.forEach(([t, f]) => { const b = C.el('<button></button>'); b.textContent = t; b.onclick = () => { close(); setTimeout(f, 30); }; list.append(b); });
    const a = C.el('<div class="dactions"><button class="btn">Sluiten</button></div>'); a.firstElementChild.onclick = close;
    card.append(list, C.el('<p class="hint">Sneltoetsen op de pc: V verplaats, M selectie, B penseel, E gum, S kloon, J vlekken, G vullen, T tekst, I pipet, H hand. [ en ] maken het penseel kleiner of groter, X wisselt de kleuren. Ctrl+D deselecteert, Ctrl+J kopieert naar een laag. Houd de spatiebalk ingedrukt om te schuiven.</p>'), a);
  });
}

export function setupBewerk(ctx){
  C = ctx; buildUI();
  return {open:openDoc, newFromCanvas, newBlankDlg, close:closeDoc, isOpen:() => !!doc, flattenRecord:async rec => flattenLayers(await loadLayers(rec), rec.w, rec.h)};
}
