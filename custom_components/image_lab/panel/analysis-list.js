const moduleIcons = {
    comparison: "image-multiple-outline",
    palette: "palette-outline",
    object_detection: "image-search-outline",
    meter: "gauge",
};
export const analysisListStyles = `
  #analysisGroups { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--ha-space-3, 12px); }
  #analysisGroups ha-expansion-panel {
    --expansion-panel-summary-padding: 0 var(--ha-space-3, 12px);
    --expansion-panel-content-padding: 0;
    background: var(--card-background-color);
  }
  .analysisGroupIcon { color: var(--primary-color); }
  .analysisGroupRows {
    display: grid; grid-template-columns: minmax(0, 1fr); row-gap: var(--ha-space-1, 4px);
    border-block-start: 1px solid var(--divider-color);
  }
  .analysisAction {
    display: block; width: 100%;
    --ha-button-height: auto;
    --ha-button-border-radius: 0;
    --ha-button-label-overflow: visible;
  }
  .analysisAction + .analysisAction { border-block-start: 1px solid var(--divider-color); }
  .analysisAction::part(base) {
    box-sizing: border-box; height: auto; width: 100%;
    padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
  }
  .analysisAction::part(label) { min-width: 0; width: 100%; padding-block: 0; }
  .analysisRow {
    display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center;
    gap: var(--ha-space-3, 12px);
    text-align: start;
    color: var(--primary-text-color);
  }
  .analysisText { min-width: 0; }
  .analysisTitle, .analysisCaption {
    display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .analysisCaption {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
    font-weight: var(--ha-font-weight-normal, 400);
  }
  .analysisCaption.warning { color: var(--warning-color); }
  .analysisCaption:not(:empty) { margin-block-start: var(--ha-space-1, 4px); }
  .analysisPreview {
    display: grid; place-items: center; grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    width: 44px; height: 44px; overflow: hidden;
  }
  .analysisPreview img {
    width: 100%; height: 100%; object-fit: cover;
    border-radius: var(--ha-border-radius-md, 8px);
  }
  .analysisPlaceholder {
    display: grid; place-items: center; width: 36px; height: 36px;
    border-radius: 50%; color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 12%, var(--card-background-color));
  }
  .analysisChevron { color: var(--secondary-text-color); --mdc-icon-size: 18px; }
`;
export class AnalysisList {
    element;
    images;
    select;
    thumbnails = new Map();
    revisions = new Map();
    collapsed = new Set();
    observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting)
                continue;
            this.observer.unobserve(entry.target);
            const preview = entry.target;
            const thumbnail = this.thumbnails.get(preview.dataset.profileId);
            if (thumbnail?.image.parentElement === preview)
                void this.load(thumbnail);
        }
    });
    scope = new AbortController();
    client;
    epoch = 0;
    constructor(element, images, select) {
        this.element = element;
        this.images = images;
        this.select = select;
    }
    render(rows, client, noMatches) {
        this.clear();
        this.client = client;
        if (!rows.length) {
            const message = document.createElement("p");
            message.className = "secondary";
            message.setAttribute("role", "status");
            message.textContent = noMatches;
            this.element.append(message);
            return;
        }
        const groups = new Map();
        for (const row of rows) {
            const group = groups.get(row.module);
            if (group)
                group.push(row);
            else
                groups.set(row.module, [row]);
        }
        for (const [module, items] of groups) {
            const panel = document.createElement("ha-expansion-panel");
            panel.setAttribute("outlined", "");
            panel.setAttribute("header", items[0].type);
            panel.toggleAttribute("expanded", !this.collapsed.has(module));
            panel.addEventListener("expanded-changed", event => {
                if (event.target !== panel)
                    return;
                if (event.detail.expanded)
                    this.collapsed.delete(module);
                else
                    this.collapsed.add(module);
            });
            const icon = this.icon(moduleIcons[module], "analysisGroupIcon");
            icon.slot = "leading-icon";
            const content = document.createElement("div");
            content.className = "analysisGroupRows";
            for (const item of items)
                content.append(this.createRow(item));
            panel.append(icon, content);
            this.element.append(panel);
        }
    }
    refresh(update) {
        if (update) {
            this.revisions.set(update.profile_id, update.image_id);
            const thumbnail = this.thumbnails.get(update.profile_id);
            if (thumbnail)
                this.observe(thumbnail);
        }
        else {
            this.revisions.clear();
            this.epoch++;
            for (const thumbnail of this.thumbnails.values())
                this.observe(thumbnail);
        }
    }
    clear() {
        this.scope.abort();
        this.scope = new AbortController();
        this.observer.disconnect();
        for (const thumbnail of this.thumbnails.values())
            this.clearImage(thumbnail);
        this.thumbnails.clear();
        this.element.replaceChildren();
    }
    icon(name, className) {
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:" + name);
        icon.setAttribute("aria-hidden", "true");
        if (className)
            icon.className = className;
        return icon;
    }
    createRow(row) {
        const action = document.createElement("ha-button");
        action.id = "analysis-" + row.id;
        action.className = "analysisAction";
        action.setAttribute("appearance", "plain");
        action.setAttribute("variant", "neutral");
        action.addEventListener("click", () => this.select(row.id));
        const content = document.createElement("span");
        content.className = "analysisRow";
        const preview = document.createElement("span");
        preview.className = "analysisPreview";
        preview.setAttribute("aria-hidden", "true");
        const placeholder = document.createElement("span");
        placeholder.className = "analysisPlaceholder";
        placeholder.append(this.icon(moduleIcons[row.module]));
        const image = document.createElement("img");
        image.alt = "";
        image.hidden = true;
        preview.dataset.profileId = row.id;
        const thumbnail = { id: row.id, image, placeholder };
        image.addEventListener("load", () => {
            image.hidden = false;
            placeholder.hidden = true;
        });
        image.addEventListener("error", () => this.clearImage(thumbnail));
        preview.append(placeholder, image);
        const text = document.createElement("span");
        text.className = "analysisText";
        const title = document.createElement("span");
        title.className = "analysisTitle";
        title.textContent = row.name;
        title.title = row.name;
        const caption = document.createElement("span");
        caption.className = "analysisCaption";
        caption.classList.toggle("warning", Boolean(row.warning));
        caption.textContent = row.warning || [row.source, row.schedule].filter(Boolean).join(" · ");
        caption.title = caption.textContent;
        text.append(title, caption);
        content.append(preview, text, this.icon("chevron-right", "analysisChevron"));
        action.append(content);
        this.thumbnails.set(row.id, thumbnail);
        this.observe(thumbnail);
        return action;
    }
    observe(thumbnail) {
        const preview = thumbnail.image.parentElement;
        this.observer.unobserve(preview);
        this.observer.observe(preview);
    }
    clearImage(thumbnail) {
        const { image, placeholder, url } = thumbnail;
        image.hidden = true;
        placeholder.hidden = false;
        image.removeAttribute("src");
        if (url)
            URL.revokeObjectURL(url);
        thumbnail.url = undefined;
    }
    revision(id) {
        return this.revisions.get(id) ?? String(this.epoch);
    }
    async load(thumbnail) {
        const client = this.client;
        if (!client)
            return;
        const { id, image } = thumbnail;
        const revision = this.revision(id);
        const { signal } = this.scope;
        const path = `/api/image_lab/preview/${encodeURIComponent(id)}?thumbnail=1&revision=${encodeURIComponent(revision)}`;
        const result = await this.images.get(client, path, signal).catch(() => undefined);
        if (signal.aborted || revision !== this.revision(id))
            return;
        this.clearImage(thumbnail);
        if (!result?.size)
            return;
        thumbnail.url = URL.createObjectURL(result);
        image.src = thumbnail.url;
    }
}
