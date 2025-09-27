// atlas.js
// --- Recorta cada pieza del atlas y devuelve un ZIP con PNGs ---

(function () {
  async function exportAtlasPieces(atlasImage, atlasData, setStatus) {
    const sprites = atlasData?.ATLAS?.SPRITES;
    if (!sprites) throw new Error('Estructura de atlas inválida.');

    const zip = new JSZip();
    const folder = zip.folder('pieces');

    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i].SPRITE;
      const name = (s.name || `piece_${i}`).replace(/\s+/g, '_') + '.png';

      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      c.getContext('2d').drawImage(
        atlasImage, s.x, s.y, s.w, s.h,
        0, 0, s.w, s.h
      );
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      folder.file(name, blob);

      if (setStatus) setStatus(`Recortado ${name} (${i + 1}/${sprites.length})`);
      await new Promise(r => setTimeout(r, 0));
    }

    const zipBlob = await zip.generateAsync(
      { type: 'blob' },
      m => setStatus?.(`Comprimiendo piezas... ${Math.round(m.percent)}%`)
    );
    return zipBlob;
  }

  // Exponer en window
  window.exportAtlasPieces = exportAtlasPieces;
})();
