// =======================
//  Variables globales
// =======================
let atlasImage = null;        // spritemap1.png
let atlasData  = null;        // spritemap1.json
let animData   = null;        // Animation.json
let lastZipUrl = null;

const pngInput   = document.getElementById('pngInput');
const atlasJsonInput = document.getElementById('jsonInput'); // spritemap JSON
const animJsonInput  = document.getElementById('animInput'); // <-- NUEVO: input para Animation.json
const statusEl   = document.getElementById('status');
const convertirBtn = document.getElementById('convertir');
const openZipBtn   = document.getElementById('openZipTab');

// =======================
//  Helpers
// =======================
function setStatus(msg) {
  statusEl.textContent = msg;
  console.log(msg);
}

function fileToText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Error leyendo archivo'));
    r.readAsText(file);
  });
}

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Error leyendo imagen'));
    r.readAsDataURL(file);
  });
}

function canvasToBlob(canvas) {
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

// =======================
//  Cargar archivos
// =======================
pngInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return setStatus('No seleccionaste la imagen del atlas.');
  try {
    const dataUrl = await fileToDataURL(file);
    const img = new Image();
    img.onload = () => { atlasImage = img; setStatus('PNG del atlas cargado.'); };
    img.onerror = () => setStatus('Error cargando la imagen.');
    img.src = dataUrl;
  } catch (err) { setStatus(err.message); }
});

atlasJsonInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return setStatus('No seleccionaste el JSON del atlas.');
  try {
    atlasData = JSON.parse(await fileToText(file));
    setStatus('JSON del atlas cargado.');
  } catch (err) { setStatus('Error leyendo JSON del atlas: ' + err.message); }
});

// NUEVO: cargar Animation.json
animJsonInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return setStatus('No seleccionaste el Animation.json.');
  try {
    animData = JSON.parse(await fileToText(file));
    setStatus('Animation.json cargado.');
  } catch (err) { setStatus('Error leyendo Animation.json: ' + err.message); }
});

// =======================
//  Procesamiento
// =======================
function buildAtlasMap(data){
  const map = {};
  const sprites = data?.ATLAS?.SPRITES || [];
  sprites.forEach(s => {
    const sp = s.SPRITE;
    map[sp.name] = { x: sp.x, y: sp.y, w: sp.w, h: sp.h };
  });
  return map;
}

function buildSymbolMap(data){
  const map = {};
  const symbols = data?.SD?.S || [];
  symbols.forEach(s => { map[s.SN] = s; });
  return map;
}

function findActiveFrame(frames, f) {
  return frames.find(fr => f >= (fr.I||0) && f < (fr.I||0)+(fr.DU||1)) || null;
}

function drawASI(ctx, atlas, img, asi){
  const r = atlas[asi.N];
  if(!r) return;
  const m = asi.M3D || [];
  const a=m[0]||1,b=m[1]||0,c=m[4]||0,d=m[5]||1,tx=m[12]||0,ty=m[13]||0;
  ctx.save();
  ctx.setTransform(a,b,c,d,tx,ty);
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  ctx.restore();
}

function drawSymbol(ctx, symbols, atlas, img, name, frame){
  const sym = symbols[name];
  if(!sym?.TL?.L) return;
  sym.TL.L.forEach(layer=>{
    const fr = findActiveFrame(layer.FR||[], frame);
    if(!fr) return;
    (fr.E||[]).forEach(el=>{
      if(el.ASI){
        drawASI(ctx, atlas, img, el.ASI);
      }else if(el.SI){
        const m = el.SI.M3D||[];
        const a=m[0]||1,b=m[1]||0,c=m[4]||0,d=m[5]||1,tx=m[12]||0,ty=m[13]||0;
        ctx.save();
        ctx.transform(a,b,c,d,tx,ty);
        drawSymbol(ctx, symbols, atlas, img, el.SI.SN, frame-(fr.I||0));
        ctx.restore();
      }
    });
  });
}

async function exportFramesAsZip(){
  if(!atlasImage || !atlasData || !animData){
    setStatus('Debes cargar PNG, atlas JSON y Animation.json.');
    return;
  }

  const atlas = buildAtlasMap(atlasData);
  const symbols = buildSymbolMap(animData);
  const mainTL = animData?.AN?.TL;
  if(!mainTL?.L) return setStatus('No se encontró la timeline principal en Animation.json');

  // calcular cantidad total de frames
  let maxF = 0;
  mainTL.L.forEach(l=>{
    l.FR?.forEach(fr=>{
      const end = (fr.I||0)+(fr.DU||1);
      if(end>maxF) maxF=end;
    });
  });

  const zip = new JSZip();
  const folder = zip.folder('frames');
  const W = 1024, H = 1024; // tamaño de salida; ajusta según tu escena

  for(let f=0; f<maxF; f++){
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // dibujar cada capa
    mainTL.L.forEach(layer=>{
      const fr = findActiveFrame(layer.FR||[], f);
      if(!fr) return;
      (fr.E||[]).forEach(el=>{
        if(el.ASI) drawASI(ctx, atlas, atlasImage, el.ASI);
        else if(el.SI){
          const m = el.SI.M3D||[];
          const a=m[0]||1,b=m[1]||0,c2=m[4]||0,d=m[5]||1,tx=m[12]||0,ty=m[13]||0;
          ctx.save();
          ctx.transform(a,b,c2,d,tx,ty);
          drawSymbol(ctx, symbols, atlas, atlasImage, el.SI.SN, f-(fr.I||0));
          ctx.restore();
        }
      });
    });

    const blob = await canvasToBlob(c);
    folder.file(`frame_${String(f).padStart(4,'0')}.png`, blob);
    setStatus(`Frame ${f+1}/${maxF} listo`);
    await new Promise(r=>setTimeout(r,0));
  }

  setStatus('Comprimiendo ZIP...');
  const zipBlob = await zip.generateAsync({type:'blob'}, m=>setStatus(`Comprimiendo... ${Math.round(m.percent)}%`));

  if(lastZipUrl) URL.revokeObjectURL(lastZipUrl);
  lastZipUrl = URL.createObjectURL(zipBlob);

  const a = document.createElement('a');
  a.href = lastZipUrl;
  a.download = 'frames_construidos.zip';
  a.click();
  openZipBtn.style.display = 'inline-block';
  openZipBtn.onclick = ()=>window.open(lastZipUrl,'_blank');

  setStatus(`Listo: ${maxF} frames exportados.`);
}

// =======================
//  Botón principal
// =======================
convertirBtn.addEventListener('click', exportFramesAsZip);

