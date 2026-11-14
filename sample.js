// Voorbeeldfoto: een zonsondergang bij een meer, getekend op een canvas.
export function makeSample(){
  const W = 1800, H = 1200, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const hz = H*.6;
  let g = x.createLinearGradient(0,0,0,hz);
  g.addColorStop(0,'#1c2a57'); g.addColorStop(.45,'#5b4a82'); g.addColorStop(.75,'#e07a54'); g.addColorStop(1,'#ffd08a');
  x.fillStyle = g; x.fillRect(0,0,W,hz);
  const sx = W*.63, sy = hz-48;
  g = x.createRadialGradient(sx,sy,0,sx,sy,500); g.addColorStop(0,'rgba(255,236,190,.95)'); g.addColorStop(.12,'rgba(255,200,130,.6)'); g.addColorStop(1,'rgba(255,160,90,0)');
  x.fillStyle = g; x.fillRect(0,0,W,hz);
  x.fillStyle = '#fff3d6'; x.beginPath(); x.arc(sx,sy,55,0,Math.PI*2); x.fill();
  for(let i=0;i<14;i++){ x.fillStyle = `rgba(255,${190+i*3},${170+i*4},${.10+.02*(i%3)})`; const cy = 110+i*34+Math.sin(i)*24; x.beginPath(); x.ellipse(240+((i*331)%W), cy, 220+(i%4)*70, 12+(i%3)*5, 0, 0, Math.PI*2); x.fill(); }
  const ridge = (base, amp, col, seed) => { x.fillStyle = col; x.beginPath(); x.moveTo(0,hz);
    for(let px=0;px<=W;px+=6){ const y = base - amp*(.55*Math.sin(px/200+seed)+.3*Math.sin(px/75+seed*2)+.15*Math.sin(px/27+seed*3)); x.lineTo(px,y); }
    x.lineTo(W,hz); x.closePath(); x.fill(); };
  ridge(hz-84,108,'#6b4f7a',1); ridge(hz-36,96,'#463757',4); ridge(hz,72,'#2b2240',7);
  x.save(); x.translate(0,hz*2); x.scale(1,-1); x.globalAlpha = .75; x.drawImage(c,0,0,W,hz,0,0,W,hz); x.restore();
  g = x.createLinearGradient(0,hz,0,H); g.addColorStop(0,'rgba(20,18,40,.25)'); g.addColorStop(1,'rgba(10,10,25,.85)'); x.fillStyle = g; x.fillRect(0,hz,W,H-hz);
  for(let y=hz+4;y<H*.88;y+=6){ x.fillStyle = `rgba(255,220,170,${Math.max(0,.18*(1-(y-hz)/(H*.3)))})`; const len = 36+((y*13)%110); x.fillRect(sx-len/2+Math.sin(y)*14, y, len, 1.8); }
  x.fillStyle = '#0d0b16'; x.beginPath(); x.moveTo(0,H); x.lineTo(0,H*.82);
  for(let px=0;px<=W;px+=10) x.lineTo(px, H*.86 + 26*Math.sin(px/170) + 10*Math.sin(px/44));
  x.lineTo(W,H); x.closePath(); x.fill();
  const tree = (tx, ty, s) => { x.beginPath(); x.moveTo(tx,ty-s); for(let i=0;i<=6;i++){ const yy = ty-s+i*s/6, ww = (i+1)*s*.06; x.lineTo(tx+ww,yy+s/8); x.lineTo(tx+ww*.4,yy+s/8); } x.lineTo(tx+4,ty); x.lineTo(tx-4,ty); for(let i=6;i>=0;i--){ const yy = ty-s+i*s/6, ww = (i+1)*s*.06; x.lineTo(tx-ww*.4,yy+s/8); x.lineTo(tx-ww,yy+s/8); } x.closePath(); x.fill(); };
  [[70,1056,360],[180,1080,290],[275,1068,230],[1656,1080,310],[1740,1092,240]].forEach(t => tree(...t));
  const id = x.getImageData(0,0,W,H), d = id.data; for(let i=0;i<d.length;i+=4){ const n = (Math.random()-.5)*10; d[i]+=n; d[i+1]+=n; d[i+2]+=n; } x.putImageData(id,0,0);
  return c;
}
