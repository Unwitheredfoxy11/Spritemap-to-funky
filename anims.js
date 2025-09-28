// anims.js
// Reconstruye frames desde Animation.json + atlas (spritemap PNG)
// Exports: window.exportFramesFromAnimationToZip, window.buildAtlasMap, window.buildSymbolMap,
//          window.collectFrameIndices, window.collectCommands, window.bbox, window.drawFrame

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

  // Normalización / fuzzy matching para nombres de atlas (por si no coinciden exactamente)
  function normalizeForMatch(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_\-\/\\]+/g, ' ')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function similarityScore(a, b) {
    // simple ratio basado en distancia de Levenshtein
    const al = a.length, bl = b.length;
    if (al === 0 && bl === 0) return 1;
    const dist = levenshtein(a, b);
    return 1 - (dist / Math.max(al, bl));
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

  // --- construir mapas (expuestos por compatibilidad con preview) ---
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

  // --- recolector de comandos (asimila símbolos y atlas) ---
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
        console.warn(`⚠️ Fuzzy match: "${ref}" → "${best}" (score ${bestScore.toFixed(2)})`);
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
              // no encontramos la pieza en atlas -> avisar y saltar
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
            console.warn('Imagen no encontrada (main):', el.ASI.N);
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

  // --- bounding box para un conjunto de comandos ---
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

  // --- dibuja un frame (intento normal) ---
  function drawFrame(commands, atlasImage) {
    if (!commands.length) return null;
    const box = bbox(commands);
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    // dibujar en orden (comando por comando)
    commands.forEach(cmd => {
      const r = cmd.rect;
      const m = cmd.transform;
      // adaptamos la traslación restando el minX/minY
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } catch (e) {
        // si drawImage falla, dejamos registro
        console.warn('drawImage fallo para', cmd.sourceName, e);
      }
      ctx.restore();
    });

    return c;
  }

  // --- dibuja con varios fallbacks si queda transparente ---
  function drawFrameWithFallbacks(commands, atlasImage, setStatus) {
    // intentos:
    // 1) intento normal (drawFrame)
    // 2) si totalmente transparente: intentar redibujar con transformaciones "redondeadas"
    // 3) si sigue transparente: dibujar piezas por separado (ignorar rot/scale) colocándolas en su punto de anclaje
    // 4) si todavía transparente: intentar dibujar cada pieza individual y componer las que no sean transparentes

    // 1)
    let canvas = drawFrame(commands, atlasImage);
    if (canvas && !isFullyTransparent(canvas)) return canvas;

    setStatus?.('Frame transparente: intentando fallbacks...');

    // 2) redondear transform tx/ty (a veces M3D usa floats muy pequeños)
    try {
      const roundedCmds = commands.map(c => {
        const m = { ...c.transform, tx: Math.round(c.transform.tx), ty: Math.round(c.transform.ty) };
        return { rect: c.rect, transform: m, sourceName: c.sourceName };
      });
      canvas = drawFrame(roundedCmds, atlasImage);
      if (canvas && !isFullyTransparent(canvas)) return canvas;
    } catch (e) { /* ignore */ }

    // 3) dibujar piezas ignorando rot/scale y usando el punto transformado de (0,0).
    try {
      const box = bbox(commands);
      const w = Math.max(1, box.maxX - box.minX), h = Math.max(1, box.maxY - box.minY);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');

      let drewSomething = false;
      for (const cmd of commands) {
        const r = cmd.rect;
        const m = cmd.transform;
        const topLeft = transformPoint(m, 0, 0); // anchura/punto de anclaje
        const dx = Math.round(topLeft.x) - box.minX;
        const dy = Math.round(topLeft.y) - box.minY;
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, dx, dy, r.w, r.h);
        drewSomething = true;
      }
      if (drewSomething && !isFullyTransparent(c)) return c;
      // si dibujó pero sigue transparente, seguimos
    } catch (e) { /* ignore */ }

    // 4) dibujar piezas individuales y componer solo aquellas que no son transparentes
    try {
      const pieceCanvases = [];
      for (const cmd of commands) {
        const r = cmd.rect;
        const pc = document.createElement('canvas');
        pc.width = r.w; pc.height = r.h;
        const pctx = pc.getContext('2d');
        pctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        if (!isFullyTransparent(pc)) pieceCanvases.push({ pc, cmd });
      }
      if (pieceCanvases.length) {
        // componer en bounding box mínimo que contenga las posiciones (usando transform punto 0,0)
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

    // nada funcionó
    return null;
  }

  // --- helper toBlob promisificado ---
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

    const frames = collectFrameIndices(mainTL);
    if (!frames.length) {
      // fallback: usar 0..0
      frames.push(0);
    }

    // si previewOnly: devolvemos el primer canvas que podamos generar
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length} (idx ${idx})`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        if (!cmds.length) {
          // frame vacío -> crear placeholder 1x1 transparente (pero preferimos no)
          setStatus?.(`Frame ${idx} vacío (sin comandos)`);
          if (options.previewOnly) return null;
          const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
          const blob = await canvasToBlob(tiny);
          folder.file(`empty_${String(idx).padStart(4, '0')}.png`, blob);
          continue;
        }

        // intento normal + fallback
        let canvas = drawFrameWithFallbacks(cmds, atlasImage, setStatus);

        // si previewOnly y tenemos canvas -> devolverlo inmediatamente
        if (options.previewOnly) {
          if (canvas) return canvas;
          // si no pudimos generar preview, devolver null
          return null;
        }

        if (!canvas) {
          // no pudimos armar nada razonable -> avisar y crear placeholder de la primera pieza
          console.warn(`Frame ${idx}: no se pudo reconstruir (totalmente transparente)`);
          setStatus?.(`Frame ${idx}: intento de reconstrucción fallido, usando primer sprite`);
          // fallback: tomar la primera pieza cruda
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
        // captura errores por frame; no aborta todo, solo registra y sigue
        console.error(`Error frame ${idx}:`, err);
        setStatus?.(`Error frame ${idx}: ${err.message}`);
        // opcional: crear placeholder para no perder índice
        const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
        const blob = await canvasToBlob(tiny);
        folder.file(`error_${String(idx).padStart(4, '0')}.png`, blob);
      }
      // liberamos el event-loop para que la UI no se congele
      await new Promise(r => setTimeout(r, 0));
    }

    setStatus?.('Comprimiendo ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, prog => setStatus?.(`Comprimiendo... ${Math.round(prog.percent)}%`));
    setStatus?.('ZIP generado');
    return zipBlob;
  }

  // --- exponer utilidades globalmente (ui.js las usa para preview) ---
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = collectFrameIndices;
  window.collectCommands = collectCommands;
  window.bbox = bbox;
  window.drawFrame = drawFrame;
})();
