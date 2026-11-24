/** Display a native entity picture or an authenticated, revisioned upload. */
export class SourceThumbnail {
    image;
    images;
    path;
    request;
    objectUrl;
    constructor(image, images) {
        this.image = image;
        this.images = images;
        image.addEventListener("load", () => { image.hidden = !image.naturalWidth; });
        image.addEventListener("error", () => { image.hidden = true; });
    }
    async show(path, uploadClient) {
        if (path === this.path)
            return;
        this.path = path;
        this.request?.abort();
        this.image.hidden = true;
        this.image.removeAttribute("src");
        if (this.objectUrl)
            URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = undefined;
        if (!path)
            return;
        if (!uploadClient) {
            this.image.src = path;
            return;
        }
        const { signal } = this.request = new AbortController();
        const blob = await this.images.get(uploadClient, path, signal).catch(() => undefined);
        if (!blob?.size || signal.aborted)
            return;
        this.objectUrl = URL.createObjectURL(blob);
        this.image.src = this.objectUrl;
    }
}
