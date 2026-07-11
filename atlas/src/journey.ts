import type { Locator, Page } from 'playwright';
import type { JourneyFrame, JourneyTarget } from './types.js';

// Journey frames use JPEG at moderate quality — dozens of frames per run must
// stay embeddable in a single self-contained report file.
const JPEG_QUALITY = 60;

export async function targetBox(page: Page, locator: Locator): Promise<JourneyTarget | undefined> {
  try {
    const box = await locator.boundingBox({ timeout: 2000 });
    const vp = page.viewportSize();
    if (!box || !vp) return undefined;
    return {
      x: (box.x / vp.width) * 100,
      y: (box.y / vp.height) * 100,
      w: (box.width / vp.width) * 100,
      h: (box.height / vp.height) * 100,
    };
  } catch {
    return undefined;
  }
}

export async function captureFrame(
  page: Page,
  caption: string,
  kind: 'script' | 'agent',
  target?: JourneyTarget
): Promise<JourneyFrame | undefined> {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
    return { caption, kind, url: page.url(), screenshot: buf.toString('base64'), target };
  } catch {
    return undefined;
  }
}

export function pushFrame(frames: JourneyFrame[], frame: JourneyFrame | undefined): void {
  if (frame) frames.push(frame);
}
