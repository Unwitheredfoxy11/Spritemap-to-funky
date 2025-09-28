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
// anims.js - Genera frames individuales desde Animation.json y Atlas
// cuantos cambios llevo?
// ui.js
// anims.js - Genera frames desde Animation.json y Atlas
(function() {

  // --- Utilidades ---
  function m3dToAffine(m3d) {
    return {
      a: m3d?.[0] ?? 1, b: m3d?.[1] ?? 0,
      c: m3d?.[4] ?? 0, d: m3d?.[5] ?? 1,
      tx: m3d?.[12] ?? 0, ty: m3d?.[13] ?? 0
    };
  }

  function mulAffine(m1, m2) {
    return {
      a: m1.a*m2.a + m1.c*m2.b,
      b: m1.b*m2.a + m1.d*m2.b,
      c: m1.a*m2.c + m1.c*m2.d,
      d: m1.b*m2.c + m1.d*m2.d,
      tx: m1.a*m2.tx + m1.c*m2.ty + m1.tx,
      ty: m1.b*m2.tx + m1.d*m2.ty + m1.ty
    };
  }

  function transformPoint(m, x, y) {
    return {x: m.a*x + m.c*y + m.tx, y: m.b*x + m.d*y + m.ty};
  }

  function isFullyTransparent(canvas) {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=3;i<data.length;i+=4) if(data[i]!==0) return false;
    return true;
  }

  // --- Mapas ---
  function buildAtlasMap(atlasData) {
    const map = {};
    (atlasData?.ATLAS?.SPRITES || []).forEach(spr => {
      const s = spr.SPRITE;
      map[s.name] = {x: s.x, y: s.y, w: s.w, h: s.h};
    });
    return map;
  }

  function buildSymbolMap(animData) {
    const map = {};
    (animData?.SD?.S || []).forEach(sym => map[sym.SN]=sym);
    return map;
  }

  function collectFrameIndices(tl) {
    const set = new Set();
    (tl.L || []).forEach(layer =>
      (layer.FR || []).forEach(fr => {
        const start = fr.I || 0, dur = fr.DU || 1;
        for(let k=start;k<start+dur;k++) set.add(k);
      })
    );
    return [...set].sort((a,b)=>a-b);
  }

  // --- Comandos ---
  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

    function recurse(name, localFrame, tf) {
      const sym = symbols[name];
      if(!sym?.TL?.L) return;
      sym.TL.L.forEach(layer => {
        const fr = (layer.FR || []).find(r => localFrame >= (r.I||0) && localFrame < (r.I||0)+(r.DU||1));
        if(!fr) return;
        (fr.E||[]).forEach(el=>{
          if(el.ASI){
            const rectKey = el.ASI.N;
            if(!atlas[rectKey]) throw new Error(`Imagen no encontrada: ${rectKey}`);
            const rect = atlas[rectKey];
            const m = m3dToAffine(el.ASI.M3D||[]);
            out.push({rect, transform: mulAffine(tf,m), sourceName: rectKey});
          } else if(el.SI){
            const m = m3dToAffine(el.SI.M3D||[]);
            recurse(el.SI.SN, localFrame-(fr.I||0), mulAffine(tf,m));
          }
        });
      });
    }

    (mainTL.L || []).forEach(layer=>{
      const fr = (layer.FR || []).find(r => idx >= (r.I||0) && idx < (r.I||0)+(r.DU||1));
      if(!fr) return;
      (fr.E||[]).forEach(el=>{
        if(el.ASI){
          const rectKey = el.ASI.N;
          if(!atlas[rectKey]) throw new Error(`Imagen no encontrada: ${rectKey}`);
          out.push({rect: atlas[rectKey], transform: m3dToAffine(el.ASI.M3D||[]), sourceName: rectKey});
        } else if(el.SI){
          recurse(el.SI.SN, idx-(fr.I||0), m3dToAffine(el.SI.M3D||[]));
        }
      });
    });

    return out;
  }

  function drawFrame(commands, atlasImage) {
    if(!commands.length) return null;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    commands.forEach(cmd=>{
      const r = cmd.rect;
      [transformPoint(cmd.transform,0,0),transformPoint(cmd.transform,r.w,0),transformPoint(cmd.transform,r.w,r.h),transformPoint(cmd.transform,0,r.h)]
        .forEach(p=>{ minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); });
    });
    const c = document.createElement('canvas');
    c.width = Math.max(1,Math.ceil(maxX)-Math.floor(minX));
    c.height = Math.max(1,Math.ceil(maxY)-Math.floor(minY));
    const ctx = c.getContext('2d');
    commands.forEach(cmd=>{
      const r = cmd.rect, m=cmd.transform;
      ctx.setTransform(m.a,m.b,m.c,m.d,m.tx-Math.floor(minX),m.ty-Math.floor(minY));
      ctx.drawImage(atlasImage,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
    });
    if(isFullyTransparent(c)) return null;
    return c;
  }

  // --- Exportación ---
  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus, options={}) {
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    const frames = collectFrameIndices(mainTL);
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for(let i=0;i<frames.length;i++){
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i+1}/${frames.length}`);
      try{
        const cmds = collectCommands(mainTL, symbols, atlas, idx);
        let canvas = drawFrame(cmds, atlasImage);

        // fallback si totalmente transparente
        if(!canvas && cmds.length){
          canvas = document.createElement('canvas');
          const r = cmds[0].rect;
          canvas.width = r.w; canvas.height = r.h;
          canvas.getContext('2d').drawImage(atlasImage,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
        }

        if(options.previewOnly && canvas) return canvas; // para previsualización

        if(canvas){
          const blob = await new Promise(res=>canvas.toBlob(res,'image/png'));
          folder.file(`frame_${String(idx).padStart(4,'0')}.png`,blob);
        }
      } catch(e){
        console.error(e);
        setStatus?.(`Error frame ${idx}: ${e.message}`);
      }
      await new Promise(r=>setTimeout(r,0));
    }

    return await zip.generateAsync({type:'blob'}, m=>setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`));
  }

  // --- Exponer ---
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;
  window.buildAtlasMap = buildAtlasMap;
  window.buildSymbolMap = buildSymbolMap;
  window.collectFrameIndices = collectFrameIndices;
  window.collectCommands = collectCommands;

})();
