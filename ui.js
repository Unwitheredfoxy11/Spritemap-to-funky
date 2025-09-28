// anims.js
// Genera frames individuales desde Animation.json + atlas y devuelve un ZIP
(function() {

  // --- Transformaciones ---
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

  function transformPoint(m,x,y) {
    return { x: m.a*x + m.c*y + m.tx, y: m.b*x + m.d*y + m.ty };
  }

  // --- Mapas ---
  function buildAtlasMap(data) {
    const map = {};
    (data?.ATLAS?.SPRITES || []).forEach(it => {
      const s = it.SPRITE;
      map[s.name] = { x:s.x, y:s.y, w:s.w, h:s.h };
    });
    return map;
  }

  function buildSymbolMap(data) {
    const map = {};
    (data?.SD?.S || []).forEach(sym => map[sym.SN] = sym);
    return map;
  }

  function collectFrameIndices(mainTL) {
    const set = new Set();
    (mainTL?.L || []).forEach(layer =>
      (layer.FR || []).forEach(fr => {
        const start = fr.I || 0;
        const dur   = fr.DU || 1;
        for(let k=start;k<start+dur;k++) set.add(k);
      })
    );
    return [...set].sort((a,b)=>a-b);
  }

  function collectCommands(mainTL, symbols, atlas, idx) {
    const out = [];

    function recurse(name, localFrame, tf) {
      const sym = symbols[name];
      if (!sym?.TL?.L) return;

      sym.TL.L.forEach(layer=>{
        const fr = (layer.FR||[]).find(r=>localFrame >= (r.I||0) && localFrame < (r.I||0)+(r.DU||1));
        if (!fr) return;

        (fr.E||[]).forEach(el=>{
          if(el.ASI){
            const rect = atlas[el.ASI.N];
            if(!rect) throw new Error(`Imagen no encontrada: ${el.ASI.N}`);
            const m = m3dToAffine(el.ASI.M3D||[]);
            out.push({ rect, transform: mulAffine(tf,m), sourceName: el.ASI.N });
          } else if(el.SI){
            const m = m3dToAffine(el.SI.M3D||[]);
            recurse(el.SI.SN, localFrame-(fr.I||0), mulAffine(tf,m));
          }
        });
      });
    }

    (mainTL.L||[]).forEach(layer=>{
      const fr = (layer.FR||[]).find(r=>idx>=(r.I||0) && idx<(r.I||0)+(r.DU||1));
      if(!fr) return;

      (fr.E||[]).forEach(el=>{
        if(el.ASI){
          const rect = atlas[el.ASI.N];
          if(!rect) throw new Error(`Imagen no encontrada: ${el.ASI.N}`);
          const m = m3dToAffine(el.ASI.M3D||[]);
          out.push({ rect, transform: m, sourceName: el.ASI.N });
        } else if(el.SI){
          recurse(el.SI.SN, idx-(fr.I||0), m3dToAffine(el.SI.M3D||[]));
        }
      });
    });

    return out;
  }

  // --- Bounding box ---
  function bbox(commands){
    if(!commands.length) return {minX:0,minY:0,maxX:1,maxY:1};
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    commands.forEach(cmd=>{
      const r=cmd.rect;
      [[0,0],[r.w,0],[r.w,r.h],[0,r.h]].forEach(([x,y])=>{
        const p = transformPoint(cmd.transform,x,y);
        minX = Math.min(minX,p.x);
        minY = Math.min(minY,p.y);
        maxX = Math.max(maxX,p.x);
        maxY = Math.max(maxY,p.y);
      });
    });
    return { minX:Math.floor(minX), minY:Math.floor(minY), maxX:Math.ceil(maxX), maxY:Math.ceil(maxY) };
  }

  function isFullyTransparent(canvas){
    const ctx=canvas.getContext('2d');
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=3;i<data.length;i+=4) if(data[i]!==0) return false;
    return true;
  }

  async function exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus){
    const atlas = buildAtlasMap(atlasData);
    const symbols = buildSymbolMap(animData);
    const mainTL = animData?.AN?.TL || animData?.TL;
    if(!mainTL) throw new Error('Timeline principal no encontrada');

    const frames = collectFrameIndices(mainTL);
    const zip = new JSZip();
    const folder = zip.folder('frames');

    for(let i=0;i<frames.length;i++){
      const idx = frames[i];
      setStatus?.(`Procesando frame ${i+1}/${frames.length}`);
      try {
        const cmds = collectCommands(mainTL,symbols,atlas,idx);
        const box = bbox(cmds);
        const c = document.createElement('canvas');
        c.width = box.maxX - box.minX;
        c.height = box.maxY - box.minY;
        const ctx = c.getContext('2d');

        cmds.forEach(cmd=>{
          const r=cmd.rect;
          const m=cmd.transform;
          ctx.setTransform(m.a,m.b,m.c,m.d,m.tx-box.minX,m.ty-box.minY);
          ctx.drawImage(atlasImage,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
        });

        if(isFullyTransparent(c)){
          console.warn(`Frame ${idx} totalmente transparente, intentando reconstruir...`);
          // fallback: dibujar sin transform
          cmds.forEach(cmd=>{
            const r=cmd.rect;
            const ctxFallback = c.getContext('2d');
            ctxFallback.setTransform(1,0,0,1,0,0);
            ctxFallback.drawImage(atlasImage,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
          });
        }

        await new Promise(res=>{
          c.toBlob(blob=>{
            folder.file(`frame_${String(idx).padStart(4,'0')}.png`, blob);
            res();
          },'image/png');
        });

      } catch(err){
        console.error(err);
        setStatus?.(`Error frame ${idx}: ${err.message}`);
      }
      await new Promise(r=>setTimeout(r,0));
    }

    const zipBlob = await zip.generateAsync({type:'blob'}, m=>setStatus?.(`Comprimiendo... ${Math.round(m.percent)}%`));
    return zipBlob;
  }

  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;

})();
