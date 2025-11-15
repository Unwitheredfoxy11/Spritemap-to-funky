// main.js - Sistema de extracción directa de frames sin previsualización
(function() {
  'use strict';

  // Variables globales
  let frameExtractor = null;
  let elements = {};
  let isProcessing = false;

  // Utilidades
  const utils = {
    setStatus: (message, isError = false) => {
      if (elements.statusEl) {
        elements.statusEl.textContent = message;
        elements.statusEl.className = isError ? 'error' : '';
        console.log(isError ? '[ERROR]' : '[STATUS]', message);
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
    },

    // Descarga un archivo
    downloadFile: (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // UI Controller simplificado
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

    // Muestra/oculta elementos de carga
    setLoadingState: (isLoading) => {
      isProcessing = isLoading;
      elements.convertBtn.disabled = isLoading;
      elements.convertBtn.textContent = isLoading ? '⏳ Procesando...' : '📦 Exportar Frames';
      
      if (elements.animInput) elements.animInput.disabled = isLoading;
      if (elements.jsonInput) elements.jsonInput.disabled = isLoading;
      if (elements.pngInput) elements.pngInput.disabled = isLoading;
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
          if (frameExtractor) {
            frameExtractor.atlasImage = image;
          }
          utils.setStatus(`✅ Imagen cargada: ${image.width}x${image.height}px`);
        };
        image.src = dataUrl;
      } catch (error) {
        utils.setStatus(`❌ Error al cargar imagen: ${error.message}`, true);
      }
    },

    handleAtlasFile: async (file) => {
      try {
        utils.setStatus('Cargando atlas...');
        const text = await utils.fileToText(file);
        const atlasData = JSON.parse(text);
        
        if (frameExtractor) {
          frameExtractor.atlasData = atlasData;
        }
        
        const spriteCount = atlasData?.ATLAS?.SPRITES?.length || 0;
        utils.setStatus(`✅ Atlas cargado: ${spriteCount} sprites`);
      } catch (error) {
        utils.setStatus(`❌ Error al cargar atlas: ${error.message}`, true);
      }
    },

    handleAnimFile: async (file) => {
      try {
        utils.setStatus('Cargando animación...');
        const text = await utils.fileToText(file);
        const animationData = JSON.parse(text);
        
        if (frameExtractor) {
          frameExtractor.animationData = animationData;
        }
        
        const animName = animationData?.ANIMATION?.name || 'Sin nombre';
        utils.setStatus(`✅ Animación cargada: ${animName}`);
      } catch (error) {
        utils.setStatus(`❌ Error al cargar animación: ${error.message}`, true);
      }
    },

    // Procesa la extracción de frames
    processExtraction: async () => {
      if (!frameExtractor || !frameExtractor.atlasImage || !frameExtractor.atlasData || !frameExtractor.animationData) {
        utils.setStatus('❌ Faltan archivos necesarios. Carga todos los archivos primero.', true);
        return false;
      }

      uiController.setLoadingState(true);
      
      try {
        utils.setStatus('Analizando estructura de animación...');
        
        // Cargar datos y extraer frames
        const frameCount = await frameExtractor.loadData(
          frameExtractor.atlasImage,
          frameExtractor.atlasData,
          frameExtractor.animationData
        );

        if (frameCount === 0) {
          utils.setStatus('❌ No se encontraron frames en la animación', true);
          return false;
        }

        utils.setStatus(`✅ ${frameCount} frames detectados. Listo para exportar.`);
        return true;

      } catch (error) {
        utils.setStatus(`❌ Error al procesar animación: ${error.message}`, true);
        return false;
      } finally {
        uiController.setLoadingState(false);
      }
    }
  };

  // Sistema de exportación
  const exportSystem = {
    exportFrames: async () => {
      if (!frameExtractor || frameExtractor.frames.length === 0) {
        utils.setStatus('❌ No hay frames para exportar', true);
        return false;
      }

      uiController.setLoadingState(true);
      
      try {
        const info = frameExtractor.getInfo();
        utils.setStatus(`🎬 Exportando ${info.totalFrames} frames...`);

        // Exportar frames a ZIP
        const result = await frameExtractor.exportFramesToZip((current, total, exported, errors) => {
          const progress = Math.round((current / total) * 100);
          utils.setStatus(`📤 Exportando... ${progress}% (${exported}/${total} frames, ${errors} errores)`);
        });

        if (result.exportedCount === 0) {
          utils.setStatus('❌ No se pudo exportar ningún frame', true);
          return false;
        }

        // Generar nombre de archivo con información
        const animName = info.animationName.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `animation_${animName}_${info.totalFrames}frames.zip`;

        utils.setStatus('📦 Comprimiendo archivo ZIP...');
        
        // Generar ZIP
        const zipBlob = await result.zip.generateAsync({ 
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        });

        // Descargar archivo
        utils.downloadFile(zipBlob, filename);
        
        utils.setStatus(`✅ Exportación completada: ${result.exportedCount} frames exportados`);
        return true;

      } catch (error) {
        utils.setStatus(`❌ Error al exportar: ${error.message}`, true);
        return false;
      } finally {
        uiController.setLoadingState(false);
      }
    }
  };

  // Sistema de validación
  const validator = {
    validateFiles: () => {
      if (!frameExtractor) {
        return { valid: false, message: 'Sistema no inicializado' };
      }

      if (!frameExtractor.atlasImage) {
        return { valid: false, message: 'Falta el archivo PNG del spritemap' };
      }

      if (!frameExtractor.atlasData) {
        return { valid: false, message: 'Falta el archivo JSON del atlas' };
      }

      if (!frameExtractor.animationData) {
        return { valid: false, message: 'Falta el archivo JSON de animación' };
      }

      return { valid: true, message: 'Todos los archivos están cargados' };
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
      statusEl: document.getElementById('status'),
      convertBtn: document.getElementById('convertir')
    };

    // Crear instancia del extractor
    frameExtractor = new FrameExtractor();

    // Configurar drag & drop
    uiController.setupDragDrop(elements.dropBoxPng, elements.pngInput, fileHandlers.handlePngFile);
    uiController.setupDragDrop(elements.dropBoxAtlas, elements.jsonInput, fileHandlers.handleAtlasFile);
    uiController.setupDragDrop(elements.dropBoxAnim, elements.animInput, fileHandlers.handleAnimFile);

    // Configurar botón de conversión
    elements.convertBtn.addEventListener('click', async () => {
      if (isProcessing) {
        utils.setStatus('⏳ Ya hay un proceso en curso...');
        return;
      }

      // Validar archivos
      const validation = validator.validateFiles();
      if (!validation.valid) {
        utils.setStatus(`❌ ${validation.message}`, true);
        return;
      }

      // Procesar y exportar
      const processed = await fileHandlers.processExtraction();
      if (processed) {
        await exportSystem.exportFrames();
      }
    });

    utils.setStatus('🚀 Sistema listo. Carga los tres archivos para comenzar.');
  };

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();