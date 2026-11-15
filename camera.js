// Lichtbak — camera: zoeker met raster, waterpas, timer, zoom, lamp en live presets
import * as E from './engine.js';

let C = null, stream = null, track = null, facing = 'environment', raf = 0, R = null;
let grid = true, level = true, timer = 0, preset = -1, busy = false, tilt = null, lastShot = null, shots = 0, torchOn = false;
const $ = s => document.querySelector(s);

function presetList(){ return [{name:'Geen', data:null}, ...C.userPresets().map(p => ({name:p.name, data:p.data})), ...E.BUILTIN_PRESETS]; }

async function start(){
  stopStream();
  const st = $('#camState'); st.hidden = false; st.textContent = 'Camera starten…';
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ fail('Deze browser geeft Lichtbak geen toegang tot de camera.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:facing}, width:{ideal:4096}, height:{ideal:3072}}});
  } catch(err){
    if(err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) fail('Lichtbak mag de camera niet gebruiken. Geef toestemming via het slotje of ⓘ naast het adres (of in de app-instellingen van Android) en probeer het opnieuw.');
    else if(err && err.name === 'NotFoundError') fail('Er is geen camera gevonden op dit apparaat.');
    else fail('De camera kon niet worden gestart. Misschien gebruikt een andere app hem al.');
    return;
  }
  track = stream.getVideoTracks()[0];
  const v = $('#camVideo'); v.srcObject = stream; v.muted = true; v.playsInline = true;
  try { await v.play(); } catch(_){}
  st.hidden = true;
  setupCaps(); loop();
}
function fail(msg){ const st = $('#camState'); st.hidden = false; st.innerHTML = ''; st.append(C.el(`<div class="cam-fail"><p></p><div class="row center"><button class="btn" data-x="retry">Opnieuw proberen</button><button class="btn primary" data-x="native">Telefooncamera gebruiken</button></div></div>`)); st.querySelector('p').textContent = msg; st.querySelector('[data-x=retry]').onclick = start; st.querySelector('[data-x=native]').onclick = () => { close(); C.nativeCamera(); }; }
function stopStream(){ cancelAnimationFrame(raf); if(stream) stream.getTracks().forEach(t => t.stop()); stream = null; track = null; torchOn = false; }

function setupCaps(){
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const zb = $('#camZoomBox'), zi = $('#camZoom');
  if(caps.zoom && caps.zoom.max > caps.zoom.min){
    zb.hidden = false; zi.min = caps.zoom.min; zi.max = Math.min(caps.zoom.max, 10); zi.step = caps.zoom.step || .1; zi.value = track.getSettings().zoom || caps.zoom.min; showZoom();
  } else zb.hidden = true;
  const eb = $('#camExpBox'), ei = $('#camExp');
  if(caps.exposureCompensation && caps.exposureCompensation.max > caps.exposureCompensation.min){
    eb.hidden = false; ei.min = caps.exposureCompensation.min; ei.max = caps.exposureCompensation.max; ei.step = caps.exposureCompensation.step || .1; ei.value = 0; $('#camExpOut').textContent = '0';
  } else eb.hidden = true;
  $('#camTorch').hidden = !caps.torch; $('#camTorch').classList.remove('on');
  $('#camFlip').hidden = false;
}
function showZoom(){ $('#camZoomOut').textContent = (+$('#camZoom').value).toFixed(1) + '×'; }

/* zoeker tekenen: met preset via WebGL, anders gewoon de video */
function loop(){
  raf = requestAnimationFrame(loop);
  const v = $('#camVideo'), cv = $('#camLive');
  if(!v.videoWidth) return;
  const p = presetList()[preset + 1];
  const box = $('#camView').getBoundingClientRect(), vw = v.videoWidth, vh = v.videoHeight;
  const s = Math.min(box.width/vw, box.height/vh), w = Math.round(vw*s), h = Math.round(vh*s);
  const fr = $('#camFrame'); fr.style.width = w + 'px'; fr.style.height = h + 'px';
  if(!p || !p.data){ cv.hidden = true; v.style.visibility = 'visible'; drawLevel(); return; }
  cv.hidden = false; v.style.visibility = 'hidden';
  if(!R){ try { R = new E.Renderer(cv, false); } catch(_){ preset = -1; syncPresets(); return; } }
  const k = Math.min(1, 960/Math.max(vw, vh)), ow = Math.round(vw*k), oh = Math.round(vh*k);
  R.setImage(v);
  const e = E.applyGroups(E.defaultEdit(), p.data);
  if(facing === 'user') e.geo.flipH = false;
  R.render(e, {outW:ow, outH:oh, crop:{x:0, y:0, w:1, h:1}});
  drawLevel();
}
function drawLevel(){
  const l = $('#camLevel');
  if(!level || tilt === null){ l.hidden = true; return; }
  l.hidden = false; const a = tilt; l.style.transform = `translate(-50%,-50%) rotate(${-a}deg)`;
  l.classList.toggle('ok', Math.abs(a) < 1);
}
function onOrient(e){
  if(e.gamma === null || e.beta === null){ tilt = null; return; }
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let t;
  if(Math.abs(e.beta) > 55 || ang % 180 !== 0){ t = ang % 180 === 0 ? e.gamma : (ang === 90 ? -e.beta : e.beta); }
  else { tilt = null; return; }
  if(ang === 0 && Math.abs(e.beta) > 55) t = e.gamma*(e.beta > 0 ? 1 : -1);
  tilt = Math.max(-45, Math.min(45, t || 0));
}

/* foto maken */
async function shoot(){
  if(busy || !track) return;
  busy = true;
  if(timer){ for(let i = timer; i > 0; i--){ $('#camCount').hidden = false; $('#camCount').textContent = i; await new Promise(r => setTimeout(r, 1000)); if(!stream){ busy = false; $('#camCount').hidden = true; return; } } $('#camCount').hidden = true; }
  const fl = $('#camFlash'); fl.hidden = false; fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go'); setTimeout(() => fl.hidden = true, 380);
  try {
    let blob = null;
    if('ImageCapture' in window && facing !== 'user'){
      try { const ic = new ImageCapture(track); blob = await ic.takePhoto(); } catch(_){ blob = null; }
    }
    if(!blob){
      const v = $('#camVideo'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      const x = c.getContext('2d'); if(facing === 'user'){ x.translate(c.width, 0); x.scale(-1, 1); } x.drawImage(v, 0, 0);
      blob = await C.toBlob(c, 'image/jpeg', .95);
    }
    const p = presetList()[preset + 1], d = new Date(), pad = n => String(n).padStart(2, '0');
    const name = `Foto ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
    const rec = await C.importPhoto(blob, name, p && p.data ? p.data : null);
    lastShot = rec; shots++;
    const th = $('#camLast'); th.hidden = false; th.querySelector('img').src = C.thumbURL(rec); th.querySelector('span').textContent = shots;
  } catch(err){ C.toast('De foto kon niet worden bewaard.'); }
  busy = false;
}

function syncPresets(){
  const row = $('#camPresets'); row.innerHTML = '';
  presetList().forEach((p, i) => { const b = C.el(`<button class="chip" aria-pressed="${i-1 === preset}"></button>`); b.textContent = p.name; b.onclick = () => { preset = i-1; syncPresets(); }; row.append(b); });
}
function syncToggles(){
  $('#camGrid').classList.toggle('on', grid); $('#camGridLines').hidden = !grid;
  $('#camLevelBtn').classList.toggle('on', level);
  $('#camTimer').textContent = timer ? timer + ' s' : 'Timer';
  $('#camTimer').classList.toggle('on', !!timer);
}

export function open(){
  shots = 0; lastShot = null; $('#camLast').hidden = true;
  C.showView('camera');
  syncPresets(); syncToggles(); start();
  window.addEventListener('deviceorientation', onOrient);
}
export function close(){
  stopStream(); window.removeEventListener('deviceorientation', onOrient); tilt = null;
  if(!$('#camera').hidden){ C.showView('library'); C.reloadLibrary(); }
}

export function setupCamera(ctx){
  C = ctx;
  $('#camShutter').onclick = shoot;
  $('#camClose').onclick = () => history.state && history.state.camera ? history.back() : close();
  $('#camFlip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; $('#camVideo').classList.toggle('mirror', facing === 'user'); $('#camLive').classList.toggle('mirror', facing === 'user'); start(); };
  $('#camGrid').onclick = () => { grid = !grid; syncToggles(); };
  $('#camLevelBtn').onclick = () => { level = !level; syncToggles(); if(level && tilt === null) C.toast('De waterpas werkt alleen op een telefoon of tablet.'); };
  $('#camTimer').onclick = () => { timer = timer === 0 ? 3 : timer === 3 ? 10 : 0; syncToggles(); };
  $('#camTorch').onclick = async () => { if(!track) return; torchOn = !torchOn; try { await track.applyConstraints({advanced:[{torch:torchOn}]}); } catch(_){ torchOn = false; C.toast('De lamp kan niet worden aangezet.'); } $('#camTorch').classList.toggle('on', torchOn); };
  $('#camZoom').oninput = async () => { showZoom(); try { await track.applyConstraints({advanced:[{zoom:+$('#camZoom').value}]}); } catch(_){} };
  $('#camExp').oninput = async () => { const v = +$('#camExp').value; $('#camExpOut').textContent = (v > 0 ? '+' : '') + v.toFixed(1); try { await track.applyConstraints({advanced:[{exposureMode:'continuous', exposureCompensation:v}]}); } catch(_){} };
  $('#camLast').onclick = () => { if(!lastShot) return; const id = lastShot.id; close(); C.openPhoto(id); };
  $('#camNative').onclick = () => { close(); C.nativeCamera(); };
  $('#camView').addEventListener('pointerdown', async e => {
    if(e.target.closest('button,input')) return;
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if(!caps.focusMode || !caps.focusMode.includes('single-shot')) return;
    const r = $('#camFrame').getBoundingClientRect(), x = (e.clientX-r.left)/r.width, y = (e.clientY-r.top)/r.height;
    if(x < 0 || y < 0 || x > 1 || y > 1) return;
    const f = $('#camFocus'); f.hidden = false; f.style.left = (e.clientX - $('#camView').getBoundingClientRect().left) + 'px'; f.style.top = (e.clientY - $('#camView').getBoundingClientRect().top) + 'px'; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    try { await track.applyConstraints({advanced:[{pointsOfInterest:[{x, y}], focusMode:'single-shot'}]}); } catch(_){}
    setTimeout(() => f.hidden = true, 900);
  });
  document.addEventListener('visibilitychange', () => { if($('#camera').hidden) return; if(document.hidden) stopStream(); else start(); });
  window.addEventListener('keydown', e => { if($('#camera').hidden) return; if(e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); shoot(); } if(e.key === 'Escape') $('#camClose').click(); });
  return {open, close, isOpen:() => !$('#camera').hidden};
}
