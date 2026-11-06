import { Capacitor } from '@capacitor/core';

/** OCR is isolated and can be disabled with VITE_ENABLE_SMALL_SKU_OCR=false. */
export const smallNumberOcrEnabled = import.meta.env.VITE_ENABLE_SMALL_SKU_OCR !== 'false';

export async function captureSmallNumberText(): Promise<string> {
  if (!smallNumberOcrEnabled) throw new Error('OCR_DISABLED');
  if (!Capacitor.isNativePlatform()) throw new Error('OCR_NATIVE_ONLY');
  const [{ Camera, CameraResultType, CameraSource }, { TextRecognition, Script }] = await Promise.all([
    import('@capacitor/camera'),
    import('@capacitor-mlkit/text-recognition'),
  ]);
  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    saveToGallery: false,
  });
  if (!photo.path) throw new Error('OCR_IMAGE_UNAVAILABLE');
  const result = await TextRecognition.processImage({ path: photo.path, script: Script.Latin });
  const digits = result.text.replace(/[٠-٩۰-۹]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - (digit >= '۰' ? 0x06f0 : 0x0660) + 48)).match(/[A-Za-z0-9]{3,}/g);
  if (!digits?.length) throw new Error('OCR_NO_TEXT');
  return digits.sort((left, right) => right.length - left.length)[0];
}
