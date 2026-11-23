import { panelStrings as strings } from "./translations.js";
import { ImageLabComparison } from "./comparison.js";

import { actionLabel } from "./action.js";
import { editModuleSettings, runProfileFlow } from "./options.js";
import { editZone } from "./zone.js";
import type { Region } from "./region.js";

type Module = "comparison" | "palette" | "object_detection";
type Source = "camera" | "media_player" | "upload";
type Rgb = [number, number, number];
type Detection = [label: string, confidence: number, xMin: number, yMin: number, xMax: number, yMax: number];
const panelPath = "/image-lab";

interface Profile {
  profile_id: string;
  title: string;
  module: Module;
  source_type: Source;
  palette_size: number | null;
  region: Region | null;
  modified_at: string;
  image_revision: string | null;
  entity_id: string | null;
  output_entity_id: string | null;
  interval_minutes: number;
  available: boolean;
}

interface HomeAssistant {
  locale: { language: string };
  states: Record<string, { attributes: { friendly_name?: string } }>;
  entities?: Record<string, unknown>;
  connection: {
    sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
    subscribeMessage(
      listener: (profiles: Profile[]) => void,
      message: { type: string },
    ): Promise<() => Promise<void>>;
  };
  callApi<T>(method: string, path: string, data?: Record<string, unknown>): Promise<T>;
  fetchWithAuth(path: string, init?: RequestInit): Promise<Response>;
}

type Message = keyof typeof strings.en;
interface AnalysisRow {
  id: string;
  name: string;
  type: string;
  source: string;
  trigger: string;
  warning: string;
}

interface AnalysisColumn {
  title: string;
  label?: string;
  flex?: number;
  minWidth: string;
  hidden?: boolean;
  showNarrow?: boolean;
  filterable: boolean;
  sortable: boolean;
  template?: (row: AnalysisRow) => Node;
}

type SortDirection = "asc" | "desc" | null;

interface AnalysisTable extends HTMLElement {
  columns: Record<string, AnalysisColumn>;
  data: AnalysisRow[];
  filter: string;
  narrow: boolean;
  sortColumn?: string;
  sortDirection: SortDirection;
  updateComplete?: Promise<unknown>;
}

interface AnalysisSortSelect extends HTMLElement {
  label: string;
  value: string;
  options: { value: string; label: string }[];
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
    #analysisList { padding-bottom: var(--ha-space-16, 64px); }
    ha-card { min-width: 0; }
    .content { padding: 16px; }
    ul { list-style: none; margin: 0; padding: 0; }
    ha-data-table { display: block; width: 100%; }
    .analysisControls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ha-space-3, 12px);
      padding: var(--ha-space-3, 12px);
      border-bottom: 1px solid var(--divider-color);
    }
    #analysisSearch { flex: 1 1 200px; min-width: 0; }
    #analysisSort { flex: 1 1 200px; min-width: 0; }
    @media (min-width: 480px) {
      #analysisSort { max-width: 240px; }
    }
    #profileNav { margin: 14px 0; }
    #profileSettings { margin-top: 18px; }
    .moduleSettingsSave { margin-top: 12px; }
    #profileConfiguration {
      --expansion-panel-summary-padding: 0 12px;
      --expansion-panel-content-padding: 0 12px;
    }
    #profileFlow { padding-block: 4px 12px; }
    #profileFlow .toolbar { margin-top: 12px; }
    .secondary { color: var(--secondary-text-color); }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    .id { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
    code { overflow-wrap: anywhere; }
    #outputEntity { max-width: 100%; }
    #outputEntity { --ha-button-label-overflow: visible; white-space: normal; overflow-wrap: anywhere; text-align: start; }
    #outputId { display: block; margin: 4px 0; }
    #schedule { margin: 8px 0; }
    #cameraSchedule { margin: 16px 0; }
    #cameraSchedule h3 { font-size: 1rem; margin: 0 0 8px; }
    #intervalControls { align-items: flex-start; }
    #intervalAction { min-height: var(--ha-space-14, 56px); }
    #interval { width: min(100%, 230px); }

    figure { margin: 16px 0 0; }
    #imageStage { position: relative; --preview-height: min(55dvh, 520px); }
    #imageStage.with-objects {
      width: min(100%, calc(var(--preview-height) * var(--image-aspect)));
      margin-inline: auto; overflow: hidden; container-type: inline-size;
      border-radius: var(--ha-border-radius-md, 8px);
    }
    img {
      display: block; width: 100%; max-height: var(--preview-height); object-fit: contain;
      background: var(--secondary-background-color); border-radius: var(--ha-border-radius-md, 8px);
    }
    #objectsOverlay { position: absolute; inset: 0; pointer-events: none; }
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
    #objectList {
      display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px;
    }
    #objectList li { margin: 0; }
    figcaption, ha-alert { margin-top: 8px; }
    #palette { margin-top: 16px; }
    #paletteTitle { font-size: 16px; font-weight: 500; margin: 0 0 8px; }
    #swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(85px, 1fr)); gap: 8px; }
    #swatches li { min-width: 0; margin: 0; }
    .swatch {
      height: 32px; margin-bottom: 4px; border: 1px solid var(--divider-color);
      border-radius: var(--ha-border-radius-md, 8px);
    }
    .dominant { display: block; font-size: 12px; }
    .zoneFrame { position:relative; touch-action:none; user-select:none; cursor:crosshair;
      width:min(100%,calc(40dvh * var(--ratio,1))); margin:8px auto; }
    .zoneFrame img { width:100%; max-height:none; }
    .selection { position:absolute; pointer-events:none; border:2px solid var(--primary-color); box-sizing:border-box;
      box-shadow:0 0 0 1px #111, inset 0 0 0 1px #111; background:color-mix(in srgb, var(--primary-color) 18%, transparent); }
    .zoneFields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .zoneFields ha-input { min-width:0; }
  </style>

  <ha-top-app-bar-fixed id="appBar">
  <ha-icon-button-arrow-prev id="back" hidden></ha-icon-button-arrow-prev>
  <div class="heading" slot="title"><img id="icon" src="/image_lab_icon.png" alt=""><h1 id="title" tabindex="-1">Image Lab</h1></div>
  <main>
    <section id="analysisList">
      <p id="listMessage" class="secondary" role="status" hidden></p>
      <ha-button id="retry" appearance="plain" variant="neutral" hidden></ha-button>
      <ha-data-table clickable auto-height hidden>
        <div class="analysisControls" slot="header">
          <ha-input-search id="analysisSearch" appearance="outlined" enterkeyhint="search"></ha-input-search>
          <ha-select id="analysisSort" value="warnings"></ha-select>
        </div>
      </ha-data-table>
    </section>
    <ha-card id="detailCard" hidden>
      <section class="content">
        <div id="profile">
          <p class="secondary" id="source"></p>
          <ha-tab-group id="profileNav" active="result">
            <ha-tab-group-tab slot="nav" panel="result" id="resultTab" aria-controls="resultPane"></ha-tab-group-tab>
            <ha-tab-group-tab slot="nav" panel="settings" id="settingsTab" aria-controls="settingsPane"></ha-tab-group-tab>
          </ha-tab-group>
          <section id="resultPane" role="tabpanel" aria-labelledby="resultTab">
            <ha-button id="test" variant="brand"></ha-button>
            <p id="status" class="secondary" role="status"></p>
            <ha-alert id="error" alert-type="error" role="alert" hidden></ha-alert>
            <section id="palette" aria-labelledby="paletteTitle" hidden>
              <h3 id="paletteTitle"></h3>
              <ul id="swatches"></ul>
          </section>
          <figure id="preview" hidden>
            <div id="imageStage">
              <img id="image" />
              <div id="objectsOverlay" aria-hidden="true"></div>
            </div>
            <figcaption id="dimensions" class="secondary"></figcaption>
          </figure>
          <ul id="objectList" hidden></ul>
          </section>
          <div id="comparisonSlot"></div>
          <section id="settingsPane" role="tabpanel" aria-labelledby="settingsTab" hidden>
            <div id="moduleSettings"></div>
            <div id="profileSettings" slot="profile-settings">
              <ha-button id="zone" appearance="outlined" hidden></ha-button>
              <section id="cameraSchedule" aria-labelledby="frequencyTitle" hidden>
                <h3 id="frequencyTitle"></h3>
                <div id="intervalControls" class="toolbar">
                  <ha-input id="interval" type="number" min="0" step="1" required></ha-input>
                  <div id="intervalAction" class="toolbar"><ha-button id="saveInterval" variant="brand"></ha-button></div>
                </div>
                <p id="frequencyHelp" class="secondary"></p>
                <p id="frequencyStatus" role="status"></p>
              </section>
              <div id="output" class="row" hidden>
                <ha-button id="outputEntity" appearance="plain" size="s"></ha-button>
                <code id="outputId" class="secondary"></code>
              </div>
              <div class="toolbar">
                <ha-button id="settings" appearance="plain" variant="neutral"></ha-button>
              </div>
              <p id="schedule" class="secondary" hidden></p>
              <p class="secondary" id="cameraZones" hidden></p>
              <div class="id">
                <span id="idLabel" class="secondary"></span>
                <code id="profileId"></code>
                <ha-button id="copy" appearance="plain" variant="neutral" size="s"></ha-button>
              </div>
              <ha-expansion-panel id="profileConfiguration" outlined>
                <div id="profileFlow"></div>
              </ha-expansion-panel>
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
  private failed = false;
  private activeTest?: AbortController;
  private previewUrl?: string;
  private optionsScope?: AbortController;
  private profileFlowScope?: AbortController;
  private moduleSettingsScope?: AbortController;
  private intervalKey?: string;
  private savingInterval = false;
  private zoneScope?: AbortController;
  private strings = strings.en;
  private readonly comparison: ImageLabComparison;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.comparison = new ImageLabComparison();
    this.element("comparisonSlot").append(this.comparison);
    this.element("add").addEventListener("click", () => this.openFlow("create"));
    const configuration = this.element("profileConfiguration");
    configuration.addEventListener("expanded-changed", event => {
      if (event.target !== configuration) return;
      if ((event as CustomEvent<{ expanded: boolean }>).detail.expanded) this.editProfile();
      else this.closeProfileFlow();
    });
    this.element("saveInterval").addEventListener("click", () => void this.saveInterval());
    this.element("interval").addEventListener("input", () => {
      this.element("frequencyStatus").textContent = "";
    });
    this.element("settings").addEventListener("click", () => this.openFlow("options"));
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
    search.addEventListener("input", () => { this.analysisTable.filter = search.value; });
    this.analysisSort.addEventListener("selected", event => {
      const { value } = (event as CustomEvent<{ value: string }>).detail;
      const [column, direction] = value.split(":");
      this.analysisTable.sortColumn = direction ? column : undefined;
      this.analysisTable.sortDirection = direction === "asc" || direction === "desc" ? direction : null;
      this.analysisSort.value = value;
    });
    this.analysisTable.addEventListener("sorting-changed", event => {
      const { column, direction } = (event as CustomEvent<{ column: string; direction: SortDirection }>).detail;
      this.analysisSort.value = direction ? `${column}:${direction}` : "warnings";
    });
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
    this.element("test").addEventListener("click", () => void this.test());
    this.element("zone").addEventListener("click", () => {
      const profile = this.selected;
      if (!profile || !this._hass) return;
      this.zoneScope?.abort();
      this.zoneScope = new AbortController();
      void editZone(this.element("profile"), profile.region, this.strings,
        "/api/image_lab/zone/" + encodeURIComponent(profile.profile_id),
        this._hass.fetchWithAuth.bind(this._hass), this.zoneScope.signal);
    });
    this.element("copy").addEventListener("click", () => void this.copyId());
    this.render();
  }

  set hass(hass: HomeAssistant) {
    const previous = this._hass;
    const connectionChanged = previous?.connection !== hass.connection;
    const language = hass.locale.language.startsWith("fr") ? strings.fr : strings.en;
    const languageChanged = this.strings !== language;
    this._hass = hass;
    this.renderOutputName();
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
    this.analysisTable.narrow = value;
    this.renderAnalysisColumns();
    this.render();
  }

  set route({ path }: { path: string }) {
    const id = /^\/([a-z0-9]+)\/?$/i.exec(path)?.[1];
    if (id === this.selectedId) return;
    const previous = this.selectedId;
    const scroller = this.scrollTarget;
    if (!previous && scroller) this.listScrollTop = scroller.scrollTop;
    this.optionsScope?.abort();
    this.closeProfileFlow();
    this.closeModuleSettings();
    this.clearTest();
    this.selectedId = id;
    this.showTab("result");
    this.render(Boolean(id));
    if (!id && scroller) {
      scroller.scrollTop = this.listScrollTop;
      void this.focusListAction(previous);
    }
  }

  connectedCallback() {
    this.subscribe();
  }

  disconnectedCallback() {
    this.optionsScope?.abort();
    this.closeProfileFlow();
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

  private get analysisSort() {
    return this.element<AnalysisSortSelect>("analysisSort");
  }

  private get scrollTarget() {
    const { scrollTarget } = this.element<HTMLElement & {scrollTarget?: HTMLElement | Window}>("appBar");
    return scrollTarget instanceof HTMLElement ? scrollTarget : undefined;
  }

  private get selected(): Profile | undefined {
    return this.profiles?.find((profile) => profile.profile_id === this.selectedId);
  }

  private openFlow(mode: "create" | "options") {
    const entry = mode === "create" ? undefined : this.selected?.profile_id;
    if (!this._hass || (mode !== "create" && !entry)) return;
    this.optionsScope?.abort();
    this.optionsScope = new AbortController();
    void runProfileFlow(this.element("dialogs"), this._hass, mode, entry,
      this.strings, this.optionsScope.signal, { onCreated: id => this.select(id) });
  }

  private editProfile() {
    const profile = this.selected;
    const hass = this._hass;
    if (!profile || !hass) return;
    const scope = new AbortController();
    this.profileFlowScope?.abort();
    this.profileFlowScope = scope;
    void runProfileFlow(this.element("profileFlow"), hass, "configure", profile.profile_id,
      this.strings, scope.signal, { onClosed: () => this.closeProfileFlow() });
  }

  private closeProfileFlow() {
    const scope = this.profileFlowScope;
    this.profileFlowScope = undefined;
    scope?.abort();
    this.element("profileConfiguration").removeAttribute("expanded");
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
    editModuleSettings(this.element("moduleSettings"), hass, profile.profile_id,
      this.strings, this.moduleSettingsScope.signal);
  }

  private subscribe() {
    if (!this.isConnected || !this._hass || this.subscription) return;
    this.failed = false;
    const subscription = this._hass.connection.subscribeMessage((profiles) => {
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
      if (previous && current && (previous.modified_at !== current.modified_at ||
        previous.entity_id !== current.entity_id ||
        previous.available !== current.available)) this.clearTest();
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

  private showTab(tab: string) {
    this.element("profileNav").setAttribute("active", tab);
    this.element("resultPane").hidden = tab !== "result";
    this.element("settingsPane").hidden = tab !== "settings";
    if (tab === "settings") this.showModuleSettings();
  }

  private clearTest() {
    this.zoneScope?.abort();
    this.activeTest?.abort();
    this.activeTest = undefined;
    this.element("test").removeAttribute("loading");
    this.element("status").textContent = "";
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
    actionLabel(this.element("copy"), this.strings.copy, "content-copy");
  }

  private schedule(profile: Profile, compact = false) {
    const labels = this.strings;
    if (profile.source_type === "media_player" && profile.output_entity_id)
      return compact ? labels.artworkTrigger : labels.onArtworkChange;
    if (profile.source_type === "camera" && profile.interval_minutes)
      return labels.everyMinutes.replace("{minutes}", String(profile.interval_minutes));
    return compact ? labels.manualTrigger : labels.manual;
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
      const warning = sourceMissing ? labels.missingSource : !profile.available ? labels.profile_unavailable : "";
      return {
        id: profile.profile_id, name: profile.title, type: labels[profile.module], source, warning,
        trigger: this.schedule(profile, true),
      };
    });
    rows.sort((first, second) => Number(Boolean(second.warning)) - Number(Boolean(first.warning)));
    this.analysisTable.data = rows;
  }

  private renderAnalysisColumns() {
    const labels = this.strings;
    const narrow = this.hasAttribute("narrow");
    this.element("analysisList").setAttribute("aria-label", labels.analyses);
    this.element("analysisSearch").setAttribute("label", labels.searchAnalyses);
    const columnDefaults = { minWidth: "0", filterable: true, sortable: true };
    this.analysisTable.columns = {
      name: {
        ...columnDefaults, title: labels.nameColumn, flex: 1.6, showNarrow: true,
        template: row => this.analysisNameCell(row),
      },
      type: {
        ...columnDefaults, title: narrow ? labels.typeColumnShort : labels.typeColumn,
        label: labels.typeColumn, showNarrow: true,
        template: row => {
          const type = document.createElement("span");
          type.style.cssText = "white-space:normal;overflow-wrap:anywhere;line-height:1.2";
          type.textContent = row.type;
          return type;
        },
      },
      source: { ...columnDefaults, title: labels.sourceColumn, hidden: narrow },
      trigger: { ...columnDefaults, title: labels.triggerColumn, hidden: narrow },
    };
    this.analysisSort.label = labels.sortBy;
    this.analysisSort.options = [
      { value: "warnings", label: labels.warningsFirst },
      ...Object.entries(this.analysisTable.columns).flatMap(([key, { title, label = title }]) => [
        { value: `${key}:asc`, label: `${label} (A–Z)` },
        { value: `${key}:desc`, label: `${label} (Z–A)` },
      ]),
    ];
  }

  private analysisNameCell(row: AnalysisRow) {
    // Keep a native keyboard target on Home Assistant versions that only handle row clicks.
    const narrow = this.hasAttribute("narrow");
    const name = document.createElement("div");
    name.style.cssText = "min-width:0;max-width:100%;line-height:1.2";
    const action = document.createElement("ha-button");
    action.id = `analysis-${row.id}`;
    action.style.cssText = "display:block;width:fit-content;max-width:100%;text-align:start";
    action.setAttribute("appearance", "plain");
    action.setAttribute("size", narrow ? "xs" : "s");
    action.textContent = row.name;
    action.title = row.name;
    action.onclick = () => this.select(row.id);
    name.append(action);
    const metadata = row.warning ? [row.warning] : narrow ? [row.source, row.trigger] : [];
    for (const label of metadata) {
      const details = document.createElement("span");
      details.style.cssText = "display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        + "font-size:12px;line-height:13px;color:var(--secondary-text-color)";
      details.textContent = label;
      details.title = label;
      if (row.warning) {
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:alert-outline");
        icon.setAttribute("aria-hidden", "true");
        icon.style.cssText = "--mdc-icon-size:14px;color:var(--warning-color);margin-inline-end:4px";
        details.prepend(icon);
      }
      name.append(details);
    }
    return name;
  }

  private render(moveFocus = false) {
    const labels = this.strings;
    for (const [id, message] of Object.entries({
      idLabel: labels.id, paletteTitle: labels.palette, resultTab: labels.resultTab, settingsTab: labels.settingsTab,
      frequencyTitle: labels.frequencyTitle, frequencyHelp: labels.frequencyHelp,
    })) {
      this.element(id).textContent = message;
    }
    const actions = {
      add: [labels.add, "plus"],
      retry: [labels.retry, "refresh"],
      copy: [labels.copy, "content-copy"],
      settings: [labels.settings, "chart-box-outline"],
      saveInterval: [labels.save, "content-save-outline"],
      test: [labels.test, "play-outline"],
      zone: [labels.zone, "crop"],
    };
    for (const [id, [label, icon]] of Object.entries(actions))
      actionLabel(this.element(id), label, icon);
    this.element("profileConfiguration").setAttribute("header", labels.profileConfiguration);

    const profile = this.selected;
    const detail = this.element("detailCard");
    const opened = detail.hidden || moveFocus;
    detail.hidden = !profile;
    this.element("analysisList").hidden = Boolean(profile);
    this.shadowRoot!.querySelector("main")!.classList.toggle("with-detail", Boolean(profile));
    this.element("add").hidden = Boolean(profile);
    this.element("icon").hidden = Boolean(profile);
    const back = this.element("back");
    back.hidden = !profile;
    back.slot = profile ? "navigationIcon" : "";
    back.setAttribute("label", labels.back);
    const title = this.element("title");
    title.textContent = profile?.title ?? "Image Lab";
    title.title = title.textContent;
    this.analysisTable.hidden = !this.profiles?.length;
    this.element("retry").hidden = !this.failed;
    const message = this.element("listMessage");
    message.textContent = this.failed ? labels.loadError :
      !this.profiles ? labels.loading : this.profiles.length === 0 ? labels.empty : "";
    message.hidden = !message.textContent;

    const isComparison = profile?.module === "comparison";
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
    this.element("resultPane").hidden = isComparison || tab === "settings";
    this.element("settingsPane").hidden = isComparison || tab !== "settings";
    if (!isComparison && tab === "settings") this.showModuleSettings();
    if (!profile) return;
    const camera = profile.source_type === "camera";
    const interval = this.element<HTMLElement & {value: string}>("interval");
    this.element("cameraSchedule").hidden = !camera;
    if (camera) {
      interval.setAttribute("label", labels.intervalLabel);
      const key = `${profile.profile_id}/${profile.interval_minutes}`;
      if (key !== this.intervalKey) {
        this.intervalKey = key;
        interval.value = String(profile.interval_minutes);
        this.element("frequencyStatus").textContent = "";
      }
    } else {
      this.intervalKey = undefined;
    }
    this.element("zone").hidden = !camera || isComparison;
    const cameraZones = this.element("cameraZones");
    cameraZones.hidden = profile.source_type !== "camera";
    if (!cameraZones.hidden) {
      const others = this.profiles?.filter(p => p.source_type === "camera" && p.entity_id === profile.entity_id && p !== profile) ?? [];
      cameraZones.hidden = !others.length;
      cameraZones.textContent = labels.cameraZones;
      for (const p of others) {
        const button = document.createElement("ha-button");
        button.setAttribute("appearance", "plain");
        button.setAttribute("size", "s");
        actionLabel(button, p.title, "crop");
        button.onclick = () => this.select(p.profile_id);
        cameraZones.append(button);
      }
    }
    this.element("profileId").textContent = profile.profile_id;
    this.element("output").hidden = !profile.output_entity_id;
    this.renderOutputName();
    const schedule = this.element("schedule");
    schedule.hidden = profile.source_type === "upload";
    schedule.textContent = this.schedule(profile);
    const source = [labels[profile.module], labels[profile.source_type], profile.entity_id];
    this.element("source").textContent = source.filter(Boolean).join(" · ");
    this.element("test").toggleAttribute("disabled", !profile.available || Boolean(this.activeTest));
    if (opened) {
      const scroller = this.scrollTarget;
      if (scroller) scroller.scrollTop = 0;
      title.focus({ preventScroll: true });
    }
  }

  private async saveInterval() {
    const profile = this.selected;
    const hass = this._hass;
    if (!hass || profile?.source_type !== "camera" || this.savingInterval) return;
    const field = this.element<HTMLElement & {value: string; reportValidity(): boolean}>("interval");
    const minutes = Number(field.value);
    const status = this.element("frequencyStatus");
    if (!field.reportValidity() || !Number.isSafeInteger(minutes) || minutes < 0) {
      status.textContent = this.strings.invalidFrequency;
      return;
    }
    const button = this.element("saveInterval");
    this.savingInterval = true;
    button.setAttribute("loading", "");
    field.setAttribute("disabled", "");
    try {
      await hass.connection.sendMessagePromise({
        type: "image_lab/set_schedule", profile_id: profile.profile_id, interval_minutes: minutes,
      });
      if (this.selectedId === profile.profile_id) status.textContent = this.strings.frequencySaved;
    } catch {
      if (this.selectedId === profile.profile_id) status.textContent = this.strings.optionsError;
    } finally {
      this.savingInterval = false;
      button.removeAttribute("loading");
      field.removeAttribute("disabled");
    }
  }

  private renderOutputName() {
    const id = this.selected?.output_entity_id;
    if (!id) return;
    const name = this._hass?.states[id]?.attributes.friendly_name;
    actionLabel(this.element("outputEntity"), name || id, "information-outline");
    const identifier = this.element("outputId");
    identifier.hidden = !name || name === id;
    if (identifier.textContent !== id) identifier.textContent = id;
  }

  private showError(message: Message) {
    const error = this.element("error");
    error.textContent = this.strings[message];
    error.hidden = false;
  }

  private async copyId() {
    const profile = this.selected;
    if (!profile) return;
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
      if (profile.profile_id === this.selectedId)
        actionLabel(this.element("copy"), this.strings.copied, "check");
    } catch {
      if (profile.profile_id === this.selectedId) this.showError("copyError");
    }
  }

  private showPalette(colors: Rgb[]) {
    const swatches = colors.map((rgb, index) => {
      const row = document.createElement("li");
      const swatch = document.createElement("div");
      const code = document.createElement("code");
      const hex = `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
      swatch.className = "swatch";
      swatch.style.backgroundColor = hex;
      code.textContent = hex;
      row.append(swatch, code);
      if (index === 0) {
        const label = document.createElement("span");
        label.className = "dominant secondary";
        label.textContent = this.strings.dominant;
        row.append(label);
      }
      return row;
    });
    this.element("swatches").replaceChildren(...swatches);
    this.element("palette").hidden = false;
  }

  private showObjects(objects: Detection[], truncated: boolean, resources: Record<string, string>, language: string) {
    const list: HTMLLIElement[] = [];
    const boxes = objects.map(([label, score, xMin, yMin, xMax, yMax]) => {
      const name = resources[`component.image_lab.selector.object_labels.options.${label}`]
        ?? label.replaceAll("_", " ");
      const confidence = score.toLocaleString(language, { style: "percent" });
      const box = document.createElement("div");
      box.className = "object-box";
      box.style.setProperty("--label-left", `${xMin * 100}cqw`);
      box.style.left = `${xMin * 100}%`;
      box.style.top = `${yMin * 100}%`;
      box.style.width = `${(xMax - xMin) * 100}%`;
      box.style.height = `${(yMax - yMin) * 100}%`;
      const caption = document.createElement("span");
      caption.textContent = name;
      box.append(caption);
      const item = document.createElement("li");
      item.textContent = `${name} · ${confidence}`;
      list.push(item);
      return box;
    });
    this.element("objectsOverlay").replaceChildren(...boxes);
    const results = this.element("objectList");
    results.replaceChildren(...list);
    results.hidden = !objects.length;

    const count = objects.length;
    const summary = count === 0 ? this.strings.noObjects :
      count === 1 ? this.strings.objectFound : `${count} ${this.strings.objectsFound}`;
    return truncated ? `${summary} · ${this.strings.objectLimit}` : summary;
  }

  private async test() {
    const profile = this.selected;
    const hass = this._hass;
    if (!profile?.available || !hass || this.activeTest) return;

    this.clearTest();
    const controller = new AbortController();
    this.activeTest = controller;
    this.element("test").setAttribute("loading", "");
    const status = this.element("status");
    const isDetection = profile.module === "object_detection";
    status.textContent = isDetection ? this.strings.detecting : this.strings.testing;
    let summary = "";

    try {
      const response = await hass.fetchWithAuth(
        `/api/image_lab/preview/${encodeURIComponent(profile.profile_id)}`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (response.status === 422) {
        const { reason } = await response.json();
        if (!controller.signal.aborted) {
          this.showError(Object.hasOwn(this.strings, reason) ? reason : "testError");
        }
        return;
      }
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) {
        throw new Error("Preview response was not an image");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;

      const width = response.headers.get("X-Image-Lab-Width");
      const height = response.headers.get("X-Image-Lab-Height");
      if (isDetection) {
        const objects = JSON.parse(response.headers.get("X-Image-Lab-Objects") ?? "null") as Detection[] | null;
        if (!Array.isArray(objects) || Number(width) <= 0 || Number(height) <= 0) {
          throw new Error("Preview response had no detection result");
        }
        const language = hass.locale.language;
        const { resources } = objects.length
          ? await hass.connection.sendMessagePromise<{ resources: Record<string, string> }>({
              type: "frontend/get_translations", language, category: "selector",
              integration: ["image_lab"],
            }).catch(() => ({ resources: {} }))
          : { resources: {} };
        if (controller.signal.aborted) return;
        const stage = this.element("imageStage");
        stage.style.setProperty("--image-aspect", String(Number(width) / Number(height)));
        stage.classList.add("with-objects");
        summary = this.showObjects(
          objects, response.headers.get("X-Image-Lab-Objects-Truncated") === "1", resources, language,
        );
      } else {
        const colors = JSON.parse(response.headers.get("X-Image-Lab-Palette-Rgb") ?? "null") as Rgb[] | null;
        if (!colors?.length) throw new Error("Preview response had no palette");
        this.showPalette(colors);
        summary = this.strings.paletteReady;
      }
      this.previewUrl = URL.createObjectURL(blob);
      const image = this.element<HTMLImageElement>("image");
      image.src = this.previewUrl;
      image.alt = this.strings.preview;
      const format = blob.type.split("/")[1]?.toUpperCase();
      this.element("dimensions").textContent = `${width} × ${height} px · ${format}`;
      this.element("preview").hidden = false;
    } catch {
      if (!controller.signal.aborted) this.showError("testError");
    } finally {
      if (this.activeTest === controller) {
        this.activeTest = undefined;
        this.element("test").removeAttribute("loading");
        this.element("test").toggleAttribute("disabled", !this.selected?.available);
        status.textContent = this.previewUrl ? summary : "";
      }
    }
  }
}

customElements.define("image-lab-panel", ImageLabPanel);
