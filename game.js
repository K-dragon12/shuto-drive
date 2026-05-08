'use strict';

// ===== DISCORD SDK =====
const DISCORD_CLIENT_ID = '1483544439384440934';
async function initDiscordSdk() {
  if (window.self === window.top) return;
  try {
    const { DiscordSDK } = await import('https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@1/+esm');
    const sdk = new DiscordSDK(DISCORD_CLIENT_ID);
    await sdk.ready();
  } catch(e) {}
}

// ===== POLYFILL =====
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    this.beginPath();this.moveTo(x+r,y);this.lineTo(x+w-r,y);
    this.quadraticCurveTo(x+w,y,x+w,y+r);this.lineTo(x+w,y+h-r);
    this.quadraticCurveTo(x+w,y+h,x+w-r,y+h);this.lineTo(x+r,y+h);
    this.quadraticCurveTo(x,y+h,x,y+h-r);this.lineTo(x,y+r);
    this.quadraticCurveTo(x,y,x+r,y);this.closePath();return this;
  };
}

// ===== CANVAS =====
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
canvas.width = canvas.offsetWidth || 800;
canvas.height = 480;
const W = canvas.width, H = canvas.height;

// ===== 3D ENGINE =====
const HZ = Math.floor(H * 0.38);   // horizon Y
const NEAR_Z  = 500;
const FAR_Z   = 14000;
const ROAD_HW = W * 0.44;           // road half-width at NEAR_Z

const sy  = z => HZ + (H - HZ) * NEAR_Z / Math.max(z, 1);
const sx  = (wx, z) => W / 2 + wx * ROAD_HW * NEAR_Z / Math.max(z, 1);
const rhw = z => ROAD_HW * NEAR_Z / Math.max(z, 1);

let scrollZ = 0;
const LANE_WX = [-1.4, 0, 1.4]; // world-x per lane

// ===== AUDIO =====
let audioCtx=null,engineOsc=null,engineOsc2=null,engineGain=null,engineFilter=null;
function initAudio(){
  if(audioCtx)return;
  try{
    audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    engineGain=audioCtx.createGain(); engineFilter=audioCtx.createBiquadFilter();
    engineOsc=audioCtx.createOscillator(); engineOsc2=audioCtx.createOscillator();
    const g2=audioCtx.createGain(); g2.gain.value=0.25;
    engineOsc.type='sawtooth'; engineOsc.frequency.value=60;
    engineOsc2.type='square';  engineOsc2.frequency.value=120;
    engineFilter.type='bandpass'; engineFilter.frequency.value=400; engineFilter.Q.value=2;
    engineOsc.connect(engineGain); engineOsc2.connect(g2); g2.connect(engineGain);
    engineGain.connect(engineFilter); engineFilter.connect(audioCtx.destination);
    engineGain.gain.value=0; engineOsc.start(); engineOsc2.start();
  }catch(e){}
}
function updateEngineSound(speed,topSpeed,nitroActive){
  if(!audioCtx||!engineOsc)return;
  const t=audioCtx.currentTime, r=speed/Math.max(topSpeed,1);
  engineOsc.frequency.setTargetAtTime((nitroActive?100:55)+r*220,t,0.08);
  engineOsc2.frequency.setTargetAtTime((nitroActive?200:110)+r*440,t,0.08);
  engineGain.gain.setTargetAtTime(state.running?0.06+r*0.04:0,t,0.05);
  engineFilter.frequency.setTargetAtTime(250+r*900+(nitroActive?500:0),t,0.05);
}
function playCrashSound(){
  if(!audioCtx)return;
  try{
    const buf=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*0.45),audioCtx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,0.4)*0.7;
    const src=audioCtx.createBufferSource(); const g=audioCtx.createGain(); g.gain.value=0.45;
    src.buffer=buf; src.connect(g); g.connect(audioCtx.destination); src.start();
  }catch(e){}
}
function playNitroSound(){
  if(!audioCtx)return;
  try{
    const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
    osc.type='sawtooth';
    osc.frequency.setValueAtTime(140,audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(900,audioCtx.currentTime+0.2);
    osc.frequency.linearRampToValueAtTime(450,audioCtx.currentTime+0.55);
    g.gain.setValueAtTime(0,audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.28,audioCtx.currentTime+0.04);
    g.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.6);
    osc.connect(g); g.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime+0.65);
  }catch(e){}
}
function playNearMissSound(){
  if(!audioCtx)return;
  try{
    const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(900,audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(450,audioCtx.currentTime+0.18);
    g.gain.setValueAtTime(0.18,audioCtx.currentTime); g.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.22);
    osc.connect(g); g.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime+0.25);
  }catch(e){}
}

// ===== PERSISTENCE =====
let tuning    = JSON.parse(localStorage.getItem('shuto_tuning') || '{"engine":0,"tire":0,"nitro":0}');
let coins     = parseInt(localStorage.getItem('shuto_coins') || '0');
let leaderboard = JSON.parse(localStorage.getItem('shuto_lb') || '[]');
function savePersist(){
  localStorage.setItem('shuto_tuning',JSON.stringify(tuning));
  localStorage.setItem('shuto_coins',String(coins));
}
function saveScore(s){
  leaderboard.push({car:carDefs[state.carKey].label,score:s,km:state.km.toFixed(1),date:new Date().toLocaleDateString('ja')});
  leaderboard.sort((a,b)=>b.score-a.score); leaderboard=leaderboard.slice(0,10);
  localStorage.setItem('shuto_lb',JSON.stringify(leaderboard));
}

// ===== TUNING =====
const TUNING_COSTS = [20,50,100];
const TUNING_DEFS = {
  engine:{icon:'🔥',name:'エンジン',desc:'最高速度とトルクをアップ',effects:['最高速度+15%','最高速度+30%','最高速度+50%']},
  tire:  {icon:'🔵',name:'タイヤ',  desc:'コーナリングと雨対応力アップ',effects:['スリップ耐性+30%','スリップ耐性+60%','完全グリップ']},
  nitro: {icon:'💨',name:'ニトロタンク',desc:'持続時間とCDを改善',effects:['持続+1s/CD-2s','持続+2s/CD-4s','持続+3s/CD-6s']},
};
function getEffectiveCar(key){
  const base={...carDefs[key]};
  const m=[1.0,1.15,1.30,1.50][tuning.engine];
  return{...base,topSpeed:base.topSpeed*m,accel:base.accel*(1+tuning.engine*0.08)};
}

// ===== NITRO =====
const NITRO_BASE_DUR=180, NITRO_BASE_CD=600;
let nitro={active:false,timer:0,cooldown:0};
const getNitroDur=()=>NITRO_BASE_DUR+tuning.nitro*60;
const getNitroCD =()=>NITRO_BASE_CD-tuning.nitro*120;
function activateNitro(){
  if(!state.running||nitro.active||nitro.cooldown>0||state.km>=14.8)return;
  initAudio(); nitro.active=true; nitro.timer=getNitroDur(); nitro.cooldown=0;
  playNitroSound(); addLog('💨 ニトロ発動！ 爆速加速！','ev');
}
function updateNitroBtn(){
  const btn=document.getElementById('nitro-btn');
  if(nitro.active){btn.classList.add('active');btn.classList.remove('cooldown');btn.textContent='💨 BOOST!';}
  else if(nitro.cooldown>0){btn.classList.remove('active');btn.classList.add('cooldown');btn.textContent='💨 CD '+Math.ceil(nitro.cooldown/60)+'s';}
  else{btn.classList.remove('active','cooldown');btn.textContent='💨 NITRO';}
}

// ===== CAR DEFS (3台) =====
const carDefs = {
  gtr:     {label:'GT-R NISMO R35',    color:'#d8d8d8',body:'#a0a0a8',topSpeed:250,accel:1.7},
  ferrari: {label:'Ferrari F8 Tributo',color:'#cc1111',body:'#880000',topSpeed:330,accel:2.2},
  veneno:  {label:'Lamborghini Veneno',color:'#909090',body:'#555558',topSpeed:355,accel:2.5},
};
const trafficTypes = ['gtr','ferrari','veneno','gtr','gtr','ferrari'];

// ===== GAME STATE =====
let traffic=[], crashes=[], rainParticles=[], score=0;
let state = {running:false,speed:0,km:0,carKey:'gtr',lane:1,targetLane:1,laneX:0,targetLaneX:0,frame:0,fired:new Set(),wet:false,slipX:0,_kmCoins:0};

// ===== STAGES =====
const stages=[
  {name:'C1 都心環状',km:0},
  {name:'湾岸線',    km:5},
  {name:'箱崎JCT',  km:10},
];
function getCurrentStage(){
  let s=stages[0];
  for(let i=stages.length-1;i>=0;i--){if(state.km>=stages[i].km){s=stages[i];break;}}
  return s;
}

// ===== STATIC SCENE ELEMENTS =====
// Building silhouettes for skyline
const bldgs = Array.from({length:28},(_,i)=>({
  x: i*(W/26), w: 18+Math.random()*30,
  h: 15+Math.random()*80,
  floors: Math.floor(3+Math.random()*15),
  lit: Math.random()
}));
// Street lights (world positions)
const streetLights = Array.from({length:30},(_,i)=>({
  z: NEAR_Z + i*(FAR_Z-NEAR_Z)/30,
  side: i%2===0?-1:1
}));
// Road signs (首都高スタイル)
const roadSigns=[
  {z:1500, text:'首都高速 C1'},
  {z:4000, text:'浜崎橋JCT ↗'},
  {z:7000, text:'湾岸線 →'},
  {z:10000,text:'箱崎JCT ↗'},
];

// ===== BACKGROUND: NIGHT SKY =====
function drawNightSky(){
  // Sky gradient
  const grad=ctx.createLinearGradient(0,0,0,HZ);
  grad.addColorStop(0,'#010108');
  grad.addColorStop(0.5,'#030312');
  grad.addColorStop(1,'#060620');
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,HZ+2);

  // Stars
  ctx.fillStyle='rgba(255,255,255,0.7)';
  for(let i=0;i<60;i++){
    const sx2=(Math.sin(i*137.508)*0.5+0.5)*W;
    const sy2=(Math.sin(i*73.11)*0.5+0.5)*HZ*0.85;
    const r=0.5+Math.sin(state.frame*0.03+i)*0.4;
    ctx.beginPath(); ctx.arc(sx2,sy2,r,0,Math.PI*2); ctx.fill();
  }

  // City glow on horizon
  const glow=ctx.createLinearGradient(0,HZ-30,0,HZ);
  glow.addColorStop(0,'rgba(40,60,180,0)');
  glow.addColorStop(1,'rgba(40,60,180,0.18)');
  ctx.fillStyle=glow; ctx.fillRect(0,HZ-30,W,30);

  // Tokyo skyline silhouette
  ctx.fillStyle='#050510';
  const scrollBldg=(scrollZ*0.004)%W;
  bldgs.forEach(b=>{
    const bx=((b.x-scrollBldg)%W+W)%W;
    ctx.fillRect(bx,HZ-b.h,b.w,b.h);
    // Windows
    if(b.lit>0.4){
      for(let fy=0;fy<b.floors;fy++){
        for(let fx=0;fx<Math.floor(b.w/8);fx++){
          if(Math.sin(b.x*0.3+fy*7.3+fx*3.1+state.frame*0.008)>0.1){
            ctx.fillStyle=`rgba(255,230,140,${0.4+Math.random()*0.3})`;
            ctx.fillRect(bx+fx*7+2,HZ-b.h+fy*9+4,4,4);
          }
        }
      }
    }
  });

  // Tokyo Tower silhouette (stage 1 only)
  if(state.km<5){
    const tx=W*0.75+(scrollZ*0.003%80)-40;
    const th=80;
    ctx.fillStyle='#040418';
    ctx.beginPath();
    ctx.moveTo(tx,HZ); ctx.lineTo(tx-18,HZ-th); ctx.lineTo(tx-4,HZ-th);
    ctx.lineTo(tx,HZ-th*1.25); ctx.lineTo(tx+4,HZ-th);
    ctx.lineTo(tx+18,HZ-th); ctx.closePath(); ctx.fill();
    // Tower beacon
    ctx.fillStyle=`rgba(255,80,0,${0.6+Math.sin(state.frame*0.08)*0.4})`;
    ctx.beginPath(); ctx.arc(tx,HZ-th*1.25,3,0,Math.PI*2); ctx.fill();
  }

  // Rainbow Bridge (stage 2)
  if(state.km>=5&&state.km<10){
    const bx=W*0.5, by=HZ*0.3, bw=W*0.4;
    ctx.strokeStyle='rgba(120,160,255,0.5)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(bx-bw/2,HZ); ctx.quadraticCurveTo(bx,by,bx+bw/2,HZ); ctx.stroke();
    // Lights on bridge
    for(let i=0;i<=8;i++){
      const t=i/8; const px=bx-bw/2+bw*t;
      const py=HZ+by*(4*t*(1-t)-1);
      ctx.fillStyle='rgba(200,220,255,0.8)';
      ctx.beginPath(); ctx.arc(px,py,2,0,Math.PI*2); ctx.fill();
    }
  }
}

// ===== ROAD 3D =====
function drawRoad3D(){
  // Road strips (alternating for speed effect)
  const STRIP_Z = 700;
  const TOTAL_Z = 12000;
  const offset = scrollZ % STRIP_Z;

  // Base road fill
  ctx.fillStyle='#141420';
  ctx.beginPath();
  ctx.moveTo(W/2-rhw(FAR_Z),HZ); ctx.lineTo(W/2+rhw(FAR_Z),HZ);
  ctx.lineTo(W/2+ROAD_HW,H);    ctx.lineTo(W/2-ROAD_HW,H);
  ctx.closePath(); ctx.fill();

  // Alternating strips
  for(let z=NEAR_Z; z<TOTAL_Z; z+=STRIP_Z){
    const sz=z+offset;
    const y0=sy(sz), y1=sy(sz+STRIP_Z);
    const hw0=rhw(sz), hw1=rhw(sz+STRIP_Z);
    if(y0<HZ) continue;
    const isAlt=Math.floor(sz/STRIP_Z)%2===0;
    ctx.fillStyle=isAlt?'#1a1a2c':'#161626';
    ctx.beginPath();
    ctx.moveTo(W/2-hw0,y0); ctx.lineTo(W/2+hw0,y0);
    ctx.lineTo(W/2+hw1,Math.max(y1,HZ)); ctx.lineTo(W/2-hw1,Math.max(y1,HZ));
    ctx.closePath(); ctx.fill();
  }

  // Wet road sheen
  if(state.wet){
    const sheen=ctx.createLinearGradient(0,HZ,0,H);
    sheen.addColorStop(0,'rgba(80,120,255,0)');
    sheen.addColorStop(0.5,'rgba(80,120,255,0.06)');
    sheen.addColorStop(1,'rgba(80,120,255,0)');
    ctx.fillStyle=sheen; ctx.fillRect(0,HZ,W,H-HZ);
  }

  // Lane markings (yellow dashes)
  const DASH_Z = 300, GAP_Z = 250, PATTERN = DASH_Z + GAP_Z;
  [-0.47, 0.47].forEach(lx=>{
    for(let z=NEAR_Z; z<FAR_Z; z+=PATTERN){
      const sz=((z-scrollZ%PATTERN)+PATTERN)%FAR_Z+NEAR_Z;
      const z0=sz, z1=sz+DASH_Z;
      const y0=sy(z0), y1=sy(z1);
      const x0=sx(lx,z0), x1=sx(lx,z1);
      if(y0<HZ||y1>H) continue;
      const lw=Math.max(1,rhw(z0)*0.012);
      ctx.strokeStyle='rgba(255,220,50,0.75)'; ctx.lineWidth=lw;
      ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
    }
  });

  // Center divider (double white lines)
  // White solid edge lines
  [-1,1].forEach(side=>{
    ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(sx(side*1.4,NEAR_Z), sy(NEAR_Z));
    ctx.lineTo(sx(side*1.4,FAR_Z),  sy(FAR_Z));
    ctx.stroke();
  });

  // Guardrails
  [-1,1].forEach(side=>{
    const baseX=side*(ROAD_HW+10);
    const topX=sx(side*1.55,FAR_Z);
    const botX=W/2+baseX;
    // Rail top
    ctx.strokeStyle='rgba(180,200,255,0.35)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(topX,HZ+2); ctx.lineTo(botX,H); ctx.stroke();
    // Rail reflection glow
    ctx.strokeStyle='rgba(100,140,255,0.1)'; ctx.lineWidth=8;
    ctx.beginPath(); ctx.moveTo(topX,HZ+2); ctx.lineTo(botX,H); ctx.stroke();
  });
}

// ===== STREET LIGHTS IN 3D =====
function drawStreetLights(){
  const LIGHT_Z_SPACING = (FAR_Z - NEAR_Z) / 18;
  for(let i=0;i<18;i++){
    const rawZ = NEAR_Z + i*LIGHT_Z_SPACING;
    const z = ((rawZ - scrollZ%LIGHT_Z_SPACING + LIGHT_Z_SPACING) % FAR_Z) + NEAR_Z;
    const side = i%2===0 ? -1 : 1;
    const poleX = sx(side*1.65, z);
    const poleY = sy(z);
    const scale = NEAR_Z / Math.max(z,1);
    if(poleY < HZ+5 || poleY > H) continue;

    const poleH = 60*scale;
    const r = 4*scale;

    // Pole
    ctx.strokeStyle='rgba(150,150,180,0.6)'; ctx.lineWidth=Math.max(1,2*scale);
    ctx.beginPath(); ctx.moveTo(poleX,poleY); ctx.lineTo(poleX,poleY-poleH); ctx.stroke();
    // Arm
    ctx.beginPath(); ctx.moveTo(poleX,poleY-poleH); ctx.lineTo(poleX+side*(-15)*scale,poleY-poleH-5*scale); ctx.stroke();
    // Light bulb
    ctx.fillStyle=`rgba(255,220,100,${0.7+Math.sin(state.frame*0.05+i)*0.1})`;
    ctx.beginPath(); ctx.arc(poleX+side*(-15)*scale, poleY-poleH-5*scale, r, 0, Math.PI*2); ctx.fill();
    // Light cone on road
    if(scale>0.05){
      const coneGrad=ctx.createRadialGradient(poleX+side*(-15)*scale,poleY,0,poleX+side*(-15)*scale,poleY,30*scale);
      coneGrad.addColorStop(0,'rgba(255,220,100,0.12)');
      coneGrad.addColorStop(1,'rgba(255,220,100,0)');
      ctx.fillStyle=coneGrad;
      ctx.beginPath(); ctx.arc(poleX+side*(-15)*scale,poleY,30*scale,0,Math.PI*2); ctx.fill();
    }
  }
}

// ===== OVERHEAD SIGNS =====
function drawOverheadSigns(){
  roadSigns.forEach(sign=>{
    const z = sign.z - (scrollZ % (FAR_Z - NEAR_Z));
    if(z < NEAR_Z*0.5 || z > FAR_Z*0.6) return;
    const y = sy(z);
    const scale = NEAR_Z / Math.max(z,1);
    const hw = rhw(z) * 1.3;
    const signH = 22*scale;
    if(y < HZ || signH < 3) return;

    // Sign board
    ctx.fillStyle='rgba(0,80,0,0.9)';
    ctx.beginPath(); ctx.roundRect(W/2-hw, y-signH*2-4*scale, hw*2, signH, 3*scale); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=Math.max(1,scale*1.5);
    ctx.beginPath(); ctx.roundRect(W/2-hw, y-signH*2-4*scale, hw*2, signH, 3*scale); ctx.stroke();
    // Text
    const fontSize=Math.max(6, Math.floor(14*scale));
    ctx.fillStyle='#fff'; ctx.font=`bold ${fontSize}px sans-serif`;
    ctx.textAlign='center';
    ctx.fillText(sign.text, W/2, y-signH*2+signH*0.7-4*scale);
    ctx.textAlign='left';
    // Support poles
    ctx.strokeStyle='rgba(180,180,200,0.5)'; ctx.lineWidth=Math.max(1,2*scale);
    [-1,1].forEach(s=>{
      ctx.beginPath(); ctx.moveTo(sx(s*1.4,z),y); ctx.lineTo(sx(s*1.4,z),y-signH*2-4*scale); ctx.stroke();
    });
  });
}

// ===== RAIN =====
let rainPtcls=[];
function ensureRain(){
  while(rainPtcls.length<150){
    rainPtcls.push({x:Math.random()*W,y:HZ+Math.random()*(H-HZ),len:8+Math.random()*12,spd:12+Math.random()*8,a:0.2+Math.random()*0.5});
  }
}
function drawRain(){
  ensureRain();
  ctx.save();
  rainPtcls.forEach(p=>{
    ctx.strokeStyle=`rgba(180,220,255,${p.a})`; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x-3,p.y+p.len); ctx.stroke();
    p.y+=p.spd*(state.speed/70+0.6); p.x-=2;
    if(p.y>H){p.y=HZ;p.x=Math.random()*W;}
    if(p.x<0)p.x=W+Math.random()*20;
  });
  ctx.restore();
}

// ===== CAR DRAWINGS (REAR VIEW) =====

// GT-R R35 NISMO (rear)
function drawGTR_rear(cx, cy, sc, nitroOn){
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  const w=68, h=28;

  // Body
  ctx.fillStyle='#d0d0d8';
  ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,5); ctx.fill();

  // Roof
  ctx.fillStyle='#b8b8c0';
  ctx.beginPath(); ctx.roundRect(-w/2+8,-h/2-14,w-16,14,4); ctx.fill();

  // NISMO diffuser (black, angular)
  ctx.fillStyle='#111';
  ctx.beginPath(); ctx.roundRect(-w/2,-h/2+h-8,w,10,2); ctx.fill();
  // Diffuser fins
  for(let i=0;i<5;i++){
    ctx.fillStyle='#222';
    ctx.fillRect(-w/2+8+i*10,-h/2+h-7,8,8);
  }

  // GT-R taillights (4 round - 2 each side)
  [[-w/2+5,-h/2+5],[-w/2+5,-h/2+h-12],[w/2-14,-h/2+5],[w/2-14,-h/2+h-12]].forEach(([lx,ly])=>{
    ctx.fillStyle='rgba(255,40,40,0.9)';
    ctx.beginPath(); ctx.arc(lx+4,ly+4,6,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,0,0,0.5)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(lx+4,ly+4,8,0,Math.PI*2); ctx.stroke();
  });

  // Rear wing
  ctx.fillStyle='#1a1a1a';
  ctx.beginPath(); ctx.roundRect(-w/2-6,-h/2-20,w+12,5,2); ctx.fill();
  // Wing supports
  [[-20,-h/2-20],[-20+40,-h/2-20]].forEach(([wx,wy])=>{
    ctx.fillStyle='#222';
    ctx.fillRect(wx,wy,8,20);
  });

  // NISMO red stripe
  ctx.fillStyle='#cc0000';
  ctx.fillRect(-w/2,-h/2+h-9,w,2);

  // Quad exhaust
  [[-22,-h/2+h-1],[-14,-h/2+h-1],[14,-h/2+h-1],[22,-h/2+h-1]].forEach(([ex,ey])=>{
    ctx.fillStyle='#333'; ctx.beginPath(); ctx.arc(ex,ey+3,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#555'; ctx.beginPath(); ctx.arc(ex,ey+3,2.5,0,Math.PI*2); ctx.fill();
  });

  // GT-R badge
  ctx.fillStyle='#fff'; ctx.font='bold 7px sans-serif'; ctx.textAlign='center';
  ctx.fillText('GT-R',0,-h/2+h*0.55);
  ctx.textAlign='left';

  // Wheels
  [-w/2+4, w/2-14].forEach(wx=>{
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(wx+5,h/2+6,9,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#888'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(wx+5,h/2+6,9,0,Math.PI*2); ctx.stroke();
    ctx.strokeStyle='#666'; ctx.lineWidth=1;
    for(let a=0;a<5;a++){
      ctx.beginPath();
      ctx.moveTo(wx+5,h/2+6);
      ctx.lineTo(wx+5+Math.cos(a*Math.PI*0.4)*7,h/2+6+Math.sin(a*Math.PI*0.4)*7);
      ctx.stroke();
    }
    // Brake caliper (red)
    ctx.fillStyle='#cc0000';
    ctx.beginPath(); ctx.arc(wx+5,h/2+6,4,0,Math.PI); ctx.fill();
  });

  if(nitroOn) drawNitroFlameSmall(-w/2-10,0,sc);
  ctx.restore();
}

// Ferrari F8 Tributo (rear)
function drawFerrari_rear(cx, cy, sc, nitroOn){
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  const w=72, h=24;

  // Body - Rosso Corsa
  ctx.fillStyle='#cc1111';
  ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,4); ctx.fill();
  // Body highlight
  ctx.fillStyle='#dd2222';
  ctx.beginPath(); ctx.roundRect(-w/2+6,-h/2,w-12,h*0.4,3); ctx.fill();

  // Roof
  ctx.fillStyle='#990000';
  ctx.beginPath(); ctx.roundRect(-w/2+10,-h/2-12,w-20,12,3); ctx.fill();

  // F8 signature round taillights
  [[-w/2+7,0],[w/2-7,0]].forEach(([lx,ly])=>{
    // Outer ring
    ctx.fillStyle='rgba(200,0,0,0.9)';
    ctx.beginPath(); ctx.arc(lx,ly,10,0,Math.PI*2); ctx.fill();
    // Inner bright
    ctx.fillStyle='rgba(255,100,100,0.9)';
    ctx.beginPath(); ctx.arc(lx,ly,6,0,Math.PI*2); ctx.fill();
    // Cross bars (Ferrari taillight design)
    ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(lx-10,ly); ctx.lineTo(lx+10,ly); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx,ly-10); ctx.lineTo(lx,ly+10); ctx.stroke();
    // Glow
    ctx.strokeStyle='rgba(255,50,50,0.3)'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(lx,ly,12,0,Math.PI*2); ctx.stroke();
  });

  // Rear diffuser
  ctx.fillStyle='#1a0000';
  ctx.beginPath(); ctx.roundRect(-w/2,-h/2+h-7,w,9,2); ctx.fill();

  // Center exhaust (dual)
  ctx.fillStyle='#222';
  [[-8,h/2],[8,h/2]].forEach(([ex,ey])=>{
    ctx.beginPath(); ctx.arc(ex,ey,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#444'; ctx.beginPath(); ctx.arc(ex,ey,3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,120,0,0.3)'; ctx.beginPath(); ctx.arc(ex,ey,2,0,Math.PI*2); ctx.fill();
  });

  // Prancing horse badge
  ctx.fillStyle='#ffd700'; ctx.font='10px sans-serif'; ctx.textAlign='center';
  ctx.fillText('🐎',0,-h/2+h*0.45);
  ctx.textAlign='left';

  // Rear lip spoiler
  ctx.fillStyle='#880000';
  ctx.beginPath(); ctx.roundRect(-w/2-4,-h/2-3,w+8,4,2); ctx.fill();

  // Wheels
  [-w/2+2, w/2-12].forEach(wx=>{
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(wx+5,h/2+7,10,0,Math.PI*2); ctx.fill();
    // Ferrari silver 5-spoke
    ctx.strokeStyle='#aaa'; ctx.lineWidth=2;
    for(let a=0;a<5;a++){
      const angle=a*Math.PI*0.4-Math.PI/2;
      ctx.beginPath(); ctx.moveTo(wx+5,h/2+7); ctx.lineTo(wx+5+Math.cos(angle)*8,h/2+7+Math.sin(angle)*8); ctx.stroke();
    }
    ctx.fillStyle='#cc0000'; ctx.beginPath(); ctx.arc(wx+5,h/2+7,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffd700'; ctx.font='5px sans-serif'; ctx.textAlign='center';
    ctx.fillText('F',wx+5,h/2+9); ctx.textAlign='left';
  });

  if(nitroOn) drawNitroFlameSmall(-w/2-8,0,sc);
  ctx.restore();
}

// Lamborghini Veneno (rear)
function drawVeneno_rear(cx, cy, sc, nitroOn){
  ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc);
  const w=80, h=22;

  // Body - very angular / titanium
  ctx.fillStyle='#6a6a6a';
  ctx.beginPath();
  ctx.moveTo(-w/2, h/2);
  ctx.lineTo(-w/2+4,-h/2);
  ctx.lineTo(-w/2+20,-h/2-6);
  ctx.lineTo(w/2-20,-h/2-6);
  ctx.lineTo(w/2-4,-h/2);
  ctx.lineTo(w/2, h/2);
  ctx.closePath(); ctx.fill();
  // Body highlight
  ctx.fillStyle='#7a7a7a';
  ctx.beginPath();
  ctx.moveTo(-w/2+10,-h/2-2);
  ctx.lineTo(w/2-10,-h/2-2);
  ctx.lineTo(w/2-16,-h/2-7);
  ctx.lineTo(-w/2+16,-h/2-7);
  ctx.closePath(); ctx.fill();

  // Carbon fiber panels
  ctx.fillStyle='#2a2a2a';
  ctx.beginPath(); ctx.roundRect(-w/2+2,-h/2+2,20,h-4,2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(w/2-22,-h/2+2,20,h-4,2); ctx.fill();

  // Massive rear wing
  ctx.fillStyle='#111';
  ctx.beginPath(); ctx.roundRect(-w/2-10,-h/2-28,w+20,6,2); ctx.fill();
  // Wing supports (angular)
  [[-22,-h/2-22],[16,-h/2-22]].forEach(([wx,wy])=>{
    ctx.fillStyle='#333';
    ctx.beginPath();
    ctx.moveTo(wx,wy+22); ctx.lineTo(wx-4,wy); ctx.lineTo(wx+10,wy); ctx.lineTo(wx+8,wy+22);
    ctx.closePath(); ctx.fill();
  });

  // Red accent stripes (signature Veneno feature)
  ctx.fillStyle='#cc0000';
  ctx.fillRect(-w/2,-h/2+h-5,w,3);
  ctx.fillRect(-w/2,-h/2+h-12,w,2);
  // Red on wheel arches
  ctx.beginPath(); ctx.arc(-w/2+14,h/2+2,12,Math.PI,0); ctx.fillStyle='rgba(180,0,0,0.7)'; ctx.fill();
  ctx.beginPath(); ctx.arc(w/2-14,h/2+2,12,Math.PI,0); ctx.fill();

  // Angular taillights (Y-shaped like real Veneno)
  [[-w/2+6,0],[w/2-6,0]].forEach(([lx,ly])=>{
    ctx.strokeStyle='rgba(255,30,30,0.9)'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(lx,ly-8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(lx-6,ly+5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(lx+6,ly+5); ctx.stroke();
    ctx.strokeStyle='rgba(255,50,50,0.3)'; ctx.lineWidth=6;
    ctx.beginPath(); ctx.moveTo(lx,ly-8); ctx.lineTo(lx+6,ly+5); ctx.stroke();
  });

  // Diffuser
  ctx.fillStyle='#0a0a0a';
  ctx.beginPath();
  ctx.moveTo(-w/2,h/2); ctx.lineTo(w/2,h/2);
  ctx.lineTo(w/2-8,h/2+10); ctx.lineTo(-w/2+8,h/2+10);
  ctx.closePath(); ctx.fill();
  // Diffuser fins
  for(let i=0;i<6;i++){
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(-w/2+10+i*9,h/2,7,9);
  }

  // Lamborghini hexagonal exhausts (6)
  for(let i=0;i<6;i++){
    const ex=-w/2+14+i*10;
    ctx.fillStyle='#1a1a1a';
    ctx.beginPath(); ctx.arc(ex,h/2+6,4,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#555'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(ex,h/2+6,4,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(255,100,0,0.2)';
    ctx.beginPath(); ctx.arc(ex,h/2+6,2,0,Math.PI*2); ctx.fill();
  }

  // Rims (red-accent Pirelli)
  [-w/2+2, w/2-16].forEach(wx=>{
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(wx+8,h/2+2,11,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#888'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(wx+8,h/2+2,11,0,Math.PI*2); ctx.stroke();
    // 10-spoke
    for(let a=0;a<10;a++){
      const angle=a*Math.PI*0.2;
      ctx.strokeStyle='#777'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(wx+8,h/2+2); ctx.lineTo(wx+8+Math.cos(angle)*9,h/2+2+Math.sin(angle)*9); ctx.stroke();
    }
    // Red rim accent
    ctx.strokeStyle='#cc0000'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(wx+8,h/2+2,11,0,Math.PI*2); ctx.stroke();
  });

  // Lamborghini badge
  ctx.fillStyle='#ffd700'; ctx.font='8px sans-serif'; ctx.textAlign='center';
  ctx.fillText('𝝀',0,-h/2+h*0.3); ctx.textAlign='left';

  if(nitroOn) drawNitroFlameSmall(-w/2-12,0,sc);
  ctx.restore();
}

function drawNitroFlameSmall(cx, cy, sc){
  ctx.save();
  const fl=25+Math.random()*35;
  ['#fff','#ffee66','#ff9900','#ff4400'].forEach((col,i)=>{
    ctx.fillStyle=col;
    ctx.globalAlpha=0.85-i*0.18;
    ctx.beginPath();
    ctx.ellipse(cx-(i*5+Math.random()*8),cy,fl*(1-i*0.18),4-i*0.7,0,0,Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha=1; ctx.restore();
}

// ===== PLAYER CAR DRAW =====
function drawPlayerCar(){
  const x = W/2 + state.laneX * ROAD_HW / 1.4;
  const y = H - 60;
  const sc = 1.6;
  const nitroOn = nitro.active;
  if(state.carKey==='gtr')     drawGTR_rear(x,y,sc,nitroOn);
  else if(state.carKey==='ferrari') drawFerrari_rear(x,y,sc,nitroOn);
  else if(state.carKey==='veneno')  drawVeneno_rear(x,y,sc,nitroOn);
}

// ===== TRAFFIC 3D =====
// Front-view traffic car (generic approaching car)
function drawTrafficFront(cx, cy, scale, carKey, crashed){
  ctx.save(); ctx.translate(cx, cy); ctx.scale(scale,scale);
  if(crashed) ctx.rotate((Math.random()-0.5)*0.2);
  const w=70, h=30;
  const col  = carDefs[carKey]?.color || '#4488cc';
  const body = carDefs[carKey]?.body  || '#2255aa';

  // Car body
  ctx.fillStyle=body;
  ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,5); ctx.fill();
  ctx.fillStyle=col;
  ctx.beginPath(); ctx.roundRect(-w/2+4,-h/2+4,w-8,h-8,3); ctx.fill();

  // Windshield
  ctx.fillStyle='rgba(150,200,255,0.6)';
  ctx.beginPath(); ctx.roundRect(-w/2+8,-h/2+4,w-16,h/2,3); ctx.fill();

  // Headlights (bright)
  [[-w/2+5,h/2-10],[w/2-14,h/2-10]].forEach(([lx,ly])=>{
    ctx.fillStyle='rgba(255,240,200,0.95)';
    ctx.beginPath(); ctx.ellipse(lx+5,ly+3,7,4,0,0,Math.PI*2); ctx.fill();
    // Headlight glow
    ctx.fillStyle='rgba(255,240,200,0.15)';
    ctx.beginPath(); ctx.ellipse(lx+5,ly+3,16,8,0,0,Math.PI*2); ctx.fill();
  });

  // Grille
  ctx.fillStyle='#111';
  ctx.beginPath(); ctx.roundRect(-w/2+15,h/2-9,w-30,7,2); ctx.fill();
  for(let i=0;i<4;i++){
    ctx.strokeStyle='#333'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-w/2+20+i*7,h/2-9); ctx.lineTo(-w/2+20+i*7,h/2-2); ctx.stroke();
  }

  // Wheels
  [-w/2+4, w/2-14].forEach(wx=>{
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(wx+5,h/2+8,8,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#666'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(wx+5,h/2+8,8,0,Math.PI*2); ctx.stroke();
  });
  ctx.restore();
}

function spawnTraffic(){
  for(let i=0;i<8;i++){
    const lane = Math.floor(Math.random()*3);
    const key  = trafficTypes[Math.floor(Math.random()*trafficTypes.length)];
    traffic.push({
      key, lane, targetLane:lane,
      z: NEAR_Z*2 + i*1400 + Math.random()*800,
      speed: carDefs[key].topSpeed*0.35 + Math.random()*30,
      crashed:false, crashTimer:0, nearMissed:false
    });
  }
}
spawnTraffic();

// ===== CRASH VFX =====
function drawCrashes(){
  crashes=crashes.filter(c=>c.life>0);
  crashes.forEach(c=>{
    c.life--; c.r+=1.2;
    ctx.strokeStyle=`rgba(255,120,0,${c.life/40})`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(c.x,c.y,c.r,0,Math.PI*2); ctx.stroke();
    for(let i=0;i<6;i++){
      const a=c.angle+i*1.05, d=(40-c.life)*1.0;
      ctx.fillStyle=`rgba(255,${80+i*25},0,${c.life/40})`;
      ctx.beginPath(); ctx.arc(c.x+Math.cos(a)*d,c.y+Math.sin(a)*d,3,0,Math.PI*2); ctx.fill();
    }
  });
}

// ===== MINIMAP =====
function drawMinimap(){
  const mw=160,mh=36,mx=W-mw-10,my=H-mh-12;
  ctx.fillStyle='rgba(0,0,0,0.72)'; ctx.beginPath(); ctx.roundRect(mx-5,my-5,mw+10,mh+10,8); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1; ctx.beginPath(); ctx.roundRect(mx-5,my-5,mw+10,mh+10,8); ctx.stroke();
  const stageColors=['#4361ee','#06d6a0','#2dc653'];
  stages.forEach((sg,i)=>{
    const endKm=i<stages.length-1?stages[i+1].km:14.8;
    const x1=mx+(sg.km/14.8)*mw, x2=mx+(endKm/14.8)*mw;
    ctx.fillStyle=stageColors[i]; ctx.globalAlpha=0.45;
    ctx.fillRect(x1,my+mh/2-5,x2-x1,10); ctx.globalAlpha=1;
    ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='8px sans-serif';
    ctx.fillText(sg.name,x1+2,my+mh/2-7);
  });
  const px=mx+(state.km/14.8)*mw;
  ctx.fillStyle='#ffd166';
  ctx.beginPath(); ctx.moveTo(px,my+mh/2-9); ctx.lineTo(px-4,my+mh/2+3); ctx.lineTo(px+4,my+mh/2+3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=0.8; ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px sans-serif';
  ctx.fillText('0km',mx,my+mh+6); ctx.fillText('14.8km',mx+mw-26,my+mh+6);
  ctx.globalAlpha=1;
}

// ===== HUD =====
function drawHUD(){
  const car=getEffectiveCar(state.carKey);
  // Speed box
  ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.roundRect(10,10,200,58,7); ctx.fill();
  ctx.fillStyle='#aaa'; ctx.font='500 12px sans-serif'; ctx.fillText(carDefs[state.carKey].label,18,27);
  ctx.fillStyle='#06d6a0'; ctx.font='bold 24px sans-serif'; ctx.fillText(Math.round(state.speed)+' km/h',18,54);
  // Coins/score
  ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.beginPath(); ctx.roundRect(10,72,200,26,7); ctx.fill();
  ctx.fillStyle='#ffd166'; ctx.font='12px sans-serif'; ctx.fillText('🪙 '+coins+'   スコア: '+score,18,89);
  // Progress bar
  const pct=state.km/14.8;
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(W-170,10,155,14,4); ctx.fill();
  ctx.fillStyle='#4361ee'; ctx.beginPath(); ctx.roundRect(W-170,10,Math.max(0,155*pct),14,4); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.fillText('首都高  '+state.km.toFixed(1)+'/14.8km',W-165,21);
  ctx.fillStyle='rgba(255,220,100,0.9)'; ctx.font='bold 10px sans-serif'; ctx.fillText('▶ '+getCurrentStage().name,W-165,36);
  // Nitro gauge
  const nx=W-170,ny=44,nw=155,nh=9;
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(nx,ny,nw,nh,4); ctx.fill();
  let nFill = nitro.active?nitro.timer/getNitroDur():nitro.cooldown>0?1-nitro.cooldown/getNitroCD():1;
  const nCol = nitro.active?'#4a8aff':nitro.cooldown>0?'#ff6644':'#4a8aff';
  if(nitro.active) ctx.globalAlpha=0.75+Math.sin(state.frame*0.5)*0.25;
  ctx.fillStyle=nCol; ctx.beginPath(); ctx.roundRect(nx,ny,Math.max(0,nw*nFill),nh,4); ctx.fill();
  ctx.globalAlpha=1;
  ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.font='7px sans-serif';
  ctx.fillText(nitro.active?'▶ NITRO ACTIVE':nitro.cooldown>0?'COOLDOWN':'▶ NITRO READY',nx+3,ny+nh-1);
  // Rain warning
  if(state.wet){
    ctx.fillStyle='rgba(0,0,60,0.75)'; ctx.beginPath(); ctx.roundRect(10,102,148,20,6); ctx.fill();
    ctx.fillStyle='#a0c4ff'; ctx.font='11px sans-serif'; ctx.fillText('🌧️ 雨！  スリッピー路面',16,116);
  }
}

// ===== EVENTS =====
const events=[
  {km:1.5, txt:'⚡ 谷町JCT通過！',cls:'ev'},
  {km:5.0, txt:'🌊 湾岸線へ！ +10コイン',cls:'sp',reward:10},
  {km:6.0, txt:'🌉 レインボーブリッジ — 最高の夜景...',cls:'sp'},
  {km:8.0, txt:'🚔 覆面！ 全力逃走！',cls:'warn'},
  {km:10.0,txt:'🌿 箱崎JCTへ！ +10コイン',cls:'sp',reward:10},
  {km:11.5,txt:'🌧️ 雨！ スリッピーな路面',cls:'warn',setWet:true},
  {km:14.8,txt:'🏁 ゴール！ +80コイン 🔥',cls:'sp',reward:80},
];

// ===== CONTROLS =====
function changeLane(d){
  const n=state.targetLane+d;
  if(n>=0&&n<3){
    state.targetLane=n;
    document.getElementById('lane').textContent=['左','中央','右'][n];
  }
}
document.getElementById('up-btn').onclick=()=>{initAudio();changeLane(-1);};
document.getElementById('dn-btn').onclick=()=>{initAudio();changeLane(1);};
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowUp'){e.preventDefault();changeLane(-1);}
  if(e.key==='ArrowDown'){e.preventDefault();changeLane(1);}
  if(e.key===' '){e.preventDefault();activateNitro();}
  if(e.key==='ArrowLeft'){e.preventDefault();changeLane(-1);}
  if(e.key==='ArrowRight'){e.preventDefault();changeLane(1);}
});
let _tx=null,_ty=null;
canvas.addEventListener('touchstart',e=>{e.preventDefault();_tx=e.touches[0].clientX;_ty=e.touches[0].clientY;initAudio();},{passive:false});
canvas.addEventListener('touchend',e=>{
  if(_tx===null)return;
  const dx=e.changedTouches[0].clientX-_tx, dy=e.changedTouches[0].clientY-_ty;
  if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>18) changeLane(dy>0?1:-1);
  else if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>18) changeLane(dx>0?1:-1);
  else activateNitro();
  _tx=null;_ty=null;
},{passive:false});

// ===== LOG =====
function addLog(txt,cls){
  const log=document.getElementById('log');
  const d=document.createElement('div'); d.className=cls||''; d.textContent=txt;
  log.appendChild(d); log.scrollTop=log.scrollHeight;
}

// ===== RESET =====
function reset(){
  state={running:false,speed:0,km:0,carKey:state.carKey,lane:1,targetLane:1,laneX:0,targetLaneX:0,frame:0,fired:new Set(),wet:false,slipX:0,_kmCoins:0};
  nitro={active:false,timer:0,cooldown:0}; scrollZ=0;
  score=0; traffic=[]; crashes=[]; rainPtcls=[];
  spawnTraffic();
  document.getElementById('log').innerHTML='コースに入場しました。スタートを押してください...';
  document.getElementById('btn').textContent='スタート';
  ['spd','km','score'].forEach(id=>document.getElementById(id).textContent=id==='km'?'0.0':'0');
  document.getElementById('lane').textContent='中央';
  document.getElementById('stage').textContent=stages[0].name;
  updateNitroBtn();
}

// ===== TUNING MODAL =====
function openTuning(){
  document.getElementById('modal-coins').textContent=coins;
  const container=document.getElementById('tune-items');
  container.innerHTML='';
  Object.entries(TUNING_DEFS).forEach(([key,def])=>{
    const lv=tuning[key],maxLv=3,cost=lv<maxLv?TUNING_COSTS[lv]:0;
    const stars=Array.from({length:maxLv},(_,i)=>`<div class="tune-star${i<lv?' on':''}"></div>`).join('');
    const eff=lv<maxLv?`次: ${def.effects[lv]}`:'MAX レベル達成！';
    const btn=lv>=maxLv?`<div class="tune-max">MAX ✓</div>`:`<button class="tune-upgrade-btn"${coins<cost?' disabled':''} data-key="${key}">🪙${cost} アップ</button>`;
    const el=document.createElement('div'); el.className='tune-item';
    el.innerHTML=`<div class="tune-icon">${def.icon}</div><div class="tune-info"><h3>${def.name} Lv.${lv}</h3><p>${def.desc}</p><div class="tune-effect">${eff}</div><div class="tune-stars">${stars}</div></div>${btn}`;
    container.appendChild(el);
  });
  const lb=document.getElementById('lb-list');
  lb.innerHTML=leaderboard.length===0
    ?'<div class="lb-empty">まだ記録なし。完走しよう！</div>'
    :leaderboard.map((e,i)=>`<div class="lb-entry"><span>${i+1}. ${e.car}</span><span>${e.score}pt / ${e.km}km</span><span>${e.date}</span></div>`).join('');
  document.getElementById('tune-overlay').classList.add('open');
}
document.getElementById('tune-items').addEventListener('click',e=>{
  const btn=e.target.closest('[data-key]');
  if(!btn||btn.disabled)return;
  const key=btn.dataset.key,lv=tuning[key];
  if(lv>=3)return;
  const cost=TUNING_COSTS[lv];
  if(coins<cost)return;
  coins-=cost; tuning[key]++; savePersist();
  document.getElementById('coins').textContent=coins;
  addLog(`🔧 ${TUNING_DEFS[key].name} → Lv.${tuning[key]} アップ！`,'ev');
  openTuning();
});
document.getElementById('tune-btn').onclick=openTuning;
document.getElementById('tune-close').onclick=()=>document.getElementById('tune-overlay').classList.remove('open');
document.getElementById('tune-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('open');});

// ===== MAIN LOOP =====
function loop(){
  const car = getEffectiveCar(state.carKey);
  const sg  = getCurrentStage();
  document.getElementById('stage').textContent = sg.name;

  if(state.running && state.km < 14.8){
    // Nitro
    let spdBoost=1;
    if(nitro.active){
      spdBoost=1.85; nitro.timer--;
      if(nitro.timer<=0){nitro.active=false;nitro.cooldown=getNitroCD();addLog('💨 ニトロ終了 CDなう...','');}
    } else if(nitro.cooldown>0) nitro.cooldown--;
    updateNitroBtn();

    // Rain physics
    let topMod=1;
    if(state.wet){
      const grip=[0.68,0.82,0.91,1.0][tuning.tire];
      topMod=grip;
      if(Math.random()<0.007*(1-grip)){state.slipX=(Math.random()-0.5)*0.6;addLog('💦 スリップ！','warn');}
    }
    if(state.slipX!==0) state.slipX*=0.88;

    const effTop=car.topSpeed*topMod*spdBoost;
    if(state.speed<effTop) state.speed=Math.min(effTop,state.speed+car.accel*(nitro.active?2.2:1));
    else if(state.speed>effTop) state.speed=Math.max(effTop,state.speed-car.accel*2);

    state.km=Math.min(14.8,state.km+state.speed/3600*0.5);
    state.frame++;
    scrollZ+=state.speed*0.12;

    // Smooth lane transition
    state.targetLaneX = LANE_WX[state.targetLane] + state.slipX;
    state.laneX += (state.targetLaneX - state.laneX) * 0.06;

    // Score per second
    if(state.frame%60===0) score+=Math.floor(state.speed/8);

    // Coins per 0.1km
    const kt=Math.floor(state.km*10);
    if(kt>state._kmCoins){state._kmCoins=kt;coins++;document.getElementById('coins').textContent=coins;savePersist();}

    // Traffic update
    traffic.forEach(t=>{
      if(t.crashed){
        t.crashTimer--;
        if(t.crashTimer<=0){t.crashed=false;t.z=FAR_Z*0.6+Math.random()*FAR_Z*0.3;t.lane=Math.floor(Math.random()*3);t.targetLane=t.lane;}
        return;
      }
      // Traffic moves toward player
      t.z -= (state.speed - t.speed) * 0.1;
      if(t.z < NEAR_Z*0.5){
        t.z=FAR_Z*0.5+Math.random()*FAR_Z*0.4;
        t.lane=Math.floor(Math.random()*3); t.targetLane=t.lane;
      }
      if(Math.random()<0.002) t.targetLane=Math.floor(Math.random()*3);
      t.lane+=(t.targetLane-t.lane)*0.05;

      // Collision (Z close + same lane)
      const dz=Math.abs(t.z-NEAR_Z*1.2);
      const dl=Math.abs(t.lane-state.targetLane);
      if(dz<150&&dl<0.6&&!t.crashed){
        t.crashed=true; t.crashTimer=90;
        const sx2=sx(LANE_WX[Math.round(t.lane)],NEAR_Z*1.2);
        crashes.push({x:sx2,y:H-100,r:5,life:40,angle:Math.random()*Math.PI*2});
        playCrashSound(); score=Math.max(0,score-50);
        addLog('💥 '+carDefs[t.key].label+' クラッシュ！ -50pt','warn');
      } else if(dz>150&&dz<350&&dl<0.5&&!t.nearMissed){
        t.nearMissed=true; coins+=3; score+=25;
        document.getElementById('coins').textContent=coins; savePersist();
        addLog('😤 ニアミス！ +3コイン +25pt','ev');
        playNearMissSound();
        setTimeout(()=>{t.nearMissed=false;},2000);
      }
    });

    if(state.wet) rainPtcls; // ensure rain exists (drawRain handles it)

    events.forEach(ev=>{
      if(!state.fired.has(ev.km)&&state.km>=ev.km){
        state.fired.add(ev.km); addLog(ev.txt,ev.cls);
        if(ev.reward){coins+=ev.reward;document.getElementById('coins').textContent=coins;savePersist();}
        if(ev.setWet) state.wet=true;
      }
    });

    document.getElementById('spd').textContent=Math.round(state.speed);
    document.getElementById('km').textContent=state.km.toFixed(1);
    document.getElementById('score').textContent=score;
    updateEngineSound(state.speed,car.topSpeed,nitro.active);

  } else if(state.km>=14.8&&state.running){
    state.running=false; saveScore(score);
    document.getElementById('btn').textContent='スタート';
    addLog('🏆 フィニッシュ！ 最終スコア: '+score+'pt  🪙'+coins,'sp');
    updateEngineSound(0,1,false);
  }

  // ===== RENDER =====
  ctx.clearRect(0,0,W,H);

  // 1. Night sky + Tokyo skyline
  drawNightSky();

  // 2. Road
  drawRoad3D();

  // 3. Street lights
  drawStreetLights();

  // 4. Overhead signs
  drawOverheadSigns();

  // 5. Rain
  if(state.wet) drawRain();

  // 6. Traffic (sorted far→near so near cars draw on top)
  const sortedTraffic=[...traffic].sort((a,b)=>b.z-a.z);
  sortedTraffic.forEach(t=>{
    if(t.z<NEAR_Z*0.4||t.z>FAR_Z*0.55) return;
    const lx = LANE_WX[Math.round(Math.max(0,Math.min(2,t.lane)))];
    const tx = sx(lx, t.z);
    const ty = sy(t.z);
    const tscale = NEAR_Z / Math.max(t.z,1);
    if(ty<HZ||tscale<0.03) return;
    drawTrafficFront(tx, ty, tscale*1.2, t.key, t.crashed);
  });

  // 7. Crash VFX
  drawCrashes();

  // 8. Player car
  drawPlayerCar();

  // 9. HUD & minimap
  drawHUD();
  drawMinimap();

  requestAnimationFrame(loop);
}

// ===== BUTTON HANDLERS =====
document.getElementById('btn').onclick=()=>{
  initAudio();
  if(state.km>=14.8){reset();return;}
  state.running=!state.running;
  document.getElementById('btn').textContent=state.running?'一時停止':'再開';
  if(state.running) addLog('🏎️ '+carDefs[state.carKey].label+' 発進！','ev');
};
document.getElementById('reset-btn').onclick=()=>{initAudio();reset();};
document.getElementById('car-sel').onchange=e=>{state.carKey=e.target.value;reset();};
document.getElementById('nitro-btn').onclick=activateNitro;

document.getElementById('coins').textContent=coins;
initDiscordSdk().finally(()=>loop());
