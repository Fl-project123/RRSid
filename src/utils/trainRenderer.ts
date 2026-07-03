import { Train, TrainType, LineDirection } from '../types';

let preloadedBitmaps: Record<string, ImageBitmap> = {};

export async function preloadTrainSprites(): Promise<Record<string, ImageBitmap>> {
  const urls = {
    'CC201': 'CC 201.png',
    'CC206': 'CC 206.png',
    'GerbongKAJJ': 'Gerbong KAJJ.png',
    'GerbongKRL': 'Gerbong KRL.png',
    'KRLJR205': 'KRL JR 205.png'
  };

  const loaded: Record<string, ImageBitmap> = {};
  for (const [key, url] of Object.entries(urls)) {
    try {
      const res = await fetch('/' + url);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      loaded[key] = bitmap;
    } catch (e) {
      console.warn("Retrying with relative path for:", key);
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const bitmap = await createImageBitmap(blob);
        loaded[key] = bitmap;
      } catch (e2) {
        console.error("Failed to pre-render ImageBitmap for:", key, e2);
      }
    }
  }
  preloadedBitmaps = loaded;
  return loaded;
}

export function getLoadedBitmaps(): Record<string, ImageBitmap> {
  return preloadedBitmaps;
}

// Full required renderTrains() function using Canvas drawImage
export function renderTrains() {
  const canvases = document.querySelectorAll('.train-car-canvas');
  canvases.forEach((canvasEl: any) => {
    const canvas = canvasEl as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const type = canvas.dataset.type as TrainType;
    const idx = parseInt(canvas.dataset.idx || '0');
    const totalCars = parseInt(canvas.dataset.totalCars || '4');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let bitmap: ImageBitmap | undefined;

    // Direct mappings to uploaded PNG sprites
    if (type === TrainType.CC201) {
      if (idx === 0) {
        bitmap = preloadedBitmaps['CC201'];
      } else {
        bitmap = preloadedBitmaps['GerbongKAJJ'];
      }
    } else if (type === TrainType.CC206) {
      if (idx === 0) {
        bitmap = preloadedBitmaps['CC206'];
      } else {
        bitmap = preloadedBitmaps['GerbongKAJJ'];
      }
    } else if (type === TrainType.KRL_8 || type === TrainType.KRL_12) {
      if (idx === 0 || idx === totalCars - 1) {
        bitmap = preloadedBitmaps['KRLJR205'];
      } else {
        bitmap = preloadedBitmaps['GerbongKRL'];
      }
    } else if (type === TrainType.Langsir) {
      if (idx === 0) {
        bitmap = preloadedBitmaps['CC201'];
      } else {
        bitmap = preloadedBitmaps['GerbongKRL'];
      }
    } else {
      // Fallback
      if (idx === 0) {
        bitmap = preloadedBitmaps['CC206'];
      } else {
        bitmap = preloadedBitmaps['GerbongKAJJ'];
      }
    }

    if (bitmap) {
      const naturalWidth = bitmap.width || (bitmap as any).naturalWidth || 1;
      const naturalHeight = bitmap.height || (bitmap as any).naturalHeight || 1;
      const aspectRatio = naturalHeight / naturalWidth;
      const targetWidth = canvas.width;
      const targetHeight = targetWidth * aspectRatio;
      const yOffset = Math.max(0, (canvas.height - targetHeight) / 2);
      ctx.drawImage(bitmap, 0, yOffset, targetWidth, targetHeight);
    }
  });
}
