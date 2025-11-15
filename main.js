// main.js - Sistema completo de animación y exportación
(function() {
  'use strict';

  // Variables globales
  let animationEngine = null;
  let elements = {};

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

    // Crea controles de animación mejorados
    createAnimationControls: () => {
      const existingControls = document.querySelector('.animation-controls');
      if (existingControls) {
        existingControls.remove();
      }

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'animation-controls';
      controlsDiv.innerHTML = `
        <div class="control-row">
          <button id="playBtn" class="control-btn">▶️ Play</button>
          <button id="pauseBtn" class="control-btn">⏸️ Pause</button>
          <button id="stopBtn" class="control-btn">⏹️ Stop</button>
          <button id="prevFrameBtn" class="control-btn">⏮️ Prev</button>
          <button id="nextFrameBtn" class="control-btn">⏭️ Next</button>
        </div>
        <div class="control-row">
          <label for="fpsSlider">FPS:</label>
          <input type="range" id="fpsSlider" min="1" max="30" value="10">
          <span id="fpsValue">10</span>
        </div>
        <div class="control-row">
          <span id="frameInfo" class="frame-info">Frame: 0 / 0</span>
          <span id="animInfo" class="anim-info">Animación: -</span>
        </div>
      `;
      
      elements.previewAnim.parentNode.insertBefore(controlsDiv, elements.previewAnim.nextSibling);
      
      // Referencias a elementos de control
      elements.playBtn = document.getElementById('playBtn');
      elements.pauseBtn = document.getElementById('pauseBtn');
      elements.stopBtn = document.getElementById('stopBtn');
      elements.prevFrameBtn = document.getElementById('prevFrameBtn');
      elements.nextFrameBtn = document.getElementById('nextFrameBtn');
      elements.fpsSlider = document.getElementById('fpsSlider');
      elements.fpsValue = document.getElementById('fpsValue');
      elements.frameInfo = document.getElementById('frameInfo');
      elements.animInfo = document.getElementById('animInfo');

      // Event listeners
      elements.playBtn.addEventListener('click', () => {
        if (animationEngine) {
          animationEngine.play(elements.previewAnim, (current, total) => {
            elements.frameInfo.textContent = `Frame: ${current} / ${total}`;
          });
        }
      });

      elements.pauseBtn.addEventListener('click', () => {
        if (animationEngine) {
          animationEngine.pause();
        }
      });

      elements.stopBtn.addEventListener('click', () => {
        if (animationEngine) {
          animationEngine.stop();
          elements.frameInfo.textContent = `Frame: 1 / ${animationEngine.frames.length}`;
          if (animationEngine.frames.length > 0) {
            animationEngine.renderFrame(elements.previewAnim, animationEngine.frames[0], animationEngine.atlasImage);
          }
        }
      });

      elements.prevFrameBtn.addEventListener('click', () => {
        if (animationEngine) {
          const newFrame = Math.max(0, animationEngine.currentFrame - 1);
          animationEngine.goToFrame(newFrame, elements.previewAnim);
          elements.frameInfo.textContent = `Frame: ${newFrame + 1} / ${animationEngine.frames.length}`;
        }
      });

      elements.nextFrameBtn.addEventListener('click', () => {
        if (animationEngine) {
          const newFrame = Math.min(animationEngine.frames.length - 1, animationEngine.currentFrame + 1);
          animationEngine.goToFrame(newFrame, elements.previewAnim);
          elements.frameInfo.textContent = `Frame: ${newFrame + 1} / ${animationEngine.frames.length}`;
        }
      });

      elements.fpsSlider.addEventListener('input', (e) => {
        const fps = parseInt(e.target.value);
        elements.fpsValue.textContent = fps;
        if (animationEngine) {
          animationEngine.setFPS(fps);
        }
      });
    },

    // Actualiza la información de la animación
    updateAnimationInfo: () => {
      if (animationEngine) {
        const info = animationEngine.getInfo();
        elements.animInfo.textContent = `Animación: ${info.animationName} (${info.symbolName})`;
      }
    }
  };

  // Handlers de archivos
  const fileHandlers = {
    handlePngFile: async (file) => {
      try {
        utils.setStatus('Cargando imagen...');
        const dataUrl = await utils.fileToDataURL(file);
        
        const image = new Image();
        image.onload = () => {
          elements.previewPNG.style.display = 'block';
          elements.previewPNG.width = image.width;
          elements.previewPNG.height = image.height;
          
          const ctx = elements.previewPNG.getContext('2d');
          ctx.drawImage(image, 0, 0);
          
          // Guardar referencia a la imagen
          if (animationEngine) {
            animationEngine.atlasImage = image;
          }
          
          utils.setStatus('Imagen cargada correctamente');
        };
        image.src = dataUrl;
      } catch (error) {
        utils.setStatus('Error al cargar la imagen: ' + error.message);
      }
    },

    handleAtlasFile: async (file) => {
      try {
        utils.setStatus('Cargando atlas...');
        const text = await utils.fileToText(file);
        const atlasData = JSON.parse(text);
        
        if (animationEngine) {
          animationEngine.atlasData = atlasData;
        }
        
        utils.setStatus('Atlas cargado correctamente');
        
        // Intentar cargar animación si ya existe
        if (animationEngine?.animationData) {
          await fileHandlers.processAnimation();
        }
      } catch (error) {
        utils.setStatus('Error al cargar el atlas: ' + error.message);
      }
    },

    handleAnimFile: async (file) => {
      try {
        utils.setStatus('Cargando animación...');
        const text = await utils.fileToText(file);
        const animationData = JSON.parse(text);
        
        if (animationEngine) {
          animationEngine.animationData = animationData;
        }
        
        utils.setStatus('Animación cargada correctamente');
        
        // Intentar procesar la animación
        await fileHandlers.processAnimation();
      } catch (error) {
        utils.setStatus('Error al cargar la animación: ' + error.message);
      }
    },

    processAnimation: async () => {
      if (!animationEngine || !animationEngine.atlasImage || !animationEngine.atlasData || !animationEngine.animationData) {
        return;
      }

      try {
        utils.setStatus('Procesando animación...');
        
        const frameCount = await animationEngine.loadData(
          animationEngine.atlasImage,
          animationEngine.atlasData,
          animationEngine.animationData
        );

        if (frameCount > 0) {
          // Configurar canvas
          animationEngine.setupCanvas(elements.previewAnim);
          
          // Crear controles
          uiController.createAnimationControls();
          
          // Mostrar primer frame
          if (animationEngine.frames.length > 0) {
            animationEngine.renderFrame(elements.previewAnim, animationEngine.frames[0], animationEngine.atlasImage);
            elements.frameInfo.textContent = `Frame: 1 / ${frameCount}`;
          }

          uiController.updateAnimationInfo();
          utils.setStatus(`Animación procesada: ${frameCount} frames`);
        } else {
          utils.setStatus('No se pudieron extraer frames de la animación');
        }
      } catch (error) {
        utils.setStatus('Error al procesar animación: ' + error.message);
      }
    }
  };

  // Sistema de exportación
  const exportSystem = {
    exportAnimation: async () => {
      if (!animationEngine || !animationEngine.frames.length) {
        utils.setStatus('No hay animación para exportar');
        return null;
      }

      try {
        utils.setStatus('Exportando animación...');
        
        const zip = new JSZip();
        
        await animationEngine.exportFrames(zip, (current, total) => {
          utils.setStatus(`Exportando frame ${current}/${total}...`);
        });

        utils.setStatus('Comprimiendo archivo ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        
        return zipBlob;
      } catch (error) {
        utils.setStatus('Error al exportar animación: ' + error.message);
        throw error;
      }
    },

    exportAtlasPieces: async () => {
      if (!animationEngine?.atlasImage || !animationEngine?.atlasData) {
        utils.setStatus('No hay atlas para exportar');
        return null;
      }

      try {
        utils.setStatus('Exportando piezas del atlas...');
        
        const zip = new JSZip();
        const sprites = animationEngine.atlasData.ATLAS.SPRITES;
        
        const folder = zip.folder('pieces');
        const canvas = document.createElement('canvas');

        for (let i = 0; i < sprites.length; i++) {
          const sprite = sprites[i].SPRITE;
          const name = (sprite.name || `piece_${i}`).replace(/\s+/g, '_') + '.png';

          canvas.width = sprite.w;
          canvas.height = sprite.h;
          
          canvas.getContext('2d').drawImage(
            animationEngine.atlasImage, sprite.x, sprite.y, sprite.w, sprite.h,
            0, 0, sprite.w, sprite.h
          );
          
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          folder.file(name, blob);

          utils.setStatus(`Recortando ${name} (${i + 1}/${sprites.length})`);
          await new Promise(r => setTimeout(r, 0));
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        return zipBlob;
      } catch (error) {
        utils.setStatus('Error al exportar atlas: ' + error.message);
        throw error;
      }
    }
  };

  // Inicialización
  const init = () => {
    // Obtener referencias a elementos del DOM
    elements = {
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
      openZipBtn: document.getElementById('openZipTab')
    };

    // Crear instancia del motor de animación
    animationEngine = new AnimationEngine();

    // Configurar drag & drop
    uiController.setupDragDrop(elements.dropBoxPng, elements.pngInput, fileHandlers.handlePngFile);
    uiController.setupDragDrop(elements.dropBoxAtlas, elements.jsonInput, fileHandlers.handleAtlasFile);
    uiController.setupDragDrop(elements.dropBoxAnim, elements.animInput, fileHandlers.handleAnimFile);

    // Configurar botón de conversión
    elements.convertBtn.addEventListener('click', async () => {
      if (!animationEngine) {
        utils.setStatus('El sistema no está inicializado');
        return;
      }

      try {
        elements.convertBtn.disabled = true;
        
        let zipBlob;
        
        // Si hay animación cargada, exportar frames
        if (animationEngine.frames.length > 0) {
          zipBlob = await exportSystem.exportAnimation();
        } 
        // Si solo hay atlas, exportar piezas
        else if (animationEngine.atlasData) {
          zipBlob = await exportSystem.exportAtlasPieces();
        } else {
          utils.setStatus('Por favor carga al menos el spritemap y el atlas');
          return;
        }

        if (zipBlob) {
          // Crear enlace de descarga
          const url = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = animationEngine.frames.length > 0 ? 'animation_frames.zip' : 'atlas_pieces.zip';
          a.click();
          
          URL.revokeObjectURL(url);
          utils.setStatus('Exportación completada exitosamente');
        }
      } catch (error) {
        utils.setStatus('Error en la exportación: ' + error.message);
      } finally {
        elements.convertBtn.disabled = false;
      }
    });

    // Configurar botón de abrir ZIP (si se necesita)
    elements.openZipBtn.addEventListener('click', () => {
      utils.setStatus('Función no implementada aún');
    });

    utils.setStatus('🚀 Sistema inicializado. Carga los archivos para comenzar.');
  };

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();