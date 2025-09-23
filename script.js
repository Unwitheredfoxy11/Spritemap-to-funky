document.getElementById('convertir').addEventListener('click', () => {
  if (!image || !atlasData) return alert('Falta cargar PNG o JSON');

  const frames = atlasData.ATLAS.SPRITES.map(s => s.SPRITE);

  frames.forEach((f, i) => {
    // Crear un canvas para cada frame
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const ctx = c.getContext('2d');

    // Dibujar solo la región correspondiente
    ctx.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);

    // Generar enlace de descarga automático
    const link = document.createElement('a');
    link.download = `${f.name || 'frame'}_${i}.png`; // nombre de archivo
    link.href = c.toDataURL('image/png');
    link.textContent = `Descargar ${f.name || i}`;
    link.style.display = 'block';
    document.body.appendChild(link);
  });

  alert(`Listo: se generaron ${frames.length} imágenes (aparecen enlaces de descarga en la página).`);
});

