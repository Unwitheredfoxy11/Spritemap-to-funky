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
// anims.js - Generación de frames individuales desde Animation.json
// ya me canse...

(function () {

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

  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

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
            const rectKey = el.ASI.N;
            if (!atlas[rectKey]) throw new Error(`Imagen no encontrada: ${rectKey}`);
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
          const rectKey = el.ASI.N;
          if (!atlas[rectKey]) throw new Error(`Imagen no encontrada: ${rectKey}`);
          const m = m3dToAffine(el.ASI.M3D || []);
          out.push({ rect: atlas[rectKey], transform: m, sourceName: rectKey });
        } else if (el.SI) {
          recurse(el.SI.SN, idx - (fr.I || 0), m3dToAffine(el.SI.M3D || []));
        }
      });
    });

    return out;
  }

  function isFullyTransparent(canvas) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
    return true;
  }

  function drawFrame(commands, atlasImage) {
    let canvases = [];
    commands.forEach(cmd => {
      const c = document.createElement('canvas');
      c.width = cmd.rect.w;
      c.height = cmd.rect.h;
      const ctx = c.getContext('2d');
      ctx.setTransform(cmd.transform.a, cmd.transform.b, cmd.transform.c, cmd.transform.d, cmd.transform.tx, cmd.transform.ty);
      ctx.drawImage(atlasImage, cmd.rect.x, cmd.rect.y, cmd.rect.w, cmd.rect.h, 0, 0, cmd.rect.w, cmd.rect.h);
      if (!isFullyTransparent(c)) canvases.push(c);
    });
    return canvases;
  }

  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus) {
    const atlas = window.buildAtlasMap(atlasData);
    const symbols = window.buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    const frames = window.collectFrameIndices(mainTL);
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for (let i = 0; i < frames.length; i++) {
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i+1}/${frames.length}`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        const canvases = drawFrame(cmds, atlasImage);
        if (!canvases.length) {
          console.warn(`Frame ${idx} vacío, intentando reconstruir...`);
          // fallback: dibujar todos los elementos sin considerar transparencia
          cmds.forEach(cmd => {
            const c = document.createElement('canvas');
            c.width = cmd.rect.w;
            c.height = cmd.rect.h;
            c.getContext('2d').drawImage(atlasImage, cmd.rect.x, cmd.rect.y, cmd.rect.w, cmd.rect.h, 0,0,cmd.rect.w,cmd.rect.h);
            canvases.push(c);
          });
        }
        canvases.forEach((c,j) => {
          c.toBlob(blob => {
            folder.file(`frame_${String(idx).padStart(4,'0')}_${j}.png`, blob);
          }, 'image/png');
        });
      } catch(e) {
        console.error(e);
        setStatus?.(`Error frame ${idx}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r,0));
    }

    const zipBlob = await zip.generateAsync({ type:'blob' }, m => setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`));
    return zipBlob;
  }

  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;

})();
