// anim_hibrido.js
// Reconstruye frames desde anim.json y atlas, con tolerancia a errores
// me estoy cansando sin hacer mucho
// eArreglo de imagenes alpha
// Intenta armar, y si los pngs fallan, tira error
// Intento de que cambie la ruta de construccion
// --- Construye animaciones a partir de atlas.js y anim.json ---
// anims.fixed.js, me gaste otra cuenta para esto... casi se muere chat we
// Reconstruye frames desde anim.json y atlas, con tolerancia a errores
// anim_hibrido.js - exporta varios frames, usa nombre de animación si existe
(function () {
  // utilidades
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
  function normalizeKey(name) {
    if (!name) return name;
    let n = name.replace(/^.*[\\/]/, '').trim();
    while (n.toLowerCase().endsWith('.png.png')) n = n.slice(0, -4);
    if (n.toLowerCase().endsWith('.png')) n = n.slice(0, -4);
    if (n.endsWith('.')) n = n.slice(0, -1);
    return n;
  }

  // mapas
  function buildAtlasMap(data) {
    const map = {};
    const spritesArr = data?.ATLAS?.SPRITES || data?.ATLAS?.SPRITE || data?.SPRITES || [];
    const list = Array.isArray(spritesArr) ? spritesArr : [spritesArr];
    list.forEach(it => {
      const s = it.SPRITE || it;
      if (!s || !s.name) return;
      const key = normalizeKey(s.name);
      map[key] = { x: s.x, y: s.y, w: s.w, h: s.h };
    });
    return map;
  }
  function buildSymbolMap(data) {
    const map = {};
    const arr = data?.SD?.S || data?.S || [];
    (Array.isArray(arr) ? arr : [arr]).forEach(sym => {
      if (!sym) return;
      map[sym.SN || sym.name] = sym;
    });
    return map;
  }
  function collectFrameIndices(tl) {
    const set = new Set();
    (tl?.L || []).forEach(layer =>
      (layer.FR || []).forEach(fr => {
        const start = fr.I || 0;
        const dur = Math.max(1, fr.DU || 1);
        for (let k = start; k < start + dur; k++) set.add(k);
      })
    );
    return [...set].sort((a, b) => a - b);
  }

  // comandos
  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];
    function findAtlasKey(ref) {
      if (!ref) return null;
      const key = normalizeKey(ref);
      return atlas[key] ? key : null;
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
            if (!rectKey) return;
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
          if (!rectKey) return;
          out.push({ rect: atlas[rectKey], transform: m3dToAffine(el.ASI.M3D || []), sourceName: rectKey });
        } else if (el.SI) {
          recurse(el.SI.SN, idx - (fr.I || 0), m3dToAffine(el.SI.M3D || []));
        }
      });
    });
    return out;
  }

  // bounding box + dibujo
  function bbox(commands) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    commands.forEach(cmd => {
      const r = cmd.rect;
      [ transformPoint(cmd.transform, 0, 0),
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
  function drawFrame(commands, box, img) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, box.maxX - box.minX);
    c.height = Math.max(1, box.maxY - box.minY);
    const ctx = c.getContext('2d');
    commands.forEach(cmd => {
      const r = cmd.rect, m = cmd.transform;
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      ctx.restore();
    });
    return c;
  }

  // exportación
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus) {
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL || animData;
    if (!mainTL?.L) throw new Error("❌ Timeline principal no encontrada");

    // nombre de la animación si existe
    const animName = normalizeKey(animData?.AN?.N || animData?.AN?.name || animData?.name || "frame");

    const frames = collectFrameIndices(mainTL);
    const zip = new JSZip();
    const folder = zip.folder("frames");

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i + 1}/${frames.length}`);

      const cmds = collectCommands(mainTL, symbols, atlas, idx);
      if (!cmds.length) continue;

      const box = bbox(cmds);
      const canvas = drawFrame(cmds, box, atlasImage);

      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      folder.file(`${animName}_${String(idx).padStart(4, "0")}.png`, blob);
      await new Promise(r => setTimeout(r, 0));
    }

    const zipBlob = await zip.generateAsync({ type: "blob" }, m =>
      setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`)
    );
    return zipBlob;
  }

  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
})();
