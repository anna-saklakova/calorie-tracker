/** Longest side a picked photo is kept at; Recognize scales it down further as needed. */
const PHOTO_MAX_SIDE = 2048;

/**
 * Takes a picked photo into memory, upright and no larger than PHOTO_MAX_SIDE, so any problem with it
 * shows up right away rather than at Recognize. Gallery picks on Android can be backed by a file the
 * browser may no longer be allowed to read later, and full-size phone photos are heavy to decode
 * several at a time, so the app only ever keeps this copy.
 */
export async function loadPhoto(file: File): Promise<File> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error('Couldn’t read this photo. If it’s only in the cloud, download it to the phone and try again');
  }
  if (!bytes.byteLength) throw new Error('This photo is empty. Pick it again');
  const canvas = await drawScaled(new Blob([bytes], { type: file.type }), PHOTO_MAX_SIDE);
  const jpeg = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!jpeg) throw new Error('Couldn’t open this photo. Try a JPEG or PNG');
  return new File([jpeg], `${(file.name || 'photo').replace(/\.[^.]*$/, '')}.jpg`, { type: 'image/jpeg' });
}

/** Loads a photo and re-encodes it as a JPEG data URL no larger than `maxSide` px on its long side. */
export async function toJpegDataUrl(file: Blob, maxSide: number, quality = 0.82): Promise<string> {
  return (await drawScaled(file, maxSide)).toDataURL('image/jpeg', quality);
}

async function drawScaled(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const { source, width, height, close } = await decode(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Couldn’t open this photo. Try again');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    close();
  }
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch {
    // fallback for browsers without createImageBitmap options
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('Couldn’t open this photo. Try a JPEG or PNG');
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
}
