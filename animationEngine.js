// animationEngine.js - Sistema completo de extracción y renderizado de animaciones
(function() {
  'use strict';

  class AnimationEngine {
    constructor() {
      this.atlasImage = null;
      this.atlasData = null;
      this.animationData = null;
      this.frames = [];
      this.currentFrame = 0;
      this.isPlaying = false;
      this.animationInterval = null;
      this.fps = 10;
    }

    // Construye mapa del atlas
    buildAtlasMap(atlasData) {
      const map = {};
      if (!atlasData?.ATLAS?.SPRITES) return map;

      atlasData.ATLAS.SPRITES.forEach(item => {
        const sprite = item.SPRITE;
        if (sprite?.name) {
          map[sprite.name] = {
            x: Number(sprite.x || 0),
            y: Number(sprite.y || 0),
            w: Number(sprite.w || 0),
            h: Number(sprite.h || 0),
            rotated: Boolean(sprite.rotated)
          };
        }
      });

      return map;
    }

    // Extrae todos los frames de la animación
    extractFrames(animationData, atlasMap) {
      const frames = [];
      
      if (!animationData?.ANIMATION?.TIMELINE?.LAYERS) {
        console.warn('No se encontró estructura de animación válida');
        return frames;
      }

      const layers = animationData.ANIMATION.TIMELINE.LAYERS;
      
      // Primero, encontrar el número total de frames
      let maxFrames = 0;
      layers.forEach(layer => {
        if (layer?.Frames && Array.isArray(layer.Frames)) {
          layer.Frames.forEach(frame => {
            const index = frame.index || 0;
            const duration = frame.duration || 1;
            maxFrames = Math.max(maxFrames, index + duration);
          });
        }
      });

      // Inicializar array de frames
      for (let i = 0; i < maxFrames; i++) {
        frames[i] = [];
      }

      // Procesar cada capa
      layers.forEach((layer, layerIndex) => {
        if (!layer?.Frames || !Array.isArray(layer.Frames)) return;

        layer.Frames.forEach(frameData => {
          const frameIndex = frameData.index || 0;
          const duration = frameData.duration || 1;
          
          // Procesar elementos del frame
          if (frameData.elements && Array.isArray(frameData.elements)) {
            frameData.elements.forEach(element => {
              const symbolInstance = element.SYMBOL_Instance;
              if (!symbolInstance) return;

              // Extraer datos de transformación
              const matrix = symbolInstance.Matrix3D;
              const decomposed = symbolInstance.DecomposedMatrix;
              const transformPoint = symbolInstance.transformationPoint;

              // Calcular posición
              let x = 0, y = 0;
              if (decomposed?.Position) {
                x = Number(decomposed.Position.x || 0);
                y = Number(decomposed.Position.y || 0);
              } else if (matrix) {
                x = Number(matrix.m30 || 0);
                y = Number(matrix.m31 || 0);
              }

              // Calcular punto de transformación (pivot)
              let pivotX = 0, pivotY = 0;
              if (transformPoint) {
                pivotX = Number(transformPoint.x || 0);
                pivotY = Number(transformPoint.y || 0);
              }

              // Ajustar posición considerando el pivot
              x -= pivotX;
              y -= pivotY;

              // Determinar qué sprite usar
              let spriteName = null;
              
              // Buscar por nombre del símbolo
              const symbolName = symbolInstance.SYMBOL_name;
              if (symbolName) {
                // Intentar diferentes estrategias de mapeo
                spriteName = this.findMatchingSprite(symbolName, atlasMap);
              }

              // Si no encontramos por nombre, usar el índice del frame
              if (!spriteName) {
                spriteName = String(frameIndex).padStart(4, '0');
              }

              // Verificar que el sprite existe en el atlas
              if (atlasMap[spriteName]) {
                // Agregar el elemento a todos los frames de la duración
                for (let i = frameIndex; i < frameIndex + duration && i < frames.length; i++) {
                  frames[i].push({
                    sprite: spriteName,
                    x: x,
                    y: y,
                    pivotX: pivotX,
                    pivotY: pivotY,
                    atlasData: atlasMap[spriteName],
                    matrix: matrix,
                    decomposed: decomposed,
                    symbolName: symbolName,
                    layerIndex: layerIndex
                  });
                }
              } else {
                console.warn(`Sprite '${spriteName}' no encontrado en atlas`);
              }
            });
          }
        });
      });

      // Filtrar frames vacíos y retornar
      return frames.filter(frame => frame && frame.length > 0);
    }

    // Encuentra el sprite correspondiente en el atlas
    findMatchingSprite(symbolName, atlasMap) {
      // Estrategia 1: Buscar coincidencia exacta
      if (atlasMap[symbolName]) {
        return symbolName;
      }

      // Estrategia 2: Buscar por número extraído del nombre
      const numberMatch = symbolName.match(/\d+/);
      if (numberMatch) {
        const num = numberMatch[0];
        const paddedNum = num.padStart(4, '0');
        if (atlasMap[paddedNum]) {
          return paddedNum;
        }
      }

      // Estrategia 3: Buscar coincidencia aproximada
      const atlasKeys = Object.keys(atlasMap);
      for (let key of atlasKeys) {
        if (key.toLowerCase().includes(symbolName.toLowerCase()) ||
            symbolName.toLowerCase().includes(key.toLowerCase())) {
          return key;
        }
      }

      return null;
    }

    // Renderiza un frame específico
    renderFrame(canvas, frameData, image) {
      if (!canvas || !frameData || !image) return;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Configurar fondo transparente
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Ordenar elementos por capa (layerIndex) para renderizado correcto
      const sortedElements = [...frameData].sort((a, b) => a.layerIndex - b.layerIndex);

      sortedElements.forEach(element => {
        const { atlasData, x, y, sprite } = element;
        
        if (!atlasData) {
          console.warn(`No atlas data for sprite: ${sprite}`);
          return;
        }

        ctx.save();

        // Aplicar transformaciones si existen
        if (element.matrix) {
          const m = element.matrix;
          ctx.transform(
            m.m00, m.m10, m.m01, m.m11, m.m30, m.m31
          );
        }

        // Dibujar el sprite
        const drawX = x;
        const drawY = y;

        if (atlasData.rotated) {
          // Si el sprite está rotado en el atlas
          ctx.translate(drawX + atlasData.h/2, drawY + atlasData.w/2);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(
            image,
            atlasData.x, atlasData.y, atlasData.w, atlasData.h,
            -atlasData.h/2, -atlasData.w/2, atlasData.h, atlasData.w
          );
        } else {
          // Sprite normal
          ctx.drawImage(
            image,
            atlasData.x, atlasData.y, atlasData.w, atlasData.h,
            drawX, drawY, atlasData.w, atlasData.h
          );
        }

        ctx.restore();
      });
    }

    // Configura el canvas de animación
    setupCanvas(canvas, width = 1920, height = 1080) {
      if (!canvas) return;
      
      canvas.width = width;
      canvas.height = height;
      canvas.style.display = 'block';
      
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }

    // Inicia la animación
    play(canvas, onFrameUpdate = null) {
      if (!this.frames.length || !this.atlasImage) {
        console.warn('No hay frames o imagen para animar');
        return;
      }

      this.isPlaying = true;
      this.currentFrame = 0;

      this.animationInterval = setInterval(() => {
        if (this.currentFrame >= this.frames.length) {
          this.currentFrame = 0;
        }

        this.renderFrame(canvas, this.frames[this.currentFrame], this.atlasImage);
        
        if (onFrameUpdate) {
          onFrameUpdate(this.currentFrame + 1, this.frames.length);
        }

        this.currentFrame++;
      }, 1000 / this.fps);
    }

    // Pausa la animación
    pause() {
      this.isPlaying = false;
      if (this.animationInterval) {
        clearInterval(this.animationInterval);
        this.animationInterval = null;
      }
    }

    // Detiene la animación
    stop() {
      this.pause();
      this.currentFrame = 0;
    }

    // Va a un frame específico
    goToFrame(frameIndex, canvas) {
      if (frameIndex >= 0 && frameIndex < this.frames.length) {
        this.currentFrame = frameIndex;
        this.renderFrame(canvas, this.frames[this.currentFrame], this.atlasImage);
      }
    }

    // Establece FPS
    setFPS(fps) {
      this.fps = Math.max(1, Math.min(60, fps));
      if (this.isPlaying) {
        this.pause();
        this.play();
      }
    }

    // Exporta todos los frames como imágenes
    async exportFrames(zip, onProgress = null) {
      if (!this.frames.length || !this.atlasImage) {
        throw new Error('No hay frames para exportar');
      }

      const folder = zip.folder('animation_frames');
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;

      for (let i = 0; i < this.frames.length; i++) {
        this.renderFrame(canvas, this.frames[i], this.atlasImage);
        
        const blob = await new Promise(resolve => {
          canvas.toBlob(resolve, 'image/png');
        });

        const fileName = `frame_${String(i).padStart(4, '0')}.png`;
        folder.file(fileName, blob);

        if (onProgress) {
          onProgress(i + 1, this.frames.length);
        }

        // Pequeña pausa para no bloquear la UI
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Carga los datos de animación
    async loadData(atlasImage, atlasData, animationData) {
      this.atlasImage = atlasImage;
      this.atlasData = atlasData;
      this.animationData = animationData;

      const atlasMap = this.buildAtlasMap(atlasData);
      this.frames = this.extractFrames(animationData, atlasMap);

      return this.frames.length;
    }

    // Obtiene información de la animación
    getInfo() {
      return {
        totalFrames: this.frames.length,
        currentFrame: this.currentFrame,
        isPlaying: this.isPlaying,
        fps: this.fps,
        animationName: this.animationData?.ANIMATION?.name || 'Unknown',
        symbolName: this.animationData?.ANIMATION?.SYMBOL_name || 'Unknown'
      };
    }
  }

  // Exportar la clase
  window.AnimationEngine = AnimationEngine;
})();