type Region = { x: number; y: number; width: number; height: number };
type Settings = {
  region: Region | null;
  max_distance: number;
  min_margin: number;
};
type State = { id: string; name: string };
type Reference = {
  id: string;
  state_id: string;
  name: string;
  validation: boolean;
};
type Gallery = { settings: Settings; states: State[]; references: Reference[] };

const engines = ["pillow", "tarsius"] as const;
const outcomes = ["correct", "wrong", "unknown", "error"] as const;
type Outcome = (typeof outcomes)[number];
type Measurement = {
  outcome: Outcome;
  state: string | null;
  duration_ms: number | null;
};
type Benchmark = Record<
  (typeof engines)[number],
  Record<Outcome, number> & { median_ms: number | null }
> & {
  images: (Record<(typeof engines)[number], Measurement> & {
    name: string;
    expected: string;
  })[];
  tarsius_references_skipped: number;
};

type Result = {
  status: "ok" | "unknown" | "error";
  reason?: string;
  image_id: string | null;
  data: {
    state?: string;
    best_state?: string;
    scores?: Record<string, number>;
    ref_counts?: Record<string, number>;
    distance?: number | null;
    margin?: number | null;
    reference_id?: string | null;
    expected_state?: string;
  };
};

export interface ComparisonClient {
  locale: { language: string };
  config?: { time_zone: string };
  fetchWithAuth(path: string, init?: RequestInit): Promise<Response>;
}

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
    benchmark: "Compare Pillow and Tarsius",
    benchmark_running: "Comparing engines…",
    benchmark_summary: "Results on validation images",
    benchmark_details: "Results by image",
    benchmark_image: "Image",
    benchmark_engine: "Engine",
    benchmark_latency: "Median (ms)",
    benchmark_correct: "Correct",
    benchmark_wrong: "Wrong",
    benchmark_unknown: "Unknown",
    benchmark_error: "Error",
    benchmark_skipped: "References skipped by Tarsius",
    no_validation_images: "Add validation images to compare the engines.",
    benchmark_needs_references:
      "Tarsius needs at least two states, each with a usable reference image.",
    tarsius_unavailable: "Tarsius could not be installed or loaded.",
    move: "Move",
    classify: "Classify capture",
    capture: "Capture",
    capture_saved: "Capture classified.",
    max_distance: "Maximum distance",
    min_margin: "Minimum margin",
    thresholds:
      "Scores range from 0 to 255. A lower distance means a closer match.",
    crop: "Region in percent",
    x: "Left",
    y: "Top",
    width: "Width",
    height: "Height",
    region_help: "Leave all four fields blank to compare the full image.",
    save: "Save settings",
    saved: "Settings saved.",
    dirty: "Unsaved settings are used for tests.",
    no_references:
      "No usable reference images. Add images to one or more states.",
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
    invalid_request:
      "Check the entered values. The state name “unknown” is reserved.",
    invalid_settings:
      "Check the thresholds and select a region within the image.",
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
    benchmark: "Comparer Pillow et Tarsius",
    benchmark_running: "Comparaison en cours…",
    benchmark_summary: "Résultats sur les images de validation",
    benchmark_details: "Résultats par image",
    benchmark_image: "Image",
    benchmark_engine: "Moteur",
    benchmark_latency: "Médiane (ms)",
    benchmark_correct: "Correct",
    benchmark_wrong: "Erroné",
    benchmark_unknown: "Indéterminé",
    benchmark_error: "Erreur",
    benchmark_skipped: "Références ignorées par Tarsius",
    no_validation_images: "Ajoutez des images de validation pour comparer les moteurs.",
    benchmark_needs_references:
      "Tarsius exige au moins deux états, chacun avec une image de référence utilisable.",
    tarsius_unavailable: "Impossible d’installer ou de charger Tarsius.",
    move: "Déplacer",
    classify: "Classer la capture",
    capture: "Capture",
    capture_saved: "Capture classée.",
    max_distance: "Distance maximale",
    min_margin: "Écart minimal",
    thresholds:
      "Les distances vont de 0 à 255. Une distance basse indique une image plus proche.",
    crop: "Zone en pourcentage",
    x: "Gauche",
    y: "Haut",
    width: "Largeur",
    height: "Hauteur",
    region_help: "Laissez les quatre champs vides pour comparer toute l’image.",
    save: "Enregistrer les réglages",
    saved: "Réglages enregistrés.",
    dirty: "Les tests utilisent les réglages en cours d’édition.",
    no_references:
      "Aucune référence utilisable. Ajoutez des images à un ou plusieurs états.",
    ambiguous:
      "Les deux états les plus proches ont des distances trop similaires.",
    distance_too_high:
      "La référence la plus proche dépasse la distance maximale.",
    source_unavailable: "La source d’image est indisponible.",
    source_no_image: "La source ne fournit pas d’image.",
    capture_expired: "La capture a expiré. Relancez un test de la source.",
    duplicate_state: "Un état porte déjà ce nom.",
    state_not_empty:
      "Déplacez ou supprimez les images avant de supprimer l’état.",
    profile_unavailable: "Cette analyse est indisponible.",
    profile_not_found: "Cette analyse a été supprimée.",
    image_missing: "Cette analyse n’a pas d’image source importée.",
    invalid_image: "Choisissez des images fixes JPEG, PNG ou WebP.",
    image_too_large: "L’image dépasse 10 Mio ou 24 mégapixels.",
    invalid_request:
      "Vérifiez les valeurs saisies. Le nom d’état « unknown » est réservé.",
    invalid_settings:
      "Vérifiez les seuils et choisissez une zone dans l’image.",
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

type Label = keyof typeof text.en;
type Tab = "preview" | "references" | "settings";
const tabs: Tab[] = ["preview", "references", "settings"];
const coordinates = ["x", "y", "width", "height"] as const;
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
    #benchmarkResult { overflow-x:auto; margin:0 0 12px; }
    #benchmarkResult caption { text-align:start; font-weight:600; margin:8px 0; }
    #benchmarkResult details { margin-top:12px; }
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
      <ha-button id="benchmark" appearance="plain" hidden></ha-button>
      <input id="folderInput" type="file" webkitdirectory multiple hidden>
    </form>
    <p id="folderHint" class="secondary"></p>
    <p id="stateMessage" class="secondary"></p>
    <div id="benchmarkResult" aria-live="polite" hidden></div>
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
  private client?: ComparisonClient;
  private profile?: string;
  private sourceKey?: string;
  private available = false;
  private tab: Tab = "preview";
  private labels = text.en;
  private scope?: AbortController;
  private gallery?: Gallery;
  private result?: Result;
  private benchmarkResult?: Benchmark;
  private benchmarking = false;
  private captured = false;
  private busy = false;
  private drawing = false;
  private start?: { x: number; y: number; pointer: number };
  private draftRegion: Region | null = null;
  private frameUrl?: string;
  private thumbnailUrls: string[] = [];
  private thumbnailObserver?: IntersectionObserver;
  private matchId?: string;

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(
      template.content.cloneNode(true),
    );
    for (const tab of tabs) {
      const button = this.get("tab-" + tab);
      button.addEventListener("click", () => this.show(tab));
      button.addEventListener("keydown", (event) => {
        const current = tabs.indexOf(tab);
        const next =
          event.key === "ArrowRight"
            ? (current + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (current + tabs.length - 1) % tabs.length
              : -1;
        if (next < 0) return;
        event.preventDefault();
        this.show(tabs[next]);
        this.get("tab-" + tabs[next]).focus();
      });
    }
    this.onClick("reload", () => this.load());
    this.onClick("test", () => this.evaluate());
    this.onClick("benchmark", () => this.benchmark());
    this.onClick("draw", () => {
      this.drawing = !this.drawing;
      this.start = undefined;
      this.renderRegion();
      this.refresh();
    });
    this.onClick("whole", () => this.setRegion(null));
    this.onClick("save", () =>
      this.task(async (signal) => {
        await this.update("settings", this.readSettings(), signal);
        this.fillSettings();
        this.feedback(this.labels.saved);
      }),
    );
    this.onClick("captureAdd", () =>
      this.task(async (signal) => {
        if (!this.result?.image_id || !this.captured) return;
        const state_id = this.get<HTMLSelectElement>("captureState").value;
        if (!state_id) throw new Error("choose_state");
        const stamp = new Intl.DateTimeFormat(this.client?.locale.language, {
          dateStyle: "short",
          timeStyle: "medium",
          timeZone: this.client?.config?.time_zone,
        }).format();
        await this.update(
          "add",
          {
            state_id,
            name: `${this.labels.capture} ${stamp}`,
            validation:
              this.get<HTMLSelectElement>("captureGroup").value ===
              "validation",
            capture_id: this.result.image_id,
          },
          signal,
        );
        this.captured = false;
        this.feedback(this.labels.capture_saved);
      }),
    );

    this.get("stateForm").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.task(async (signal) => {
        const input = this.get<HTMLInputElement>("stateName");
        await this.update("state", { name: input.value }, signal);
        input.value = "";
        this.renderGallery();
      });
    });
    this.onClick("addState", () =>
      this.get<HTMLFormElement>("stateForm").requestSubmit(),
    );
    this.onClick("folder", () =>
      this.get<HTMLInputElement>("folderInput").click(),
    );
    this.get<HTMLInputElement>("folderInput").addEventListener(
      "change",
      (event) => {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = "";
        if (files.length) void this.import(files, false);
      },
    );

    for (const field of [
      "max_distance",
      "min_margin",
      ...coordinates,
    ] as const) {
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
          } catch {
            /* incomplete entry */
          }
        }
        this.renderDirty();
      });
      label.append(caption, input);
      this.get(
        coordinates.some((key) => key === field)
          ? "regionFields"
          : "thresholdFields",
      ).append(label);
    }

    const box = this.get("imagebox");
    box.addEventListener("pointerdown", (event) => {
      if (!this.drawing || this.start || event.button !== 0) return;
      event.preventDefault();
      box.setPointerCapture(event.pointerId);
      this.start = { ...this.point(event), pointer: event.pointerId };
    });
    box.addEventListener("pointermove", (event) =>
      this.drawRegion(event, false),
    );
    box.addEventListener("pointerup", (event) => this.drawRegion(event, true));
    const cancelDrawing = (event: PointerEvent) => {
      if (this.start?.pointer !== event.pointerId) return;
      this.start = undefined;
      this.renderRegion();
    };
    box.addEventListener("pointercancel", cancelDrawing);
    box.addEventListener("lostpointercapture", cancelDrawing);
    const frame = this.get<HTMLImageElement>("frame");
    frame.addEventListener("load", () =>
      box.style.setProperty(
        "--ratio",
        String(frame.naturalWidth / frame.naturalHeight),
      ),
    );
    this.localize();
    this.refresh();
  }

  configure(
    client?: ComparisonClient,
    profile?: string,
    sourceKey?: string,
    available = false,
  ) {
    const changed =
      profile !== this.profile ||
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
      this.renderBenchmark();
      this.renderGallery();
    }
    if (changed) {
      this.reset();
      this.show("preview");
      if (profile && client && this.isConnected) void this.load();
    } else {
      this.refresh();
    }
  }

  connectedCallback() {
    if (this.profile && this.client && !this.scope) void this.load();
  }

  disconnectedCallback() {
    this.reset();
  }

  private get<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.shadowRoot!.getElementById(id) as T;
  }

  private onClick(id: string, fn: () => unknown) {
    this.get(id).addEventListener("click", () => void fn());
  }

  private localize() {
    const names: Record<string, Label> = {
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
    for (const tab of tabs) names["tab-" + tab] = tab;
    for (const key of ["max_distance", "min_margin", ...coordinates] as const)
      names[key + "-label"] = key;
    for (const [id, label] of Object.entries(names))
      this.get(id).textContent = this.labels[label];
    this.get<HTMLInputElement>("stateName").setAttribute(
      "aria-label",
      this.labels.new_state,
    );
    this.get<HTMLInputElement>("stateName").placeholder = this.labels.new_state;
    this.get("captureState").setAttribute("aria-label", this.labels.state);
    this.get("captureGroup").setAttribute("aria-label", this.labels.references);
    this.get<HTMLImageElement>("frame").alt = this.labels.preview;
    this.get("nav").setAttribute("aria-label", "Image Lab");
  }

  private reset() {
    this.scope?.abort();
    this.scope = undefined;
    this.gallery = undefined;
    this.result = undefined;
    this.benchmarkResult = undefined;
    this.benchmarking = false;
    this.captured = false;
    this.busy = false;
    this.drawing = false;
    this.start = undefined;
    this.draftRegion = null;
    this.matchId = undefined;
    this.setFrame();
    this.clearThumbnails();
    this.get("gallery").replaceChildren();
    this.get<HTMLInputElement>("stateName").value = "";
    this.feedback();
    this.renderResult();
    this.renderBenchmark();
  }

  private refresh() {
    this.get("preview").setAttribute("aria-busy", String(this.busy));
    this.get("test").toggleAttribute(
      "disabled",
      !this.gallery || this.busy || !this.available,
    );
    this.get("save").toggleAttribute("disabled", !this.gallery || this.busy);
    this.get("addState").toggleAttribute(
      "disabled",
      !this.gallery || this.busy,
    );
    this.get("folder").toggleAttribute("disabled", !this.gallery || this.busy);
    const benchmark = this.get("benchmark");
    benchmark.hidden = !this.gallery?.references.some((ref) => ref.validation);
    benchmark.toggleAttribute("disabled", this.busy);
    benchmark.textContent =
      this.labels[this.benchmarking ? "benchmark_running" : "benchmark"];
    this.get("references").setAttribute("aria-busy", String(this.benchmarking));
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

  private show(tab: Tab) {
    this.tab = tab;
    for (const key of tabs) {
      this.get(key).hidden = tab !== key;
      this.get("tab-" + key).setAttribute("aria-selected", String(key === tab));
      this.get("tab-" + key).setAttribute(
        "variant",
        key === tab ? "brand" : "neutral",
      );
    }
    if (tab === "references") this.renderGallery();
    else this.clearThumbnails();
    this.refresh();
  }

  private async load() {
    if (!this.profile || !this.client) return;
    this.scope?.abort();
    this.scope = new AbortController();
    await this.task(async (signal) => {
      this.gallery = await this.request<Gallery>("", signal);
      if (signal.aborted) return;
      this.benchmarkResult = undefined;
      this.renderBenchmark();
      this.fillSettings();
      this.updateSelectors();
      if (this.tab === "references") this.renderGallery();
    });
  }

  private feedback(message = "", error = false) {
    const notice = this.get("feedback");
    notice.hidden = !message;
    notice.textContent = message;
    notice.setAttribute("alert-type", error ? "error" : "info");
  }

  private async task(run: (signal: AbortSignal) => Promise<void>) {
    const signal = this.scope?.signal;
    if (this.busy || !signal || signal.aborted) return;
    this.busy = true;
    this.feedback();
    this.refresh();
    try {
      await run(signal);
    } catch (error) {
      if (!signal.aborted) {
        const key = error instanceof Error ? error.message : "";
        this.feedback(
          Object.hasOwn(this.labels, key)
            ? this.labels[key as Label]
            : this.labels.failed,
          true,
        );
      }
    } finally {
      if (!signal.aborted) {
        this.busy = false;
        this.refresh();
      }
    }
  }

  private async request<T>(
    path: string,
    signal: AbortSignal,
    payload?: object,
  ): Promise<T> {
    const response = await this.client!.fetchWithAuth(this.url(path), {
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

  private url(path: string): string {
    return `/api/image_lab/comparison/${encodeURIComponent(this.profile!)}${path}`;
  }

  private async checkResponse(response: Response) {
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.reason ?? "failed");
    }
  }

  private async update(operation: string, data: object, signal: AbortSignal) {
    this.gallery = await this.request<Gallery>("/" + operation, signal, data);
    this.benchmarkResult = undefined;
    this.renderBenchmark();
    this.updateSelectors();
  }

  private updateSelectors() {
    this.stateOptions(this.get("captureState"));
    this.groupOptions(this.get("captureGroup"));
  }

  private stateOptions(select: HTMLSelectElement, state?: string) {
    const selected = state ?? select.value;
    select.replaceChildren(
      ...(this.gallery?.states ?? []).map(
        (item) => new Option(item.name, item.id, false, item.id === selected),
      ),
    );
  }

  private groupOptions(select: HTMLSelectElement, validation = false) {
    select.replaceChildren(
      new Option(this.labels.training, "training"),
      new Option(this.labels.validation, "validation"),
    );
    select.value = validation ? "validation" : "training";
  }

  private async evaluate(reference_id?: string) {
    await this.task(async (signal) => {
      const settings = this.readSettings();
      this.setFrame();
      this.captured = false;
      this.result = undefined;
      this.drawing = false;
      this.start = undefined;
      this.renderResult();
      this.show("preview");
      const result = await this.request<Result>("/test", signal, {
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

  private async benchmark() {
    await this.task(async (signal) => {
      const settings = this.readSettings();
      this.benchmarkResult = undefined;
      this.renderBenchmark();
      this.benchmarking = true;
      this.refresh();
      try {
        this.benchmarkResult = await this.request<Benchmark>(
          "/benchmark", signal, { settings },
        );
        this.renderBenchmark();
      } finally {
        if (!signal.aborted) this.benchmarking = false;
      }
    });
  }

  private renderBenchmark() {
    const panel = this.get("benchmarkResult");
    panel.replaceChildren();
    const result = this.benchmarkResult;
    panel.hidden = !result;
    if (!result) return;

    const engineNames = { pillow: "Pillow", tarsius: "Tarsius (ncnn)" };
    const outcomeLabels = {
      correct: this.labels.benchmark_correct,
      wrong: this.labels.benchmark_wrong,
      unknown: this.labels.benchmark_unknown,
      error: this.labels.benchmark_error,
    };
    const number = new Intl.NumberFormat(this.client?.locale.language, {
      maximumFractionDigits: 1,
    });
    const summary = this.resultTable(
      [
        this.labels.benchmark_engine,
        ...outcomes.map((key) => outcomeLabels[key]),
        this.labels.benchmark_latency,
      ],
      engines.map((engine) => {
        const data = result[engine];
        return [
          engineNames[engine],
          ...outcomes.map((key) => number.format(data[key])),
          data.median_ms === null ? "–" : number.format(data.median_ms),
        ];
      }),
    );
    summary.createCaption().textContent = this.labels.benchmark_summary;
    panel.append(summary);

    if (result.tarsius_references_skipped > 0) {
      const skipped = document.createElement("p");
      skipped.className = "secondary";
      skipped.textContent = `${this.labels.benchmark_skipped} · ${number.format(result.tarsius_references_skipped)}`;
      panel.append(skipped);
    }
    const details = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = this.labels.benchmark_details;
    const measurements = this.resultTable(
      [
        this.labels.benchmark_image,
        this.labels.expected,
        ...engines.map((key) => engineNames[key]),
      ],
      result.images.map((image) => [
        image.name,
        image.expected,
        ...engines.map((engine) => {
          const { outcome, state, duration_ms } = image[engine];
          const parts = [outcomeLabels[outcome]];
          if (state) parts.unshift(state);
          if (duration_ms !== null) parts.push(`${number.format(duration_ms)} ms`);
          return parts.join(" · ");
        }),
      ]),
    );
    details.append(heading, measurements);
    panel.append(details);
  }

  private resultTable(columns: string[], rows: string[][]) {
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
      for (const value of cells) row.insertCell().textContent = value;
    }
    return table;
  }

  private async fetchImage(
    id: string,
    signal: AbortSignal,
    thumbnail = false,
  ): Promise<Blob> {
    const suffix = thumbnail ? "?thumbnail=1" : "";
    const response = await this.client!.fetchWithAuth(
      this.url("/image/" + id + suffix),
      { signal, cache: "no-store" },
    );
    await this.checkResponse(response);
    return response.blob();
  }

  private setFrame(url?: string) {
    if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
    this.frameUrl = url;
    const frame = this.get<HTMLImageElement>("frame");
    if (url) frame.src = url;
    else frame.removeAttribute("src");
    this.get("imagebox").hidden = !url;
    this.renderRegion();
  }

  private renderResult() {
    const panel = this.get("result");
    panel.replaceChildren();
    const result = this.result;
    if (!result) return;
    const title = document.createElement("strong");
    const message = document.createElement("p");
    if (result.status === "ok")
      title.textContent = `${this.labels.recognized} · ${result.data.state}`;
    if (result.status === "unknown") title.textContent = this.labels.unknown;
    if (result.reason) {
      const key = result.reason as Label;
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

    const reference = this.gallery?.references.find(
      (item) => item.id === result.data.reference_id,
    );
    if (reference) {
      const best = document.createElement("p");
      best.textContent = `${this.labels.closest} · ${result.data.best_state} · ${reference.name}`;
      if (result.data.margin != null)
        best.textContent += ` · ${this.labels.gap} ${result.data.margin}`;
      const view = this.button("view_reference", () => {
        this.show("references");
        const match = this.get("gallery").querySelector<HTMLElement>(
          "[data-matched=true]",
        );
        match?.scrollIntoView({ block: "nearest" });
        match?.focus({ preventScroll: true });
      });
      panel.append(best, view);
    }
    if (result.data.scores && Object.keys(result.data.scores).length) {
      const scores = result.data.scores;
      const rows = Object.entries(result.data.ref_counts ?? {})
        .sort(([a], [b]) => (scores[a] ?? Infinity) - (scores[b] ?? Infinity))
        .map(([state, count]) => [
          state,
          Object.hasOwn(scores, state) ? String(scores[state]) : "–",
          String(count),
        ]);
      panel.append(this.resultTable(
        [this.labels.state, this.labels.score, this.labels.count], rows,
      ));
    }
  }

  private fillSettings() {
    if (!this.gallery) return;
    const { settings } = this.gallery;
    this.get<HTMLInputElement>("max_distance").value = String(
      settings.max_distance,
    );
    this.get<HTMLInputElement>("min_margin").value = String(
      settings.min_margin,
    );
    this.setRegion(settings.region);
  }

  private readRegion(): Region | null {
    const fields = coordinates.map((name) => this.get<HTMLInputElement>(name));
    if (fields.every((field) => field.value === "" && !field.validity.badInput))
      return null;
    if (fields.some((field) => !field.validity.valid || field.value === ""))
      throw new Error("invalid_settings");
    const [x, y, width, height] = fields.map(
      (field) => field.valueAsNumber / 100,
    );
    if (
      width <= 0 ||
      height <= 0 ||
      x + width > 1 + 1e-9 ||
      y + height > 1 + 1e-9
    ) {
      throw new Error("invalid_settings");
    }
    return { x, y, width, height };
  }

  private readSettings(): Settings {
    const max = this.get<HTMLInputElement>("max_distance");
    const margin = this.get<HTMLInputElement>("min_margin");
    if (
      !max.validity.valid ||
      !margin.validity.valid ||
      !max.value ||
      !margin.value
    )
      throw new Error("invalid_settings");
    return {
      region: this.readRegion(),
      max_distance: max.valueAsNumber,
      min_margin: margin.valueAsNumber,
    };
  }

  private renderDirty() {
    const status = this.get("dirty");
    status.textContent = "";
    if (!this.gallery) return;
    try {
      if (
        JSON.stringify(this.readSettings()) !==
        JSON.stringify(this.gallery.settings)
      ) {
        status.textContent = this.labels.dirty;
      }
    } catch {
      status.textContent = this.labels.invalid_settings;
    }
  }

  private setRegion(region: Region | null) {
    this.draftRegion = region;
    for (const key of coordinates)
      this.get<HTMLInputElement>(key).value = region
        ? String(Math.round(region[key] * 10000) / 100)
        : "";
    this.renderRegion();
    this.refresh();
  }

  private point(event: PointerEvent) {
    const bounds = this.get("imagebox").getBoundingClientRect();
    const normalize = (value: number) =>
      Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
    return {
      x: normalize((event.clientX - bounds.left) / bounds.width),
      y: normalize((event.clientY - bounds.top) / bounds.height),
    };
  }

  private drawRegion(event: PointerEvent, finish: boolean) {
    const start = this.start;
    if (!start || event.pointerId !== start.pointer) return;
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
    } else {
      this.renderRegion(region);
    }
  }

  private renderRegion(region = this.draftRegion) {
    const overlay = this.get("region");
    overlay.hidden = region === null || !this.frameUrl;
    if (!region) return;
    overlay.style.left = `${region.x * 100}%`;
    overlay.style.top = `${region.y * 100}%`;
    overlay.style.width = `${region.width * 100}%`;
    overlay.style.height = `${region.height * 100}%`;
  }

  private button(label: Label, action: () => unknown) {
    const button = document.createElement("ha-button");
    button.setAttribute("appearance", "plain");
    button.setAttribute("size", "s");
    button.textContent = this.labels[label];
    button.addEventListener("click", () => void action());
    return button;
  }

  private renderGallery() {
    this.clearThumbnails();
    const node = this.get("gallery");
    node.replaceChildren();
    this.get("stateMessage").textContent =
      this.gallery && !this.gallery.states.length ? this.labels.no_states : "";
    if (!this.gallery || this.tab !== "references") return;
    this.thumbnailObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target as HTMLImageElement;
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
      const rename = this.button("rename", () =>
        this.task(async (signal) => {
          await this.update(
            "state",
            { state_id: state.id, name: name.value },
            signal,
          );
          this.renderGallery();
        }),
      );
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
          if (files.length) void this.import(files, validation, state.id);
        });
        const grid = document.createElement("div");
        grid.className = "grid";
        for (const ref of this.gallery.references.filter(
          (item) =>
            item.state_id === state.id && item.validation === validation,
        )) {
          grid.append(this.referenceRow(ref));
        }
        section.append(
          heading,
          file,
          this.button("upload", () => file.click()),
          grid,
        );
      }
      node.append(section);
    }
  }

  private referenceRow(ref: Reference) {
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
    const move = this.button("move", () =>
      this.galleryMutation("move", {
        reference_id: ref.id,
        state_id: state.value,
        validation: group.value === "validation",
      }),
    );
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

  private async galleryMutation(operation: string, data: object) {
    await this.task(async (signal) => {
      await this.update(operation, data, signal);
      this.renderGallery();
    });
  }

  private async import(files: File[], validation: boolean, state_id?: string) {
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
            const find = () =>
              this.gallery!.states.find(
                (state) =>
                  state.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
              );
            if (!find()) await this.update("state", { name }, signal);
            target = find()?.id;
          }
          if (!target) throw new Error("state_not_found");
          if (file.size > 10 * 1024 * 1024) throw new Error("image_too_large");
          const body = new FormData();
          body.append("file", file, file.name);
          const response = await this.client!.fetchWithAuth(
            "/api/file_upload",
            { method: "POST", body, signal },
          );
          await this.checkResponse(response);
          const { file_id } = await response.json();
          signal.throwIfAborted();
          await this.update(
            "add",
            {
              upload_id: file_id,
              state_id: target,
              name: file.name,
              validation,
            },
            signal,
          );
          accepted++;
        } catch {
          rejected++;
        }
      }
      if (signal.aborted) return;
      this.renderGallery();
      this.feedback(
        `${this.labels.imported} ${accepted} · ${this.labels.rejected} ${rejected}`,
        rejected > 0,
      );
    });
  }

  private async thumbnail(image: HTMLImageElement) {
    const signal = this.scope?.signal;
    if (!signal || !image.isConnected) return;
    try {
      const blob = await this.fetchImage(
        image.dataset.reference!,
        signal,
        true,
      );
      if (!image.isConnected || signal.aborted || this.tab !== "references")
        return;
      const url = URL.createObjectURL(blob);
      this.thumbnailUrls.push(url);
      image.src = url;
    } catch {
      image.hidden = true;
    }
  }

  private clearThumbnails() {
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = undefined;
    for (const url of this.thumbnailUrls) URL.revokeObjectURL(url);
    this.thumbnailUrls = [];
  }
}

customElements.define("image-lab-comparison", ImageLabComparison);
