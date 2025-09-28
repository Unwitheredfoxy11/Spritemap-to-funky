// anim_hibrido.js
// Reconstruye frames desde anim.json y atlas, con tolerancia a errores
// me estoy cansando sin hacer mucho
// eArreglo de imagenes alpha
// Intenta armar, y si los pngs fallan, tira error
// Intento de que cambie la ruta de construccion
// --- Construye animaciones a partir de atlas.js y anim.json ---
// anims.fixed.js, me gaste otra cuenta para esto... casi se muere chat we
// Reconstruye frames desde anim.json y atlas, con tolerancia a errores
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

  // Normaliza nombres de sprite/keys: saca rutas, normaliza .png y dobles .png
  function normalizeKey(name) {
    if (!name) return name;
    // quitar ruta
    const base = name.replace(/^.*[\\/]/, '');
    // eliminar espacios iniciales/finales
    let n = base.trim();
    // eliminar duplicados de .png (ej: "idle0000.png.png")
    while (n.toLowerCase().endsWith('.png.png')) n = n.slice(0, -4);
    // eliminar una sola extensión .png para guardar key sin extension
    if (n.toLowerCase().endsWith('.png')) n = n.slice(0, -4);
    // si termina con un punto por accidente
    if (n.endsWith('.')) n = n.slice(0, -1);
    return n;
  }

  // --- mapas de atlas (tolerante) ---
  function buildAtlasMap(data) {
    const map = {};
    if (!data) return map;

    // Intentar varias estructuras comunes
    const spritesArr = data?.ATLAS?.SPRITES || data?.ATLAS?.SPRITE || data?.SPRITES || data?.TEXTURES || [];

    // Si sprite es objeto único convertir a array
    const list = Array.isArray(spritesArr) ? spritesArr : [spritesArr];

    list.forEach(it => {
      const s = it.SPRITE || it; // en algunos exports el objeto ya viene directo
      if (!s || !s.name) return;
      const keyNorm = normalizeKey(s.name);
      map[s.name] = { x: s.x, y: s.y, w: s.w, h: s.h };
      if (keyNorm !== s.name) map[keyNorm] = map[s.name];
      // también guardar sin .png y sin extension
      const noExt = s.name.replace(/\.png$/i, '');
      if (noExt !== s.name) map[noExt] = map[s.name];
    });

    return map;
  }

  function buildSymbolMap(data) {
    const map = {};
    const arr = data?.SD?.S || data?.S || [];
    const list = Array.isArray(arr) ? arr : [arr];
    list.forEach(sym => {
      if (!sym) return;
      if (sym.SN) map[sym.SN] = sym;
      else if (sym.name) map[sym.name] = sym;
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

  // --- recolectar comandos por frame ---
  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

    function findAtlasKey(ref) {
      if (!ref) return null;
      if (atlas[ref]) return ref;
      const norm = normalizeKey(ref);
      if (atlas[norm]) return norm;
      const noExt = ref.replace(/\.png$/i, '');
      if (atlas[noExt]) return noExt;
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

  // --- bounding box y dibujo ---
  function bbox(commands) {
    if (!commands.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    commands.forEach(cmd => {
      const r = cmd.rect;
      if (!r) return;
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
    // si no se modificó, devolver caja por defecto
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    return { minX: Math.floor(minX), minY: Math.floor(minY), maxX: Math.ceil(maxX), maxY: Math.ceil(maxY) };
  }

  function draw(commands, box, img) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, box.maxX - box.minX);
    c.height = Math.max(1, box.maxY - box.minY);
    const ctx = c.getContext('2d');

    let drew = false;
    commands.forEach(cmd => {
      if (!cmd.rect) return;
      const r = cmd.rect, m = cmd.transform;
      ctx.save();
      // setTransform(a, b, c, d, tx, ty)
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - box.minX, m.ty - box.minY);
      try {
        // img puede ser Image, Canvas o ImageBitmap
        ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        drew = true;
      } catch (e) {
        console.warn("drawImage falló para rect:", r, e);
      }
      ctx.restore();
    });

    if (!drew) console.warn("⚠️ Frame vacío");
    return c;
  }

  function frameName(commands, idx) {
    const names = [...new Set(commands.map(c => c.sourceName).filter(Boolean))];
    const base = (names[0] || 'frame');
    const cleanBase = normalizeKey(base);
    return cleanBase + "_" + String(idx).padStart(4, "0");
  }

  // --- exportación ---
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus) {
    try {
      const atlas = buildAtlasMap(atlasData);
      const symbols = buildSymbolMap(animData);
      const mainTL = animData?.AN?.TL || animData?.TL || animData?.AN || animData;
      if (!mainTL?.L) throw new Error('❌ Timeline principal no encontrada');

      const frames = collectFrameIndices(mainTL);
      if (!frames.length) throw new Error('❌ No se encontraron frames en la timeline');

      if (typeof JSZip === 'undefined') throw new Error('❌ JSZip no está disponible en el entorno (incluye la librería JSZip).');

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

        // --- check transparencia (corregido) ---
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let hasOpaque = false;
        for (let p = 3; p < imgData.length; p += 4) {
          if (imgData[p] > 0) { hasOpaque = true; break; }
        }
        if (!hasOpaque) {
          console.warn(`⚠️ Frame ${idx} totalmente transparente, intentando reconstruir...`);
          // Aquí podrías intentar heurísticas: por ejemplo, ignorar transform o usar composiciones alternativas.
        }

        const blob = await new Promise(res => {
          try {
            canvas.toBlob(b => res(b), 'image/png');
            // notamos que toBlob es asíncrono y puede devolver null en algunos entornos; el fallback sería toDataURL
          } catch (e) {
            console.warn("toBlob falló, usando fallback toDataURL", e);
            const dataURL = canvas.toDataURL('image/png');
            // convertir dataURL -> blob
            const byteString = atob(dataURL.split(',')[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const newBlob = new Blob([ab], { type: 'image/png' });
            res(newBlob);
          }
        });

        if (!blob) {
          console.warn(`⚠️ No se pudo generar PNG para frame ${idx}, se omite.`);
          continue;
        }

        folder.file(frameName(cmds, idx) + ".png", blob);

        // alivianar la event loop
        await new Promise(r => setTimeout(r, 0));
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' }, m =>
        setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`)
      );
      setStatus?.('Listo');
      return zipBlob;
    } catch (err) {
      console.error("exportFramesFromAnimationToZip: ", err);
      throw err;
    }
  }

  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
})();
