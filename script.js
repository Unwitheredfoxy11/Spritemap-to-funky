let image, atlasData;

const pngInput  = document.getElementById('pngInput');
const jsonInput = document.getElementById('jsonInput');
const statusEl  = document.getElementById('status');

// Cargar la imagen
pngInput.addEventListener('change', e => {
  const reader = new FileReader();
  reader.onload = ev => {
    image = new Image();
    image.src = ev.target.result;
  };
  reader.readAsDataURL(e.target.files[0]);
});

// Cargar el JSON
jsonInput.addEventListener('change', e => {
  const reader = new FileReader();
  reader.onload = ev => { atlasData = JSON.parse(ev.target.result); };
  reader.readAsText(e.target.files[0]);
});

// Botón de conversión
document.getElementById('convertir').addEventListener('click', async () => {
  if (!image || !atlasData) {
    alert('Falta cargar el PNG o el JSON');
    return;
  }

  statusEl.textContent = 'Procesando…';

  const frames = atlasData.ATLAS.SPRITES.map(s => s.SPRITE);
  const zip = new JSZip();

  // Esperar a que la imagen termine de cargar
  await image.decode();

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const ctx = c.getContext('2d');

    // Recortar región desde la imagen original
    ctx.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);

    const dataURL = c.toDataURL('image/png');
    const base64Data = dataURL.split(',')[1];

    // Añadir al ZIP con nombre
    const name = `${f.name || 'frame'}_${i}.png`;
    zip.file(name, base64Data, { base64: true });
  }

  // Generar y descargar ZIP
  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'sprites_piezas.zip';
  link.click();

  statusEl.textContent = `Listo: ${frames.length} imágenes guardadas en sprites_piezas.zip`;
});

