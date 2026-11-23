const maxBytes = 32 * 1024 * 1024;
const maxImages = 256;
/** Reuse immutable image IDs within the current authenticated panel session. */
export class ImageCache {
    images = new Map();
    pending = new Map();
    scope = new AbortController();
    bytes = 0;
    async get(client, path, signal) {
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
                if (!cacheSignal.aborted)
                    this.pending.delete(path);
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
    async load(client, path, signal) {
        const response = await client.fetchWithAuth(path, { signal, cache: "no-store" });
        if (!response.ok) {
            const problem = await response.json().catch(() => ({}));
            throw new Error(problem.reason ?? "failed");
        }
        const blob = await response.blob();
        signal.throwIfAborted();
        const image = { blob, headers: response.headers };
        if (blob.size <= maxBytes) {
            this.images.set(path, image);
            this.bytes += blob.size;
            for (const [key, entry] of this.images) {
                if (this.images.size <= maxImages && this.bytes <= maxBytes)
                    break;
                this.images.delete(key);
                this.bytes -= entry.blob.size;
            }
        }
        return image;
    }
}
