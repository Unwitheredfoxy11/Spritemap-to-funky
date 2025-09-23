let image, atlasData;

document.getElementById('pngInput').addEventListener('change', e => {
  const reader = new FileReader();
  reader.onload = ev => {
    image = new Image();
    image.src = ev.target.result;
  };
  reader.readAsDataURL(e.target.files[0]);
});

document.getElementById('jsonInput').addEventListener('change', e => {
  const reader = new FileReader();
  reader.onload = ev => { atlasData = JSON.parse(ev.target.result); };
  reader.readAsText(e.target.files[0]);
});

document.getElementById('convertir').addEventListener('click', () => {
  if (!image || !atlasData) return alert('Falta cargar PNG o JSON');

  const frames = atlasData.ATLAS.SPRITES.map(s => s.SPRITE);
  const fw = frames[0].w, fh = frames[0].h;
  const canvas = document.getElementById('resultado');
  canvas.width = fw * frames.length;
  canvas.height = fh;
  const ctx = canvas.getContext('2d');

  frames.forEach((f, i) => {
    ctx.drawImage(image, f.x, f.y, f.w, f.h, i * fw, 0, f.w, f.h);
  });
});

document.getElementById('descargar').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'spritesheet_horizontal.png';
  link.href = document.getElementById('resultado').toDataURL('image/png');
  link.click();
});
