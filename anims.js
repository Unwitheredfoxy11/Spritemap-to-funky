// anim.js
(() => {
  // ... (todo el código igual que el de tu amigo)

  // exportar global correctamente
  window.exportFramesFromAnimationToZip = exportFramesFromAnimationToZip;

  // utilidades de depuración opcionales
  window._animUtils = {
    m3dToAffine, mulAffine, transformPoint, buildAtlasMap, buildSymbolMap, collectFrameIndices
  };
})();
