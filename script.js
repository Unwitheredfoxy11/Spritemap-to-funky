// script.js (mejorado)
let image = null;
let atlasData = null;
let lastZipUrl = null;

const pngInput  = document.getElementById('pngInput');
const jsonInput = document.getElementById('jsonInput');
const statusEl  = document.getElementById('status');
const convertirBtn = document.getElementById('convertir');
const openZipBtn = document.getElementById('openZipTab');

function setStatus(msg) {
  statusEl.textContent = msg;
  console.log(msg);
}

// Cargar la imagen con FileReader -> dataURL (evita problemas CORS)
pngInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) {
    setStatus('No seleccionaste imagen.');
    return;
  }

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Error leyendo PNG con FileReader'));
      r.readAsDataURL(file);
    });

    const img = new Image();
    img.onerror = () => {
      setStatus('Error cargando la imagen.');
      image = null;
    };
    img.src = dataUrl;

    // esperar a que se cargue (compatibilidad)
    await new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth !== 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Error en img.onload'));
    });

    image = img;
    setStatus('PNG cargado.');

  } catch (err) {
    console.error(err);
    setStatus('Error al cargar PNG: ' + (err.message || err));
  }
});

// Cargar JSON
jsonInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) {
    setStatus('No seleccionaste JSON.');
    return;
  }
  try {
    const text = await file.text();
    atlasData = JSON.parse(text);
    setStatus('JSON cargado.');
  } catch (err) {
    console.error(err);
    atlasData = null;
    setStatus('Error leyendo JSON: ' + (err.message || err));
  }
});

// Función auxiliar: canvas -> blob (promisified)
function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise(resolve => {
    if (canvas.toBlob) {
      canvas.toBlob(blob => resolve(blob), type, quality);
    } else {
      // fallback: dataURL -> blob
      const dataURL = canvas.toDataURL(type, quality);
      const byteString = atob(dataURL.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type });
      resolve(blob);
    }
  });
}

convertirBtn.addEventListener('click', async () => {
  try {
    if (!window.JSZip) throw new Error('JSZip no está cargado. Revisa la inclusión del script.');
    if (!image || !atlasData) {
      setStatus('Debes cargar primero el PNG y el JSON.');
      return;
    }

    // Extraer frames del JSON (compatibilidad)
    const sprites = (atlasData.ATLAS && atlasData.ATLAS.SPRITES) ? atlasData.ATLAS.SPRITES : null;
    if (!sprites || !sprites.length) {
      setStatus('Estructura JSON inesperada. La ruta esperada es ATLAS.SPRITES.');
      return;
    }

    setStatus('Procesando recortes...');
    const zip = new JSZip();
    // crear carpeta opcional dentro del zip
    const folder = zip.folder('frames');

    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i].SPRITE;
      const name = (s.name || `frame_${i}`).replace(/\s+/g,'_') + `.png`;

      // crear canvas del tamaño exacto
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      const ctx = c.getContext('2d');

      // DIBUJAR: x,y provienen del JSON (su origen suele ser top-left)
      ctx.drawImage(image, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);

      // convertir a blob y añadir al zip
      const blob = await canvasToBlob(c, 'image/png');
      folder.file(name, blob);
      setStatus(`Añadido ${name} (${i+1}/${sprites.length})`);
      await new Promise(r => setTimeout(r, 0)); // yield para no bloquear UI
    }

    setStatus('Comprimiendo ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      setStatus(`Comprimiendo ZIP... ${Math.round(metadata.percent)}%`);
    });

    // liberar URL anterior si existe
    if (lastZipUrl) URL.revokeObjectURL(lastZipUrl);
    lastZipUrl = URL.createObjectURL(zipBlob);

    // descargar automáticamente (funciona en la mayoría de navegadores)
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = lastZipUrl;
    a.download = 'sprites_piezas.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();

    // mostrar botón para abrir en nueva pestaña (útil en móviles que no descargan)
    openZipBtn.style.display = 'inline-block';
    openZipBtn.onclick = () => window.open(lastZipUrl, '_blank');

    setStatus(`Listo: ${sprites.length} imágenes dentro de sprites_piezas.zip`);

  } catch (err) {
    console.error(err);
    setStatus('Error: ' + (err.message || err));
  }
});

