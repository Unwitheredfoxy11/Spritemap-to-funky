// ui.js - Manejo de inputs, drag & drop y previsualización del PNG + overlay de rectángulos del atlas
(function() {
  let atlasImage = null, atlasData = null, animData = null, lastZipUrl = null;

  const pngInput  = document.getElementById('pngInput');
  const jsonInput = document.getElementById('jsonInput');
  const animInput = document.getElementById('animInput');

  const dropBoxPng   = document.getElementById('dropBoxPng');
  const dropBoxAtlas = document.getElementById('dropBoxAtlas');
  const dropBoxAnim  = document.getElementById('dropBoxAnim');

  const statusEl  = document.getElementById('status');
  const btn       = document.getElementById('convertir');
  const openZip   = document.getElementById('openZipTab');

  const previewPNG  = document.getElementById('previewPNG');
  const previewAnim = document.getElementById('previewAnim');

  const setStatus = m => { if(statusEl) statusEl.textContent = m; console.log('[STATUS]', m); };

  const fileToText = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(f);
  });
  const fileToDataURL = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

  function assignFileToInput(file, input) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch(e) {
      // algunos navegadores/entornos no permiten DataTransfer; en ese caso no hacemos nada
      console.warn('assignFileToInput fallback: DataTransfer no disponible', e);
    }
  }

  function setupDropBox(dropBox, input, onLoadFile) {
    if(!dropBox || !input) return;
    dropBox.addEventListener('dragover', e => {
      e.preventDefault();
      dropBox.classList.add('hover');
    });
    dropBox.addEventListener('dragleave', e => {
      e.preventDefault();
      dropBox.classList.remove('hover');
    });
    dropBox.addEventListener('drop', async e => {
      e.preventDefault();
      dropBox.classList.remove('hover');
      const files = e.dataTransfer.files;
      for (const f of files) assignFileToInput(f, input);
      input.dispatchEvent(new Event('change'));
    });

    input.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      await onLoadFile(f);
    });
  }

  // ---------------------
  // helpers: build atlas map flexible (varios formatos)
  // devuelve { name: {x,y,w,h}, ... }
  // ---------------------
  function buildAtlasMapFlexible(data){
    const map = {};
    if(!data || typeof data !== 'object') return map;

    // Caso Adobe Animate custom: data.ATLAS.SPRITES -> [{ SPRITE: { name,x,y,w,h } }, ...]
    if(data?.ATLAS?.SPRITES && Array.isArray(data.ATLAS.SPRITES)){
      data.ATLAS.SPRITES.forEach(it=>{
        const s = it.SPRITE || {};
        if(s.name) map[s.name] = { x: Number(s.x||0), y: Number(s.y||0), w: Number(s.w||0), h: Number(s.h||0) };
      });
      if(Object.keys(map).length) return map;
    }

    // Caso common (TexturePacker / PIXI): data.frames { "name.png": { frame: {x,y,w,h} } }
    if(data?.frames && typeof data.frames === 'object'){
      const frames = data.frames;
      if(Array.isArray(frames)){
        frames.forEach(f=>{
          const key = f.filename || f.name;
          const fr = f.frame || {};
          if(key) map[key] = { x: Number(fr.x||0), y: Number(fr.y||0), w: Number(fr.w||0), h: Number(fr.h||0) };
        });
      } else {
        Object.keys(frames).forEach(key=>{
          const frObj = frames[key] || {};
          const f = frObj.frame || frObj;
          map[key] = { x: Number(f.x||0), y: Number(f.y||0), w: Number(f.w||0), h: Number(f.h||0) };
        });
      }
      if(Object.keys(map).length) return map;
    }

    // Caso XML convertido u otros: buscar objetos con {x,y,w,h,name}
    function walk(o){
      if(!o || typeof o !== 'object') return;
      if('x' in o && 'y' in o && 'w' in o && 'h' in o && (o.name || o.key)) {
        const k = o.name || o.key;
        map[k] = { x: Number(o.x||0), y: Number(o.y||0), w: Number(o.w||0), h: Number(o.h||0) };
      }
      Object.values(o).forEach(v=>walk(v));
    }
    walk(data);
    return map;
  }

  // ---------------------
  // dibujar preview + overlays
  // ---------------------
  let _previewScale = 1; // escala actual (preview canvas px / atlas px)
  function redrawPreviewPNG(){
    if(!previewPNG) return;
    const ctx = previewPNG.getContext('2d');
    ctx.clearRect(0,0,previewPNG.width, previewPNG.height);
    if(!atlasImage) {
      previewPNG.style.display = 'none';
      return;
    }
    // elegir ancho máximo razonable (puedes ajustar)
    const maxPreviewWidth = Math.min(1024, atlasImage.width);
    const targetWidth = Math.min(maxPreviewWidth, atlasImage.width);
    // si el canvas style/size ya se ha establecido por CSS, respétalo; sino hacemos set
    // vamos a dimensionarlo para que quepa horizontalmente razonablemente (media pantalla)
    const desiredWidth = Math.min(800, targetWidth); // límite visual
    _previewScale = desiredWidth / atlasImage.width;
    previewPNG.width = Math.max(1, Math.floor(atlasImage.width * _previewScale));
    previewPNG.height = Math.max(1, Math.floor(atlasImage.height * _previewScale));
    previewPNG.style.display = 'block';

    // dibujar imagen escalada
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0,0,previewPNG.width, previewPNG.height);
    try {
      ctx.drawImage(atlasImage, 0, 0, atlasImage.width, atlasImage.height, 0, 0, previewPNG.width, previewPNG.height);
    } catch(e) {
      console.warn('drawImage preview fallo', e);
    }

    // si ya hay atlasData, dibujar overlays
    if(atlasData){
      const atlasMap = buildAtlasMapFlexible(atlasData);
      drawAtlasOverlays(ctx, atlasMap);
    }
  }

  function drawAtlasOverlays(ctx, atlasMap){
    if(!ctx || !atlasMap) return;
    // estilo
    const strokeColor = 'rgba(20,115,255,0.95)'; // azul fuerte
    const fillColor   = 'rgba(20,115,255,0.12)'; // relleno suave
    const lineWidthPx = Math.max(1, Math.ceil(2 * _previewScale)); // ancho acorde a escala

    ctx.save();
    ctx.lineWidth = lineWidthPx;
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;

    // dibujar cada rect
    Object.keys(atlasMap).forEach(key=>{
      const r = atlasMap[key];
      if(!r) return;
      const x = r.x * _previewScale;
      const y = r.y * _previewScale;
      const w = r.w * _previewScale;
      const h = r.h * _previewScale;
      // rellenar + borde
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); // subpixel para borde más nítido
    });

    ctx.restore();
  }

  // ---------------------
  // Cargar PNG
  // ---------------------
  setupDropBox(dropBoxPng, pngInput, async (file) => {
    setStatus('Cargando imagen...');
    try {
      const dataUrl = await fileToDataURL(file);
      const img = new Image();
      img.onload = () => {
        atlasImage = img;
        setStatus('PNG cargado');
        redrawPreviewPNG();
      };
      img.onerror = (e) => {
        setStatus('Error cargando PNG: ' + e);
        atlasImage = null;
      };
      img.src = dataUrl;
    } catch (err) {
      console.error(err);
      setStatus('Error leyendo PNG: ' + (err && err.message ? err.message : err));
    }
  });

  // ---------------------
  // Cargar Atlas JSON
  // ---------------------
  setupDropBox(dropBoxAtlas, jsonInput, async (file) => {
    try {
      atlasData = JSON.parse(await fileToText(file));
      setStatus('Atlas JSON cargado');
      // redibujar preview con overlays
      redrawPreviewPNG();
    } catch (e) {
      atlasData = null;
      setStatus('JSON atlas inválido: ' + (e && e.message ? e.message : e));
    }
  });

  // ---------------------
  // Cargar Anim JSON (solo para preview de frame si quieres)
  // ---------------------
  setupDropBox(dropBoxAnim, animInput, async (file) => {
    try {
      animData = JSON.parse(await fileToText(file));
      setStatus('Animation.json cargado');
      // si quieres que la preview del frame construido aparezca, podrías llamar a previewFirstFrame() aquí
      // previewFirstFrame();
    } catch (e) {
      animData = null;
      setStatus('Animation.json inválido: ' + (e && e.message ? e.message : e));
    }
  });

  // ---------------------
  // Exportar (usa las funciones globales anim/atlas si están)
  // ---------------------
  btn.addEventListener('click', async () => {
    try {
      if (!window.JSZip) throw new Error('JSZip no cargado');
      if (!atlasImage || !atlasData) throw new Error('Faltan archivos de atlas (PNG + JSON)');

      setStatus('Procesando...');
      let zipBlob;
      if (animData && window.exportFramesFromAnimationToZip) {
        zipBlob = await window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus);
      } else if (!animData && window.exportAtlasPieces) {
        zipBlob = await window.exportAtlasPieces(atlasImage, atlasData, setStatus);
      } else {
        // fallback: usar exportAtlasPieces interno si está (no lo hay aquí), avisar
        throw new Error('No hay función de export disponible (falta anims.js o atlas.js).');
      }

      if (!zipBlob) throw new Error('No se generó ZIP (proceso falló o fue cancelado).');

      if (lastZipUrl) URL.revokeObjectURL(lastZipUrl);
      lastZipUrl = URL.createObjectURL(zipBlob);

      const a = document.createElement('a');
      a.href = lastZipUrl;
      a.download = animData ? 'frames_construidos.zip' : 'sprites_piezas.zip';
      a.click();

      openZip.style.display = 'inline-block';
      openZip.onclick = () => window.open(lastZipUrl, '_blank');

      setStatus('ZIP listo.');
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + (err && err.message ? err.message : err));
    }
  });

  // ---------------------
  // Optional: redibujar si ventana cambia tamaño (adaptar preview)
  // ---------------------
  window.addEventListener('resize', () => {
    // pequeño debounce visual
    if (atlasImage) setTimeout(redrawPreviewPNG, 100);
  });

  // Exponer helper para debugging
  window._uiHelpers = { redrawPreviewPNG, buildAtlasMapFlexible };

})();
