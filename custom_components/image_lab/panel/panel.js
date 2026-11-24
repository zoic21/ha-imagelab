import { meterStrings, panelStrings as strings } from "./translations.js";
import { ImageLabComparison } from "./comparison.js";
import { actionLabel } from "./action.js";
import { AnalysisList, analysisListStyles } from "./analysis-list.js";
import { CaptureHistory, HistorySettings, historyMarkup, historySettingsMarkup, historyStyles } from "./history.js";
import { ImageCache } from "./image-cache.js";
import { editMeter, meterStyles, meterText } from "./meter.js";
import { editModuleSettings, runProfileFlow } from "./options.js";
import { profileTab, profileTabsStyles } from "./profile-tabs.js";
import { PublicationSettings, publicationMarkup, publicationStyles } from "./publication.js";
import { SourceThumbnail } from "./source-thumbnail.js";
import { editZone } from "./zone.js";
const panelPath = "/image-lab";
const sourceIcons = { camera: "cctv", media_player: "music-note", upload: "image-outline" };
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display: block; position: relative; height: 100dvh; color: var(--primary-text-color); }
    [hidden] { display: none !important; }
    ha-top-app-bar-fixed { height: 100%; }
    .heading { display: inline-flex; align-items: center; gap: var(--ha-space-3, 12px); max-width: 100%; }
    #profile > .heading { display:flex; font-size:var(--ha-font-size-xl, 20px); }
    .heading img { flex: none; width: 26px; height: 26px; background: none; }
    h1 { display: inline-block; margin: 0; font: inherit; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
    #title:focus { outline: none; }
    #add {
      position: absolute; z-index: 3;
      inset-inline-end: calc(var(--ha-content-gutter, 16px) + var(--safe-area-inset-right, 0px));
      bottom: calc(var(--ha-content-gutter, 16px) + var(--safe-area-inset-bottom, 0px));
      --ha-button-box-shadow: var(--ha-box-shadow-l);
    }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    main {
      max-width: var(--ha-content-width-wide, 1280px);
      padding: var(--ha-content-gutter, 16px); margin: 0 auto;
    }
    main.with-detail { max-width: var(--ha-content-width-narrow, 720px); }
    :host([narrow]) main.with-detail {
      padding-block-end: calc(var(--ha-content-gutter, 16px) + var(--image-lab-tab-height) + 1px);
    }
    #analysisList { padding-bottom: var(--ha-space-16, 64px); }
    ha-card { min-width: 0; }
    .content { padding: 16px; }
    ul { list-style: none; margin: 0; padding: 0; }
    .analysisControls {
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      padding-block-end: var(--ha-space-3, 12px);
    }
    ${analysisListStyles}
    ${profileTabsStyles}
    #analysisSearch { flex: 1; min-width: 0; }
    #analysisSort { flex: none; }
    #profile > [role="tabpanel"] { padding-block-start: var(--ha-space-4, 16px); }
    ${historyStyles}
    ${meterStyles}
    #profileHistorySettings { margin-top: var(--ha-space-3, 12px); }
    #settingsPane:has(.settingsSave:not([hidden])) { padding-block-end:var(--ha-space-16, 64px); }
    #zone, #meterSettings { margin-top: 12px; }
    .secondary { color: var(--secondary-text-color); }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; }
    .settingsSection {
      border-top: 1px solid var(--divider-color);
      padding-block: var(--ha-space-3, 12px);
    }
    .settingsTitle { font-size: 1rem; margin: 0 0 8px; }
    .resultHeader, .settingsInfo {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
      gap: var(--ha-space-2, 8px);
    }
    .resultHeader p, .settingsInfo p { margin: 0; }
    .sourceRow {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
      gap: var(--ha-space-3, 12px); overflow-wrap: anywhere;
    }
    .sourcePreview {
      display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center;
      width: 84px; height: 56px; overflow: hidden;
      border-radius: var(--ha-border-radius-md, 8px); background: var(--secondary-background-color);
    }
    #sourceImage { width: 100%; height: 100%; object-fit: cover; }
    #sourceImage:not([hidden]) + ha-icon { display: none; }
    #sourceKind { display: block; font-weight: var(--ha-font-weight-medium, 500); }
    #sourceSummary { font-size: var(--ha-font-size-s, 12px); }
    #editSource { color: var(--primary-color); }
    ${publicationStyles}
    #profileId { font-size: var(--ha-font-size-s, 12px); }
    #analysisId { padding-block-end: 0; }
    #profileId { display: block; color: var(--secondary-text-color); }
    #copyStatus { margin-top: 0; }

    figure { margin: 16px 0 0; }
    .image-stage { position: relative; --preview-height: min(55dvh, 520px); }
    .image-stage.with-objects {
      width: min(100%, calc(var(--preview-height) * var(--image-aspect)));
      margin-inline: auto; overflow: hidden; container-type: inline-size;
      border-radius: var(--ha-border-radius-md, 8px);
    }
    img {
      display: block; width: 100%; max-height: var(--preview-height); object-fit: contain;
      background: var(--secondary-background-color); border-radius: var(--ha-border-radius-md, 8px);
    }
    .objects-overlay { position: absolute; inset: 0; pointer-events: none; }
    .object-box {
      position: absolute; box-sizing: border-box; border: 2px solid white;
      box-shadow: 0 0 0 1px #131a22, inset 0 0 0 1px #131a22;
    }
    .object-box span {
      position: absolute; top: 0; left: 0; padding: 1px 5px; width: max-content;
      max-width: 100cqw; box-sizing: border-box; overflow-wrap: anywhere;
      transform: translateX(min(0px, calc(100cqw - var(--label-left) - 2px - 100%)));
      font-size: 11px; line-height: 1.5; color: white; background: #131a22;
    }
    .object-list {
      display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px;
    }
    .object-list li { margin: 0; }
    figcaption, ha-alert { margin-top: 8px; }
    #palette { margin-top: 16px; }
    #paletteTitle { font-size: 16px; font-weight: 500; margin: 0 0 8px; }
    .swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(85px, 1fr)); gap: 8px; }
    .swatches li { min-width: 0; margin: 0; }
    .history-detail .swatches { margin-top: 12px; }
    .swatch {
      height: 32px; margin-bottom: 4px; border: 1px solid var(--divider-color);
      border-radius: var(--ha-border-radius-md, 8px);
    }
    .selection { position:absolute; pointer-events:none; border:2px solid var(--primary-color); box-sizing:border-box;
      box-shadow:0 0 0 1px #111, inset 0 0 0 1px #111; background:color-mix(in srgb, var(--primary-color) 18%, transparent); }
  </style>

  <ha-top-app-bar-fixed id="appBar">
  <ha-icon-button-arrow-prev id="back" hidden></ha-icon-button-arrow-prev>
  <div id="heading" class="heading" slot="title"><img id="icon" src="/image_lab_icon.png" alt=""><h1 id="title" tabindex="-1">Image Lab</h1></div>
  <ha-tab-group id="profileNav" class="profileTabs" active="result" hidden>
    ${profileTab("resultTab", "result", "resultPane", "image-outline")}
    ${profileTab("referencesTab", "references", "comparisonSlot", "image-multiple-outline")}
    ${profileTab("historyTab", "history", "historyPane", "history")}
    ${profileTab("settingsTab", "settings", "settingsPane", "cog-outline")}
  </ha-tab-group>
  <ha-dropdown id="profileMenu" slot="actionItems" placement="bottom-end" hidden>
    <ha-icon-button id="profileMenuButton" slot="trigger" aria-haspopup="menu">
      <ha-icon icon="mdi:dots-vertical" aria-hidden="true"></ha-icon>
    </ha-icon-button>
    <ha-dropdown-item value="rename">
      <ha-icon slot="icon" icon="mdi:pencil-outline"></ha-icon>
      <span id="renameAction"></span>
    </ha-dropdown-item>
  </ha-dropdown>
  <main>
    <section id="analysisList">
      <p id="listMessage" class="secondary" role="status" hidden></p>
      <ha-button id="retry" appearance="plain" variant="neutral" hidden></ha-button>
      <div id="analysisControls" class="analysisControls" hidden>
        <ha-input-search id="analysisSearch" appearance="outlined" enterkeyhint="search"></ha-input-search>
        <ha-dropdown id="analysisSort" placement="bottom-end">
          <ha-icon-button id="analysisSortButton" slot="trigger" aria-haspopup="menu">
            <ha-icon icon="mdi:sort" aria-hidden="true"></ha-icon>
          </ha-icon-button>
        </ha-dropdown>
      </div>
      <div id="analysisGroups" hidden></div>
    </section>
    <ha-card id="detailCard" hidden>
      <section class="content">
        <div id="profile">
          <section id="resultPane" role="tabpanel" aria-labelledby="resultTab">
            <div class="resultHeader">
              <p id="status" class="secondary" role="status"></p>
              <ha-button id="test" variant="brand"></ha-button>
            </div>
            <ha-alert id="error" alert-type="error" role="alert" hidden></ha-alert>
            <section id="palette" aria-labelledby="paletteTitle" hidden>
              <h3 id="paletteTitle"></h3>
              <ul id="swatches" class="swatches"></ul>
          </section>
          <figure id="preview" hidden>
            <div id="imageStage" class="image-stage">
              <img id="image" />
              <div id="objectsOverlay" class="objects-overlay" aria-hidden="true"></div>
            </div>
            <figcaption id="dimensions" class="secondary"></figcaption>
          </figure>
          <ul id="objectList" class="object-list" hidden></ul>
          </section>
          <section id="historyPane" role="tabpanel" aria-labelledby="historyTab" hidden>
            ${historyMarkup}
          </section>
          <div id="comparisonSlot"></div>
          <section id="settingsPane" role="tabpanel" aria-labelledby="settingsTab" hidden>
            <div class="settingsSavePosition">
              <ha-button id="settingsSave" class="settingsSave" variant="brand" size="l" hidden></ha-button>
            </div>
            <p id="settingsStatus" class="secondary" role="status" hidden></p>
            <section aria-labelledby="analysisSettingsTitle">
              <h3 id="analysisSettingsTitle" class="settingsTitle"></h3>
              <div id="moduleSettings"></div>
              <ha-button id="zone" appearance="plain" hidden></ha-button>
              <ha-button id="meterSettings" appearance="plain" hidden></ha-button>
              <p class="secondary" id="meterSettingsStatus" role="status" hidden></p>
            </section>
            <section id="profileHistorySettings" class="settingsSection">${historySettingsMarkup}</section>
            <div id="profileSettings" slot="profile-settings">
              <section class="settingsSection" aria-labelledby="sourceSettingsTitle">
                <h3 id="sourceSettingsTitle" class="settingsTitle"></h3>
                <div class="sourceRow">
                  <span class="sourcePreview" aria-hidden="true">
                    <img id="sourceImage" alt="" referrerpolicy="no-referrer" hidden>
                    <ha-icon id="sourceIcon" class="secondary" aria-hidden="true"></ha-icon>
                  </span>
                  <span><span id="sourceKind"></span><span id="sourceSummary" class="secondary"></span></span>
                  <ha-icon-button id="editSource">
                    <ha-icon icon="mdi:pencil-outline" aria-hidden="true"></ha-icon>
                  </ha-icon-button>
                </div>
                <p id="scheduleHint" class="secondary" hidden></p>
              </section>
              ${publicationMarkup}
              <div id="analysisId" class="settingsSection">
                <div class="settingsInfo">
                  <span><span id="idLabel"></span><code id="profileId"></code></span>
                  <ha-icon-button id="copy">
                    <ha-icon icon="mdi:content-copy" aria-hidden="true"></ha-icon>
                  </ha-icon-button>
                </div>
                <p id="copyStatus" role="status" hidden></p>
              </div>
            </div>
          </section>
        </div>
      </section>
    </ha-card>
  </main>
  </ha-top-app-bar-fixed>
  <ha-button id="add" size="l" variant="brand"></ha-button>
  <div id="dialogs"></div>
`;
class ImageLabPanel extends HTMLElement {
    _hass;
    profiles;
    selectedId;
    listScrollTop = 0;
    subscription;
    captureSubscription;
    failed = false;
    activeTest;
    historyScope;
    captureHistory;
    historySettings;
    previewUrl;
    previewETag;
    optionsScope;
    moduleSettingsScope;
    moduleSettings;
    savingSettings = false;
    zoneScope;
    strings = strings.en;
    images = new ImageCache();
    sourceThumbnail;
    comparison;
    publication;
    analysisList;
    sort;
    constructor() {
        super();
        this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
        this.sourceThumbnail = new SourceThumbnail(this.element("sourceImage"), this.images);
        this.analysisList = new AnalysisList(this.element("analysisGroups"), this.images, id => this.select(id));
        this.captureHistory = new CaptureHistory(this.element("historyPane"), () => void this.loadHistory());
        const historyFields = this.element("profileHistorySettings");
        this.historySettings = new HistorySettings(historyFields, false);
        historyFields.addEventListener("selected", () => this.refreshSettingsSave());
        historyFields.addEventListener("input", () => this.refreshSettingsSave());
        this.element("settingsSave").addEventListener("click", () => void this.saveSettings());
        this.comparison = new ImageLabComparison(this.images, {
            draft: profile => this.publication.draft(profile),
            save: (profile, changes) => this.savePublication(profile, changes),
            setStates: states => this.publication.setStates(states),
        });
        this.publication = new PublicationSettings(this.element("publication"), () => {
            if (this.selected?.module === "comparison")
                this.comparison.refreshSettings();
            else
                this.refreshSettingsSave();
        }, () => this.comparison.openReferences());
        this.element("comparisonSlot").append(this.comparison);
        this.comparison.addEventListener("analysis-tab-changed", (event) => {
            if (this.selected?.module !== "comparison")
                return;
            this.element("profileNav").setAttribute("active", event.detail);
            this.resetMobileTabScroll();
            this.updateSourceThumbnail();
        });
        this.element("add").addEventListener("click", () => this.openFlow("create"));
        this.element("profileMenu").addEventListener("wa-select", () => this.openFlow("rename"));
        this.element("editSource").addEventListener("click", () => this.openFlow("configure"));
        this.element("retry").addEventListener("click", () => this.subscribe());
        this.element("back").addEventListener("click", () => {
            if (history.state?.from === panelPath)
                history.back();
            else
                this.navigate(panelPath, true);
        });
        this.element("analysisSearch").addEventListener("input", () => this.renderAnalysisRows());
        this.element("analysisSort").addEventListener("wa-select", event => {
            const { item: { value } } = event.detail;
            const [column, direction] = value.split(":");
            this.sort = direction === "asc" || direction === "desc" ? { column: column, direction } : undefined;
            this.updateAnalysisSort();
            this.renderAnalysisRows();
        });
        this.renderAnalysisControls();
        this.element("profileNav").addEventListener("wa-tab-show", event => {
            const tab = event.detail.name;
            if (this.selected?.module === "comparison") {
                this.comparison.selectTab(tab === "result" ? "preview" : tab);
            }
            else if (tab !== "references") {
                this.showTab(tab);
            }
        });
        this.element("outputEntity").addEventListener("click", () => {
            const entityId = this.selected?.output_entity_id;
            if (entityId)
                this.dispatchEvent(new CustomEvent("hass-more-info", {
                    detail: { entityId }, bubbles: true, composed: true,
                }));
        });
        this.element("test").addEventListener("click", () => void this.loadPreview(true));
        this.element("zone").addEventListener("click", () => {
            const profile = this.selected;
            if (!profile || !this._hass)
                return;
            this.zoneScope?.abort();
            this.zoneScope = new AbortController();
            void editZone(this.element("profile"), profile.region, this.strings, "/api/image_lab/zone/" + encodeURIComponent(profile.profile_id), this._hass.fetchWithAuth.bind(this._hass), this.zoneScope.signal);
        });
        this.element("meterSettings").addEventListener("click", () => {
            const profile = this.selected;
            const hass = this._hass;
            if (profile?.module !== "meter" || !hass)
                return;
            this.zoneScope?.abort();
            this.zoneScope = new AbortController();
            this.element("meterSettingsStatus").hidden = true;
            void editMeter(this.element("profile"), hass.locale.language, "/api/image_lab/meter/" + encodeURIComponent(profile.profile_id), hass.fetchWithAuth.bind(hass), this.zoneScope.signal, () => {
                const status = this.element("meterSettingsStatus");
                status.textContent = this.meterLabels.saved;
                status.hidden = false;
            });
        });
        this.element("copy").addEventListener("click", () => void this.copyId());
        this.render();
    }
    set hass(hass) {
        const previous = this._hass;
        const connectionChanged = previous?.connection !== hass.connection;
        if (connectionChanged) {
            this.analysisList.clear();
            void this.sourceThumbnail.show();
            this.images.clear();
        }
        const language = hass.locale.language.startsWith("fr") ? strings.fr : strings.en;
        const languageChanged = this.strings !== language;
        this._hass = hass;
        const profile = this.selected;
        if (profile?.entity_id && previous?.states[profile.entity_id] !== hass.states[profile.entity_id]) {
            this.renderSource(profile);
            this.updateSourceThumbnail();
        }
        const output = this.selected?.output_entity_id;
        if (output && previous?.states[output]?.attributes.friendly_name !== hass.states[output]?.attributes.friendly_name)
            this.publication.setEntity(output, hass.states[output]?.attributes.friendly_name);
        if (languageChanged) {
            this.strings = language;
            this.closeModuleSettings();
            this.renderAnalysisControls();
            this.render();
        }
        if (languageChanged || Boolean(previous?.entities) !== Boolean(hass.entities) ||
            this.profiles?.some(({ entity_id: id }) => {
                if (!id)
                    return false;
                const before = previous?.states[id];
                const now = hass.states[id];
                return Boolean(before) !== Boolean(now) ||
                    before?.attributes.friendly_name !== now?.attributes.friendly_name ||
                    Boolean(previous?.entities?.[id]) !== Boolean(hass.entities?.[id]);
            }))
            this.renderAnalysisRows();
        if (connectionChanged) {
            this.unsubscribe();
            this.subscribe();
        }
    }
    set narrow(value) {
        if (this.hasAttribute("narrow") === value)
            return;
        this.toggleAttribute("narrow", value);
        this.element("appBar").toggleAttribute("narrow", value);
        this.comparison.toggleAttribute("narrow", value);
        this.render();
    }
    set route({ path }) {
        const id = /^\/([a-z0-9]+)\/?$/i.exec(path)?.[1];
        if (id === this.selectedId)
            return;
        const previous = this.selectedId;
        const scroller = this.scrollTarget;
        if (!previous && scroller)
            this.listScrollTop = scroller.scrollTop;
        this.optionsScope?.abort();
        this.closeModuleSettings();
        this.clearTest();
        this.selectedId = id;
        this.showTab("result", false);
        this.render(Boolean(id));
        if (!id && scroller) {
            scroller.scrollTop = this.listScrollTop;
            void this.focusListAction(previous);
        }
    }
    connectedCallback() {
        this.subscribe();
        if (this.selected && !this.element("resultPane").hidden && !this.previewUrl)
            void this.loadPreview();
    }
    disconnectedCallback() {
        this.analysisList.clear();
        void this.sourceThumbnail.show();
        this.images.clear();
        this.optionsScope?.abort();
        this.closeModuleSettings();
        this.unsubscribe();
        this.clearTest();
    }
    element(id) {
        return this.shadowRoot.getElementById(id);
    }
    get scrollTarget() {
        const { scrollTarget } = this.element("appBar");
        return scrollTarget instanceof HTMLElement ? scrollTarget : undefined;
    }
    get selected() {
        return this.profiles?.find((profile) => profile.profile_id === this.selectedId);
    }
    openFlow(mode) {
        const entry = mode === "create" ? undefined : this.selected?.profile_id;
        if (!this._hass || (mode !== "create" && !entry))
            return;
        this.optionsScope?.abort();
        this.optionsScope = new AbortController();
        void runProfileFlow(this.element("dialogs"), this._hass, mode, entry, this.strings, this.optionsScope.signal, id => this.select(id));
    }
    get meterLabels() {
        return this.strings === strings.fr ? meterStrings.fr : meterStrings.en;
    }
    closeModuleSettings() {
        this.moduleSettingsScope?.abort();
        this.moduleSettingsScope = undefined;
        this.moduleSettings = undefined;
        this.savingSettings = false;
        this.element("settingsPane").inert = false;
        this.element("settingsStatus").hidden = true;
        this.element("settingsSave").hidden = true;
    }
    showModuleSettings() {
        const profile = this.selected;
        const hass = this._hass;
        if (this.moduleSettingsScope || !profile || profile.module === "comparison" || !hass)
            return;
        this.moduleSettingsScope = new AbortController();
        const moduleSettings = this.element("moduleSettings");
        moduleSettings.hidden = profile.module === "meter";
        if (profile.module !== "meter")
            this.moduleSettings = editModuleSettings(moduleSettings, hass, profile.profile_id, this.strings, this.moduleSettingsScope.signal, () => this.refreshSettingsSave());
        void this.loadHistorySettings(profile, hass, this.moduleSettingsScope.signal);
    }
    subscribe() {
        if (!this.isConnected || !this._hass || this.subscription)
            return;
        this.failed = false;
        if (!this.captureSubscription) {
            const captures = this._hass.connection.subscribeMessage((update) => {
                if (captures === this.captureSubscription)
                    this.analysisList.refresh(update);
            }, { type: "image_lab/subscribe_captures" });
            this.captureSubscription = captures;
            void captures.catch(() => {
                if (captures === this.captureSubscription)
                    this.captureSubscription = undefined;
            });
        }
        const subscription = this._hass.connection.subscribeMessage((profiles) => {
            if (subscription !== this.subscription)
                return;
            const initial = !this.profiles;
            const previous = this.selected;
            this.profiles = profiles;
            const current = this.selected;
            this.renderAnalysisRows();
            if (this.selectedId && !current && (initial || previous)) {
                this.navigate(panelPath, true);
                return;
            }
            this.render();
        }, { type: "image_lab/subscribe_profiles" });
        this.subscription = subscription;
        void subscription.catch(() => {
            if (subscription !== this.subscription)
                return;
            this.subscription = undefined;
            this.failed = true;
            this.render();
        });
        this.render();
    }
    unsubscribe() {
        const captures = this.captureSubscription;
        this.captureSubscription = undefined;
        void captures?.then(unsubscribe => unsubscribe()).catch(() => { });
        if (!this.subscription)
            return;
        void this.subscription.then((unsubscribe) => unsubscribe()).catch(() => { });
        this.subscription = undefined;
    }
    select(id) {
        if (id !== this.selectedId)
            this.navigate(`${panelPath}/${id}`);
    }
    navigate(path, replace = false) {
        this.closest("ha-panel-custom")?.navigate(path, { replace });
    }
    async focusListAction(id) {
        const action = (this.shadowRoot.getElementById(`analysis-${id}`) ?? this.element("add"));
        await action.updateComplete;
        if (!this.selectedId && action.isConnected)
            action.focus({ preventScroll: true });
    }
    resetMobileTabScroll() {
        const scroller = this.scrollTarget;
        if (this.hasAttribute("narrow") && scroller)
            scroller.scrollTop = 0;
    }
    showTab(tab, refresh = true) {
        const previous = this.element("profileNav").getAttribute("active");
        const returning = previous !== "result" || this.element("resultPane").hidden;
        if (refresh && previous !== tab)
            this.resetMobileTabScroll();
        this.element("profileNav").setAttribute("active", tab);
        this.element("resultPane").hidden = tab !== "result";
        this.element("historyPane").hidden = tab !== "history";
        this.element("settingsPane").hidden = tab !== "settings";
        this.updateSourceThumbnail();
        if (tab === "result" && refresh && returning && this.selected?.module !== "comparison")
            void this.loadPreview();
        if (tab === "settings")
            this.showModuleSettings();
        if (tab === "history")
            void this.loadHistory();
        else {
            this.historyScope?.abort();
            this.captureHistory.clear();
        }
    }
    clearTest() {
        this.zoneScope?.abort();
        this.activeTest?.abort();
        this.activeTest = undefined;
        this.historyScope?.abort();
        this.captureHistory.clear();
        this.historySettings.setValue();
        this.element("test").removeAttribute("loading");
        this.element("status").textContent = "";
        this.element("meterSettingsStatus").hidden = true;
        this.element("error").hidden = true;
        this.element("palette").hidden = true;
        this.element("swatches").replaceChildren();
        this.element("preview").hidden = true;
        this.element("image").removeAttribute("src");
        this.element("imageStage").classList.remove("with-objects");
        this.element("objectsOverlay").replaceChildren();
        this.element("objectList").replaceChildren();
        this.element("objectList").hidden = true;
        if (this.previewUrl)
            URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = undefined;
        this.previewETag = undefined;
        this.element("copyStatus").hidden = true;
    }
    analysisTrigger(profile, manual = this.strings.manualTrigger) {
        const labels = this.strings;
        if (profile.source_type === "media_player" && profile.output_entity_id)
            return labels.artworkTrigger;
        if (profile.source_type === "camera" && profile.interval_minutes)
            return labels.everyMinutes.replace("{minutes}", String(profile.interval_minutes));
        return manual;
    }
    renderAnalysisRows() {
        const labels = this.strings;
        const hass = this._hass;
        if (!hass || !this.profiles?.length) {
            this.analysisList.clear();
            return;
        }
        const search = this.element("analysisSearch");
        const normalize = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const terms = normalize((search.value ?? "").trim()).split(/\s+/).filter(Boolean);
        const rows = this.profiles.map(profile => {
            const id = profile.entity_id;
            const state = id ? hass.states[id] : undefined;
            const source = state?.attributes.friendly_name || id || labels[profile.source_type];
            const sourceMissing = profile.source_type !== "upload" &&
                (!id || Boolean(hass.entities && !hass.entities[id] && !state));
            const warning = sourceMissing ? labels.missingSource : !profile.available ? labels.profile_unavailable :
                profile.module === "meter" && !profile.meter_initialized ? this.meterLabels.reasons.meter_unconfirmed : "";
            const trigger = this.analysisTrigger(profile);
            return {
                id: profile.profile_id, name: profile.title, module: profile.module, type: labels[profile.module], source, warning,
                trigger, schedule: profile.source_type === "camera" && profile.interval_minutes
                    ? `${profile.interval_minutes} min` : trigger === labels.manualTrigger ? "" : trigger,
            };
        }).filter(row => {
            const searchable = normalize([row.name, row.type, row.source, row.trigger, row.warning].join(" "));
            return terms.every(term => searchable.includes(term));
        });
        if (this.sort) {
            const { column, direction } = this.sort;
            const collator = new Intl.Collator(hass.locale.language, { sensitivity: "base", numeric: true });
            rows.sort((a, b) => (direction === "asc" ? 1 : -1) * collator.compare(a[column], b[column]));
        }
        else {
            rows.sort((a, b) => Number(Boolean(b.warning)) - Number(Boolean(a.warning)));
        }
        this.analysisList.render(rows, hass, labels.noMatchingAnalyses);
    }
    renderAnalysisControls() {
        const labels = this.strings;
        this.element("analysisList").setAttribute("aria-label", labels.analyses);
        this.element("analysisSearch").setAttribute("label", labels.searchAnalyses);
        this.element("analysisSortButton").setAttribute("label", labels.sortBy);
        const sort = this.element("analysisSort");
        const options = [
            { value: "warnings", label: labels.warningsFirst },
            ...Object.entries({
                name: labels.nameColumn, type: labels.typeColumn, source: labels.sourceColumn, trigger: labels.triggerColumn,
            }).flatMap(([key, label]) => [
                { value: `${key}:asc`, label: `${label} (A–Z)` },
                { value: `${key}:desc`, label: `${label} (Z–A)` },
            ]),
        ];
        sort.querySelectorAll("ha-dropdown-item").forEach(item => item.remove());
        for (const option of options) {
            const item = document.createElement("ha-dropdown-item");
            item.setAttribute("type", "checkbox");
            item.setAttribute("value", option.value);
            item.textContent = option.label;
            sort.append(item);
        }
        this.updateAnalysisSort();
    }
    updateAnalysisSort() {
        const active = this.sort ? `${this.sort.column}:${this.sort.direction}` : "warnings";
        for (const item of this.element("analysisSort").querySelectorAll("ha-dropdown-item"))
            item.checked = item.getAttribute("value") === active;
    }
    render(moveFocus = false) {
        const labels = this.strings;
        for (const [id, message] of Object.entries({
            idLabel: labels.id, paletteTitle: labels.palette, "resultTab-label": labels.resultTab,
            "referencesTab-label": labels.referencesTab, "historyTab-label": labels.historyTab, "settingsTab-label": labels.settingsTab,
            analysisSettingsTitle: labels.analysisSettings, sourceSettingsTitle: labels.sourceSettings,
            renameAction: labels.rename,
        })) {
            this.element(id).textContent = message;
        }
        const actions = {
            add: [labels.add, "plus"],
            retry: [labels.retry, "refresh"],
            test: [labels.test, "play-outline"],
            settingsSave: [labels.save, "content-save-outline"],
            zone: [labels.zone, "crop"],
            meterSettings: [this.meterLabels.configure, "gauge"],
        };
        for (const [id, [label, icon]] of Object.entries(actions))
            actionLabel(this.element(id), label, icon);
        this.element("editSource").setAttribute("label", labels.editSource);
        this.element("copy").setAttribute("label", labels.copy);
        this.element("profileMenuButton").setAttribute("label", labels.profileMenu);
        const profile = this.selected;
        const detail = this.element("detailCard");
        const opened = detail.hidden || moveFocus;
        detail.hidden = !profile;
        this.element("analysisList").hidden = Boolean(profile);
        this.shadowRoot.querySelector("main").classList.toggle("with-detail", Boolean(profile));
        this.element("add").hidden = Boolean(profile);
        this.element("icon").hidden = Boolean(profile);
        this.element("profileMenu").hidden = !profile;
        const back = this.element("back");
        back.hidden = !profile;
        back.slot = profile ? "navigationIcon" : "";
        back.setAttribute("label", labels.back);
        const title = this.element("title");
        title.textContent = profile?.title ?? "Image Lab";
        title.title = title.textContent;
        const hasProfiles = Boolean(this.profiles?.length);
        this.element("analysisGroups").hidden = !hasProfiles;
        this.element("analysisControls").hidden = !hasProfiles;
        this.element("retry").hidden = !this.failed;
        const message = this.element("listMessage");
        message.textContent = this.failed ? labels.loadError :
            !this.profiles ? labels.loading : this.profiles.length === 0 ? labels.empty : "";
        message.hidden = !message.textContent;
        const isComparison = profile?.module === "comparison";
        const outputEntityId = profile?.output_entity_id ?? undefined;
        const outputName = outputEntityId && this._hass?.states[outputEntityId]?.attributes.friendly_name;
        this.publication.configure(profile, labels === strings.fr ? "fr" : "en", outputEntityId, outputName);
        this.comparison.hidden = !isComparison;
        this.comparison.configure(this._hass, isComparison ? profile.profile_id : undefined, isComparison ? `${profile.source_type}/${profile.entity_id ?? ""}/${profile.image_revision ?? ""}` : undefined, profile?.available);
        const settings = this.element("profileSettings");
        const target = isComparison ? this.comparison : this.element("settingsPane");
        if (settings.parentElement !== target)
            target.append(settings);
        const nav = this.element("profileNav");
        const wideDetail = Boolean(profile) && !this.hasAttribute("narrow");
        nav.slot = wideDetail ? "title" : "";
        nav.hidden = !profile;
        nav.setAttribute("aria-label", profile?.title ?? "Image Lab");
        for (const [id, pane] of [["resultTab", "resultPane"], ["historyTab", "historyPane"], ["settingsTab", "settingsPane"]])
            this.element(id).setAttribute("aria-controls", isComparison ? "comparisonSlot" : pane);
        const referencesTab = this.element("referencesTab");
        referencesTab.hidden = !isComparison;
        referencesTab.toggleAttribute("disabled", !isComparison);
        const heading = this.element("heading");
        const headingParent = this.element(wideDetail ? "profile" : "appBar");
        if (heading.parentElement !== headingParent)
            headingParent.prepend(heading);
        const tab = this.element("profileNav").getAttribute("active");
        this.element("resultPane").hidden = isComparison || tab !== "result";
        this.element("historyPane").hidden = isComparison || tab !== "history";
        this.element("settingsPane").hidden = isComparison || tab !== "settings";
        this.updateSourceThumbnail();
        if (!isComparison && tab === "settings")
            this.showModuleSettings();
        if (!profile)
            return;
        const camera = profile.source_type === "camera";
        const schedule = this.element("scheduleHint");
        schedule.hidden = profile.source_type !== "media_player" || Boolean(profile.output_entity_id);
        schedule.textContent = labels.frequencyMediaInactive;
        this.renderSource(profile);
        this.element("zone").hidden = !camera || isComparison || profile.module === "meter";
        this.element("meterSettings").hidden = profile.module !== "meter";
        this.element("meterSettings").toggleAttribute("disabled", !profile.available);
        this.element("profileId").textContent = profile.profile_id;
        this.element("test").toggleAttribute("disabled", !profile.available || Boolean(this.activeTest));
        if (opened) {
            const scroller = this.scrollTarget;
            if (scroller)
                scroller.scrollTop = 0;
            title.focus({ preventScroll: true });
            if (!isComparison)
                void this.loadPreview();
        }
    }
    renderSource(profile) {
        const labels = this.strings;
        const kind = profile.source_type;
        const entity = profile.entity_id;
        const name = entity ? this._hass?.states[entity]?.attributes.friendly_name || entity : labels.missingSource;
        this.element("sourceIcon").setAttribute("icon", `mdi:${sourceIcons[kind]}`);
        this.element("sourceKind").textContent = kind === "camera" ? labels.cameraLabel : labels[kind];
        this.element("sourceSummary").textContent = [
            kind === "upload" ? undefined : name, this.analysisTrigger(profile, labels.onDemand),
        ].filter(Boolean).join(" · ");
    }
    updateSourceThumbnail() {
        const profile = this.selected;
        const settingsOpen = profile?.module === "comparison" ? this.comparison.settingsOpen :
            this.element("profileNav").getAttribute("active") === "settings";
        if (!profile || !this._hass || !settingsOpen || !this.isConnected) {
            void this.sourceThumbnail.show();
        }
        else if (profile.source_type === "upload") {
            const path = `/api/image_lab/upload_thumbnail/${encodeURIComponent(profile.profile_id)}`;
            void this.sourceThumbnail.show(`${path}?revision=${encodeURIComponent(profile.image_revision ?? "")}`, this._hass);
        }
        else {
            let picture = profile.entity_id ? this._hass.states[profile.entity_id]?.attributes.entity_picture : undefined;
            if (profile.source_type === "camera" && picture?.startsWith("/api/camera_proxy/")) {
                const url = new URL(picture, location.origin);
                url.searchParams.set("width", "240");
                url.searchParams.set("height", "144");
                picture = url.href;
            }
            void this.sourceThumbnail.show(picture);
        }
    }
    refreshSettingsSave() {
        const profile = this.selected;
        const button = this.element("settingsSave");
        if (!profile || profile.module === "comparison") {
            button.hidden = true;
            return;
        }
        let changed = Boolean(this.moduleSettings?.changed || this.historySettings.changed);
        let invalid = this.historySettings.changed && !this.historySettings.draft;
        try {
            if (this.publication.draft(profile.profile_id))
                changed = true;
        }
        catch (error) {
            this.publication.showError(error);
            changed = invalid = true;
        }
        button.hidden = !changed && !this.savingSettings;
        button.toggleAttribute("disabled", invalid || this.savingSettings);
        button.toggleAttribute("loading", this.savingSettings);
        if (changed)
            this.element("settingsStatus").hidden = true;
    }
    async saveSettings() {
        const profile = this.selected;
        const signal = this.moduleSettingsScope?.signal;
        const hass = this._hass;
        if (!profile || !hass || !signal || this.savingSettings)
            return;
        const pane = this.element("settingsPane");
        this.savingSettings = pane.inert = true;
        this.refreshSettingsSave();
        try {
            const publication = this.publication.draft(profile.profile_id);
            const history = this.historySettings.draft;
            if (this.historySettings.changed && !history)
                return;
            if (this.moduleSettings?.changed && !await this.moduleSettings.save())
                return;
            signal.throwIfAborted();
            if (this.historySettings.changed && history) {
                try {
                    const response = await hass.fetchWithAuth(this.previewPath(profile) + "/history_settings", {
                        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(history), signal,
                    });
                    if (!response.ok)
                        throw new Error();
                    const stored = await response.json();
                    signal.throwIfAborted();
                    this.historySettings.setValue(stored);
                }
                catch {
                    if (!signal.aborted)
                        this.historySettings.failed();
                    return;
                }
            }
            if (publication)
                await this.savePublication(profile.profile_id, publication);
            if (!signal.aborted) {
                const status = this.element("settingsStatus");
                status.textContent = this.strings.settingsSaved;
                status.hidden = false;
            }
        }
        catch (error) {
            if (!signal.aborted)
                this.publication.showError(error);
        }
        finally {
            if (!signal.aborted) {
                this.savingSettings = pane.inert = false;
                this.refreshSettingsSave();
            }
        }
    }
    async savePublication(profileId, changes) {
        const profile = this.selected;
        const hass = this._hass;
        if (!hass || profile?.profile_id !== profileId)
            throw new Error("profile_not_found");
        const publication = await hass.connection.sendMessagePromise({
            type: "image_lab/set_publication", profile_id: profileId, settings: changes,
        }).catch(error => { throw new Error(error?.code ?? "publication_failed"); });
        // The subscription normally reports the update before the command replies.
        if (this.selected === profile) {
            this.profiles = this.profiles?.map(item => item === profile ? {
                ...item, publication, interval_minutes: publication.settings.interval_minutes,
            } : item);
            this.renderAnalysisRows();
            this.render();
        }
    }
    showError(message) {
        const error = this.element("error");
        error.textContent = this.strings[message];
        error.hidden = false;
    }
    async copyId() {
        const profile = this.selected;
        if (!profile)
            return;
        const status = this.element("copyStatus");
        let message = this.strings.copied;
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(profile.profile_id);
            }
            else {
                const field = document.createElement("textarea");
                field.value = profile.profile_id;
                field.readOnly = true;
                field.style.cssText = "position: fixed; inset-inline-start: -10000px;";
                this.shadowRoot.append(field);
                try {
                    field.select();
                    if (!document.execCommand("copy"))
                        throw new Error("Copy failed");
                }
                finally {
                    field.remove();
                    this.element("copy").focus();
                }
            }
        }
        catch {
            message = this.strings.copyError;
        }
        if (profile.profile_id === this.selectedId) {
            status.textContent = message;
            status.hidden = false;
        }
    }
    paletteSwatches(colors) {
        if (!colors?.length)
            throw new Error("Missing palette");
        return colors.map((rgb) => {
            const row = document.createElement("li");
            const swatch = document.createElement("div");
            const code = document.createElement("code");
            const hex = `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
            swatch.className = "swatch";
            swatch.style.backgroundColor = hex;
            code.textContent = hex;
            row.append(swatch, code);
            return row;
        });
    }
    async showObjects(metadata, stage, overlay, results, hass, signal) {
        const { width, height, data: { objects, truncated } } = metadata;
        if (!Array.isArray(objects) || width <= 0 || height <= 0)
            throw new Error("Missing detection result");
        const language = hass.locale.language;
        const { resources } = objects.length
            ? await hass.connection.sendMessagePromise({
                type: "frontend/get_translations", language, category: "selector", integration: ["image_lab"],
            }).catch(() => ({ resources: {} }))
            : { resources: {} };
        signal.throwIfAborted();
        stage.style.setProperty("--image-aspect", String(width / height));
        stage.classList.add("with-objects");
        const list = [];
        const boxes = objects.map(({ label, confidence: score, box: { x_min, y_min, x_max, y_max } }) => {
            const name = resources[`component.image_lab.selector.object_labels.options.${label}`]
                ?? label.replaceAll("_", " ");
            const confidence = score.toLocaleString(language, { style: "percent" });
            const box = document.createElement("div");
            box.className = "object-box";
            box.style.setProperty("--label-left", `${x_min * 100}cqw`);
            box.style.left = `${x_min * 100}%`;
            box.style.top = `${y_min * 100}%`;
            box.style.width = `${(x_max - x_min) * 100}%`;
            box.style.height = `${(y_max - y_min) * 100}%`;
            const caption = document.createElement("span");
            caption.textContent = name;
            box.append(caption);
            const item = document.createElement("li");
            item.textContent = `${name} · ${confidence}`;
            list.push(item);
            return box;
        });
        overlay.replaceChildren(...boxes);
        results.replaceChildren(...list);
        results.hidden = !objects.length;
        const summary = this.objectSummary(objects.length);
        return truncated ? `${summary} · ${this.strings.objectLimit}` : summary;
    }
    async readMetadata(hass, path, imageId, signal) {
        const response = await hass.fetchWithAuth(`${path}/${encodeURIComponent(imageId)}?metadata=1`, { signal });
        if (!response.ok)
            throw new Error("Missing capture metadata");
        const metadata = await response.json();
        if (metadata.image_id !== imageId)
            throw new Error("Unexpected capture ID");
        return metadata;
    }
    objectSummary(count) {
        return count === 0 ? this.strings.noObjects :
            count === 1 ? this.strings.objectFound : `${count} ${this.strings.objectsFound}`;
    }
    previewPath(profile) {
        return `/api/image_lab/preview/${encodeURIComponent(profile.profile_id)}`;
    }
    observationLabel(time, manual) {
        return new Date(time).toLocaleString(this._hass?.locale.language, {
            timeZone: this._hass?.config?.time_zone,
        }) + " · " + this.strings[manual ? "manualAnalysis" : "automaticAnalysis"];
    }
    async loadHistorySettings(profile, hass, signal) {
        this.historySettings.localize(hass.locale.language);
        try {
            const response = await hass.fetchWithAuth(this.previewPath(profile) + "/history_settings", { signal });
            if (!response.ok)
                throw new Error();
            const settings = await response.json();
            signal.throwIfAborted();
            this.historySettings.setValue(settings);
            this.refreshSettingsSave();
        }
        catch {
            if (!signal.aborted)
                this.historySettings.failed();
        }
    }
    async loadHistory() {
        const profile = this.selected;
        const hass = this._hass;
        if (!profile || profile.module === "comparison" || !hass)
            return;
        this.historyScope?.abort();
        const { signal } = this.historyScope = new AbortController();
        const path = this.previewPath(profile);
        const plurals = new Intl.PluralRules(hass.locale.language);
        this.captureHistory.localize(hass);
        this.captureHistory.loading(true);
        try {
            const response = await hass.fetchWithAuth(path + "/history", { signal });
            if (!response.ok)
                throw new Error();
            const items = await response.json();
            signal.throwIfAborted();
            this.captureHistory.render(items, {
                image: (id, imageSignal, thumbnail) => this.images.get(hass, path + "/" + encodeURIComponent(id) + (thumbnail ? "?thumbnail=1" : ""), imageSignal),
                summary: item => item.meter ? {
                    text: meterText({ ...item.meter, reason: item.reason }, hass.locale.language, true),
                    uncertain: Boolean(item.reason),
                } : ({
                    text: item.dominant_hex ?? (item.count == null ? "" :
                        `${item.count} ${this.strings[plurals.select(item.count) === "one" ? "historyObject" : "historyObjects"]}`),
                    color: item.dominant_hex ?? undefined,
                }),
                details: async (item, content, image, detailSignal) => {
                    const metadata = item.meter
                        ? { module: "meter", data: item.meter, reason: item.reason }
                        : await this.readMetadata(hass, path, item.id, detailSignal);
                    detailSignal.throwIfAborted();
                    if (metadata.module === "palette") {
                        const list = document.createElement("ul");
                        list.className = "swatches";
                        list.append(...this.paletteSwatches(metadata.data.palette_rgb));
                        content.append(list);
                    }
                    else if (metadata.module === "meter") {
                        const status = document.createElement("p");
                        status.className = "meter-status";
                        status.textContent = meterText({ ...metadata.data, reason: metadata.reason }, hass.locale.language);
                        content.append(status);
                    }
                    else {
                        const stage = document.createElement("div");
                        stage.className = "image-stage";
                        const overlay = document.createElement("div");
                        overlay.className = "objects-overlay";
                        overlay.setAttribute("aria-hidden", "true");
                        content.prepend(stage);
                        stage.append(image, overlay);
                        const results = document.createElement("ul");
                        results.className = "object-list";
                        const summary = await this.showObjects(metadata, stage, overlay, results, hass, detailSignal);
                        const status = document.createElement("p");
                        status.textContent = summary;
                        content.append(status, results);
                    }
                },
            });
        }
        catch {
            if (!signal.aborted) {
                this.captureHistory.loading(false);
                this.captureHistory.failed();
            }
        }
    }
    async loadPreview(manual = false) {
        const profile = this.selected;
        const hass = this._hass;
        if (!profile || !hass || this.activeTest || (manual && !profile.available))
            return;
        const controller = new AbortController();
        this.activeTest = controller;
        this.element("error").hidden = true;
        this.element("test").setAttribute(manual ? "loading" : "disabled", "");
        const status = this.element("status");
        const isDetection = profile.module === "object_detection";
        let summary = status.textContent ?? "";
        status.textContent = !manual ? this.strings.loadingResult :
            isDetection ? this.strings.detecting : this.strings.testing;
        try {
            const result = manual ? await hass.connection.sendMessagePromise({
                type: "image_lab/test_source", profile_id: profile.profile_id,
            }) : undefined;
            controller.signal.throwIfAborted();
            if (result?.image_id === null)
                throw new Error(result.reason);
            const path = this.previewPath(profile);
            const response = await hass.fetchWithAuth(result?.image_id ? `${path}/${encodeURIComponent(result.image_id)}` : path, {
                signal: controller.signal, cache: "no-store",
                headers: !manual && this.previewETag ? { "If-None-Match": this.previewETag } : undefined,
            });
            if (response.status === 304)
                return;
            if (response.status === 204) {
                summary = profile.available && profile.module === "meter" && !profile.meter_initialized
                    ? this.meterLabels.reasons.meter_needs_calibration
                    : this.strings[profile.available ? "noResult" : "profile_unavailable"];
                return;
            }
            if (response.status === 422) {
                const { reason } = await response.json();
                throw new Error(reason);
            }
            if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) {
                throw new Error("Preview response was not an image");
            }
            const etag = response.headers.get("ETag");
            const imageId = etag?.slice(1, -1);
            if (!imageId || (result && result.image_id !== imageId))
                throw new Error("Unexpected capture ID");
            const [blob, metadata] = await Promise.all([
                response.blob(),
                result ?? this.readMetadata(hass, path, imageId, controller.signal),
            ]);
            controller.signal.throwIfAborted();
            if (metadata.module !== profile.module)
                throw new Error("Unexpected capture module");
            if (metadata.module === "object_detection") {
                summary = await this.showObjects(metadata, this.element("imageStage"), this.element("objectsOverlay"), this.element("objectList"), hass, controller.signal);
                controller.signal.throwIfAborted();
            }
            else if (metadata.module === "meter") {
                summary = meterText({ ...metadata.data, reason: metadata.reason }, hass.locale.language);
            }
            else {
                this.element("swatches").replaceChildren(...this.paletteSwatches(metadata.data.palette_rgb));
                this.element("palette").hidden = false;
                summary = this.strings.paletteReady;
            }
            if (this.previewUrl)
                URL.revokeObjectURL(this.previewUrl);
            this.previewETag = etag ?? undefined;
            this.previewUrl = URL.createObjectURL(blob);
            const image = this.element("image");
            image.src = this.previewUrl;
            image.alt = this.strings.preview;
            const format = blob.type.split("/")[1]?.toUpperCase();
            const details = `${metadata.width} × ${metadata.height} px · ${format}`;
            this.element("dimensions").textContent = this.observationLabel(metadata.time, metadata.manual) + " · " + details;
            this.element("preview").hidden = false;
            if (metadata.confirmation === "disagreed") {
                summary += " · " + this.strings.notConfirmed;
            }
        }
        catch (error) {
            if (!controller.signal.aborted) {
                const reason = error instanceof Error ? error.message : "";
                const meterReason = profile.module === "meter" && this.meterLabels.reasons[reason];
                if (meterReason) {
                    const notice = this.element("error");
                    notice.textContent = meterReason;
                    notice.hidden = false;
                }
                else {
                    this.showError(Object.hasOwn(this.strings, reason) ? reason : manual ? "testError" : "resultError");
                }
            }
        }
        finally {
            if (this.activeTest === controller) {
                this.activeTest = undefined;
                this.element("test").removeAttribute("loading");
                this.element("test").toggleAttribute("disabled", !this.selected?.available);
                status.textContent = summary;
                if (manual && !this.element("historyPane").hidden)
                    void this.loadHistory();
            }
        }
    }
}
// An open Home Assistant tab can reconnect and load the new URL before a refresh.
if (!customElements.get("image-lab-panel"))
    customElements.define("image-lab-panel", ImageLabPanel);
