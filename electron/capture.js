const { desktopCapturer, screen, nativeImage } = require('electron');

const MAX_DIMENSION = 1920;
/** Above this many pixels a PNG is several MB; JPEG uploads far faster with no OCR loss. */
const JPEG_PIXEL_THRESHOLD = 800 * 600;
const JPEG_QUALITY = 90;

function optimizeImage(image) {
  const { width, height } = image.getSize();
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    return image;
  }

  if (width >= height) {
    return image.resize({ width: MAX_DIMENSION, quality: 'good' });
  }

  return image.resize({ height: MAX_DIMENSION, quality: 'good' });
}

/**
 * Encode for upload. Small region crops stay PNG (lossless, tiny anyway);
 * full-screen captures become high-quality JPEG so the request body shrinks
 * from multiple MB to a few hundred KB.
 * @returns {{ buffer: Buffer, mimeType: string }}
 */
function encodeForUpload(image) {
  const { width, height } = image.getSize();
  if (width * height > JPEG_PIXEL_THRESHOLD) {
    return { buffer: image.toJPEG(JPEG_QUALITY), mimeType: 'image/jpeg' };
  }
  return { buffer: image.toPNG(), mimeType: 'image/png' };
}

/**
 * Capture the screen under the cursor.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function captureScreen(region = null) {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { width, height } = display.size;
  const scaleFactor = display.scaleFactor;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    },
  });

  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];

  if (!source) {
    throw new Error('No screen source available for capture.');
  }

  let image = source.thumbnail;

  if (region) {
    const cropX = Math.round((region.x - display.bounds.x) * scaleFactor);
    const cropY = Math.round((region.y - display.bounds.y) * scaleFactor);
    const cropW = Math.round(region.width * scaleFactor);
    const cropH = Math.round(region.height * scaleFactor);

    image = image.crop({
      x: Math.max(0, cropX),
      y: Math.max(0, cropY),
      width: Math.min(cropW, image.getSize().width - cropX),
      height: Math.min(cropH, image.getSize().height - cropY),
    });
  }

  return encodeForUpload(optimizeImage(image));
}

module.exports = { captureScreen };
