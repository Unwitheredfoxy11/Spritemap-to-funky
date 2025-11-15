// animModule.js
// Provee: window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus)
//         window.previewAnimationFrame(animData, atlasImage, atlasData, frameIndex)
// Diseñado para integrarse con tu ui.js sin modificarlo.

(function () {
  // -----------------------
  // Helpers: atlas map flexible (usa window._uiHelpers si existe)
  // -----------------------
  function buildAtlasMapFlexible_Local(data) {
    if (window && window._uiHelpers && typeof window._uiHelpers.buildAtlasMapFlexible === 'function') {
      try { return window._uiHelpers.buildAtlasMapFlexible(data); } catch (e) { /* fallback */ }
    }
    const map = {};
    if (!data || typeof data !== 'object') return map;
    if (data?.ATLAS?.SPRITES && Array.isArray(data.ATLAS.SPRITES)) {
      data.ATLAS.SPRITES.forEach(it => {
        const s = it.SPRITE || {};
        if (s.name) map[s.name] = { x: Number(s.x||0), y: Number(s.y||0), w: Number(s.w||0), h: Number(s.h||0) };
      });
      if (Object.keys(map).length) return map;
    }
    if (data?.frames && typeof data.frames === 'object') {
      const frames = data.frames;
      if (Array.isArray(frames)) {
        frames.forEach(f => {
          const key = f.filename || f.name;
          const fr = f.frame || {};
          if (key) map[key] = { x: Number(fr.x||0), y: Number(fr.y||0), w: Number(fr.w||0), h: Number(fr.h||0) };
        });
      } else {
        Object.keys(frames).forEach(key => {
          const frObj = frames[key] || {};
          const f = frObj.frame || frObj;
          map[key] = { x: Number(f.x||0), y: Number(f.y||0), w: Number(f.w||0), h: Number(f.h||0) };
        });
      }
      if (Object.keys(map).length) return map;
    }
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if ('x' in o && 'y' in o && 'w' in o && 'h' in o && (o.name || o.key)) {
        const k = o.name || o.key;
        map[k] = { x: Number(o.x||0), y: Number(o.y||0), w: Number(o.w||0), h: Number(o.h||0) };
      }
      Object.values(o).forEach(v => walk(v));
    }
    walk(data);
    return map;
  }

  // -----------------------
  // heurística para resolver nombre de sprite en atlasMap
  // -----------------------
  function findSpriteKey(atlasMap, candidateNames) {
    if (!atlasMap) return null;
    for (const c of candidateNames) {
      if (!c) continue;
      if (atlasMap[c]) return c;
      const cpng = c + ".png";
      if (atlasMap[cpng]) return cpng;
      const digits = String(c).match(/\d+/);
      if (digits && atlasMap[digits[0]]) return digits[0];
      // probar match parcial (cuando atlas keys tienen prefijo/sufijo)
      const keys = Object.keys(atlasMap);
      for (const k of keys) {
        if (!k) continue;
        if (k.includes(c) || c.includes(k)) return k;
      }
    }
    return null;
  }

  // -----------------------
  // Construcción de una imagen de frame: dibuja cada elemento sobre canvas y devuelve blob
  // Simplifica transformaciones: usa DecomposedMatrix.translate/scale/rotation si está; fallbacks razonables.
  // -----------------------
  async function buildFrameCanvas(atlasImage, atlasMap, frame, options = {}) {
    // Collect draw items with their source rects and transforms
    const items = [];
    if (frame && Array.isArray(frame.elements)) {
      for (const el of frame.elements) {
        const SI = el.SYMBOL_Instance || el.SYMBOL || el;
        const candidateNames = [SI?.SYMBOL_name, SI?.Instance_Name, SI?.symbol, SI?.name].filter(Boolean);
        const key = findSpriteKey(atlasMap, candidateNames);
        if (!key) {
          // skip if no sprite resolved
          continue;
        }
        const src = atlasMap[key];
        // position heuristics
        // prefer DecomposedMatrix.translate, fallback to transformationPoint, else 0
        const t = SI?.DecomposedMatrix || SI?.Transform || {};
        const tx = (t.translate && (t.translate.x||t.translate[0]||0)) ?? (SI?.transformationPoint?.x ?? 0);
        const ty = (t.translate && (t.translate.y||t.translate[1]||0)) ?? (SI?.transformationPoint?.y ?? 0);
        // rotation & scale
        const rot = (t.rotation ?? 0) * (Math.PI/180); // if degrees
        const sx = (t.scale && (t.scale.x||t.scale[0])) ?? (t.scaleX ?? 1);
        const sy = (t.scale && (t.scale.y||t.scale[1])) ?? (t.scaleY ?? 1);
        // anchor / pivot
        const pivot = SI?.transformationPoint || { x: 0, y: 0 };
        items.push({ key, src, tx: Number(tx||0), ty: Number(ty||0), rot: Number(rot||0), sx: Number(sx||1), sy: Number(sy||1), pivot });
      }
    }

    if (!items.length) {
      // canvas 1x1 minimal
      const c = document.createElement('canvas'); c.width=1;c.height=1;
      const ctx = c.getContext('2d'); ctx.clearRect(0,0,1,1);
      return c;
    }

    // compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const { src, tx, ty, sx, sy } = it;
      const w = (src.w || 0) * Math.abs(sx);
      const h = (src.h || 0) * Math.abs(sy);
      // aprox bounding box sin rot
      minX = Math.min(minX, tx - (it.pivot?.x || 0) * Math.abs(sx));
      minY = Math.min(minY, ty - (it.pivot?.y || 0) * Math.abs(sy));
      maxX = Math.max(maxX, tx - (it.pivot?.x || 0) * Math.abs(sx) + w);
      maxY = Math.max(maxY, ty - (it.pivot?.y || 0) * Math.abs(sy) + h);
    }
    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;
    if (!isFinite(maxX)) maxX = minX + 1;
    if (!isFinite(maxY)) maxY = minY + 1;

    // add small padding
    const pad = 2;
    minX = Math.floor(minX - pad);
    minY = Math.floor(minY - pad);
    maxX = Math.ceil(maxX + pad);
    maxY = Math.ceil(maxY + pad);

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,width,height);

    // draw items in order
    for (const it of items) {
      const s = it.src;
      if (!s) continue;
      ctx.save();
      // destination position relative to top-left of canvas
      const dx = it.tx - minX;
      const dy = it.ty - minY;
      // pivot handling: pivot given in sprite-local pixels, convert to scaled
      const pivotX = (it.pivot?.x || 0) * (it.sx || 1);
      const pivotY = (it.pivot?.y || 0) * (it.sy || 1);

      // apply transforms: translate to dx,dy then pivot, rotate, scale, draw image at -pivot
      ctx.translate(dx, dy);
      if (it.rot) ctx.rotate(it.rot);
      ctx.scale(it.sx || 1, it.sy || 1);
      // drawImage(sourceImage, sx, sy, sw, sh, dx, dy, dw, dh)
      try {
        ctx.drawImage(
          atlasImage,
          s.x, s.y, s.w, s.h,
          -pivotX, -pivotY, s.w, s.h
        );
      } catch (e) {
        console.warn('drawImage failed for sprite', s, e);
      }
      ctx.restore();
    }

    return canvas;
  }

  // -----------------------
  // Función principal: exportFramesFromAnimationToZip
  // Devuelve: Blob (zip)
  // -----------------------
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus = ()=>{}) {
    if (!window.JSZip) throw new Error('JSZip no encontrado. Carga la librería JSZip antes de usar export.');
    setStatus('Iniciando export de frames (analizando)...');

    const atlasMap = buildAtlasMapFlexible_Local(atlasData);
    if (!atlasMap || Object.keys(atlasMap).length === 0) {
      setStatus('No pude construir atlasMap desde atlasData. Abortando.');
      throw new Error('Atlas map vacío o inválido.');
    }

    // localizar frames a exportar: buscar LAYERS -> Frames (soporta varias variantes)
    const AN = animData?.ANIMATION || animData || {};
    const TIMELINE = AN.TIMELINE || AN.TIMELINE || animData.TIMELINE || AN;
    let LAYERS = [];
    if (TIMELINE && TIMELINE.LAYERS) LAYERS = TIMELINE.LAYERS;
    else if (AN.LAYERS) LAYERS = AN.LAYERS;
    else if (Array.isArray(animData)) LAYERS = animData;
    else if (Array.isArray(AN)) LAYERS = AN;

    if (!Array.isArray(LAYERS) || LAYERS.length === 0) {
      // a veces la estructura es simplemente ANIMATION.FRAMES o LAYER.Frames
      if (AN.Frames) LAYERS = [{ Layer_name: 'Layer_0', Frames: AN.Frames }];
    }

    // collect all frames from all layers (simple concat)
    const frames = [];
    for (const layer of (LAYERS||[])) {
      const farr = Array.isArray(layer.Frames) ? layer.Frames : (layer.frames || []);
      for (const f of farr) frames.push({ layerName: layer.Layer_name || layer.name || 'Layer', frame: f });
    }

    if (frames.length === 0) {
      setStatus('No encontré frames para exportar. Revisa la estructura de Animation.json.');
      throw new Error('No frames encontrados');
    }

    setStatus(`Frames detectados: ${frames.length}. Construyendo imágenes...`);

    const zip = new window.JSZip();

    // procesar cada frame secuencial (memoria friendly)
    let processed = 0;
    for (let i=0; i<frames.length; i++) {
      const entry = frames[i];
      const frameObj = entry.frame;
      processed++;
      setStatus(`Procesando frame ${processed}/${frames.length}...`);

      // build canvas for this frame
      const canvas = await buildFrameCanvas(atlasImage, atlasMap, frameObj);
      // quality: usar toBlob para PNG
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const filename = `frame_${String(i+1).padStart(4,'0')}.png`;
      zip.file(filename, blob);
    }

    setStatus('Generando ZIP (puede tardar un poco)...');
    const outBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      setStatus(`Zipping: ${Math.round(meta.percent)}%`);
    });

    setStatus('ZIP generado.');
    return outBlob;
  }

  // -----------------------
  // Preview: dibujar frameIndex en canvas #previewAnim si existe
  // -----------------------
  function previewAnimationFrame(animData, atlasImage, atlasData, frameIndex = 0) {
    const canvas = document.getElementById('previewAnim');
    if (!canvas) {
      console.warn('previewAnim canvas no encontrado en DOM.');
      return;
    }
    const atlasMap = buildAtlasMapFlexible_Local(atlasData);
    // localizar frames igual que arriba
    const AN = animData?.ANIMATION || animData || {};
    const TIMELINE = AN.TIMELINE || AN.TIMELINE || animData.TIMELINE || AN;
    let LAYERS = [];
    if (TIMELINE && TIMELINE.LAYERS) LAYERS = TIMELINE.LAYERS;
    else if (AN.LAYERS) LAYERS = AN.LAYERS;
    // collect frames
    const frames = [];
    for (const layer of (LAYERS||[])) {
      const farr = Array.isArray(layer.Frames) ? layer.Frames : (layer.frames || []);
      for (const f of farr) frames.push({ layerName: layer.Layer_name || layer.name || 'Layer', frame: f });
    }
    if (!frames.length) {
      console.warn('No frames disponibles para preview.');
      return;
    }
    const idx = Math.max(0, Math.min(frames.length-1, frameIndex));
    buildFrameCanvas(atlasImage, atlasMap, frames[idx].frame).then(cv => {
      // fit to preview canvas keeping aspect
      const ctx = canvas.getContext('2d');
      const maxW = canvas.clientWidth || 400;
      const maxH = canvas.clientHeight || 300;
      const srcW = cv.width, srcH = cv.height;
      let dw = srcW, dh = srcH;
      const scale = Math.min(maxW / srcW, maxH / srcH, 1);
      dw = Math.max(1, Math.floor(srcW * scale));
      dh = Math.max(1, Math.floor(srcH * scale));
      canvas.width = dw;
      canvas.height = dh;
      ctx.clearRect(0,0,dw,dh);
      ctx.drawImage(cv, 0, 0, dw, dh);
    }).catch(e => console.warn('preview frame error', e));
  }

  // exportar funciones al scope global que tu ui.js espera
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.previewAnimationFrame = previewAnimationFrame;

  // también exporto constructor/función auxiliar por si quieres usarla
  window._animModule = {
    buildFrameCanvas,
    buildAtlasMapFlexible: buildAtlasMapFlexible_Local,
    findSpriteKey
  };
})();