import { panelStrings as strings } from "./translations.js";
import { ImageLabComparison } from "./comparison.js";
import { actionLabel } from "./action.js";
import { runProfileFlow } from "./options.js";
import { editZone } from "./zone.js";
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display: block; height: 100%; max-height: 100dvh; overflow: auto; color: var(--primary-text-color); }
    [hidden] { display: none !important; }
    header {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      min-height: var(--header-height, 56px); padding: 0 16px 0 4px;
      background: var(--app-header-background-color); color: var(--app-header-text-color);
    }
    .heading { display: flex; align-items: center; gap: 12px; }
    .heading img { width: 26px; height: 26px; background: none; }
    header h1 { margin: 0; font-size: 20px; font-weight: 500; white-space: nowrap; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    main {
      display: grid; grid-template-columns: minmax(0, 1fr);
      align-items: start; gap: 16px; max-width: 960px; padding: 16px; margin: 0 auto;
    }
    ha-card { min-width: 0; }
    .content { padding: 16px; }
    h2 { margin: 0 0 12px; font-size: 20px; font-weight: 500; overflow-wrap: anywhere; }
    ul { list-style: none; margin: 0; padding: 0; }
    #analysisList { container-type: inline-size; }
    #analysisTable { width: 100%; table-layout: fixed; border-collapse: collapse; }
    #analysisTable :is(th, td) {
      padding: 8px 12px; text-align: start; overflow-wrap: anywhere;
      border-bottom: 1px solid var(--divider-color);
    }
    #analysisTable th { font-weight: 500; color: var(--secondary-text-color); }
    #analysisTable th:first-child { width: 32%; }
    #analysisTable tbody tr { cursor: pointer; }
    #analysisTable tbody tr:hover { background: var(--secondary-background-color); }
    #analysisTable tbody tr:last-child td { border-bottom: 0; }
    .analysis-link {
      display: block; width: fit-content; max-width: 100%; margin-inline-start: -8px;
      --ha-button-label-overflow: visible; white-space: normal; text-align: start;
    }
    .compact-details, .source-warning { font-size: 12px; }
    .compact-details { display: none; }
    .source-warning { display: flex; align-items: center; gap: 4px; }
    .source-warning ha-icon { flex: none; --mdc-icon-size: 16px; color: var(--warning-color); }
    @container (max-width: 600px) {
      #analysisTable th:first-child { width: 58%; }
      #analysisTable :is(th, td):nth-child(n+3) { display: none; }
      .compact-details { display: block; }
    }
    #back { justify-self: start; }
    #profileNav { margin: 14px 0; }
    #profileSettings { margin-bottom: 18px; }
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
    .selection { position:absolute; pointer-events:none; border:2px solid #28d7cd; box-sizing:border-box;
      box-shadow:0 0 0 1px #111, inset 0 0 0 1px #111; background:#28d7cd22; }
    .zoneFields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .zoneFields ha-input { min-width:0; }
    :host([narrow]) main { grid-template-columns: minmax(0, 1fr); padding: 12px; }
    @media (max-width: 400px) {
      header { padding-inline-end: 8px; }
      .heading { gap: 4px; }
      header h1 { font-size: 18px; }
      #add { min-width: 0; }
    }
  </style>

  <header>
    <div class="heading"><ha-menu-button></ha-menu-button><img src="/image_lab_icon.png" alt=""><h1>Image Lab</h1></div>
    <ha-button id="add" variant="brand"></ha-button>
  </header>
  <main>
    <section id="analysisList">
      <p id="listMessage" class="secondary" role="status" hidden></p>
      <ha-button id="retry" appearance="plain" variant="neutral" hidden></ha-button>
      <ha-card id="listCard" hidden>
        <table id="analysisTable">
          <thead>
            <tr>
              <th scope="col" id="nameColumn"></th>
              <th scope="col" id="typeColumn"></th>
              <th scope="col" id="sourceColumn"></th>
              <th scope="col" id="triggerColumn"></th>
            </tr>
          </thead>
          <tbody id="analysisRows"></tbody>
        </table>
      </ha-card>
    </section>
    <ha-button id="back" appearance="plain" variant="neutral" hidden></ha-button>
    <ha-card id="detailCard" hidden>
      <section class="content">
        <div id="profile">
          <h2 id="title" tabindex="-1"></h2>
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
            <div id="profileSettings" slot="profile-settings">
              <div class="toolbar">
                <ha-button id="configure" appearance="outlined"></ha-button>
                <ha-button id="zone" appearance="outlined" hidden></ha-button>
              </div>
              <section id="cameraSchedule" aria-labelledby="frequencyTitle" hidden>
                <h3 id="frequencyTitle"></h3>
                <div class="toolbar">
                  <ha-input id="interval" type="number" min="0" step="1" required></ha-input>
                  <ha-button id="saveInterval" variant="brand"></ha-button>
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
            </div>
          </section>
        </div>
      </section>
    </ha-card>
  </main>
  <div id="dialogs"></div>
`;
class ImageLabPanel extends HTMLElement {
    _hass;
    profiles;
    selectedId;
    listScrollTop = 0;
    subscription;
    failed = false;
    activeTest;
    previewUrl;
    optionsScope;
    intervalKey;
    savingInterval = false;
    zoneScope;
    strings = strings.en;
    comparison;
    constructor() {
        super();
        this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
        this.comparison = new ImageLabComparison();
        this.element("comparisonSlot").append(this.comparison);
        this.element("add").addEventListener("click", () => this.openFlow("create"));
        this.element("configure").addEventListener("click", () => this.openFlow("configure"));
        this.element("saveInterval").addEventListener("click", () => void this.saveInterval());
        this.element("interval").addEventListener("input", () => {
            this.element("frequencyStatus").textContent = "";
        });
        this.element("settings").addEventListener("click", () => this.openFlow("options"));
        this.element("retry").addEventListener("click", () => this.subscribe());
        this.element("back").addEventListener("click", () => this.showList());
        this.element("profileNav").addEventListener("wa-tab-show", event => {
            this.showTab(event.detail.name);
        });
        this.element("outputEntity").addEventListener("click", () => {
            const entityId = this.selected?.output_entity_id;
            if (entityId)
                this.dispatchEvent(new CustomEvent("hass-more-info", {
                    detail: { entityId }, bubbles: true, composed: true,
                }));
        });
        this.element("test").addEventListener("click", () => void this.test());
        this.element("zone").addEventListener("click", () => {
            const profile = this.selected;
            if (!profile || !this._hass)
                return;
            this.zoneScope?.abort();
            this.zoneScope = new AbortController();
            void editZone(this.element("profile"), profile.region, this.strings, "/api/image_lab/zone/" + encodeURIComponent(profile.profile_id), this._hass.fetchWithAuth.bind(this._hass), this.zoneScope.signal);
        });
        this.element("copy").addEventListener("click", () => void this.copyId());
        this.render();
    }
    set hass(hass) {
        const previous = this._hass;
        const connectionChanged = previous?.connection !== hass.connection;
        const language = hass.locale.language.startsWith("fr") ? strings.fr : strings.en;
        const languageChanged = this.strings !== language;
        this._hass = hass;
        this.renderOutputName();
        if (languageChanged) {
            this.strings = language;
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
        this.render();
    }
    connectedCallback() {
        this.subscribe();
    }
    disconnectedCallback() {
        this.optionsScope?.abort();
        this.unsubscribe();
        this.clearTest();
    }
    element(id) {
        return this.shadowRoot.getElementById(id);
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
    subscribe() {
        if (!this.isConnected || !this._hass || this.subscription)
            return;
        this.failed = false;
        const subscription = this._hass.connection.subscribeMessage((profiles) => {
            if (subscription !== this.subscription)
                return;
            const previous = this.selected;
            this.profiles = profiles;
            const current = this.selected;
            this.renderAnalysisRows();
            if (previous && !current) {
                this.showList();
                return;
            }
            if (previous && current && (previous.modified_at !== current.modified_at ||
                previous.entity_id !== current.entity_id ||
                previous.available !== current.available))
                this.clearTest();
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
        if (!this.subscription)
            return;
        void this.subscription.then((unsubscribe) => unsubscribe()).catch(() => { });
        this.subscription = undefined;
    }
    select(id) {
        if (id === this.selectedId)
            return;
        if (!this.selectedId)
            this.listScrollTop = this.scrollTop;
        this.optionsScope?.abort();
        this.clearTest();
        this.selectedId = id;
        this.showTab("result");
        this.render(true);
    }
    showList() {
        const id = this.selectedId;
        this.optionsScope?.abort();
        this.clearTest();
        this.selectedId = undefined;
        this.render();
        this.scrollTop = this.listScrollTop;
        void this.focusListAction(`analysis-${id}`);
    }
    async focusListAction(id) {
        const action = (this.shadowRoot.getElementById(id) ?? this.element("add"));
        await action.updateComplete;
        if (!this.selectedId && action.isConnected)
            action.focus({ preventScroll: true });
    }
    showTab(tab) {
        this.element("profileNav").setAttribute("active", tab);
        this.element("resultPane").hidden = tab !== "result";
        this.element("settingsPane").hidden = tab !== "settings";
    }
    clearTest() {
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
        if (this.previewUrl)
            URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = undefined;
        actionLabel(this.element("copy"), this.strings.copy, "content-copy");
    }
    schedule(profile, compact = false) {
        const labels = this.strings;
        if (profile.source_type === "media_player" && profile.output_entity_id)
            return compact ? labels.artworkTrigger : labels.onArtworkChange;
        if (profile.source_type === "camera" && profile.interval_minutes)
            return labels.everyMinutes.replace("{minutes}", String(profile.interval_minutes));
        return compact ? labels.manualTrigger : labels.manual;
    }
    renderAnalysisRows() {
        const labels = this.strings;
        const hass = this._hass;
        const rows = (this.profiles ?? []).map(profile => {
            const id = profile.entity_id;
            const state = id ? hass?.states[id] : undefined;
            const source = state?.attributes.friendly_name || id || labels[profile.source_type];
            const sourceMissing = profile.source_type !== "upload" &&
                (!id || Boolean(hass?.entities && !hass.entities[id] && !state));
            const warning = sourceMissing ? labels.missingSource : !profile.available ? labels.profile_unavailable : "";
            return { profile, source, warning };
        });
        rows.sort((first, second) => Number(Boolean(second.warning)) - Number(Boolean(first.warning)));
        const body = this.element("analysisRows");
        const focused = this.shadowRoot.activeElement?.id;
        body.replaceChildren(...rows.map(({ profile, source, warning }) => {
            const row = document.createElement("tr");
            row.onclick = () => this.select(profile.profile_id);
            const name = row.insertCell();
            const action = document.createElement("ha-button");
            action.id = `analysis-${profile.profile_id}`;
            action.className = "analysis-link";
            action.setAttribute("appearance", "plain");
            action.setAttribute("size", "s");
            action.textContent = profile.title;
            name.append(action);
            const trigger = this.schedule(profile, true);
            const details = document.createElement("span");
            details.className = "compact-details secondary";
            details.textContent = `${source} · ${trigger}`;
            name.append(details);
            if (warning) {
                const status = document.createElement("span");
                status.className = "source-warning";
                const icon = document.createElement("ha-icon");
                icon.setAttribute("icon", "mdi:alert-outline");
                icon.setAttribute("aria-hidden", "true");
                status.append(icon, warning);
                name.append(status);
            }
            row.insertCell().textContent = labels[profile.module];
            row.insertCell().textContent = source;
            row.insertCell().textContent = trigger;
            return row;
        }));
        if (focused?.startsWith("analysis-"))
            void this.focusListAction(focused);
    }
    render(moveFocus = false) {
        const labels = this.strings;
        for (const [id, message] of Object.entries({
            idLabel: labels.id, paletteTitle: labels.palette, resultTab: labels.resultTab, settingsTab: labels.settingsTab,
            frequencyTitle: labels.frequencyTitle, frequencyHelp: labels.frequencyHelp,
            nameColumn: labels.nameColumn, typeColumn: labels.typeColumn, sourceColumn: labels.sourceColumn,
            triggerColumn: labels.triggerColumn,
        })) {
            this.element(id).textContent = message;
        }
        const actions = {
            add: [labels.add, "plus"],
            back: [labels.back, "arrow-left"],
            retry: [labels.retry, "refresh"],
            copy: [labels.copy, "content-copy"],
            configure: [labels.configure, "tune-variant"],
            settings: [labels.settings, "chart-box-outline"],
            saveInterval: [labels.save, "content-save-outline"],
            test: [labels.test, "play-outline"],
            zone: [labels.zone, "crop"],
        };
        for (const [id, [label, icon]] of Object.entries(actions))
            actionLabel(this.element(id), label, icon);
        const profile = this.selected;
        const detail = this.element("detailCard");
        const opened = detail.hidden || moveFocus;
        detail.hidden = !profile;
        this.element("analysisList").hidden = Boolean(profile);
        this.element("add").hidden = Boolean(profile);
        this.element("back").hidden = !profile;
        this.element("analysisTable").setAttribute("aria-label", labels.analyses);
        this.element("listCard").hidden = !this.profiles?.length;
        this.element("retry").hidden = !this.failed;
        const message = this.element("listMessage");
        message.textContent = this.failed ? labels.loadError :
            !this.profiles ? labels.loading : this.profiles.length === 0 ? labels.empty : "";
        message.hidden = !message.textContent;
        const isComparison = profile?.module === "comparison";
        this.comparison.hidden = !isComparison;
        this.comparison.configure(this._hass, isComparison ? profile.profile_id : undefined, isComparison ? `${profile.source_type}/${profile.entity_id ?? ""}/${profile.image_revision ?? ""}` : undefined, profile?.available);
        const settings = this.element("profileSettings");
        const target = isComparison ? this.comparison : this.element("settingsPane");
        if (settings.parentElement !== target)
            target.append(settings);
        this.element("profileNav").hidden = isComparison;
        const tab = this.element("profileNav").getAttribute("active");
        this.element("resultPane").hidden = isComparison || tab === "settings";
        this.element("settingsPane").hidden = isComparison || tab !== "settings";
        if (!profile)
            return;
        const camera = profile.source_type === "camera";
        const interval = this.element("interval");
        this.element("cameraSchedule").hidden = !camera;
        if (camera) {
            interval.setAttribute("label", labels.intervalLabel);
            const key = `${profile.profile_id}/${profile.interval_minutes}`;
            if (key !== this.intervalKey) {
                this.intervalKey = key;
                interval.value = String(profile.interval_minutes);
                this.element("frequencyStatus").textContent = "";
            }
        }
        else {
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
        this.element("title").textContent = profile.title;
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
            this.scrollTop = 0;
            this.element("title").focus({ preventScroll: true });
        }
    }
    async saveInterval() {
        const profile = this.selected;
        const hass = this._hass;
        if (!hass || profile?.source_type !== "camera" || this.savingInterval)
            return;
        const field = this.element("interval");
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
            if (this.selectedId === profile.profile_id)
                status.textContent = this.strings.frequencySaved;
        }
        catch {
            if (this.selectedId === profile.profile_id)
                status.textContent = this.strings.optionsError;
        }
        finally {
            this.savingInterval = false;
            button.removeAttribute("loading");
            field.removeAttribute("disabled");
        }
    }
    renderOutputName() {
        const id = this.selected?.output_entity_id;
        if (!id)
            return;
        const name = this._hass?.states[id]?.attributes.friendly_name;
        actionLabel(this.element("outputEntity"), name || id, "information-outline");
        const identifier = this.element("outputId");
        identifier.hidden = !name || name === id;
        if (identifier.textContent !== id)
            identifier.textContent = id;
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
            if (profile.profile_id === this.selectedId)
                actionLabel(this.element("copy"), this.strings.copied, "check");
        }
        catch {
            if (profile.profile_id === this.selectedId)
                this.showError("copyError");
        }
    }
    showPalette(colors) {
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
    showObjects(objects, truncated, resources, language) {
        const list = [];
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
    async test() {
        const profile = this.selected;
        const hass = this._hass;
        if (!profile?.available || !hass || this.activeTest)
            return;
        this.clearTest();
        const controller = new AbortController();
        this.activeTest = controller;
        this.element("test").setAttribute("loading", "");
        const status = this.element("status");
        const isDetection = profile.module === "object_detection";
        status.textContent = isDetection ? this.strings.detecting : this.strings.testing;
        let summary = "";
        try {
            const response = await hass.fetchWithAuth(`/api/image_lab/preview/${encodeURIComponent(profile.profile_id)}`, { signal: controller.signal, cache: "no-store" });
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
            if (controller.signal.aborted)
                return;
            const width = response.headers.get("X-Image-Lab-Width");
            const height = response.headers.get("X-Image-Lab-Height");
            if (isDetection) {
                const objects = JSON.parse(response.headers.get("X-Image-Lab-Objects") ?? "null");
                if (!Array.isArray(objects) || Number(width) <= 0 || Number(height) <= 0) {
                    throw new Error("Preview response had no detection result");
                }
                const language = hass.locale.language;
                const { resources } = objects.length
                    ? await hass.connection.sendMessagePromise({
                        type: "frontend/get_translations", language, category: "selector",
                        integration: ["image_lab"],
                    }).catch(() => ({ resources: {} }))
                    : { resources: {} };
                if (controller.signal.aborted)
                    return;
                const stage = this.element("imageStage");
                stage.style.setProperty("--image-aspect", String(Number(width) / Number(height)));
                stage.classList.add("with-objects");
                summary = this.showObjects(objects, response.headers.get("X-Image-Lab-Objects-Truncated") === "1", resources, language);
            }
            else {
                const colors = JSON.parse(response.headers.get("X-Image-Lab-Palette-Rgb") ?? "null");
                if (!colors?.length)
                    throw new Error("Preview response had no palette");
                this.showPalette(colors);
                summary = this.strings.paletteReady;
            }
            this.previewUrl = URL.createObjectURL(blob);
            const image = this.element("image");
            image.src = this.previewUrl;
            image.alt = this.strings.preview;
            const format = blob.type.split("/")[1]?.toUpperCase();
            this.element("dimensions").textContent = `${width} × ${height} px · ${format}`;
            this.element("preview").hidden = false;
        }
        catch {
            if (!controller.signal.aborted)
                this.showError("testError");
        }
        finally {
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
