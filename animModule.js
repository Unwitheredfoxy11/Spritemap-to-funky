// animModule.js (MEJORADO)
// Reemplaza cualquier versión anterior. Exporta:
// - window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options)
// - window.previewAnimationFrame(animData, atlasImage, atlasData, frameIndex, options)
// Configuración opcional global:
// window._animModuleConfig = { fixedSize: { w:512,h:512 } , includeMetadata: true, maxRecursionDepth: 6 }

(function () {
  // util: espera a que una imagen esté cargada (si ya lo está, retorna inmediatamente)
  function waitImageLoad(img) {
    return new Promise((res, rej) => {
      if (!img) return rej(new Error('No image'));
      if (img.complete && img.naturalWidth !== 0) return res(img);
      img.addEventListener('load', () => res(img));
      img.addEventListener('error', (e) => rej(e));
      // por seguridad, timeout (10s)
      setTimeout(() => {
        if (img.complete && img.naturalWidth !== 0) return res(img);
        rej(new Error('timeout waiting for image load'));
      }, 10000);
    });
  }

  // -----------------------
  // Build atlas map (delegar si existe helper en window._uiHelpers)
  // -----------------------
  function buildAtlasMapFlexible_Local(data) {
    if (window && window._uiHelpers && typeof window._uiHelpers.buildAtlasMapFlexible === 'function') {
      try { return window._uiHelpers.buildAtlasMapFlexible(data); } catch (e) { console.warn('helper fallo', e); }
    }
    const map = {};
    if (!data || typeof data !== 'object') return map;
    if (data?.ATLAS?.SPRITES && Array.isArray(data.ATLAS.SPRITES)) {
      data.ATLAS.SPRITES.forEach(it => {
        const s = it.SPRITE || {};
        if (s.name && s.w && s.h) map[s.name] = { x: Number(s.x||0), y: Number(s.y||0), w: Number(s.w||0), h: Number(s.h||0) };
      });
      if (Object.keys(map).length) return map;
    }
    if (data?.frames && typeof data.frames === 'object') {
      const frames = data.frames;
      if (Array.isArray(frames)) {
        frames.forEach(f => {
          const key = f.filename || f.name;
          const fr = f.frame || {};
          if (key && fr.w && fr.h) map[key] = { x: Number(fr.x||0), y: Number(fr.y||0), w: Number(fr.w||0), h: Number(fr.h||0) };
        });
      } else {
        Object.keys(frames).forEach(key => {
          const frObj = frames[key] || {};
          const f = frObj.frame || frObj;
          if (f.w && f.h) map[key] = { x: Number(f.x||0), y: Number(f.y||0), w: Number(f.w||0), h: Number(f.h||0) };
        });
      }
      if (Object.keys(map).length) return map;
    }
    // deep walk
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if ('x' in o && 'y' in o && 'w' in o && 'h' in o && (o.name || o.key) && Number(o.w)>0 && Number(o.h)>0) {
        const k = o.name || o.key;
        map[k] = { x: Number(o.x||0), y: Number(o.y||0), w: Number(o.w||0), h: Number(o.h||0) };
      }
      Object.values(o).forEach(v => walk(v));
    }
    walk(data);
    return map;
  }

  // -----------------------
  // Construir mapa de símbolos (si existen definiciones dentro del animation JSON)
  // Se buscan nodos comunes: ANIMATION.SYMBOLS, AN.SYMBOLS, animData.SYMBOLS, AN.SYMBOL
  // -----------------------
  function buildSymbolDefs(animData) {
    const map = {};
    if (!animData || typeof animData !== 'object') return map;
    let AN = animData.ANIMATION || animData;
    const candidates = [AN.SYMBOLS, AN.symbols, animData.SYMBOLS, animData.symbols];
    for (const c of candidates) {
      if (!c) continue;
      if (Array.isArray(c)) {
        c.forEach(item => {
          const name = item?.name || item?.Symbol_name || item?.SYMBOL_name;
          if (name) map[name] = item;
        });
        if (Object.keys(map).length) return map;
      } else if (typeof c === 'object') {
        Object.keys(c).forEach(k => map[k] = c[k]);
        if (Object.keys(map).length) return map;
      }
    }
    // fallback: intentar buscar objetos que parezcan símbolo por recorrido
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.Type === 'SYMBOL' && (o.name || o.SYMBOL_name)) {
        map[o.name || o.SYMBOL_name] = o;
      }
      Object.values(o).forEach(v => walk(v));
    }
    walk(animData);
    return map;
  }

  // heurística para encontrar key en atlasMap
  function findSpriteKey(atlasMap, candidateNames) {
    if (!atlasMap) return null;
    const keys = Object.keys(atlasMap);
    for (const c of candidateNames) {
      if (!c) continue;
      if (atlasMap[c]) return c;
      if (atlasMap[c + '.png']) return c + '.png';
      // exacto sin extension
      const base = String(c).replace(/\.(png|jpg|jpeg)$/i, '');
      if (atlasMap[base]) return base;
      // dígitos
      const digits = String(c).match(/\d+/);
      if (digits && atlasMap[digits[0]]) return digits[0];
    }
    // parcial match (pref/suf)
    for (const c of candidateNames) {
      if (!c) continue;
      for (const k of keys) {
        if (!k) continue;
        if (k === c) return k;
        if (k.includes(c) || c.includes(k)) return k;
      }
    }
    return null;
  }

  // -----------------------
  // Render recursivo de SYMBOL: si un SYMBOL tiene su propio timeline, renderiza su frame en un canvas
  // depth para evitar loops infinitos
  // -----------------------
  async function renderSymbolToCanvas(symbolName, symbolDefs, atlasImage, atlasMap, frameIndex = 0, config = {}, depth = 0) {
    const maxDepth = config.maxRecursionDepth ?? 6;
    if (depth > maxDepth) throw new Error('Max symbol recursion depth alcanzado: ' + symbolName);
    const sym = symbolDefs[symbolName];
    if (!sym) throw new Error('Symbol definition no encontrada: ' + symbolName);

    // buscar frames en symbol: sym.TIMELINE.LAYERS[].Frames o sym.Frames
    let frames = [];
    const AN = sym.ANIMATION || sym;
    const TIMELINE = AN.TIMELINE || AN;
    if (TIMELINE && Array.isArray(TIMELINE.LAYERS)) {
      // combinar todas las layers? normalmente dentro de symbol la layer 0 indica su visual
      // tentativo: buscar la primera layer con Frames
      for (const layer of TIMELINE.LAYERS) {
        const farr = Array.isArray(layer.Frames) ? layer.Frames : (layer.frames || []);
        if (farr.length) { frames = farr; break; }
      }
    } else if (AN.Frames && Array.isArray(AN.Frames)) {
      frames = AN.Frames;
    } else {
      // tal vez sym.elements (un símbolo simple)
      if (sym.elements) frames = [{ elements: sym.elements }];
    }

    if (!frames.length) {
      // fallback: si el symbol contiene directamente elementos
      const elements = sym.elements || sym.Frame0?.elements || [];
      return await buildFrameCanvasRecursive(atlasImage, atlasMap, { elements }, symbolDefs, config, depth+1);
    }

    const idx = Math.max(0, Math.min(frames.length - 1, frameIndex));
    const frame = frames[idx];
    return await buildFrameCanvasRecursive(atlasImage, atlasMap, frame, symbolDefs, config, depth+1);
  }

  // -----------------------
  // Core builder de canvas para un frame (soporta recursión: si un SYMBOL_Instance apunta a simbolo, lo resuelve)
  // -----------------------
  async function buildFrameCanvasRecursive(atlasImage, atlasMap, frame, symbolDefs = {}, config = {}, depth = 0) {
    // Esperar atlasImage cargada
    await waitImageLoad(atlasImage).catch(() => {}); // si falla, seguiremos pero drawImage podría fallar

    // items: cada item puede ser un sprite directo o el resultado de un symbol render
    const items = [];
    if (frame && Array.isArray(frame.elements)) {
      for (const el of frame.elements) {
        const SI = el.SYMBOL_Instance || el.SYMBOL || el;
        const candidateNames = [SI?.SYMBOL_name, SI?.Instance_Name, SI?.symbol, SI?.name].filter(Boolean);
        // si el nombre coincide con un symbolDef -> render symbol recursively
        const symbolName = candidateNames.find(n => n && symbolDefs[n]);
        if (symbolName) {
          try {
            const nestedFrameIndex = SI?.firstFrame ?? 0;
            const nestedCanvas = await renderSymbolToCanvas(symbolName, symbolDefs, atlasImage, atlasMap, nestedFrameIndex, config, depth+1);
            // compute transform for nested canvas - use DecomposedMatrix or transformationPoint
            const t = SI?.DecomposedMatrix || SI?.Transform || {};
            const tx = (t.translate && (t.translate.x||t.translate[0]||0)) ?? (SI?.transformationPoint?.x ?? 0);
            const ty = (t.translate && (t.translate.y||t.translate[1]||0)) ?? (SI?.transformationPoint?.y ?? 0);
            const rot = (t.rotation ?? 0) * (Math.PI/180);
            const sx = (t.scale && (t.scale.x||t.scale[0])) ?? (t.scaleX ?? 1);
            const sy = (t.scale && (t.scale.y||t.scale[1])) ?? (t.scaleY ?? 1);
            const pivot = SI?.transformationPoint || { x: 0, y: 0 };
            items.push({ type: 'canvas', canvas: nestedCanvas, tx: Number(tx||0), ty: Number(ty||0), rot: Number(rot||0), sx: Number(sx||1), sy: Number(sy||1), pivot });
          } catch (e) {
            console.warn('Error renderizando symbol recursivo', symbolName, e);
            continue;
          }
          continue;
        }

        // si no es symbol anidado, buscar sprite en atlas
        const key = findSpriteKey(atlasMap, candidateNames);
        if (!key) {
          // no encontrado: registrar y saltar
          console.warn('Sprite no resuelto para', candidateNames);
          continue;
        }
        const src = atlasMap[key];
        if (!src || !(src.w > 0 && src.h > 0)) {
          console.warn('Sprite con w/h inválido, omitido:', key, src);
          continue;
        }

        // posición/transformaciones heurísticas
        const t = SI?.DecomposedMatrix || SI?.Transform || {};
        const tx = (t.translate && (t.translate.x||t.translate[0]||0)) ?? (SI?.transformationPoint?.x ?? 0);
        const ty = (t.translate && (t.translate.y||t.translate[1]||0)) ?? (SI?.transformationPoint?.y ?? 0);
        // rot puede estar en grados o rad; detectar si >2π asumimos grados
        let rot = Number(t.rotation || 0);
        if (Math.abs(rot) > 6.3) rot = rot * Math.PI / 180; // convertir grados -> rad si necesario
        else rot = rot; // ya en rad o muy pequeño but ok
        const sx = (t.scale && (t.scale.x||t.scale[0])) ?? (t.scaleX ?? 1);
        const sy = (t.scale && (t.scale.y||t.scale[1])) ?? (t.scaleY ?? 1);
        const pivot = SI?.transformationPoint || { x: 0, y: 0 };

        items.push({ type: 'sprite', src, tx: Number(tx||0), ty: Number(ty||0), rot: Number(rot||0), sx: Number(sx||1), sy: Number(sy||1), pivot, key });
      }
    }

    // Si no hay items -> canvas transparente pequeño (pero no vacío)
    if (!items.length) {
      const c = document.createElement('canvas'); c.width = 1; c.height = 1;
      return c;
    }

    // calcular bbox aproximado (sin rotaciones precisas para simplificar)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      if (it.type === 'sprite') {
        const w = (it.src.w || 0) * Math.abs(it.sx || 1);
        const h = (it.src.h || 0) * Math.abs(it.sy || 1);
        const px = it.pivot?.x || 0;
        const py = it.pivot?.y || 0;
        minX = Math.min(minX, it.tx - px * Math.abs(it.sx || 1));
        minY = Math.min(minY, it.ty - py * Math.abs(it.sy || 1));
        maxX = Math.max(maxX, it.tx - px * Math.abs(it.sx || 1) + w);
        maxY = Math.max(maxY, it.ty - py * Math.abs(it.sy || 1) + h);
      } else if (it.type === 'canvas') {
        const w = it.canvas.width * Math.abs(it.sx||1);
        const h = it.canvas.height * Math.abs(it.sy||1);
        const px = it.pivot?.x || 0;
        const py = it.pivot?.y || 0;
        minX = Math.min(minX, it.tx - px * Math.abs(it.sx || 1));
        minY = Math.min(minY, it.ty - py * Math.abs(it.sy || 1));
        maxX = Math.max(maxX, it.tx - px * Math.abs(it.sx || 1) + w);
        maxY = Math.max(maxY, it.ty - py * Math.abs(it.sy || 1) + h);
      }
    }
    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;
    if (!isFinite(maxX)) maxX = minX + 1;
    if (!isFinite(maxY)) maxY = minY + 1;

    // padding pequeño
    const pad = 2;
    minX = Math.floor(minX - pad);
    minY = Math.floor(minY - pad);
    maxX = Math.ceil(maxX + pad);
    maxY = Math.ceil(maxY + pad);

    let width = Math.max(1, maxX - minX);
    let height = Math.max(1, maxY - minY);

    // si config pide fixedSize, ajusta y centra
    const cfg = window._animModuleConfig || {};
    if (cfg.fixedSize && cfg.fixedSize.w && cfg.fixedSize.h) {
      const fw = Number(cfg.fixedSize.w), fh = Number(cfg.fixedSize.h);
      // redraw to fixed size and compute offset to center content
      const canvas = document.createElement('canvas');
      canvas.width = fw;
      canvas.height = fh;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,fw,fh);
      const offsetX = Math.floor((fw - width) / 2) - minX;
      const offsetY = Math.floor((fh - height) / 2) - minY;
      // dibujar items con offset
      for (const it of items) {
        ctx.save();
        const dx = (it.tx + offsetX);
        const dy = (it.ty + offsetY);
        ctx.translate(dx, dy);
        if (it.rot) ctx.rotate(it.rot);
        ctx.scale(it.sx || 1, it.sy || 1);
        if (it.type === 'sprite') {
          try {
            ctx.drawImage(atlasImage, it.src.x, it.src.y, it.src.w, it.src.h, - (it.pivot?.x || 0), - (it.pivot?.y || 0), it.src.w, it.src.h);
          } catch (e) {
            console.warn('drawImage sprite fallo', it.key, e);
          }
        } else if (it.type === 'canvas') {
          ctx.drawImage(it.canvas, - (it.pivot?.x || 0), - (it.pivot?.y || 0));
        }
        ctx.restore();
      }
      return canvas;
    }

    // crear canvas con bbox calculada
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,width,height);

    for (const it of items) {
      ctx.save();
      const dx = it.tx - minX;
      const dy = it.ty - minY;
      ctx.translate(dx, dy);
      if (it.rot) ctx.rotate(it.rot);
      ctx.scale(it.sx || 1, it.sy || 1);
      if (it.type === 'sprite') {
        try {
          ctx.drawImage(atlasImage, it.src.x, it.src.y, it.src.w, it.src.h, - (it.pivot?.x || 0), - (it.pivot?.y || 0), it.src.w, it.src.h);
        } catch (e) {
          console.warn('drawImage sprite fallo', it.key, e);
        }
      } else if (it.type === 'canvas') {
        ctx.drawImage(it.canvas, - (it.pivot?.x || 0), - (it.pivot?.y || 0));
      }
      ctx.restore();
    }

    return canvas;
  }

  // promisified canvas.toBlob
  function canvasToBlob(canvas, type='image/png', quality=0.92) {
    return new Promise((res) => {
      try {
        canvas.toBlob(b => res(b), type, quality);
      } catch (e) {
        // fallback: dataURL
        try {
          const data = canvas.toDataURL(type, quality);
          // convert to blob
          const bin = atob(data.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
          const blob = new Blob([arr], {type});
          res(blob);
        } catch (ee) {
          res(null);
        }
      }
    });
  }

  // -----------------------
  // Export principal
  // -----------------------
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus = ()=>{}, options = {}) {
    if (!window.JSZip) throw new Error('JSZip no encontrado. Carga JSZip antes de usar la exportación.');
    setStatus('Preparando export...');

    // construir atlas map & symbol defs
    const atlasMap = buildAtlasMapFlexible_Local(atlasData);
    if (!atlasMap || Object.keys(atlasMap).length === 0) {
      throw new Error('Atlas map vacío o inválido. Revisa tu spritemap JSON.');
    }

    const symbolDefs = buildSymbolDefs(animData);

    // localizar frames (soporta varias variantes)
    const AN = animData?.ANIMATION || animData || {};
    const TIMELINE = AN.TIMELINE || AN;
    let LAYERS = [];
    if (TIMELINE && TIMELINE.LAYERS) LAYERS = TIMELINE.LAYERS;
    else if (AN.LAYERS) LAYERS = AN.LAYERS;
    else if (Array.isArray(animData)) LAYERS = animData;
    else if (Array.isArray(AN)) LAYERS = AN;

    if (!Array.isArray(LAYERS) || LAYERS.length === 0) {
      if (AN.Frames) LAYERS = [{ Layer_name: 'Layer_0', Frames: AN.Frames }];
    }

    const frames = [];
    for (const layer of (LAYERS||[])) {
      const farr = Array.isArray(layer.Frames) ? layer.Frames : (layer.frames || []);
      for (let fi=0; fi<farr.length; fi++) {
        frames.push({ layerName: layer.Layer_name || layer.name || 'Layer', frame: farr[fi], frameIndex: fi });
      }
    }
    if (frames.length === 0) throw new Error('No encontré frames para exportar. Revisa Animation.json.');

    const zip = new window.JSZip();
    const metadata = { generatedAt: (new Date()).toISOString(), frames: [] };
    setStatus(`Frames detectados: ${frames.length}. Procesando...`);

    for (let i=0;i<frames.length;i++) {
      const entry = frames[i];
      setStatus(`Construyendo frame ${i+1}/${frames.length}...`);
      let canvas;
      try {
        // usar versión recursiva que acepta symbolDefs
        canvas = await buildFrameCanvasRecursive(atlasImage, atlasMap, entry.frame, symbolDefs, options, 0);
      } catch (e) {
        console.warn('Error build frame, creando canvas vacío:', e);
        const c = document.createElement('canvas'); c.width=1; c.height=1;
        canvas = c;
      }
      const blob = await canvasToBlob(canvas, 'image/png');
      const filename = `${entry.layerName}_frame_${String(i+1).padStart(4,'0')}.png`;
      if (blob) zip.file(filename, blob);
      else zip.file(filename, new Blob([], {type:'image/png'}));
      // metadata
      metadata.frames.push({
        filename,
        layer: entry.layerName,
        index: i,
        sourceFrameIndex: entry.frameIndex ?? null,
        width: canvas.width,
        height: canvas.height,
        bbox: { w: canvas.width, h: canvas.height },
      });
    }

    // incluir metadata si opción activada
    const cfg = window._animModuleConfig || {};
    const includeMetadata = ('includeMetadata' in cfg) ? cfg.includeMetadata : true;
    if (includeMetadata) {
      zip.file('metadata.json', JSON.stringify(metadata, null, 2));
    }

    setStatus('Generando ZIP...');
    const outBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      setStatus(`Zipping: ${Math.round(meta.percent)}%`);
    });

    setStatus('Export terminado.');
    return outBlob;
  }

  // -----------------------
  // Preview function (dibuja en canvas #previewAnim)
  // -----------------------
  function previewAnimationFrame(animData, atlasImage, atlasData, frameIndex = 0, options = {}) {
    const canvasEl = document.getElementById('previewAnim');
    if (!canvasEl) {
      console.warn('previewAnim no encontrado');
      return;
    }
    const atlasMap = buildAtlasMapFlexible_Local(atlasData);
    const symbolDefs = buildSymbolDefs(animData);

    // localizar frames como en export
    const AN = animData?.ANIMATION || animData || {};
    const TIMELINE = AN.TIMELINE || AN;
    let LAYERS = [];
    if (TIMELINE && TIMELINE.LAYERS) LAYERS = TIMELINE.LAYERS;
    else if (AN.LAYERS) LAYERS = AN.LAYERS;
    const frames = [];
    for (const layer of (LAYERS||[])) {
      const farr = Array.isArray(layer.Frames) ? layer.Frames : (layer.frames || []);
      for (const f of farr) frames.push({ layerName: layer.Layer_name || layer.name || 'Layer', frame: f });
    }
    if (!frames.length) {
      console.warn('No frames para previsualizar');
      return;
    }
    const idx = Math.max(0, Math.min(frames.length - 1, frameIndex));
    buildFrameCanvasRecursive(atlasImage, atlasMap, frames[idx].frame, symbolDefs, options, 0).then(cv => {
      // escalar para encajar en preview canvas manteniendo aspecto
      const maxW = canvasEl.clientWidth || 400;
      const maxH = canvasEl.clientHeight || 300;
      const srcW = cv.width, srcH = cv.height;
      const scale = Math.min(maxW / Math.max(1, srcW), maxH / Math.max(1, srcH), 1);
      const dw = Math.max(1, Math.floor(srcW * scale));
      const dh = Math.max(1, Math.floor(srcH * scale));
      canvasEl.width = dw;
      canvasEl.height = dh;
      const ctx = canvasEl.getContext('2d');
      ctx.clearRect(0,0,dw,dh);
      ctx.drawImage(cv, 0, 0, dw, dh);
    }).catch(e => console.warn('preview error', e));
  }

  // exportar al scope global
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.previewAnimationFrame = previewAnimationFrame;
  window._animModule = {
    buildFrameCanvas: buildFrameCanvasRecursive,
    buildAtlasMapFlexible: buildAtlasMapFlexible_Local,
    buildSymbolDefs,
    findSpriteKey,
    canvasToBlob
  };

})();