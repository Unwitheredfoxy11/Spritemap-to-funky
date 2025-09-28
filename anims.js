// anims.js - Robust animator for Adobe Animate JSON + atlas
// Exports:
//  - window.buildAtlasMap(atlasData)
//  - window.buildSymbolMap(animData)
//  - window.collectFrameIndices(timeline)
//  - window.collectCommands(mainTL, symbols, atlas, idx)
//  - window.bbox(commands)
//  - window.draw(commands, box, atlasImage)
//  - window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options)

(function () {
  // -------------------- Utilidades --------------------
  function m3dToAffine(m3d, trp) {
    // m3d puede ser array de 16; TRP es fallback con x,y
    if (Array.isArray(m3d) && m3d.length >= 14) {
      return {
        a: m3d[0] ?? 1, b: m3d[1] ?? 0,
        c: m3d[4] ?? 0, d: m3d[5] ?? 1,
        tx: m3d[12] ?? 0, ty: m3d[13] ?? 0
      };
    }
    // fallback a TRP u identidad
    return {
      a: 1, b: 0, c: 0, d: 1,
      tx: (trp && typeof trp.x === 'number') ? trp.x : 0,
      ty: (trp && typeof trp.y === 'number') ? trp.y : 0
    };
  }

  function mulAffine(m1, m2) {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      d: m1.b * m2.c + m1.d * m2.d,
      tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
      ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty
    };
  }

  function transformPoint(m, x, y) {
    return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
  }

  function tryGetImageData(canvas) {
    try {
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (e) {
      // CORS or other; treat as "unknown" -> assume non-empty to avoid false negatives
      return null;
    }
  }

  function isFullyTransparent(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return true;
    const d = tryGetImageData(canvas);
    if (!d) return false; // no se puede inspeccionar; asumir visible (evita false positive por CORS)
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  }

  // Normalización y fuzzy match para nombres
  function normalizeForMatch(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_\-\/\\]+/g, ' ')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (al === 0) return bl; if (bl === 0) return al;
    const v0 = new Array(bl + 1), v1 = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) v0[j] = j;
    for (let i = 0; i < al; i++) {
      v1[0] = i + 1;
      for (let j = 0; j < bl; j++) {
        const cost = a[i] === b[j] ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= bl; j++) v0[j] = v1[j];
    }
    return v1[bl];
  }

  function similarityScore(a, b) {
    a = String(a || ''); b = String(b || '');
    const maxL = Math.max(a.length, b.length);
    if (maxL === 0) return 1;
    const dist = levenshtein(a, b);
    return 1 - (dist / maxL);
  }

  // -------------------- Mapas --------------------
  function buildAtlasMap(atlasData) {
    const map = {};
    const sprites = atlasData?.ATLAS?.SPRITES || [];
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i].SPRITE;
      if (!s || !s.name) continue;
      map[s.name] = { x: s.x, y: s.y, w: s.w, h: s.h };
    }
    return map;
  }

  function buildSymbolMap(animData) {
    const map = {};
    (animData?.SD?.S || []).forEach(sym => { if (sym?.SN) map[sym.SN] = sym; });
    return map;
  }

  function collectFrameIndices(tl) {
    if (!tl || !Array.isArray(tl.L)) return [0];
    const set = new Set();
    (tl.L || []).forEach(layer => {
      (layer.FR || []).forEach(fr => {
        const start = (typeof fr.I === 'number') ? fr.I : 0;
        const dur = (typeof fr.DU === 'number') ? Math.max(1, fr.DU) : 1;
        for (let k = start; k < start + dur; k++) set.add(k);
      });
    });
    return [...set].sort((a,b) => a - b);
  }

  // -------------------- Recolector de comandos --------------------
  function collectCommands(mainTL, symbols, atlas, idx, opts = {}) {
    const out = [];
    const atlasKeys = Object.keys(atlas || {});

    function fuzzyFindAtlasKey(ref) {
      if (!ref) return null;
      if (atlas[ref]) return ref;
      // normalize & exact norm match
      const normRef = normalizeForMatch(ref);
      for (const k of atlasKeys) if (normalizeForMatch(k) === normRef) return k;
      // digits match
      const digits = (String(ref).match(/\d+/) || [''])[0];
      if (digits) {
        for (const k of atlasKeys) {
          const kd = (k.match(/\d+/) || [''])[0];
          if (kd === digits || String(Number(kd)) === String(Number(digits))) return k;
        }
      }
      // fuzzy best
      let best = null, bestScore = 0;
      for (const k of atlasKeys) {
        const score = similarityScore(normRef, normalizeForMatch(k));
        if (score > bestScore) { best = k; bestScore = score; }
      }
      if (bestScore >= 0.3) {
        console.warn(`Fuzzy atlas match: "${ref}" → "${best}" (score ${bestScore.toFixed(2)})`);
        return best;
      }
      return null;
    }

    function recurse(symbolName, localFrame, tf) {
      const sym = symbols?.[symbolName];
      if (!sym?.TL?.L) return;
      sym.TL.L.forEach(layer => {
        const fr = (layer.FR || []).find(r => localFrame >= (r.I || 0) && localFrame < (r.I || 0) + (r.DU || 1));
        if (!fr) return;
        (fr.E || []).forEach(el => {
          if (el.ASI) {
            // elemento de atlas directo
            const ref = el.ASI.N || el.ASI.n || el.ASI.FN || el.ASI.FileName;
            let key = fuzzyFindAtlasKey(ref);
            if (!key) {
              // permitir que SI apunte a símbolo en vez de atlas (no fatal)
              console.warn(`Atlas key no encontrada para "${ref}" (símbolo ${symbolName}). Se ignora.`);
              return;
            }
            const rect = atlas[key];
            const m = m3dToAffine(el.ASI.M3D || [], el.ASI.TRP || el.ASI.TR || el.ASI.TR);
            out.push({ rect, transform: mulAffine(tf, m), sourceName: key });
          } else if (el.SI) {
            const m = m3dToAffine(el.SI.M3D || [], el.SI.TRP || el.SI.TR || el.SI.TR);
            recurse(el.SI.SN, localFrame - (fr.I || 0), mulAffine(tf, m));
          }
        });
      });
    }

    (mainTL.L || []).forEach(layer => {
      const fr = (layer.FR || []).find(r => idx >= (r.I || 0) && idx < (r.I || 0) + (r.DU || 1));
      if (!fr) return;
      (fr.E || []).forEach(el => {
        if (el.ASI) {
          const ref = el.ASI.N || el.ASI.n || el.ASI.FN || el.ASI.FileName;
          const key = fuzzyFindAtlasKey(ref);
          if (!key) {
            console.warn(`Atlas key no encontrada para "${ref}" en main timeline. Se ignora.`);
            return;
          }
          const rect = atlas[key];
          const m = m3dToAffine(el.ASI.M3D || [], el.ASI.TRP || el.ASI.TR);
          out.push({ rect, transform: m, sourceName: key });
        } else if (el.SI) {
          const m = m3dToAffine(el.SI.M3D || [], el.SI.TRP || el.SI.TR);
          recurse(el.SI.SN, idx - (fr.I || 0), m);
        }
      });
    });

    return out;
  }

  // -------------------- BBox & Draw --------------------
  function bbox(commands) {
    if (!commands || !commands.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    commands.forEach(cmd => {
      if (!cmd.rect || !cmd.transform) return;
      const r = cmd.rect;
      [
        transformPoint(cmd.transform, 0, 0),
        transformPoint(cmd.transform, r.w, 0),
        transformPoint(cmd.transform, r.w, r.h),
        transformPoint(cmd.transform, 0, r.h)
      ].forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    });
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { minX: Math.floor(minX), minY: Math.floor(minY), maxX: Math.ceil(maxX), maxY: Math.ceil(maxY) };
  }

  function draw(commands, box, atlasImage) {
    // Dibuja respetando setTransform por elemento (escala/rotación/traslación)
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    // Fondo transparente por defecto
    ctx.clearRect(0, 0, c.width, c.height);

    commands.forEach(cmd => {
      if (!cmd.rect || !cmd.transform) return;
      const r = cmd.rect, m = cmd.transform;
      ctx.save();
      // Aplicamos la transform y desplazamos según box.minX/minY
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } catch (e) {
        // drawImage puede fallar por CORS o coords inválidas -> ignorar el sprite
        console.warn('drawImage falló para', cmd.sourceName, e);
      }
      ctx.restore();
    });

    // Intento de detectar fully transparent (si posible)
    if (isFullyTransparent(c)) return null;
    return c;
  }

  // -------------------- Exportación --------------------
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options = {}) {
    // options: { previewOnly: false, stopOnError: false }
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if (!mainTL || !Array.isArray(mainTL.L)) {
      throw new Error('Timeline principal no encontrada en animData');
    }

    const frames = collectFrameIndices(mainTL);
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length}`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        if (!cmds || !cmds.length) {
          // Frame vacío -> crear placeholder 1x1 transparente
          const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
          const b = await new Promise(res => tiny.toBlob(res, 'image/png'));
          folder.file(`frame_${String(idx).padStart(4, '0')}.png`, b);
          continue;
        }

        const box = bbox(cmds);
        let canvas = draw(cmds, box, atlasImage);

        // Fallback inteligente: si canvas es null (todo transparente o fallo en draw),
        // intentar dibujar sin transformaciones complejas usando tx/ty como posiciones.
        if (!canvas) {
          // Construir canvas con mismo bbox (si bbox 0, fallback a primer sprite)
          const fallbackBox = { ...box };
          if (fallbackBox.maxX === fallbackBox.minX && fallbackBox.maxY === fallbackBox.minY) {
            const r = cmds[0].rect || { w: 1, h: 1 };
            fallbackBox.minX = 0; fallbackBox.minY = 0; fallbackBox.maxX = r.w; fallbackBox.maxY = r.h;
          }
          const w2 = Math.max(1, fallbackBox.maxX - fallbackBox.minX);
          const h2 = Math.max(1, fallbackBox.maxY - fallbackBox.minY);
          const c2 = document.createElement('canvas');
          c2.width = w2; c2.height = h2;
          const ctx2 = c2.getContext('2d');
          // Dibujar cada sprite usando su transform.tx/ty como posición (ignorando escala/rotación)
          cmds.forEach(cmd => {
            const r = cmd.rect, m = cmd.transform;
            const x = Math.round((m.tx || 0) - fallbackBox.minX);
            const y = Math.round((m.ty || 0) - fallbackBox.minY);
            try {
              ctx2.drawImage(atlasImage, r.x, r.y, r.w, r.h, x, y, r.w, r.h);
            } catch (e) {
              console.warn('Fallback draw falló para', cmd.sourceName, e);
            }
          });
          if (!isFullyTransparent(c2)) canvas = c2;
          else {
            // si sigue transparente y tenemos acceso a pixel data, consideramos todo transparente
            // en caso de CORS que impide inspección, preferimos conservar el fallback para no perder frames.
            canvas = null;
          }
        }

        if (options.previewOnly) {
          // devolver el primer canvas utilizable para preview
          if (canvas) return canvas;
          // si no hay canvas, continuar buscando
          continue;
        }

        if (!canvas) {
          // nada que guardar; guardar placeholder para mantener numeración
          const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
          const b = await new Promise(res => tiny.toBlob(res, 'image/png'));
          folder.file(`frame_${String(idx).padStart(4, '0')}.png`, b);
        } else {
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          folder.file(`frame_${String(idx).padStart(4, '0')}.png`, blob);
        }
      } catch (err) {
        console.error('Error procesando frame', idx, err);
        setStatus?.(`Error frame ${idx}: ${err.message}`);
        if (options.stopOnError) throw err;
        // si no se detiene, grabamos placeholder para seguir
        const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
        const b = await new Promise(res => tiny.toBlob(res, 'image/png'));
        folder.file(`frame_${String(idx).padStart(4, '0')}.png`, b);
      }
      // yield to UI thread
      await new Promise(r => setTimeout(r, 0));
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' }, prog => {
      setStatus?.(`Comprimiendo... ${Math.round(prog.percent)}%`);
    });
    return zipBlob;
  }

  // -------------------- Exportar utilidades globales --------------------
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = collectFrameIndices;
  window.collectCommands = collectCommands;
  window.bbox = bbox;
  window.draw = draw;
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;

})();
