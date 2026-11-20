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
        sourceCheck: "Image received",
        comparison: "Image comparison",
        palette: "Color palette",
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
        sourceCheck: "Image reçue",
        comparison: "Comparaison d’images",
        palette: "Palette de couleurs",
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
    img {
      display: block; width: 100%; max-height: min(55dvh, 520px); object-fit: contain;
      background: var(--secondary-background-color); border-radius: var(--ha-border-radius-md, 8px);
    }
    figcaption, ha-alert { margin-top: 8px; }
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
          <figure id="preview" hidden>
            <img id="image" />
            <figcaption id="dimensions" class="secondary"></figcaption>
          </figure>
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
        this.element("preview").hidden = true;
        this.element("image").removeAttribute("src");
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
        status.textContent = this.strings.testing;
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
            this.previewUrl = URL.createObjectURL(blob);
            const image = this.element("image");
            image.src = this.previewUrl;
            image.alt = this.strings.preview;
            const width = response.headers.get("X-Image-Lab-Width");
            const height = response.headers.get("X-Image-Lab-Height");
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
                status.textContent = this.previewUrl ? this.strings.sourceCheck : "";
            }
        }
    }
}
customElements.define("image-lab-panel", ImageLabPanel);
