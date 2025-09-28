// anim_hibrido.js
// Reconstruye frames desde anim.json y atlas, con tolerancia a errores
// me estoy cansando sin hacer mucho
// eArreglo de imagenes alpha
// Intenta armar, y si los pngs fallan, tira error

(function () {
  // --- utilidades ---
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
    a = String(a || ''); b = String(b || '');
    const maxL = Math.max(a.length, b.length);
    if (maxL === 0) return 1;
    const dist = levenshtein(a, b);
    return 1 - (dist / maxL);
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

  // --- construir mapas ---
  function buildAtlasMap(data) {
    const map = {};
    (data?.ATLAS?.SPRITES || []).forEach(it => {
      const s = it.SPRITE;
      map[s.name] = { x: s.x, y: s.y, w: s.w, h: s.h };
    });
    return map;
  }
  function buildSymbolMap(data) {
    const map = {};
    (data?.SD?.S || []).forEach(sym => { map[sym.SN] = sym; });
    return map;
  }
  function collectFrameIndices(tl) {
    const set = new Set();
    (tl.L || []).forEach(layer =>
      (layer.FR || []).forEach(fr => {
        const start = fr.I || 0;
        const dur = fr.DU || 1;
        for (let k = start; k < start + dur; k++) set.add(k);
      })
    );
    return [...set].sort((a, b) => a - b);
  }

  // --- recolector de comandos con fallback ---
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
        console.warn(`⚠️ Fuzzy match: "${ref}" → "${best}"`);
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
              console.warn(`⚠️ Imagen no encontrada: ${el.ASI.N}`);
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

    (mainTL.L || []).forEach(layer => {
      const fr = (layer.FR || []).find(r =>
        idx >= (r.I || 0) && idx < (r.I || 0) + (r.DU || 1)
      );
      if (!fr) return;
      (fr.E || []).forEach(el => {
        if (el.ASI) {
          const rectKey = findAtlasKey(el.ASI.N);
          if (!rectKey) {
            console.warn(`⚠️ Imagen no encontrada: ${el.ASI.N}`);
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

  // --- bounding box y dibujo con reconstrucción ---
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
    return { minX: Math.floor(minX), minY: Math.floor(minY),
             maxX: Math.ceil(maxX), maxY: Math.ceil(maxY) };
  }

  function draw(commands, box, img) {
    const width = Math.max(1, box.maxX - box.minX);
    const height = Math.max(1, box.maxY - box.minY);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');

    let drewAnything = false;

    commands.forEach(cmd => {
      if (!cmd.rect) return; // saltar pieza faltante
      const r = cmd.rect, m = cmd.transform;

      // canvas temporal para chequear transparencia
      const temp = document.createElement('canvas');
      temp.width = r.w;
      temp.height = r.h;
      const tctx = temp.getContext('2d');
      tctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const imgData = tctx.getImageData(0,0,r.w,r.h).data;
      const allTransparent = Array.from(imgData).every((v,i) => (i+1)%4===0 ? v===0 : true);

      if (!allTransparent) {
        ctx.save();
        ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
        ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        ctx.restore();
        drewAnything = true;
      } else {
        console.warn(`⚠️ Pieza transparente ignorada: ${cmd.sourceName}`);
      }
    });

    return drewAnything ? c : null; // null si nada se pudo dibujar
  }

  function frameName(commands, idx) {
    const names = [...new Set(commands.map(c => c.sourceName))];
    return (names[0] || 'frame') + "_" + String(idx).padStart(4, "0");
  }

  // --- exportación ---
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus) {
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if (!mainTL?.L) throw new Error('❌ Timeline principal no encontrada');

    const frames = collectFrameIndices(mainTL);
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length}`);
      const cmds = collectCommands(mainTL, symbols, atlas, idx);
      if (!cmds.length) {
        console.warn(`⚠️ Frame ${idx} vacío`);
        continue;
      }
      const box = bbox(cmds);
      const canvas = draw(cmds, box, atlasImage);
      if (!canvas) {
        console.warn(`⚠️ Frame ${idx} no se pudo reconstruir, todas las piezas vacías o transparentes`);
        continue;
      }
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      folder.file(frameName(cmds, idx) + ".png", blob);
      await new Promise(r => setTimeout(r, 0));
    }

    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      m => setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`)
    );
    return zipBlob;
  }

  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
})();
