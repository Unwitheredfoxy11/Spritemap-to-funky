// animAssembleOnly.js
// Ensamblador simple: no recorta piezas, coloca bitmaps del spritemap en las posiciones del animation.json
(function(){
  function buildAtlasMap(data){
    const map = {};
    if(!data) return map;
    if(data.ATLAS && Array.isArray(data.ATLAS.SPRITES)){
      data.ATLAS.SPRITES.forEach(it=>{
        const s = it.SPRITE || {};
        if(s.name) map[String(s.name)] = { x: Number(s.x||0), y: Number(s.y||0), w: Number(s.w||0), h: Number(s.h||0) };
      });
      return map;
    }
    // fallback: frames style (not expected aquí)
    if(data.frames){
      Object.keys(data.frames).forEach(k=>{
        const f = data.frames[k];
        const fr = f.frame || f;
        map[k] = { x: Number(fr.x||0), y: Number(fr.y||0), w: Number(fr.w||0), h: Number(fr.h||0) };
      });
    }
    return map;
  }

  function buildSymbolDefs(anim){
    const map = {};
    // common place in tu file: SYMBOL_DICTIONARY.Symbols -> array
    const dict = anim?.SYMBOL_DICTIONARY?.Symbols || anim?.SYMBOLS || anim?.Symbols || [];
    if(Array.isArray(dict)){
      dict.forEach(s=>{
        if(s.SYMBOL_name) map[s.SYMBOL_name] = s;
      });
    } else if (typeof dict === 'object') {
      Object.keys(dict).forEach(k=> map[k] = dict[k]);
    }
    return map;
  }

  function getDecompPos(SI){
    // prefer DecomposedMatrix.Position, fallback Matrix3D.m30/m31
    const d = SI?.DecomposedMatrix;
    if (d && d.Position) return { x: Number(d.Position.x||0), y: Number(d.Position.y||0) };
    const m = SI?.Matrix3D;
    if (m && ('m30' in m || 'm31' in m)) return { x: Number(m.m30||0), y: Number(m.m31||0) };
    return { x: 0, y: 0 };
  }

  // Extrae lista de items con {name, x, y} absolutas (usa recursion para SYMBOLs)
  function extractItemsFromFrame(frame, symbolDefs, parentOffset = {x:0,y:0}, depth=0, maxDepth=6){
    const items = [];
    if(depth > maxDepth) return items;
    const elements = frame?.elements || [];
    for(const el of elements){
      const SI = el.SYMBOL_Instance || el.SYMBOL || el;
      if(!SI) continue;

      // posición del instance (absoluta relativa al parentOffset)
      const pos = getDecompPos(SI);
      // transformación local pivot
      const pivot = (SI.transformationPoint) ? { x: Number(SI.transformationPoint.x||0), y: Number(SI.transformationPoint.y||0) } : {x:0,y:0};

      // si tiene bitmap directo -> usarlo
      if(SI.bitmap && SI.bitmap.name){
        const bmp = SI.bitmap;
        const bmpPos = bmp.Position ? { x: Number(bmp.Position.x||0), y: Number(bmp.Position.y||0) } : {x:0,y:0};
        const absX = parentOffset.x + pos.x + bmpPos.x - pivot.x;
        const absY = parentOffset.y + pos.y + bmpPos.y - pivot.y;
        items.push({ name: String(bmp.name), x: absX, y: absY });
        continue;
      }

      // si instancia directamente un sprite por nombre heurístico
      const candidate = SI.SYMBOL_name || SI.Instance_Name || SI.name;
      if(candidate && /^0{0,}\d+$/.test(String(candidate))) {
        // si es un number-like, probablemente coincide con spritemap keys como "0014"
        const absX = parentOffset.x + pos.x - pivot.x;
        const absY = parentOffset.y + pos.y - pivot.y;
        items.push({ name: String(candidate), x: absX, y: absY });
        continue;
      }

      // si referencia otro SYMBOL definido -> buscar su timeline y extraer sus primeros frames respectando offset
      const symName = SI.SYMBOL_name;
      if(symName && symbolDefs[symName]){
        const sym = symbolDefs[symName];
        // localizar la primera frame del symbol (timelines)
        const TIMELINE = sym?.TIMELINE || sym;
        let frames = [];
        if(TIMELINE?.LAYERS && Array.isArray(TIMELINE.LAYERS)){
          // concatenar frames de las capas (usamos la primera layer con frames)
          for(const L of TIMELINE.LAYERS){
            const farr = Array.isArray(L.Frames) ? L.Frames : (L.frames || []);
            if(farr && farr.length){ frames = farr; break; }
          }
        } else if(Array.isArray(sym?.Frames)) frames = sym.Frames;
        // fallback: sym.elements
        if(!frames.length && sym.elements) frames = [{ elements: sym.elements }];

        const nestedFrameIdx = Math.max(0, Math.min(frames.length-1, Number(SI.firstFrame||0)));
        const nestedFrame = frames[nestedFrameIdx] || { elements: [] };
        const newParent = { x: parentOffset.x + pos.x - pivot.x, y: parentOffset.y + pos.y - pivot.y };
        const nestedItems = extractItemsFromFrame(nestedFrame, symbolDefs, newParent, depth+1, maxDepth);
        items.push(...nestedItems);
        continue;
      }

      // último recurso: si el SI tiene children/elements directamente
      if(SI.elements && Array.isArray(SI.elements)){
        const newParent = { x: parentOffset.x + pos.x - pivot.x, y: parentOffset.y + pos.y - pivot.y };
        items.push(...extractItemsFromFrame({ elements: SI.elements }, symbolDefs, newParent, depth+1, maxDepth));
      }
    }
    return items;
  }

  // canvas -> blob
  function canvasToBlob(canvas){
    return new Promise(res=>{
      canvas.toBlob(b => res(b), 'image/png');
    });
  }

  // main export function
  async function exportAssembleOnlyZip(atlasImage, atlasData, animData, setStatus = ()=>{}){
    if(!window.JSZip) throw new Error('JSZip no cargado');
    if(!atlasImage || !atlasData || !animData) throw new Error('Faltan atlasImage/atlasData/animData');

    setStatus('Construyendo mapa de atlas...');
    const atlasMap = buildAtlasMap(atlasData);
    const symbolDefs = buildSymbolDefs(animData);

    // localizar frames del timeline principal (similar heurística a tu ui)
    const AN = animData?.ANIMATION || animData || {};
    const TIMELINE = AN.TIMELINE || AN;
    let LAYERS = [];
    if(TIMELINE && TIMELINE.LAYERS) LAYERS = TIMELINE.LAYERS;
    else if(AN.LAYERS) LAYERS = AN.LAYERS;
    else if (Array.isArray(animData)) LAYERS = animData;

    const framesList = [];
    for(const layer of (LAYERS||[])){
      const farr = Array.isArray(layer.Frames) ? layer.Frames : (layer.frames || []);
      for(let i=0;i<farr.length;i++){
        framesList.push({ layerName: layer.Layer_name || layer.name || 'Layer', frame: farr[i], frameIndex: i });
      }
    }
    if(!framesList.length) throw new Error('No se encontraron frames en animation.json');

    const zip = new window.JSZip();
    const metadata = { generatedAt: (new Date()).toISOString(), frames: [] };

    for(let i=0;i<framesList.length;i++){
      setStatus(`Procesando frame ${i+1}/${framesList.length}...`);
      const entry = framesList[i];
      const items = extractItemsFromFrame(entry.frame, symbolDefs, {x:0,y:0}, 0, 8);

      // calcular bbox (sin recortar piezas)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const drawQueue = [];
      for(const it of items){
        const key = String(it.name);
        const src = atlasMap[key] || atlasMap[key + '.png'] || atlasMap[key.replace(/^0+/, '')];
        if(!src){
          console.warn('Sprite no encontrado en atlas para', key);
          continue;
        }
        const x = Number(it.x||0);
        const y = Number(it.y||0);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + (src.w||0));
        maxY = Math.max(maxY, y + (src.h||0));
        drawQueue.push({ src, x, y, key });
      }

      if(!drawQueue.length){
        // canvas mínimo 1x1 para no tener PNG vacíos
        const c = document.createElement('canvas'); c.width = 1; c.height = 1;
        const b = await canvasToBlob(c);
        const fname = `${entry.layerName}_frame_${String(i+1).padStart(4,'0')}.png`;
        zip.file(fname, b);
        metadata.frames.push({ filename: fname, index: i, width:1, height:1, items: [] });
        continue;
      }

      if(!isFinite(minX)) minX = 0;
      if(!isFinite(minY)) minY = 0;
      const width = Math.max(1, Math.ceil(maxX - minX));
      const height = Math.max(1, Math.ceil(maxY - minY));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,width,height);

      const used = [];
      for(const q of drawQueue){
        try {
          // posición relativa dentro del canvas
          const dx = Math.round(q.x - minX);
          const dy = Math.round(q.y - minY);
          ctx.drawImage(atlasImage, q.src.x, q.src.y, q.src.w, q.src.h, dx, dy, q.src.w, q.src.h);
          used.push({ key: q.key, src:q.src, x:q.x, y:q.y });
        } catch(e){
          console.warn('drawImage fallo para', q.key, e);
        }
      }

      const blob = await canvasToBlob(canvas);
      const filename = `${entry.layerName}_frame_${String(i+1).padStart(4,'0')}.png`;
      zip.file(filename, blob);
      metadata.frames.push({ filename, index:i, width: canvas.width, height: canvas.height, bbox:{minX,minY,width:canvas.width,height:canvas.height}, items: used });
    }

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));
    setStatus('Generando ZIP...');
    const outBlob = await zip.generateAsync({ type:'blob' }, meta => setStatus(`Zipping ${Math.round(meta.percent)}%`));
    setStatus('Export listo');
    return outBlob;
  }

  window.exportAssembleOnlyZip = exportAssembleOnlyZip;
  window._animAssemble = { buildAtlasMap, buildSymbolDefs, extractItemsFromFrame };
})();