// anims.js
// Reconstruye frames desde Animation.json + atlas (spritemap PNG)
// Exporta:
//   window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options)
//   window.buildAtlasMap, window.buildSymbolMap, window.collectFrameIndices,
//   window.collectCommands, window.bbox, window.drawFrame

(function () {
  // -------------------------
  // Utilidades de transform
  // -------------------------
  function m3dToAffine(m3d) {
    // M3D viene como array de 16 (col-major / row-major según fuente), aquí usamos
    // indices comunes que viste en los JSON: [a, b, c, d, e, f, ..., tx, ty,...] con tx index 12, ty index 13.
    return {
      a: (m3d && m3d[0] != null) ? m3d[0] : 1,
      b: (m3d && m3d[1] != null) ? m3d[1] : 0,
      c: (m3d && m3d[4] != null) ? m3d[4] : 0,
      d: (m3d && m3d[5] != null) ? m3d[5] : 1,
      tx: (m3d && m3d[12] != null) ? m3d[12] : 0,
      ty: (m3d && m3d[13] != null) ? m3d[13] : 0
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

  // -------------------------
  // Fuzzy matching para atlas
  // -------------------------
  function normalizeForMatch(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '') // quitar extensión
      .replace(/[_\-\s\/\\]+/g, ' ')
      .replace(/[^a-z0-9\s]+/g, ' ')
      .trim();
  }

  function levenshtein(a, b) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let v0 = new Array(bl + 1), v1 = new Array(bl + 1);
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
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const dist = levenshtein(a, b);
    return 1 - (dist / Math.max(a.length, b.length));
  }

  // -------------------------
  // Mapas (expuestos)
  // -------------------------
  function buildAtlasMap(atlasData) {
    const map = {};
    const sprites = atlasData?.ATLAS?.SPRITES || [];
    for (const spr of sprites) {
      const s = spr.SPRITE;
      if (!s) continue;
      map[s.name] = { x: s.x, y: s.y, w: s.w, h: s.h };
    }
    return map;
  }

  function buildSymbolMap(animData) {
    const map = {};
    const syms = animData?.SD?.S || [];
    for (const s of syms) map[s.SN] = s;
    return map;
  }

  function collectFrameIndices(tl) {
    // Expande según I y DU (DU = duración)
    const set = new Set();
    if (!tl || !tl.L) return [];
    for (const layer of tl.L) {
      const frs = layer.FR || [];
      for (const fr of frs) {
        const start = fr.I || 0;
        const dur = Math.max(1, fr.DU || 1);
        for (let k = start; k < start + dur; k++) set.add(k);
      }
    }
    return [...set].sort((a, b) => a - b);
  }

  // -------------------------
  // Recolector de comandos
  // -------------------------
  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

    function findAtlasKey(ref) {
      if (!ref) return null;
      if (atlas[ref]) return ref;
      const normRef = normalizeForMatch(ref);
      let best = null, bestScore = 0;
      for (const k in atlas) {
        const score = similarityScore(normRef, normalizeForMatch(k));
        if (score > bestScore) { bestScore = score; best = k; }
      }
      if (bestScore > 0.30) { // umbral conservador
        console.warn(`Fuzzy atlas match: "${ref}" → "${best}" (score ${bestScore.toFixed(2)})`);
        return best;
      }
      return null;
    }

    function recurse(symName, localFrame, tf) {
      const sym = symbols[symName];
      if (!sym || !sym.TL || !sym.TL.L) return;
      for (const layer of sym.TL.L) {
        const fr = (layer.FR || []).find(r => localFrame >= (r.I || 0) && localFrame < (r.I || 0) + (r.DU || 1));
        if (!fr) continue;
        for (const el of fr.E || []) {
          if (el.ASI) {
            const key = findAtlasKey(el.ASI.N);
            if (!key) {
              console.warn('Piece missing in atlas (ASI):', el.ASI.N);
              continue;
            }
            const rect = atlas[key];
            const m = m3dToAffine(el.ASI.M3D || []);
            out.push({ rect, transform: mulAffine(tf, m), sourceName: key });
          } else if (el.SI) {
            const m = m3dToAffine(el.SI.M3D || []);
            recurse(el.SI.SN, localFrame - (fr.I || 0), mulAffine(tf, m));
          }
        }
      }
    }

    // recorrer main timeline (AN.TL or TL)
    for (const layer of (mainTL?.L || [])) {
      const fr = (layer.FR || []).find(r => idx >= (r.I || 0) && idx < (r.I || 0) + (r.DU || 1));
      if (!fr) continue;
      for (const el of fr.E || []) {
        if (el.ASI) {
          const key = findAtlasKey(el.ASI.N);
          if (!key) { console.warn('Piece missing in atlas (main):', el.ASI.N); continue; }
          out.push({ rect: atlas[key], transform: m3dToAffine(el.ASI.M3D || []), sourceName: key });
        } else if (el.SI) {
          const m = m3dToAffine(el.SI.M3D || []);
          recurse(el.SI.SN, idx - (fr.I || 0), m);
        }
      }
    }

    return out;
  }

  // -------------------------
  // Bounding box / draw
  // -------------------------
  function bbox(commands) {
    if (!commands || !commands.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cmd of commands) {
      const r = cmd.rect;
      const corners = [
        transformPoint(cmd.transform, 0, 0),
        transformPoint(cmd.transform, r.w, 0),
        transformPoint(cmd.transform, r.w, r.h),
        transformPoint(cmd.transform, 0, r.h)
      ];
      for (const p of corners) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
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
      // Si hay problema (CORS), asumimos que no está completamente transparente para evitar falsos negativos.
      return false;
    }
  }

  function drawFrame(commands, atlasImage) {
    if (!commands || !commands.length) return null;
    const box = bbox(commands);
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    // dibujar en orden tal como vienen los comandos
    for (const cmd of commands) {
      const r = cmd.rect, m = cmd.transform;
      ctx.save();
      // trasladamos para que el bounding box comience en 0,0
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } catch (e) {
        console.warn('drawImage fallo para', cmd.sourceName, e);
      }
      ctx.restore();
    }

    return c;
  }

  // Fallbacks si el canvas sale totalmente transparente
  function drawFrameWithFallbacks(commands, atlasImage, setStatus) {
    // 1) intento directo
    let canvas = drawFrame(commands, atlasImage);
    if (canvas && !isFullyTransparent(canvas)) return canvas;

    setStatus?.('Frame transparente: intentando fallbacks...');

    // 2) Intento con translation redondeada (a veces floats muy pequeños)
    try {
      const rounded = commands.map(c => ({ rect: c.rect, transform: { ...c.transform, tx: Math.round(c.transform.tx), ty: Math.round(c.transform.ty) }, sourceName: c.sourceName }));
      canvas = drawFrame(rounded, atlasImage);
      if (canvas && !isFullyTransparent(canvas)) return canvas;
    } catch (e) { /* ignore */ }

    // 3) Ignorar rot/scale: dibujar cada pieza en su punto (transformPoint(0,0)), redondeado
    try {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const pieces = [];
      for (const cmd of commands) {
        const p0 = transformPoint(cmd.transform, 0, 0);
        minX = Math.min(minX, Math.round(p0.x));
        minY = Math.min(minY, Math.round(p0.y));
        maxX = Math.max(maxX, Math.round(p0.x) + cmd.rect.w);
        maxY = Math.max(maxY, Math.round(p0.y) + cmd.rect.h);
        pieces.push({ cmd, pos: p0 });
      }
      if (pieces.length) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(maxX) - Math.floor(minX));
        c.height = Math.max(1, Math.ceil(maxY) - Math.floor(minY));
        const ctx = c.getContext('2d');
        for (const p of pieces) {
          const dx = Math.round(p.pos.x) - Math.floor(minX);
          const dy = Math.round(p.pos.y) - Math.floor(minY);
          ctx.drawImage(atlasImage, p.cmd.rect.x, p.cmd.rect.y, p.cmd.rect.w, p.cmd.rect.h, dx, dy, p.cmd.rect.w, p.cmd.rect.h);
        }
        if (!isFullyTransparent(c)) return c;
      }
    } catch (e) { /* ignore */ }

    // 4) Dibujar piezas individuales y componer solo las no-transparentes (evita piezas que sean totalmente alpha)
    try {
      const pieceCanvases = [];
      for (const cmd of commands) {
        const pc = document.createElement('canvas');
        pc.width = Math.max(1, cmd.rect.w);
        pc.height = Math.max(1, cmd.rect.h);
        const pctx = pc.getContext('2d');
        pctx.drawImage(atlasImage, cmd.rect.x, cmd.rect.y, cmd.rect.w, cmd.rect.h, 0, 0, cmd.rect.w, cmd.rect.h);
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

    // nada sirvió
    return null;
  }

  // -------------------------
  // Helpers async
  // -------------------------
  function canvasToBlob(canvas) {
    return new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  // -------------------------
  // Exportación principal
  // -------------------------
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options = {}) {
    if (!atlasImage) throw new Error('atlasImage missing');
    if (!atlasData) throw new Error('atlasData missing');
    if (!animData) throw new Error('animData missing');

    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if (!mainTL || !mainTL.L) throw new Error('Timeline principal no encontrada en animation.json');

    const frames = collectFrameIndices(mainTL);
    if (!frames.length) {
      // fallback mínimo
      frames.push(0);
    }

    // Si previewOnly: devolvemos primer canvas útil
    if (options.previewOnly) {
      // intentar generar primer frame práctico (el primero en frames)
      for (let i = 0; i < frames.length; i++) {
        const idx = frames[i];
        setStatus?.(`Generando preview frame idx ${idx} (${i+1}/${frames.length})`);
        try {
          const cmds = collectCommands(mainTL, symbols, atlas, idx);
          if (!cmds.length) continue;
          const canvas = drawFrameWithFallbacks(cmds, atlasImage, setStatus);
          if (canvas) return canvas;
        } catch (e) { console.warn('Preview frame error', e); }
        await new Promise(r => setTimeout(r, 0));
      }
      return null;
    }

    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length} (idx ${idx})`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);

        if (!cmds.length) {
          setStatus?.(`Frame ${idx} vacío (sin comandos)`);
          // guardamos placeholder 1x1 transparente para mantener índice si se desea
          const tiny = document.createElement('canvas');
          tiny.width = 1; tiny.height = 1;
          const blob = await canvasToBlob(tiny);
          folder.file(`empty_${String(idx).padStart(4,'0')}.png`, blob);
          await new Promise(r => setTimeout(r, 0));
          continue;
        }

        let canvas = drawFrameWithFallbacks(cmds, atlasImage, setStatus);
        if (!canvas) {
          // último recurso: tomar la primera pieza cruda
          const r = cmds[0].rect;
          const c2 = document.createElement('canvas');
          c2.width = Math.max(1, r.w); c2.height = Math.max(1, r.h);
          c2.getContext('2d').drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          canvas = c2;
          setStatus?.(`Frame ${idx}: usando primer sprite como fallback`);
        }

        const blob = await canvasToBlob(canvas);
        folder.file(`frame_${String(idx).padStart(4,'0')}.png`, blob);
      } catch (err) {
        console.error(`Error frame ${idx}:`, err);
        setStatus?.(`Error frame ${idx}: ${err.message || err}`);
        // placeholder para que no se rompa el orden
        const tiny = document.createElement('canvas'); tiny.width = 1; tiny.height = 1;
        const blob = await canvasToBlob(tiny);
        folder.file(`error_${String(idx).padStart(4,'0')}.png`, blob);
      }
      // yield to event loop
      await new Promise(r => setTimeout(r, 0));
    }

    setStatus?.('Comprimiendo ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, prog => setStatus?.(`Comprimiendo... ${Math.round(prog.percent)}%`));
    setStatus?.('ZIP generado');
    return zipBlob;
  }

  // -------------------------
  // Exponer funciones para UI / preview
  // -------------------------
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = collectFrameIndices;
  window.collectCommands = collectCommands;
  window.bbox = bbox;
  window.drawFrame = drawFrame;

})();
