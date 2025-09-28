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
(function() {
  let atlasImage=null, atlasData=null, animData=null, lastZipUrl=null;
  let animFrames=[], animFrameIndex=0, animTimer=null;

  const pngInput  = document.getElementById('pngInput');
  const jsonInput = document.getElementById('jsonInput');
  const animInput = document.getElementById('animInput');
  const dropBoxPng   = document.getElementById('dropBoxPng');
  const dropBoxAtlas = document.getElementById('dropBoxAtlas');
  const dropBoxAnim  = document.getElementById('dropBoxAnim');

  const statusEl  = document.getElementById('status');
  const btn       = document.getElementById('convertir');
  const openZip   = document.getElementById('openZipTab');

  const previewPNG  = document.getElementById('previewPNG');
  const previewAnim = document.getElementById('previewAnim');

  const setStatus = m=>{ statusEl.textContent=m; console.log(m); };

  const fileToText = f=>new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=()=>rej(r.error);
    r.readAsText(f);
  });
  const fileToDataURL = f=>new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=()=>rej(r.error);
    r.readAsDataURL(f);
  });

  function assignFileToInput(file,input){
    const dt=new DataTransfer();
    dt.items.add(file);
    input.files=dt.files;
  }

  function setupDropBox(dropBox,input,onLoadFile){
    dropBox.addEventListener('dragover',e=>{ e.preventDefault(); dropBox.classList.add('hover'); });
    dropBox.addEventListener('dragleave',e=>{ e.preventDefault(); dropBox.classList.remove('hover'); });
    dropBox.addEventListener('drop',async e=>{
      e.preventDefault();
      dropBox.classList.remove('hover');
      const files = e.dataTransfer.files;
      for(const f of files) assignFileToInput(f,input);
      input.dispatchEvent(new Event('change'));
    });

    input.addEventListener('change',async e=>{
      const f=e.target.files[0]; if(!f) return;
      await onLoadFile(f);
    });
  }

  // --- PNG ---
  setupDropBox(dropBoxPng,pngInput,async file=>{
    const img=new Image();
    img.onload=()=>{
      atlasImage=img;
      setStatus('PNG cargado');
      previewPNG.width=img.width/2;
      previewPNG.height=img.height/2;
      previewPNG.style.display='block';
      const ctx=previewPNG.getContext('2d');
      ctx.clearRect(0,0,previewPNG.width,previewPNG.height);
      ctx.drawImage(img,0,0,previewPNG.width,previewPNG.height);
    };
    img.src=await fileToDataURL(file);
  });

  // --- Atlas JSON ---
  setupDropBox(dropBoxAtlas,jsonInput,async file=>{
    atlasData=JSON.parse(await fileToText(file));
    setStatus('Atlas JSON cargado');
  });

  // --- Animation JSON ---
  setupDropBox(dropBoxAnim,animInput,async file=>{
    animData=JSON.parse(await fileToText(file));
    setStatus('Animation.json cargado');
    buildAnimPreview();
  });

  // --- Previsualización ---
  async function buildAnimPreview(){
    if(!atlasImage||!animData) return;
    setStatus('Generando previsualización...');
    try{
      animFrames=[];
      const mainTL=animData?.AN?.TL || animData?.TL;
      const frames=window.collectFrameIndices ? window.collectFrameIndices(mainTL) : [...Array(10).keys()];

      for(let i=0;i<Math.min(frames.length,50);i++){
        try{
          const cmds=window.collectCommands ? window.collectCommands(mainTL, window.buildSymbolMap(animData), window.buildAtlasMap(atlasData), frames[i]) : [];
          if(!cmds.length) continue;
          const box=window.bbox ? window.bbox(cmds) : {minX:0,minY:0,maxX:100,maxY:100};
          const c=document.createElement('canvas');
          c.width=box.maxX-box.minX;
          c.height=box.maxY-box.minY;
          const ctx=c.getContext('2d');
          cmds.forEach(cmd=>{
            const r=cmd.rect;
            const m=cmd.transform;
            ctx.setTransform(m.a,m.b,m.c,m.d,m.tx-box.minX,m.ty-box.minY);
            ctx.drawImage(atlasImage,r.x,r.y,r.w,r.h,0,0,r.w,r.h);
          });
          animFrames.push(c);
        }catch(e){ console.warn('Frame preview skipped',e); }
      }

      animFrameIndex=0;
      previewAnim.style.display='block';
      if(animTimer) clearInterval(animTimer);
      animTimer=setInterval(()=>{
        if(!animFrames.length) return;
        const ctx=previewAnim.getContext('2d');
        const frame=animFrames[animFrameIndex];
        previewAnim.width=frame.width;
        previewAnim.height=frame.height;
        ctx.clearRect(0,0,frame.width,frame.height);
        ctx.drawImage(frame,0,0);
        animFrameIndex=(animFrameIndex+1)%animFrames.length;
      },100);
      setStatus('Previsualización lista');
    }catch(err){
      console.error(err);
      setStatus('Error previsualización: '+err.message);
    }
  }

  // --- Exportar ---
  btn.addEventListener('click',async()=>{
    try{
      if(!window.JSZip) throw new Error('JSZip no cargado');
      if(!atlasImage || !atlasData) throw new Error('Faltan archivos de atlas');

      setStatus('Procesando...');
      const zipBlob=animData
        ? await window.exportFramesFromAnimationToZip(atlasImage,atlasData,animData,setStatus)
        : await window.exportAtlasPieces(atlasImage,atlasData,setStatus);

      if(lastZipUrl) URL.revokeObjectURL(lastZipUrl);
      lastZipUrl=URL.createObjectURL(zipBlob);

      const a=document.createElement('a');
      a.href=lastZipUrl;
      a.download=animData?'frames_construidos.zip':'sprites_piezas.zip';
      a.click();

      openZip.style.display='inline-block';
      openZip.onclick=()=>window.open(lastZipUrl,'_blank');

      setStatus('ZIP listo.');
    }catch(err){
      console.error(err);
      setStatus('Error: '+err.message);
    }
  });

})();
