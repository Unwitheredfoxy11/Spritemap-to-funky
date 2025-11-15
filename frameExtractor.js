// frameExtractor.js - Sistema de extracción directa de frames sin previsualización
(function() {
  'use strict';

  class FrameExtractor {
    constructor() {
      this.atlasImage = null;
      this.atlasData = null;
      this.animationData = null;
      this.frames = [];
      this.isProcessing = false;
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

    // Analiza la estructura de la animación y extrae todos los frames
    extractAnimationFrames(animationData, atlasMap) {
      const frames = [];
      
      if (!animationData?.ANIMATION?.TIMELINE?.LAYERS) {
        console.warn('No se encontró estructura de animación válida');
        return frames;
      }

      const layers = animationData.ANIMATION.TIMELINE.LAYERS;
      
      // Encontrar el número total de frames
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

      console.log(`Total frames encontrados: ${maxFrames}`);

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

              // Calcular punto de transformación
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
              const symbolName = symbolInstance.SYMBOL_name;
              
              if (symbolName) {
                spriteName = this.findMatchingSprite(symbolName, atlasMap);
              }

              // Si no encontramos por nombre, usar el índice del frame
              if (!spriteName) {
                spriteName = String(frameIndex).padStart(4, '0');
              }

              // Verificar que el sprite existe en el atlas
              if (atlasMap[spriteName]) {
                const spriteData = {
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
                };

                // Agregar el elemento a todos los frames de la duración
                for (let i = frameIndex; i < frameIndex + duration && i < frames.length; i++) {
                  frames[i].push(spriteData);
                }
              } else {
                console.warn(`Sprite '${spriteName}' no encontrado en atlas`);
              }
            });
          }
        });
      });

      // Filtrar frames vacíos y retornar
      const validFrames = frames.filter(frame => frame && frame.length > 0);
      console.log(`Frames válidos extraídos: ${validFrames.length}`);
      return validFrames;
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

    // Renderiza un frame específico en un canvas
    renderFrameToCanvas(canvas, frameData, image) {
      if (!canvas || !frameData || !image) return false;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Configurar fondo transparente
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Ordenar elementos por capa
      const sortedElements = [...frameData].sort((a, b) => a.layerIndex - b.layerIndex);

      let renderedElements = 0;

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
          try {
            ctx.transform(
              m.m00, m.m10, m.m01, m.m11, m.m30, m.m31
            );
          } catch (e) {
            console.warn('Error aplicando transformación:', e);
          }
        }

        // Calcular posición de dibujo
        const drawX = x;
        const drawY = y;

        try {
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
          renderedElements++;
        } catch (e) {
          console.error('Error dibujando sprite:', e);
        }

        ctx.restore();
      });

      return renderedElements > 0;
    }

    // Exporta todos los frames como imágenes PNG
    async exportFramesToZip(onProgress = null) {
      if (!this.frames.length || !this.atlasImage) {
        throw new Error('No hay frames o imagen para exportar');
      }

      const zip = new JSZip();
      const folder = zip.folder('animation_frames');
      
      // Crear canvas para renderizado
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;

      let exportedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < this.frames.length; i++) {
        try {
          // Renderizar frame
          const rendered = this.renderFrameToCanvas(canvas, this.frames[i], this.atlasImage);
          
          if (rendered) {
            // Convertir a blob
            const blob = await new Promise((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) {
                  resolve(blob);
                } else {
                  reject(new Error('Failed to create blob'));
                }
              }, 'image/png');
            });

            // Agregar al ZIP
            const fileName = `frame_${String(i).padStart(4, '0')}.png`;
            folder.file(fileName, blob);
            exportedCount++;
          } else {
            console.warn(`Frame ${i} no pudo ser renderizado`);
            errorCount++;
          }

          // Reportar progreso
          if (onProgress) {
            onProgress(i + 1, this.frames.length, exportedCount, errorCount);
          }

          // Pequeña pausa para no bloquear la UI
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }

        } catch (error) {
          console.error(`Error procesando frame ${i}:`, error);
          errorCount++;
        }
      }

      console.log(`Exportación completada: ${exportedCount} frames exportados, ${errorCount} errores`);
      return { zip, exportedCount, errorCount };
    }

    // Carga los datos necesarios
    async loadData(atlasImage, atlasData, animationData) {
      this.atlasImage = atlasImage;
      this.atlasData = atlasData;
      this.animationData = animationData;

      const atlasMap = this.buildAtlasMap(atlasData);
      this.frames = this.extractAnimationFrames(animationData, atlasMap);

      return this.frames.length;
    }

    // Obtiene información del extractor
    getInfo() {
      return {
        totalFrames: this.frames.length,
        isProcessing: this.isProcessing,
        atlasSpriteCount: this.atlasData?.ATLAS?.SPRITES?.length || 0,
        animationName: this.animationData?.ANIMATION?.name || 'Unknown',
        symbolName: this.animationData?.ANIMATION?.SYMBOL_name || 'Unknown'
      };
    }

    // Limpia los datos
    clear() {
      this.atlasImage = null;
      this.atlasData = null;
      this.animationData = null;
      this.frames = [];
      this.isProcessing = false;
    }
  }

  // Exportar la clase
  window.FrameExtractor = FrameExtractor;
})();