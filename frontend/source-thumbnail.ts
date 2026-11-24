import { ImageCache, type ImageClient } from "./image-cache.js";

/** Display a native entity picture or an authenticated, revisioned upload. */
export class SourceThumbnail {
  private path?: string;
  private request?: AbortController;
  private objectUrl?: string;

  constructor(private readonly image: HTMLImageElement, private readonly images: ImageCache) {
    image.addEventListener("load", () => { image.hidden = !image.naturalWidth; });
    image.addEventListener("error", () => { image.hidden = true; });
  }

  async show(path?: string, uploadClient?: ImageClient) {
    if (path === this.path) return;
    this.path = path;
    this.request?.abort();
    this.image.hidden = true;
    this.image.removeAttribute("src");
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    if (!path) return;
    if (!uploadClient) {
      this.image.src = path;
      return;
    }
    const { signal } = this.request = new AbortController();
    const blob = await this.images.get(uploadClient, path, signal).catch(() => undefined);
    if (!blob?.size || signal.aborted) return;
    this.objectUrl = URL.createObjectURL(blob);
    this.image.src = this.objectUrl;
  }
}
