// main.js - Sistema completo de animación y recorte de spritemaps
(function() {
  'use strict';

  // Variables globales
  let atlasImage = null;
  let atlasData = null;
  let animationData = null;
  let animationFrames = [];
  let currentFrame = 0;
  let isPlaying = false;
  let animationInterval = null;

  // Elementos del DOM
  const elements = {
    pngInput: document.getElementById('pngInput'),
    jsonInput: document.getElementById('jsonInput'),
    animInput: document.getElementById('animInput'),
    dropBoxPng: document.getElementById('dropBoxPng'),
    dropBoxAtlas: document.getElementById('dropBoxAtlas'),
    dropBoxAnim: document.getElementById('dropBoxAnim'),
    previewPNG: document.getElementById('previewPNG'),
    previewAnim: document.getElementById('previewAnim'),
    statusEl: document.getElementById('status'),
    convertBtn: document.getElementById('convertir'),
    openZipBtn: document.getElementById('openZipTab'),
    playBtn: null,
    stopBtn: null,
    frameInfo: null
  };

  // Utilidades
  const utils = {
    setStatus: (message) => {
      if (elements.statusEl) {
        elements.statusEl.textContent = message;
        console.log('[STATUS]', message);
      }
    },

    fileToText: (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    }),

    fileToDataURL: (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }),

    assignFileToInput: (file, input) => {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
      } catch (e) {
        console.warn('DataTransfer no disponible', e);
      }
    }
  };

  // Sistema de animación
  const animationSystem = {
    // Construye el mapa del atlas
    buildAtlasMap: (data) => {
      const map = {};
      if (!data || typeof data !== 'object') return map;

      // Formato Adobe Animate
      if (data?.ATLAS?.SPRITES && Array.isArray(data.ATLAS.SPRITES)) {
        data.ATLAS.SPRITES.forEach(item => {
          const sprite = item.SPRITE || {};
          if (sprite.name) {
            map[sprite.name] = {
              x: Number(sprite.x || 0),
              y: Number(sprite.y || 0),
              w: Number(sprite.w || 0),
              h: Number(sprite.h || 0)
            };
          }
        });
      }
      return map;
    },

    // Extrae frames de la animación
    extractAnimationFrames: (animData, atlasMap) => {
      const frames = [];
      if (!animData?.ANIMATION?.TIMELINE?.LAYERS) return frames;

      const layers = animData.ANIMATION.TIMELINE.LAYERS;
      
      layers.forEach(layer => {
        if (layer?.Frames && Array.isArray(layer.Frames)) {
          layer.Frames.forEach((frame, frameIndex) => {
            if (!frames[frameIndex]) frames[frameIndex] = [];
            
            if (frame?.elements && Array.isArray(frame.elements)) {
              frame.elements.forEach(element => {
                const symbolInstance = element.SYMBOL_Instance;
                if (symbolInstance) {
                  // Extraer información de transformación
                  const matrix = symbolInstance.Matrix3D;
                  const position = symbolInstance.DecomposedMatrix?.Position;
                  
                  const spriteName = String(frameIndex).padStart(4, '0');
                  
                  if (atlasMap[spriteName]) {
                    frames[frameIndex].push({
                      sprite: spriteName,
                      x: position?.x || matrix?.m30 || 0,
                      y: position?.y || matrix?.m31 || 0,
                      atlasData: atlasMap[spriteName]
                    });
                  }
                }
              });
            }
          });
        }
      });

      return frames.filter(frame => frame && frame.length > 0);
    },

    // Dibuja un frame específico
    drawFrame: (canvas, frameData, image) => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      frameData.forEach(item => {
        const { atlasData, x, y } = item;
        
        // Dibuja el sprite recortado en la posición especificada
        ctx.drawImage(
          image,
          atlasData.x, atlasData.y, atlasData.w, atlasData.h,
          x - atlasData.w/2, y - atlasData.h/2, atlasData.w, atlasData.h
        );
      });
    },

    // Configura el canvas de animación
    setupAnimationCanvas: () => {
      if (!elements.previewAnim) return;
      
      elements.previewAnim.width = 1920;
      elements.previewAnim.height = 1080;
      elements.previewAnim.style.display = 'block';
    },

    // Inicia la animación
    startAnimation: () => {
      if (!animationFrames.length || !atlasImage) return;

      isPlaying = true;
      currentFrame = 0;
      
      animationInterval = setInterval(() => {
        if (currentFrame >= animationFrames.length) {
          currentFrame = 0;
        }
        
        animationSystem.drawFrame(elements.previewAnim, animationFrames[currentFrame], atlasImage);
        
        if (elements.frameInfo) {
          elements.frameInfo.textContent = `Frame: ${currentFrame + 1} / ${animationFrames.length}`;
        }
        
        currentFrame++;
      }, 100); // 10 FPS
    },

    // Detiene la animación
    stopAnimation: () => {
      isPlaying = false;
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
    }
  };

  // Sistema de exportación
  const exportSystem = {
    // Exporta frames individuales como ZIP
    exportFrames: async (frames, image, atlasMap) => {
      if (!frames.length) return null;

      const zip = new JSZip();
      const folder = zip.folder('animation_frames');

      for (let i = 0; i < frames.length; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        
        animationSystem.drawFrame(canvas, frames[i], image);
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        folder.file(`frame_${String(i).padStart(4, '0')}.png`, blob);
        
        utils.setStatus(`Exportando frame ${i + 1}/${frames.length}...`);
        await new Promise(r => setTimeout(r, 0));
      }

      utils.setStatus('Comprimiendo archivo ZIP...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return zipBlob;
    },

    // Exporta piezas del atlas como ZIP
    exportAtlasPieces: async (atlasImage, atlasData) => {
      const sprites = atlasData?.ATLAS?.SPRITES;
      if (!sprites) throw new Error('Estructura de atlas inválida.');

      const zip = new JSZip();
      const folder = zip.folder('pieces');

      for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i].SPRITE;
        const name = (sprite.name || `piece_${i}`).replace(/\s+/g, '_') + '.png';

        const canvas = document.createElement('canvas');
        canvas.width = sprite.w;
        canvas.height = sprite.h;
        
        canvas.getContext('2d').drawImage(
          atlasImage, sprite.x, sprite.y, sprite.w, sprite.h,
          0, 0, sprite.w, sprite.h
        );
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        folder.file(name, blob);

        utils.setStatus(`Recortando ${name} (${i + 1}/${sprites.length})`);
        await new Promise(r => setTimeout(r, 0));
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return zipBlob;
    }
  };

  // UI Controller
  const uiController = {
    // Configura drag & drop
    setupDragDrop: (dropBox, input, callback) => {
      if (!dropBox || !input) return;

      dropBox.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropBox.classList.add('hover');
      });

      dropBox.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropBox.classList.remove('hover');
      });

      dropBox.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropBox.classList.remove('hover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          utils.assignFileToInput(files[0], input);
          input.dispatchEvent(new Event('change'));
        }
      });

      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) await callback(file);
      });
    },

    // Crea controles de animación
    createAnimationControls: () => {
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'animation-controls';
      controlsDiv.innerHTML = `
        <button id="playBtn" class="control-btn">▶️ Play</button>
        <button id="stopBtn" class="control-btn">⏹️ Stop</button>
        <span id="frameInfo" class="frame-info">Frame: 0 / 0</span>
      `;
      
      elements.previewAnim.parentNode.insertBefore(controlsDiv, elements.previewAnim.nextSibling);
      
      elements.playBtn = document.getElementById('playBtn');
      elements.stopBtn = document.getElementById('stopBtn');
      elements.frameInfo = document.getElementById('frameInfo');

      elements.playBtn.addEventListener('click', () => {
        if (!isPlaying) {
          animationSystem.startAnimation();
          elements.playBtn.textContent = '⏸️ Pause';
        } else {
          animationSystem.stopAnimation();
          elements.playBtn.textContent = '▶️ Play';
        }
      });

      elements.stopBtn.addEventListener('click', () => {
        animationSystem.stopAnimation();
        elements.playBtn.textContent = '▶️ Play';
        currentFrame = 0;
        if (animationFrames.length > 0) {
          animationSystem.drawFrame(elements.previewAnim, animationFrames[0], atlasImage);
          elements.frameInfo.textContent = `Frame: 1 / ${animationFrames.length}`;
        }
      });
    }
  };

  // Handlers de archivos
  const fileHandlers = {
    handlePngFile: async (file) => {
      try {
        utils.setStatus('Cargando imagen...');
        const dataUrl = await utils.fileToDataURL(file);
        
        atlasImage = new Image();
        atlasImage.onload = () => {
          elements.previewPNG.style.display = 'block';
          elements.previewPNG.width = atlasImage.width;
          elements.previewPNG.height = atlasImage.height;
          
          const ctx = elements.previewPNG.getContext('2d');
          ctx.drawImage(atlasImage, 0, 0);
          
          utils.setStatus('Imagen cargada correctamente');
        };
        atlasImage.src = dataUrl;
      } catch (error) {
        utils.setStatus('Error al cargar la imagen: ' + error.message);
      }
    },

    handleAtlasFile: async (file) => {
      try {
        utils.setStatus('Cargando atlas...');
        const text = await utils.fileToText(file);
        atlasData = JSON.parse(text);
        utils.setStatus('Atlas cargado correctamente');
      } catch (error) {
        utils.setStatus('Error al cargar el atlas: ' + error.message);
      }
    },

    handleAnimFile: async (file) => {
      try {
        utils.setStatus('Cargando animación...');
        const text = await utils.fileToText(file);
        animationData = JSON.parse(text);
        
        if (atlasData) {
          const atlasMap = animationSystem.buildAtlasMap(atlasData);
          animationFrames = animationSystem.extractAnimationFrames(animationData, atlasMap);
          
          if (animationFrames.length > 0) {
            animationSystem.setupAnimationCanvas();
            uiController.createAnimationControls();
            
            // Mostrar primer frame
            animationSystem.drawFrame(elements.previewAnim, animationFrames[0], atlasImage);
            elements.frameInfo.textContent = `Frame: 1 / ${animationFrames.length}`;
            
            utils.setStatus(`Animación cargada: ${animationFrames.length} frames`);
          } else {
            utils.setStatus('No se encontraron frames en la animación');
          }
        }
      } catch (error) {
        utils.setStatus('Error al cargar la animación: ' + error.message);
      }
    }
  };

  // Inicialización
  const init = () => {
    // Configurar drag & drop
    uiController.setupDragDrop(elements.dropBoxPng, elements.pngInput, fileHandlers.handlePngFile);
    uiController.setupDragDrop(elements.dropBoxAtlas, elements.jsonInput, fileHandlers.handleAtlasFile);
    uiController.setupDragDrop(elements.dropBoxAnim, elements.animInput, fileHandlers.handleAnimFile);

    // Configurar botón de conversión
    elements.convertBtn.addEventListener('click', async () => {
      if (!atlasImage || !atlasData) {
        utils.setStatus('Por favor carga primero el spritemap y el atlas');
        return;
      }

      try {
        elements.convertBtn.disabled = true;
        
        let zipBlob;
        if (animationFrames.length > 0) {
          utils.setStatus('Exportando animación...');
          zipBlob = await exportSystem.exportFrames(animationFrames, atlasImage, atlasData);
        } else {
          utils.setStatus('Exportando piezas del atlas...');
          zipBlob = await exportSystem.exportAtlasPieces(atlasImage, atlasData);
        }

        // Crear enlace de descarga
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = animationFrames.length > 0 ? 'animation_frames.zip' : 'atlas_pieces.zip';
        a.click();
        
        URL.revokeObjectURL(url);
        utils.setStatus('Exportación completada');
      } catch (error) {
        utils.setStatus('Error en la exportación: ' + error.message);
      } finally {
        elements.convertBtn.disabled = false;
      }
    });

    utils.setStatus('Sistema inicializado. Carga los archivos para comenzar.');
  };

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();