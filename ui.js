// ui.js - Manejo de inputs, drag & drop y previsualización del primer frame
(function() {
  let atlasImage = null, atlasData = null, animData = null, lastZipUrl = null;

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

  const setStatus = m => { statusEl.textContent = m; console.log(m); };

  const fileToText = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsText(f);
  });
  const fileToDataURL = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

  function assignFileToInput(file, input) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }

  function setupDropBox(dropBox, input, onLoadFile) {
    dropBox.addEventListener('dragover', e => {
      e.preventDefault();
      dropBox.classList.add('hover');
    });
    dropBox.addEventListener('dragleave', e => {
      e.preventDefault();
      dropBox.classList.remove('hover');
    });
    dropBox.addEventListener('drop', async e => {
      e.preventDefault();
      dropBox.classList.remove('hover');
      const files = e.dataTransfer.files;
      for (const f of files) assignFileToInput(f, input);
      input.dispatchEvent(new Event('change'));
    });

    input.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      await onLoadFile(f);
    });
  }

  // --- Cargar PNG ---
  setupDropBox(dropBoxPng, pngInput, async (file) => {
    const img = new Image();
    img.onload = () => {
      atlasImage = img;
      setStatus('PNG cargado');

      // preview PNG
      previewPNG.width = img.width / 2;
      previewPNG.height = img.height / 2;
      previewPNG.style.display = 'block';
      const ctx = previewPNG.getContext('2d');
      ctx.clearRect(0,0,previewPNG.width, previewPNG.height);
      ctx.drawImage(img, 0,0, previewPNG.width, previewPNG.height);
    };
    img.src = await fileToDataURL(file);
  });

  // --- Cargar Atlas JSON ---
  setupDropBox(dropBoxAtlas, jsonInput, async (file) => {
    atlasData = JSON.parse(await fileToText(file));
    setStatus('Atlas JSON cargado');
  });

  // --- Cargar Anim JSON ---
  setupDropBox(dropBoxAnim, animInput, async (file) => {
    animData = JSON.parse(await fileToText(file));
    setStatus('Animation.json cargado');
    previewFirstFrame();
  });

  // --- Mostrar solo el primer frame de la animación ---
  async function previewFirstFrame() {
    if (!atlasImage || !animData || !atlasData) return;
    setStatus('Generando primer frame...');
    try {
      const zipCanvas = await window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, null, {previewOnly: true});
      previewAnim.width = zipCanvas.width;
      previewAnim.height = zipCanvas.height;
      previewAnim.style.display = 'block';
      const ctx = previewAnim.getContext('2d');
      ctx.clearRect(0,0,zipCanvas.width,zipCanvas.height);
      ctx.drawImage(zipCanvas,0,0);
      setStatus('Primer frame listo');
    } catch(err) {
      console.error(err);
      setStatus('Error preview: ' + err.message);
    }
  }

  // --- Exportar a ZIP ---
  btn.addEventListener('click', async () => {
    try {
      if (!window.JSZip) throw new Error('JSZip no cargado');
      if (!atlasImage || !atlasData) throw new Error('Faltan archivos de atlas');

      setStatus('Procesando...');
      const zipBlob = animData
        ? await window.exportFramesFromAnimationToZip(atlasImage, atlasData, animData, setStatus)
        : await window.exportAtlasPieces(atlasImage, atlasData, setStatus);

      if (lastZipUrl) URL.revokeObjectURL(lastZipUrl);
      lastZipUrl = URL.createObjectURL(zipBlob);

      const a = document.createElement('a');
      a.href = lastZipUrl;
      a.download = animData ? 'frames_construidos.zip' : 'sprites_piezas.zip';
      a.click();

      openZip.style.display = 'inline-block';
      openZip.onclick = () => window.open(lastZipUrl, '_blank');

      setStatus('ZIP listo.');
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + err.message);
    }
  });

})();
