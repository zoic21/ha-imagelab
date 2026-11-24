import { comparisonStrings as text, panelStrings, publicationStrings } from "./translations.js";
import { actionLabel } from "./action.js";
import { CaptureHistory, HistorySettings, historyMarkup, historySettingsMarkup, historyStyles } from "./history.js";
import { ImageCache } from "./image-cache.js";
import { numberField } from "./number-field.js";
import { paintRegion } from "./region.js";
import { profileTab, profileTabsStyles } from "./profile-tabs.js";
import { editZone } from "./zone.js";
const engines = ["pillow", "tarsius"];
const engineNames = { pillow: "Pillow", tarsius: "Tarsius (ncnn)" };
const tabs = ["preview", "references", "history", "settings"];
const accept = "image/jpeg,image/png,image/webp";
const actionIcons = {
    add_state: "plus", cancel: "close", classify: "tag-plus-outline",
    correct: "tag-edit-outline", edit_zone: "crop",
    move: "arrow-right", reload: "refresh", remove: "delete-outline",
    rename: "pencil-outline", save: "content-save-outline", test: "play-outline",
    upload: "file-upload",
};
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display:block; margin-top: 12px; }
    [hidden] { display:none !important; }
    .row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
    .fieldRow { align-items:flex-start; }
    .fieldActions { min-height:var(--ha-space-14, 56px); }
    ${profileTabsStyles}
    [role="tabpanel"] { padding-block-start: var(--ha-space-4, 16px); }
    ha-input, ha-select { min-width:0; max-width:100%; }
    .secondary { color:var(--secondary-text-color); font-size:.95em; }
    #analysisSettingsTitle { font-size:1rem; margin:0; }
    .analysisHeading {
      display:flex; align-items:center; justify-content:space-between;
      gap:var(--ha-space-2, 8px); margin-block-end:var(--ha-space-2, 8px);
    }
    #engine { width:100%; }
    #thresholdFields ha-input { --ha-input-padding-bottom:0; }
    #thresholdsHint, #dirty { font-size:var(--ha-font-size-s, 12px); }
    #settings:has(#save:not([hidden])) { padding-block-end:var(--ha-space-16, 64px); }
    p { margin:8px 0; overflow-wrap:anywhere; }
    #feedback { margin:12px 0; }
    #progress { display:block; --ha-progress-bar-track-height:4px; }
    ${historyStyles}
    #historySettings {
      border-top:1px solid var(--divider-color); margin-top:var(--ha-space-3, 12px);
      padding-block:var(--ha-space-3, 12px);
    }
    #preview { display:grid; gap:var(--ha-space-3, 12px); }
    .resultHeader {
      display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start;
      gap:var(--ha-space-2, 8px);
    }
    #test { grid-column:2; justify-self:end; }
    #previewHint, #testHint, #result p, #resultDetails p { margin:0; }
    #previewHint:empty, #resultDetails:empty { display:none; }
    #resultTitle { display:block; font-weight:var(--ha-font-weight-medium, 500); overflow-wrap:anywhere; }
    .recognizedState {
      display:inline-flex; align-items:center; gap:var(--ha-space-1, 4px); box-sizing:border-box;
      max-width:calc(100% - var(--ha-space-1, 4px));
      vertical-align:middle; padding:var(--ha-space-1, 4px) var(--ha-space-2, 8px);
      margin-inline-start:var(--ha-space-1, 4px); border-radius:var(--ha-border-radius-pill, 999px);
      background:color-mix(in srgb, var(--success-color, var(--primary-color)) 18%, transparent);
    }
    .recognizedState ha-icon { color:var(--success-color, var(--primary-color)); flex:none; --mdc-icon-size:16px; }
    #result .secondary { margin-block-start:var(--ha-space-1, 4px); font-size:var(--ha-font-size-s, 12px); }
    #resultDetails { display:grid; gap:var(--ha-space-1, 4px); }
    #comparisonImages { min-width:0; }
    #comparisonImages figure { margin:0 auto; width:min(100%, max(220px, calc(52dvh * var(--ratio, 1)))); }
    #captureCaption { margin:0 0 var(--ha-space-1, 4px); font-weight:var(--ha-font-weight-medium, 500); }
    .previewButton { display:block; width:100%; --ha-button-height:auto; }
    .previewButton::part(base) { padding:0; }
    .previewButton::part(label) { display:block; width:100%; padding:0; }
    .imagebox { display:block; position:relative; width:min(100%, calc(var(--capture-height, 52dvh) * var(--ratio, 1))); margin:auto; }
    .imagebox img { display:block; width:100%; height:auto; border-radius:var(--ha-border-radius-md, 8px); }
    .captureRegion { position:absolute; pointer-events:none; border:2px solid var(--primary-color); box-sizing:border-box;
      box-shadow:0 0 0 1px #111, inset 0 0 0 1px #111; background:color-mix(in srgb, var(--primary-color) 18%, transparent); }
    .accessibleLabel { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
    .matchRow {
      display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:center;
      gap:var(--ha-space-2, 8px); padding:var(--ha-space-2, 8px);
      border-bottom:1px solid var(--divider-color); text-align:start;
    }
    figure:has(.matchRow:not([hidden])) #frame { border-end-start-radius:0; border-end-end-radius:0; }
    .matchLabel {
      display:flex; flex-wrap:wrap; align-items:center; gap:var(--ha-space-1, 4px) var(--ha-space-2, 8px);
      overflow-wrap:anywhere;
    }
    #matchCaption { font-weight:var(--ha-font-weight-medium, 500); }
    #matchLink { color:var(--primary-color); }
    .matchThumbnail { display:grid; place-items:center; aspect-ratio:16 / 9; position:relative;
      border-radius:var(--ha-border-radius-md, 8px); overflow:hidden; }
    #matchFrame { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .matchThumbnail ha-icon { color:var(--secondary-text-color); }
    .matchThumbnail img:not([src]), .matchThumbnail:has(img[src]) ha-icon { visibility:hidden; }
    #matchMeta {
      box-sizing:border-box; max-width:100%; padding:2px var(--ha-space-2, 8px); border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-pill, 999px); font-size:var(--ha-font-size-s, 12px);
    }
    #scoreDetails { --expansion-panel-summary-padding:0; --expansion-panel-content-padding:0; }
    #scores > p { margin:0 0 var(--ha-space-1, 4px); }
    .confirmationTitle { margin: 0; font: inherit; font-weight: var(--ha-font-weight-medium, 500); }
    table { width:100%; border-collapse:collapse; }
    td, th { padding:8px; text-align:start; border-bottom:1px solid var(--divider-color); overflow-wrap:anywhere; }
    td:nth-child(n+2), th:nth-child(n+2) { text-align:end; }
    #gallery { display:grid; gap:8px; margin-top:12px; }
    .state {
      --expansion-panel-summary-padding: 0 12px;
      --expansion-panel-content-padding: 0 12px;
    }
    .stateContent { padding-block: 4px 12px; }
    .stateEditor {
      display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:start;
      gap:var(--ha-space-1, 4px);
    }
    .stateActions {
      display:flex; align-items:center; min-height:var(--ha-space-14, 56px);
    }
    .stateActions .removeState { color:var(--error-color); }
    .referenceGrid {
      display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%, 180px),1fr));
      gap:var(--ha-space-2, 8px);
    }
    @media(max-width:600px) {
      .referenceGrid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    }
    .reference { min-width:0; border-radius:var(--ha-border-radius-md, 8px); }
    .reference[data-matched=true] { outline:2px solid var(--primary-color); }
    .openImage {
      display:block; width:100%; height:100%; color:var(--primary-text-color);
      --ha-button-height:auto; --ha-button-border-radius:var(--ha-border-radius-md, 8px);
    }
    .openImage::part(base) { padding:0; height:100%; }
    .openImage::part(label) { width:100%; height:100%; }
    .referenceTile {
      display:block; height:100%; border-radius:var(--ha-border-radius-md, 8px);
      overflow:hidden; background:var(--secondary-background-color); text-align:start;
      font-weight:var(--ha-font-weight-normal, 400);
    }
    .referenceThumbnail {
      display:grid; place-items:center; aspect-ratio:16 / 9; position:relative;
      background:var(--divider-color); color:var(--secondary-text-color);
    }
    .referenceThumbnail img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    .referenceThumbnail img:not([src]) { visibility:hidden; }
    .referenceCaption { display:block; padding:var(--ha-space-2, 8px); }
    .referenceName, .referenceDetail { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .referenceName { font-weight:var(--ha-font-weight-medium, 500); }
    .referenceDetail { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px); }
    .referencePreview { --ha-dialog-min-height:auto; }
    .original {
      display:block; max-width:100%; max-height:65dvh; margin:auto;
      object-fit:contain; border-radius:var(--ha-border-radius-md, 8px);
    }
    .moveTarget { width:100%; }
    .referenceImport { margin-block:var(--ha-space-2, 8px); }
    .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,135px),1fr)); gap:6px 12px; }
    #captureDialog { --ha-dialog-min-height:auto; --capture-height:56dvh; }
    #classify { margin-block-start:var(--ha-space-3, 12px); }
    #captureState { flex:1 1 100px; }
    #stateMessage { margin-bottom:9px; }
  </style>
  <ha-tab-group id="nav" class="profileTabs" active="preview">
    ${profileTab("tab-preview", "preview", "preview", "image-outline")}
    ${profileTab("tab-references", "references", "references", "image-multiple-outline")}
    ${profileTab("tab-history", "history", "history", "history")}
    ${profileTab("tab-settings", "settings", "settings", "cog-outline")}
  </ha-tab-group>
  <ha-progress-bar id="progress" indeterminate hidden></ha-progress-bar>
  <p class="secondary" id="progressText" role="status" hidden></p>
  <ha-alert id="feedback" hidden role="status"></ha-alert>
  <ha-alert id="referenceReview" alert-type="warning" hidden>
    <span id="referenceReviewMessage"></span>
    <ha-button id="confirmReferences" slot="action" appearance="plain"></ha-button>
  </ha-alert>
  <ha-button id="reload" appearance="plain" hidden></ha-button>
  <section id="preview" role="tabpanel" aria-labelledby="tab-preview">
    <div class="resultHeader">
      <div id="result" aria-live="polite" hidden></div>
      <ha-button id="test" variant="brand"></ha-button>
    </div>
    <p class="secondary" id="previewHint" role="status"></p>
    <p class="secondary" id="testHint" hidden></p>
    <div id="resultDetails"></div>
    <div id="comparisonImages" hidden>
      <div id="captureCaption"></div>
      <figure>
        <ha-button id="openCapture" class="previewButton" appearance="plain" variant="neutral">
          <span id="openCaptureLabel" class="accessibleLabel"></span>
          <span class="imagebox" id="imagebox">
            <img id="frame" alt="" draggable="false">
            <span id="region" class="captureRegion" hidden aria-hidden="true"></span>
          </span>
        </ha-button>
        <figcaption id="matchRow" class="matchRow" hidden>
          <span class="matchThumbnail" aria-hidden="true">
            <ha-icon icon="mdi:image-outline"></ha-icon><img id="matchFrame" alt="">
          </span>
          <span class="matchLabel"><span id="matchCaption"></span><span id="matchMeta" class="secondary" hidden></span></span>
          <ha-icon-button id="matchLink"><ha-icon icon="mdi:link-variant" aria-hidden="true"></ha-icon></ha-icon-button>
        </figcaption>
      </figure>
    </div>
    <ha-expansion-panel id="scoreDetails" hidden><div id="scores"></div></ha-expansion-panel>
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
    ${historyMarkup}
  </section>
  <section id="settings" role="tabpanel" aria-labelledby="tab-settings" hidden>
    <div id="settingsFields">
      <div class="analysisHeading">
        <h3 id="analysisSettingsTitle"></h3>
        <ha-button id="editZone" appearance="plain" size="s"></ha-button>
      </div>
      <ha-select id="engine"></ha-select>
      <p id="thresholdsHint" class="secondary"></p>
      <div id="thresholdFields" class="fields"></div>
      <section id="historySettings">${historySettingsMarkup}</section>
      <slot name="profile-settings"></slot>
    </div>
    <p id="dirty" class="secondary" role="status" hidden></p>
    <ha-button id="save" class="settingsSave" variant="brand" size="l" hidden></ha-button>
  </section>
  <ha-dialog id="captureDialog">
    <div class="imagebox" id="captureDialogBox">
      <img id="captureDialogImage" draggable="false">
      <div id="captureDialogRegion" class="captureRegion" hidden aria-hidden="true"></div>
    </div>
    <div id="classify" class="row" hidden>
      <ha-select id="captureState"></ha-select>
      <ha-button id="captureAdd" appearance="outlined"></ha-button>
    </div>
  </ha-dialog>
  <div id="dialogSlot"></div>
`;
export class ImageLabComparison extends HTMLElement {
    images;
    publication;
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
    activity;
    refreshPreview = false;
    frameUrl;
    matchUrl;
    thumbnailUrls = [];
    thumbnailObserver;
    matchId;
    history;
    historySettings;
    expandedStates = new Set();
    constructor(images = new ImageCache(), publication) {
        super();
        this.images = images;
        this.publication = publication;
        this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
        this.history = new CaptureHistory(this.get("history"), () => void this.loadHistory());
        const historySettings = this.get("historySettings");
        this.historySettings = new HistorySettings(historySettings, true);
        historySettings.addEventListener("selected", () => this.refreshSettings());
        historySettings.addEventListener("input", () => this.refreshSettings());
        this.get("nav").addEventListener("wa-tab-show", (event) => {
            const tab = event.detail.name;
            if (tab !== this.tab) {
                this.show(tab);
                this.dispatchEvent(new Event("analysis-tab-changed"));
            }
        });
        this.shadowRoot.addEventListener("selected", (event) => {
            const select = event.target;
            if (select instanceof HTMLElement && select.localName === "ha-select") {
                select.value = event.detail.value;
                if (select.id === "engine") {
                    this.renderEngine();
                    this.refreshSettings();
                }
                if (select.id === "captureState")
                    this.refresh();
            }
        });
        this.onClick("reload", () => this.load());
        this.onClick("test", () => this.evaluate());
        this.onClick("confirmReferences", () => this.task(async (signal) => {
            const review_id = this.gallery?.reference_review;
            if (review_id)
                await this.update("confirm_references", { review_id }, signal);
        }));
        this.onClick("openCapture", () => this.openCapture());
        this.onClick("matchLink", () => this.openMatch());
        const captureDialog = this.get("captureDialog");
        captureDialog.addEventListener("closed", event => {
            if (event.target === captureDialog)
                this.closeCapture();
        });
        this.onClick("editZone", () => {
            if (!this.gallery || !this.profile || !this.client || !this.scope)
                return;
            const labels = this.client.locale.language.startsWith("fr") ? panelStrings.fr : panelStrings.en;
            void editZone(this.get("dialogSlot"), this.gallery.settings.region, labels, "/api/image_lab/zone/" + encodeURIComponent(this.profile), this.client.fetchWithAuth.bind(this.client), this.scope.signal, region => {
                if (this.gallery)
                    this.gallery.settings.region = region;
                this.feedback(this.labels.saved);
            });
        });
        this.onClick("save", () => this.saveSettings());
        this.onClick("captureAdd", () => this.task(async (signal) => {
            if (!this.result?.image_id || !this.captured)
                return;
            const state_id = this.get("captureState").value;
            if (!state_id)
                throw new Error("choose_state");
            captureDialog.removeAttribute("open");
            await this.update("add", {
                state_id,
                name: this.captureName(this.result.time),
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
        for (const field of ["max_distance", "min_margin"]) {
            const input = numberField(255);
            input.id = field;
            input.addEventListener("input", () => this.refreshSettings());
            this.get("thresholdFields").append(input);
        }
        this.localize();
        this.refresh();
    }
    get settingsOpen() {
        return this.tab === "settings";
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
    loadProgressBar() {
        if (customElements.get("ha-progress-bar") || this.get("progressLoader") || !this.client)
            return;
        // Home Assistant loads its progress bar along with the file selector.
        const loader = document.createElement("ha-selector");
        loader.id = "progressLoader";
        loader.hidden = true;
        Object.assign(loader, { hass: this.client, selector: { file: { accept } } });
        this.shadowRoot.append(loader);
        void customElements.whenDefined("ha-progress-bar").then(() => loader.remove());
    }
    localize() {
        this.history.localize(this.client);
        this.historySettings.localize(this.client?.locale.language);
        const names = {
            analysisSettingsTitle: "analysis",
            test: "test",
            captureAdd: "classify",
            addState: "add_state",
            reload: "reload",
            matchCaption: "closest", captureCaption: "currentCapture",
            openCaptureLabel: "open_capture",
            save: "save", editZone: "edit_zone",
        };
        for (const tab of tabs)
            names["tab-" + tab + "-label"] = tab;
        for (const key of ["max_distance", "min_margin"])
            this.get(key).setAttribute("label", this.labels[key]);
        for (const [id, label] of Object.entries(names)) {
            const icon = actionIcons[label];
            if (icon)
                actionLabel(this.get(id), this.labels[label], icon);
            else
                this.get(id).textContent = this.labels[label];
        }
        this.get("matchLink").setAttribute("label", this.labels.view_reference);
        this.get("matchLink").title = this.labels.view_reference;
        this.get("scoreDetails").setAttribute("header", this.labels.state_scores);
        this.get("captureDialog").setAttribute("header-title", this.labels.currentCapture);
        this.get("stateName").setAttribute("label", this.labels.new_state);
        const engine = this.get("engine");
        engine.label = this.labels.engine;
        engine.options = engines.map((value) => ({ value, label: engineNames[value] }));
        this.renderEngine();
        this.get("captureState").label = this.labels.state;
        this.get("captureDialogImage").alt = this.labels.currentCapture;
        this.get("nav").setAttribute("aria-label", "Image Lab");
    }
    reset() {
        this.scope?.abort();
        this.progress();
        this.closeCapture();
        this.get("dialogSlot").replaceChildren();
        this.get("scoreDetails").removeAttribute("expanded");
        this.scope = undefined;
        this.setGallery(undefined);
        this.result = undefined;
        this.captured = false;
        this.activity = undefined;
        this.refreshPreview = false;
        this.matchId = undefined;
        this.setFrame();
        this.setMatch();
        this.clearThumbnails();
        this.get("gallery").replaceChildren();
        this.history.clear();
        this.historySettings.setValue();
        this.get("stateName").value = "";
        this.feedback();
        this.renderResult();
    }
    refresh() {
        const hasFrame = !this.get("comparisonImages").hidden;
        const busy = Boolean(this.activity);
        this.get("referenceReview").hidden = !this.gallery?.reference_review;
        this.get("referenceReviewMessage").textContent = this.labels.references_need_review;
        const confirmReferences = this.get("confirmReferences");
        confirmReferences.textContent = this.labels.confirm_references;
        confirmReferences.toggleAttribute("disabled", busy);
        this.get("preview").setAttribute("aria-busy", String(busy));
        const test = this.get("test");
        test.toggleAttribute("disabled", !this.gallery || busy || !this.available);
        test.toggleAttribute("loading", this.activity === "analyzing");
        this.get("addState").toggleAttribute("disabled", !this.gallery || busy);
        this.get("references").setAttribute("aria-busy", String(busy));
        this.get("gallery").inert = busy;
        this.get("history").inert = busy || !this.gallery;
        this.get("settingsFields").inert = busy;
        this.get("reload").hidden = Boolean(this.gallery) || busy;
        this.get("editZone").toggleAttribute("disabled", !this.gallery || busy || !this.available);
        this.get("previewHint").textContent = this.activity === "analyzing" || this.activity === "loadingResult"
            ? this.labels[this.activity]
            : busy ? "" : !this.available ? this.labels.unavailable : hasFrame || this.result ? "" : this.labels.empty;
        this.get("classify").hidden =
            !this.captured || !hasFrame || !this.gallery?.states.length;
        this.get("captureAdd").toggleAttribute("disabled", busy || !this.get("captureState").value);
        this.get("openCapture").toggleAttribute("disabled", busy);
        const reference = this.gallery?.references.find(ref => ref.id === this.matchId);
        const state = this.gallery?.states.find(item => item.id === reference?.state_id);
        this.get("matchRow").hidden = !reference;
        this.get("matchMeta").hidden = !state;
        this.get("matchMeta").textContent = state?.name ?? "";
        this.refreshSettings();
    }
    show(tab) {
        this.refreshPreview = tab === "preview" && this.tab !== tab && Boolean(this.gallery);
        this.tab = tab;
        this.get("nav").setAttribute("active", tab);
        for (const key of tabs)
            this.get(key).hidden = tab !== key;
        if (tab !== "history")
            this.history.clear();
        if (tab === "references")
            this.renderGallery();
        else {
            this.clearThumbnails();
            if (tab === "history")
                void this.loadHistory();
        }
        this.refresh();
        this.loadLatestIfNeeded();
    }
    loadLatestIfNeeded() {
        if (!this.refreshPreview || this.activity)
            return;
        this.refreshPreview = false;
        void this.task(async (signal) => {
            const latest = await this.request("/latest", signal);
            if (latest && this.tab === "preview" && (latest.image_id !== this.result?.image_id || !this.frameUrl))
                await this.displayObservation(latest, signal);
        }, "loadingResult");
    }
    async load() {
        if (!this.profile || !this.client)
            return;
        this.loadProgressBar();
        this.scope?.abort();
        this.scope = new AbortController();
        await this.task(async (signal) => {
            const { gallery, latest, latest_error } = await this.request("?include_latest=1", signal);
            this.gallery = gallery;
            this.fillSettings();
            this.historySettings.setValue(gallery.history_settings);
            this.updateSelectors();
            this.publication?.setStates(gallery.states);
            if (this.tab === "references")
                this.renderGallery();
            if (this.tab === "history")
                this.renderHistory();
            if (latest_error)
                throw new Error(latest_error);
            if (latest)
                await this.displayObservation(latest, signal);
        }, "loadingResult");
    }
    feedback(message = "", error = false) {
        const notice = this.get("feedback");
        notice.hidden = !message;
        notice.textContent = message;
        notice.setAttribute("alert-type", error ? "error" : "info");
    }
    async task(run, activity = "working") {
        const signal = this.scope?.signal;
        if (this.activity || !signal || signal.aborted)
            return;
        this.activity = activity;
        if (activity === "working" || activity === "savingSettings")
            this.progress(this.labels.working);
        this.feedback();
        this.refresh();
        try {
            await run(signal);
        }
        catch (error) {
            if (!signal.aborted) {
                const key = error instanceof Error ? error.message : "";
                this.feedback(this.settingsError(key, this.labels.failed), true);
            }
        }
        finally {
            if (!signal.aborted) {
                this.activity = undefined;
                this.progress();
                this.refresh();
                this.loadLatestIfNeeded();
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
        this.setGallery(await this.request("/" + operation, signal, data));
        this.updateSelectors();
    }
    setGallery(gallery) {
        this.gallery = gallery;
        this.publication?.setStates(gallery?.states ?? []);
    }
    updateSelectors() {
        const captureState = this.get("captureState");
        this.stateOptions(captureState, captureState.value);
    }
    stateOptions(select, state) {
        select.options = (this.gallery?.states ?? []).map(({ id, name }) => ({
            value: id, label: name,
        }));
        select.value = select.options.some((option) => option.value === state) ? state : "";
    }
    async evaluate() {
        await this.task(async (signal) => {
            const result = await this.client.connection.sendMessagePromise({
                type: "image_lab/test_source", profile_id: this.profile,
            });
            signal.throwIfAborted();
            if (result.status === "error")
                throw new Error(result.reason ?? "failed");
            await this.displayObservation(result, signal);
            if (this.tab === "history") {
                this.setGallery(await this.request("", signal));
                this.renderHistory();
            }
            else if (this.tab === "references") {
                this.renderGallery();
            }
        }, "analyzing");
    }
    async displayObservation(result, signal) {
        this.setFrame();
        this.setMatch();
        this.captured = false;
        this.result = result;
        this.matchId = result.data.reference_id ?? undefined;
        this.stateOptions(this.get("captureState"), result.data.state_id ?? "");
        this.renderResult();
        if (result.image_id)
            await this.showImages(result.image_id, signal);
    }
    async showImages(captureId, signal) {
        const [capture, reference] = await Promise.all([
            this.fetchImage(captureId, signal),
            this.matchId ? this.fetchImage(this.matchId, signal, true).catch(() => undefined) : undefined,
        ]);
        signal.throwIfAborted();
        this.setFrame(URL.createObjectURL(capture));
        this.setMatch(reference && URL.createObjectURL(reference));
        const frame = this.get("frame");
        const [decodedFrame, decodedMatch] = await Promise.allSettled([
            frame.decode(),
            reference && this.get("matchFrame").decode(),
        ]);
        signal.throwIfAborted();
        if (decodedFrame.status === "rejected") {
            this.setFrame();
            this.setMatch();
            throw decodedFrame.reason;
        }
        if (decodedMatch.status === "rejected")
            this.setMatch();
        this.get("comparisonImages").style.setProperty("--ratio", String(frame.naturalWidth / frame.naturalHeight));
        this.get("comparisonImages").hidden = false;
        this.captured = true;
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
    fetchImage(id, signal, thumbnail = false) {
        const suffix = thumbnail ? "?thumbnail=1" : "";
        return this.images.get(this.client, this.url("/image/" + id + suffix), signal);
    }
    setFrame(url) {
        if (this.frameUrl)
            URL.revokeObjectURL(this.frameUrl);
        this.frameUrl = url;
        const frame = this.get("frame");
        if (url)
            frame.src = url;
        else {
            frame.removeAttribute("src");
            this.get("comparisonImages").hidden = true;
        }
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
    }
    renderResult() {
        const panel = this.get("result");
        const details = this.get("resultDetails");
        const scoresPanel = this.get("scores");
        const expansion = this.get("scoreDetails");
        panel.replaceChildren();
        details.replaceChildren();
        scoresPanel.replaceChildren();
        expansion.hidden = true;
        const result = this.result;
        panel.hidden = !result;
        if (!result)
            return;
        const title = document.createElement("span");
        title.id = "resultTitle";
        if (result.status === "ok") {
            title.textContent = this.labels.recognized;
            if (result.data.state) {
                const state = document.createElement("span");
                state.className = "recognizedState";
                state.innerHTML = `<ha-icon icon="mdi:check" aria-hidden="true"></ha-icon><span></span>`;
                state.lastElementChild.textContent = result.data.state;
                title.append(" ", state);
            }
        }
        else if (result.status === "unknown") {
            title.textContent = this.labels.unknown;
        }
        if (title.textContent)
            panel.append(title);
        if (result.reason) {
            const message = document.createElement("p");
            const key = result.reason;
            message.textContent = Object.hasOwn(this.labels, key)
                ? this.labels[key]
                : this.labels.failed;
            details.append(message);
        }
        if (result.time) {
            const date = document.createElement("p");
            date.className = "secondary";
            const stamp = document.createElement("time");
            stamp.dateTime = result.time;
            stamp.textContent = new Intl.DateTimeFormat(this.client?.locale.language, {
                timeZone: this.client?.config?.time_zone,
                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            }).format(new Date(result.time));
            date.append(stamp, ` · ${this.labels[result.manual ? "manualAnalysis" : "automaticAnalysis"]}`);
            panel.append(date);
        }
        if (result.confirmation === "disagreed") {
            const retained = document.createElement("p");
            retained.className = "secondary";
            retained.textContent = this.labels.notConfirmed;
            details.append(retained);
        }
        const scores = result.data.scores;
        const hasScores = scores && Object.keys(scores).length > 0;
        if (result.data.engine) {
            const engine = document.createElement("p");
            engine.className = "secondary";
            engine.textContent = engineNames[result.data.engine];
            (hasScores ? scoresPanel : details).append(engine);
        }
        if (hasScores) {
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
            scoresPanel.append(this.resultTable([this.labels.state, similarity ? this.labels.similarity : this.labels.score, this.labels.count], rows));
            expansion.hidden = false;
        }
    }
    openCapture() {
        if (!this.frameUrl || !this.result || this.activity)
            return;
        const dialog = this.get("captureDialog");
        if (this.result.time) {
            dialog.setAttribute("header-subtitle", this.observationLabel(this.result.time, this.result.manual));
        }
        else {
            dialog.removeAttribute("header-subtitle");
        }
        this.get("captureDialogBox").style.setProperty("--ratio", this.get("comparisonImages").style.getPropertyValue("--ratio"));
        this.get("captureDialogImage").src = this.frameUrl;
        paintRegion(this.get("captureDialogRegion"), this.result.data.region ?? null);
        dialog.setAttribute("open", "");
    }
    closeCapture() {
        this.get("captureDialog").removeAttribute("open");
        this.get("captureDialogImage").removeAttribute("src");
    }
    async openMatch() {
        const reference = this.gallery?.references.find(item => item.id === this.matchId);
        if (!reference)
            return;
        this.expandedStates.add(reference.state_id);
        this.show("references");
        const match = this.get("gallery").querySelector("[data-matched=true]");
        await match?.closest("ha-expansion-panel")?.updateComplete;
        if (!match?.isConnected)
            return;
        match.scrollIntoView({ block: "nearest" });
        match.focus({ preventScroll: true });
    }
    openReferences() {
        this.show("references");
        this.dispatchEvent(new Event("analysis-tab-changed"));
        this.get("stateName").focus({ preventScroll: true });
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
    }
    readSettings() {
        const max = this.get("max_distance");
        const margin = this.get("min_margin");
        const engine = this.get("engine").value === "tarsius" ? "tarsius" : "pillow";
        const valid = max.checkValidity() && !!max.value && margin.checkValidity() && !!margin.value;
        if (engine === "pillow" && !valid)
            throw new Error("invalid_settings");
        return {
            engine,
            max_distance: valid ? Number(max.value) : this.gallery.settings.max_distance,
            min_margin: valid ? Number(margin.value) : this.gallery.settings.min_margin,
        };
    }
    settingsDraft(saved) {
        const analysis = this.readSettings();
        const { engine, max_distance, min_margin } = saved.settings;
        const changed = analysis.engine !== engine || analysis.max_distance !== max_distance || analysis.min_margin !== min_margin;
        const historyChanged = this.historySettings.changed;
        const history = historyChanged ? this.historySettings.draft : undefined;
        if (historyChanged && !history)
            throw new Error("invalid_history_limit");
        const publication = this.profile ? this.publication?.draft(this.profile) : undefined;
        return { analysis: changed ? analysis : undefined, history, publication };
    }
    saveSettings() {
        const gallery = this.gallery;
        const profile = this.profile;
        if (!gallery || !profile)
            return;
        return this.task(async (signal) => {
            const { analysis, history, publication } = this.settingsDraft(gallery);
            if (analysis) {
                await this.update("settings", analysis, signal);
                this.fillSettings();
            }
            if (history) {
                await this.update("history_settings", history, signal);
                this.historySettings.setValue(this.gallery.history_settings);
            }
            if (publication)
                await this.publication?.save(profile, publication);
            if (!signal.aborted)
                this.feedback(this.labels.saved);
        }, "savingSettings");
    }
    refreshSettings() {
        const status = this.get("dirty");
        status.textContent = "";
        let changed = false;
        let valid = true;
        if (this.gallery) {
            try {
                const { analysis, history, publication } = this.settingsDraft(this.gallery);
                changed = Boolean(analysis || history || publication);
                if (changed)
                    status.textContent = this.labels.dirty;
            }
            catch (error) {
                changed = true;
                valid = false;
                const key = error instanceof Error ? error.message : "";
                status.textContent = this.settingsError(key, this.labels.invalid_settings);
            }
        }
        status.hidden = !status.textContent;
        const save = this.get("save");
        const saving = this.activity === "savingSettings";
        save.hidden = !changed && !saving;
        save.toggleAttribute("disabled", Boolean(this.activity) || !changed || !valid);
        save.toggleAttribute("loading", saving);
        const hint = this.get("testHint");
        hint.hidden = !status.textContent;
        hint.textContent = this.labels.testSavedSettings;
    }
    settingsError(key, fallback) {
        const publication = publicationStrings[this.labels === text.fr ? "fr" : "en"];
        if (Object.hasOwn(this.labels, key))
            return this.labels[key];
        const label = publication[key];
        return typeof label === "string" ? label : fallback;
    }
    renderRegion() {
        paintRegion(this.get("region"), this.frameUrl ? this.result?.data.region ?? null : null);
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
    stateAction(label, action) {
        const button = document.createElement("ha-icon-button");
        button.setAttribute("label", this.labels[label]);
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", `mdi:${actionIcons[label]}`);
        icon.setAttribute("aria-hidden", "true");
        button.append(icon);
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
            this.setGallery(await this.request("", signal));
            if (this.tab === "history")
                this.renderHistory();
        });
    }
    inspectReference(ref) {
        return this.task(async (signal) => {
            const blob = await this.fetchImage(ref.id, signal);
            signal.throwIfAborted();
            if (this.tab !== "references")
                return;
            const url = URL.createObjectURL(blob);
            const dialog = document.createElement("ha-dialog");
            dialog.className = "referencePreview";
            dialog.setAttribute("header-title", ref.name);
            const image = document.createElement("img");
            image.className = "original";
            image.alt = ref.name;
            image.src = url;
            const afterClose = (action) => {
                dialog.addEventListener("closed", () => {
                    if (!signal.aborted && this.tab === "references")
                        action();
                }, { once: true });
                dialog.removeAttribute("open");
            };
            const footer = document.createElement("ha-dialog-footer");
            footer.slot = "footer";
            const remove = this.button("remove", () => afterClose(() => this.confirmRemoval("confirm_remove", ref.name, () => this.galleryMutation("delete", { reference_id: ref.id }))));
            remove.slot = "secondaryAction";
            const move = this.button("move", () => afterClose(() => this.moveReference(ref)));
            move.slot = "primaryAction";
            move.toggleAttribute("disabled", !this.gallery || this.gallery.states.length < 2);
            footer.append(remove, move);
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
    moveReference(ref) {
        const options = (this.gallery?.states ?? [])
            .filter(state => state.id !== ref.state_id)
            .map(state => ({ value: state.id, label: state.name }));
        const dialog = document.createElement("ha-dialog");
        dialog.setAttribute("header-title", this.labels.move_reference);
        dialog.setAttribute("width", "small");
        const target = document.createElement("ha-select");
        target.className = "moveTarget";
        target.label = this.labels.new_state;
        target.options = options;
        target.value = options.length === 1 ? options[0].value : "";
        const footer = document.createElement("ha-dialog-footer");
        footer.slot = "footer";
        const cancel = this.button("cancel", () => dialog.removeAttribute("open"));
        cancel.slot = "secondaryAction";
        const move = this.button("move", () => {
            if (!target.value)
                return;
            dialog.removeAttribute("open");
            return this.galleryMutation("move", { reference_id: ref.id, state_id: target.value });
        });
        move.slot = "primaryAction";
        move.setAttribute("appearance", "filled");
        move.setAttribute("variant", "brand");
        move.toggleAttribute("disabled", !target.value);
        target.addEventListener("selected", event => {
            target.value = event.detail.value;
            move.toggleAttribute("disabled", !target.value);
        });
        footer.append(cancel, move);
        dialog.append(target, footer);
        dialog.addEventListener("closed", () => dialog.remove(), { once: true });
        this.get("dialogSlot").replaceChildren(dialog);
        dialog.setAttribute("open", "");
    }
    renderHistory() {
        if (!this.gallery || this.tab !== "history")
            return;
        this.history.localize(this.client);
        this.history.render(this.gallery.history, {
            image: (id, signal, thumbnail) => this.fetchImage(id, signal, thumbnail),
            summary: item => ({ text: item.state_id ? item.state : this.labels.unknown, uncertain: !item.state_id }),
            details: (item, content, _image, signal) => this.historyDetails(item, content, signal),
        });
    }
    historyDetails(item, content, signal) {
        const prediction = document.createElement("p");
        prediction.textContent = `${this.labels.prediction} · ${item.state_id ? item.state : this.labels.unknown}`;
        const origin = document.createElement("p");
        origin.className = "history-detail-meta";
        origin.textContent = engineNames[item.engine];
        content.append(prediction, origin);
        if (item.reason && Object.hasOwn(this.labels, item.reason)) {
            const reason = document.createElement("p");
            reason.className = "secondary";
            reason.textContent = this.labels[item.reason];
            content.append(reason);
        }
        if (!this.gallery?.states.length)
            return;
        const reference = this.gallery.references.find(ref => ref.id === item.id);
        const state = document.createElement("ha-select");
        state.label = this.labels.expected;
        this.stateOptions(state, reference?.state_id ?? item.state_id ?? "");
        const status = document.createElement("p");
        status.className = "secondary";
        status.setAttribute("role", "status");
        if (reference)
            status.textContent = this.labels.training + " · " +
                (this.gallery.states.find(entry => entry.id === reference.state_id)?.name ?? "");
        const action = this.button(reference ? "correct" : "classify", async () => {
            if (!state.value || action.hasAttribute("loading") || signal.aborted)
                return;
            action.setAttribute("loading", "");
            state.setAttribute("disabled", "");
            try {
                await this.update("correct", {
                    capture_id: item.id, state_id: state.value, name: this.captureName(item.time),
                }, signal);
                actionLabel(action, this.labels.correct, actionIcons.correct);
                status.textContent = this.labels.capture_saved;
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : "";
                status.textContent = Object.hasOwn(this.labels, reason)
                    ? this.labels[reason] : this.labels.failed;
            }
            finally {
                action.removeAttribute("loading");
                state.removeAttribute("disabled");
            }
        });
        action.setAttribute("appearance", reference ? "plain" : "outlined");
        action.toggleAttribute("disabled", !state.value);
        state.addEventListener("selected", event => {
            state.value = event.detail.value;
            action.toggleAttribute("disabled", !state.value);
        });
        const controls = document.createElement("div");
        controls.className = "history-correction";
        controls.append(state, action);
        content.append(controls, status);
    }
    captureName(time) {
        const stamp = new Intl.DateTimeFormat(this.client?.locale.language, {
            dateStyle: "short", timeStyle: "medium", timeZone: this.client?.config?.time_zone,
        }).format(time ? new Date(time) : Date.now());
        return `${this.labels.capture} ${stamp}`;
    }
    observationLabel(time, manual) {
        return new Date(time).toLocaleString(this.client?.locale.language, {
            timeZone: this.client?.config?.time_zone,
        }) + " · " + this.labels[manual ? "manualAnalysis" : "automaticAnalysis"];
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
        const captureTimes = new Map(this.gallery.history.map(item => [item.id, item.time]));
        const timestamp = new Intl.DateTimeFormat(this.client?.locale.language, {
            timeZone: this.client?.config?.time_zone,
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });
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
            controls.className = "stateEditor";
            const name = document.createElement("ha-input");
            name.value = state.name;
            name.setAttribute("maxlength", "120");
            name.setAttribute("required", "");
            name.setAttribute("label", this.labels.state);
            const rename = this.stateAction("rename", () => this.saveState(name, state.id));
            const remove = this.stateAction("remove", () => this.confirmRemoval("confirm_state", state.name, () => this.galleryMutation("delete_state", { state_id: state.id })));
            remove.className = "removeState";
            const actions = document.createElement("div");
            actions.className = "stateActions";
            actions.append(rename, remove);
            controls.append(name, actions);
            section.append(controls);
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept = accept;
            input.hidden = true;
            input.addEventListener("change", () => {
                const files = Array.from(input.files ?? []);
                input.value = "";
                if (files.length)
                    void this.importReferences(files, state.id);
            });
            const upload = this.button("upload", () => input.click());
            upload.setAttribute("appearance", "filled");
            const importer = document.createElement("div");
            importer.className = "referenceImport";
            importer.append(upload, input);
            const grid = document.createElement("div");
            grid.className = "referenceGrid";
            for (const ref of this.gallery.references.filter(item => item.state_id === state.id)) {
                const time = ref.source === "capture" ? captureTimes.get(ref.id) : undefined;
                grid.append(this.referenceTile(ref, time ? timestamp.format(new Date(time)) : undefined));
            }
            section.append(importer, grid);
            panel.append(section);
            node.append(panel);
        }
    }
    referenceTile(ref, captureDate) {
        const card = document.createElement("article");
        card.className = "reference";
        card.dataset.matched = String(this.matchId === ref.id);
        card.tabIndex = -1;
        const tile = document.createElement("span");
        tile.className = "referenceTile";
        const thumbnail = document.createElement("span");
        thumbnail.className = "referenceThumbnail";
        const fallback = document.createElement("ha-icon");
        fallback.setAttribute("icon", "mdi:image-outline");
        fallback.setAttribute("aria-hidden", "true");
        const image = document.createElement("img");
        image.alt = "";
        image.dataset.reference = ref.id;
        this.thumbnailObserver?.observe(image);
        thumbnail.append(fallback, image);
        const caption = document.createElement("span");
        caption.className = "referenceCaption";
        const title = document.createElement("span");
        title.className = "referenceName";
        title.textContent = captureDate ? this.labels.capture : ref.name;
        caption.append(title);
        const description = captureDate ?? (ref.source === "upload" ? this.labels.uploaded_image : undefined);
        if (description) {
            const detail = document.createElement("span");
            detail.className = "referenceDetail";
            detail.textContent = description;
            caption.append(detail);
        }
        tile.append(thumbnail, caption);
        const open = document.createElement("ha-button");
        open.className = "openImage";
        open.setAttribute("appearance", "plain");
        open.setAttribute("variant", "neutral");
        open.onclick = () => void this.inspectReference(ref);
        open.append(tile);
        card.append(open);
        return card;
    }
    async galleryMutation(operation, data) {
        await this.task(async (signal) => {
            await this.update(operation, data, signal);
            if (operation === "delete_state" && data.state_id)
                this.expandedStates.delete(data.state_id);
            if (operation === "move" && data.state_id)
                this.expandedStates.add(data.state_id);
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
            if (!image.isConnected || signal.aborted || this.tab !== "references")
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
if (!customElements.get("image-lab-comparison"))
    customElements.define("image-lab-comparison", ImageLabComparison);
