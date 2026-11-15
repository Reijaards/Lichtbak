// Lichtbak — app: bibliotheek, editor, presets, maskers, export
import {store} from './store.js';
import * as E from './engine.js';
import {makeSample} from './sample.js';
import {setupBewerk} from './bewerk.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmtSigned = v => { v = Math.round(v*100)/100; return v > 0 ? '+' + v : String(v); };
const r4 = v => Math.round(v*10000)/10000;
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const toBlob = (c, type = 'image/jpeg', q = .9) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), type, q));
function scaleCanvas(src, max){
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, s = Math.min(1, max/Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w*s)); c.height = Math.max(1, Math.round(h*s));
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height); return c;
}
async function decode(blob){
  try { return await createImageBitmap(blob, {imageOrientation:'from-image'}); }
  catch(_){ const url = URL.createObjectURL(blob); const img = new Image(); img.src = url; await img.decode(); return img; }
}
const free = b => { try { b && b.close && b.close(); } catch(_){} };

/* ================= state ================= */
let photos = [], docs = [], BW = null;
const thumbUrls = new Map();
let selecting = false; const selected = new Set();
let userPresets = [], clipboard = null, defaultText = null;
let cur = null, ed = null, prevBmp = null, oriented = null, orientedKey = '';
let tool = 'licht', showOrig = false, activeMask = -1, showMaskOverlay = true, hslSel = 1, curveCh = 'rgb';
const brush = {size:.08, flow:100, erase:false};
let hist = [], hi = -1, R = null, WR = null;
const syncers = [];

/* ================= helpers ================= */
let toastT = 0;
function toast(msg, ms = 2800){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); if(ms) toastT = setTimeout(() => t.hidden = true, ms); }
function dialog(build){
  const d = $('#dlg'), card = $('#dlgCard'); card.innerHTML = ''; d.hidden = false;
  const close = () => { d.hidden = true; card.innerHTML = ''; };
  d.onpointerdown = e => { if(e.target === d && !d.dataset.busy) close(); };
  build(card, close);
  return close;
}
function confirmDlg(title, text, okLabel, danger = true){
  return new Promise(res => dialog((card, close) => {
    card.append(el(`<h2>${title}</h2>`), el(`<p class="hint">${text}</p>`));
    const a = el(`<div class="dactions"><button class="btn">Annuleren</button><button class="btn ${danger ? 'danger' : 'primary'}">${okLabel}</button></div>`);
    a.children[0].onclick = () => { close(); res(false); }; a.children[1].onclick = () => { close(); res(true); };
    card.append(a);
  }));
}
function groupChecks(defaults){
  const box = el('<div class="checks"></div>');
  E.GROUPS.forEach(([k, l]) => box.append(el(`<label class="toggle"><input type="checkbox" value="${k}" ${defaults.includes(k) ? 'checked' : ''}> ${l}</label>`)));
  box.values = () => [...box.querySelectorAll('input:checked')].map(i => i.value);
  return box;
}
function getWR(){ if(!WR) WR = new E.Renderer(document.createElement('canvas'), true); return WR; }

/* ================= library ================= */
async function loadLibrary(){ photos = (await store.allPhotos()).sort((a, b) => b.added - a.added); docs = await store.allDocs().catch(() => []); renderGrid(); }
function thumbURL(p){
  let u = thumbUrls.get(p.id);
  if(!u || u.blob !== p.thumb){ if(u) URL.revokeObjectURL(u.url); u = {blob:p.thumb, url:URL.createObjectURL(p.thumb)}; thumbUrls.set(p.id, u); }
  return u.url;
}
function renderGrid(){
  const grid = $('#grid'); grid.innerHTML = '';
  $('#libScroll').classList.toggle('selecting', selecting);
  const items = [...docs.map(d => ({...d, isDoc:true, t:d.updated || d.added})), ...photos.map(p => ({p, t:p.added}))].sort((a, b) => b.t - a.t);
  items.forEach(it => {
    const isDoc = !!it.isDoc, p = isDoc ? it : it.p;
    const badge = isDoc ? `<span class="kind"><svg viewBox="0 0 24 24"><path d="M12 3 2 8l10 5 10-5z"/><path d="m2 13 10 5 10-5"/></svg>${p.layers.length} lagen</span>` : (E.isEdited(p.edit) ? '<span class="dot" title="Bewerkt"></span>' : '');
    const b = el(`<button class="tile" aria-pressed="${selected.has(p.id)}"><img alt="" loading="lazy"><span class="check"></span>${badge}</button>`);
    b.querySelector('img').src = thumbURL(p); b.setAttribute('aria-label', p.name);
    let lp = 0, longed = false;
    b.addEventListener('pointerdown', () => { longed = false; lp = setTimeout(() => { longed = true; if(!selecting) setSelecting(true); toggleSel(p.id); }, 480); });
    ['pointerup','pointerleave','pointercancel'].forEach(ev => b.addEventListener(ev, () => clearTimeout(lp)));
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.onclick = () => { if(longed) return; selecting ? toggleSel(p.id) : isDoc ? BW.open(p.id) : openEditor(p.id); };
    b.dataset.id = p.id; grid.append(b);
  });
  const total = photos.length + docs.length;
  $('#empty').hidden = total > 0;
  $('#selectBtn').hidden = total === 0;
  const edited = photos.filter(p => E.isEdited(p.edit)).length;
  const meta = $('#libMeta');
  meta.textContent = total ? `${photos.length} foto${photos.length === 1 ? '' : "'s"} · ${edited} bewerkt${docs.length ? ` · ${docs.length} document${docs.length === 1 ? '' : 'en'} met lagen` : ''}` : '';
  if(total && navigator.storage?.estimate) navigator.storage.estimate().then(s => { meta.textContent += ` · ${(s.usage/1048576).toFixed(0)} MB op dit apparaat`; }).catch(() => {});
  updSelbar();
}
function setSelecting(v){ selecting = v; if(!v) selected.clear(); $('#selectBtn').textContent = v ? 'Annuleren' : 'Selecteren'; renderGrid(); }
function toggleSel(id){ selected.has(id) ? selected.delete(id) : selected.add(id); const b = $(`.tile[data-id="${id}"]`); if(b) b.setAttribute('aria-pressed', selected.has(id)); updSelbar(); }
function updSelbar(){
  $('#selbar').hidden = !selecting;
  $('#selCount').textContent = `${selected.size} geselecteerd`;
  ['selPreset','selExport','selDelete'].forEach(id => $('#'+id).disabled = selected.size === 0);
  $('#selPaste').disabled = selected.size === 0 || !clipboard;
}

async function importOne(blob, name){
  const bmp = await decode(blob);
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const prev = await toBlob(scaleCanvas(bmp, 2048), 'image/jpeg', .92);
  const thumbC = scaleCanvas(bmp, 480);
  free(bmp);
  let edit = null;
  if(defaultText && defaultText.content.trim()){
    edit = E.defaultEdit(); edit.text = E.clone(defaultText);
    const x = thumbC.getContext('2d'); await E.loadFont(edit.text.font); E.drawText(x, thumbC.width, thumbC.height, edit.text);
  }
  const rec = {id:uid(), name:(name || 'foto').replace(/\.[^.]+$/, ''), added:Date.now() + Math.random(), w, h, bytes:blob.size, edit, thumb:await toBlob(thumbC, 'image/jpeg', .85)};
  await store.addPhoto(rec, blob, prev);
  return rec;
}
async function importFiles(list){
  const files = [...list].filter(f => (f.type || '').startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name));
  if(!files.length){ toast('Geen foto’s gevonden in wat je hebt gekozen.'); return []; }
  const done = []; let failed = 0;
  for(let i = 0; i < files.length; i++){
    toast(`Toevoegen… ${i+1} van ${files.length}`, 0);
    try { done.push(await importOne(files[i], files[i].name)); }
    catch(err){ failed++; if(err && err.name === 'QuotaExceededError'){ toast('Je apparaat heeft geen opslagruimte meer voor Lichtbak.', 5000); break; } }
  }
  try { await navigator.storage?.persist?.(); } catch(_){}
  await loadLibrary();
  if(failed) toast(`${done.length} toegevoegd. ${failed} bestand${failed === 1 ? '' : 'en'} kon${failed === 1 ? '' : 'den'} niet worden geopend (HEIC wordt niet ondersteund).`, 5000);
  else toast(`${done.length} foto${done.length === 1 ? '' : "'s"} toegevoegd`);
  return done;
}

/* ================= views ================= */
function showView(v){
  ['library','editor','bewerk'].forEach(n => $('#' + n).hidden = n !== v);
  $('#menu').hidden = true; $('#addMenu').hidden = true;
  if(v === 'bewerk') history.pushState({bewerk:true}, '');
}

/* ================= editor: open / close ================= */
async function openEditor(id, push = true){
  const rec = photos.find(p => p.id === id); if(!rec) return;
  if(cur && cur.id !== id) await leavePhoto();
  cur = rec;
  $('#library').hidden = true; $('#editor').hidden = false; $('#loading').hidden = false;
  if(push) history.pushState({editor:true}, '');
  $('#edName').textContent = rec.name;
  const idx = photos.indexOf(rec); $('#edPos').textContent = `${idx+1} van ${photos.length} · ${rec.w} × ${rec.h}`;
  $('#prevBtn').disabled = idx === 0; $('#nextBtn').disabled = idx === photos.length-1;
  ed = E.normalizeEdit(E.clone(rec.edit || E.defaultEdit()));
  if(!rec.edit && defaultText) ed.text = E.clone(defaultText);
  free(prevBmp); prevBmp = await decode(await store.getPreview(id));
  orientedKey = ''; activeMask = ed.masks.length ? 0 : -1; dirtyThumb = false;
  hist = [JSON.stringify(ed)]; hi = 0; updUndo();
  zoomReset(); syncAll(); render();
  $('#loading').hidden = true;
  E.loadFont(ed.text.font).then(requestRender);
  presetThumbsDirty = true; if(tool === 'presets') schedulePresetThumbs();
}
let saveT = 0, dirtyThumb = false;
function scheduleSave(){ dirtyThumb = true; clearTimeout(saveT); saveT = setTimeout(saveNow, 500); }
async function saveNow(){ clearTimeout(saveT); if(!cur || !ed) return; cur.edit = E.clone(ed); await store.putPhoto(cur); }
async function leavePhoto(){
  await saveNow();
  if(dirtyThumb && cur){ try { await thumbFromEditor(); } catch(_){} }
  dirtyThumb = false;
}
async function thumbFromEditor(){
  ensureOriented();
  const [, , sw, sh] = E.cropPx(oriented.width, oriented.height, ed.geo.crop);
  R.render(ed, {outW:sw, outH:sh, crop:ed.geo.crop});
  const s = Math.min(1, 480/Math.max(sw, sh)), c = document.createElement('canvas'); c.width = Math.round(sw*s); c.height = Math.round(sh*s);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(R.canvas, 0, 0, c.width, c.height);
  E.drawText(x, c.width, c.height, ed.text);
  cur.thumb = await toBlob(c, 'image/jpeg', .85); cur.edit = E.clone(ed);
  await store.putPhoto(cur);
}
async function closeEditor(){
  await leavePhoto();
  $('#editor').hidden = true; $('#library').hidden = false; $('#menu').hidden = true;
  cur = null; ed = null; free(prevBmp); prevBmp = null;
  renderGrid();
}
window.addEventListener('popstate', () => {
  if(!$('#dlg').hidden && !$('#dlg').dataset.busy){ $('#dlg').hidden = true; if(!$('#editor').hidden) history.pushState({editor:true}, ''); return; }
  if(!$('#bewerk').hidden){ BW.close(); return; }
  if(!$('#editor').hidden) closeEditor();
});
$('#backBtn').onclick = () => history.state && history.state.editor ? history.back() : closeEditor();
async function step(d){
  const idx = photos.indexOf(cur) + d; if(idx < 0 || idx >= photos.length) return;
  await openEditor(photos[idx].id, false);
}
$('#prevBtn').onclick = () => step(-1); $('#nextBtn').onclick = () => step(1);

/* ================= history ================= */
function commit(){
  const s = JSON.stringify(ed); if(hist[hi] === s) return;
  hist = hist.slice(0, hi+1); hist.push(s); if(hist.length > 60) hist.shift(); hi = hist.length-1;
  updUndo(); scheduleSave(); presetThumbsDirty = true; if(tool === 'presets') schedulePresetThumbs();
}
function updUndo(){ $('#undoBtn').disabled = hi <= 0; $('#redoBtn').disabled = hi >= hist.length-1; }
function restore(i){ hi = i; ed = JSON.parse(hist[hi]); if(activeMask >= ed.masks.length) activeMask = ed.masks.length-1; updUndo(); scheduleSave(); syncAll(); requestRender(); }
$('#undoBtn').onclick = () => { if(hi > 0) restore(hi-1); };
$('#redoBtn').onclick = () => { if(hi < hist.length-1) restore(hi+1); };
function syncAll(){ syncers.forEach(f => f()); }

/* ================= rendering ================= */
const stage = $('#stage'), wrap = $('#wrap'), glc = $('#gl'), ov = $('#ov'), svg = $('#svg'), cropBox = $('#cropBox');
let rq = false;
function requestRender(){ if(!rq){ rq = true; requestAnimationFrame(render); } }
function ensureOriented(){
  const k = E.geoKey(ed.geo); if(k === orientedKey) return;
  const s = Math.min(1, R.maxTex/Math.max(prevBmp.width, prevBmp.height));
  oriented = E.orient(prevBmp, ed.geo, s); R.setImage(oriented); orientedKey = k;
}
const viewCrop = () => tool === 'crop' ? {x:0, y:0, w:1, h:1} : ed.geo.crop;
function render(){
  rq = false; if(!ed || !prevBmp || !R) return;
  ensureOriented();
  const cr = viewCrop(), [, , sw, sh] = E.cropPx(oriented.width, oriented.height, cr);
  const sm = tool === 'masks' && showMaskOverlay && activeMask >= 0 && !showOrig ? activeMask : -1;
  R.render(ed, {outW:sw, outH:sh, crop:cr, showMask:sm, raw:showOrig});
  layout(); drawText(); overlays(); scheduleHisto();
}
let base = {x:0, y:0, w:1, h:1}; const Z = {z:1, tx:0, ty:0};
function layout(){
  const r = stage.getBoundingClientRect(), pad = 14;
  const s = Math.min((r.width-2*pad)/glc.width, (r.height-2*pad)/glc.height);
  const w = Math.max(1, Math.floor(glc.width*s)), h = Math.max(1, Math.floor(glc.height*s));
  base = {x:(r.width-w)/2, y:(r.height-h)/2, w, h};
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  const ow = Math.round(w*dpr()), oh = Math.round(h*dpr());
  if(ov.width !== ow || ov.height !== oh){ ov.width = ow; ov.height = oh; }
  applyZoom();
}
function applyZoom(){
  if(Z.z <= 1){ Z.z = 1; Z.tx = 0; Z.ty = 0; }
  else { Z.tx = clamp(Z.tx, base.w - base.w*Z.z, 0); Z.ty = clamp(Z.ty, base.h - base.h*Z.z, 0); }
  wrap.style.transform = `translate(${base.x + Z.tx}px, ${base.y + Z.ty}px) scale(${Z.z})`;
  const zb = $('#zoomBadge'); zb.hidden = Z.z <= 1.01; zb.textContent = Math.round(Z.z*100) + '%';
}
function zoomReset(){ Z.z = 1; Z.tx = 0; Z.ty = 0; }
let textBox = null;
function drawText(){
  const x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height);
  textBox = tool !== 'crop' && !showOrig ? E.drawText(x, ov.width, ov.height, ed.text) : null;
}
new ResizeObserver(() => { if(ed && prevBmp) { layout(); drawText(); overlays(); } }).observe(stage);

/* histogram */
let histoT = 0, histoBins = null;
const hcv = document.createElement('canvas');
function scheduleHisto(){ clearTimeout(histoT); histoT = setTimeout(computeHisto, 140); }
function computeHisto(){
  if(!ed) return;
  const s = Math.min(1, 220/Math.max(glc.width, glc.height));
  hcv.width = Math.max(1, Math.round(glc.width*s)); hcv.height = Math.max(1, Math.round(glc.height*s));
  const x = hcv.getContext('2d', {willReadFrequently:true}); x.drawImage(glc, 0, 0, hcv.width, hcv.height);
  const d = x.getImageData(0, 0, hcv.width, hcv.height).data;
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  for(let i = 0; i < d.length; i += 4){ r[d[i]]++; g[d[i+1]]++; b[d[i+2]]++; l[Math.round(.2126*d[i] + .7152*d[i+1] + .0722*d[i+2])]++; }
  histoBins = {r, g, b, l};
  drawHisto($('#histo'), histoBins);
  if(tool === 'curve') drawCurve();
}
function drawHisto(cv, B){
  const x = cv.getContext('2d'), W = cv.width, H = cv.height; x.clearRect(0, 0, W, H);
  let mx = 1; for(let i = 2; i < 254; i++) mx = Math.max(mx, B.r[i], B.g[i], B.b[i]);
  x.globalCompositeOperation = 'lighter';
  [[B.r, 'rgba(225,70,70,.6)'], [B.g, 'rgba(70,190,90,.6)'], [B.b, 'rgba(70,120,230,.6)']].forEach(([a, col]) => {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
    for(let i = 0; i < 256; i++) x.lineTo(i/255*W, H - Math.min(1, a[i]/mx)*H*.94);
    x.lineTo(W, H); x.closePath(); x.fill();
  });
  x.globalCompositeOperation = 'source-over';
}

/* ================= overlays (crop, mask handles, text box) ================= */
const toDisp = (x, y) => { const cr = viewCrop(); return [(x-cr.x)/cr.w*base.w, (y-cr.y)/cr.h*base.h]; };
let hover = null;
function overlays(){
  cropBox.hidden = tool !== 'crop' || showOrig;
  if(!cropBox.hidden){
    const c = ed.geo.crop;
    Object.assign(cropBox.style, {left:c.x*base.w + 'px', top:c.y*base.h + 'px', width:c.w*base.w + 'px', height:c.h*base.h + 'px'});
    cropBox.classList.toggle('locked', ed.geo.aspect !== 'free');
    cropInfo();
  }
  drawSvg();
}
function drawSvg(){
  const w = base.w, h = base.h, r = 11/Z.z; let s = '';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const ln = (x1, y1, x2, y2, cls = '') => `<line class="shadow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"/><line class="ln ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"/>`;
  const hd = (x, y, k, main) => `<circle class="hd${main ? ' main' : ''}" data-mh="${k}" cx="${x}" cy="${y}" r="${r}" vector-effect="non-scaling-stroke"/>`;
  if(tool === 'masks' && activeMask >= 0 && !showOrig){
    const m = ed.masks[activeMask];
    if(m.type === 'linear'){
      const [ax, ay] = toDisp(m.p.x1, m.p.y1), [bx, by] = toDisp(m.p.x2, m.p.y2);
      let dx = bx-ax, dy = by-ay; const L = Math.hypot(dx, dy) || 1; const px = -dy/L*(w+h)*2, py = dx/L*(w+h)*2;
      const mx = (ax+bx)/2, my = (ay+by)/2;
      s += ln(ax-px, ay-py, ax+px, ay+py) + ln(bx-px, by-py, bx+px, by+py, 'dash') + ln(mx-px, my-py, mx+px, my+py, 'dash');
      s += hd(ax, ay, 'a', true) + hd(bx, by, 'b') + hd(mx, my, 'mid');
    } else if(m.type === 'radial'){
      const cr = viewCrop(), [cx, cy] = toDisp(m.p.cx, m.p.cy), rx = m.p.rx/cr.w*w, ry = m.p.ry/cr.h*h, f = 1-(m.feather/100);
      s += `<ellipse class="shadow" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" vector-effect="non-scaling-stroke"/><ellipse class="ln" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" vector-effect="non-scaling-stroke"/>`;
      if(f > .02) s += `<ellipse class="ln dash" cx="${cx}" cy="${cy}" rx="${rx*f}" ry="${ry*f}" fill="none" vector-effect="non-scaling-stroke"/>`;
      s += hd(cx, cy, 'c', true) + hd(cx+rx, cy, 'rx') + hd(cx, cy+ry, 'ry');
    } else if(m.type === 'brush' && hover){
      const cr = viewCrop(), [hx, hy] = toDisp(hover.x, hover.y), rr = brush.size/2/cr.h*h;
      s += `<circle class="shadow" cx="${hx}" cy="${hy}" r="${rr}" fill="none" vector-effect="non-scaling-stroke"/><circle class="ln${brush.erase ? ' dash' : ''}" cx="${hx}" cy="${hy}" r="${rr}" fill="none" vector-effect="non-scaling-stroke"/>`;
    }
  }
  if(tool === 'text' && textBox && !showOrig){
    const p = 6/Z.z, x = (textBox.cx-textBox.w/2)*w - p, y = (textBox.cy-textBox.h/2)*h - p;
    s += `<rect class="ln dash" x="${x}" y="${y}" width="${textBox.w*w + 2*p}" height="${textBox.h*h + 2*p}" fill="none" vector-effect="non-scaling-stroke"/>`;
  }
  svg.innerHTML = s;
}

/* ================= pointer handling on the stage ================= */
const ptrs = new Map(); let act = null, lastTap = {t:0, x:0, y:0};
const dispN = e => { const r = wrap.getBoundingClientRect(); return {x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height}; };
const fullN = e => { const d = dispN(e), cr = viewCrop(); return {x:cr.x + d.x*cr.w, y:cr.y + d.y*cr.h}; };
const brushOn = () => tool === 'masks' && activeMask >= 0 && ed.masks[activeMask].type === 'brush';
stage.addEventListener('pointerdown', e => {
  if(!ed || (e.pointerType === 'mouse' && e.button !== 0)) return;
  stage.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(ptrs.size === 2 && tool !== 'crop'){
    if(act && act.kind === 'paint'){ const m = ed.masks[activeMask]; if(act.stroke.pts.length <= 4) m.strokes.pop(); requestRender(); }
    const [a, b] = [...ptrs.values()];
    act = {kind:'pinch', d0:Math.hypot(a.x-b.x, a.y-b.y), m0:{x:(a.x+b.x)/2, y:(a.y+b.y)/2}, z0:Z.z, tx0:Z.tx, ty0:Z.ty};
    return;
  }
  if(ptrs.size > 1) return;
  const t = e.target;
  if(t.classList.contains('h') || t === cropBox){ act = {kind:'crop', h:t.dataset.h || 'move', s:dispN(e), c:{...ed.geo.crop}}; return; }
  if(t.dataset && t.dataset.mh){ const m = ed.masks[activeMask]; act = {kind:'mask', h:t.dataset.mh, s:fullN(e), p0:{...m.p}}; return; }
  if(brushOn()){
    const p = fullN(e), m = ed.masks[activeMask];
    const stroke = {size:r4(brush.size), flow:brush.flow/100, erase:brush.erase, pts:[r4(p.x), r4(p.y)]};
    m.strokes.push(stroke); act = {kind:'paint', stroke}; hover = p; requestRender(); return;
  }
  if(tool === 'text' && textBox){
    const p = dispN(e), tb = textBox, inside = Math.abs(p.x-tb.cx) <= tb.w/2 + .03 && Math.abs(p.y-tb.cy) <= tb.h/2 + .03;
    if(inside || Z.z <= 1){
      ed.text.anchor = 'custom';
      if(inside){ ed.text.x = tb.cx; ed.text.y = tb.cy; act = {kind:'text', dx:p.x-tb.cx, dy:p.y-tb.cy}; }
      else { ed.text.x = p.x; ed.text.y = p.y; act = {kind:'text', dx:0, dy:0}; }
      syncAll(); requestRender(); return;
    }
  }
  const now = Date.now();
  if(tool !== 'crop' && now - lastTap.t < 300 && Math.hypot(e.clientX-lastTap.x, e.clientY-lastTap.y) < 30){
    zoomAt(e.clientX, e.clientY, Z.z > 1.05 ? 1 : 2.5); lastTap.t = 0; act = {kind:'none'}; return;
  }
  lastTap = {t:now, x:e.clientX, y:e.clientY};
  act = Z.z > 1 ? {kind:'pan', sx:e.clientX, sy:e.clientY, tx:Z.tx, ty:Z.ty} : {kind:'none'};
});
stage.addEventListener('pointermove', e => {
  if(ptrs.has(e.pointerId)) ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if(!act){ if(e.pointerType === 'mouse' && brushOn()){ hover = fullN(e); drawSvg(); } return; }
  if(act.kind === 'pinch' && ptrs.size >= 2){
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x-b.x, a.y-b.y), m = {x:(a.x+b.x)/2, y:(a.y+b.y)/2}, sr = stage.getBoundingClientRect();
    const z = clamp(act.z0*d/act.d0, 1, 8), mx = act.m0.x - sr.left - base.x, my = act.m0.y - sr.top - base.y;
    const ux = (mx-act.tx0)/act.z0, uy = (my-act.ty0)/act.z0;
    Z.z = z; Z.tx = mx - ux*z + (m.x-act.m0.x); Z.ty = my - uy*z + (m.y-act.m0.y); applyZoom(); drawSvg(); return;
  }
  if(act.kind === 'pan'){ Z.tx = act.tx + e.clientX - act.sx; Z.ty = act.ty + e.clientY - act.sy; applyZoom(); return; }
  if(act.kind === 'crop'){ cropMove(dispN(e)); return; }
  if(act.kind === 'mask'){ maskMove(fullN(e)); return; }
  if(act.kind === 'paint'){
    const p = fullN(e), pts = act.stroke.pts, lx = pts[pts.length-2], ly = pts[pts.length-1];
    hover = p;
    if(Math.hypot((p.x-lx)*(oriented.width/oriented.height), p.y-ly) > brush.size*.08){ pts.push(r4(p.x), r4(p.y)); requestRender(); }
    else drawSvg();
    return;
  }
  if(act.kind === 'text'){ const p = dispN(e); ed.text.x = clamp(p.x-act.dx, 0, 1); ed.text.y = clamp(p.y-act.dy, 0, 1); requestRender(); }
});
function endPtr(e){
  ptrs.delete(e.pointerId);
  if(!act) return;
  if(act.kind === 'pinch'){ if(ptrs.size === 0) act = null; else act = {kind:'none'}; return; }
  if(ptrs.size) return;
  if(['crop','mask','paint','text'].includes(act.kind)) commit();
  if(act.kind === 'paint' && e.pointerType !== 'mouse'){ hover = null; drawSvg(); }
  act = null;
}
stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
stage.addEventListener('pointerleave', e => { if(e.pointerType === 'mouse' && hover && !act){ hover = null; drawSvg(); } });
stage.addEventListener('wheel', e => { if(!ed || tool === 'crop') return; e.preventDefault(); zoomAt(e.clientX, e.clientY, clamp(Z.z*Math.exp(-e.deltaY*.0018), 1, 8)); }, {passive:false});
function zoomAt(cx, cy, z){
  const sr = stage.getBoundingClientRect(), mx = cx - sr.left - base.x, my = cy - sr.top - base.y;
  const ux = (mx-Z.tx)/Z.z, uy = (my-Z.ty)/Z.z; Z.z = z; Z.tx = mx - ux*z; Z.ty = my - uy*z; applyZoom(); drawSvg();
}
function maskMove(p){
  const m = ed.masks[activeMask], a = act, q = m.p, d = {x:p.x-a.s.x, y:p.y-a.s.y};
  if(m.type === 'linear'){
    if(a.h === 'a'){ q.x1 = r4(p.x); q.y1 = r4(p.y); }
    else if(a.h === 'b'){ q.x2 = r4(p.x); q.y2 = r4(p.y); }
    else { q.x1 = r4(a.p0.x1+d.x); q.y1 = r4(a.p0.y1+d.y); q.x2 = r4(a.p0.x2+d.x); q.y2 = r4(a.p0.y2+d.y); }
  } else if(m.type === 'radial'){
    if(a.h === 'c'){ q.cx = r4(a.p0.cx+d.x); q.cy = r4(a.p0.cy+d.y); }
    else if(a.h === 'rx') q.rx = r4(Math.max(.02, Math.abs(p.x-q.cx)));
    else if(a.h === 'ry') q.ry = r4(Math.max(.02, Math.abs(p.y-q.cy)));
  }
  requestRender();
}

/* ================= crop ================= */
function ratioN(){
  const g = ed.geo; if(g.aspect === 'free') return null;
  const [ow, oh] = E.orientedSize(prevBmp.width, prevBmp.height, g);
  if(g.aspect === 'orig') return 1;
  const [a, b] = g.aspect.split(':').map(Number); return (a/b)*(oh/ow);
}
function applyAspect(){ const rn = ratioN(); if(!rn) return; let w, h; if(rn <= 1){ h = 1; w = rn; } else { w = 1; h = 1/rn; } ed.geo.crop = {x:(1-w)/2, y:(1-h)/2, w, h}; }
function cropMove(p){
  const c = act.c, n = {...c}, rn = ratioN(), MIN = .05, H = act.h;
  if(H === 'move'){ n.x = clamp(c.x + p.x - act.s.x, 0, 1-c.w); n.y = clamp(c.y + p.y - act.s.y, 0, 1-c.h); }
  else if(H.length === 2){
    const left = H.includes('w'), top = H.includes('n'), ax = left ? c.x+c.w : c.x, ay = top ? c.y+c.h : c.y;
    let w = Math.max(MIN, Math.abs(clamp(p.x, 0, 1)-ax)), h = Math.max(MIN, Math.abs(clamp(p.y, 0, 1)-ay));
    if(rn){ if(w/h > rn) w = h*rn; else h = w/rn; }
    const maxW = left ? ax : 1-ax, maxH = top ? ay : 1-ay;
    if(w > maxW){ w = maxW; if(rn) h = w/rn; } if(h > maxH){ h = maxH; if(rn) w = h*rn; }
    n.w = w; n.h = h; n.x = left ? ax-w : ax; n.y = top ? ay-h : ay;
  } else {
    if(H === 'e') n.w = clamp(p.x-c.x, MIN, 1-c.x);
    if(H === 's') n.h = clamp(p.y-c.y, MIN, 1-c.y);
    if(H === 'w'){ const r = c.x+c.w, x = clamp(p.x, 0, r-MIN); n.x = x; n.w = r-x; }
    if(H === 'n'){ const b = c.y+c.h, y = clamp(p.y, 0, b-MIN); n.y = y; n.h = b-y; }
  }
  for(const k in n) n[k] = r4(n[k]);
  ed.geo.crop = n; overlays();
}
function cropInfo(){
  const [W, H] = E.orientedSize(cur.w, cur.h, ed.geo), info = $('#cropInfoTxt');
  if(info) info.textContent = `${Math.round(ed.geo.crop.w*W)} × ${Math.round(ed.geo.crop.h*H)} px`;
}

/* ================= UI building blocks ================= */
let sid = 0;
function paintRange(inp, def){
  const mn = +inp.min, mx = +inp.max, v = +inp.value, z = (clamp(def, mn, mx)-mn)/(mx-mn)*100, p = (v-mn)/(mx-mn)*100;
  inp.style.setProperty('--a', Math.min(z, p) + '%'); inp.style.setProperty('--b', Math.max(z, p) + '%');
}
function slider({label, min, max, step = 1, get, set, fmt = fmtSigned, def = 0, track = null, noCommit = false, onInput = null}){
  const id = 'sl' + (++sid);
  const box = el(`<div class="sl"><label for="${id}">${label}</label><output></output><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"></div>`);
  const inp = box.querySelector('input'), out = box.querySelector('output');
  if(track){ inp.classList.add('spec'); inp.style.setProperty('--track', track); }
  const show = () => { const v = +inp.value; out.textContent = fmt(v); out.classList.toggle('set', Math.abs(v-def) > 1e-9); if(!track) paintRange(inp, def); };
  inp.addEventListener('input', () => { set(+inp.value); show(); onInput ? onInput() : requestRender(); });
  if(!noCommit) inp.addEventListener('change', () => commit());
  const reset = () => { inp.value = def; set(def); show(); onInput ? onInput() : requestRender(); if(!noCommit) commit(); };
  inp.addEventListener('dblclick', reset); box.querySelector('label').addEventListener('dblclick', reset); out.addEventListener('dblclick', reset);
  const sync = () => { if(!ed) return; inp.value = get(); show(); };
  syncers.push(sync); box._sync = sync;
  return box;
}
function group(title, resetFn){
  const g = el(`<div class="group"><span class="glabel"><span>${title}</span></span></div>`);
  if(resetFn){ const b = el('<button class="link">Herstellen</button>'); b.onclick = () => { resetFn(); commit(); syncAll(); requestRender(); }; g.firstElementChild.append(b); }
  return g;
}
function chips(items, isOn, onPick){
  const box = el('<div class="chips"></div>');
  items.forEach(([v, l]) => { const b = el(`<button class="chip">${l}</button>`); b.onclick = () => onPick(v); box.append(b); b._v = v; });
  syncers.push(() => box.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', isOn(b._v))));
  return box;
}
const ICON = {
  presets:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  licht:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  kleur:'<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  curve:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M6 18c5 0 7-12 12-12"/></svg>',
  effecten:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 7l5-2.6M12 12h9M12 17l5 2.6"/></svg>',
  detail:'<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4"/></svg>',
  masks:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="5"/></svg>',
  crop:'<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  text:'<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
  linear:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  radial:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  brush:'<svg viewBox="0 0 24 24"><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13z"/><path d="M7 14c-2 0-3.5 1.5-3.5 3.5 0 1.3-.7 2.5-1.5 3 1 .5 2.4.5 3.5.5A4 4 0 0 0 9.5 17"/></svg>',
  eye:'<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
const TOOLS = [['presets','Presets'], ['licht','Licht'], ['kleur','Kleur'], ['curve','Curve'], ['effecten','Effecten'], ['detail','Detail'], ['masks','Maskers'], ['crop','Bijsnijden'], ['text','Tekst']];
const panes = {};

/* ================= panels ================= */
function buildLicht(p){
  const L = () => ed.licht;
  const g = group('Licht', () => Object.assign(ed.licht, E.defaultEdit().licht));
  g.append(
    slider({label:'Belichting', min:-4, max:4, step:.05, get:() => L().exposure, set:v => L().exposure = v, fmt:v => (v > 0 ? '+' : '') + v.toFixed(2)}),
    slider({label:'Contrast', min:-100, max:100, get:() => L().contrast, set:v => L().contrast = v}),
    slider({label:'Hoge lichten', min:-100, max:100, get:() => L().highlights, set:v => L().highlights = v}),
    slider({label:'Schaduwen', min:-100, max:100, get:() => L().shadows, set:v => L().shadows = v}),
    slider({label:'Witte tinten', min:-100, max:100, get:() => L().whites, set:v => L().whites = v}),
    slider({label:'Zwarte tinten', min:-100, max:100, get:() => L().blacks, set:v => L().blacks = v}));
  p.append(g, el('<p class="hint">Dubbeltik op een schuif om hem te herstellen. Houd de vergelijkknop bovenin ingedrukt om het origineel te zien.</p>'));
}
const HUE_TRACK = 'linear-gradient(90deg,#e5484d,#f2cc3a 16%,#46a758 33%,#3fb8c4 50%,#3e7be6 66%,#8e4ec6 83%,#e5484d)';
function buildKleur(p){
  const K = () => ed.kleur;
  const wb = group('Witbalans', () => { ed.kleur.temp = 0; ed.kleur.tint = 0; });
  wb.append(
    slider({label:'Temperatuur', min:-100, max:100, get:() => K().temp, set:v => K().temp = v, track:'linear-gradient(90deg,#3e7be6,#d9dde3 50%,#f2c23a)'}),
    slider({label:'Tint', min:-100, max:100, get:() => K().tint, set:v => K().tint = v, track:'linear-gradient(90deg,#46a758,#d9dde3 50%,#d6409f)'}));
  const pr = group('Aanwezigheid', () => { ed.kleur.vibrance = 0; ed.kleur.saturation = 0; });
  pr.append(
    slider({label:'Levendigheid', min:-100, max:100, get:() => K().vibrance, set:v => K().vibrance = v}),
    slider({label:'Verzadiging', min:-100, max:100, get:() => K().saturation, set:v => K().saturation = v}));
  const mix = group('Kleurmix', () => { ed.hsl = E.defaultEdit().hsl; });
  const dots = el('<div class="colors"></div>');
  E.HSL_COLORS.forEach((c, i) => { const b = el(`<button class="cdot" aria-label="${c.name}" title="${c.name}"></button>`); b.style.background = c.col; b.onclick = () => { hslSel = i; syncAll(); }; dots.append(b); });
  const selName = el('<span class="hint"></span>');
  syncers.push(() => { if(!ed) return; dots.querySelectorAll('.cdot').forEach((b, i) => { b.setAttribute('aria-pressed', i === hslSel); b.classList.toggle('changed', ed.hsl.h[i] || ed.hsl.s[i] || ed.hsl.l[i]); }); selName.textContent = `Je past nu ${E.HSL_COLORS[hslSel].name.toLowerCase()} aan.`; });
  mix.append(dots, selName,
    slider({label:'Kleurtoon', min:-100, max:100, get:() => ed.hsl.h[hslSel], set:v => ed.hsl.h[hslSel] = v}),
    slider({label:'Verzadiging', min:-100, max:100, get:() => ed.hsl.s[hslSel], set:v => ed.hsl.s[hslSel] = v}),
    slider({label:'Luminantie', min:-100, max:100, get:() => ed.hsl.l[hslSel], set:v => ed.hsl.l[hslSel] = v}));
  const G = () => ed.grade, deg = v => Math.round(v) + '°';
  const gr = group('Kleurgradatie', () => { ed.grade = E.defaultEdit().grade; });
  gr.append(
    el('<span class="hint">Schaduwen</span>'),
    slider({label:'Kleurtoon', min:0, max:360, get:() => G().shHue, set:v => G().shHue = v, fmt:deg, def:210, track:HUE_TRACK}),
    slider({label:'Verzadiging', min:0, max:100, get:() => G().shSat, set:v => G().shSat = v, fmt:String}),
    el('<span class="hint">Hoge lichten</span>'),
    slider({label:'Kleurtoon', min:0, max:360, get:() => G().hiHue, set:v => G().hiHue = v, fmt:deg, def:40, track:HUE_TRACK}),
    slider({label:'Verzadiging', min:0, max:100, get:() => G().hiSat, set:v => G().hiSat = v, fmt:String}),
    slider({label:'Balans', min:-100, max:100, get:() => G().balance, set:v => G().balance = v}));
  p.append(wb, pr, mix, gr);
}

/* curve editor */
const cv = document.createElement('canvas');
let cDrag = null;
const CH_COL = {rgb:'#e9ebee', r:'#ff6b6b', g:'#5fd17a', b:'#6aa0ff'};
function curvePts(){ return ed.curve[curveCh]; }
function drawCurve(){
  if(!ed) return;
  const box = cv.parentElement; if(!box || !box.clientWidth) return;
  const S = Math.round(box.clientWidth*dpr()); if(cv.width !== S){ cv.width = cv.height = S; }
  const x = cv.getContext('2d'), W = S, H = S; x.clearRect(0, 0, W, H);
  if(histoBins){
    const a = curveCh === 'rgb' ? histoBins.l : histoBins[curveCh]; let mx = 1; for(let i = 2; i < 254; i++) mx = Math.max(mx, a[i]);
    x.fillStyle = 'rgba(255,255,255,.07)'; x.beginPath(); x.moveTo(0, H);
    for(let i = 0; i < 256; i++) x.lineTo(i/255*W, H - Math.min(1, a[i]/mx)*H*.9); x.lineTo(W, H); x.fill();
  }
  x.strokeStyle = 'rgba(255,255,255,.09)'; x.lineWidth = 1;
  for(let i = 1; i < 4; i++){ x.beginPath(); x.moveTo(i*W/4, 0); x.lineTo(i*W/4, H); x.moveTo(0, i*H/4); x.lineTo(W, i*H/4); x.stroke(); }
  x.setLineDash([4*dpr(), 4*dpr()]); x.beginPath(); x.moveTo(0, H); x.lineTo(W, 0); x.stroke(); x.setLineDash([]);
  const pts = curvePts(), lut = E.curveEval(pts);
  x.strokeStyle = CH_COL[curveCh]; x.lineWidth = 2*dpr(); x.beginPath();
  for(let k = 0; k < 256; k++){ const px = k/255*W, py = H - lut[k]*H; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
  pts.forEach((p, i) => { x.beginPath(); x.arc(p[0]*W, H - p[1]*H, 6*dpr(), 0, Math.PI*2); x.fillStyle = cDrag && cDrag.i === i && cDrag.remove ? 'rgba(255,255,255,.25)' : CH_COL[curveCh]; x.fill(); x.lineWidth = 2*dpr(); x.strokeStyle = '#1b1d21'; x.stroke(); });
}
function curvePos(e){ const r = cv.getBoundingClientRect(); return {x:(e.clientX-r.left)/r.width, y:1-(e.clientY-r.top)/r.height, px:e.clientX-r.left, py:e.clientY-r.top, w:r.width}; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  const p = curvePos(e), pts = curvePts(); let best = -1, bd = 1e9;
  pts.forEach((q, i) => { const d = Math.hypot(q[0]*p.w - p.px, (1-q[1])*p.w - p.py); if(d < bd){ bd = d; best = i; } });
  if(bd > 22){
    const x = clamp(p.x, .01, .99), y = E.curveEval(pts)[Math.round(x*255)];
    let i = pts.findIndex(q => q[0] > x); if(i < 0) i = pts.length-1;
    pts.splice(i, 0, [r4(x), r4(y)]); best = i;
  }
  cDrag = {i:best, remove:false}; drawCurve(); requestRender();
});
cv.addEventListener('pointermove', e => {
  if(!cDrag) return; const p = curvePos(e), pts = curvePts(), i = cDrag.i, end = i === 0 || i === pts.length-1;
  let x = end ? pts[i][0] : clamp(p.x, pts[i-1][0] + .01, pts[i+1][0] - .01);
  cDrag.remove = !end && (p.y < -.1 || p.y > 1.1);
  pts[i] = [r4(x), r4(clamp(p.y, 0, 1))];
  drawCurve(); requestRender();
});
const cEnd = () => { if(!cDrag) return; if(cDrag.remove) curvePts().splice(cDrag.i, 1); cDrag = null; drawCurve(); requestRender(); commit(); };
cv.addEventListener('pointerup', cEnd); cv.addEventListener('pointercancel', cEnd);
cv.addEventListener('dblclick', e => { const p = curvePos(e), pts = curvePts(); const i = pts.findIndex((q, k) => k > 0 && k < pts.length-1 && Math.hypot(q[0]*p.w - p.px, (1-q[1])*p.w - p.py) < 22); if(i > 0){ pts.splice(i, 1); drawCurve(); requestRender(); commit(); } });
function buildCurve(p){
  const g = group('Toncurve', () => { ed.curve = E.defaultEdit().curve; });
  g.append(chips([['rgb','RGB'], ['r','Rood'], ['g','Groen'], ['b','Blauw']], v => curveCh === v, v => { curveCh = v; syncAll(); drawCurve(); }));
  const box = el('<div class="curvebox"></div>'); box.append(cv); g.append(box);
  g.append(el('<p class="hint">Tik op de lijn om een punt toe te voegen en sleep het. Sleep een punt uit het vak of dubbeltik erop om het te verwijderen.</p>'));
  const qp = group('Snel kiezen');
  const Q = {lin:[[0,0],[1,1]], mid:[[0,0],[.25,.21],[.75,.79],[1,1]], strong:[[0,0],[.25,.15],[.75,.86],[1,1]], matte:[[0,.1],[.3,.3],[1,.95]]};
  const qb = el('<div class="chips"></div>');
  [['lin','Lineair'], ['mid','Licht contrast'], ['strong','Sterk contrast'], ['matte','Mat']].forEach(([k, l]) => { const b = el(`<button class="chip">${l}</button>`); b.onclick = () => { ed.curve[curveCh] = E.clone(Q[k]); commit(); drawCurve(); requestRender(); }; qb.append(b); });
  qp.append(qb);
  p.append(g, qp);
  syncers.push(() => { if(tool === 'curve') requestAnimationFrame(drawCurve); });
}
function buildEffecten(p){
  const F = () => ed.effecten;
  const a = group('Effecten', () => { ed.effecten.clarity = 0; ed.effecten.dehaze = 0; });
  a.append(
    slider({label:'Duidelijkheid', min:-100, max:100, get:() => F().clarity, set:v => F().clarity = v}),
    slider({label:'Nevel verwijderen', min:-100, max:100, get:() => F().dehaze, set:v => F().dehaze = v}));
  const v = group('Vignet', () => { ed.effecten.vignette = 0; ed.effecten.vigMid = 50; });
  v.append(
    slider({label:'Hoeveelheid', min:-100, max:100, get:() => F().vignette, set:x => F().vignette = x}),
    slider({label:'Middelpunt', min:0, max:100, def:50, get:() => F().vigMid, set:x => F().vigMid = x, fmt:String}));
  const k = group('Korrel', () => { ed.effecten.grain = 0; });
  k.append(slider({label:'Hoeveelheid', min:0, max:100, get:() => F().grain, set:x => F().grain = x, fmt:String}));
  p.append(a, v, k);
}
function buildDetail(p){
  const D = () => ed.detail;
  const g = group('Detail', () => { ed.detail = E.defaultEdit().detail; });
  g.append(
    slider({label:'Verscherpen', min:0, max:100, get:() => D().sharpen, set:v => D().sharpen = v, fmt:String}),
    slider({label:'Ruisreductie', min:0, max:100, get:() => D().noise, set:v => D().noise = v, fmt:String}));
  p.append(g, el('<p class="hint">Zoom in om scherpte en ruis goed te beoordelen: knijp met twee vingers, dubbeltik, of scroll met de muis. De export gebruikt de volledige resolutie.</p>'));
}
function buildMasks(p){
  const list = el('<div class="masklist"></div>');
  const add = group('Nieuw masker');
  const row = el(`<div class="addrow"><button class="btn" data-t="linear">${ICON.linear}Lineair verloop</button><button class="btn" data-t="radial">${ICON.radial}Radiaal verloop</button><button class="btn" data-t="brush">${ICON.brush}Penseel</button></div>`);
  row.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    if(ed.masks.length >= E.MAX_MASKS){ toast('Je kunt maximaal 6 maskers per foto gebruiken.'); return; }
    ed.masks.push(E.newMask(b.dataset.t, oriented.width/oriented.height, ed.masks.length+1));
    activeMask = ed.masks.length-1; showMaskOverlay = true; zoomReset(); commit(); syncAll(); requestRender();
    if(b.dataset.t === 'brush') toast('Teken over het deel van de foto dat je wilt aanpassen.');
  });
  add.append(row);
  const ctl = el('<div class="group"></div>');
  const head = el('<span class="glabel"><span class="mname"></span></span>');
  const tg = el('<div class="group" style="gap:4px"></div>');
  const tOverlay = el('<label class="toggle"><input type="checkbox"> Masker rood tonen</label>');
  const tInv = el('<label class="toggle"><input type="checkbox"> Omkeren</label>');
  const tHide = el('<label class="toggle"><input type="checkbox"> Effect tijdelijk uit</label>');
  tOverlay.querySelector('input').onchange = e => { showMaskOverlay = e.target.checked; requestRender(); };
  tInv.querySelector('input').onchange = e => { ed.masks[activeMask].invert = e.target.checked; commit(); requestRender(); };
  tHide.querySelector('input').onchange = e => { ed.masks[activeMask].hidden = e.target.checked; commit(); requestRender(); };
  tg.append(tOverlay, tInv, tHide);
  const M = () => ed.masks[activeMask] || {adj:{}};
  const feather = slider({label:'Doezelaar', min:0, max:100, get:() => M().feather, set:v => M().feather = v, fmt:String, def:50});
  const bmode = chips([[false,'Tekenen'], [true,'Gummen']], v => brush.erase === v, v => { brush.erase = v; syncAll(); drawSvg(); });
  const bsize = slider({label:'Penseelgrootte', min:1, max:40, step:.5, get:() => brush.size*100, set:v => brush.size = v/100, fmt:v => v + '%', def:8, noCommit:true, onInput:() => { hover = hover || {x:.5, y:.5}; drawSvg(); }});
  const bflow = slider({label:'Dekking penseel', min:10, max:100, get:() => brush.flow, set:v => brush.flow = v, fmt:v => v + '%', def:100, noCommit:true, onInput:() => {}});
  const bclear = el('<button class="link">Penseelstreken wissen</button>');
  bclear.onclick = () => { M().strokes = []; commit(); requestRender(); };
  const brushBox = el('<div class="group"></div>'); brushBox.append(bmode, bsize, bflow, bclear);
  const hint = el('<p class="hint"></p>');
  const A = () => M().adj;
  const adj = group('Aanpassingen in dit masker');
  adj.append(
    slider({label:'Belichting', min:-4, max:4, step:.05, get:() => A().exposure, set:v => A().exposure = v, fmt:v => (v > 0 ? '+' : '') + v.toFixed(2)}),
    slider({label:'Contrast', min:-100, max:100, get:() => A().contrast, set:v => A().contrast = v}),
    slider({label:'Hoge lichten', min:-100, max:100, get:() => A().highlights, set:v => A().highlights = v}),
    slider({label:'Schaduwen', min:-100, max:100, get:() => A().shadows, set:v => A().shadows = v}),
    slider({label:'Temperatuur', min:-100, max:100, get:() => A().temp, set:v => A().temp = v, track:'linear-gradient(90deg,#3e7be6,#d9dde3 50%,#f2c23a)'}),
    slider({label:'Tint', min:-100, max:100, get:() => A().tint, set:v => A().tint = v, track:'linear-gradient(90deg,#46a758,#d9dde3 50%,#d6409f)'}),
    slider({label:'Verzadiging', min:-100, max:100, get:() => A().saturation, set:v => A().saturation = v}),
    slider({label:'Duidelijkheid', min:-100, max:100, get:() => A().clarity, set:v => A().clarity = v}));
  const del = el(`<button class="btn danger">${ICON.trash}Masker verwijderen</button>`);
  del.onclick = () => { const m = ed.masks[activeMask]; ed.masks.splice(activeMask, 1); activeMask = Math.min(activeMask, ed.masks.length-1); commit(); syncAll(); requestRender(); toast(`${m.name} verwijderd`); };
  ctl.append(head, tg, feather, brushBox, hint, adj, del);
  p.append(list, add, ctl);
  syncers.push(() => {
    if(!ed) return;
    list.innerHTML = '';
    ed.masks.forEach((m, i) => {
      const b = el(`<button class="mitem" aria-pressed="${i === activeMask}"><span class="ic">${ICON[m.type]}</span><span class="nm${m.hidden ? ' off' : ''}"></span></button>`);
      b.querySelector('.nm').textContent = m.name; b.onclick = () => { activeMask = i; syncAll(); requestRender(); }; list.append(b);
    });
    if(!ed.masks.length) list.append(el('<p class="hint">Met een masker pas je één deel van de foto aan, bijvoorbeeld alleen de lucht (lineair verloop), alleen je onderwerp (radiaal verloop) of precies wat je zelf aantekent (penseel).</p>'));
    const m = ed.masks[activeMask]; ctl.hidden = !m; if(!m) return;
    head.querySelector('.mname').textContent = m.name;
    tOverlay.querySelector('input').checked = showMaskOverlay; tInv.querySelector('input').checked = m.invert; tHide.querySelector('input').checked = !!m.hidden;
    feather.hidden = m.type === 'linear'; brushBox.hidden = m.type !== 'brush';
    hint.textContent = m.type === 'linear' ? 'Sleep de oranje stip (volledig effect) en de witte stip (geen effect). Met de middelste stip verplaats je het hele verloop.'
      : m.type === 'radial' ? 'Sleep de oranje stip om te verplaatsen en de witte stippen om de breedte en hoogte te veranderen.'
      : 'Teken met één vinger. Knijp met twee vingers om in te zoomen voor precisie.';
  });
}
const ASPECTS = [['free','Vrij'], ['orig','Origineel'], ['1:1','1:1'], ['4:5','4:5'], ['5:4','5:4'], ['3:2','3:2'], ['2:3','2:3'], ['16:9','16:9'], ['9:16','9:16']];
function buildCrop(p){
  const a = group('Verhouding');
  a.append(chips(ASPECTS, v => ed.geo.aspect === v, v => { ed.geo.aspect = v; applyAspect(); commit(); syncAll(); requestRender(); }));
  const r = group('Draaien & spiegelen');
  const row = el(`<div class="row">
    <button class="btn icon" data-r="-90" aria-label="90 graden linksom"><svg viewBox="0 0 24 24"><path d="M3 4v5h5"/><path d="M3.5 9A9 9 0 1 1 6 18"/></svg></button>
    <button class="btn icon" data-r="90" aria-label="90 graden rechtsom"><svg viewBox="0 0 24 24"><path d="M21 4v5h-5"/><path d="M20.5 9A9 9 0 1 0 18 18"/></svg></button>
    <button class="btn" data-f="h"><svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="M16 7l5 5-5 5V7z"/></svg>Spiegel</button>
    <button class="btn" data-f="v"><svg viewBox="0 0 24 24"><path d="M3 12h18"/><path d="M7 8l5-5 5 5H7z"/><path d="M7 16l5 5 5-5H7z"/></svg>Kantel</button></div>`);
  row.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { ed.geo.rot = (ed.geo.rot + +b.dataset.r + 360) % 360; ed.geo.crop = {x:0, y:0, w:1, h:1}; applyAspect(); commit(); syncAll(); requestRender(); });
  row.querySelector('[data-f=h]').onclick = () => { const g = ed.geo; g.flipH = !g.flipH; g.crop.x = r4(1-g.crop.x-g.crop.w); commit(); syncAll(); requestRender(); };
  row.querySelector('[data-f=v]').onclick = () => { const g = ed.geo; g.flipV = !g.flipV; g.crop.y = r4(1-g.crop.y-g.crop.h); commit(); syncAll(); requestRender(); };
  syncers.push(() => { if(!ed) return; row.querySelector('[data-f=h]').classList.toggle('on', ed.geo.flipH); row.querySelector('[data-f=v]').classList.toggle('on', ed.geo.flipV); });
  r.append(row, slider({label:'Rechtzetten', min:-45, max:45, step:.25, get:() => ed.geo.straighten, set:v => ed.geo.straighten = v, fmt:v => fmtSigned(v) + '°'}));
  const i = group('Uitsnede');
  const rs = el('<button class="link">Bijsnijden herstellen</button>');
  rs.onclick = () => { ed.geo = E.defaultEdit().geo; commit(); syncAll(); requestRender(); };
  i.append(el('<span class="info" id="cropInfoTxt"></span>'), el('<p class="hint">Sleep het kader of de hoeken op de foto.</p>'), rs);
  p.append(a, r, i);
}
const TCOLORS = ['#ffffff','#111111','#f0a43a','#d94b3d','#3d7bd9','#2f9e6b'];
function buildText(p){
  const T = () => ed.text;
  const f = el('<div class="field"><label for="tContent">Tekst of watermerk</label><textarea id="tContent" placeholder="Bijv. © Sherah Draaijer"></textarea></div>');
  const ta = f.querySelector('textarea');
  ta.addEventListener('input', () => { T().content = ta.value; requestRender(); }); ta.addEventListener('change', () => commit());
  syncers.push(() => { if(ed && ta.value !== ed.text.content) ta.value = ed.text.content; });
  const fg = group('Lettertype'), fonts = el('<div class="fonts"></div>');
  E.FONTS.forEach((F, i) => { const b = el(`<button class="fontbtn">${F.name}</button>`); b.style.fontFamily = `"${F.family}", system-ui`; b.style.fontWeight = F.weight; b.onclick = () => { T().font = i; commit(); syncAll(); E.loadFont(i).then(requestRender); }; fonts.append(b); });
  syncers.push(() => { if(ed) fonts.querySelectorAll('.fontbtn').forEach((b, i) => b.setAttribute('aria-pressed', i === ed.text.font)); });
  fg.append(fonts);
  const cg = group('Kleur'), sw = el('<div class="swatches"></div>');
  TCOLORS.forEach(c => { const b = el(`<button class="sw" aria-label="Kleur ${c}"></button>`); b.style.background = c; b._c = c; b.onclick = () => { T().color = c; commit(); syncAll(); requestRender(); }; sw.append(b); });
  const ci = el('<input type="color" aria-label="Eigen kleur">'); ci.oninput = () => { T().color = ci.value; syncAll(); requestRender(); }; ci.onchange = () => commit(); sw.append(ci);
  syncers.push(() => { if(!ed) return; sw.querySelectorAll('.sw').forEach(b => b.setAttribute('aria-pressed', b._c === ed.text.color)); ci.value = ed.text.color; });
  cg.append(sw);
  const pg = group('Positie'), anc = el('<div class="anchors"></div>');
  ['tl','tc','tr','ml','mc','mr','bl','bc','br'].forEach(a => { const b = el(`<button class="anc" aria-label="Positie ${a}"></button>`); b._a = a; b.onclick = () => { T().anchor = a; commit(); syncAll(); requestRender(); }; anc.append(b); });
  syncers.push(() => { if(ed) anc.querySelectorAll('.anc').forEach(b => b.setAttribute('aria-pressed', b._a === ed.text.anchor)); });
  pg.append(anc, el('<p class="hint">Of sleep de tekst op de foto naar de juiste plek.</p>'));
  const ts = el('<label class="toggle"><input type="checkbox"> Schaduw</label>'), tb = el('<label class="toggle"><input type="checkbox"> Achtergrondvlak</label>');
  ts.querySelector('input').onchange = e => { T().shadow = e.target.checked; commit(); requestRender(); };
  tb.querySelector('input').onchange = e => { T().bg = e.target.checked; commit(); requestRender(); };
  syncers.push(() => { if(!ed) return; ts.querySelector('input').checked = ed.text.shadow; tb.querySelector('input').checked = ed.text.bg; });
  const og = group('Opties'); og.append(ts, tb);
  const dg = group('Standaard watermerk');
  const dInfo = el('<p class="hint"></p>'), dSave = el('<button class="btn small">Gebruik dit voor nieuwe foto’s</button>'), dClear = el('<button class="link">Standaard uitzetten</button>');
  dSave.onclick = async () => { defaultText = E.clone(ed.text); await store.setMeta('defaultText', defaultText); syncAll(); toast('Nieuwe foto’s krijgen dit watermerk automatisch.'); };
  dClear.onclick = async () => { defaultText = null; await store.setMeta('defaultText', null); syncAll(); toast('Standaard watermerk uitgezet'); };
  syncers.push(() => { dInfo.textContent = defaultText && defaultText.content.trim() ? `Nieuwe foto’s krijgen automatisch: “${defaultText.content.split('\n')[0]}”.` : 'Sla deze tekst op als standaard, dan staat hij meteen op elke foto die je toevoegt.'; dClear.hidden = !defaultText; });
  const dr = el('<div class="row"></div>'); dr.append(dSave, dClear); dg.append(dInfo, dr);
  p.append(f, fg,
    slider({label:'Grootte', min:1, max:30, step:.5, get:() => T().size, set:v => T().size = v, fmt:String, def:5}),
    slider({label:'Dekking', min:5, max:100, get:() => T().opacity, set:v => T().opacity = v, fmt:v => v + '%', def:85}),
    cg, pg, og, dg);
}

/* presets */
let presetThumbsDirty = true, ptT = 0;
const presetTiles = [];
function allPresets(){ return [...userPresets.map(p => ({...p, builtin:false})), ...E.BUILTIN_PRESETS]; }
function buildPresets(p){
  p.innerHTML = ''; presetTiles.length = 0;
  const mine = group('Mijn presets');
  const save = el('<button class="btn small">+ Huidige bewerking opslaan</button>'); save.onclick = savePresetDlg;
  mine.append(save);
  const gridMine = el('<div class="presets"></div>'), gridStd = el('<div class="presets"></div>');
  const tile = (pr, gridEl) => {
    const b = el(`<button class="pz"><canvas width="200" height="200"></canvas><span></span></button>`);
    b.querySelector('span').textContent = pr.name;
    b.onclick = e => { if(e.target.classList.contains('del')) return; applyPreset(pr); };
    if(!pr.builtin){ const d = el('<span class="del" role="button" aria-label="Verwijderen">×</span>'); d.onclick = async ev => { ev.stopPropagation(); if(await confirmDlg('Preset verwijderen?', `“${pr.name}” wordt verwijderd. Foto’s waarop je hem al gebruikte blijven zoals ze zijn.`, 'Verwijderen')){ userPresets = userPresets.filter(x => x.id !== pr.id); await store.setMeta('presets', userPresets); buildPresets(panes.presets); } }; b.append(d); }
    gridEl.append(b); presetTiles.push({pr, c:b.querySelector('canvas')});
  };
  userPresets.forEach(pr => tile({...pr, builtin:false}, gridMine));
  if(!userPresets.length) mine.append(el('<p class="hint">Sla een bewerking op om hem later met één tik op andere foto’s te gebruiken, of op een hele selectie tegelijk vanuit de bibliotheek.</p>'));
  else mine.append(gridMine);
  E.BUILTIN_PRESETS.forEach(pr => tile(pr, gridStd));
  const std = group('Standaard'); std.append(gridStd);
  p.append(mine, std);
  presetThumbsDirty = true; schedulePresetThumbs();
}
function schedulePresetThumbs(){ if(tool !== 'presets' || !ed) return; clearTimeout(ptT); ptT = setTimeout(renderPresetThumbs, 200); }
function renderPresetThumbs(){
  if(!ed || !presetThumbsDirty) return; presetThumbsDirty = false;
  ensureOriented();
  const wr = getWR(), oc = oriented, [sx, sy, sw, sh] = E.cropPx(oc.width, oc.height, ed.geo.crop), side = Math.min(sw, sh);
  const sc = document.createElement('canvas'); sc.width = sc.height = 200;
  const x = sc.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(oc, sx+(sw-side)/2, sy+(sh-side)/2, side, side, 0, 0, 200, 200);
  wr.setImage(sc);
  presetTiles.forEach(t => {
    const e2 = E.applyGroups(E.clone(ed), t.pr.data); e2.masks = [];
    wr.render(e2, {outW:200, outH:200, crop:{x:0, y:0, w:1, h:1}});
    t.c.getContext('2d').drawImage(wr.canvas, 0, 0);
  });
}
function applyPreset(pr){ E.applyGroups(ed, pr.data); commit(); syncAll(); requestRender(); toast(`“${pr.name}” toegepast`); }
function savePresetDlg(){
  dialog((card, close) => {
    card.append(el('<h2>Preset opslaan</h2>'));
    const f = el('<div class="field"><label for="pName">Naam</label><input type="text" id="pName" placeholder="Bijv. Werkplaats daglicht"></div>');
    const checks = groupChecks(E.PRESET_GROUPS);
    card.append(f, el('<span class="glabel">Wat neemt de preset mee?</span>'), checks);
    const a = el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn primary">Opslaan</button></div>');
    a.children[0].onclick = close;
    a.children[1].onclick = async () => {
      const name = f.querySelector('input').value.trim() || `Preset ${userPresets.length+1}`, gs = checks.values();
      if(!gs.length){ toast('Kies minstens één onderdeel.'); return; }
      userPresets.unshift({id:uid(), name, data:E.pickGroups(ed, gs)}); await store.setMeta('presets', userPresets);
      close(); buildPresets(panes.presets); toast(`Preset “${name}” opgeslagen`);
    };
    card.append(a); setTimeout(() => f.querySelector('input').focus(), 50);
  });
}

/* ================= editor UI setup ================= */
function buildEditorUI(){
  const tools = $('#tools'), panel = $('#panel');
  TOOLS.forEach(([k, l]) => {
    const b = el(`<button class="tool" role="tab" data-tool="${k}">${ICON[k]}<span>${l}</span></button>`);
    b.onclick = () => setTool(k, true); tools.append(b);
    const pane = el(`<div class="pane" data-pane="${k}" hidden style="display:flex;flex-direction:column;gap:18px"></div>`); panel.append(pane); panes[k] = pane;
  });
  buildPresets(panes.presets); buildLicht(panes.licht); buildKleur(panes.kleur); buildCurve(panes.curve); buildEffecten(panes.effecten);
  buildDetail(panes.detail); buildMasks(panes.masks); buildCrop(panes.crop); buildText(panes.text);
  setTool('licht');
}
function setTool(k, fromClick){
  const side = $('#side');
  if(fromClick && k === tool && window.innerWidth < 900){ side.classList.toggle('collapsed'); requestAnimationFrame(() => { if(ed){ layout(); drawText(); overlays(); } }); return; }
  side.classList.remove('collapsed');
  const was = tool; tool = k; side.dataset.tool = k;
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-selected', b.dataset.tool === k));
  Object.entries(panes).forEach(([n, p]) => p.hidden = n !== k);
  $('#panel').scrollTop = 0;
  if(k === 'crop' || was === 'crop') zoomReset();
  if(was === 'crop' && ed) commit();
  hover = null;
  if(k === 'presets') schedulePresetThumbs();
  if(k === 'curve') requestAnimationFrame(drawCurve);
  if(ed){ syncAll(); requestAnimationFrame(() => { layout(); requestRender(); }); }
}

/* compare */
const cmp = $('#compareBtn');
const setOrig = v => { if(showOrig === v || !ed) return; showOrig = v; $('#origBadge').hidden = !v; cmp.classList.toggle('on', v); requestRender(); };
cmp.addEventListener('pointerdown', e => { e.preventDefault(); setOrig(true); cmp.setPointerCapture(e.pointerId); });
['pointerup','pointercancel','lostpointercapture'].forEach(ev => cmp.addEventListener(ev, () => setOrig(false)));
cmp.addEventListener('contextmenu', e => e.preventDefault());

/* menu */
$('#moreBtn').onclick = e => { e.stopPropagation(); const m = $('#menu'); m.hidden = !m.hidden; m.querySelector('[data-act=paste]').disabled = !clipboard; const i = photos.indexOf(cur); m.querySelector('[data-act=prev]').disabled = i <= 0; m.querySelector('[data-act=next]').disabled = i >= photos.length-1; };
document.addEventListener('pointerdown', e => { const m = $('#menu'); if(!m.hidden && !m.contains(e.target) && e.target.closest('#moreBtn') === null) m.hidden = true; });
$('#menu').onclick = async e => {
  const a = e.target.dataset.act; if(!a) return; $('#menu').hidden = true;
  if(a === 'prev') step(-1); if(a === 'next') step(1);
  if(a === 'copy') copyDlg();
  if(a === 'paste' && clipboard){ E.applyGroups(ed, clipboard.data); commit(); syncAll(); requestRender(); toast('Instellingen geplakt'); }
  if(a === 'layers'){
    toast('Openen in Bewerken…', 0);
    await leavePhoto();
    const rec = cur, c = await renderPhoto(rec, window.innerWidth >= 900 ? 4096 : 3072);
    cur = null; ed = null; free(prevBmp); prevBmp = null;
    await BW.newFromCanvas(c, rec.name); toast('Geopend als document met lagen. Je originele foto blijft ongewijzigd.', 3500);
    return;
  }
  if(a === 'reset'){ ed = E.defaultEdit(); activeMask = -1; commit(); syncAll(); requestRender(); toast('Alle bewerkingen hersteld. Ongedaan maken kan nog.'); }
};
function copyDlg(){
  dialog((card, close) => {
    card.append(el('<h2>Instellingen kopiëren</h2>'), el('<p class="hint">Plak ze daarna op een andere foto via ⋯ → Plakken, of op meerdere foto’s tegelijk vanuit de bibliotheek.</p>'));
    const checks = groupChecks(['licht','kleur','hsl','grade','curve','effecten','detail','text']); card.append(checks);
    const a = el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn primary">Kopiëren</button></div>');
    a.children[0].onclick = close;
    a.children[1].onclick = async () => { const gs = checks.values(); if(!gs.length) return; clipboard = {data:E.pickGroups(ed, gs)}; await store.setMeta('clipboard', clipboard); close(); toast('Instellingen gekopieerd'); };
    card.append(a);
  });
}

/* ================= export ================= */
async function renderPhoto(rec, maxLong){
  const e = rec === cur && ed ? E.clone(ed) : E.normalizeEdit(E.clone(rec.edit || E.defaultEdit()));
  let bmp; try { bmp = await decode(await store.getOriginal(rec.id)); } catch(_){ bmp = await decode(await store.getPreview(rec.id)); }
  const c = await E.renderToCanvas(getWR(), bmp, e, maxLong || Infinity); free(bmp); return c;
}
async function exportRecord(rec, opts){
  if(rec.layers){
    let c = await BW.flattenRecord(rec);
    if(opts.fmt === 'jpeg'){ const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height); x.drawImage(c, 0, 0); c = t; }
    if(opts.size && Math.max(c.width, c.height) > opts.size) c = scaleCanvas(c, opts.size);
    const blob = await toBlob(c, 'image/' + opts.fmt, opts.q), ext = opts.fmt === 'jpeg' ? 'jpg' : opts.fmt;
    return new File([blob], ((opts.name || rec.name).replace(/[\\/:*?"<>|]/g, '-')) + '.' + ext, {type:blob.type});
  }
  const e = rec === cur && ed ? E.clone(ed) : E.normalizeEdit(E.clone(rec.edit || E.defaultEdit()));
  let bmp;
  try { bmp = await decode(await store.getOriginal(rec.id)); } catch(_){ bmp = await decode(await store.getPreview(rec.id)); }
  const c = await E.renderToCanvas(getWR(), bmp, e, opts.size || Infinity); free(bmp);
  const blob = await toBlob(c, 'image/' + opts.fmt, opts.q);
  const ext = opts.fmt === 'jpeg' ? 'jpg' : opts.fmt;
  const nm = ((opts.name || rec.name + '-bewerkt').replace(/[\\/:*?"<>|]/g, '-')) + '.' + ext;
  c.width = c.height = 1;
  presetThumbsDirty = true; orientedKeyWR = '';
  return new File([blob], nm, {type:blob.type});
}
let orientedKeyWR = '';
function saveOrShare(files){
  dialog((card, close) => {
    const mb = (files.reduce((s, f) => s + f.size, 0)/1048576).toFixed(1);
    card.append(el(`<h2>Klaar om op te slaan</h2>`), el(`<p class="hint">${files.length} bestand${files.length === 1 ? '' : 'en'}, ${mb} MB.</p>`));
    const acts = el('<div class="dactions"></div>');
    const saveB = el('<button class="btn">Opslaan op apparaat</button>'), shareB = el('<button class="btn primary">Delen…</button>'), doneB = el('<button class="btn">Sluiten</button>');
    saveB.onclick = async () => { for(const f of files){ download(f); await new Promise(r => setTimeout(r, 350)); } toast(files.length === 1 ? 'Opgeslagen in je downloads' : `${files.length} bestanden opgeslagen in je downloads`); close(); };
    shareB.onclick = async () => { try { await navigator.share({files}); close(); } catch(err){ if(err.name !== 'AbortError') toast('Delen is niet gelukt. Kies Opslaan op apparaat.'); } };
    doneB.onclick = close;
    acts.append(doneB, saveB); if(navigator.canShare && navigator.canShare({files})) acts.append(shareB); else saveB.classList.add('primary');
    card.append(acts);
  });
}
function download(file){ const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function openExport(recs){
  const single = recs.length === 1, rec = recs[0];
  dialog((card, close) => {
    card.append(el(`<h2>${single ? 'Foto exporteren' : `${recs.length} foto’s exporteren`}</h2>`));
    const fmt = el('<div class="field"><label for="eFmt">Formaat</label><select id="eFmt"><option value="jpeg">JPG – kleinste bestand</option><option value="png">PNG – zonder kwaliteitsverlies</option><option value="webp">WebP – voor websites</option></select></div>');
    const q = {v:92}; const qs = slider({label:'Kwaliteit', min:50, max:100, get:() => q.v, set:v => q.v = v, fmt:v => v + '%', def:92, noCommit:true, onInput:() => {}});
    syncers.pop(); qs._sync();
    const size = el('<div class="field"><label for="eSize">Afmeting</label><select id="eSize"><option value="0">Volledige grootte</option><option value="2048">Groot (2048 px)</option><option value="1440">Instagram/Facebook (1440 px)</option><option value="1080">Klein (1080 px)</option></select><span class="info" id="eDims"></span></div>');
    const name = el('<div class="field"><label for="eName">Bestandsnaam</label><input type="text" id="eName"></div>');
    name.querySelector('input').value = rec.name + '-bewerkt';
    const prog = el('<div class="progress" hidden><span></span></div>');
    const status = el('<p class="hint" hidden></p>');
    const acts = el('<div class="dactions"><button class="btn">Annuleren</button><button class="btn primary">Exporteren</button></div>');
    card.append(fmt, qs, size); if(single) card.append(name); card.append(prog, status, acts);
    const upd = () => {
      qs.hidden = fmt.querySelector('select').value === 'png';
      if(single && rec.layers){ size.querySelector('.info').textContent = `${rec.w} × ${rec.h} px`; }
      else if(single){ const e = rec === cur ? ed : E.normalizeEdit(E.clone(rec.edit || E.defaultEdit())); const [W, H] = E.orientedSize(rec.w, rec.h, e.geo); let w = W*e.geo.crop.w, h = H*e.geo.crop.h; const m = +size.querySelector('select').value; if(m){ const s = Math.min(1, m/Math.max(w, h)); w *= s; h *= s; } size.querySelector('.info').textContent = `${Math.round(w)} × ${Math.round(h)} px`; }
    };
    fmt.querySelector('select').onchange = upd; size.querySelector('select').onchange = upd; upd();
    acts.children[0].onclick = close;
    acts.children[1].onclick = async () => {
      const opts = {fmt:fmt.querySelector('select').value, q:q.v/100, size:+size.querySelector('select').value, name:single ? name.querySelector('input').value.trim() : null};
      acts.children[1].disabled = true; $('#dlg').dataset.busy = '1'; prog.hidden = false; status.hidden = false;
      const files = [];
      try {
        if(cur) await saveNow();
        for(let i = 0; i < recs.length; i++){
          status.textContent = `Bezig met ${i+1} van ${recs.length}…`; prog.firstElementChild.style.width = (i/recs.length*100) + '%';
          await new Promise(r => setTimeout(r, 20));
          files.push(await exportRecord(recs[i], opts));
        }
        prog.firstElementChild.style.width = '100%';
      } catch(err){ status.textContent = 'Exporteren is niet gelukt. Probeer een kleinere afmeting.'; delete $('#dlg').dataset.busy; acts.children[1].disabled = false; return; }
      delete $('#dlg').dataset.busy;
      if(ed) { orientedKey = ''; requestRender(); }
      const canShare = navigator.canShare && navigator.canShare({files});
      const mb = (files.reduce((s, f) => s + f.size, 0)/1048576).toFixed(1);
      status.textContent = `Klaar: ${files.length} bestand${files.length === 1 ? '' : 'en'}, ${mb} MB.`;
      acts.innerHTML = '';
      const saveB = el('<button class="btn">Opslaan op apparaat</button>'), shareB = el('<button class="btn primary">Delen…</button>'), doneB = el('<button class="btn">Sluiten</button>');
      saveB.onclick = async () => { for(const f of files){ download(f); await new Promise(r => setTimeout(r, 350)); } toast(files.length === 1 ? 'Opgeslagen in je downloads' : `${files.length} foto’s opgeslagen in je downloads`); close(); };
      shareB.onclick = async () => { try { await navigator.share({files}); close(); } catch(err){ if(err.name !== 'AbortError') toast('Delen is niet gelukt. Kies Opslaan op apparaat.'); } };
      doneB.onclick = close;
      acts.append(doneB, saveB); if(canShare) acts.append(shareB); else saveB.classList.add('primary');
    };
  });
}
$('#exportBtn').onclick = () => { if(cur) openExport([cur]); };

/* ================= library actions ================= */
const fileIn = $('#fileIn');
$('#importBtn').onclick = e => { e.stopPropagation(); const m = $('#addMenu'); m.hidden = !m.hidden; };
document.addEventListener('pointerdown', e => { const m = $('#addMenu'); if(!m.hidden && !m.contains(e.target) && !e.target.closest('#importBtn')) m.hidden = true; });
$('#addMenu').onclick = e => { const a = e.target.dataset.add; if(!a) return; $('#addMenu').hidden = true;
  if(a === 'photos') fileIn.click();
  if(a === 'blank') BW.newBlankDlg();
  if(a === 'sample') $('#sampleBtn').click(); };
$('#emptyImport').onclick = () => fileIn.click();
fileIn.onchange = async () => { const f = [...fileIn.files]; fileIn.value = ''; const done = await importFiles(f); if(done.length === 1) openEditor(done[0].id); };
$('#sampleBtn').onclick = async () => { const b = await toBlob(makeSample(), 'image/jpeg', .93); const rec = await importOne(b, 'voorbeeldfoto'); await loadLibrary(); openEditor(rec.id); };
$('#selectBtn').onclick = () => setSelecting(!selecting);
$('#selDone').onclick = () => setSelecting(false);
$('#selAll').onclick = () => { if(selected.size === photos.length) selected.clear(); else photos.forEach(p => selected.add(p.id)); renderGrid(); };
$('#selDelete').onclick = async () => {
  const n = selected.size;
  if(!await confirmDlg(`${n} foto${n === 1 ? '' : "'s"} verwijderen?`, 'Ze worden uit Lichtbak verwijderd, samen met de bewerkingen. Dit kan niet ongedaan worden gemaakt. De originelen in je galerij of op je pc blijven gewoon bestaan.', 'Verwijderen')) return;
  for(const id of selected){ if(docs.some(d => d.id === id)) await store.deleteDoc(id); else await store.deletePhoto(id); const u = thumbUrls.get(id); if(u){ URL.revokeObjectURL(u.url); thumbUrls.delete(id); } }
  selected.clear(); setSelecting(false); await loadLibrary(); toast(`${n} verwijderd`);
};
$('#selExport').onclick = () => openExport([...photos, ...docs].filter(p => selected.has(p.id)));
$('#selPaste').onclick = () => { if(clipboard) batchApply(clipboard.data, 'Instellingen geplakt'); };
$('#selPreset').onclick = () => dialog((card, close) => {
  card.append(el(`<h2>Preset toepassen op ${selected.size} foto${selected.size === 1 ? '' : "'s"}</h2>`));
  const l = el('<div class="plist"></div>');
  allPresets().forEach(pr => { const b = el('<button></button>'); b.textContent = pr.name + (pr.builtin ? '' : '  ·  eigen'); b.onclick = () => { close(); batchApply(pr.data, `“${pr.name}” toegepast`); }; l.append(b); });
  const a = el('<div class="dactions"><button class="btn">Annuleren</button></div>'); a.firstElementChild.onclick = close;
  card.append(l, a);
});
async function batchApply(part, msg){
  const recs = photos.filter(p => selected.has(p.id)); let i = 0;
  if(!recs.length){ toast('Presets en instellingen werken op foto\'s, niet op documenten met lagen.'); return; }
  for(const rec of recs){
    toast(`Bezig… ${++i} van ${recs.length}`, 0);
    const e = E.normalizeEdit(E.clone(rec.edit || E.defaultEdit())); E.applyGroups(e, part); rec.edit = e;
    try { const bmp = await decode(await store.getPreview(rec.id)); const c = await E.renderToCanvas(getWR(), bmp, e, 900); free(bmp); rec.thumb = await toBlob(scaleCanvas(c, 480), 'image/jpeg', .85); } catch(_){}
    await store.putPhoto(rec);
  }
  presetThumbsDirty = true;
  setSelecting(false); await loadLibrary(); toast(`${msg} op ${recs.length} foto${recs.length === 1 ? '' : "'s"}`);
}

/* drag & drop + plakken */
let dd = 0;
window.addEventListener('dragenter', e => { if([...(e.dataTransfer?.types || [])].includes('Files')){ dd++; if(!$('#library').hidden) $('#dropzone').hidden = false; } });
window.addEventListener('dragleave', () => { if(--dd <= 0){ dd = 0; $('#dropzone').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => { e.preventDefault(); dd = 0; $('#dropzone').hidden = true; const f = e.dataTransfer?.files; if(f && f.length){ if(cur) await closeEditor(); importFiles(f); } });
window.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].filter(x => x.type.startsWith('image/')); if(f.length && $('#editor').hidden){ e.preventDefault(); importFiles(f); } });

/* toetsenbord */
window.addEventListener('keydown', e => {
  if($('#editor').hidden) return;
  const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  if(typing) return;
  const mod = e.ctrlKey || e.metaKey;
  if(mod && e.key.toLowerCase() === 'z'){ e.preventDefault(); e.shiftKey ? $('#redoBtn').click() : $('#undoBtn').click(); }
  else if(mod && e.key.toLowerCase() === 'y'){ e.preventDefault(); $('#redoBtn').click(); }
  else if(e.key === '\\') setOrig(true);
  else if(e.key === 'ArrowLeft' && !mod && document.activeElement?.type !== 'range') step(-1);
  else if(e.key === 'ArrowRight' && !mod && document.activeElement?.type !== 'range') step(1);
  else if(e.key === 'Escape'){ if(!$('#dlg').hidden) $('#dlg').hidden = true; else if(!$('#menu').hidden) $('#menu').hidden = true; }
});
window.addEventListener('keyup', e => { if(e.key === '\\') setOrig(false); });

/* installeren */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if(!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('#installBtn').hidden = true; };
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Lichtbak staat nu tussen je apps'); });

/* foto's die via 'Delen' vanuit de galerij binnenkomen */
async function checkInbox(){
  if(!('caches' in window)) return;
  try {
    const c = await caches.open('lichtbak-inbox'), keys = await c.keys(); if(!keys.length) return;
    const files = [];
    for(const k of keys){ const r = await c.match(k); const b = await r.blob(); files.push(new File([b], decodeURIComponent(r.headers.get('x-name') || 'gedeeld.jpg'), {type:b.type || 'image/jpeg'})); await c.delete(k); }
    const done = await importFiles(files);
    if(done.length === 1) openEditor(done[0].id);
  } catch(_){}
  if(location.search) history.replaceState(null, '', location.pathname);
}

/* ================= start ================= */
window.addEventListener('lichtbak-blocked', () => toast('Lichtbak is nog open in een ander venster of tabblad met een oudere versie. Sluit alle andere Lichtbak-vensters; daarna gaat het vanzelf verder.', 0));
window.addEventListener('lichtbak-outdated', () => toast('Er is een nieuwere versie van Lichtbak geopend. Sluit dit venster en ga verder in het nieuwe.', 0));
async function init(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { R = new E.Renderer(glc, true); }
  catch(err){
    console.error(err);
    document.body.innerHTML = '<div style="padding:32px;max-width:420px;margin:auto;font:15px/1.5 system-ui;color:#e9ebee"><h2>Deze browser kan Lichtbak niet draaien</h2><p>Lichtbak heeft WebGL 2 nodig. Open de app in een recente versie van Chrome, Edge of Firefox.</p></div>';
    return;
  }
  glc.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('De grafische chip werd even gereset. De foto wordt opnieuw geladen.'); });
  glc.addEventListener('webglcontextrestored', () => { R = new E.Renderer(glc, true); orientedKey = ''; requestRender(); });
  userPresets = (await store.getMeta('presets')) || [];
  if(($('#toast').textContent || '').startsWith('Lichtbak is nog open')) $('#toast').hidden = true;
  clipboard = (await store.getMeta('clipboard')) || null;
  defaultText = (await store.getMeta('defaultText')) || null;
  buildEditorUI();
  BW = setupBewerk({store, E, toast, dialog, confirmDlg, el, uid, toBlob, decode, free, showView,
    reloadLibrary:loadLibrary, saveOrShare, photos:() => photos, thumbURL, renderPhoto,
    importBlob:async (b, name) => { const r = await importOne(b, name); await loadLibrary(); return r; }});
  await loadLibrary();
  await checkInbox();
}
init();
