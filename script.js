// =======================
// Variables globales
// =======================
let atlasImage = null;        // spritemap1.png (Image)
let atlasData  = null;        // spritemap1.json (obj)
let animData   = null;        // Animation.json (obj) -> OPCIONAL
let lastZipUrl = null;

const pngInput      = document.getElementById('pngInput');
const atlasJsonInput= document.getElementById('jsonInput');
const animJsonInput = document.getElementById('animInput');
const statusEl      = document.getElementById('status');
const convertirBtn  = document.getElementById('convertir');
const openZipBtn    = document.getElementById('openZipTab');

// =======================
// Helpers
// =======================
function setStatus(msg){ statusEl.textContent = msg; console.log(msg); }
function fileToText(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsText(f); }); }
function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsDataURL(f); }); }
function canvasToBlob(c){ return new Promise(res=>c.toBlob(res,'image/png')); }

// =======================
// Cargar archivos
// =======================
pngInput.addEventListener('change', async e=>{
  const f = e.target.files[0];
  if(!f) return setStatus('No seleccionaste la imagen del atlas.');
  const dataUrl = await fileToDataURL(f);
  const img = new Image();
  img.onload = ()=>{ atlasImage = img; setStatus('PNG del atlas cargado.'); };
  img.onerror = ()=> setStatus('Error cargando la imagen.');
  img.src = dataUrl;
});

atlasJsonInput.addEventListener('change', async e=>{
  const f = e.target.files[0];
  if(!f) return setStatus('No seleccionaste el JSON del atlas.');
  try {
    atlasData = JSON.parse(await fileToText(f));
    setStatus('JSON del atlas cargado.');
  } catch(err){ setStatus('Error leyendo JSON del atlas: '+err.message); }
});

animJsonInput.addEventListener('change', async e=>{
  const f = e.target.files[0];
  if(!f){ animData = null; setStatus('Animation.json no seleccionado (modo solo piezas).'); return; }
  try {
    animData = JSON.parse(await fileToText(f));
    setStatus('Animation.json cargado (modo animación).');
  } catch(err){ animData = null; setStatus('Error leyendo Animation.json: '+err.message); }
});

// =======================
// --- Lógica de recorte simple (sin animación) ---
// =======================
async function exportAtlasPieces(){
  const sprites = atlasData?.ATLAS?.SPRITES;
  if(!sprites) throw new Error('Estructura de atlas inválida.');

  const zip = new JSZip();
  const folder = zip.folder('pieces');

  for(let i=0;i<sprites.length;i++){
    const s = sprites[i].SPRITE;
    const name = (s.name || `piece_${i}`).replace(/\s+/g,'_') + '.png';
    const c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    c.getContext('2d').drawImage(atlasImage, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    const blob = await canvasToBlob(c);
    folder.file(name, blob);
    setStatus(`Recortado ${name} (${i+1}/${sprites.length})`);
    await new Promise(r=>setTimeout(r,0));
  }

  const zipBlob = await zip.generateAsync({type:'blob'}, m=>setStatus(`Comprimiendo piezas... ${Math.round(m.percent)}%`));
  return zipBlob;
}

// =======================
// --- Toda tu lógica de animación original ---
// =======================
// =======================
// Matrices 2D (afín) utilities
// Representamos matrices 2D como {a,b,c,d,tx,ty} que corresponde a:
// [ a  c  tx ]
// [ b  d  ty ]
// [ 0  0   1 ]
// =======================
function m3dToAffine(m3d){
  // m3d: array largo (16). Aquí asumimos indices 0,1,4,5,12,13
  return {
    a: (m3d && m3d[0]!==undefined)?m3d[0]:1,
    b: (m3d && m3d[1]!==undefined)?m3d[1]:0,
    c: (m3d && m3d[4]!==undefined)?m3d[4]:0,
    d: (m3d && m3d[5]!==undefined)?m3d[5]:1,
    tx:(m3d && m3d[12]!==undefined)?m3d[12]:0,
    ty:(m3d && m3d[13]!==undefined)?m3d[13]:0
  };
}
function mulAffine(m1,m2){
  return {
    a: m1.a*m2.a + m1.c*m2.b,
    b: m1.b*m2.a + m1.d*m2.b,
    c: m1.a*m2.c + m1.c*m2.d,
    d: m1.b*m2.c + m1.d*m2.d,
    tx: m1.a*m2.tx + m1.c*m2.ty + m1.tx,
    ty: m1.b*m2.tx + m1.d*m2.ty + m1.ty
  };
}
// aplica affine a un punto
function transformPoint(m, x, y){
  return {
    x: m.a * x + m.c * y + m.tx,
    y: m.b * x + m.d * y + m.ty
  };
}

// =======================
// Construcción de maps desde JSON
// =======================
function buildAtlasMap(data){
  const map = {};
  const arr = data?.ATLAS?.SPRITES || [];
  arr.forEach(it=>{
    const s = it.SPRITE;
    map[s.name] = {x:s.x, y:s.y, w:s.w, h:s.h};
  });
  return map;
}
function buildSymbolMap(data){
  const map = {};
  const arr = data?.SD?.S || [];
  arr.forEach(sym => { map[sym.SN] = sym; });
  return map;
}

// =======================
// Determinar frames activos (lista única, ordenada)
// =======================
function collectFrameIndices(timeline){
  const set = new Set();
  (timeline.L || []).forEach(layer=>{
    (layer.FR||[]).forEach(fr=>{
      const start = fr.I||0;
      const dur = fr.DU||1;
      for(let k=start;k<start+dur;k++) set.add(k);
    });
  });
  const arr = Array.from(set);
  arr.sort((a,b)=>a-b);
  return arr;
}

// =======================
// Recolección de drawCommands (sin dibujar): 
// cada comando = {rect:{x,y,w,h}, transform:{a,b,c,d,tx,ty}, sourceName}
// Recorremos el timeline principal, resolvemos símbolos recursivamente, acumulando transform.
// =======================
function collectCommandsForFrame(mainTL, symbolsMap, atlasMap, frameIndex){
  const commands = [];
  const topLayers = mainTL.L || [];

  // helper recursive
  function processSymbolByName(symbolName, localFrame, currentTransform){
    const sym = symbolsMap[symbolName];
    if(!sym?.TL?.L) return;
    sym.TL.L.forEach(layer=>{
      const fr = (layer.FR||[]).find(rr => localFrame >= (rr.I||0) && localFrame < (rr.I||0)+(rr.DU||1));
      if(!fr) return;
      (fr.E||[]).forEach(el=>{
        if(el.ASI){
          // ASI has N (name) and M3D optionally
          const rect = atlasMap[el.ASI.N];
          if(!rect){
            console.warn('Atlas no contiene:', el.ASI.N);
            return;
          }
          const elTransform = m3dToAffine(el.ASI.M3D || []);
          const world = mulAffine(currentTransform, elTransform);
          commands.push({rect, transform: world, sourceName: el.ASI.N});
        } else if(el.SI){
          // nested symbol instance
          const elTransform = m3dToAffine(el.SI.M3D || []);
          const world = mulAffine(currentTransform, elTransform);
          const nestedLocal = localFrame - (fr.I||0);
          processSymbolByName(el.SI.SN, nestedLocal, world);
        }
      });
    });
  }

  // Process each top layer in main timeline
  topLayers.forEach(layer => {
    const fr = (layer.FR||[]).find(rr => frameIndex >= (rr.I||0) && frameIndex < (rr.I||0)+(rr.DU||1));
    if(!fr) return;
    (fr.E||[]).forEach(el => {
      if(el.ASI){
        const rect = atlasMap[el.ASI.N];
        if(!rect) { console.warn('Atlas no contiene:', el.ASI.N); return; }
        const t = m3dToAffine(el.ASI.M3D || []);
        commands.push({rect, transform: t, sourceName: el.ASI.N});
      } else if(el.SI){
        const t = m3dToAffine(el.SI.M3D || []);
        const localFrame = frameIndex - (fr.I||0);
        processSymbolByName(el.SI.SN, localFrame, t);
      }
    });
  });

  return commands;
}

// =======================
// Calcular bbox para comandos
// =======================
function computeBoundingBox(commands){
  if(commands.length === 0) return {minX:0,minY:0,maxX:0,maxY:0};

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  commands.forEach(cmd=>{
    const r = cmd.rect;
    // corners in source local coords: (0,0),(w,0),(w,h),(0,h)
    const corners = [
      transformPoint(cmd.transform, 0, 0),
      transformPoint(cmd.transform, r.w, 0),
      transformPoint(cmd.transform, r.w, r.h),
      transformPoint(cmd.transform, 0, r.h)
    ];
    corners.forEach(p=>{
      if(p.x < minX) minX = p.x;
      if(p.y < minY) minY = p.y;
      if(p.x > maxX) maxX = p.x;
      if(p.y > maxY) maxY = p.y;
    });
  });
  // floor/ceil for pixel grid
  return { minX: Math.floor(minX), minY: Math.floor(minY), maxX: Math.ceil(maxX), maxY: Math.ceil(maxY) };
}

// =======================
// Dibujar frame a canvas (usando commands y offset)
// =======================
function drawCommandsToCanvas(commands, bbox, atlasImage){
  const w = Math.max(1, bbox.maxX - bbox.minX);
  const h = Math.max(1, bbox.maxY - bbox.minY);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // dibujar cada comando
  commands.forEach(cmd=>{
    const r = cmd.rect;
    const m = cmd.transform;
    // aplicamos transform con offset (-bbox.minX, -bbox.minY)
    ctx.save();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - bbox.minX, m.ty - bbox.minY);
    ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    ctx.restore();
  });

  return canvas;
}

// =======================
// Nombre amigable para el frame
// buscamos símbolos principales usados en top-level (si hay más de uno, los concatenamos)
// =======================
function frameBaseNameForCommands(commands){
  // prefer sourceName (ASI names) or fallback 'frame'
  const names = [];
  commands.forEach(c=>{
    if(c.sourceName && !names.includes(c.sourceName)) names.push(c.sourceName);
  });
  if(names.length === 0) return 'frame';
  // tomar hasta 2 nombres y limpiar caracteres raros
  const short = names.slice(0,2).map(n => n.replace(/[^\w\-]/g,'_'));
  return short.join('_');
}

// =======================
// Función principal: generar frames y ZIP
// =======================
async function exportFramesFromAnimationToZip(){
  try{
    if(!window.JSZip) throw new Error('JSZip no está cargado; incluye la librería antes de script.js');
    if(!atlasImage || !atlasData || !animData){
      setStatus('Carga atlas PNG, atlas JSON y Animation.json antes de exportar.');
      return;
    }

    const atlasMap = buildAtlasMap(atlasData);
    const symbolsMap = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL;
    if(!mainTL?.L) { setStatus('No se encontró la timeline principal (AN.TL.L).'); return; }

    // recolectar índices de frames reales
    const framesIndices = collectFrameIndices(mainTL);
    if(framesIndices.length === 0) { setStatus('No se detectaron frames en la timeline.'); return; }

    setStatus(`Procesando ${framesIndices.length} frames...`);
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for(let idx=0; idx<framesIndices.length; idx++){
      const frameIndex = framesIndices[idx];
      setStatus(`Recolectando frame ${idx+1}/${framesIndices.length} (index ${frameIndex})...`);
      const commands = collectCommandsForFrame(mainTL, symbolsMap, atlasMap, frameIndex);

      // bounding box y canvas
      const bbox = computeBoundingBox(commands);
      // si bbox es vacío, crear canvas pequeño centrado
      if(commands.length === 0){
        // canvas vacío
        const empty = document.createElement('canvas');
        empty.width = 32; empty.height =32;
        const blobEmpty = await canvasToBlob(empty);
        const nameEmpty = `frame_${String(frameIndex).padStart(4,'0')}.png`;
        folder.file(nameEmpty, blobEmpty);
        setStatus(`Frame ${frameIndex} vacío -> exportado como ${nameEmpty}`);
        await new Promise(r=>setTimeout(r,0));
        continue;
      }

      // dibujar canvas con offset
      const canvas = drawCommandsToCanvas(commands, bbox, atlasImage);

      // generar nombre amigable
      const base = frameBaseNameForCommands(commands) || 'frame';
      const fileName = `${base}_${String(frameIndex).padStart(4,'0')}.png`;

      const blob = await canvasToBlob(canvas);
      folder.file(fileName, blob);
      setStatus(`Frame ${idx+1}/${framesIndices.length} -> ${fileName}`);
      // yield
      await new Promise(r=>setTimeout(r,0));
    }

    setStatus('Comprimiendo ZIP...');
    const zipBlob = await zip.generateAsync({type:'blob'}, m=> setStatus(`Comprimiendo... ${Math.round(m.percent)}%`));

    if(lastZipUrl) URL.revokeObjectURL(lastZipUrl);
    lastZipUrl = URL.createObjectURL(zipBlob);

    // disparar descarga
    const a = document.createElement('a');
    a.href = lastZipUrl;
    a.download = 'frames_construidos.zip';
    a.click();

    openZipBtn.style.display = 'inline-block';
    openZipBtn.onclick = ()=>window.open(lastZipUrl,'_blank');

    setStatus(`Listo: ${framesIndices.length} frames exportados en frames_construidos.zip`);

  }catch(err){
    console.error(err);
    setStatus('Error: ' + (err.message || err));
  }
}



  // <--- Aquí permanece tu función original intacta,
  // la que reconstruye y exporta los frames de la animación
  // (todo lo que ya tenías abajo, sin cambios).
}

// =======================
// Botón principal
// =======================
convertirBtn.addEventListener('click', async ()=>{
  try {
    if(!window.JSZip) throw new Error('JSZip no cargado');
    if(!atlasImage || !atlasData) throw new Error('Debes cargar PNG y JSON del atlas.');

    setStatus('Procesando...');
    const zipBlob = animData
      ? await exportFramesFromAnimationToZip()   // si hay Animation.json
      : await exportAtlasPieces();               // si NO hay Animation.json

    if(lastZipUrl) URL.revokeObjectURL(lastZipUrl);
    lastZipUrl = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = lastZipUrl;
    a.download = animData ? 'frames_construidos.zip' : 'sprites_piezas.zip';
    a.click();

    openZipBtn.style.display = 'inline-block';
    openZipBtn.onclick = ()=>window.open(lastZipUrl,'_blank');

    setStatus(animData
      ? 'ZIP de frames exportado.'
      : 'ZIP con piezas individuales listo.');
  } catch(err){
    console.error(err);
    setStatus('Error: ' + (err.message||err));
  }
});
