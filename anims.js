// anims.js - reconstrucción robusta de frames desde Animation.json + atlas
(function(){
  // --- utilidades ---
  function m3dToAffine(m3d){
    return {
      a: m3d?.[0] ?? 1, b: m3d?.[1] ?? 0,
      c: m3d?.[4] ?? 0, d: m3d?.[5] ?? 1,
      tx: m3d?.[12] ?? 0, ty: m3d?.[13] ?? 0
    };
  }

  function mulAffine(m1,m2){
    return {
      a: m1.a*m2.a + m1.c*m2.b,
      b: m1.b*m2.a + m1.d*m2.b,
      c: m1.a*m2.c + m1.c*m2.d,
      d: m1.b*m2.c + m1.d*m2.d,
      tx: m1.a*m2.tx + m1.c*m2.ty + m1.tx,
      ty: m1.b*m2.tx + m1.d*m2.ty + m1.ty
    };
  }

  function transformPoint(m,x,y){
    return { x: m.a*x + m.c*y + m.tx, y: m.b*x + m.d*y + m.ty };
  }

  function isFullyTransparent(canvas){
    try{
      const ctx = canvas.getContext('2d');
      const d = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=3;i<d.length;i+=4) if(d[i]!==0) return false;
      return true;
    }catch(e){
      // si falla por CORS u otra cosa, asumimos que no está transparente
      console.warn('isFullyTransparent: no se pudo comprobar (probable CORS), asumiendo no transparente', e);
      return false;
    }
  }

  // simple levenshtein para fuzzy
  function levenshtein(a,b){
    a = String(a||''); b = String(b||'');
    if(a===b) return 0;
    const al = a.length, bl = b.length;
    if(al===0) return bl; if(bl===0) return al;
    let v0 = new Array(bl+1), v1 = new Array(bl+1);
    for(let j=0;j<=bl;j++) v0[j]=j;
    for(let i=0;i<al;i++){
      v1[0]=i+1;
      for(let j=0;j<bl;j++){
        const cost = a[i]===b[j] ? 0 : 1;
        v1[j+1] = Math.min(v1[j]+1, v0[j+1]+1, v0[j]+cost);
      }
      for(let j=0;j<=bl;j++) v0[j] = v1[j];
    }
    return v1[bl];
  }
  function similarityScore(a,b){
    a=String(a||''); b=String(b||'');
    const maxL = Math.max(a.length,b.length);
    if(maxL===0) return 1;
    return 1 - (levenshtein(a,b)/maxL);
  }
  function normalizeForMatch(s){
    return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/\.[a-z0-9]+$/i,'').replace(/[_\-\/\\]+/g,' ').replace(/[^a-z0-9\s]+/g,' ')
      .replace(/\s+/g,' ').trim();
  }

  // --- construir mapas (expone también para UI) ---
  function buildAtlasMap(atlasData){
    const map = {};
    (atlasData?.ATLAS?.SPRITES || []).forEach(it=>{
      const s = it.SPRITE;
      if(!s) return;
      map[String(s.name)] = { x: s.x, y: s.y, w: s.w, h: s.h };
    });
    return map;
  }
  function buildSymbolMap(animData){
    const map = {};
    (animData?.SD?.S || []).forEach(sym => { if(sym?.SN) map[sym.SN] = sym; });
    return map;
  }

  // --- frames indices ---
  function collectFrameIndices(tl){
    const set = new Set();
    (tl?.L || []).forEach(layer => (layer.FR || []).forEach(fr => {
      const start = fr.I || 0, dur = fr.DU || 1;
      for(let k = start; k < start + dur; k++) set.add(k);
    }));
    return [...set].sort((a,b)=>a-b);
  }

  // --- colecta comandos (SI/ASI), con fallback de matching para atlas keys ---
  function collectCommands(mainTL, symbols, atlas, idx){
    const out = [];

    // intento flexible para encontrar la clave en atlas
    function findAtlasKey(ref){
      if(ref === undefined || ref === null) return null;
      ref = String(ref);
      if(atlas[ref]) return ref;
      // exact raw among keys
      for(const k in atlas) if(k === ref) return k;
      const normRef = normalizeForMatch(ref);
      // normalized exact
      for(const k in atlas) if(normalizeForMatch(k) === normRef) return k;
      // digits match
      const dRef = (ref.match(/\d+/)||[''])[0];
      if(dRef){
        for(const k in atlas){
          const kd = (k.match(/\d+/)||[''])[0];
          if(kd && (kd===dRef || String(Number(kd))===String(Number(dRef)))) return k;
        }
      }
      // fuzzy by similarity
      let best=null, bestScore=0;
      for(const k in atlas){
        const score = similarityScore(normRef, normalizeForMatch(k));
        if(score > bestScore){ bestScore = score; best = k; }
      }
      if(bestScore >= 0.28){
        console.warn(`Fuzzy atlas match "${ref}" -> "${best}" (score ${bestScore.toFixed(2)})`);
        return best;
      }
      return null;
    }

    function recurse(symName, localFrame, tf){
      const sym = symbols[symName];
      if(!sym || !sym.TL || !Array.isArray(sym.TL.L)) return;
      sym.TL.L.forEach(layer=>{
        const fr = (layer.FR || []).find(r => localFrame >= (r.I||0) && localFrame < (r.I||0)+(r.DU||1));
        if(!fr) return;
        (fr.E || []).forEach(el=>{
          if(el.ASI){
            const rawKey = el.ASI.N;
            const key = findAtlasKey(rawKey);
            if(!key) throw new Error(`Imagen no encontrada (ASI): ${rawKey}`);
            const rect = atlas[key];
            const m = m3dToAffine(el.ASI.M3D || []);
            out.push({ rect, transform: mulAffine(tf, m), sourceName: key });
          } else if(el.SI){
            const m = m3dToAffine(el.SI.M3D || []);
            recurse(el.SI.SN, localFrame - (fr.I||0), mulAffine(tf, m));
          }
        });
      });
    }

    (mainTL?.L || []).forEach(layer=>{
      const fr = (layer.FR || []).find(r => idx >= (r.I||0) && idx < (r.I||0)+(r.DU||1));
      if(!fr) return;
      (fr.E || []).forEach(el=>{
        if(el.ASI){
          const rawKey = el.ASI.N;
          const key = findAtlasKey(rawKey);
          if(!key) throw new Error(`Imagen no encontrada (top): ${rawKey}`);
          const rect = atlas[key];
          const m = m3dToAffine(el.ASI.M3D || []);
          out.push({ rect, transform: m, sourceName: key });
        } else if(el.SI){
          const m = m3dToAffine(el.SI.M3D || []);
          recurse(el.SI.SN, idx - (fr.I||0), m);
        }
      });
    });

    return out;
  }

  // --- calcular bbox y dibujar todos los comandos en UN canvas por frame ---
  function draw(commands, atlasImage){
    if(!commands || !commands.length) return null;

    // bbox de todos los sprites tras transform
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    commands.forEach(cmd=>{
      const r = cmd.rect;
      const corners = [
        transformPoint(cmd.transform, 0, 0),
        transformPoint(cmd.transform, r.w, 0),
        transformPoint(cmd.transform, r.w, r.h),
        transformPoint(cmd.transform, 0, r.h)
      ];
      corners.forEach(p=>{
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    });

    if(!isFinite(minX) || !isFinite(minY)) return null;

    const offX = Math.floor(minX), offY = Math.floor(minY);
    const w = Math.max(1, Math.ceil(maxX) - offX);
    const h = Math.max(1, Math.ceil(maxY) - offY);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    // dibujar cada sprite con su transform relativa al offset
    commands.forEach(cmd=>{
      const r = cmd.rect, m = cmd.transform;
      ctx.save();
      ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - offX, m.ty - offY);
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } catch(e){
        // drawImage puede fallar por CORS o errores; lo capturamos
        console.warn('drawImage fallo para', cmd.sourceName, e);
      }
      ctx.restore();
    });

    // si totalmente transparente devolvemos null para intentar fallback
    if(isFullyTransparent(c)) return null;
    return c;
  }

  // --- fallback: aproximación dibujando con escala simple (si el resultante era transparente) ---
  function drawFallback(commands, atlasImage){
    if(!commands || !commands.length) return null;
    // bbox usando tx,ty (posiciones) sin rotación exacta
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    commands.forEach(cmd=>{
      const m = cmd.transform;
      // aproximación: cuadro en tx,ty con escala aproximada de a,d
      const sx = Math.hypot(m.a, m.b) || 1;
      const sy = Math.hypot(m.c, m.d) || 1;
      const px = m.tx, py = m.ty;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px + (cmd.rect.w * sx));
      maxY = Math.max(maxY, py + (cmd.rect.h * sy));
    });
    const offX = Math.floor(minX), offY = Math.floor(minY);
    const w = Math.max(1, Math.ceil(maxX) - offX);
    const h = Math.max(1, Math.ceil(maxY) - offY);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    commands.forEach(cmd=>{
      const r = cmd.rect, m = cmd.transform;
      const sx = Math.hypot(m.a, m.b) || 1;
      const sy = Math.hypot(m.c, m.d) || 1;
      const px = m.tx - offX, py = m.ty - offY;
      try {
        ctx.drawImage(atlasImage, r.x, r.y, r.w, r.h, Math.round(px), Math.round(py), Math.round(r.w * sx), Math.round(r.h * sy));
      } catch(e){
        console.warn('fallback drawImage fallo', cmd.sourceName, e);
      }
    });

    if(isFullyTransparent(c)) return null;
    return c;
  }

  // --- exportar frames a ZIP ---
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options = {}){
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if(!mainTL || !Array.isArray(mainTL.L)) throw new Error('Timeline principal no encontrada');

    const frames = collectFrameIndices(mainTL);
    if(!frames.length) throw new Error('No se detectaron frames en el timeline');

    const zip = new JSZip();
    const folder = zip.folder('frames');

    // Para evitar frames duplicados: comparamos "estado" simple de cada frame
    let lastFrameHash = null;

    for(let i = 0; i < frames.length; i++){
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i+1}/${frames.length}`);
      try {
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        if(!cmds || !cmds.length){
          // frame vacío → opcionalmente crear placeholder pequeño
          // saltamos para no llenar de imágenes vacías
          continue;
        }

        // hash simple del estado para detectar cambios (posiciones, rectNames, transform params)
        const state = cmds.map(c => `${c.sourceName}|${c.rect.x},${c.rect.y},${c.rect.w},${c.rect.h}|${[c.transform.a,c.transform.b,c.transform.c,c.transform.d,c.transform.tx,c.transform.ty].map(n=>Number(n).toFixed(3)).join(',')}`).join('||');
        if(state === lastFrameHash){
          // idéntico al anterior -> saltar
          continue;
        }
        lastFrameHash = state;

        // intentar dibujar
        let canvas = draw(cmds, atlasImage);
        if(!canvas){
          // fallback inteligente
          setStatus?.(`Frame ${idx}: transparente -> intentando fallback`);
          canvas = drawFallback(cmds, atlasImage);
        }

        if(!canvas){
          // si sigue sin poder reconstruir, reportamos y saltamos
          const msg = `Frame ${idx} no pudo reconstruirse (transparente o fuera de bounds)`;
          console.warn(msg);
          setStatus?.(msg);
          continue;
        }

        if(options.previewOnly){
          // si solo queremos previsualizar devolvemos el canvas directamente
          return canvas;
        }

        const blob = await new Promise(res=>canvas.toBlob(res, 'image/png'));
        // nombre legible: si animData.AN.N existe úsalo, sino frame index
        const animName = animData?.AN?.N || animData?.N || 'anim';
        const fileName = `${animName}_${String(idx).padStart(4,'0')}.png`;
        folder.file(fileName, blob);

      } catch(e){
        console.error('Error procesando frame', idx, e);
        setStatus?.(`Error frame ${idx}: ${e.message || e}`);
        // no abortamos todo: registramos pero continuamos con próximos frames
      }

      // yield
      await new Promise(r => setTimeout(r,0));
    }

    // si no hay archivos en folder devolvemos error
    const folderFiles = Object.keys(folder.files || {});
    if(!folderFiles.length) throw new Error('No se generaron frames válidos');

    const zipBlob = await zip.generateAsync({ type: 'blob' }, m => setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`));
    return zipBlob;
  }

  // --- exponer en window para UI y debugging ---
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = collectFrameIndices;
  window.collectCommands = collectCommands;
  window._anims_utils = { m3dToAffine, mulAffine, transformPoint }; // útil para debug

})();
