// ui.js
// Maneja la interfaz HTML y orquesta atlas.js / anim.js

(() => {
  // estado global (controlado aquí)
  let atlasImage = null;
  let atlasData = null;
  let animData = null;
  let lastZipUrl = null;
  let currentController = null;

  // elementos UI
  const pngInput       = document.getElementById('pngInput');
  const atlasJsonInput = document.getElementById('jsonInput');
  const animJsonInput  = document.getElementById('animInput');
  const statusEl       = document.getElementById('status');
  const convertirBtn   = document.getElementById('convertir');
  const openZipBtn     = document.getElementById('openZipTab');

  // helpers UI
  function setStatus(msg){ if(statusEl) statusEl.textContent = msg; console.log('[STATUS]', msg); }
  function log(msg){ console.log('[LOG]', msg); }
  function fileToText(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsText(f); }); }
  function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsDataURL(f); }); }

  // carga de PNG + optimized via createImageBitmap
  async function loadImageFromFile(file){
    if(!file) throw new Error('No file provided');
    // support large images, use createImageBitmap if available
    const dataUrl = await fileToDataURL(file);
    return await new Promise((res, rej)=>{
      const img = new Image();
      img.onload = async ()=>{
        try {
          if(window.createImageBitmap){
            // convert to ImageBitmap for faster drawImage if needed
            try {
              const bmp = await createImageBitmap(img);
              res(bmp);
              return;
            } catch(e){
              // fallback to Image element
            }
          }
          res(img);
        } catch(err){
          rej(err);
        }
      };
      img.onerror = ()=> rej(new Error('Error cargando imagen'));
      img.src = dataUrl;
    });
  }

  // Handlers de input
  pngInput.addEventListener('change', async e=>{
    const f = e.target.files?.[0];
    if(!f){ setStatus('No seleccionaste la imagen del atlas.'); return; }
    setStatus('Cargando imagen...');
    try {
      atlasImage = await loadImageFromFile(f);
      setStatus('PNG del atlas cargado.');
    } catch(err){
      console.error(err);
      setStatus('Error cargando PNG: '+(err.message||err));
    }
  });

  atlasJsonInput.addEventListener('change', async e=>{
    const f = e.target.files?.[0];
    if(!f){ setStatus('No seleccionaste el JSON del atlas.'); return; }
    setStatus('Leyendo JSON del atlas...');
    try {
      atlasData = JSON.parse(await fileToText(f));
      setStatus('JSON del atlas cargado.');
    } catch(err){
      atlasData = null;
      console.error(err);
      setStatus('Error leyendo JSON del atlas: '+(err.message||err));
    }
  });

  animJsonInput.addEventListener('change', async e=>{
    const f = e.target.files?.[0];
    if(!f){ animData = null; setStatus('Animation.json no seleccionado (modo solo piezas).'); return; }
    setStatus('Leyendo Animation.json...');
    try {
      animData = JSON.parse(await fileToText(f));
      setStatus('Animation.json cargado (modo animación).');
    } catch(err){
      animData = null;
      console.error(err);
      setStatus('Error leyendo Animation.json: '+(err.message||err));
    }
  });

  // Cancelación
  window.cancelProcessing = () => {
    if(currentController){
      currentController.abort();
      setStatus('Operación cancelada por usuario.');
    }
  };

  // Orquestador
  convertirBtn.addEventListener('click', async ()=>{
    try {
      if(!window.JSZip) throw new Error('JSZip no cargado. Incluye la librería antes de estos scripts.');
      if(!atlasImage || !atlasData) throw new Error('Debes cargar PNG y JSON del atlas.');

      // crear controller para cancelar si es necesario
      currentController = new AbortController();
      const signal = currentController.signal;

      // callbacks para progreso y logging desde los módulos
      const commonOpts = {
        signal,
        onProgress: (pct, msg) => {
          if(msg) setStatus(msg);
          if(typeof pct === 'number') log(`Progress: ${pct}% ${msg||''}`);
        },
        onLog: (m) => { if(m) log(m); }
      };

      setStatus('Procesando...');

      let zipBlob;
      if(animData){
        zipBlob = await window.exportFramesFromAnimationToZip({
          atlasImage, atlasData, animData,
          options: {...commonOpts, frameNamePad:4, maxCanvasSide:4000}
        });
      } else {
        zipBlob = await window.exportAtlasPieces({
          atlasImage, atlasData,
          options: {...commonOpts, maxCanvasSide:4000}
        });
      }

      if(!zipBlob) throw new Error('No se generó ZIP (proceso falló o fue cancelado).');

      if(lastZipUrl) URL.revokeObjectURL(lastZipUrl);
      lastZipUrl = URL.createObjectURL(zipBlob);

      const a = document.createElement('a');
      a.href = lastZipUrl;
      a.download = animData ? 'frames_construidos.zip' : 'sprites_piezas.zip';
      a.click();

      openZipBtn.style.display = 'inline-block';
      openZipBtn.onclick = ()=> window.open(lastZipUrl, '_blank');

      setStatus(animData ? 'ZIP de frames exportado.' : 'ZIP con piezas individuales listo.');

    } catch(err){
      console.error(err);
      setStatus('Error: ' + (err.message || err));
    } finally {
      currentController = null;
    }
  });

  // Exponer utilidades para debugging
  window._appState = { get atlasImage(){ return atlasImage; }, get atlasData(){ return atlasData; }, get animData(){ return animData } };
})();