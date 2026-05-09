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
const HZ = Math.floor(H * 0.36);
const NEAR_Z  = 500;
const FAR_Z   = 16000;

// 道を広くする。0.44 → 0.58
const ROAD_HW = W * 0.58;

// 5分前後遊べる距離
const GAME_TOTAL_KM = 25.0;

// 道路の端と車線中心を分ける
// 前の LANE_WX = [-1.4, 0, 1.4] は外側レーンが端に寄りすぎてた
const ROAD_EDGE_WX = 1.35;
const LANE_WX = [-0.82, 0, 0.82];

// 車線境界線。3車線なので区切りは2本
const LANE_MARK_WX = [-0.41, 0.41];

const sy  = z => HZ + (H - HZ) * NEAR_Z / Math.max(z, 1);
const sx  = (wx, z) => W / 2 + wx * ROAD_HW * NEAR_Z / Math.max(z, 1);
const rhw = z => ROAD_HW * NEAR_Z / Math.max(z, 1);

let scrollZ = 0;
let lastTime = performance.now();

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
  if(!state.running||nitro.active||nitro.cooldown>0||state.km>=GAME_TOTAL_KM)return;
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
  {name:'湾岸線',    km:8},
  {name:'箱崎JCT',  km:16},
  {name:'ゴール前',  km:22},
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
  const STRIP_Z = 700;
  const TOTAL_Z = 14000;
  const offset = scrollZ % STRIP_Z;

  // Road base
  ctx.fillStyle='#141420';
  ctx.beginPath();
  ctx.moveTo(sx(-ROAD_EDGE_WX, FAR_Z), HZ);
  ctx.lineTo(sx( ROAD_EDGE_WX, FAR_Z), HZ);
  ctx.lineTo(sx( ROAD_EDGE_WX, NEAR_Z), H);
  ctx.lineTo(sx(-ROAD_EDGE_WX, NEAR_Z), H);
  ctx.closePath();
  ctx.fill();

  // Perspective strips
  for(let z=NEAR_Z; z<TOTAL_Z; z+=STRIP_Z){
    const sz=z+offset;
    const y0=sy(sz), y1=sy(sz+STRIP_Z);
    if(y0<HZ) continue;

    const isAlt=Math.floor(sz/STRIP_Z)%2===0;
    ctx.fillStyle=isAlt?'#1b1b2f':'#151526';

    ctx.beginPath();
    ctx.moveTo(sx(-ROAD_EDGE_WX, sz), y0);
    ctx.lineTo(sx( ROAD_EDGE_WX, sz), y0);
    ctx.lineTo(sx( ROAD_EDGE_WX, sz+STRIP_Z), Math.max(y1,HZ));
    ctx.lineTo(sx(-ROAD_EDGE_WX, sz+STRIP_Z), Math.max(y1,HZ));
    ctx.closePath();
    ctx.fill();
  }

  // Wet road reflection
  if(state.wet){
    const sheen=ctx.createLinearGradient(0,HZ,0,H);
    sheen.addColorStop(0,'rgba(80,120,255,0)');
    sheen.addColorStop(0.5,'rgba(80,120,255,0.08)');
    sheen.addColorStop(1,'rgba(80,120,255,0)');
    ctx.fillStyle=sheen;
    ctx.fillRect(0,HZ,W,H-HZ);
  }

  // Lane markings: 3車線なので区切り線は2本
  const DASH_Z = 320;
  const GAP_Z = 260;
  const PATTERN = DASH_Z + GAP_Z;

  LANE_MARK_WX.forEach(lx=>{
    for(let z=NEAR_Z; z<FAR_Z; z+=PATTERN){
      const sz=((z-scrollZ%PATTERN)+PATTERN)%FAR_Z+NEAR_Z;
      const z0=sz;
      const z1=sz+DASH_Z;
      const y0=sy(z0);
      const y1=sy(z1);
      if(y0<HZ||y1>H) continue;

      const x0=sx(lx,z0);
      const x1=sx(lx,z1);
      const lw=Math.max(1.2,rhw(z0)*0.01);

      ctx.strokeStyle='rgba(255,230,80,0.82)';
      ctx.lineWidth=lw;
      ctx.beginPath();
      ctx.moveTo(x0,y0);
      ctx.lineTo(x1,y1);
      ctx.stroke();
    }
  });

  // Edge lines
  [-ROAD_EDGE_WX, ROAD_EDGE_WX].forEach(edge=>{
    ctx.strokeStyle='rgba(255,255,255,0.88)';
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(sx(edge,NEAR_Z), sy(NEAR_Z));
    ctx.lineTo(sx(edge,FAR_Z),  sy(FAR_Z));
    ctx.stroke();
  });

  // Guardrails
  [-1,1].forEach(side=>{
    const edge = side * (ROAD_EDGE_WX + 0.12);
    const topX=sx(edge,FAR_Z);
    const botX=sx(edge,NEAR_Z);

    ctx.strokeStyle='rgba(190,210,255,0.42)';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(topX,HZ+2);
    ctx.lineTo(botX,H);
    ctx.stroke();

    ctx.strokeStyle='rgba(100,140,255,0.12)';
    ctx.lineWidth=8;
    ctx.beginPath();
    ctx.moveTo(topX,HZ+2);
    ctx.lineTo(botX,H);
    ctx.stroke();
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

function drawCarShadow(w, h){
  ctx.fillStyle='rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(0, h/2 + 10, w*0.48, 10, 0, 0, Math.PI*2);
  ctx.fill();
}

function drawTailLights(points){
  points.forEach(([x,y,w,h,type])=>{
    ctx.fillStyle='rgba(255,20,35,0.95)';
    ctx.beginPath();

    if(type==='circle'){
      ctx.arc(x,y,w,0,Math.PI*2);
    }else{
      ctx.roundRect(x-w/2,y-h/2,w,h,3);
    }

    ctx.fill();

    ctx.strokeStyle='rgba(255,40,40,0.35)';
    ctx.lineWidth=4;
    ctx.stroke();
  });
}

function drawWheels(w,h,style='normal'){
  [-1,1].forEach(side=>{
    const x=side*(w/2-10);
    const y=h/2+3;

    ctx.fillStyle='#08080a';
    ctx.beginPath();
    ctx.ellipse(x,y,10,13,0,0,Math.PI*2);
    ctx.fill();

    ctx.strokeStyle=style==='red'?'#cc1111':'#8a8a8a';
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.ellipse(x,y,8,10,0,0,Math.PI*2);
    ctx.stroke();

    ctx.strokeStyle='#777';
    ctx.lineWidth=1;
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+Math.cos(a)*7,y+Math.sin(a)*7);
      ctx.stroke();
    }
  });
}

function drawNitroFlameSmall(cx, cy){
  ctx.save();
  const pulse = 1 + Math.sin(state.frame*0.45)*0.18;
  const fl=34*pulse;

  ['rgba(255,255,255,0.9)','rgba(255,240,80,0.85)','rgba(255,130,0,0.72)','rgba(255,40,0,0.55)'].forEach((col,i)=>{
    ctx.fillStyle=col;
    ctx.beginPath();
    ctx.ellipse(cx-(i*7+fl*0.25), cy, fl*(1-i*0.16), 5-i*0.5, 0, 0, Math.PI*2);
    ctx.fill();
  });

  ctx.restore();
}

// GT-R: 四灯テール、箱っぽいがスポーツ寄り
function drawGTR_rear(cx, cy, sc, nitroOn){
  ctx.save();
  ctx.translate(cx,cy);
  ctx.scale(sc,sc);

  const w=78, h=32;
  drawCarShadow(w,h);

  // Main body
  ctx.fillStyle='#cfd2d8';
  ctx.beginPath();
  ctx.roundRect(-w/2,-h/2,w,h,7);
  ctx.fill();

  // Rear glass / roof
  ctx.fillStyle='#7d8795';
  ctx.beginPath();
  ctx.moveTo(-25,-h/2);
  ctx.lineTo(-15,-h/2-17);
  ctx.lineTo(15,-h/2-17);
  ctx.lineTo(25,-h/2);
  ctx.closePath();
  ctx.fill();

  // Body lower diffuser
  ctx.fillStyle='#111217';
  ctx.beginPath();
  ctx.roundRect(-w/2+4,h/2-10,w-8,12,3);
  ctx.fill();

  // NISMO red accent
  ctx.fillStyle='#d40000';
  ctx.fillRect(-w/2+5,h/2-11,w-10,2);

  // Four round tail lights
  drawTailLights([
    [-27,-2,5,5,'circle'],
    [-17,-2,5,5,'circle'],
    [17,-2,5,5,'circle'],
    [27,-2,5,5,'circle'],
  ]);

  // Wing
  ctx.fillStyle='#111';
  ctx.beginPath();
  ctx.roundRect(-w/2-5,-h/2-22,w+10,5,2);
  ctx.fill();
  ctx.fillRect(-25,-h/2-18,5,17);
  ctx.fillRect(20,-h/2-18,5,17);

  // Exhaust
  [-22,-13,13,22].forEach(x=>{
    ctx.fillStyle='#2b2b2f';
    ctx.beginPath();
    ctx.arc(x,h/2+1,4,0,Math.PI*2);
    ctx.fill();
  });

  ctx.fillStyle='#fff';
  ctx.font='bold 7px sans-serif';
  ctx.textAlign='center';
  ctx.fillText('GT-R',0,7);
  ctx.textAlign='left';

  drawWheels(w,h,'normal');

  if(nitroOn) drawNitroFlameSmall(-w/2-10, h/2-2);

  ctx.restore();
}

// Ferrari: 低く、横長、丸テール
function drawFerrari_rear(cx, cy, sc, nitroOn){
  ctx.save();
  ctx.translate(cx,cy);
  ctx.scale(sc,sc);

  const w=86, h=28;
  drawCarShadow(w,h);

  // Low supercar shape
  ctx.fillStyle='#cc1111';
  ctx.beginPath();
  ctx.moveTo(-w/2,h/2);
  ctx.lineTo(-w/2+6,-h/2+4);
  ctx.lineTo(-w/2+24,-h/2-5);
  ctx.lineTo(w/2-24,-h/2-5);
  ctx.lineTo(w/2-6,-h/2+4);
  ctx.lineTo(w/2,h/2);
  ctx.closePath();
  ctx.fill();

  // Highlight
  ctx.fillStyle='#f02a2a';
  ctx.beginPath();
  ctx.roundRect(-w/2+12,-h/2+1,w-24,9,4);
  ctx.fill();

  // Rear window
  ctx.fillStyle='#350909';
  ctx.beginPath();
  ctx.roundRect(-23,-h/2-11,46,12,4);
  ctx.fill();

  // Diffuser
  ctx.fillStyle='#160303';
  ctx.beginPath();
  ctx.roundRect(-w/2+5,h/2-9,w-10,11,3);
  ctx.fill();

  // Tail lights
  drawTailLights([
    [-31,0,7,7,'circle'],
    [31,0,7,7,'circle'],
  ]);

  // Center exhaust
  [-6,6].forEach(x=>{
    ctx.fillStyle='#222';
    ctx.beginPath();
    ctx.arc(x,h/2+1,5,0,Math.PI*2);
    ctx.fill();
    ctx.fillStyle='#555';
    ctx.beginPath();
    ctx.arc(x,h/2+1,2.8,0,Math.PI*2);
    ctx.fill();
  });

  ctx.fillStyle='#ffd700';
  ctx.font='9px sans-serif';
  ctx.textAlign='center';
  ctx.fillText('🐎',0,5);
  ctx.textAlign='left';

  drawWheels(w,h,'normal');

  if(nitroOn) drawNitroFlameSmall(-w/2-8, h/2-2);

  ctx.restore();
}

// Lamborghini: 角ばった低い車体、巨大ウィング
function drawVeneno_rear(cx, cy, sc, nitroOn){
  ctx.save();
  ctx.translate(cx,cy);
  ctx.scale(sc,sc);

  const w=92, h=27;
  drawCarShadow(w,h);

  // Angular body
  ctx.fillStyle='#67686c';
  ctx.beginPath();
  ctx.moveTo(-w/2,h/2);
  ctx.lineTo(-w/2+5,-h/2+2);
  ctx.lineTo(-w/2+22,-h/2-9);
  ctx.lineTo(w/2-22,-h/2-9);
  ctx.lineTo(w/2-5,-h/2+2);
  ctx.lineTo(w/2,h/2);
  ctx.closePath();
  ctx.fill();

  // Black carbon sections
  ctx.fillStyle='#191a1f';
  ctx.beginPath();
  ctx.moveTo(-w/2+7,h/2-2);
  ctx.lineTo(-w/2+16,-h/2+1);
  ctx.lineTo(-w/2+34,-h/2+1);
  ctx.lineTo(-w/2+25,h/2-2);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(w/2-7,h/2-2);
  ctx.lineTo(w/2-16,-h/2+1);
  ctx.lineTo(w/2-34,-h/2+1);
  ctx.lineTo(w/2-25,h/2-2);
  ctx.closePath();
  ctx.fill();

  // Red accent
  ctx.fillStyle='#d00000';
  ctx.fillRect(-w/2+5,h/2-9,w-10,3);

  // Massive wing
  ctx.fillStyle='#09090b';
  ctx.beginPath();
  ctx.roundRect(-w/2-12,-h/2-28,w+24,6,2);
  ctx.fill();

  ctx.fillStyle='#24252b';
  ctx.beginPath();
  ctx.moveTo(-25,-h/2-23);
  ctx.lineTo(-30,-h/2-2);
  ctx.lineTo(-20,-h/2-2);
  ctx.lineTo(-15,-h/2-23);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(25,-h/2-23);
  ctx.lineTo(30,-h/2-2);
  ctx.lineTo(20,-h/2-2);
  ctx.lineTo(15,-h/2-23);
  ctx.closePath();
  ctx.fill();

  // Y-like tail lights
  ctx.strokeStyle='rgba(255,30,30,0.95)';
  ctx.lineWidth=3;
  [-1,1].forEach(side=>{
    const x=side*31;
    ctx.beginPath();
    ctx.moveTo(x,0);
    ctx.lineTo(x,-8);
    ctx.moveTo(x,0);
    ctx.lineTo(x-side*7,6);
    ctx.moveTo(x,0);
    ctx.lineTo(x+side*7,6);
    ctx.stroke();
  });

  // Diffuser
  ctx.fillStyle='#070709';
  ctx.beginPath();
  ctx.moveTo(-w/2+8,h/2-3);
  ctx.lineTo(w/2-8,h/2-3);
  ctx.lineTo(w/2-18,h/2+9);
  ctx.lineTo(-w/2+18,h/2+9);
  ctx.closePath();
  ctx.fill();

  // Exhaust cluster
  for(let i=0;i<4;i++){
    const x=-15+i*10;
    ctx.fillStyle='#222';
    ctx.beginPath();
    ctx.arc(x,h/2+2,4,0,Math.PI*2);
    ctx.fill();
  }

  ctx.fillStyle='#ffd700';
  ctx.font='bold 8px sans-serif';
  ctx.textAlign='center';
  ctx.fillText('L',0,4);
  ctx.textAlign='left';

  drawWheels(w,h,'red');

  if(nitroOn) drawNitroFlameSmall(-w/2-11, h/2-2);

  ctx.restore();
}

// ===== PLAYER CAR DRAW =====
function drawPlayerCar(){
  const x = sx(state.laneX, NEAR_Z);
  const y = H - 62;
  const sc = 1.65;
  const nitroOn = nitro.active;

  if(state.carKey==='gtr') drawGTR_rear(x,y,sc,nitroOn);
  else if(state.carKey==='ferrari') drawFerrari_rear(x,y,sc,nitroOn);
  else if(state.carKey==='veneno') drawVeneno_rear(x,y,sc,nitroOn);
}
// ===== TRAFFIC 3D =====
// Front-view traffic car (generic approaching car)
function drawTrafficFront(cx, cy, scale, carKey, crashed){
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  if(crashed) ctx.rotate(Math.sin(state.frame*0.3)*0.18);

  const w=82;
  const h=34;
  const col  = carDefs[carKey]?.color || '#4488cc';
  const body = carDefs[carKey]?.body  || '#2255aa';

  // Shadow
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0,h/2+10,w*0.45,10,0,0,Math.PI*2);
  ctx.fill();

  // Front body
  ctx.fillStyle=body;
  ctx.beginPath();
  ctx.moveTo(-w/2,h/2);
  ctx.lineTo(-w/2+8,-h/2+5);
  ctx.lineTo(-w/2+24,-h/2-4);
  ctx.lineTo(w/2-24,-h/2-4);
  ctx.lineTo(w/2-8,-h/2+5);
  ctx.lineTo(w/2,h/2);
  ctx.closePath();
  ctx.fill();

  // Hood
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.roundRect(-w/2+10,-h/2+3,w-20,16,5);
  ctx.fill();

  // Windshield
  ctx.fillStyle='rgba(130,190,255,0.55)';
  ctx.beginPath();
  ctx.roundRect(-24,-h/2-9,48,14,5);
  ctx.fill();

  // Headlights
  [[-29,5],[29,5]].forEach(([x,y])=>{
    ctx.fillStyle='rgba(255,245,205,0.96)';
    ctx.beginPath();
    ctx.ellipse(x,y,10,4,0,0,Math.PI*2);
    ctx.fill();

    ctx.fillStyle='rgba(255,240,180,0.20)';
    ctx.beginPath();
    ctx.ellipse(x,y+2,22,8,0,0,Math.PI*2);
    ctx.fill();
  });

  // Grille
  ctx.fillStyle='#08080a';
  ctx.beginPath();
  ctx.roundRect(-18,h/2-12,36,8,3);
  ctx.fill();

  // Wheels
  [-1,1].forEach(side=>{
    const x=side*(w/2-10);
    ctx.fillStyle='#060608';
    ctx.beginPath();
    ctx.ellipse(x,h/2+3,10,12,0,0,Math.PI*2);
    ctx.fill();
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
    const endKm=i<stages.length-1?stages[i+1].km:GAME_TOTAL_KM;
    const x1=mx+(sg.km/GAME_TOTAL_KM)*mw, x2=mx+(endKm/GAME_TOTAL_KM)*mw;
    ctx.fillStyle=stageColors[i]; ctx.globalAlpha=0.45;
    ctx.fillRect(x1,my+mh/2-5,x2-x1,10); ctx.globalAlpha=1;
    ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='8px sans-serif';
    ctx.fillText(sg.name,x1+2,my+mh/2-7);
  });
  const px=mx+(state.km/GAME_TOTAL_KM)*mw;
  ctx.fillStyle='#ffd166';
  ctx.beginPath(); ctx.moveTo(px,my+mh/2-9); ctx.lineTo(px-4,my+mh/2+3); ctx.lineTo(px+4,my+mh/2+3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=0.8; ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.font='8px sans-serif';
  ctx.fillText('0km',mx,my+mh+6); ctx.fillText(GAME_TOTAL_KM+'km',mx+mw-30,my+mh+6);
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
  const pct=state.km/GAME_TOTAL_KM;
  ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect(W-170,10,155,14,4); ctx.fill();
  ctx.fillStyle='#4361ee'; ctx.beginPath(); ctx.roundRect(W-170,10,Math.max(0,155*pct),14,4); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font='10px sans-serif'; ctx.fillText('首都高  '+state.km.toFixed(1)+'/'+GAME_TOTAL_KM+'km',W-165,21);
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
  {km:2.5, txt:'⚡ 谷町JCT通過！',cls:'ev'},
  {km:8.0, txt:'🌊 湾岸線へ！ +10コイン',cls:'sp',reward:10},
  {km:10.0, txt:'🌉 レインボーブリッジ — 最高の夜景...',cls:'sp'},
  {km:13.5, txt:'🚔 覆面！ 全力逃走！',cls:'warn'},
  {km:16.0,txt:'🌿 箱崎JCTへ！ +10コイン',cls:'sp',reward:10},
  {km:19.0,txt:'🌧️ 雨！ スリッピーな路面',cls:'warn',setWet:true},
  {km:23.0,txt:'🔥 ラストスパート！',cls:'warn'},
  {km:GAME_TOTAL_KM,txt:'🏁 ゴール！ +80コイン 🔥',cls:'sp',reward:80},
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
function loop(now = performance.now()){
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if(state.running && state.km < GAME_TOTAL_KM){
    // Nitro
    let spdBoost=1;
    if(nitro.active){
      spdBoost=1.85; nitro.timer--;
      if(nitro.timer<=0){nitro.active=false;nitro.cooldown=getNitroCD();addLog('💨 ニトロ終了 CDなう...','');}
    } else if(nitro.cooldown>0) nitro.cooldown--;
    updateNitroBtn();

    // Car stats for this frame
    const car = getEffectiveCar(state.carKey);

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

    state.km = Math.min(GAME_TOTAL_KM, state.km + (state.speed / 3600) * dt);
    state.frame++;
    scrollZ += state.speed * dt * 42;

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
        const safeLane = Math.max(0, Math.min(2, Math.round(state.targetLane)));
        const sx2 = sx(LANE_WX[safeLane], NEAR_Z*1.2);
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

 } else if(state.km>=GAME_TOTAL_KM&&state.running){
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
    const safeLane = Math.max(0, Math.min(2, Math.round(t.lane)));
    const tx = sx(LANE_WX[safeLane], t.z);
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
  if(state.km>=GAME_TOTAL_KM){reset();return;}
  state.running=!state.running;
  document.getElementById('btn').textContent=state.running?'一時停止':'再開';
  if(state.running) addLog('🏎️ '+carDefs[state.carKey].label+' 発進！','ev');
};
document.getElementById('reset-btn').onclick=()=>{initAudio();reset();};
document.getElementById('car-sel').onchange=e=>{state.carKey=e.target.value;reset();};
document.getElementById('nitro-btn').onclick=activateNitro;

document.getElementById('coins').textContent=coins;
initDiscordSdk().finally(()=>loop());

