// anims.js
// Reconstruye frames desde anim.json y atlas, con tolerancia y fallback.

(function () {
  // --- utilidades de transformaciones ---
  function m3dToAffine(m3d) {
    return {
      a: m3d?.[0] ?? 1, b: m3d?.[1] ?? 0,
      c: m3d?.[4] ?? 0, d: m3d?.[5] ?? 1,
      tx: m3d?.[12] ?? 0, ty: m3d?.[13] ?? 0
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

  // --- fuzzy matching util (normalize + levenshtein) ---
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
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
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

  // --- mapas --- 
  function buildAtlasMap(atlasData) {
    const map = {};
    (atlasData?.ATLAS?.SPRITES || []).forEach(it => {
      const s = it.SPRITE;
      map[s.name] = { x: s.x, y: s.y, w: s.w, h: s.h };
    });
    return map;
  }
  function buildSymbolMap(animData) {
    const map = {};
    (animData?.SD?.S || []).forEach(sym => { map[sym.SN] = sym; });
    return map;
  }
  function collectFrameIndices(tl) {
    const set = new Set();
    (tl?.L || []).forEach(layer =>
      (layer.FR || []).forEach(fr => {
        const start = fr.I || 0;
        const dur = fr.DU || 1;
        for (let k = start; k < start + dur; k++) set.add(k);
      })
    );
    return [...set].sort((a, b) => a - b);
  }

  // --- collector de comandos con fallback fuzzy ---
  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

    function findAtlasKey(ref) {
      if (!ref) return null;
      // intento directo
      if (atlas[ref]) return ref;
      // intentar sin padding zero / sin ext
      const stripped = String(ref).replace(/^0+/, '') || ref;
      if (atlas[stripped]) return stripped;
      const normRef = normalizeForMatch(ref);
      let best = null, bestScore = 0;
      for (const k in atlas) {
        const score = similarityScore(normRef, normalizeForMatch(k));
        if (score > bestScore) { best = k; bestScore = score; }
      }
      if (bestScore > 0.3) { // tolerancia
        console.warn(`⚠️ Fuzzy atlas match: "${ref}" → "${best}" (score ${bestScore.toFixed(2)})`);
        return best;
      }
      return null;
    }

    function recurse(name, localFrame, tf) {
      const sym = symbols[name];
      if (!sym?.TL?.L) return;
      sym.TL.L.forEach(layer => {
        const fr = (layer.FR || []).find(r =>
          localFrame >= (r.I || 0) && localFrame < (r.I || 0) + (r.DU || 1)
        );
        if (!fr) return;
        (fr.E || []).forEach(el => {
          if (el.ASI) {
            const rectKey = findAtlasKey(el.ASI.N);
            if (!rectKey) {
              // no encontrado → ignorar (se puede loggear)
              throw new Error(`Imagen not found: ${el.ASI.N}`);
            }
            const rect = atlas[rectKey];
            const m = m3dToAffine(el.ASI.M3D || []);
            out.push({ rect, transform: mulAffine(tf, m), sourceName: rectKey });
          } else if (el.SI) {
            const m = m3dToAffine(el.SI.M3D || []);
            recurse(el.SI.SN, localFrame - (fr.I || 0), mulAffine(tf, m));
          }
        });
      });
    }

    (mainTL?.L || []).forEach(layer => {
      const fr = (layer.FR || []).find(r =>
        idx >= (r.I || 0) && idx < (r.I || 0) + (r.DU || 1)
      );
      if (!fr) return;
      (fr.E || []).forEach(el => {
        if (el.ASI) {
          const rectKey = findAtlasKey(el.ASI.N);
          if (!rectKey) throw new Error(`Imagen not found: ${el.ASI.N}`);
          out.push({ rect: atlas[rectKey], transform: m3dToAffine(el.ASI.M3D || []), sourceName: rectKey });
        } else if (el.SI) {
          recurse(el.SI.SN, idx - (fr.I || 0), m3dToAffine(el.SI.M3D || []));
        }
      });
    });

    return out;
  }

  // --- bbox/dibujo de un frame compuesto (UN canvas por frame) ---
  function bboxForCommands(commands) {
    if (!commands.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    commands.forEach(cmd => {
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
    return {
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      maxX: Math.ceil(maxX),
      maxY: Math.ceil(maxY)
    };
  }

  function isFullyTransparent(canvas) {
    if (!canvas) return true;
    const ctx = canvas.getContext('2d');
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    } catch (e) {
      // cross-origin problems? assume not transparent to avoid false positives
      return false;
    }
    return true;
  }

  function frameName(commands, idx, animName) {
    const names = [...new Set(commands.map(c => c.sourceName || 'frame'))];
    const base = (animName || names[0] || 'frame').replace(/\s+/g, '_');
    return `${base}_${String(idx).padStart(4, '0')}`;
  }

  function drawFrame(commands, atlasImage) {
    if (!commands || !commands.length) return null;
    const box = bboxForCommands(commands);
    const width = Math.max(1, box.maxX - box.minX);
    const height = Math.max(1, box.maxY - box.minY);
    const c = document.createElement('canvas');
    c.width = Math.ceil(width);
    c.height = Math.ceil(height);
    const ctx = c.getContext('2d');

    // dibujar todas las piezas con su transform global
    commands.forEach(cmd => {
      const r = cmd.rect, m = cmd.transform;
      // aplicar transform y compensar por minX/minY
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } catch (e) {
        // si drawImage falla por alguna razón, lo registramos y seguimos
        console.warn('drawImage failed for rect', r, e);
      }
      ctx.restore();
    });

    if (isFullyTransparent(c)) return null;
    return c;
  }

  // --- exportación principal ---
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options = {}) {
    if (!atlasImage || !atlasData) throw new Error('Faltan atlasImage/atlasData');
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if (!mainTL?.L) throw new Error('Timeline principal no encontrada');
    const frames = collectFrameIndices(mainTL);
    // si no hay frames (raro), al menos procesar 0
    if (!frames.length) frames.push(0);

    // si previewOnly queremos devolver el primer canvas válido (no transparente)
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length}`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        if (!cmds.length) {
          // sin comandos → saltearlo (o crear placeholder)
          console.warn(`Frame ${idx} no tiene comandos`);
          if (options.previewOnly) continue;
          // crear placeholder 1x1
          const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
          const blobTiny = await new Promise(res => tiny.toBlob(res, 'image/png'));
          folder.file(`empty_${String(idx).padStart(4, '0')}.png`, blobTiny);
          continue;
        }

        // composición normal
        let canvas = drawFrame(cmds, atlasImage);

        // fallback 1: intentar con rounding de tx/ty (evita subpixel artefactos)
        if (!canvas) {
          const roundedCmds = cmds.map(c => {
            return {
              rect: c.rect,
              transform: { a: c.transform.a, b: c.transform.b, c: c.transform.c, d: c.transform.d, tx: Math.round(c.transform.tx), ty: Math.round(c.transform.ty) },
              sourceName: c.sourceName
            };
          });
          canvas = drawFrame(roundedCmds, atlasImage);
        }

        // fallback 2: dibujar ignorando transformaciones complejas (solo traducción + scale)
        if (!canvas) {
          const box = bboxForCommands(cmds);
          const c = document.createElement('canvas');
          c.width = Math.max(1, box.maxX - box.minX);
          c.height = Math.max(1, box.maxY - box.minY);
          const ctx = c.getContext('2d');
          cmds.forEach(cmd => {
            const r = cmd.rect, m = cmd.transform;
            // aproximar: sólo usar tx, ty y scale aprox (a,d)
            const sx = m.a || 1, sy = m.d || 1;
            const dx = Math.round((m.tx || 0) - box.minX), dy = Math.round((m.ty || 0) - box.minY);
            ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, dx, dy, Math.round(r.w * sx), Math.round(r.h * sy));
          });
          if (!isFullyTransparent(c)) canvas = c;
        }

        // si previewOnly: devolver el primer canvas válido
        if (options.previewOnly && canvas) {
          return canvas;
        }

        // si no hay canvas aun, crear placeholder y registrar warning (no abortamos)
        if (!canvas) {
          console.warn(`Frame ${idx} resultó transparente o no pudo reconstruirse.`);
          const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
          const blobTiny = await new Promise(res => tiny.toBlob(res, 'image/png'));
          folder.file(`failed_${String(idx).padStart(4, '0')}.png`, blobTiny);
        } else {
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          folder.file(frameName(cmds, idx, animData?.AN?.N || animData?.N) + ".png", blob);
        }
      } catch (err) {
        console.error('Error procesando frame', idx, err);
        setStatus?.(`Error frame ${idx}: ${err.message}`);
        // no abortamos todo; guardamos placeholder
        const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
        const blobTiny = await new Promise(res => tiny.toBlob(res, 'image/png'));
        folder.file(`error_${String(idx).padStart(4, '0')}.png`, blobTiny);
      }

      // allow UI breathe
      await new Promise(r => setTimeout(r, 0));
    }

    // si previewOnly y no retornamos (no frame válido), lanzar error
    if (options.previewOnly) throw new Error('No se pudo generar ningún frame para preview');

    // generar zip
    const zipBlob = await zip.generateAsync({ type: 'blob' }, m => setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`));
    return zipBlob;
  }

  // --- Exponer funciones útiles (para UI/debug) ---
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = collectFrameIndices;
  window.collectCommands = collectCommands;
  window.bboxForCommands = bboxForCommands;
})();
