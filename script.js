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
// (todo el bloque de utilidades, matrices, collectCommandsForFrame,
// computeBoundingBox, drawCommandsToCanvas, frameBaseNameForCommands, etc.)
// --- PEGADO AQUÍ EXACTAMENTE IGUAL ---
// (No lo copio aquí para no alargar, pero usa el mismo que ya tenías)

async function exportFramesFromAnimationToZip(){
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
