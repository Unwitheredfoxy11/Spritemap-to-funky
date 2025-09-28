// ui.js - Manejo de inputs y drag & drop, exportación a ZIP
(function() {
  let atlasImage = null, atlasData = null, animData = null, lastZipUrl = null;

  const pngInput  = document.getElementById('pngInput');
  const jsonInput = document.getElementById('jsonInput');
  const animInput = document.getElementById('animInput');
  const dropBox   = document.getElementById('dropBox');
  const statusEl  = document.getElementById('status');
  const btn       = document.getElementById('convertir');
  const openZip   = document.getElementById('openZipTab');

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

  // --- Función para asignar archivos al input ---
  function assignFileToInput(file, input) {
    const dt = new DataTransfer();
    if (input.files) for (const f of input.files) dt.items.add(f);
    dt.items.add(file);
    input.files = dt.files;
  }

  // --- Drag & Drop ---
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
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (ext === 'png') assignFileToInput(f, pngInput);
      else if (ext === 'json') {
        if (f.name.toLowerCase().includes('anim')) assignFileToInput(f, animInput);
        else assignFileToInput(f, jsonInput);
      }
    }
    dropBox.querySelector('.dropText').textContent = 'Archivos listos para procesar';

    // disparar manualmente los eventos change
    [pngInput, jsonInput, animInput].forEach(input => input.dispatchEvent(new Event('change')));
  });

  // --- Inputs normales ---
  pngInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => { atlasImage = img; setStatus('PNG cargado'); };
    img.src = await fileToDataURL(f);
  });

  jsonInput.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    atlasData = JSON.parse(await fileToText(f));
    setStatus('JSON del atlas cargado');
  });

  animInput.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) { animData = null; setStatus('Sin Animation.json (modo piezas)'); return; }
    animData = JSON.parse(await fileToText(f));
    setStatus('Animation.json cargado');
  });

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
