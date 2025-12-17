// anims.js
// Reconstruye frames desde Animation.json + atlas (spritemap PNG)
// Exports: window.exportFramesFromAnimationToZip, window.buildAtlasMap,
//          window.buildSymbolMap, window.collectFrameIndices, window.collectCommands,
//          window.bbox, window.drawFrame

(function () {
  // --- utilidades de matrices/transformaciones ---
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

  // --- fuzzy matching helpers (por si atlas tiene sufijos / diferencias) ---
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
    const al = a.length, bl = b.length;
    if (al === 0 && bl === 0) return 1;
    const dist = levenshtein(a, b);
    return 1 - (dist / Math.max(al, bl));
  }

  // --- construir mapas (atlas & symbols) ---
  function buildAtlasMap(atlasData) {
    const map = {};
    (atlasData?.ATLAS?.SPRITES || []).forEach(it => {
      const s = it.SPRITE;
      if (!s || !s.name) return;
      map[s.name] = { x: s.x, y: s.y, w: s.w, h: s.h };
    });
    return map;
  }

  function buildSymbolMap(animData) {
    const map = {};
    (animData?.SD?.S || []).forEach(sym => { if (sym?.SN) map[sym.SN] = sym; });
    return map;
  }

  // --- Recopilar índices de frames teniendo en cuenta símbolos anidados ---
  // Nota: este algoritmo intenta unir los indices globales que resultan de:
  // - FR con ASI (usar el rango I .. I+DU-1)
  // - SI (incluir I + indices internos del símbolo)
  function collectFrameIndices(mainTL, symbols) {
    const memoSymbolIndices = {};
    const visiting = new Set();

    function indicesForTL(tl) {
      const set = new Set();
      if (!tl?.L) return set;
      tl.L.forEach(layer => {
        (layer.FR || []).forEach(fr => {
          const start = fr.I || 0;
          const dur = fr.DU || 1;
          // si hay elementos ASI dentro: garantizamos su propio rango
          (fr.E || []).forEach(el => {
            if (el.ASI) {
              for (let k = start; k < start + dur; k++) set.add(k);
            } else if (el.SI) {
              const symName = el.SI.SN;
              const sub = indicesForSymbol(symName);
              sub.forEach(si => set.add(start + si));
              // también incluir la propia duración (por seguridad)
              for (let k = start; k < start + dur; k++) set.add(k);
            }
          });
        });
      });
      return set;
    }

    function indicesForSymbol(name) {
      if (!name || !symbols[name]) return new Set([0]); // símbolo desconocido -> assume frame 0
      if (memoSymbolIndices[name]) return memoSymbolIndices[name];
      if (visiting.has(name)) {
        // ciclo detectado: devolver {0} para romper ciclo
        return new Set([0]);
      }
      visiting.add(name);
      const sym = symbols[name];
      const tl = sym?.TL;
      const idxs = indicesForTL(tl);
      // si quedó vacío, al menos 0
      if (!idxs.size) idxs.add(0);
      memoSymbolIndices[name] = idxs;
      visiting.delete(name);
      return idxs;
    }

    // indices globales a partir del mainTL:
    const finalSet = new Set();
    (mainTL?.L || []).forEach(layer => {
      (layer.FR || []).forEach(fr => {
        const start = fr.I || 0;
        const dur = fr.DU || 1;
        (fr.E || []).forEach(el => {
          if (el.ASI) {
            for (let k = start; k < start + dur; k++) finalSet.add(k);
          } else if (el.SI) {
            const symName = el.SI.SN;
            const sub = indicesForSymbol(symName);
            sub.forEach(si => finalSet.add(start + si));
            // also include main duration span (safety)
            for (let k = start; k < start + dur; k++) finalSet.add(k);
          }
        });
      });
    });

    // if still empty, fallback to [0..0]
    if (!finalSet.size) finalSet.add(0);
    return [...finalSet].sort((a,b)=>a-b);
  }

  // --- Recolector de comandos por frame (ASIs y SIs recursivos) ---
  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

    function findAtlasKey(ref) {
      if (!ref) return null;
      if (atlas[ref]) return ref;
      const normRef = normalizeForMatch(ref);
      let best = null, bestScore = 0;
      for (const k in atlas) {
        const score = similarityScore(normRef, normalizeForMatch(k));
        if (score > bestScore) { best = k; bestScore = score; }
      }
      if (bestScore > 0.25) {
        console.warn(`Fuzzy match: "${ref}" -> "${best}" (score ${bestScore.toFixed(2)})`);
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
              console.warn('Imagen no encontrada (ASI):', el.ASI.N);
              return;
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
          if (!rectKey) {
            console.warn('Imagen no encontrada (main ASI):', el.ASI.N);
            return;
          }
          out.push({ rect: atlas[rectKey], transform: m3dToAffine(el.ASI.M3D || []), sourceName: rectKey });
        } else if (el.SI) {
          recurse(el.SI.SN, idx - (fr.I || 0), m3dToAffine(el.SI.M3D || []));
        }
      });
    });

    return out;
  }

  // --- bbox para un conjunto de comandos ---
  function bbox(commands) {
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
    return { minX: Math.floor(minX), minY: Math.floor(minY), maxX: Math.ceil(maxX), maxY: Math.ceil(maxY) };
  }

  function isFullyTransparent(canvas) {
    if (!canvas || canvas.width === 0 || canvas.height === 0) return true;
    const ctx = canvas.getContext('2d');
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
      return true;
    } catch (e) {
      // cross-origin? fallback assume not transparent
      return false;
    }
  }

  // --- dibuja un frame ---
  function drawFrame(commands, atlasImage) {
    if (!commands.length) return null;
    const box = bbox(commands);
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    commands.forEach(cmd => {
      const r = cmd.rect;
      const m = cmd.transform;
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } catch (e) {
        console.warn('drawImage fallo para', cmd.sourceName, e);
      }
      ctx.restore();
    });

    return c;
  }

  // --- fallbacks si queda transparente ---
  function drawFrameWithFallbacks(commands, atlasImage, setStatus) {
    let canvas = drawFrame(commands, atlasImage);
    if (canvas && !isFullyTransparent(canvas)) return canvas;

    setStatus?.('Frame transparente: intentando fallbacks...');

    // fallback 1: redondear tx/ty
    try {
      const rounded = commands.map(c => {
        const m = { ...c.transform, tx: Math.round(c.transform.tx), ty: Math.round(c.transform.ty) };
        return { rect: c.rect, transform: m, sourceName: c.sourceName };
      });
      canvas = drawFrame(rounded, atlasImage);
      if (canvas && !isFullyTransparent(canvas)) return canvas;
    } catch (e) { /* ignore */ }

    // fallback 2: pintar piezas ignorando rot/scale en la posición transformada de (0,0)
    try {
      const box = bbox(commands);
      const c = document.createElement('canvas');
      c.width = Math.max(1, box.maxX - box.minX);
      c.height = Math.max(1, box.maxY - box.minY);
      const ctx = c.getContext('2d');
      let drew = false;
      commands.forEach(cmd => {
        const r = cmd.rect, m = cmd.transform;
        const p = transformPoint(m, 0, 0);
        const dx = Math.round(p.x) - box.minX;
        const dy = Math.round(p.y) - box.minY;
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, dx, dy, r.w, r.h);
        drew = true;
      });
      if (drew && !isFullyTransparent(c)) return c;
    } catch (e) { /* ignore */ }

    // fallback 3: crear canvases por pieza y componer solo las no transparentes
    try {
      const pieceCanvases = [];
      for (const cmd of commands) {
        const r = cmd.rect;
        const pc = document.createElement('canvas');
        pc.width = Math.max(1, r.w); pc.height = Math.max(1, r.h);
        const pctx = pc.getContext('2d');
        pctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        if (!isFullyTransparent(pc)) pieceCanvases.push({ pc, cmd });
      }
      if (pieceCanvases.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pieceCanvases.forEach(({ cmd }) => {
          const p = transformPoint(cmd.transform, 0, 0);
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x + cmd.rect.w);
          maxY = Math.max(maxY, p.y + cmd.rect.h);
        });
        minX = Math.floor(minX); minY = Math.floor(minY);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(maxX) - minX);
        c.height = Math.max(1, Math.ceil(maxY) - minY);
        const ctx = c.getContext('2d');
        pieceCanvases.forEach(({ pc, cmd }) => {
          const p = transformPoint(cmd.transform, 0, 0);
          ctx.drawImage(pc, Math.round(p.x) - minX, Math.round(p.y) - minY);
        });
        if (!isFullyTransparent(c)) return c;
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  // --- promisified toBlob ---
  function canvasToBlob(canvas) {
    return new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  // --- exportación principal ---
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options = {}) {
    if (!atlasImage) throw new Error('atlasImage missing');
    if (!atlasData) throw new Error('atlasData missing');
    if (!animData) throw new Error('animData missing');

    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if (!mainTL?.L) throw new Error('Timeline principal no encontrada en animation.json');

    const frames = collectFrameIndices(mainTL, symbols);
    if (!frames.length) frames.push(0);

    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length} (idx ${idx})`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        if (!cmds.length) {
          setStatus?.(`Frame ${idx} vacío (sin comandos)`);
          if (options.previewOnly) return null;
          const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
          const blob = await canvasToBlob(tiny);
          folder.file(`empty_${String(idx).padStart(4, '0')}.png`, blob);
          continue;
        }

        let canvas = drawFrameWithFallbacks(cmds, atlasImage, setStatus);

        if (options.previewOnly) {
          if (canvas) return canvas;
          return null;
        }

        if (!canvas) {
          console.warn(`Frame ${idx}: no se pudo reconstruir -> usando primer sprite como fallback`);
          setStatus?.(`Frame ${idx}: fallback de primer sprite`);
          const r = cmds[0].rect;
          const c2 = document.createElement('canvas');
          c2.width = Math.max(1, r.w); c2.height = Math.max(1, r.h);
          c2.getContext('2d').drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          canvas = c2;
        }

        const blob = await canvasToBlob(canvas);
        const frameName = `frame_${String(idx).padStart(4, '0')}.png`;
        folder.file(frameName, blob);
      } catch (err) {
        console.error(`Error frame ${idx}:`, err);
        setStatus?.(`Error frame ${idx}: ${err.message}`);
        const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
        const blob = await canvasToBlob(tiny);
        folder.file(`error_${String(idx).padStart(4, '0')}.png`, blob);
      }
      await new Promise(r => setTimeout(r, 0));
    }

    setStatus?.('Comprimiendo ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, prog => setStatus?.(`Comprimiendo... ${Math.round(prog.percent)}%`));
    setStatus?.('ZIP generado');
    return zipBlob;
  }

  // --- Exponer ---
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = function(mainTL) { return collectFrameIndices(mainTL, buildSymbolMap({SD:{S:[]}})); }; // not ideal, but UI uses global helpers as well
  window.collectCommands = collectCommands;
  window.bbox = bbox;
  window.drawFrame = drawFrame;
})();
