import { comparisonStrings as text } from "./translations.js";
import { actionLabel } from "./action.js";
import { numberField } from "./number-field.js";
import { bindRegionDrawing, paintRegion } from "./region.js";
const engines = ["pillow", "tarsius"];
const engineNames = { pillow: "Pillow", tarsius: "Tarsius (ncnn)" };
const tabs = ["preview", "references", "history", "settings"];
const coordinates = ["x", "y", "width", "height"];
const accept = "image/jpeg,image/png,image/webp";
const actionIcons = {
    add_state: "plus", cancel: "close", classify: "tag-plus-outline",
    close: "close", correct: "tag-edit-outline", draw: "crop",
    move: "arrow-right", refreshHistory: "refresh", reload: "refresh", remove: "delete-outline",
    rename: "pencil-outline", save: "content-save-outline", stop_draw: "check", test: "play-outline",
    view_reference: "image-search-outline", whole: "crop-free",
};
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display:block; margin-top: 12px; }
    [hidden] { display:none !important; }
    .row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
    .fieldRow { align-items:flex-start; }
    .fieldActions { min-height:var(--ha-space-14, 56px); }
    ha-tab-group { margin-bottom:16px; }
    @media (max-width: 480px) {
      ha-tab-group-tab { font-size: var(--ha-font-size-s, 12px); }
      ha-tab-group-tab::part(base) { padding-inline: var(--ha-space-1, 4px); }
    }
    ha-input, ha-select { min-width:0; max-width:100%; }
    .secondary { color:var(--secondary-text-color); font-size:.95em; }
    p { margin:8px 0; overflow-wrap:anywhere; }
    #feedback { margin:12px 0; }
    #progress { display:block; --ha-progress-bar-track-height:4px; }
    #historySettings { display:grid; align-items:start; gap:8px;
      grid-template-columns:repeat(auto-fit, minmax(min(100%, 180px), 1fr)); margin-top:8px; }
    #historySettings .row { grid-column:1 / -1; }
    #historyMode, #historyLimit { width:100%; }
    .comparisonImages { display:grid; align-items:start; gap:12px; margin:12px 0;
      grid-template-columns:repeat(2,minmax(0,1fr)); }
    .comparisonImages:not(.withMatch) { grid-template-columns:minmax(0,1fr); }
    @media(max-width:480px) { .comparisonImages { grid-template-columns:minmax(0,1fr); } }
    .comparisonImages figure { margin:0; min-width:0; }
    .comparisonImages figcaption { margin:0 0 6px; font-weight:500; }
    .imagebox { position:relative; width:min(100%, calc(52dvh * var(--ratio, 1))); margin:auto; }
    #matchFrame { display:block; width:100%; max-height:52dvh; object-fit:contain;
      border-radius:var(--ha-border-radius-md, 8px); }
    #frame { display:block; width:100%; height:auto; border-radius:var(--ha-border-radius-md, 8px); }
    .drawing { touch-action:none; cursor:crosshair; user-select:none; }
    #region { position:absolute; pointer-events:none; border:2px solid var(--primary-color); box-sizing:border-box;
      box-shadow:0 0 0 1px #111, inset 0 0 0 1px #111; background:color-mix(in srgb, var(--primary-color) 18%, transparent); }
    .confirmationTitle { margin: 0; font: inherit; font-weight: var(--ha-font-weight-medium, 500); }
    #result { margin:12px 0; }
    #result > strong { display:block; font-size:1.1em; }
    table { width:100%; border-collapse:collapse; }
    td, th { padding:8px; text-align:start; border-bottom:1px solid var(--divider-color); overflow-wrap:anywhere; }
    td:nth-child(n+2), th:nth-child(n+2) { text-align:end; }
    #gallery { display:grid; gap:8px; margin-top:12px; }
    .state {
      --expansion-panel-summary-padding: 0 12px;
      --expansion-panel-content-padding: 0 12px;
    }
    .stateContent { padding-block: 4px 12px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr)); gap:8px; }
    .reference { display:grid; gap:6px; min-width:0; padding:8px; border-radius:var(--ha-border-radius-md, 8px);
      background:var(--secondary-background-color); overflow-wrap:anywhere; }
    .reference[data-matched=true] { outline:2px solid var(--primary-color); }
    .openImage { width:100%; --ha-button-height:auto; }
    .openImage::part(base) { padding:0; }
    .openImage::part(label) { width:100%; }
    .accessibleLabel { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
    .original { display:block; max-width:100%; max-height:65dvh; margin:auto; }
    .reference img { width:100%; height:110px; object-fit:contain; }
    fieldset { margin:12px 0; padding:12px; border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-md, 8px); }
    label { display:grid; gap:4px; margin:4px 0; }
    ha-file-upload { display:block; min-width:0; margin-block:8px; }
    .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,135px),1fr)); gap:6px 12px; }
    #classify { border-top:1px solid var(--divider-color); padding-top:8px; }
    #stateMessage { margin-bottom:9px; }
  </style>
  <ha-tab-group id="nav" active="preview">
    <ha-tab-group-tab slot="nav" panel="preview" id="tab-preview" aria-controls="preview"></ha-tab-group-tab>
    <ha-tab-group-tab slot="nav" panel="references" id="tab-references" aria-controls="references"></ha-tab-group-tab>
    <ha-tab-group-tab slot="nav" panel="history" id="tab-history" aria-controls="history"></ha-tab-group-tab>
    <ha-tab-group-tab slot="nav" panel="settings" id="tab-settings" aria-controls="settings"></ha-tab-group-tab>
  </ha-tab-group>
  <ha-progress-bar id="progress" indeterminate hidden></ha-progress-bar>
  <p class="secondary" id="progressText" role="status" hidden></p>
  <ha-alert id="feedback" hidden role="status"></ha-alert>
  <ha-button id="reload" appearance="plain" hidden></ha-button>
  <section id="preview" role="tabpanel" aria-labelledby="tab-preview">
    <div class="row">
      <ha-button id="test" variant="brand"></ha-button>
      <ha-button id="draw" appearance="plain" hidden></ha-button>
      <ha-button id="whole" appearance="plain" hidden></ha-button>
    </div>
    <p class="secondary" id="previewHint" role="status"></p>
    <div id="result" aria-live="polite"></div>
    <div class="comparisonImages" id="comparisonImages" hidden>
      <figure id="match" hidden>
        <figcaption id="matchCaption"></figcaption>
        <img id="matchFrame" alt="">
      </figure>
      <figure>
        <figcaption id="captureCaption"></figcaption>
        <div class="imagebox" id="imagebox" hidden>
          <img id="frame" draggable="false">
          <div id="region" hidden aria-hidden="true"></div>
        </div>
      </figure>
    </div>
    <div id="scores"></div>
    <div id="classify" class="row" hidden>
      <ha-select id="captureState"></ha-select>
      <ha-button id="captureAdd" appearance="outlined"></ha-button>
    </div>
  </section>
  <section id="references" role="tabpanel" aria-labelledby="tab-references" hidden>
    <form id="stateForm" class="row fieldRow">
      <ha-input id="stateName" required maxlength="120" enterkeyhint="done"></ha-input>
      <div class="row fieldActions"><ha-button id="addState" variant="brand"></ha-button></div>
    </form>
    <p id="stateMessage" class="secondary"></p>
    <div id="gallery"></div>
  </section>
  <section id="history" role="tabpanel" aria-labelledby="tab-history" hidden>
    <div id="historySettings"><ha-select id="historyMode"></ha-select>
      <ha-input type="number" id="historyLimit" min="1" max="100" required step="1"></ha-input>
      <div class="row"><ha-button id="saveHistory"></ha-button><ha-button appearance="plain" id="refreshHistory"></ha-button></div>
    </div>
    <p id="historyMessage" class="secondary"></p><div class="grid" id="historyGrid"></div>
  </section>
  <section id="settings" role="tabpanel" aria-labelledby="tab-settings" hidden>
    <ha-select id="engine"></ha-select>
    <p id="thresholdsHint" class="secondary"></p>
    <div id="thresholdFields" class="fields"></div>
    <fieldset><legend id="cropLabel"></legend>
      <p id="regionHint" class="secondary"></p>
      <div id="regionFields" class="fields"></div>
    </fieldset>
    <ha-button id="save" variant="brand"></ha-button>
    <p id="dirty" class="secondary"></p>
    <slot name="profile-settings"></slot>
  </section>
  <div id="dialogSlot"></div>
`;
export class ImageLabComparison extends HTMLElement {
    client;
    profile;
    sourceKey;
    available = false;
    tab = "preview";
    labels = text.en;
    scope;
    gallery;
    result;
    captured = false;
    busy = false;
    drawing = false;
    cancelDrawing;
    draftRegion = null;
    frameUrl;
    matchUrl;
    thumbnailUrls = [];
    thumbnailObserver;
    matchId;
    expandedStates = new Set();
    constructor() {
        super();
        this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
        this.get("nav").addEventListener("wa-tab-show", (event) => {
            const tab = event.detail.name;
            if (tab !== this.tab)
                this.show(tab);
        });
        this.shadowRoot.addEventListener("selected", (event) => {
            const select = event.target;
            if (select instanceof HTMLElement && select.localName === "ha-select") {
                select.value = event.detail.value;
                if (select.id === "engine") {
                    this.renderEngine();
                    this.renderDirty();
                }
            }
        });
        this.onClick("refreshHistory", () => this.loadHistory());
        this.onClick("saveHistory", () => this.task(async (signal) => {
            const field = this.get("historyLimit");
            if (!field.reportValidity())
                return;
            await this.update("history_settings", {
                mode: this.get("historyMode").value, limit: Number(field.value),
            }, signal);
            this.renderHistory();
            this.feedback(this.labels.saved);
        }));
        this.onClick("reload", () => this.load());
        this.onClick("test", () => this.evaluate());
        this.onClick("draw", () => {
            this.drawing = !this.drawing;
            this.cancelDrawing();
            this.renderRegion();
            this.refresh();
        });
        this.onClick("whole", () => this.setRegion(null));
        this.onClick("save", () => this.task(async (signal) => {
            await this.update("settings", this.readSettings(), signal);
            this.fillSettings();
            this.feedback(this.labels.saved);
        }));
        this.onClick("captureAdd", () => this.task(async (signal) => {
            if (!this.result?.image_id || !this.captured)
                return;
            const state_id = this.get("captureState").value;
            if (!state_id)
                throw new Error("choose_state");
            const stamp = new Intl.DateTimeFormat(this.client?.locale.language, {
                dateStyle: "short",
                timeStyle: "medium",
                timeZone: this.client?.config?.time_zone,
            }).format();
            await this.update("add", {
                state_id,
                name: `${this.labels.capture} ${stamp}`,
                capture_id: this.result.image_id,
            }, signal);
            this.captured = false;
            this.feedback(this.labels.capture_saved);
        }));
        const stateName = this.get("stateName");
        const createState = () => this.saveState(stateName);
        this.get("stateForm").addEventListener("submit", event => {
            event.preventDefault();
            void createState();
        });
        this.onClick("addState", createState);
        stateName.addEventListener("keydown", event => {
            if (event.key !== "Enter" || event.isComposing || event.defaultPrevented)
                return;
            event.preventDefault();
            void createState();
        });
        for (const field of [
            "max_distance",
            "min_margin",
            ...coordinates,
        ]) {
            const isCoordinate = coordinates.some((key) => key === field);
            const input = numberField(isCoordinate ? 100 : 255);
            input.id = field;
            input.addEventListener("input", () => {
                if (isCoordinate) {
                    try {
                        this.draftRegion = this.readRegion();
                        this.renderRegion();
                    }
                    catch {
                        /* incomplete entry */
                    }
                }
                this.renderDirty();
            });
            this.get(isCoordinate ? "regionFields" : "thresholdFields").append(input);
        }
        const box = this.get("imagebox");
        this.cancelDrawing = bindRegionDrawing(box, () => this.drawing, region => this.renderRegion(region), region => {
            this.drawing = false;
            this.setRegion(region);
        });
        const frame = this.get("frame");
        frame.addEventListener("load", () => box.style.setProperty("--ratio", String(frame.naturalWidth / frame.naturalHeight)));
        this.localize();
        this.refresh();
    }
    configure(client, profile, sourceKey, available = false) {
        const sameProfile = profile === this.profile;
        const changed = !sameProfile ||
            sourceKey !== this.sourceKey ||
            available !== this.available ||
            (profile !== undefined && !this.scope && this.isConnected);
        if (!sameProfile)
            this.expandedStates.clear();
        this.client = client;
        this.profile = profile;
        this.sourceKey = sourceKey;
        this.available = available;
        const labels = client?.locale.language.startsWith("fr") ? text.fr : text.en;
        if (this.labels !== labels) {
            this.labels = labels;
            this.localize();
            this.updateSelectors();
            this.renderResult();
            if (this.tab === "history")
                this.renderHistory();
            else
                this.renderGallery();
        }
        if (changed) {
            this.reset();
            this.show(sameProfile ? this.tab : "preview");
            if (profile && client && this.isConnected)
                void this.load();
        }
        else {
            this.refresh();
        }
    }
    connectedCallback() {
        if (this.profile && this.client && !this.scope)
            void this.load();
    }
    disconnectedCallback() {
        this.reset();
    }
    get(id) {
        return this.shadowRoot.getElementById(id);
    }
    onClick(id, fn) {
        this.get(id).addEventListener("click", () => void fn());
    }
    loadUploadComponents() {
        if (customElements.get("ha-file-upload") || this.get("uploadLoader") || !this.client)
            return;
        // HA loads its file uploader and progress bar when a file selector is rendered.
        const loader = document.createElement("ha-selector");
        loader.id = "uploadLoader";
        loader.hidden = true;
        Object.assign(loader, { hass: this.client, selector: { file: { accept } } });
        this.shadowRoot.append(loader);
        void customElements.whenDefined("ha-file-upload").then(() => loader.remove());
    }
    localize() {
        const names = {
            saveHistory: "save", refreshHistory: "refreshHistory",
            test: "test",
            draw: "draw",
            whole: "whole",
            captureAdd: "classify",
            addState: "add_state",
            reload: "reload",
            cropLabel: "crop",
            matchCaption: "closest", captureCaption: "currentCapture",
            regionHint: "region_help",
            save: "save",
        };
        for (const tab of tabs)
            names["tab-" + tab] = tab;
        for (const key of ["max_distance", "min_margin", ...coordinates])
            this.get(key).setAttribute("label", this.labels[key]);
        this.get("historyLimit").setAttribute("label", this.labels.historyLimit);
        for (const [id, label] of Object.entries(names)) {
            const icon = actionIcons[label];
            if (icon)
                actionLabel(this.get(id), this.labels[label], icon);
            else
                this.get(id).textContent = this.labels[label];
        }
        this.get("stateName").setAttribute("label", this.labels.new_state);
        const engine = this.get("engine");
        engine.label = this.labels.engine;
        engine.options = engines.map((value) => ({ value, label: engineNames[value] }));
        this.renderEngine();
        const mode = this.get("historyMode");
        mode.label = this.labels.historyMode;
        mode.options = ["off", "changes", "all"].map(value => ({
            value, label: this.labels[value],
        }));
        this.get("captureState").label = this.labels.state;
        this.get("frame").alt = this.labels.preview;
        this.get("nav").setAttribute("aria-label", "Image Lab");
    }
    reset() {
        this.scope?.abort();
        this.progress();
        this.get("dialogSlot").replaceChildren();
        this.scope = undefined;
        this.gallery = undefined;
        this.result = undefined;
        this.captured = false;
        this.busy = false;
        this.drawing = false;
        this.cancelDrawing();
        this.draftRegion = null;
        this.matchId = undefined;
        this.setFrame();
        this.setMatch();
        this.clearThumbnails();
        this.get("gallery").replaceChildren();
        this.get("historyGrid").replaceChildren();
        this.get("stateName").value = "";
        this.feedback();
        this.renderResult();
    }
    refresh() {
        this.get("preview").setAttribute("aria-busy", String(this.busy));
        this.get("test").toggleAttribute("disabled", !this.gallery || this.busy || !this.available);
        this.get("addState").toggleAttribute("disabled", !this.gallery || this.busy);
        this.get("references").setAttribute("aria-busy", String(this.busy));
        this.get("gallery").inert = this.busy;
        this.get("history").inert = this.busy || !this.gallery;
        this.get("reload").hidden = Boolean(this.gallery) || this.busy;
        this.get("draw").hidden = !this.frameUrl;
        const draw = this.drawing ? "stop_draw" : "draw";
        actionLabel(this.get("draw"), this.labels[draw], actionIcons[draw]);
        this.get("whole").hidden = !this.draftRegion;
        this.get("imagebox").classList.toggle("drawing", this.drawing);
        this.get("previewHint").textContent = this.busy ? "" : this.drawing
            ? this.labels.drawing
            : !this.available
                ? this.labels.unavailable
                : this.frameUrl
                    ? ""
                    : this.labels.empty;
        this.get("classify").hidden =
            !this.captured || !this.frameUrl || !this.gallery?.states.length;
        this.get("captureAdd").toggleAttribute("disabled", this.busy);
        this.renderDirty();
    }
    show(tab) {
        this.tab = tab;
        this.get("nav").setAttribute("active", tab);
        for (const key of tabs)
            this.get(key).hidden = tab !== key;
        if (tab === "references")
            this.renderGallery();
        else if (tab === "history") {
            this.renderHistory();
            void this.loadHistory();
        }
        else
            this.clearThumbnails();
        this.refresh();
    }
    async load() {
        if (!this.profile || !this.client)
            return;
        this.loadUploadComponents();
        this.scope?.abort();
        this.scope = new AbortController();
        await this.task(async (signal) => {
            this.gallery = await this.request("", signal);
            if (signal.aborted)
                return;
            this.fillSettings();
            this.updateSelectors();
            if (this.tab === "references")
                this.renderGallery();
            if (this.tab === "history")
                this.renderHistory();
        });
    }
    feedback(message = "", error = false) {
        const notice = this.get("feedback");
        notice.hidden = !message;
        notice.textContent = message;
        notice.setAttribute("alert-type", error ? "error" : "info");
    }
    async task(run) {
        const signal = this.scope?.signal;
        if (this.busy || !signal || signal.aborted)
            return;
        this.busy = true;
        this.progress(this.labels.working);
        this.feedback();
        this.refresh();
        try {
            await run(signal);
        }
        catch (error) {
            if (!signal.aborted) {
                const key = error instanceof Error ? error.message : "";
                this.feedback(Object.hasOwn(this.labels, key)
                    ? this.labels[key]
                    : this.labels.failed, true);
            }
        }
        finally {
            if (!signal.aborted) {
                this.busy = false;
                this.progress();
                this.refresh();
            }
        }
    }
    progress(label = "", done, total = 1) {
        const bar = this.get("progress");
        const status = this.get("progressText");
        bar.toggleAttribute("indeterminate", done === undefined);
        bar.setAttribute("value", String(done === undefined ? 0 : 100 * done / total));
        bar.hidden = status.hidden = !label;
        status.textContent = label;
    }
    async request(path, signal, payload) {
        const response = await this.client.fetchWithAuth(this.url(path), {
            signal,
            cache: "no-store",
            ...(payload && {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }),
        });
        await this.checkResponse(response);
        const data = await response.json();
        signal.throwIfAborted();
        return data;
    }
    url(path) {
        return `/api/image_lab/comparison/${encodeURIComponent(this.profile)}${path}`;
    }
    async checkResponse(response) {
        if (!response.ok) {
            const problem = await response.json().catch(() => ({}));
            throw new Error(problem.reason ?? "failed");
        }
    }
    async update(operation, data, signal) {
        this.gallery = await this.request("/" + operation, signal, data);
        this.updateSelectors();
    }
    updateSelectors() {
        const captureState = this.get("captureState");
        this.stateOptions(captureState, captureState.value, false);
    }
    stateOptions(select, state = select.value, first = true) {
        select.options = (this.gallery?.states ?? []).map(({ id, name }) => ({
            value: id, label: name,
        }));
        select.value = select.options.some((option) => option.value === state)
            ? state : (first ? select.options[0]?.value : undefined) ?? "";
    }
    async evaluate() {
        await this.task(async (signal) => {
            const settings = this.readSettings();
            this.setFrame();
            this.setMatch();
            this.captured = false;
            this.result = undefined;
            this.matchId = undefined;
            this.drawing = false;
            this.cancelDrawing();
            this.renderResult();
            this.show("preview");
            const result = await this.request("/test", signal, {
                settings,
            });
            this.result = result;
            this.matchId = result.data.reference_id ?? undefined;
            this.stateOptions(this.get("captureState"), result.data.state_id ?? "", false);
            this.renderResult();
            if (result.image_id) {
                const blob = await this.fetchImage(result.image_id, signal);
                signal.throwIfAborted();
                this.setFrame(URL.createObjectURL(blob));
                this.captured = true;
                if (this.matchId) {
                    const reference = await this.fetchImage(this.matchId, signal).catch(() => undefined);
                    signal.throwIfAborted();
                    if (reference)
                        this.setMatch(URL.createObjectURL(reference));
                }
            }
        });
    }
    resultTable(columns, rows) {
        const table = document.createElement("table");
        const head = table.createTHead().insertRow();
        for (const column of columns) {
            const cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = column;
            head.append(cell);
        }
        const body = table.createTBody();
        for (const cells of rows) {
            const row = body.insertRow();
            for (const value of cells)
                row.insertCell().textContent = value;
        }
        return table;
    }
    async fetchImage(id, signal, thumbnail = false) {
        const suffix = thumbnail ? "?thumbnail=1" : "";
        const response = await this.client.fetchWithAuth(this.url("/image/" + id + suffix), { signal, cache: "no-store" });
        await this.checkResponse(response);
        return response.blob();
    }
    setFrame(url) {
        if (this.frameUrl)
            URL.revokeObjectURL(this.frameUrl);
        this.frameUrl = url;
        const frame = this.get("frame");
        if (url)
            frame.src = url;
        else
            frame.removeAttribute("src");
        this.get("imagebox").hidden = !url;
        this.get("comparisonImages").hidden = !url;
        this.renderRegion();
    }
    setMatch(url) {
        if (this.matchUrl)
            URL.revokeObjectURL(this.matchUrl);
        this.matchUrl = url;
        const image = this.get("matchFrame");
        if (url)
            image.src = url;
        else
            image.removeAttribute("src");
        this.get("match").hidden = !url;
        this.get("comparisonImages").classList.toggle("withMatch", Boolean(url));
    }
    renderResult() {
        const panel = this.get("result");
        panel.replaceChildren();
        this.get("scores").replaceChildren();
        const result = this.result;
        if (!result)
            return;
        const title = document.createElement("strong");
        const message = document.createElement("p");
        if (result.status === "ok")
            title.textContent = `${this.labels.recognized} · ${result.data.state}`;
        if (result.status === "unknown")
            title.textContent = this.labels.unknown;
        if (result.reason) {
            const key = result.reason;
            message.textContent = Object.hasOwn(this.labels, key)
                ? this.labels[key]
                : this.labels.failed;
        }
        panel.append(title, message);
        if (result.data.engine) {
            const engine = document.createElement("p");
            engine.className = "secondary";
            engine.textContent = engineNames[result.data.engine];
            panel.append(engine);
        }
        const reference = this.gallery?.references.find((item) => item.id === result.data.reference_id);
        if (reference) {
            const best = document.createElement("p");
            best.textContent = `${this.labels.closest} · ${result.data.best_state} · ${reference.name}`;
            if (result.data.margin != null)
                best.textContent += ` · ${this.labels.gap} ${result.data.margin}`;
            const view = this.button("view_reference", async () => {
                const current = this.gallery?.references.find(item => item.id === reference.id);
                if (!current)
                    return;
                this.expandedStates.add(current.state_id);
                this.show("references");
                const match = this.get("gallery").querySelector("[data-matched=true]");
                await match?.closest("ha-expansion-panel")?.updateComplete;
                match?.scrollIntoView({ block: "nearest" });
                match?.focus({ preventScroll: true });
            });
            panel.append(best, view);
        }
        if (result.data.scores && Object.keys(result.data.scores).length) {
            const scores = result.data.scores;
            const similarity = result.data.engine === "tarsius";
            const order = (state) => Object.hasOwn(scores, state)
                ? (similarity ? -scores[state] : scores[state]) : Infinity;
            const rows = Object.entries(result.data.ref_counts ?? {})
                .sort(([a], [b]) => order(a) - order(b))
                .map(([state, count]) => [
                state,
                Object.hasOwn(scores, state) ? String(scores[state]) : "–",
                String(count),
            ]);
            this.get("scores").append(this.resultTable([this.labels.state, similarity ? this.labels.similarity : this.labels.score, this.labels.count], rows));
        }
    }
    renderEngine() {
        const tarsius = this.get("engine").value === "tarsius";
        this.get("thresholdFields").hidden = tarsius;
        this.get("thresholdsHint").textContent = this.labels[tarsius ? "tarsius_settings" : "thresholds"];
    }
    fillSettings() {
        if (!this.gallery)
            return;
        const { settings } = this.gallery;
        this.get("engine").value = settings.engine;
        this.renderEngine();
        this.get("max_distance").value = String(settings.max_distance);
        this.get("min_margin").value = String(settings.min_margin);
        this.setRegion(settings.region);
    }
    readRegion() {
        const fields = coordinates.map((name) => this.get(name));
        if (fields.every((field) => !field.value && field.checkValidity()))
            return null;
        if (fields.some((field) => !field.checkValidity() || !field.value))
            throw new Error("invalid_settings");
        const [x, y, width, height] = fields.map((field) => Number(field.value) / 100);
        if (width <= 0 ||
            height <= 0 ||
            x + width > 1 + 1e-9 ||
            y + height > 1 + 1e-9) {
            throw new Error("invalid_settings");
        }
        return { x, y, width, height };
    }
    readSettings() {
        const max = this.get("max_distance");
        const margin = this.get("min_margin");
        const engine = this.get("engine").value === "tarsius" ? "tarsius" : "pillow";
        const valid = max.checkValidity() && !!max.value && margin.checkValidity() && !!margin.value;
        if (engine === "pillow" && !valid)
            throw new Error("invalid_settings");
        return {
            engine, region: this.readRegion(),
            max_distance: valid ? Number(max.value) : this.gallery.settings.max_distance,
            min_margin: valid ? Number(margin.value) : this.gallery.settings.min_margin,
        };
    }
    renderDirty() {
        const status = this.get("dirty");
        status.textContent = "";
        let changed = false;
        if (this.gallery) {
            try {
                const draft = this.readSettings();
                const saved = this.gallery.settings;
                changed = draft.engine !== saved.engine || draft.max_distance !== saved.max_distance ||
                    draft.min_margin !== saved.min_margin ||
                    coordinates.some((key) => Math.abs((draft.region?.[key] ?? -1) - (saved.region?.[key] ?? -1)) > 1e-9);
                if (changed)
                    status.textContent = this.labels.dirty;
            }
            catch {
                status.textContent = this.labels.invalid_settings;
            }
        }
        this.get("save").toggleAttribute("disabled", this.busy || !changed);
    }
    setRegion(region) {
        this.draftRegion = region;
        for (const key of coordinates)
            this.get(key).value = region
                ? String(Math.round(region[key] * 10000) / 100)
                : "";
        this.renderRegion();
        this.refresh();
    }
    renderRegion(region = this.draftRegion) {
        paintRegion(this.get("region"), this.frameUrl ? region : null);
    }
    button(label, action) {
        const button = document.createElement("ha-button");
        button.setAttribute("appearance", "plain");
        button.setAttribute("size", "s");
        if (label === "remove")
            button.setAttribute("variant", "danger");
        actionLabel(button, this.labels[label], actionIcons[label]);
        button.addEventListener("click", () => void action());
        return button;
    }
    confirmRemoval(question, name, remove) {
        const dialog = document.createElement("ha-dialog");
        dialog.setAttribute("type", "alert");
        dialog.setAttribute("header-title", this.labels[question]);
        dialog.setAttribute("width", "small");
        dialog.setAttribute("prevent-scrim-close", "");
        dialog.setAttribute("aria-describedby", "removalDescription");
        const header = document.createElement("ha-dialog-header");
        header.slot = "header";
        const title = document.createElement("h2");
        title.className = "confirmationTitle";
        title.slot = "title";
        title.textContent = this.labels[question];
        header.append(title);
        const item = document.createElement("p");
        item.id = "removalDescription";
        item.textContent = name;
        const footer = document.createElement("ha-dialog-footer");
        footer.slot = "footer";
        const cancel = document.createElement("ha-button");
        cancel.slot = "secondaryAction";
        cancel.setAttribute("appearance", "plain");
        cancel.setAttribute("autofocus", "");
        cancel.textContent = this.labels.cancel;
        cancel.onclick = () => dialog.removeAttribute("open");
        const confirm = document.createElement("ha-button");
        confirm.slot = "primaryAction";
        confirm.setAttribute("variant", "danger");
        confirm.textContent = this.labels.remove;
        confirm.onclick = () => {
            dialog.removeAttribute("open");
            remove();
        };
        footer.append(cancel, confirm);
        dialog.append(header, item, footer);
        dialog.addEventListener("closed", () => dialog.remove(), { once: true });
        this.get("dialogSlot").replaceChildren(dialog);
        dialog.setAttribute("open", "");
    }
    observeThumbnails() {
        this.thumbnailObserver = new IntersectionObserver((entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting)
                    continue;
                const image = entry.target;
                observer.unobserve(image);
                void this.thumbnail(image);
            }
        });
    }
    loadHistory() {
        return this.task(async (signal) => {
            this.gallery = await this.request("", signal);
            if (this.tab === "history")
                this.renderHistory();
        });
    }
    inspectImage(id, title) {
        return this.task(async (signal) => {
            const blob = await this.fetchImage(id, signal);
            signal.throwIfAborted();
            const url = URL.createObjectURL(blob);
            const dialog = document.createElement("ha-dialog");
            dialog.setAttribute("header-title", title);
            const image = document.createElement("img");
            image.className = "original";
            image.alt = title;
            image.src = url;
            const footer = document.createElement("ha-dialog-footer");
            footer.slot = "footer";
            const close = this.button("close", () => dialog.removeAttribute("open"));
            close.slot = "primaryAction";
            footer.append(close);
            dialog.append(image, footer);
            const release = () => {
                URL.revokeObjectURL(url);
                signal.removeEventListener("abort", release);
                dialog.remove();
            };
            signal.addEventListener("abort", release, { once: true });
            dialog.addEventListener("closed", release, { once: true });
            this.get("dialogSlot").replaceChildren(dialog);
            dialog.setAttribute("open", "");
        });
    }
    renderHistory() {
        this.clearThumbnails();
        const grid = this.get("historyGrid");
        grid.replaceChildren();
        if (!this.gallery)
            return;
        this.get("historyMode").value = this.gallery.history_settings.mode;
        this.get("historyLimit").value = String(this.gallery.history_settings.limit);
        this.get("historyMessage").textContent = !this.gallery.history.length
            ? this.labels.emptyHistory : !this.gallery.states.length ? this.labels.no_states : "";
        this.observeThumbnails();
        for (const item of [...this.gallery.history].reverse()) {
            const card = document.createElement("article");
            card.className = "reference";
            const title = document.createElement("strong");
            title.textContent = item.state_id ? item.state : this.labels.unknown;
            const stamp = document.createElement("span");
            stamp.textContent = new Date(item.time).toLocaleString(this.client?.locale.language, {
                timeZone: this.client?.config?.time_zone,
            }) + " · " + engineNames[item.engine];
            const open = this.imageButton(item.id, stamp.textContent, this.labels.viewCapture);
            card.append(open, title, stamp);
            if (item.reason && Object.hasOwn(this.labels, item.reason)) {
                const reason = document.createElement("span");
                reason.className = "secondary";
                reason.textContent = this.labels[item.reason];
                card.append(reason);
            }
            const ref = this.gallery.references.find(r => r.id === item.id);
            if (this.gallery.states.length) {
                const state = document.createElement("ha-select");
                state.label = this.labels.expected;
                this.stateOptions(state, ref?.state_id ?? item.state_id ?? "");
                card.append(state, this.button("correct", () => this.task(async (signal) => {
                    await this.update("correct", { capture_id: item.id, state_id: state.value }, signal);
                    this.renderHistory();
                    this.feedback(this.labels.capture_saved);
                })));
            }
            if (ref) {
                const assigned = document.createElement("span");
                assigned.textContent = [this.labels.training,
                    this.gallery.states.find(s => s.id === ref.state_id)?.name].join(" · ");
                card.append(assigned);
            }
            grid.append(card);
        }
    }
    renderGallery() {
        this.clearThumbnails();
        const node = this.get("gallery");
        node.replaceChildren();
        this.get("stateMessage").textContent =
            this.gallery && !this.gallery.states.length ? this.labels.no_states : "";
        if (!this.gallery || this.tab !== "references")
            return;
        this.observeThumbnails();
        for (const state of this.gallery.states) {
            const panel = document.createElement("ha-expansion-panel");
            panel.className = "state";
            panel.setAttribute("outlined", "");
            panel.setAttribute("header", state.name);
            panel.toggleAttribute("expanded", this.expandedStates.has(state.id));
            panel.addEventListener("expanded-changed", event => {
                if (event.target !== panel)
                    return;
                if (event.detail.expanded)
                    this.expandedStates.add(state.id);
                else
                    this.expandedStates.delete(state.id);
            });
            const section = document.createElement("div");
            section.className = "stateContent";
            const controls = document.createElement("div");
            controls.className = "row fieldRow";
            const name = document.createElement("ha-input");
            name.value = state.name;
            name.setAttribute("maxlength", "120");
            name.setAttribute("required", "");
            name.setAttribute("label", this.labels.state);
            const rename = this.button("rename", () => this.saveState(name, state.id));
            const remove = this.button("remove", () => this.confirmRemoval("confirm_state", state.name, () => this.galleryMutation("delete_state", { state_id: state.id })));
            const actions = document.createElement("div");
            actions.className = "row fieldActions";
            actions.append(rename, remove);
            controls.append(name, actions);
            section.append(controls);
            const upload = document.createElement("ha-file-upload");
            upload.setAttribute("multiple", "");
            upload.setAttribute("accept", accept);
            upload.setAttribute("label", this.labels.upload);
            upload.addEventListener("file-picked", event => {
                const { files } = event.detail;
                upload.value = undefined;
                if (files.length)
                    void this.importReferences(Array.from(files), state.id);
            });
            const grid = document.createElement("div");
            grid.className = "grid";
            for (const ref of this.gallery.references.filter(item => item.state_id === state.id)) {
                grid.append(this.referenceRow(ref));
            }
            section.append(upload, grid);
            panel.append(section);
            node.append(panel);
        }
    }
    referenceRow(ref) {
        const card = document.createElement("article");
        card.className = "reference";
        card.dataset.matched = String(this.matchId === ref.id);
        card.tabIndex = -1;
        const title = document.createElement("strong");
        title.textContent = ref.name;
        const state = document.createElement("ha-select");
        state.label = this.labels.state;
        this.stateOptions(state, ref.state_id);
        const controls = document.createElement("div");
        controls.className = "row";
        const move = this.button("move", () => this.galleryMutation("move", {
            reference_id: ref.id,
            state_id: state.value,
        }));
        const remove = this.button("remove", () => this.confirmRemoval("confirm_remove", ref.name, () => this.galleryMutation("delete", { reference_id: ref.id })));
        controls.append(move, remove);
        const image = this.imageButton(ref.id, ref.name, `${this.labels.view_reference} · ${ref.name}`);
        card.append(image, title, state, controls);
        return card;
    }
    imageButton(id, title, label) {
        const image = document.createElement("img");
        image.alt = "";
        image.dataset.reference = id;
        this.thumbnailObserver?.observe(image);
        const open = document.createElement("ha-button");
        open.className = "openImage";
        open.setAttribute("appearance", "plain");
        open.onclick = () => void this.inspectImage(id, title);
        const openLabel = document.createElement("span");
        openLabel.className = "accessibleLabel";
        openLabel.textContent = label;
        open.append(image, openLabel);
        return open;
    }
    async galleryMutation(operation, data) {
        await this.task(async (signal) => {
            await this.update(operation, data, signal);
            if (operation === "delete_state" && data.state_id)
                this.expandedStates.delete(data.state_id);
            this.renderGallery();
        });
    }
    saveState(input, state_id) {
        if (!this.gallery || !input.reportValidity())
            return;
        return this.task(async (signal) => {
            await this.update("state", { state_id, name: input.value }, signal);
            if (!state_id)
                input.value = "";
            this.renderGallery();
        });
    }
    async importReferences(files, state_id) {
        await this.task(async (signal) => {
            let accepted = 0;
            let rejected = 0;
            for (const [index, file] of files.entries()) {
                signal.throwIfAborted();
                this.progress(`${this.labels.importing} ${index + 1}/${files.length} · ${file.name}`, index, files.length);
                try {
                    if (file.size > 10 * 1024 * 1024)
                        throw new Error("image_too_large");
                    const body = new FormData();
                    body.append("file", file, file.name);
                    const response = await this.client.fetchWithAuth("/api/file_upload", { method: "POST", body, signal });
                    await this.checkResponse(response);
                    const { file_id } = await response.json();
                    signal.throwIfAborted();
                    await this.update("add", {
                        upload_id: file_id,
                        state_id,
                        name: file.name,
                    }, signal);
                    accepted++;
                }
                catch {
                    rejected++;
                }
            }
            if (signal.aborted)
                return;
            this.renderGallery();
            this.feedback(`${this.labels.imported} ${accepted} · ${this.labels.rejected} ${rejected}`, rejected > 0);
        });
    }
    async thumbnail(image) {
        const signal = this.scope?.signal;
        if (!signal || !image.isConnected)
            return;
        try {
            const blob = await this.fetchImage(image.dataset.reference, signal, true);
            if (!image.isConnected || signal.aborted || (this.tab !== "references" && this.tab !== "history"))
                return;
            const url = URL.createObjectURL(blob);
            this.thumbnailUrls.push(url);
            image.src = url;
        }
        catch {
            image.hidden = true;
        }
    }
    clearThumbnails() {
        this.thumbnailObserver?.disconnect();
        this.thumbnailObserver = undefined;
        for (const url of this.thumbnailUrls)
            URL.revokeObjectURL(url);
        this.thumbnailUrls = [];
    }
}
customElements.define("image-lab-comparison", ImageLabComparison);
