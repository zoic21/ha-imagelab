import { ImageLabComparison } from "./comparison.js";
const strings = {
    en: {
        profiles: "Analyses",
        add: "Add analysis",
        settings: "Manage analyses",
        back: "Back to analyses",
        empty: "Create an analysis to test an image source.",
        select: "Select an analysis to see its image source.",
        loading: "Loading analyses…",
        loadError: "Could not load analyses.",
        retry: "Retry",
        test: "Test source",
        testing: "Retrieving image…",
        preview: "Source image",
        id: "Analysis ID",
        copy: "Copy",
        copied: "Copied",
        paletteReady: "Palette extracted",
        dominant: "Dominant color",
        comparison: "Image comparison",
        palette: "Color palette",
        object_detection: "Object detection",
        detecting: "Analyzing image…",
        noObjects: "No objects detected.",
        objectFound: "1 object detected",
        objectsFound: "objects detected",
        objectLimit: "Showing the objects with the highest confidence.",
        object_engine_unavailable: "Could not load the ncnn detection engine.",
        object_model_unavailable: "Could not download or load the NanoDet model. Check the connection and try again.",
        object_detection_failed: "Could not detect objects in this image.",
        camera: "Camera snapshot",
        media_player: "Media player artwork",
        upload: "Imported image",
        profile_not_found: "This analysis has been removed.",
        profile_unavailable: "This analysis is unavailable.",
        image_missing: "There is no imported image. Reconfigure the analysis to add one.",
        source_unavailable: "The image source is unavailable.",
        source_no_image: "The source currently has no image.",
        image_too_large: "The image exceeds 10 MiB or 24 megapixels.",
        invalid_image: "The source did not provide a valid still JPEG, PNG or WebP image.",
        storage_error: "The imported image could not be read.",
        testError: "Could not test the image source.",
        copyError: "Could not copy the ID.",
    },
    fr: {
        profiles: "Analyses",
        add: "Ajouter une analyse",
        settings: "Gérer les analyses",
        back: "Retour aux analyses",
        empty: "Créez une analyse pour tester une source d’image.",
        select: "Sélectionnez une analyse pour voir sa source d’image.",
        loading: "Chargement des analyses…",
        loadError: "Impossible de charger les analyses.",
        retry: "Réessayer",
        test: "Tester la source",
        testing: "Récupération de l’image…",
        preview: "Image source",
        id: "Identifiant de l’analyse",
        copy: "Copier",
        copied: "Copié",
        paletteReady: "Palette extraite",
        dominant: "Couleur dominante",
        comparison: "Comparaison d’images",
        palette: "Palette de couleurs",
        object_detection: "Détection d’objets",
        detecting: "Analyse de l’image…",
        noObjects: "Aucun objet détecté.",
        objectFound: "1 objet détecté",
        objectsFound: "objets détectés",
        objectLimit: "Seuls les objets les plus fiables sont affichés.",
        object_engine_unavailable: "Impossible de charger le moteur de détection ncnn.",
        object_model_unavailable: "Impossible de télécharger ou de charger le modèle NanoDet. Vérifiez la connexion et réessayez.",
        object_detection_failed: "Impossible de détecter les objets sur cette image.",
        camera: "Capture de caméra",
        media_player: "Pochette du lecteur multimédia",
        upload: "Image importée",
        profile_not_found: "Cette analyse a été supprimée.",
        profile_unavailable: "Cette analyse est indisponible.",
        image_missing: "Aucune image importée. Reconfigurez l’analyse pour en ajouter une.",
        source_unavailable: "La source d’image est indisponible.",
        source_no_image: "La source ne fournit pas d’image actuellement.",
        image_too_large: "L’image dépasse 10 Mio ou 24 mégapixels.",
        invalid_image: "La source ne fournit pas une image fixe JPEG, PNG ou WebP valide.",
        storage_error: "Impossible de lire l’image importée.",
        testError: "Impossible de tester la source d’image.",
        copyError: "Impossible de copier l’identifiant.",
    },
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
      display: grid; gap: 4px; width: 100%; padding: 12px; border: 0;
      border-radius: var(--ha-border-radius-md, 8px); background: none;
      color: inherit; font: inherit; text-align: start; cursor: pointer;
      overflow-wrap: anywhere;
    }
    li button:hover, li button[aria-current="true"] {
      background: var(--secondary-background-color);
    }
    li button[aria-current="true"] { box-shadow: inset 3px 0 var(--primary-color); }
    li button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
    .secondary { color: var(--secondary-text-color); }
    p { margin: 8px 0; overflow-wrap: anywhere; }
    .id { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
    code { overflow-wrap: anywhere; }
    figure { margin: 16px 0 0; }
    #imageStage { position: relative; --preview-height: min(55dvh, 520px); }
    #imageStage.with-objects {
      width: min(100%, calc(var(--preview-height) * var(--image-aspect)));
      margin-inline: auto; overflow: hidden;
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
      position: absolute; top: 0; left: 0; padding: 1px 5px; white-space: nowrap;
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
    #back { margin-bottom: 10px; }
    :host([narrow]) main { grid-template-columns: minmax(0, 1fr); padding: 12px; }
    @media (max-width: 400px) { header { padding-inline-end: 8px; } .heading { gap: 4px; } }
  </style>

  <header>
    <div class="heading"><ha-menu-button></ha-menu-button><h1>Image Lab</h1></div>
    <ha-button id="add" href="/config/integrations/dashboard/add?domain=image_lab" variant="brand"></ha-button>
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
          <div class="id">
            <span id="idLabel" class="secondary"></span>
            <code id="profileId"></code>
            <ha-button id="copy" appearance="plain" variant="neutral" size="s"></ha-button>
          </div>
          <div class="toolbar">
            <ha-button id="test" variant="brand"></ha-button>
            <ha-button id="settings" href="/config/integrations/integration/image_lab" appearance="plain" variant="neutral"></ha-button>
          </div>
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
        </div>
      </section>
    </ha-card>
  </main>
`;
class ImageLabPanel extends HTMLElement {
    _hass;
    profiles;
    selectedId;
    subscription;
    failed = false;
    activeTest;
    previewUrl;
    strings = strings.en;
    comparison;
    constructor() {
        super();
        this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
        this.comparison = new ImageLabComparison();
        this.element("comparisonSlot").append(this.comparison);
        this.element("retry").addEventListener("click", () => this.subscribe());
        this.element("back").addEventListener("click", () => {
            this.select();
            this.element("list").querySelector("button")?.focus();
        });
        this.element("test").addEventListener("click", () => void this.test());
        this.element("copy").addEventListener("click", () => void this.copyId());
        this.render();
    }
    set hass(hass) {
        const connectionChanged = this._hass?.connection !== hass.connection;
        const language = hass.locale.language.startsWith("fr") ? strings.fr : strings.en;
        this._hass = hass;
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
        this.unsubscribe();
        this.clearTest();
    }
    element(id) {
        return this.shadowRoot.getElementById(id);
    }
    get selected() {
        return this.profiles?.find((profile) => profile.profile_id === this.selectedId);
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
            if (previous && (!current || previous.module !== current.module ||
                previous.source_type !== current.source_type || previous.entity_id !== current.entity_id ||
                previous.palette_size !== current.palette_size ||
                (current.module === "object_detection" && previous.modified_at !== current.modified_at) ||
                previous.available !== current.available)) {
                this.clearTest();
            }
            if (!current)
                this.selectedId = undefined;
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
        this.clearTest();
        this.selectedId = profile?.profile_id;
        this.render();
        if (profile && this.hasAttribute("narrow"))
            this.element("title").focus();
    }
    clearTest() {
        this.activeTest?.abort();
        this.activeTest = undefined;
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
        this.element("copy").textContent = this.strings.copy;
    }
    render() {
        const labels = this.strings;
        for (const [id, message] of Object.entries({
            add: labels.add, listTitle: labels.profiles, retry: labels.retry,
            back: labels.back, idLabel: labels.id, copy: labels.copy,
            settings: labels.settings, test: labels.test, selectMessage: labels.select,
            paletteTitle: labels.palette,
        })) {
            this.element(id).textContent = message;
        }
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
            button.type = "button";
            button.setAttribute("aria-current", String(item.profile_id === this.selectedId));
            button.addEventListener("click", () => this.select(item));
            title.textContent = item.title;
            module.className = "secondary";
            module.textContent = labels[item.module];
            button.append(title, module);
            row.append(button);
            return row;
        });
        this.element("list").replaceChildren(...rows);
        const isComparison = profile?.module === "comparison";
        this.comparison.hidden = !isComparison;
        this.comparison.configure(this._hass, isComparison ? profile.profile_id : undefined, isComparison ? `${profile.source_type}/${profile.entity_id ?? ""}` : undefined, profile?.available);
        this.element("test").hidden = isComparison;
        if (!profile)
            return;
        this.element("title").textContent = profile.title;
        this.element("profileId").textContent = profile.profile_id;
        const source = [labels[profile.module], labels[profile.source_type], profile.entity_id];
        this.element("source").textContent = source.filter(Boolean).join(" · ");
        this.element("test").toggleAttribute("disabled", !profile.available || Boolean(this.activeTest));
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
                this.element("copy").textContent = this.strings.copied;
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
        this.element("test").setAttribute("disabled", "");
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
                this.element("test").removeAttribute("disabled");
                status.textContent = this.previewUrl ? summary : "";
            }
        }
    }
}
customElements.define("image-lab-panel", ImageLabPanel);
