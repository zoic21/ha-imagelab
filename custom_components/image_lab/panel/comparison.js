const text = {
    en: {
        preview: "Preview",
        references: "References",
        settings: "Settings",
        test: "Test source",
        drawing: "Draw the region on the image",
        draw: "Draw region",
        whole: "Use the full image",
        empty: "Test the source to preview the image.",
        unavailable: "The image source is unavailable.",
        working: "Working…",
        recognized: "Recognized state",
        unknown: "Unknown state",
        expected: "Expected state",
        closest: "Closest reference",
        view_reference: "View reference",
        score: "Distance",
        gap: "Margin",
        count: "References",
        state: "State",
        no_states: "Add a state to classify images.",
        new_state: "New state",
        add_state: "Add state",
        rename: "Rename",
        remove: "Remove",
        upload: "Import images",
        folder: "Import folders by state",
        folder_help: "Choose a directory with one subfolder per state.",
        training: "Reference images",
        validation: "Validation images",
        test_image: "Evaluate",
        move: "Move",
        classify: "Classify capture",
        capture: "Capture",
        capture_saved: "Capture classified.",
        max_distance: "Maximum distance",
        min_margin: "Minimum margin",
        thresholds: "Scores range from 0 to 255. A lower distance means a closer match.",
        crop: "Region in percent",
        x: "Left",
        y: "Top",
        width: "Width",
        height: "Height",
        region_help: "Leave all four fields blank to compare the full image.",
        save: "Save settings",
        saved: "Settings saved.",
        dirty: "Unsaved settings are used for tests.",
        no_references: "No usable reference images. Add images to one or more states.",
        ambiguous: "The two closest states are too close to decide.",
        distance_too_high: "The closest reference exceeds the maximum distance.",
        source_unavailable: "The image source is unavailable.",
        source_no_image: "The source returned no image.",
        capture_expired: "The capture expired. Test the source again.",
        duplicate_state: "A state with that name already exists.",
        state_not_empty: "Move or remove the images before deleting the state.",
        profile_unavailable: "This analysis is unavailable.",
        profile_not_found: "This analysis was removed.",
        image_missing: "This analysis has no imported source image.",
        invalid_image: "Choose still JPEG, PNG or WebP images.",
        image_too_large: "The image exceeds 10 MiB or 24 megapixels.",
        invalid_request: "Check the entered values. The state name “unknown” is reserved.",
        invalid_settings: "Check the thresholds and select a region within the image.",
        storage_error: "The gallery could not be saved or read.",
        failed: "The operation could not be completed.",
        confirm_remove: "Remove this image from the gallery?",
        confirm_state: "Remove this state?",
        imported: "Images imported",
        rejected: "Failed imports",
        choose_state: "Choose a state",
        reload: "Reload",
        stop_draw: "Finish drawing",
    },
    fr: {
        preview: "Aperçu",
        references: "Références",
        settings: "Réglages",
        test: "Tester la source",
        drawing: "Tracez la zone sur l’image",
        draw: "Tracer la zone",
        whole: "Utiliser toute l’image",
        empty: "Testez la source pour afficher son image.",
        unavailable: "La source d’image est indisponible.",
        working: "En cours…",
        recognized: "État reconnu",
        unknown: "État indéterminé",
        expected: "État attendu",
        closest: "Référence la plus proche",
        view_reference: "Voir la référence",
        score: "Distance",
        gap: "Écart",
        count: "Références",
        state: "État",
        no_states: "Ajoutez un état pour classer des images.",
        new_state: "Nouvel état",
        add_state: "Ajouter un état",
        rename: "Renommer",
        remove: "Supprimer",
        upload: "Importer des images",
        folder: "Importer les dossiers par état",
        folder_help: "Choisissez un dossier qui contient un sous-dossier par état.",
        training: "Images de référence",
        validation: "Images de validation",
        test_image: "Évaluer",
        move: "Déplacer",
        classify: "Classer la capture",
        capture: "Capture",
        capture_saved: "Capture classée.",
        max_distance: "Distance maximale",
        min_margin: "Écart minimal",
        thresholds: "Les distances vont de 0 à 255. Une distance basse indique une image plus proche.",
        crop: "Zone en pourcentage",
        x: "Gauche",
        y: "Haut",
        width: "Largeur",
        height: "Hauteur",
        region_help: "Laissez les quatre champs vides pour comparer toute l’image.",
        save: "Enregistrer les réglages",
        saved: "Réglages enregistrés.",
        dirty: "Les tests utilisent les réglages en cours d’édition.",
        no_references: "Aucune référence utilisable. Ajoutez des images à un ou plusieurs états.",
        ambiguous: "Les deux états les plus proches ont des distances trop similaires.",
        distance_too_high: "La référence la plus proche dépasse la distance maximale.",
        source_unavailable: "La source d’image est indisponible.",
        source_no_image: "La source ne fournit pas d’image.",
        capture_expired: "La capture a expiré. Relancez un test de la source.",
        duplicate_state: "Un état porte déjà ce nom.",
        state_not_empty: "Déplacez ou supprimez les images avant de supprimer l’état.",
        profile_unavailable: "Cette analyse est indisponible.",
        profile_not_found: "Cette analyse a été supprimée.",
        image_missing: "Cette analyse n’a pas d’image source importée.",
        invalid_image: "Choisissez des images fixes JPEG, PNG ou WebP.",
        image_too_large: "L’image dépasse 10 Mio ou 24 mégapixels.",
        invalid_request: "Vérifiez les valeurs saisies. Le nom d’état « unknown » est réservé.",
        invalid_settings: "Vérifiez les seuils et choisissez une zone dans l’image.",
        storage_error: "Impossible d’enregistrer ou de lire la galerie.",
        failed: "Impossible de terminer cette opération.",
        confirm_remove: "Supprimer cette image de la galerie ?",
        confirm_state: "Supprimer cet état ?",
        imported: "Images importées",
        rejected: "Imports en échec",
        choose_state: "Choisir un état",
        reload: "Recharger",
        stop_draw: "Terminer le tracé",
    },
};
const tabs = ["preview", "references", "settings"];
const coordinates = ["x", "y", "width", "height"];
const accept = "image/jpeg,image/png,image/webp";
const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display:block; margin-top: 12px; }
    [hidden] { display:none !important; }
    nav, .row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
    nav { border-bottom:1px solid var(--divider-color); margin-bottom:16px; }
    nav ha-button[aria-selected=true] { border-bottom:2px solid var(--primary-color); }
    .secondary { color:var(--secondary-text-color); font-size:.95em; }
    p { margin:8px 0; overflow-wrap:anywhere; }
    #feedback { margin:12px 0; }
    .imagebox { position:relative; margin:12px auto; width:min(100%, calc(52dvh * var(--ratio, 1))); }
    #frame { display:block; width:100%; height:auto; border-radius:var(--ha-border-radius-md, 8px); }
    .drawing { touch-action:none; cursor:crosshair; user-select:none; }
    #region { position:absolute; pointer-events:none; border:2px solid #28d7cd; box-sizing:border-box;
      box-shadow:0 0 0 1px #111, inset 0 0 0 1px #111; background:#28d7cd22; }
    #result { margin:12px 0; }
    #result > strong { display:block; font-size:1.1em; }
    table { width:100%; border-collapse:collapse; }
    td, th { padding:8px; text-align:start; border-bottom:1px solid var(--divider-color); overflow-wrap:anywhere; }
    td:nth-child(n+2), th:nth-child(n+2) { text-align:end; }
    .state { margin:14px 0; padding:12px; border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-md, 8px); }
    .state h3 { margin:0 0 8px; overflow-wrap:anywhere; }
    .state h4 { margin:12px 0 8px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr)); gap:8px; }
    .reference { display:grid; gap:6px; min-width:0; padding:8px; border-radius:var(--ha-border-radius-md, 8px);
      background:var(--secondary-background-color); overflow-wrap:anywhere; }
    .reference[data-matched=true] { outline:2px solid var(--primary-color); }
    .reference img { width:100%; height:110px; object-fit:contain; }
    fieldset { margin:12px 0; padding:12px; border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-md, 8px); }
    label { display:grid; gap:4px; margin:4px 0; }
    input:not([type=file]), select { color:var(--primary-text-color); font:inherit; min-height:36px;
      margin:0; box-sizing:border-box; max-width:100%; border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-md, 8px); padding:4px 8px; background:var(--card-background-color); }
    .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,135px),1fr)); gap:6px 12px; }
    #classify { border-top:1px solid var(--divider-color); padding-top:8px; }
    #stateMessage { margin-bottom:9px; }
  </style>
  <nav id="nav" role="tablist">
    <ha-button id="tab-preview" role="tab" aria-controls="preview" appearance="plain"></ha-button>
    <ha-button id="tab-references" role="tab" aria-controls="references" appearance="plain"></ha-button>
    <ha-button id="tab-settings" role="tab" aria-controls="settings" appearance="plain"></ha-button>
  </nav>
  <ha-alert id="feedback" hidden role="status"></ha-alert>
  <ha-button id="reload" appearance="plain" hidden></ha-button>
  <section id="preview" role="tabpanel" aria-labelledby="tab-preview">
    <div class="row">
      <ha-button id="test" variant="brand"></ha-button>
      <ha-button id="draw" appearance="plain" hidden></ha-button>
      <ha-button id="whole" appearance="plain" hidden></ha-button>
    </div>
    <p class="secondary" id="previewHint" role="status"></p>
    <div class="imagebox" id="imagebox" hidden>
      <img id="frame" draggable="false">
      <div id="region" hidden aria-hidden="true"></div>
    </div>
    <div id="result" aria-live="polite"></div>
    <div id="classify" class="row" hidden>
      <select id="captureState"></select><select id="captureGroup"></select>
      <ha-button id="captureAdd" appearance="outlined"></ha-button>
    </div>
  </section>
  <section id="references" role="tabpanel" aria-labelledby="tab-references" hidden>
    <form id="stateForm" class="row">
      <input id="stateName" required maxlength="120">
      <ha-button id="addState" variant="brand"></ha-button>
      <ha-button id="folder" appearance="plain"></ha-button>
      <input id="folderInput" type="file" webkitdirectory multiple hidden>
    </form>
    <p id="folderHint" class="secondary"></p>
    <p id="stateMessage" class="secondary"></p>
    <div id="gallery"></div>
  </section>
  <section id="settings" role="tabpanel" aria-labelledby="tab-settings" hidden>
    <p id="thresholdsHint" class="secondary"></p>
    <div id="thresholdFields" class="fields"></div>
    <fieldset><legend id="cropLabel"></legend>
      <p id="regionHint" class="secondary"></p>
      <div id="regionFields" class="fields"></div>
    </fieldset>
    <ha-button id="save" variant="brand"></ha-button>
    <p id="dirty" class="secondary"></p>
  </section>
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
    start;
    draftRegion = null;
    frameUrl;
    thumbnailUrls = [];
    thumbnailObserver;
    matchId;
    constructor() {
        super();
        this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
        for (const tab of tabs) {
            const button = this.get("tab-" + tab);
            button.addEventListener("click", () => this.show(tab));
            button.addEventListener("keydown", (event) => {
                const current = tabs.indexOf(tab);
                const next = event.key === "ArrowRight"
                    ? (current + 1) % tabs.length
                    : event.key === "ArrowLeft"
                        ? (current + tabs.length - 1) % tabs.length
                        : -1;
                if (next < 0)
                    return;
                event.preventDefault();
                this.show(tabs[next]);
                this.get("tab-" + tabs[next]).focus();
            });
        }
        this.onClick("reload", () => this.load());
        this.onClick("test", () => this.evaluate());
        this.onClick("draw", () => {
            this.drawing = !this.drawing;
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
                validation: this.get("captureGroup").value ===
                    "validation",
                capture_id: this.result.image_id,
            }, signal);
            this.captured = false;
            this.feedback(this.labels.capture_saved);
        }));
        this.get("stateForm").addEventListener("submit", (event) => {
            event.preventDefault();
            void this.task(async (signal) => {
                const input = this.get("stateName");
                await this.update("state", { name: input.value }, signal);
                input.value = "";
                this.renderGallery();
            });
        });
        this.onClick("addState", () => this.get("stateForm").requestSubmit());
        this.onClick("folder", () => this.get("folderInput").click());
        this.get("folderInput").addEventListener("change", (event) => {
            const input = event.target;
            const files = Array.from(input.files ?? []);
            input.value = "";
            if (files.length)
                void this.import(files, false);
        });
        for (const field of [
            "max_distance",
            "min_margin",
            ...coordinates,
        ]) {
            const label = document.createElement("label");
            const caption = document.createElement("span");
            caption.id = field + "-label";
            const input = document.createElement("input");
            input.type = "number";
            input.id = field;
            input.min = "0";
            input.max = coordinates.some((key) => key === field) ? "100" : "255";
            input.step = "0.01";
            input.addEventListener("input", () => {
                if (coordinates.some((key) => key === field)) {
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
            label.append(caption, input);
            this.get(coordinates.some((key) => key === field)
                ? "regionFields"
                : "thresholdFields").append(label);
        }
        const box = this.get("imagebox");
        box.addEventListener("pointerdown", (event) => {
            if (!this.drawing || this.start || event.button !== 0)
                return;
            event.preventDefault();
            box.setPointerCapture(event.pointerId);
            this.start = { ...this.point(event), pointer: event.pointerId };
        });
        box.addEventListener("pointermove", (event) => this.drawRegion(event, false));
        box.addEventListener("pointerup", (event) => this.drawRegion(event, true));
        box.addEventListener("pointercancel", () => {
            this.start = undefined;
            this.renderRegion();
        });
        const frame = this.get("frame");
        frame.addEventListener("load", () => box.style.setProperty("--ratio", String(frame.naturalWidth / frame.naturalHeight)));
        this.localize();
        this.refresh();
    }
    configure(client, profile, sourceKey, available = false) {
        const changed = profile !== this.profile ||
            sourceKey !== this.sourceKey ||
            (profile !== undefined && !this.scope && this.isConnected);
        this.client = client;
        this.profile = profile;
        this.sourceKey = sourceKey;
        this.available = available;
        const labels = client?.locale.language.startsWith("fr") ? text.fr : text.en;
        if (this.labels !== labels) {
            this.labels = labels;
            this.localize();
            this.renderResult();
            this.renderGallery();
        }
        if (changed) {
            this.reset();
            this.show("preview");
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
    localize() {
        const names = {
            test: "test",
            draw: "draw",
            whole: "whole",
            captureAdd: "classify",
            addState: "add_state",
            folder: "folder",
            folderHint: "folder_help",
            reload: "reload",
            cropLabel: "crop",
            regionHint: "region_help",
            save: "save",
            thresholdsHint: "thresholds",
        };
        for (const tab of tabs)
            names["tab-" + tab] = tab;
        for (const key of ["max_distance", "min_margin", ...coordinates])
            names[key + "-label"] = key;
        for (const [id, label] of Object.entries(names))
            this.get(id).textContent = this.labels[label];
        this.get("stateName").setAttribute("aria-label", this.labels.new_state);
        this.get("stateName").placeholder = this.labels.new_state;
        this.get("captureState").setAttribute("aria-label", this.labels.state);
        this.get("captureGroup").setAttribute("aria-label", this.labels.references);
        this.get("frame").alt = this.labels.preview;
        this.get("nav").setAttribute("aria-label", "Image Lab");
    }
    reset() {
        this.scope?.abort();
        this.scope = undefined;
        this.gallery = undefined;
        this.result = undefined;
        this.captured = false;
        this.busy = false;
        this.drawing = false;
        this.start = undefined;
        this.draftRegion = null;
        this.matchId = undefined;
        this.setFrame();
        this.clearThumbnails();
        this.get("gallery").replaceChildren();
        this.get("stateName").value = "";
        this.feedback();
        this.renderResult();
    }
    refresh() {
        this.get("preview").setAttribute("aria-busy", String(this.busy));
        this.get("test").toggleAttribute("disabled", !this.gallery || this.busy || !this.available);
        this.get("save").toggleAttribute("disabled", !this.gallery || this.busy);
        this.get("addState").toggleAttribute("disabled", !this.gallery || this.busy);
        this.get("folder").toggleAttribute("disabled", !this.gallery || this.busy);
        this.get("reload").hidden = Boolean(this.gallery) || this.busy;
        this.get("draw").hidden = !this.frameUrl;
        this.get("draw").textContent =
            this.labels[this.drawing ? "stop_draw" : "draw"];
        this.get("whole").hidden = !this.draftRegion;
        this.get("imagebox").classList.toggle("drawing", this.drawing);
        this.get("previewHint").textContent = this.busy
            ? this.labels.working
            : this.drawing
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
        for (const key of tabs) {
            this.get(key).hidden = tab !== key;
            this.get("tab-" + key).setAttribute("aria-selected", String(key === tab));
            this.get("tab-" + key).setAttribute("variant", key === tab ? "brand" : "neutral");
        }
        if (tab === "references")
            this.renderGallery();
        else
            this.clearThumbnails();
        this.refresh();
    }
    async load() {
        if (!this.profile || !this.client)
            return;
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
                this.refresh();
            }
        }
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
        this.stateOptions(this.get("captureState"));
        this.groupOptions(this.get("captureGroup"));
    }
    stateOptions(select, state) {
        const selected = state ?? select.value;
        select.replaceChildren(...(this.gallery?.states ?? []).map((item) => new Option(item.name, item.id, false, item.id === selected)));
    }
    groupOptions(select, validation = false) {
        select.replaceChildren(new Option(this.labels.training, "training"), new Option(this.labels.validation, "validation"));
        select.value = validation ? "validation" : "training";
    }
    async evaluate(reference_id) {
        await this.task(async (signal) => {
            const settings = this.readSettings();
            this.setFrame();
            this.captured = false;
            this.result = undefined;
            this.drawing = false;
            this.renderResult();
            this.show("preview");
            const result = await this.request("/test", signal, {
                settings,
                ...(reference_id && { reference_id }),
            });
            this.result = result;
            this.matchId = result.data.reference_id ?? undefined;
            this.renderResult();
            if (result.image_id) {
                const blob = await this.fetchImage(result.image_id, signal);
                signal.throwIfAborted();
                this.setFrame(URL.createObjectURL(blob));
                this.captured = !reference_id;
            }
        });
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
        this.renderRegion();
    }
    renderResult() {
        const panel = this.get("result");
        panel.replaceChildren();
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
        if (result.data.expected_state) {
            const expected = document.createElement("p");
            expected.textContent = `${this.labels.expected} · ${result.data.expected_state}`;
            panel.append(expected);
        }
        const reference = this.gallery?.references.find((item) => item.id === result.data.reference_id);
        if (reference) {
            const best = document.createElement("p");
            best.textContent = `${this.labels.closest} · ${result.data.best_state} · ${reference.name}`;
            if (result.data.margin != null)
                best.textContent += ` · ${this.labels.gap} ${result.data.margin}`;
            const view = this.button("view_reference", () => {
                this.show("references");
                const match = this.get("gallery").querySelector("[data-matched=true]");
                match?.scrollIntoView({ block: "nearest" });
                match?.focus({ preventScroll: true });
            });
            panel.append(best, view);
        }
        if (result.data.scores && Object.keys(result.data.scores).length) {
            const table = document.createElement("table");
            const row = table.createTHead().insertRow();
            for (const label of [
                this.labels.state,
                this.labels.score,
                this.labels.count,
            ]) {
                const cell = document.createElement("th");
                cell.scope = "col";
                cell.textContent = label;
                row.append(cell);
            }
            const body = table.createTBody();
            const scores = result.data.scores;
            for (const [state, count] of Object.entries(result.data.ref_counts ?? {}).sort(([a], [b]) => (scores[a] ?? Infinity) - (scores[b] ?? Infinity))) {
                const data = body.insertRow();
                data.insertCell().textContent = state;
                data.insertCell().textContent = Object.hasOwn(scores, state)
                    ? String(scores[state])
                    : "–";
                data.insertCell().textContent = String(count);
            }
            panel.append(table);
        }
    }
    fillSettings() {
        if (!this.gallery)
            return;
        const { settings } = this.gallery;
        this.get("max_distance").value = String(settings.max_distance);
        this.get("min_margin").value = String(settings.min_margin);
        this.setRegion(settings.region);
    }
    readRegion() {
        const fields = coordinates.map((name) => this.get(name));
        if (fields.every((field) => field.value === "" && !field.validity.badInput))
            return null;
        if (fields.some((field) => !field.validity.valid || field.value === ""))
            throw new Error("invalid_settings");
        const [x, y, width, height] = fields.map((field) => field.valueAsNumber / 100);
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
        if (!max.validity.valid ||
            !margin.validity.valid ||
            !max.value ||
            !margin.value)
            throw new Error("invalid_settings");
        return {
            region: this.readRegion(),
            max_distance: max.valueAsNumber,
            min_margin: margin.valueAsNumber,
        };
    }
    renderDirty() {
        const status = this.get("dirty");
        status.textContent = "";
        if (!this.gallery)
            return;
        try {
            if (JSON.stringify(this.readSettings()) !==
                JSON.stringify(this.gallery.settings)) {
                status.textContent = this.labels.dirty;
            }
        }
        catch {
            status.textContent = this.labels.invalid_settings;
        }
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
    point(event) {
        const bounds = this.get("imagebox").getBoundingClientRect();
        const normalize = (value) => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
        return {
            x: normalize((event.clientX - bounds.left) / bounds.width),
            y: normalize((event.clientY - bounds.top) / bounds.height),
        };
    }
    drawRegion(event, finish) {
        const start = this.start;
        if (!start || event.pointerId !== start.pointer)
            return;
        const end = this.point(event);
        const region = {
            x: Math.min(end.x, start.x),
            y: Math.min(end.y, start.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
        };
        if (finish) {
            this.start = undefined;
            this.drawing = false;
            if (region.width >= 0.001 && region.height >= 0.001)
                this.setRegion(region);
            else {
                this.renderRegion();
                this.refresh();
            }
        }
        else {
            this.renderRegion(region);
        }
    }
    renderRegion(region = this.draftRegion) {
        const overlay = this.get("region");
        overlay.hidden = region === null || !this.frameUrl;
        if (!region)
            return;
        overlay.style.left = `${region.x * 100}%`;
        overlay.style.top = `${region.y * 100}%`;
        overlay.style.width = `${region.width * 100}%`;
        overlay.style.height = `${region.height * 100}%`;
    }
    button(label, action) {
        const button = document.createElement("ha-button");
        button.setAttribute("appearance", "plain");
        button.setAttribute("size", "s");
        button.textContent = this.labels[label];
        button.addEventListener("click", () => void action());
        return button;
    }
    renderGallery() {
        this.clearThumbnails();
        const node = this.get("gallery");
        node.replaceChildren();
        this.get("stateMessage").textContent =
            this.gallery && !this.gallery.states.length ? this.labels.no_states : "";
        if (!this.gallery || this.tab !== "references")
            return;
        this.thumbnailObserver = new IntersectionObserver((entries, observer) => {
            for (const entry of entries) {
                if (!entry.isIntersecting)
                    continue;
                const image = entry.target;
                observer.unobserve(image);
                void this.thumbnail(image);
            }
        });
        for (const state of this.gallery.states) {
            const section = document.createElement("section");
            section.className = "state";
            const title = document.createElement("h3");
            title.textContent = state.name;
            const controls = document.createElement("div");
            controls.className = "row";
            const name = document.createElement("input");
            name.value = state.name;
            name.maxLength = 120;
            name.setAttribute("aria-label", this.labels.rename);
            const rename = this.button("rename", () => this.task(async (signal) => {
                await this.update("state", { state_id: state.id, name: name.value }, signal);
                this.renderGallery();
            }));
            const remove = this.button("remove", () => {
                if (window.confirm(this.labels.confirm_state))
                    void this.galleryMutation("delete_state", { state_id: state.id });
            });
            controls.append(name, rename, remove);
            section.append(title, controls);
            for (const validation of [false, true]) {
                const heading = document.createElement("h4");
                heading.textContent =
                    this.labels[validation ? "validation" : "training"];
                const file = document.createElement("input");
                file.type = "file";
                file.multiple = true;
                file.accept = accept;
                file.hidden = true;
                file.addEventListener("change", () => {
                    const files = Array.from(file.files ?? []);
                    file.value = "";
                    if (files.length)
                        void this.import(files, validation, state.id);
                });
                const grid = document.createElement("div");
                grid.className = "grid";
                for (const ref of this.gallery.references.filter((item) => item.state_id === state.id && item.validation === validation)) {
                    grid.append(this.referenceRow(ref));
                }
                section.append(heading, file, this.button("upload", () => file.click()), grid);
            }
            node.append(section);
        }
    }
    referenceRow(ref) {
        const card = document.createElement("article");
        card.className = "reference";
        card.dataset.matched = String(this.matchId === ref.id);
        card.tabIndex = -1;
        const image = document.createElement("img");
        image.alt = "";
        image.dataset.reference = ref.id;
        this.thumbnailObserver?.observe(image);
        const title = document.createElement("strong");
        title.textContent = ref.name;
        const state = document.createElement("select");
        state.setAttribute("aria-label", this.labels.state);
        this.stateOptions(state, ref.state_id);
        const group = document.createElement("select");
        group.setAttribute("aria-label", this.labels.references);
        this.groupOptions(group, ref.validation);
        const controls = document.createElement("div");
        controls.className = "row";
        const move = this.button("move", () => this.galleryMutation("move", {
            reference_id: ref.id,
            state_id: state.value,
            validation: group.value === "validation",
        }));
        const remove = this.button("remove", () => {
            if (window.confirm(this.labels.confirm_remove))
                void this.galleryMutation("delete", { reference_id: ref.id });
        });
        if (ref.validation)
            controls.append(this.button("test_image", () => this.evaluate(ref.id)));
        controls.append(move, remove);
        card.append(image, title, state, group, controls);
        return card;
    }
    async galleryMutation(operation, data) {
        await this.task(async (signal) => {
            await this.update(operation, data, signal);
            this.renderGallery();
        });
    }
    async import(files, validation, state_id) {
        await this.task(async (signal) => {
            let accepted = 0;
            let rejected = 0;
            for (const file of files) {
                signal.throwIfAborted();
                try {
                    let target = state_id;
                    if (!target) {
                        const parts = file.webkitRelativePath.split("/");
                        if (parts.length !== 3 || !/\.(jpe?g|png|webp)$/i.test(file.name))
                            continue;
                        const name = parts[1].trim();
                        const find = () => this.gallery.states.find((state) => state.name.toLocaleLowerCase() === name.toLocaleLowerCase());
                        if (!find())
                            await this.update("state", { name }, signal);
                        target = find()?.id;
                    }
                    if (!target)
                        throw new Error("state_not_found");
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
                        state_id: target,
                        name: file.name,
                        validation,
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
customElements.define("image-lab-comparison", ImageLabComparison);
