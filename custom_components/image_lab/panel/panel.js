import { panelStrings as strings } from "./translations.js";
import { ImageLabComparison } from "./comparison.js";
import { actionLabel } from "./action.js";
import { runProfileFlow } from "./options.js";
import { editZone } from "./zone.js";
const moduleIcons = {
    comparison: "image-multiple-outline", palette: "palette-outline", object_detection: "image-search-outline",
};
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display: block; height: 100%; overflow: auto; color: var(--primary-text-color); }
    [hidden] { display: none !important; }
    header {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      min-height: var(--header-height, 56px); padding: 0 16px 0 4px;
      background: var(--app-header-background-color); color: var(--app-header-text-color);
    }
    .heading { display: flex; align-items: center; gap: 12px; }
    .heading img { width: 26px; height: 26px; background: none; }
    header h1 { margin: 0; font-size: 20px; font-weight: 500; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    main {
      display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      align-items: start; gap: 16px; max-width: 1280px; padding: 16px; margin: 0 auto;
    }
    ha-card { min-width: 0; }
    .content { padding: 16px; }
    h2 { margin: 0 0 12px; font-size: 20px; font-weight: 500; overflow-wrap: anywhere; }
    ul { list-style: none; margin: 0; padding: 0; }
    li + li { margin-top: 4px; }
    li button {
      display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center;
      gap: 4px 10px; width: 100%; padding: 12px; border: 0;
      border-radius: var(--ha-border-radius-md, 8px); background: none;
      color: inherit; font: inherit; text-align: start; cursor: pointer;
      overflow-wrap: anywhere;
    }
    li button:hover, li button[aria-current="true"] {
      background: var(--secondary-background-color);
    }
    li button[aria-current="true"] { box-shadow: inset 3px 0 var(--primary-color); }
    li button ha-icon { grid-row: span 2; }
    li button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
    .secondary { color: var(--secondary-text-color); }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    .id { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
    code { overflow-wrap: anywhere; }
    #outputEntity { max-width: 100%; }
    #outputEntity { --ha-button-label-overflow: visible; white-space: normal; overflow-wrap: anywhere; text-align: start; }
    #outputId { display: block; margin: 4px 0; }
    #schedule { margin: 8px 0; }
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
    #back { margin-bottom: 10px; }
    :host([narrow]) main { grid-template-columns: minmax(0, 1fr); padding: 12px; }
    @media (max-width: 400px) { header { padding-inline-end: 8px; } .heading { gap: 4px; } }
  </style>

  <header>
    <div class="heading"><ha-menu-button></ha-menu-button><img src="/image_lab_icon.png" alt=""><h1>Image Lab</h1></div>
    <ha-button id="add" variant="brand"></ha-button>
  </header>
  <main>
    <ha-card id="listCard">
      <section class="content" aria-labelledby="listTitle">
        <h2 id="listTitle"></h2>
        <p id="listMessage" class="secondary" role="status"></p>
        <ha-button id="retry" appearance="plain" variant="neutral" hidden></ha-button>
        <ul id="list"></ul>
      </section>
    </ha-card>
    <ha-card id="detailCard">
      <section class="content">
        <ha-button id="back" appearance="plain" variant="neutral" hidden></ha-button>
        <p id="selectMessage" class="secondary" role="status"></p>
        <div id="profile" hidden>
          <h2 id="title" tabindex="-1"></h2>
          <p class="secondary" id="source"></p>
          <div id="output" class="row" hidden>
            <ha-button id="outputEntity" appearance="plain" size="s"></ha-button>
            <code id="outputId" class="secondary"></code>
          </div>
          <div class="toolbar">
            <ha-button id="test" variant="brand"></ha-button>
            <ha-button id="configure" appearance="outlined"></ha-button>
            <ha-button id="zone" appearance="outlined" hidden></ha-button>
            <ha-button id="settings" appearance="plain" variant="neutral"></ha-button>
          </div>
          <p id="schedule" class="secondary" hidden></p>
          <p class="secondary" id="cameraZones" hidden></p>
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
          <div id="comparisonSlot"></div>
          <div class="id">
            <span id="idLabel" class="secondary"></span>
            <code id="profileId"></code>
            <ha-button id="copy" appearance="plain" variant="neutral" size="s"></ha-button>
          </div>
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
    subscription;
    failed = false;
    activeTest;
    previewUrl;
    optionsScope;
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
        this.element("settings").addEventListener("click", () => this.openFlow("options"));
        this.element("retry").addEventListener("click", () => this.subscribe());
        this.element("back").addEventListener("click", () => {
            this.select();
            this.element("list").querySelector("button")?.focus();
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
        const connectionChanged = this._hass?.connection !== hass.connection;
        const language = hass.locale.language.startsWith("fr") ? strings.fr : strings.en;
        this._hass = hass;
        this.renderOutputName();
        if (this.strings !== language) {
            this.strings = language;
            this.render();
        }
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
        void runProfileFlow(this.element("dialogs"), this._hass, mode, entry, this.strings, this.optionsScope.signal, id => {
            this.clearTest();
            this.selectedId = id;
            this.render();
        });
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
            if (previous && (!current || previous.modified_at !== current.modified_at ||
                previous.entity_id !== current.entity_id ||
                previous.available !== current.available)) {
                this.clearTest();
            }
            if (previous && !current) {
                this.optionsScope?.abort();
                this.selectedId = undefined;
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
        if (!this.subscription)
            return;
        void this.subscription.then((unsubscribe) => unsubscribe()).catch(() => { });
        this.subscription = undefined;
    }
    select(profile) {
        this.optionsScope?.abort();
        this.clearTest();
        this.selectedId = profile?.profile_id;
        this.render();
        if (profile && this.hasAttribute("narrow"))
            this.element("title").focus();
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
    render() {
        const labels = this.strings;
        for (const [id, message] of Object.entries({
            listTitle: labels.profiles, idLabel: labels.id, selectMessage: labels.select, paletteTitle: labels.palette,
        })) {
            this.element(id).textContent = message;
        }
        const actions = {
            add: [labels.add, "plus"],
            retry: [labels.retry, "refresh"],
            back: [labels.back, "arrow-left"],
            copy: [labels.copy, "content-copy"],
            configure: [labels.configure, "tune-variant"],
            settings: [this.selected?.source_type === "upload" ? labels.resultEntity : labels.settings, "clock-outline"],
            test: [labels.test, "play-outline"],
            zone: [labels.zone, "crop"],
        };
        for (const [id, [label, icon]] of Object.entries(actions))
            actionLabel(this.element(id), label, icon);
        const profile = this.selected;
        const narrow = this.hasAttribute("narrow");
        this.element("listCard").hidden = narrow && Boolean(profile);
        this.element("detailCard").hidden = !profile && (narrow || !this.profiles?.length);
        this.element("back").hidden = !narrow || !profile;
        this.element("profile").hidden = !profile;
        this.element("selectMessage").hidden = Boolean(profile) || !this.profiles?.length;
        this.element("retry").hidden = !this.failed;
        this.element("listMessage").textContent = this.failed ? labels.loadError :
            !this.profiles ? labels.loading : this.profiles.length === 0 ? labels.empty : "";
        const rows = (this.profiles ?? []).map((item) => {
            const row = document.createElement("li");
            const button = document.createElement("button");
            const title = document.createElement("strong");
            const module = document.createElement("span");
            const icon = document.createElement("ha-icon");
            icon.setAttribute("icon", `mdi:${moduleIcons[item.module]}`);
            icon.setAttribute("aria-hidden", "true");
            button.type = "button";
            button.setAttribute("aria-current", String(item.profile_id === this.selectedId));
            button.addEventListener("click", () => this.select(item));
            title.textContent = item.title;
            module.className = "secondary";
            module.textContent = labels[item.module];
            button.append(icon, title, module);
            row.append(button);
            return row;
        });
        this.element("list").replaceChildren(...rows);
        const isComparison = profile?.module === "comparison";
        this.comparison.hidden = !isComparison;
        this.comparison.configure(this._hass, isComparison ? profile.profile_id : undefined, isComparison ? `${profile.source_type}/${profile.entity_id ?? ""}/${profile.image_revision ?? ""}` : undefined, profile?.available);
        this.element("test").hidden = isComparison;
        if (!profile)
            return;
        this.element("zone").hidden = profile.source_type !== "camera" || isComparison;
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
                button.onclick = () => this.select(p);
                cameraZones.append(button);
            }
        }
        this.element("title").textContent = profile.title;
        this.element("profileId").textContent = profile.profile_id;
        this.element("output").hidden = !profile.output_entity_id;
        this.renderOutputName();
        const schedule = this.element("schedule");
        schedule.hidden = profile.source_type === "upload";
        schedule.textContent = profile.source_type === "media_player" && profile.output_entity_id
            ? labels.onArtworkChange : profile.interval_minutes
            ? labels.everyMinutes.replace("{minutes}", String(profile.interval_minutes)) : labels.manual;
        const source = [labels[profile.module], labels[profile.source_type], profile.entity_id];
        this.element("source").textContent = source.filter(Boolean).join(" · ");
        this.element("test").toggleAttribute("disabled", !profile.available || Boolean(this.activeTest));
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
