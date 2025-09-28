// ui.js
// --- Conecta inputs + drop-box con atlas.js y anim.js ---

(function () {
  let atlasImage = null, atlasData = null, animData = null, lastZipUrl = null;

  // Elementos de la UI
  const pngInput  = document.getElementById('pngInput');
  const jsonInput = document.getElementById('jsonInput');
  const animInput = document.getElementById('animInput');
  const statusEl  = document.getElementById('status');
  const btn       = document.getElementById('convertir');
  const openZip   = document.getElementById('openZipTab');

  // Crear drop-box
  const dropBox = document.createElement('div');
  dropBox.className = 'drop-box';
  dropBox.textContent = 'Arrastrá y soltá tus archivos aquí (PNG, JSON, Animation.json)';
  document.querySelector('.inputs').prepend(dropBox);

  // Helpers
  const setStatus = msg => { statusEl.textContent = msg; console.log(msg); };
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

  // Carga de archivos
  async function handleFile(f) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.png')) {
      const img = new Image();
      img.onload = () => { atlasImage = img; setStatus('PNG cargado'); };
      img.src = await fileToDataURL(f);
    } else if (name.endsWith('.json')) {
      const text = await fileToText(f);
      const data = JSON.parse(text);
      if (data?.ATLAS) { atlasData = data; setStatus('JSON del atlas cargado'); }
      else if (data?.AN || data?.TL) { animData = data; setStatus('Animation.json cargado'); }
      else setStatus('JSON desconocido, no se cargó');
    } else {
      setStatus('Archivo no soportado: ' + f.name);
    }
  }

  // Input change
  [pngInput, jsonInput, animInput].forEach(input =>
    input.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      await handleFile(f);
    })
  );

  // Drag & drop
  ['dragenter','dragover'].forEach(ev =>
    dropBox.addEventListener(ev, e => { e.preventDefault(); dropBox.classList.add('dragover'); })
  );
  ['dragleave','drop'].forEach(ev =>
    dropBox.addEventListener(ev, e => { e.preventDefault(); dropBox.classList.remove('dragover'); })
  );
  dropBox.addEventListener('drop', async e => {
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) await handleFile(f);
  });

  // Botón exportar
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
