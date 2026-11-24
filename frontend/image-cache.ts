export type ImageClient = {
  fetchWithAuth(path: string, init?: RequestInit): Promise<Response>;
};

const maxBytes = 32 * 1024 * 1024;
const maxImages = 256;

/** Reuse immutable image IDs within the current authenticated panel session. */
export class ImageCache {
  private readonly images = new Map<string, Blob>();
  private readonly pending = new Map<string, Promise<Blob>>();
  private scope = new AbortController();
  private bytes = 0;

  async get(client: ImageClient, path: string, signal: AbortSignal): Promise<Blob> {
    signal.throwIfAborted();
    const image = this.images.get(path);
    if (image) {
      this.images.delete(path);
      this.images.set(path, image);
      return image;
    }
    let request = this.pending.get(path);
    if (!request) {
      const { signal: cacheSignal } = this.scope;
      request = this.load(client, path, cacheSignal);
      this.pending.set(path, request);
      const release = () => {
        if (!cacheSignal.aborted) this.pending.delete(path);
      };
      void request.then(release, release);
    }
    const loaded = await request;
    signal.throwIfAborted();
    return loaded;
  }

  clear() {
    this.scope.abort();
    this.scope = new AbortController();
    this.pending.clear();
    this.images.clear();
    this.bytes = 0;
  }

  private async load(client: ImageClient, path: string, signal: AbortSignal): Promise<Blob> {
    const response = await client.fetchWithAuth(path, { signal, cache: "no-store" });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.reason ?? "failed");
    }
    const blob = await response.blob();
    signal.throwIfAborted();
    if (blob.size <= maxBytes) {
      this.images.set(path, blob);
      this.bytes += blob.size;
      for (const [key, entry] of this.images) {
        if (this.images.size <= maxImages && this.bytes <= maxBytes) break;
        this.images.delete(key);
        this.bytes -= entry.size;
      }
    }
    return blob;
  }
}
