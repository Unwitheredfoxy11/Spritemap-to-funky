// atlas.js
// Exporta piezas sueltas desde un atlas (varios formatos compatibles)
// Devuelve Promise<Blob> con ZIP (JSZip debe estar cargado)

(() => {
  function sanitizeFileName(name){
    return String(name || 'file').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/\s+/g,'_');
  }

  // detecta distintos layouts de JSON de atlas y construye un mapa {name:{x,y,w,h}}
  function buildAtlasMapFlexible(data){
    const map = {};

    // Caso 1: estructura original: data.ATLAS.SPRITES => array of { SPRITE: {name,x,y,w,h} }
    if(data?.ATLAS?.SPRITES && Array.isArray(data.ATLAS.SPRITES)){
      data.ATLAS.SPRITES.forEach(it=>{
        const s = it.SPRITE || {};
        if(!s.name) return;
        map[s.name] = { x: s.x||0, y: s.y||0, w: s.w||0, h: s.h||0 };
      });
      return map;
    }

    // Caso 2: common format: data.frames = { "name.png": { frame: {x,y,w,h}, rotated, trimmed, spriteSourceSize } }
    if(data?.frames && typeof data.frames === 'object'){
      const frames = data.frames;
      // frames puede ser array o map
      if(Array.isArray(frames)){
        frames.forEach(f => {
          const key = f.filename || f.name || (f.frame && f.frame.name);
          const fr = f.frame || {};
          if(key) map[key] = { x: fr.x||0, y: fr.y||0, w: fr.w||0, h: fr.h||0 };
        });
      } else {
        Object.keys(frames).forEach(key=>{
          const frObj = frames[key];
          const f = frObj.frame || frObj;
          map[key] = { x: f.x||0, y: f.y||0, w: f.w||0, h: f.h||0 };
        });
      }
      return map;
    }

    // Caso 3: some other custom structures - try to find any objects with x,y,w,h
    function walk(o){
      if(!o || typeof o !== 'object') return;
      if('x' in o && 'y' in o && 'w' in o && 'h' in o && o.name){
        map[o.name] = { x:o.x, y:o.y, w:o.w, h:o.h };
      }
      Object.values(o).forEach(v=>walk(v));
    }
    walk(data);
    return map;
  }

  // canvasToBlob helper (acepta ImageBitmap o HTMLImageElement)
  function canvasToBlob(canvas){ return new Promise(res => canvas.toBlob(res,'image/png')); }

  // restricción de máximo lado del canvas (evita OOM). Si hace falta escala.
  function ensureCanvasWithinLimits(width, height, maxSide){
    if(maxSide && Math.max(width, height) > maxSide){
      const scale = maxSide / Math.max(width, height);
      return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
    }
    return { width, height, scale: 1 };
  }

  async function exportAtlasPieces({ atlasImage, atlasData, options = {} }){
    const { signal, onProgress, onLog, maxCanvasSide = 4000 } = options || {};
    if(signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    if(!atlasImage) throw new Error('atlasImage requerido');
    if(!atlasData) throw new Error('atlasData requerido');

    const atlasMap = buildAtlasMapFlexible(atlasData);
    const keys = Object.keys(atlasMap);
    if(keys.length === 0) throw new Error('No se encontraron sprites en atlasData');

    const zip = new JSZip();
    const folder = zip.folder('pieces');

    for(let i=0;i<keys.length;i++){
      if(signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const name = keys[i];
      const rect = atlasMap[name];
      const safeName = sanitizeFileName(name).replace(/\.[^.]+$/, '') + '.png';

      // make canvas with safe dimensions, possibly scaled if huge
      const dims = ensureCanvasWithinLimits(rect.w, rect.h, maxCanvasSide);
      const c = document.createElement('canvas');
      c.width = dims.width;
      c.height = dims.height;
      const ctx = c.getContext('2d');

      // draw scaled if needed (use drawImage with source rect and dest scaled)
      ctx.drawImage(
        atlasImage,
        rect.x, rect.y, rect.w, rect.h,
        0, 0, dims.width, dims.height
      );

      const blob = await canvasToBlob(c);
      folder.file(safeName, blob);

      const percent = Math.round(((i+1)/keys.length)*100);
      if(onProgress) onProgress(percent, `Recortado ${safeName} (${i+1}/${keys.length})`);
      if(onLog) onLog(`piece ${i+1}/${keys.length}: ${safeName}`);
      // yield to event loop
      await new Promise(r=>setTimeout(r,0));
    }

    if(signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if(onProgress) onProgress(0, 'Comprimiendo piezas...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, meta => {
      if(onProgress) onProgress(Math.round(meta.percent), 'Comprimiendo piezas...');
    });
    return zipBlob;
  }

  // Exponer globalmente
  window.exportAtlasPieces = exportAtlasPieces;
  window._atlasUtils = { buildAtlasMapFlexible, sanitizeFileName };
})();