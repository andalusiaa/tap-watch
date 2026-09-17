// Prepares a photo for upload (SPEC section 6.4): at most 1600px on the long edge,
// re-encoded as JPEG. Re-encoding through a canvas drops all metadata, including the
// GPS location a phone camera may have stored in the file.

const MAX_EDGE = 1600;
const MAX_BYTES = 1_900_000;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality),
  );
}

export async function preparePhoto(file: File): Promise<Blob> {
  // 'from-image' turns the picture the right way up using its orientation tag.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not available');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.8, 0.7, 0.6, 0.5]) {
    const blob = await toJpeg(canvas, quality);
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Photo too large');
}
