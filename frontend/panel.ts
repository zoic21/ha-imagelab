import { meterStrings, panelStrings as strings } from "./translations.js";
import { ImageLabComparison } from "./comparison.js";

import { actionLabel } from "./action.js";
import { AnalysisList, analysisListStyles, type AnalysisModule, type AnalysisRow, type CaptureUpdate } from "./analysis-list.js";
import { CaptureHistory, HistorySettings, historyMarkup, historySettingsMarkup, historyStyles, type Capture, type HistorySettingsValue } from "./history.js";
import { ImageCache } from "./image-cache.js";
import { editMeter, meterStyles, meterText, type MeterResult } from "./meter.js";
import { editModuleSettings, runProfileFlow, type ProfileFlowMode } from "./options.js";
import { profileTab, profileTabsStyles } from "./profile-tabs.js";
import { PublicationSettings, publicationMarkup, publicationStyles, type PublicationChanges, type PublicationSnapshot } from "./publication.js";
import { editZone } from "./zone.js";
import type { Region } from "./region.js";

type Module = AnalysisModule;
type Source = "camera" | "media_player" | "upload";
type Rgb = [number, number, number];
type DetectionResult = {
  objects: {
    label: string;
    confidence: number;
    box: { x_min: number; y_min: number; x_max: number; y_max: number };
  }[];
  truncated: boolean;
};
type PreviewMetadata = {
  image_id: string; width: number; height: number; time: string; manual: boolean;
  reason?: string; confirmation?: string;
} & (
  | { module: "palette"; data: { palette_rgb: Rgb[] } }
  | { module: "meter"; data: MeterResult }
  | { module: "object_detection"; data: DetectionResult }
);
type TestResult = PreviewMetadata | { image_id: null; reason: string };
type HistoryItem = Capture & { dominant_hex: string | null; count: number | null; meter?: MeterResult; reason?: string | null };
const panelPath = "/image-lab";
const sourceIcons = { camera: "cctv", media_player: "music-note", upload: "image-outline" };

interface Profile {
  profile_id: string;
  title: string;
  module: Module;
  source_type: Source;
  palette_size: number | null;
  meter_initialized: boolean;
  region: Region | null;
  image_revision: string | null;
  entity_id: string | null;
  output_entity_id: string | null;
  interval_minutes: number;
  publication: PublicationSnapshot;
  available: boolean;
}

interface HomeAssistant {
  locale: { language: string };
  config?: { time_zone: string };
  states: Record<string, { attributes: { friendly_name?: string } }>;
  entities?: Record<string, unknown>;
  connection: {
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
    subscribeMessage<T>(
      listener: (message: T) => void,
      message: { type: string },
    ): Promise<() => Promise<void>>;
  };
  callApi<T>(method: string, path: string, data?: Record<string, unknown>): Promise<T>;
  fetchWithAuth(path: string, init?: RequestInit): Promise<Response>;
}

type Message = keyof typeof strings.en;
interface AnalysisColumn {
  title: string;
  flex?: number;
  minWidth: string;
  filterable: boolean;
  sortable: boolean;
  template?: (row: AnalysisRow) => Node;
}

type SortDirection = "asc" | "desc" | null;

interface AnalysisTable extends HTMLElement {
  columns: Record<string, AnalysisColumn>;
  data: AnalysisRow[];
  filter: string;
  sortColumn?: "name" | "type" | "source" | "trigger";
  sortDirection: SortDirection;
  updateComplete?: Promise<unknown>;
}

interface AnalysisSortItem extends HTMLElement {
  value: string;
  checked: boolean;
}

interface HomeAssistantButton extends HTMLElement {
  updateComplete?: Promise<unknown>;
}

interface HomeAssistantPanel extends HTMLElement {
  navigate(path: string, options?: { replace?: boolean }): void;
}

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display: block; position: relative; height: 100dvh; color: var(--primary-text-color); }
    [hidden] { display: none !important; }
    ha-top-app-bar-fixed { height: 100%; }
    .heading { display: inline-flex; align-items: center; gap: var(--ha-space-3, 12px); max-width: 100%; }
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
    ha-data-table { display: block; width: 100%; }
    .analysisControls {
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      padding: var(--ha-space-3, 12px);
      border-bottom: 1px solid var(--divider-color);
    }
    :host([narrow]) .analysisControls { border: 0; padding: 0 0 var(--ha-space-3, 12px); }
    ${analysisListStyles}
    ${profileTabsStyles}
    #analysisSearch { flex: 1; min-width: 0; }
    #analysisSort { flex: none; }
    #profile > [role="tabpanel"] { padding-block-start: var(--ha-space-4, 16px); }
    ${historyStyles}
    ${meterStyles}
    #profileHistorySettings { margin-top: var(--ha-space-3, 12px); }
    .moduleSettingsSave, #zone, #meterSettings { margin-top: 12px; }
    .secondary { color: var(--secondary-text-color); }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    code { overflow-wrap: anywhere; }
    .settingsSection {
      border-top: 1px solid var(--divider-color);
      padding-block: var(--ha-space-3, 12px);
    }
    .settingsTitle { font-size: 1rem; margin: 0 0 8px; }
    .settingsInfo {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
      gap: var(--ha-space-2, 8px);
    }
    .settingsInfo p { margin: 0; }
    #editSource { display: block; width: 100%; --ha-button-height: auto; }
    #editSource::part(base) { padding: 0; border-radius: var(--ha-border-radius-md, 8px); }
    #editSource::part(label) { width: 100%; padding: 0; }
    .sourceRow {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
      gap: var(--ha-space-2, 8px); padding: var(--ha-space-2, 8px); min-height: var(--ha-space-12, 48px);
      box-sizing: border-box; border-radius: var(--ha-border-radius-md, 8px);
      background: var(--secondary-background-color); color: var(--primary-text-color);
      text-align: start; white-space: normal; overflow-wrap: anywhere;
    }
    .sourceRow ha-icon { --mdc-icon-size: 20px; }
    .sourceRow ha-icon:last-child { color: var(--primary-color); }
    #sourceKind { display: block; font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-normal, 400); }
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
  <div class="heading" slot="title"><img id="icon" src="/image_lab_icon.png" alt=""><h1 id="title" tabindex="-1">Image Lab</h1></div>
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
      <div id="analysisControls" class="analysisControls" slot="header" hidden>
        <ha-input-search id="analysisSearch" appearance="outlined" enterkeyhint="search"></ha-input-search>
        <ha-dropdown id="analysisSort" placement="bottom-end">
          <ha-icon-button id="analysisSortButton" slot="trigger" aria-haspopup="menu">
            <ha-icon icon="mdi:sort" aria-hidden="true"></ha-icon>
          </ha-icon-button>
        </ha-dropdown>
      </div>
      <ha-data-table clickable auto-height hidden></ha-data-table>
      <div id="analysisGroups" hidden></div>
    </section>
    <ha-card id="detailCard" hidden>
      <section class="content">
        <div id="profile">
          <p class="secondary" id="source"></p>
          <ha-tab-group id="profileNav" class="profileTabs" active="result">
            ${profileTab("resultTab", "result", "resultPane", "image-outline")}
            ${profileTab("historyTab", "history", "historyPane", "history")}
            ${profileTab("settingsTab", "settings", "settingsPane", "cog-outline")}
          </ha-tab-group>
          <section id="resultPane" role="tabpanel" aria-labelledby="resultTab">
            <ha-button id="test" variant="brand"></ha-button>
            <p id="status" class="secondary" role="status"></p>
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
            <section aria-labelledby="analysisSettingsTitle">
              <h3 id="analysisSettingsTitle" class="settingsTitle"></h3>
              <div id="moduleSettings"></div>
              <ha-button id="zone" appearance="plain" hidden></ha-button>
              <ha-button id="meterSettings" appearance="plain" hidden></ha-button>
              <p class="secondary" id="meterSettingsStatus" role="status" hidden></p>
            </section>
            <section id="profileHistorySettings" class="settingsSection">${historySettingsMarkup()}</section>
            <div id="profileSettings" slot="profile-settings">
              <section class="settingsSection" aria-labelledby="sourceSettingsTitle">
                <h3 id="sourceSettingsTitle" class="settingsTitle"></h3>
                <ha-button id="editSource" appearance="plain" variant="neutral">
                  <span class="sourceRow">
                    <ha-icon id="sourceIcon" class="secondary" aria-hidden="true"></ha-icon>
                    <span><span id="sourceKind" class="secondary"></span><span id="sourceSummary"></span></span>
                    <ha-icon icon="mdi:pencil-outline" aria-hidden="true"></ha-icon>
                  </span>
                </ha-button>
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
  private _hass?: HomeAssistant;
  private profiles?: Profile[];
  private selectedId?: string;
  private listScrollTop = 0;
  private subscription?: Promise<() => Promise<void>>;
  private captureSubscription?: Promise<() => Promise<void>>;
  private failed = false;
  private activeTest?: AbortController;
  private historyScope?: AbortController;
  private readonly captureHistory: CaptureHistory<HistoryItem>;
  private readonly historySettings: HistorySettings;
  private previewUrl?: string;
  private previewETag?: string;
  private optionsScope?: AbortController;
  private moduleSettingsScope?: AbortController;
  private zoneScope?: AbortController;
  private strings = strings.en;
  private readonly images = new ImageCache();
  private readonly comparison: ImageLabComparison;
  private readonly publication: PublicationSettings;
  private readonly analysisList: AnalysisList;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.analysisTable.append(this.element("analysisControls"));
    this.analysisList = new AnalysisList(this.element("analysisGroups"), this.images, id => this.select(id));
    this.captureHistory = new CaptureHistory(this.element("historyPane"), () => void this.loadHistory());
    this.historySettings = new HistorySettings(this.element("profileHistorySettings"), false, async (value, signal) => {
      const profile = this.selected;
      if (!profile || !this._hass) return;
      const response = await this._hass.fetchWithAuth(this.previewPath(profile) + "/history_settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal,
      });
      if (!response.ok) throw new Error();
    });
    this.comparison = new ImageLabComparison(this.images, {
      draft: profile => this.publication.draft(profile),
      save: (profile, changes) => this.savePublication(profile, changes),
      setStates: states => this.publication.setStates(states),
    });
    this.publication = new PublicationSettings(
      this.element("publication"), () => this.comparison.refreshSettings(),
      (profile, changes) => this.savePublication(profile, changes), () => this.comparison.openReferences(),
    );
    this.element("comparisonSlot").append(this.comparison);
    this.comparison.addEventListener("analysis-tab-changed", () => this.resetMobileTabScroll());
    this.element("add").addEventListener("click", () => this.openFlow("create"));
    this.element("profileMenu").addEventListener("wa-select", () => this.openFlow("rename"));
    this.element("editSource").addEventListener("click", () => this.openFlow("configure"));
    this.element("retry").addEventListener("click", () => this.subscribe());
    this.element("back").addEventListener("click", () => {
      if (history.state?.from === panelPath) history.back();
      else this.navigate(panelPath, true);
    });
    this.analysisTable.addEventListener("row-click", event => {
      const { id } = (event as CustomEvent<{ id: string }>).detail;
      this.select(id);
    });
    const search = this.element<HTMLElement & { value: string }>("analysisSearch");
    search.addEventListener("input", () => {
      this.analysisTable.filter = search.value;
      this.renderAnalysisGroups();
    });
    this.element("analysisSort").addEventListener("wa-select", event => {
      const { item: { value } } = (event as CustomEvent<{ item: AnalysisSortItem }>).detail;
      const [column, direction] = value.split(":");
      this.analysisTable.sortDirection = direction === "asc" || direction === "desc" ? direction : null;
      this.analysisTable.sortColumn = this.analysisTable.sortDirection ? column as AnalysisTable["sortColumn"] : undefined;
      this.updateAnalysisSort();
      this.renderAnalysisGroups();
    });
    this.analysisTable.addEventListener("sorting-changed", () => this.updateAnalysisSort());
    this.renderAnalysisColumns();
    this.element("profileNav").addEventListener("wa-tab-show", event => {
      this.showTab((event as CustomEvent<{name: string}>).detail.name);
    });
    this.element("outputEntity").addEventListener("click", () => {
      const entityId = this.selected?.output_entity_id;
      if (entityId) this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId }, bubbles: true, composed: true,
      }));
    });
    this.element("test").addEventListener("click", () => void this.loadPreview(true));
    this.element("zone").addEventListener("click", () => {
      const profile = this.selected;
      if (!profile || !this._hass) return;
      this.zoneScope?.abort();
      this.zoneScope = new AbortController();
      void editZone(this.element("profile"), profile.region, this.strings,
        "/api/image_lab/zone/" + encodeURIComponent(profile.profile_id),
        this._hass.fetchWithAuth.bind(this._hass), this.zoneScope.signal);
    });
    this.element("meterSettings").addEventListener("click", () => {
      const profile = this.selected;
      const hass = this._hass;
      if (profile?.module !== "meter" || !hass) return;
      this.zoneScope?.abort();
      this.zoneScope = new AbortController();
      this.element("meterSettingsStatus").hidden = true;
      void editMeter(this.element("profile"), hass.locale.language,
        "/api/image_lab/meter/" + encodeURIComponent(profile.profile_id),
        hass.fetchWithAuth.bind(hass), this.zoneScope.signal, () => {
          const status = this.element("meterSettingsStatus");
          status.textContent = this.meterLabels.saved;
          status.hidden = false;
        });
    });
    this.element("copy").addEventListener("click", () => void this.copyId());
    this.render();
  }

  set hass(hass: HomeAssistant) {
    const previous = this._hass;
    const connectionChanged = previous?.connection !== hass.connection;
    if (connectionChanged) {
      this.analysisList.clear();
      this.images.clear();
    }
    const language = hass.locale.language.startsWith("fr") ? strings.fr : strings.en;
    const languageChanged = this.strings !== language;
    this._hass = hass;
    const output = this.selected?.output_entity_id;
    if (output && previous?.states[output]?.attributes.friendly_name !== hass.states[output]?.attributes.friendly_name)
      this.publication.setEntity(output, hass.states[output]?.attributes.friendly_name);
    if (languageChanged) {
      this.strings = language;
      this.closeModuleSettings();
      this.renderAnalysisColumns();
      this.render();
    }
    if (languageChanged || Boolean(previous?.entities) !== Boolean(hass.entities) ||
      this.profiles?.some(({ entity_id: id }) => {
        if (!id) return false;
        const before = previous?.states[id];
        const now = hass.states[id];
        return Boolean(before) !== Boolean(now) ||
          before?.attributes.friendly_name !== now?.attributes.friendly_name ||
          Boolean(previous?.entities?.[id]) !== Boolean(hass.entities?.[id]);
      })) this.renderAnalysisRows();
    if (connectionChanged) {
      this.unsubscribe();
      this.subscribe();
    }
  }

  set narrow(value: boolean) {
    if (this.hasAttribute("narrow") === value) return;
    this.toggleAttribute("narrow", value);
    this.element("appBar").toggleAttribute("narrow", value);
    this.comparison.toggleAttribute("narrow", value);
    const controls = this.element("analysisControls");
    if (value) {
      this.analysisTable.before(controls);
      this.renderAnalysisGroups();
    } else {
      this.analysisTable.append(controls);
      this.analysisList.clear();
    }
    this.render();
  }

  set route({ path }: { path: string }) {
    const id = /^\/([a-z0-9]+)\/?$/i.exec(path)?.[1];
    if (id === this.selectedId) return;
    const previous = this.selectedId;
    const scroller = this.scrollTarget;
    if (!previous && scroller) this.listScrollTop = scroller.scrollTop;
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
    this.images.clear();
    this.optionsScope?.abort();
    this.closeModuleSettings();
    this.unsubscribe();
    this.clearTest();
  }

  private element<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.shadowRoot!.getElementById(id) as T;
  }

  private get analysisTable() {
    return this.shadowRoot!.querySelector<AnalysisTable>("ha-data-table")!;
  }

  private get scrollTarget() {
    const { scrollTarget } = this.element<HTMLElement & {scrollTarget?: HTMLElement | Window}>("appBar");
    return scrollTarget instanceof HTMLElement ? scrollTarget : undefined;
  }

  private get selected(): Profile | undefined {
    return this.profiles?.find((profile) => profile.profile_id === this.selectedId);
  }

  private openFlow(mode: ProfileFlowMode) {
    const entry = mode === "create" ? undefined : this.selected?.profile_id;
    if (!this._hass || (mode !== "create" && !entry)) return;
    this.optionsScope?.abort();
    this.optionsScope = new AbortController();
    void runProfileFlow(this.element("dialogs"), this._hass, mode, entry,
      this.strings, this.optionsScope.signal, id => this.select(id));
  }

  private get meterLabels() {
    return this.strings === strings.fr ? meterStrings.fr : meterStrings.en;
  }

  private closeModuleSettings() {
    this.moduleSettingsScope?.abort();
    this.moduleSettingsScope = undefined;
  }

  private showModuleSettings() {
    const profile = this.selected;
    const hass = this._hass;
    if (this.moduleSettingsScope || !profile || profile.module === "comparison" || !hass) return;
    this.moduleSettingsScope = new AbortController();
    const moduleSettings = this.element("moduleSettings");
    moduleSettings.hidden = profile.module === "meter";
    if (profile.module !== "meter")
      editModuleSettings(moduleSettings, hass, profile.profile_id, this.strings, this.moduleSettingsScope.signal);
    void this.loadHistorySettings(profile, hass, this.moduleSettingsScope.signal);
  }

  private subscribe() {
    if (!this.isConnected || !this._hass || this.subscription) return;
    this.failed = false;
    if (!this.captureSubscription) {
      const captures = this._hass.connection.subscribeMessage<CaptureUpdate>((update) => {
        if (captures === this.captureSubscription) this.analysisList.refresh(update);
      }, { type: "image_lab/subscribe_captures" });
      this.captureSubscription = captures;
      void captures.catch(() => {
        if (captures === this.captureSubscription) this.captureSubscription = undefined;
      });
    }
    const subscription = this._hass.connection.subscribeMessage<Profile[]>((profiles) => {
      if (subscription !== this.subscription) return;
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
      if (subscription !== this.subscription) return;
      this.subscription = undefined;
      this.failed = true;
      this.render();
    });
    this.render();
  }

  private unsubscribe() {
    const captures = this.captureSubscription;
    this.captureSubscription = undefined;
    void captures?.then(unsubscribe => unsubscribe()).catch(() => {});
    if (!this.subscription) return;
    void this.subscription.then((unsubscribe) => unsubscribe()).catch(() => {});
    this.subscription = undefined;
  }

  private select(id: string) {
    if (id !== this.selectedId) this.navigate(`${panelPath}/${id}`);
  }

  private navigate(path: string, replace = false) {
    this.closest<HomeAssistantPanel>("ha-panel-custom")?.navigate(path, { replace });
  }

  private async focusListAction(id?: string) {
    if (this.hasAttribute("narrow")) {
      const action = (this.shadowRoot!.getElementById(`analysis-${id}`) ?? this.element("add")) as HomeAssistantButton;
      await action.updateComplete;
      if (!this.selectedId && action.isConnected) action.focus({ preventScroll: true });
      return;
    }
    const table = this.analysisTable;
    await table.updateComplete;
    const findAction = () => table.shadowRoot?.getElementById(`analysis-${id}`);
    if (!findAction() && table.data.some(row => row.id === id)) {
      const list = table.shadowRoot?.querySelector<HTMLElement & { layoutComplete?: Promise<unknown> }>(
        "lit-virtualizer",
      );
      await list?.layoutComplete?.catch(() => {});
    }
    const action = (findAction() ?? this.element("add")) as HomeAssistantButton;
    await action.updateComplete;
    if (!this.selectedId && action.isConnected) action.focus({ preventScroll: true });
  }

  private resetMobileTabScroll() {
    const scroller = this.scrollTarget;
    if (this.hasAttribute("narrow") && scroller) scroller.scrollTop = 0;
  }

  private showTab(tab: string, refresh = true) {
    const previous = this.element("profileNav").getAttribute("active");
    const returning = previous !== "result" || this.element("resultPane").hidden;
    if (refresh && previous !== tab) this.resetMobileTabScroll();
    this.element("profileNav").setAttribute("active", tab);
    this.element("resultPane").hidden = tab !== "result";
    this.element("historyPane").hidden = tab !== "history";
    this.element("settingsPane").hidden = tab !== "settings";
    if (tab === "result" && refresh && returning && this.selected?.module !== "comparison") void this.loadPreview();
    if (tab === "settings") this.showModuleSettings();
    if (tab === "history") void this.loadHistory();
    else {
      this.historyScope?.abort();
      this.captureHistory.clear();
    }
  }

  private clearTest() {
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
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = undefined;
    this.previewETag = undefined;
    this.element("copyStatus").hidden = true;
  }

  private analysisTrigger(profile: Profile) {
    const labels = this.strings;
    if (profile.source_type === "media_player" && profile.output_entity_id)
      return labels.artworkTrigger;
    if (profile.source_type === "camera" && profile.interval_minutes)
      return labels.everyMinutes.replace("{minutes}", String(profile.interval_minutes));
    return labels.manualTrigger;
  }

  private renderAnalysisRows() {
    const labels = this.strings;
    const hass = this._hass;
    const rows = (this.profiles ?? []).map(profile => {
      const id = profile.entity_id;
      const state = id ? hass?.states[id] : undefined;
      const source = state?.attributes.friendly_name || id || labels[profile.source_type];
      const sourceMissing = profile.source_type !== "upload" &&
        (!id || Boolean(hass?.entities && !hass.entities[id] && !state));
      const warning = sourceMissing ? labels.missingSource : !profile.available ? labels.profile_unavailable :
        profile.module === "meter" && !profile.meter_initialized ? this.meterLabels.reasons.meter_unconfirmed : "";
      const trigger = this.analysisTrigger(profile);
      return {
        id: profile.profile_id, name: profile.title, module: profile.module, type: labels[profile.module], source, warning,
        trigger, schedule: profile.source_type === "camera" && profile.interval_minutes
          ? `${profile.interval_minutes} min` : trigger === labels.manualTrigger ? "" : trigger,
      };
    });
    rows.sort((first, second) => Number(Boolean(second.warning)) - Number(Boolean(first.warning)));
    this.analysisTable.data = rows;
    this.renderAnalysisGroups();
  }

  private renderAnalysisGroups() {
    if (!this.hasAttribute("narrow") || !this._hass || !this.profiles?.length) {
      this.analysisList.clear();
      return;
    }
    const { data, filter, sortColumn, sortDirection } = this.analysisTable;
    const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const terms = normalize(filter.trim()).split(/\s+/).filter(Boolean);
    const rows = data.filter(row => {
      const searchable = normalize([row.name, row.type, row.source, row.trigger, row.warning].join(" "));
      return terms.every(term => searchable.includes(term));
    });
    if (sortColumn && sortDirection) {
      const direction = sortDirection === "asc" ? 1 : -1;
      const collator = new Intl.Collator(this._hass.locale.language, { sensitivity: "base", numeric: true });
      rows.sort((a, b) => direction * collator.compare(a[sortColumn], b[sortColumn]));
    }
    this.analysisList.render(rows, this._hass, this.strings.noMatchingAnalyses);
  }

  private renderAnalysisColumns() {
    const labels = this.strings;
    this.element("analysisList").setAttribute("aria-label", labels.analyses);
    this.element("analysisSearch").setAttribute("label", labels.searchAnalyses);
    const columnDefaults = { minWidth: "0", filterable: true, sortable: true };
    this.analysisTable.columns = {
      name: {
        ...columnDefaults, title: labels.nameColumn, flex: 1.6,
        template: row => this.analysisNameCell(row),
      },
      type: {
        ...columnDefaults, title: labels.typeColumn,
        template: row => {
          const type = document.createElement("span");
          type.style.cssText = "white-space:normal;overflow-wrap:anywhere;line-height:1.2";
          type.textContent = row.type;
          return type;
        },
      },
      source: { ...columnDefaults, title: labels.sourceColumn },
      trigger: { ...columnDefaults, title: labels.triggerColumn },
    };
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

  private updateAnalysisSort() {
    const { sortColumn, sortDirection } = this.analysisTable;
    const active = sortDirection ? `${sortColumn}:${sortDirection}` : "warnings";
    for (const item of this.element("analysisSort").querySelectorAll<AnalysisSortItem>("ha-dropdown-item"))
      item.checked = item.getAttribute("value") === active;
  }

  private analysisNameCell(row: AnalysisRow) {
    // Keep a native keyboard target on Home Assistant versions that only handle row clicks.
    const name = document.createElement("div");
    name.style.cssText = "min-width:0;max-width:100%;line-height:1.2";
    const action = document.createElement("ha-button");
    action.id = `analysis-${row.id}`;
    action.style.cssText = "display:block;width:fit-content;max-width:100%;text-align:start";
    action.setAttribute("appearance", "plain");
    action.setAttribute("size", "s");
    action.textContent = row.name;
    action.title = row.name;
    action.onclick = () => this.select(row.id);
    name.append(action);
    if (row.warning) {
      const details = document.createElement("span");
      details.style.cssText = "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        + "font-size:var(--ha-font-size-s,12px);line-height:var(--ha-line-height-normal,1.4);"
        + "color:var(--secondary-text-color)";
      details.textContent = row.warning;
      details.title = row.warning;
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:alert-outline");
      icon.setAttribute("aria-hidden", "true");
      icon.style.cssText = "--mdc-icon-size:14px;color:var(--warning-color);margin-inline-end:4px";
      details.prepend(icon);
      name.append(details);
    }
    return name;
  }

  private render(moveFocus = false) {
    const labels = this.strings;
    for (const [id, message] of Object.entries({
      idLabel: labels.id, paletteTitle: labels.palette, "resultTab-label": labels.resultTab,
      "historyTab-label": labels.historyTab, "settingsTab-label": labels.settingsTab,
      analysisSettingsTitle: labels.analysisSettings, sourceSettingsTitle: labels.sourceSettings,
      renameAction: labels.rename,
    })) {
      this.element(id).textContent = message;
    }
    const actions = {
      add: [labels.add, "plus"],
      retry: [labels.retry, "refresh"],
      test: [labels.test, "play-outline"],
      zone: [labels.zone, "crop"],
      meterSettings: [this.meterLabels.configure, "gauge"],
    };
    for (const [id, [label, icon]] of Object.entries(actions))
      actionLabel(this.element(id), label, icon);
    this.element("editSource").title = labels.editSource;
    this.element("copy").setAttribute("label", labels.copy);
    this.element("profileMenuButton").setAttribute("label", labels.profileMenu);

    const profile = this.selected;
    const detail = this.element("detailCard");
    const opened = detail.hidden || moveFocus;
    detail.hidden = !profile;
    this.element("analysisList").hidden = Boolean(profile);
    this.shadowRoot!.querySelector("main")!.classList.toggle("with-detail", Boolean(profile));
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
    const narrow = this.hasAttribute("narrow");
    this.analysisTable.hidden = !hasProfiles || narrow;
    this.element("analysisGroups").hidden = !hasProfiles || !narrow;
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
    this.comparison.configure(
      this._hass,
      isComparison ? profile.profile_id : undefined,
      isComparison ? `${profile.source_type}/${profile.entity_id ?? ""}/${profile.image_revision ?? ""}` : undefined,
      profile?.available,
    );
    const settings = this.element("profileSettings");
    const target = isComparison ? this.comparison : this.element("settingsPane");
    if (settings.parentElement !== target) target.append(settings);
    this.element("profileNav").hidden = isComparison;
    const tab = this.element("profileNav").getAttribute("active");
    this.element("resultPane").hidden = isComparison || tab !== "result";
    this.element("historyPane").hidden = isComparison || tab !== "history";
    this.element("settingsPane").hidden = isComparison || tab !== "settings";
    if (!isComparison && tab === "settings") this.showModuleSettings();
    if (!profile) return;
    const camera = profile.source_type === "camera";
    const schedule = this.element("scheduleHint");
    schedule.hidden = profile.source_type !== "media_player" || Boolean(profile.output_entity_id);
    schedule.textContent = labels.frequencyMediaInactive;
    const sourceName = profile.entity_id
      ? this._hass?.states[profile.entity_id]?.attributes.friendly_name || profile.entity_id
      : undefined;
    const trigger = camera ? undefined : profile.output_entity_id && profile.source_type === "media_player"
      ? labels.artworkTrigger : labels.onDemand;
    this.element("sourceIcon").setAttribute("icon", `mdi:${sourceIcons[profile.source_type]}`);
    this.element("sourceKind").textContent = camera ? labels.cameraLabel : labels[profile.source_type];
    this.element("sourceSummary").textContent =
      [sourceName ?? (profile.source_type !== "upload" ? labels.missingSource : undefined), trigger].filter(Boolean).join(" · ");
    this.element("zone").hidden = !camera || isComparison || profile.module === "meter";
    this.element("meterSettings").hidden = profile.module !== "meter";
    this.element("meterSettings").toggleAttribute("disabled", !profile.available);
    this.element("profileId").textContent = profile.profile_id;
    this.element("source").textContent = labels[profile.module];
    this.element("test").toggleAttribute("disabled", !profile.available || Boolean(this.activeTest));
    if (opened) {
      const scroller = this.scrollTarget;
      if (scroller) scroller.scrollTop = 0;
      title.focus({ preventScroll: true });
      if (!isComparison) void this.loadPreview();
    }
  }

  private async savePublication(profileId: string, changes: PublicationChanges) {
    const profile = this.selected;
    const hass = this._hass;
    if (!hass || profile?.profile_id !== profileId) throw new Error("profile_not_found");
    const publication = await hass.connection.sendMessagePromise<PublicationSnapshot>({
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

  private showError(message: Message) {
    const error = this.element("error");
    error.textContent = this.strings[message];
    error.hidden = false;
  }

  private async copyId() {
    const profile = this.selected;
    if (!profile) return;
    const status = this.element("copyStatus");
    let message = this.strings.copied;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(profile.profile_id);
      } else {
        const field = document.createElement("textarea");
        field.value = profile.profile_id;
        field.readOnly = true;
        field.style.cssText = "position: fixed; inset-inline-start: -10000px;";
        this.shadowRoot!.append(field);
        try {
          field.select();
          if (!document.execCommand("copy")) throw new Error("Copy failed");
        } finally {
          field.remove();
          this.element("copy").focus();
        }
      }
    } catch {
      message = this.strings.copyError;
    }
    if (profile.profile_id === this.selectedId) {
      status.textContent = message;
      status.hidden = false;
    }
  }

  private paletteSwatches(colors: Rgb[]) {
    if (!colors?.length) throw new Error("Missing palette");
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

  private async showObjects(
    metadata: Extract<PreviewMetadata, { module: "object_detection" }>,
    stage: HTMLElement, overlay: HTMLElement, results: HTMLElement,
    hass: HomeAssistant, signal: AbortSignal,
  ) {
    const { width, height, data: { objects, truncated } } = metadata;
    if (!Array.isArray(objects) || width <= 0 || height <= 0) throw new Error("Missing detection result");
    const language = hass.locale.language;
    const { resources }: { resources: Record<string, string> } = objects.length
      ? await hass.connection.sendMessagePromise<{ resources: Record<string, string> }>({
          type: "frontend/get_translations", language, category: "selector", integration: ["image_lab"],
        }).catch(() => ({ resources: {} }))
      : { resources: {} };
    signal.throwIfAborted();
    stage.style.setProperty("--image-aspect", String(width / height));
    stage.classList.add("with-objects");
    const list: HTMLLIElement[] = [];
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

  private async readMetadata(hass: HomeAssistant, path: string, imageId: string, signal: AbortSignal) {
    const response = await hass.fetchWithAuth(`${path}/${encodeURIComponent(imageId)}?metadata=1`, { signal });
    if (!response.ok) throw new Error("Missing capture metadata");
    const metadata: PreviewMetadata = await response.json();
    if (metadata.image_id !== imageId) throw new Error("Unexpected capture ID");
    return metadata;
  }

  private objectSummary(count: number) {
    return count === 0 ? this.strings.noObjects :
      count === 1 ? this.strings.objectFound : `${count} ${this.strings.objectsFound}`;
  }

  private previewPath(profile: Profile) {
    return `/api/image_lab/preview/${encodeURIComponent(profile.profile_id)}`;
  }

  private observationLabel(time: string, manual: boolean) {
    return new Date(time).toLocaleString(this._hass?.locale.language, {
      timeZone: this._hass?.config?.time_zone,
    }) + " · " + this.strings[manual ? "manualAnalysis" : "automaticAnalysis"];
  }

  private async loadHistorySettings(profile: Profile, hass: HomeAssistant, signal: AbortSignal) {
    this.historySettings.localize(hass.locale.language);
    try {
      const response = await hass.fetchWithAuth(this.previewPath(profile) + "/history_settings", { signal });
      if (!response.ok) throw new Error();
      const settings: HistorySettingsValue = await response.json();
      signal.throwIfAborted();
      this.historySettings.setValue(settings);
    } catch {
      if (!signal.aborted) this.historySettings.failed();
    }
  }

  private async loadHistory() {
    const profile = this.selected;
    const hass = this._hass;
    if (!profile || profile.module === "comparison" || !hass) return;
    this.historyScope?.abort();
    const { signal } = this.historyScope = new AbortController();
    const path = this.previewPath(profile);
    const plurals = new Intl.PluralRules(hass.locale.language);
    this.captureHistory.localize(hass);
    this.captureHistory.loading(true);
    try {
      const response = await hass.fetchWithAuth(path + "/history", { signal });
      if (!response.ok) throw new Error();
      const items: HistoryItem[] = await response.json();
      signal.throwIfAborted();
      this.captureHistory.render(items, {
        image: (id, imageSignal, thumbnail) => this.images.get(
          hass, path + "/" + encodeURIComponent(id) + (thumbnail ? "?thumbnail=1" : ""), imageSignal,
        ),
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
            ? { module: "meter" as const, data: item.meter, reason: item.reason }
            : await this.readMetadata(hass, path, item.id, detailSignal);
          detailSignal.throwIfAborted();
          if (metadata.module === "palette") {
            const list = document.createElement("ul");
            list.className = "swatches";
            list.append(...this.paletteSwatches(metadata.data.palette_rgb));
            content.append(list);
          } else if (metadata.module === "meter") {
            const status = document.createElement("p");
            status.className = "meter-status";
            status.textContent = meterText({ ...metadata.data, reason: metadata.reason }, hass.locale.language);
            content.append(status);
          } else {
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
    } catch {
      if (!signal.aborted) {
        this.captureHistory.loading(false);
        this.captureHistory.failed();
      }
    }
  }

  private async loadPreview(manual = false) {
    const profile = this.selected;
    const hass = this._hass;
    if (!profile || !hass || this.activeTest || (manual && !profile.available)) return;

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
      const result = manual ? await hass.connection.sendMessagePromise<TestResult>({
        type: "image_lab/test_source", profile_id: profile.profile_id,
      }) : undefined;
      controller.signal.throwIfAborted();
      if (result?.image_id === null) throw new Error(result.reason);
      const path = this.previewPath(profile);
      const response = await hass.fetchWithAuth(
        result?.image_id ? `${path}/${encodeURIComponent(result.image_id)}` : path,
        {
          signal: controller.signal, cache: "no-store",
          headers: !manual && this.previewETag ? { "If-None-Match": this.previewETag } : undefined,
        },
      );
      if (response.status === 304) return;
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
      if (!imageId || (result && result.image_id !== imageId)) throw new Error("Unexpected capture ID");
      const [blob, metadata] = await Promise.all([
        response.blob(),
        result ?? this.readMetadata(hass, path, imageId, controller.signal),
      ]);
      controller.signal.throwIfAborted();

      if (metadata.module !== profile.module) throw new Error("Unexpected capture module");
      if (metadata.module === "object_detection") {
        summary = await this.showObjects(metadata, this.element("imageStage"), this.element("objectsOverlay"),
          this.element("objectList"), hass, controller.signal);
        controller.signal.throwIfAborted();
      } else if (metadata.module === "meter") {
        summary = meterText({ ...metadata.data, reason: metadata.reason }, hass.locale.language);
      } else {
        this.element("swatches").replaceChildren(...this.paletteSwatches(metadata.data.palette_rgb));
        this.element("palette").hidden = false;
        summary = this.strings.paletteReady;
      }
      if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
      this.previewETag = etag ?? undefined;
      this.previewUrl = URL.createObjectURL(blob);
      const image = this.element<HTMLImageElement>("image");
      image.src = this.previewUrl;
      image.alt = this.strings.preview;
      const format = blob.type.split("/")[1]?.toUpperCase();
      const details = `${metadata.width} × ${metadata.height} px · ${format}`;
      this.element("dimensions").textContent = this.observationLabel(metadata.time, metadata.manual) + " · " + details;
      this.element("preview").hidden = false;
      if (metadata.confirmation === "disagreed") {
        summary += " · " + this.strings.notConfirmed;
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const reason = error instanceof Error ? error.message : "";
        const meterReason = profile.module === "meter" && this.meterLabels.reasons[reason];
        if (meterReason) {
          const notice = this.element("error");
          notice.textContent = meterReason;
          notice.hidden = false;
        } else {
          this.showError(Object.hasOwn(this.strings, reason) ? reason as Message : manual ? "testError" : "resultError");
        }
      }
    } finally {
      if (this.activeTest === controller) {
        this.activeTest = undefined;
        this.element("test").removeAttribute("loading");
        this.element("test").toggleAttribute("disabled", !this.selected?.available);
        status.textContent = summary;
        if (manual && !this.element("historyPane").hidden) void this.loadHistory();
      }
    }
  }
}

// An open Home Assistant tab can reconnect and load the new URL before a refresh.
if (!customElements.get("image-lab-panel"))
  customElements.define("image-lab-panel", ImageLabPanel);
