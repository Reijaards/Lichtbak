// Lichtbak — beeldbewerkingsmotor (WebGL2) en bewerkingsmodel
export const MAX_MASKS = 6;
export const MASK_RES = 512;

export const HSL_COLORS = [
  {name:'Rood', hue:0, col:'#e5484d'},
  {name:'Oranje', hue:30, col:'#f08c2e'},
  {name:'Geel', hue:58, col:'#f2cc3a'},
  {name:'Groen', hue:120, col:'#46a758'},
  {name:'Aqua', hue:180, col:'#3fb8c4'},
  {name:'Blauw', hue:225, col:'#3e7be6'},
  {name:'Paars', hue:275, col:'#8e4ec6'},
  {name:'Magenta', hue:320, col:'#d6409f'},
];

export const GROUPS = [
  ['licht','Licht'], ['kleur','Witbalans & verzadiging'], ['hsl','Kleurmix (HSL)'], ['grade','Kleurgradatie'],
  ['curve','Toncurve'], ['effecten','Effecten'], ['detail','Detail'], ['geo','Bijsnijden & draaien'],
  ['masks','Maskers'], ['text','Tekst & watermerk'],
];
export const PRESET_GROUPS = ['licht','kleur','hsl','grade','curve','effecten','detail'];

const zeros8 = () => [0,0,0,0,0,0,0,0];
const lin = () => [[0,0],[1,1]];
export function defaultEdit(){
  return {
    licht:{exposure:0, contrast:0, highlights:0, shadows:0, whites:0, blacks:0},
    kleur:{temp:0, tint:0, vibrance:0, saturation:0},
    hsl:{h:zeros8(), s:zeros8(), l:zeros8()},
    grade:{shHue:210, shSat:0, hiHue:40, hiSat:0, balance:0},
    curve:{rgb:lin(), r:lin(), g:lin(), b:lin()},
    effecten:{clarity:0, dehaze:0, vignette:0, vigMid:50, grain:0},
    detail:{sharpen:0, noise:0},
    geo:{rot:0, flipH:false, flipV:false, straighten:0, crop:{x:0,y:0,w:1,h:1}, aspect:'free'},
    masks:[],
    text:{content:'', font:0, size:5, color:'#ffffff', opacity:85, shadow:true, bg:false, anchor:'br', x:.5, y:.5},
  };
}
export const clone = o => JSON.parse(JSON.stringify(o));
export function normalizeEdit(e){
  const d = defaultEdit(); if(!e) return d;
  for(const k in d){
    if(e[k] === undefined) e[k] = d[k];
    else if(!Array.isArray(d[k]) && typeof d[k] === 'object') e[k] = {...d[k], ...e[k]};
  }
  return e;
}
export function isEdited(e){
  if(!e) return false;
  const d = defaultEdit(), n = normalizeEdit(clone(e));
  if(!n.text.content.trim()) n.text = d.text;
  return JSON.stringify(n) !== JSON.stringify(d);
}
export function pickGroups(e, groups){ const o = {}; groups.forEach(g => o[g] = clone(e[g])); return o; }
export function applyGroups(e, part){ for(const g in part){ if(e[g] !== undefined) e[g] = clone(part[g]); } return e; }

/* ---------- presets ---------- */
function P(name, groups){ const e = defaultEdit(); for(const g in groups) Object.assign(e[g], groups[g]); return {name, builtin:true, data:pickGroups(e, PRESET_GROUPS)}; }
export const BUILTIN_PRESETS = [
  P('Helder & fris', {licht:{exposure:.2, contrast:15, highlights:-30, shadows:25, whites:10}, kleur:{vibrance:20}, effecten:{clarity:10}}),
  P('Hout & details', {licht:{contrast:10, highlights:-25, shadows:20}, kleur:{vibrance:15, temp:4}, hsl:{h:zeros8(), s:[5,15,10,0,0,0,0,0], l:[0,6,4,0,0,0,0,0]}, effecten:{clarity:22}, detail:{sharpen:30}}),
  P('Warm analoog', {licht:{contrast:-8}, kleur:{temp:18, saturation:-10}, curve:{rgb:[[0,.06],[.5,.52],[1,.96]], r:lin(), g:lin(), b:lin()}, grade:{shHue:200, shSat:12, hiHue:40, hiSat:18}, effecten:{grain:25}}),
  P('Koel & strak', {licht:{contrast:20, highlights:-15}, kleur:{temp:-16, saturation:-8}, effecten:{clarity:15}}),
  P('Gouden uur', {licht:{highlights:-20, shadows:10}, kleur:{temp:28, tint:8, vibrance:20}, grade:{hiHue:38, hiSat:25, shHue:280, shSat:8}}),
  P('Teal & oranje', {licht:{contrast:12}, kleur:{vibrance:10}, hsl:{h:[0,0,0,0,10,-8,0,0], s:[0,15,0,-20,10,10,0,0], l:zeros8()}, grade:{shHue:195, shSat:35, hiHue:35, hiSat:28}}),
  P('Mat film', {kleur:{saturation:-15}, curve:{rgb:[[0,.1],[.25,.24],[.75,.8],[1,.94]], r:lin(), g:lin(), b:lin()}, grade:{shHue:200, shSat:18, hiHue:42, hiSat:14}, effecten:{grain:20}}),
  P('Drama', {licht:{contrast:35, highlights:-50, shadows:20}, kleur:{saturation:-15}, effecten:{clarity:40, dehaze:15, vignette:-30}}),
  P('Zacht portret', {licht:{contrast:-10, highlights:-15, shadows:15}, kleur:{temp:5}, hsl:{h:zeros8(), s:[0,-10,0,0,0,0,0,0], l:[0,10,0,0,0,0,0,0]}, effecten:{clarity:-20}}),
  P('Zwart-wit klassiek', {licht:{contrast:25}, kleur:{saturation:-100}, effecten:{clarity:15, grain:10}}),
  P('Zwart-wit zacht', {licht:{contrast:-15, highlights:-20}, kleur:{saturation:-100}, curve:{rgb:[[0,.08],[1,.95]], r:lin(), g:lin(), b:lin()}}),
];

/* ---------- curves ---------- */
export function curveEval(pts){
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), out = new Float32Array(256);
  const d = [], m = new Array(n).fill(0);
  for(let i=0;i<n-1;i++) d[i] = (ys[i+1]-ys[i]) / Math.max(1e-6, xs[i+1]-xs[i]);
  m[0] = d[0]; m[n-1] = d[n-2];
  for(let i=1;i<n-1;i++) m[i] = d[i-1]*d[i] <= 0 ? 0 : (d[i-1]+d[i])/2;
  for(let i=0;i<n-1;i++){
    if(d[i] === 0){ m[i] = 0; m[i+1] = 0; continue; }
    const a = m[i]/d[i], b = m[i+1]/d[i], s = a*a + b*b;
    if(s > 9){ const t = 3/Math.sqrt(s); m[i] = t*a*d[i]; m[i+1] = t*b*d[i]; }
  }
  let seg = 0;
  for(let k=0;k<256;k++){
    const x = k/255; let y;
    if(x <= xs[0]) y = ys[0];
    else if(x >= xs[n-1]) y = ys[n-1];
    else {
      while(seg < n-2 && x > xs[seg+1]) seg++;
      const h = xs[seg+1]-xs[seg], t = (x-xs[seg])/h, t2 = t*t, t3 = t2*t;
      y = (2*t3-3*t2+1)*ys[seg] + (t3-2*t2+t)*h*m[seg] + (-2*t3+3*t2)*ys[seg+1] + (t3-t2)*h*m[seg+1];
    }
    out[k] = Math.min(1, Math.max(0, y));
  }
  return out;
}
export function lutBytes(curve){
  const M = curveEval(curve.rgb), R = curveEval(curve.r), G = curveEval(curve.g), B = curveEval(curve.b);
  const b = new Uint8Array(256*4);
  for(let k=0;k<256;k++){ const i = Math.round(M[k]*255); b[k*4] = R[i]*255; b[k*4+1] = G[i]*255; b[k*4+2] = B[i]*255; b[k*4+3] = 255; }
  return b;
}
export const isLinear = c => ['rgb','r','g','b'].every(k => c[k].length === 2 && c[k][0][0] === 0 && c[k][0][1] === 0 && c[k][1][0] === 1 && c[k][1][1] === 1);

/* ---------- geometry ---------- */
export function geoKey(g){ return [g.rot, g.flipH, g.flipV, g.straighten].join('|'); }
export function orientedSize(w0, h0, g){ return g.rot % 180 ? [h0, w0] : [w0, h0]; }
export function orient(src, g, scale = 1){
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  if(!g.rot && !g.flipH && !g.flipV && !g.straighten && scale === 1) return src;
  const [W0, H0] = orientedSize(w0, h0, g), W = Math.max(1, Math.round(W0*scale)), H = Math.max(1, Math.round(H0*scale));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  const th = g.straighten*Math.PI/180, cs = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
  const sc = Math.max((W*cs + H*sn)/W, (W*sn + H*cs)/H) * scale;
  x.translate(W/2, H/2); x.rotate(th); x.scale(sc, sc); x.scale(g.flipH?-1:1, g.flipV?-1:1); x.rotate(g.rot*Math.PI/180);
  x.drawImage(src, -w0/2, -h0/2);
  return c;
}
export function cropPx(W, H, cr){
  const sx = Math.round(cr.x*W), sy = Math.round(cr.y*H);
  return [sx, sy, Math.max(1, Math.min(W-sx, Math.round(cr.w*W))), Math.max(1, Math.min(H-sy, Math.round(cr.h*H)))];
}

/* ---------- brush masks ---------- */
const rasterCache = new Map();
export function maskKey(m, aspect){ const last = m.strokes[m.strokes.length-1]; return `${m.id}|${m.feather}|${m.strokes.length}|${last ? last.pts.length : 0}|${aspect.toFixed(3)}`; }
export function rasterBrush(m, aspect){
  const key = maskKey(m, aspect), hit = rasterCache.get(m.id);
  if(hit && hit.key === key) return hit;
  const R = MASK_RES;
  const a = hit?.a || document.createElement('canvas'), b = hit?.b || document.createElement('canvas');
  a.width = a.height = b.width = b.height = R;
  const x = a.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0,0,R,R);
  x.setTransform(R/aspect, 0, 0, R, 0, 0);
  x.lineCap = x.lineJoin = 'round';
  for(const s of m.strokes){
    x.globalAlpha = s.flow ?? 1; x.strokeStyle = x.fillStyle = s.erase ? '#000' : '#fff'; x.lineWidth = s.size;
    const p = s.pts;
    if(p.length <= 2){ x.beginPath(); x.arc(p[0]*aspect, p[1], s.size/2, 0, Math.PI*2); x.fill(); continue; }
    x.beginPath(); x.moveTo(p[0]*aspect, p[1]);
    for(let i=2;i<p.length;i+=2) x.lineTo(p[i]*aspect, p[i+1]);
    x.stroke();
  }
  const y = b.getContext('2d'); y.filter = 'none'; y.clearRect(0,0,R,R);
  const blur = (m.feather ?? 50)/100 * 24;
  if(blur > .3 && 'filter' in y){ y.filter = `blur(${blur}px)`; }
  y.drawImage(a, 0, 0); y.filter = 'none';
  const out = {key, a, b, canvas:b};
  rasterCache.set(m.id, out);
  return out;
}

/* ---------- text / watermark ---------- */
export const FONTS = [
  {name:'Strak', family:'Inter', weight:600},
  {name:'Klassiek', family:'Playfair Display', weight:700},
  {name:'Handschrift', family:'Caveat', weight:700},
  {name:'Poster', family:'Bebas Neue', weight:400},
  {name:'Typemachine', family:'Courier Prime', weight:700},
];
export function loadFont(i){ const f = FONTS[i] || FONTS[0]; return document.fonts ? document.fonts.load(`${f.weight} 40px "${f.family}"`).catch(() => {}) : Promise.resolve(); }
const lum = (r,g,b) => .299*r + .587*g + .114*b;
function isLight(hex){ const n = parseInt(hex.slice(1),16); return lum(n>>16, (n>>8)&255, n&255) > 140; }
function roundRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
export function drawText(ctx, w, h, t){
  if(!t.content.trim()) return null;
  const F = FONTS[t.font] || FONTS[0], px = t.size/100*Math.min(w,h);
  ctx.save();
  ctx.font = `${F.weight} ${px}px "${F.family}", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const lines = t.content.split('\n'), lh = px*1.2;
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width)), th = lines.length*lh, m = .04*Math.min(w,h);
  let cx, cy, align = 'center';
  if(t.anchor === 'custom'){ cx = t.x*w; cy = t.y*h; }
  else {
    const row = t.anchor[0], col = t.anchor[1];
    cx = col === 'l' ? m+tw/2 : col === 'r' ? w-m-tw/2 : w/2;
    cy = row === 't' ? m+th/2 : row === 'b' ? h-m-th/2 : h/2;
    align = col === 'l' ? 'left' : col === 'r' ? 'right' : 'center';
  }
  ctx.globalAlpha = t.opacity/100;
  if(t.bg){ const p = px*.35; ctx.fillStyle = isLight(t.color) ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.6)'; roundRect(ctx, cx-tw/2-p, cy-th/2-p*.6, tw+2*p, th+p*1.2, p*.6); ctx.fill(); }
  if(t.shadow){ ctx.shadowColor = isLight(t.color) ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.5)'; ctx.shadowBlur = px*.18; ctx.shadowOffsetY = px*.04; }
  ctx.fillStyle = t.color; ctx.textAlign = align;
  const lx = align === 'left' ? cx-tw/2 : align === 'right' ? cx+tw/2 : cx;
  lines.forEach((l,i) => ctx.fillText(l, lx, cy - th/2 + lh*(i+.5)));
  ctx.restore();
  return {cx:cx/w, cy:cy/h, w:tw/w, h:th/h};
}

/* ---------- WebGL renderer ---------- */
const VS = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  vUv = vec2(p.x*.5+.5, .5-p.y*.5);
  gl_Position = vec4(p, 0., 1.);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv; out vec4 o;
uniform sampler2D uImg, uBlur, uLut; uniform sampler2DArray uMasks;
uniform vec4 uCrop; uniform vec2 uTexel; uniform float uAspect, uOutAspect;
uniform float uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks;
uniform float uTemp, uTint, uVibrance, uSaturation;
uniform int uHslOn; uniform float uHslH[8], uHslS[8], uHslL[8], uHueC[8];
uniform vec3 uShTint, uHiTint; uniform float uShSat, uHiSat, uBalance;
uniform float uClarity, uDehaze, uVignette, uVigMid, uGrain, uSharpen, uNoise;
uniform int uMaskCount; uniform int uMaskType[6]; uniform vec4 uMaskA[6], uMaskB[6], uMaskAdj1[6], uMaskAdj2[6];
uniform int uShowMask, uRaw;
const vec3 W = vec3(.2126, .7152, .0722);

vec3 rgb2hsl(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx+mn)*.5, d = mx-mn, h = 0., s = 0.;
  if(d > 1e-5){
    s = l > .5 ? d/(2.-mx-mn) : d/(mx+mn);
    if(mx == c.r) h = (c.g-c.b)/d + (c.g < c.b ? 6. : 0.);
    else if(mx == c.g) h = (c.b-c.r)/d + 2.;
    else h = (c.r-c.g)/d + 4.;
    h /= 6.;
  }
  return vec3(h, s, l);
}
float hue2(float p, float q, float t){ t = fract(t); if(t < 1./6.) return p+(q-p)*6.*t; if(t < .5) return q; if(t < 2./3.) return p+(q-p)*(2./3.-t)*6.; return p; }
vec3 hsl2rgb(vec3 h){ if(h.y <= 0.) return vec3(h.z); float q = h.z < .5 ? h.z*(1.+h.y) : h.z+h.y-h.z*h.y, p = 2.*h.z-q; return vec3(hue2(p,q,h.x+1./3.), hue2(p,q,h.x), hue2(p,q,h.x-1./3.)); }
vec3 wbMul(float t, float n){ vec3 m = vec3(1.+.32*t, 1.+.02*t, 1.-.32*t) * vec3(1.+.12*n, 1.-.18*n, 1.+.12*n); return m / dot(m, W); }
float toneY(float y, float hi, float sh, float wh, float bl){
  float y0 = clamp(y, 0., 1.);
  y += sh*.35*(4.*y0*(1.-y0)*(1.-y0))/.593;
  y += hi*.35*(4.*y0*y0*(1.-y0))/.593;
  y += wh*.25*smoothstep(.45, 1., y0);
  y += bl*.18*(1.-smoothstep(0., .55, y0));
  return y;
}
vec3 applyY(vec3 c, float y, float y2){ return y > .02 ? c*(y2/y) : c + (y2-y); }
vec3 contrastF(vec3 c, float k){ c = clamp(c, 0., 1.); if(k >= 0.) return mix(c, c*c*(3.-2.*c), k); return (c-.45)*(1.+k*.6)+.45; }
float maskW(int i, vec2 p){
  int t = uMaskType[i]; vec4 A = uMaskA[i], B = uMaskB[i]; float w = 0.;
  if(t == 0){ vec2 s = vec2(uAspect, 1.), a = A.xy*s, b = A.zw*s, q = p*s, d = b-a; float tt = dot(q-a, d)/max(dot(d,d), 1e-6); w = 1.-smoothstep(0., 1., tt); }
  else if(t == 1){ float d = length((p-A.xy)/max(A.zw, vec2(1e-4))); float f = clamp(B.x, .001, 1.); w = 1.-smoothstep(1.-f, 1., d); }
  else { w = texture(uMasks, vec3(p, float(i))).r; }
  if(B.y > .5) w = 1.-w;
  return clamp(w, 0., 1.);
}
float hash(vec2 g){ return fract(sin(dot(g, vec2(12.9898, 78.233)))*43758.5453); }
vec3 lut(vec3 c){ c = clamp(c, 0., 1.)*(255./256.) + .5/256.; return vec3(texture(uLut, vec2(c.r,.5)).r, texture(uLut, vec2(c.g,.5)).g, texture(uLut, vec2(c.b,.5)).b); }

void main(){
  vec2 p = uCrop.xy + vUv*uCrop.zw;
  vec3 c = texture(uImg, p).rgb;
  if(uRaw == 1){ o = vec4(c, 1.); return; }
  if(uNoise > 0.){
    vec3 acc = c; float ws = 1., sig = .015 + .1*uNoise; vec2 t = uTexel*1.5;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      if(i==0 && j==0) continue;
      vec3 s = texture(uImg, p + vec2(float(i), float(j))*t).rgb; vec3 d = s-c;
      float w = exp(-dot(d,d)/(sig*sig)); acc += s*w; ws += w;
    }
    c = mix(c, acc/ws, min(1., uNoise*1.2));
  }
  if(uSharpen > 0.){
    vec3 b = (texture(uImg, p+vec2(uTexel.x,0.)).rgb + texture(uImg, p-vec2(uTexel.x,0.)).rgb + texture(uImg, p+vec2(0.,uTexel.y)).rgb + texture(uImg, p-vec2(0.,uTexel.y)).rgb)*.25;
    c += (c-b)*uSharpen*2.;
  }
  float y0 = dot(clamp(c,0.,1.), W);
  float by = dot(texture(uBlur, p).rgb, W);
  vec3 L = pow(max(c, 0.), vec3(2.2)) * wbMul(uTemp, uTint) * exp2(uExposure);
  c = pow(L, vec3(1./2.2));
  float y = dot(c, W); c = applyY(c, y, toneY(y, uHighlights, uShadows, uWhites, uBlacks));
  c = contrastF(c, uContrast);
  if(uClarity != 0.){ float yy = dot(clamp(c,0.,1.), W); float m = 1.-pow(abs(yy*2.-1.), 2.); c += (y0-by)*uClarity*1.4*m; }
  if(uDehaze > 0.){ float a = uDehaze*.09; c = (c - a*by)/(1.-a); c = contrastF(c, uDehaze*.25); float yy = dot(c, W); c = yy + (c-yy)*(1.+uDehaze*.25); }
  else if(uDehaze < 0.){ c = mix(c, vec3(.78), -uDehaze*.45); }
  c = lut(c);
  if(uHslOn == 1){
    vec3 h = rgb2hsl(c); float hh = h.x*360., dh = 0., ds = 0., dl = 0.;
    for(int i=0;i<8;i++){
      float ci = uHueC[i], pv = uHueC[(i+7)%8], nx = uHueC[(i+1)%8];
      float d = mod(hh - ci + 540., 360.) - 180., wt;
      if(d >= 0.) wt = 1. - d/mod(nx-ci+360., 360.); else wt = 1. + d/mod(ci-pv+360., 360.);
      wt = clamp(wt, 0., 1.); dh += wt*uHslH[i]; ds += wt*uHslS[i]; dl += wt*uHslL[i];
    }
    float f = smoothstep(.03, .25, h.y);
    h.x = fract(h.x + dh*f*(30./360.) + 1.);
    h.y = clamp(h.y*(1.+ds*f), 0., 1.);
    h.z = clamp(h.z + dl*f*.22*(1.-abs(h.z*2.-1.)), 0., 1.);
    c = hsl2rgb(h);
  }
  if(uShSat > 0. || uHiSat > 0.){
    float yy = dot(c, W);
    float ws = 1.-smoothstep(0., .55+uBalance*.3, yy), wh = smoothstep(.45+uBalance*.3, 1., yy);
    c += (uShTint-dot(uShTint,W))*uShSat*ws*.45 + (uHiTint-dot(uHiTint,W))*uHiSat*wh*.45;
  }
  { float yy = dot(c, W), mx = max(c.r,max(c.g,c.b)), mn = min(c.r,min(c.g,c.b));
    float s = (1.+uSaturation)*(1.+uVibrance*(1.-clamp((mx-mn)*1.5, 0., 1.)));
    c = yy + (c-yy)*s; }
  for(int i=0;i<6;i++){
    if(i >= uMaskCount) break;
    float w = maskW(i, p); if(w < .001) continue;
    vec4 a1 = uMaskAdj1[i], a2 = uMaskAdj2[i];
    c *= exp2(a1.x*w/2.2);
    c *= mix(vec3(1.), wbMul(a2.x, a2.y), w);
    float yy = dot(c, W); c = applyY(c, yy, toneY(yy, a1.z*w, a1.w*w, 0., 0.));
    c = mix(c, contrastF(c, a1.y), w);
    yy = dot(c, W); c = yy + (c-yy)*(1.+a2.z*w);
    if(a2.w != 0.){ float m = 1.-pow(abs(clamp(yy,0.,1.)*2.-1.), 2.); c += (y0-by)*a2.w*1.4*m*w; }
  }
  if(uVignette != 0.){
    vec2 q = (vUv-.5)*2.; float d = length(q)/1.4142;
    float inner = mix(.05, .75, uVigMid), f = smoothstep(inner, inner+.55, d);
    if(uVignette < 0.) c *= 1. + uVignette*.85*f; else c += (1.-c)*uVignette*.7*f;
  }
  if(uGrain > 0.){
    vec2 g = vUv*vec2(uOutAspect, 1.)*900.;
    float n = hash(floor(g)) - .5 + (hash(floor(g*.5)+17.) - .5)*.6;
    c += n*uGrain*.16;
  }
  if(uShowMask >= 0){ float w = maskW(uShowMask, p); c = mix(c, vec3(1., .15, .2), w*.5); }
  o = vec4(clamp(c, 0., 1.), 1.);
}`;

function hueRGB(h){ // hue in degrees → rgb at s=1, l=.5
  const f = n => { const k = (n + h/30) % 12; return .5 - .5*Math.max(-1, Math.min(k-3, 9-k, 1)); };
  return [f(0), f(8), f(4)];
}

export class Renderer {
  constructor(canvas, preserve = false){
    const gl = canvas.getContext('webgl2', {premultipliedAlpha:false, preserveDrawingBuffer:preserve, antialias:false, alpha:false});
    if(!gl) throw new Error('webgl2');
    this.gl = gl; this.canvas = canvas; this._l = {}; this.layerKeys = new Array(MAX_MASKS).fill('');
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if(!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p; gl.useProgram(p);
    this.vao = gl.createVertexArray();
    const vd = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), vd[0], vd[1], 8192);
    const tex = (unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    this.tImg = tex(0); this.tBlur = tex(1); this.tLut = tex(2);
    gl.activeTexture(gl.TEXTURE3); this.tMask = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tMask);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, MASK_RES, MASK_RES, MAX_MASKS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u('uImg'), 0); gl.uniform1i(this.u('uBlur'), 1); gl.uniform1i(this.u('uLut'), 2); gl.uniform1i(this.u('uMasks'), 3);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.lutKey = '';
  }
  u(n){ return n in this._l ? this._l[n] : (this._l[n] = this.gl.getUniformLocation(this.prog, n)); }
  setImage(src){
    const gl = this.gl, w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    this.imgW = w; this.imgH = h;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tImg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const bs = 160/Math.max(w,h), bc = document.createElement('canvas'); bc.width = Math.max(2, Math.round(w*bs)); bc.height = Math.max(2, Math.round(h*bs));
    const bx = bc.getContext('2d');
    const mid = document.createElement('canvas'); mid.width = bc.width*3; mid.height = bc.height*3; mid.getContext('2d').drawImage(src, 0, 0, mid.width, mid.height);
    if('filter' in bx) bx.filter = 'blur(2.5px)';
    bx.drawImage(mid, 0, 0, bc.width, bc.height);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tBlur);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bc);
    this.layerKeys.fill('');
  }
  syncLut(curve){
    const key = JSON.stringify(curve); if(key === this.lutKey) return; this.lutKey = key;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tLut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutBytes(curve));
  }
  syncMasks(masks){
    const gl = this.gl, aspect = this.imgW/this.imgH;
    masks.forEach((m, i) => {
      if(m.type !== 'brush') return;
      const r = rasterBrush(m, aspect);
      if(this.layerKeys[i] === r.key) return;
      this.layerKeys[i] = r.key;
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tMask);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, MASK_RES, MASK_RES, 1, gl.RED, gl.UNSIGNED_BYTE, r.canvas);
    });
    for(let i = masks.length; i < MAX_MASKS; i++) this.layerKeys[i] = '';
  }
  render(e, {outW, outH, crop, showMask = -1, raw = false}){
    const gl = this.gl, c = this.canvas;
    if(c.width !== outW) c.width = outW; if(c.height !== outH) c.height = outH;
    gl.viewport(0, 0, outW, outH); gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    this.syncLut(e.curve); this.syncMasks(e.masks);
    const f = (n, v) => gl.uniform1f(this.u(n), v), L = e.licht, K = e.kleur, E = e.effecten, D = e.detail, G = e.grade;
    gl.uniform4f(this.u('uCrop'), crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(this.u('uTexel'), 1/this.imgW, 1/this.imgH);
    f('uAspect', this.imgW/this.imgH); f('uOutAspect', outW/outH);
    f('uExposure', L.exposure); f('uContrast', L.contrast/100); f('uHighlights', L.highlights/100); f('uShadows', L.shadows/100); f('uWhites', L.whites/100); f('uBlacks', L.blacks/100);
    f('uTemp', K.temp/100); f('uTint', K.tint/100); f('uVibrance', K.vibrance/100); f('uSaturation', K.saturation/100);
    const hslOn = [...e.hsl.h, ...e.hsl.s, ...e.hsl.l].some(v => v !== 0);
    gl.uniform1i(this.u('uHslOn'), hslOn ? 1 : 0);
    gl.uniform1fv(this.u('uHslH'), e.hsl.h.map(v => v/100)); gl.uniform1fv(this.u('uHslS'), e.hsl.s.map(v => v/100)); gl.uniform1fv(this.u('uHslL'), e.hsl.l.map(v => v/100));
    gl.uniform1fv(this.u('uHueC'), HSL_COLORS.map(h => h.hue));
    gl.uniform3fv(this.u('uShTint'), hueRGB(G.shHue)); gl.uniform3fv(this.u('uHiTint'), hueRGB(G.hiHue));
    f('uShSat', G.shSat/100); f('uHiSat', G.hiSat/100); f('uBalance', G.balance/100);
    f('uClarity', E.clarity/100); f('uDehaze', E.dehaze/100); f('uVignette', E.vignette/100); f('uVigMid', E.vigMid/100); f('uGrain', E.grain/100);
    f('uSharpen', D.sharpen/100); f('uNoise', D.noise/100);
    const n = Math.min(MAX_MASKS, e.masks.length), T = new Int32Array(6), A = new Float32Array(24), B = new Float32Array(24), J1 = new Float32Array(24), J2 = new Float32Array(24);
    e.masks.slice(0, n).forEach((m, i) => {
      const q = m.p || {}, a = m.adj;
      T[i] = m.type === 'linear' ? 0 : m.type === 'radial' ? 1 : 2;
      if(m.type === 'linear') A.set([q.x1, q.y1, q.x2, q.y2], i*4);
      if(m.type === 'radial') A.set([q.cx, q.cy, q.rx, q.ry], i*4);
      B.set([(m.feather ?? 50)/100, m.invert ? 1 : 0, 0, 0], i*4);
      if(m.hidden){ J1.set([0,0,0,0], i*4); J2.set([0,0,0,0], i*4); return; }
      J1.set([a.exposure, a.contrast/100, a.highlights/100, a.shadows/100], i*4);
      J2.set([a.temp/100, a.tint/100, a.saturation/100, a.clarity/100], i*4);
    });
    gl.uniform1i(this.u('uMaskCount'), n); gl.uniform1iv(this.u('uMaskType'), T);
    gl.uniform4fv(this.u('uMaskA'), A); gl.uniform4fv(this.u('uMaskB'), B); gl.uniform4fv(this.u('uMaskAdj1'), J1); gl.uniform4fv(this.u('uMaskAdj2'), J2);
    gl.uniform1i(this.u('uShowMask'), showMask < n ? showMask : -1); gl.uniform1i(this.u('uRaw'), raw ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tImg);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tBlur);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tLut);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tMask);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export function newMask(type, aspect, n){
  const base = {id:Math.random().toString(36).slice(2,10), type, invert:false, hidden:false, feather:50,
    adj:{exposure:0, contrast:0, highlights:0, shadows:0, temp:0, tint:0, saturation:0, clarity:0}};
  const names = {linear:'Lineair verloop', radial:'Radiaal verloop', brush:'Penseel'};
  base.name = `${names[type]} ${n}`;
  if(type === 'linear') base.p = {x1:.5, y1:.12, x2:.5, y2:.5};
  if(type === 'radial'){ base.p = {cx:.5, cy:.5, rx:.28, ry:.28*aspect}; base.feather = 50; }
  if(type === 'brush'){ base.strokes = []; base.feather = 40; }
  return base;
}

/* Render an edit for a given source bitmap to a 2D canvas (incl. tekst). maxLong = gewenste lange zijde van de uitsnede. */
export async function renderToCanvas(renderer, src, e, maxLong){
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height, g = e.geo;
  const [W0, H0] = orientedSize(w0, h0, g);
  const cropLong = Math.max(g.crop.w*W0, g.crop.h*H0);
  const s = Math.min(1, (maxLong || Infinity)/cropLong, renderer.maxTex/Math.max(W0, H0));
  const oc = orient(src, g, s);
  renderer.setImage(oc);
  const W = oc.width, H = oc.height, [, , sw, sh] = cropPx(W, H, g.crop);
  renderer.render(e, {outW:sw, outH:sh, crop:g.crop});
  const out = document.createElement('canvas'); out.width = sw; out.height = sh;
  const x = out.getContext('2d'); x.drawImage(renderer.canvas, 0, 0);
  if(e.text.content.trim()){ await loadFont(e.text.font); drawText(x, sw, sh, e.text); }
  return out;
}
