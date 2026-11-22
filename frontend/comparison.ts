import { comparisonStrings as text } from "./translations.js";

import { actionLabel } from "./action.js";
import { numberField, type NumberField } from "./number-field.js";
import { bindRegionDrawing, paintRegion, type Region } from "./region.js";
type Engine = "pillow" | "tarsius";
type Settings = {
  engine: Engine;
  region: Region | null;
  max_distance: number;
  min_margin: number;
};
interface HaSelect extends HTMLElement {
  options: { value: string; label: string }[];
  value: string;
  label: string;
}

type State = { id: string; name: string };
type Reference = {
  id: string;
  state_id: string;
  name: string;
  validation: boolean;
};
type HistoryItem = { id: string; time: string; state_id: string | null; state: string; reason: string | null; engine: Engine };
type Gallery = { history: HistoryItem[]; history_settings: { mode: string; limit: number }; settings: Settings; states: State[]; references: Reference[] };

const engines = ["pillow", "tarsius"] as const;
const engineNames = { pillow: "Pillow", tarsius: "Tarsius (ncnn)" };
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
    engine?: Engine;
    state?: string;
    state_id?: string | null;
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

type Label = keyof typeof text.en;
type Tab = "preview" | "references" | "history" | "settings";
const tabs: Tab[] = ["preview", "references", "history", "settings"];
const coordinates = ["x", "y", "width", "height"] as const;
const accept = "image/jpeg,image/png,image/webp";
const actionIcons: Partial<Record<Label, string>> = {
  add_state: "plus", benchmark: "compare", cancel: "close", classify: "tag-plus-outline",
  close: "close", correct: "tag-edit-outline", draw: "crop", folder: "folder-upload-outline",
  move: "arrow-right", refreshHistory: "refresh", reload: "refresh", remove: "delete-outline",
  rename: "pencil-outline", save: "content-save-outline", stop_draw: "check", test: "play-outline",
  test_image: "play-outline", upload: "upload", view_reference: "image-search-outline",
  viewCapture: "magnify-plus-outline", whole: "crop-free",
};

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display:block; margin-top: 12px; }
    [hidden] { display:none !important; }
    .row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
    ha-tab-group { margin-bottom:16px; }
    ha-input, ha-select { min-width:0; max-width:100%; }
    .secondary { color:var(--secondary-text-color); font-size:.95em; }
    p { margin:8px 0; overflow-wrap:anywhere; }
    #feedback { margin:12px 0; }
    #progress { accent-color:var(--primary-color); width:100%; }
    #historySettings { display:grid; align-items:end; gap:8px;
      grid-template-columns:repeat(auto-fit, minmax(min(100%, 180px), 1fr)); margin-top:8px; }
    #historySettings .row { grid-column:1 / -1; }
    #historyMode, #historyLimit { width:100%; }
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
    .openImage { padding:0; border:0; cursor:zoom-in; background:none; }
    .original { display:block; max-width:100%; max-height:65dvh; margin:auto; }
    .reference img { width:100%; height:110px; object-fit:contain; }
    fieldset { margin:12px 0; padding:12px; border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-md, 8px); }
    label { display:grid; gap:4px; margin:4px 0; }
    input:not([type=file]) { color:var(--primary-text-color); font:inherit; min-height:36px;
      margin:0; box-sizing:border-box; max-width:100%; border:1px solid var(--divider-color);
      border-radius:var(--ha-border-radius-md, 8px); padding:4px 8px; background:var(--card-background-color); }
    .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,135px),1fr)); gap:6px 12px; }
    #classify { border-top:1px solid var(--divider-color); padding-top:8px; }
    #stateMessage { margin-bottom:9px; }
    #benchmarkResult { overflow-x:auto; margin:0 0 12px; }
    #benchmarkResult caption { text-align:start; font-weight:600; margin:8px 0; }
    #benchmarkResult details { margin-top:12px; }
  </style>
  <ha-tab-group id="nav" active="preview">
    <ha-tab-group-tab slot="nav" panel="preview" id="tab-preview" aria-controls="preview"></ha-tab-group-tab>
    <ha-tab-group-tab slot="nav" panel="references" id="tab-references" aria-controls="references"></ha-tab-group-tab>
    <ha-tab-group-tab slot="nav" panel="history" id="tab-history" aria-controls="history"></ha-tab-group-tab>
    <ha-tab-group-tab slot="nav" panel="settings" id="tab-settings" aria-controls="settings"></ha-tab-group-tab>
  </ha-tab-group>
  <progress id="progress" aria-labelledby="progressText" hidden></progress>
  <p class="secondary" id="progressText" role="status" hidden></p>
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
      <ha-select id="captureState"></ha-select><ha-select id="captureGroup"></ha-select>
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
  <section id="history" role="tabpanel" aria-labelledby="tab-history" hidden>
    <div id="historySettings"><ha-select id="historyMode"></ha-select>
      <ha-input type="number" id="historyLimit" min="1" max="100" required step="1"></ha-input>
      <div class="row"><ha-button id="saveHistory"></ha-button><ha-button appearance="plain" id="refreshHistory"></ha-button></div>
    </div>
    <p id="historyMessage" class="secondary"></p><div class="grid" id="historyGrid"></div>
  </section>
  <section id="settings" role="tabpanel" aria-labelledby="tab-settings" hidden>
    <ha-select id="engine"></ha-select>
    <p id="thresholdsHint" class="secondary"></p>
    <div id="thresholdFields" class="fields"></div>
    <fieldset><legend id="cropLabel"></legend>
      <p id="regionHint" class="secondary"></p>
      <div id="regionFields" class="fields"></div>
    </fieldset>
    <ha-button id="save" variant="brand"></ha-button>
    <p id="dirty" class="secondary"></p>
  </section>
  <div id="dialogSlot"></div>
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
  private cancelDrawing: () => void;
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
    this.get("nav").addEventListener("wa-tab-show", (event) => {
      const tab = (event as CustomEvent<{ name: Tab }>).detail.name;
      if (tab !== this.tab) this.show(tab);
    });
    this.shadowRoot!.addEventListener("selected", (event) => {
      const select = event.target;
      if (select instanceof HTMLElement && select.localName === "ha-select") {
        (select as HaSelect).value = (event as CustomEvent<{ value: string }>).detail.value;
        if (select.id === "engine") {
          this.renderEngine();
          this.renderDirty();
        }
      }
    });
    this.onClick("refreshHistory", () => this.loadHistory());
    this.onClick("saveHistory", () => this.task(async signal => {
      const field = this.get<NumberField>("historyLimit");
      if (!field.reportValidity()) return;
      await this.update("history_settings", {
        mode: this.get<HaSelect>("historyMode").value, limit: Number(field.value),
      }, signal);
      this.renderHistory();
      this.feedback(this.labels.saved);
    }));
    this.onClick("reload", () => this.load());
    this.onClick("test", () => this.evaluate());
    this.onClick("benchmark", () => this.benchmark());
    this.onClick("draw", () => {
      this.drawing = !this.drawing;
      this.cancelDrawing();
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
        const state_id = this.get<HaSelect>("captureState").value;
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
              this.get<HaSelect>("captureGroup").value ===
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
      const isCoordinate = coordinates.some((key) => key === field);
      const input = numberField(isCoordinate ? 100 : 255);
      input.id = field;
      input.addEventListener("input", () => {
        if (isCoordinate) {
          try {
            this.draftRegion = this.readRegion();
            this.renderRegion();
          } catch {
            /* incomplete entry */
          }
        }
        this.renderDirty();
      });
      this.get(isCoordinate ? "regionFields" : "thresholdFields").append(input);
    }

    const box = this.get("imagebox");
    this.cancelDrawing = bindRegionDrawing(box, () => this.drawing,
      region => this.renderRegion(region), region => {
        this.drawing = false;
        this.setRegion(region);
      });
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
      available !== this.available ||
      (profile !== undefined && !this.scope && this.isConnected);
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
      this.renderBenchmark();
      if (this.tab === "history") this.renderHistory();
      else this.renderGallery();
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
      saveHistory: "save", refreshHistory: "refreshHistory",
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
    };
    for (const tab of tabs) names["tab-" + tab] = tab;
    for (const key of ["max_distance", "min_margin", ...coordinates] as const)
      this.get(key).setAttribute("label", this.labels[key]);
    this.get("historyLimit").setAttribute("label", this.labels.historyLimit);
    for (const [id, label] of Object.entries(names)) {
      const icon = actionIcons[label];
      if (icon) actionLabel(this.get(id), this.labels[label], icon);
      else this.get(id).textContent = this.labels[label];
    }
    this.get<HTMLInputElement>("stateName").setAttribute(
      "aria-label",
      this.labels.new_state,
    );
    this.get<HTMLInputElement>("stateName").placeholder = this.labels.new_state;
    const engine = this.get<HaSelect>("engine");
    engine.label = this.labels.engine;
    engine.options = engines.map((value) => ({ value, label: engineNames[value] }));
    this.renderEngine();
    const mode = this.get<HaSelect>("historyMode");
    mode.label = this.labels.historyMode;
    mode.options = ["off", "changes", "all"].map(value => ({
      value, label: this.labels[value as "off" | "changes" | "all"],
    }));
    this.get<HaSelect>("captureState").label = this.labels.state;
    this.get<HaSelect>("captureGroup").label = this.labels.imageUse;
    this.get<HTMLImageElement>("frame").alt = this.labels.preview;
    this.get("nav").setAttribute("aria-label", "Image Lab");
  }

  private reset() {
    this.scope?.abort();
    this.progress();
    this.get("dialogSlot").replaceChildren();
    this.scope = undefined;
    this.gallery = undefined;
    this.result = undefined;
    this.benchmarkResult = undefined;
    this.benchmarking = false;
    this.captured = false;
    this.busy = false;
    this.drawing = false;
    this.cancelDrawing();
    this.draftRegion = null;
    this.matchId = undefined;
    this.setFrame();
    this.clearThumbnails();
    this.get("gallery").replaceChildren();
    this.get("historyGrid").replaceChildren();
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
    this.get("addState").toggleAttribute(
      "disabled",
      !this.gallery || this.busy,
    );
    this.get("folder").toggleAttribute("disabled", !this.gallery || this.busy);
    const benchmark = this.get("benchmark");
    benchmark.hidden = !this.gallery?.references.some((ref) => ref.validation);
    benchmark.toggleAttribute("disabled", this.busy);
    benchmark.toggleAttribute("loading", this.benchmarking);
    actionLabel(benchmark, this.labels.benchmark, actionIcons.benchmark!);
    this.get("references").setAttribute("aria-busy", String(this.busy));
    this.get("gallery").inert = this.busy;
    this.get("history").inert = this.busy || !this.gallery;
    this.get("reload").hidden = Boolean(this.gallery) || this.busy;
    this.get("draw").hidden = !this.frameUrl;
    const draw = this.drawing ? "stop_draw" : "draw";
    actionLabel(this.get("draw"), this.labels[draw], actionIcons[draw]!);
    this.get("whole").hidden = !this.draftRegion;
    this.get("imagebox").classList.toggle("drawing", this.drawing);
    this.get("previewHint").textContent = this.busy ? "" : this.drawing
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
    this.get("nav").setAttribute("active", tab);
    for (const key of tabs) this.get(key).hidden = tab !== key;
    if (tab === "references") this.renderGallery();
    else if (tab === "history") { this.renderHistory(); void this.loadHistory(); }
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
      if (this.tab === "history") this.renderHistory();
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
    this.progress(this.labels.working);
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
        this.progress();
        this.refresh();
      }
    }
  }

  private progress(label = "", done?: number, total = 1) {
    const bar = this.get<HTMLProgressElement>("progress");
    const status = this.get("progressText");
    bar.max = total;
    if (done === undefined) bar.removeAttribute("value");
    else bar.value = done;
    bar.hidden = status.hidden = !label;
    status.textContent = label;
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
    const captureState = this.get<HaSelect>("captureState");
    this.stateOptions(captureState, captureState.value, false);
    this.groupOptions(this.get("captureGroup"));
  }

  private stateOptions(select: HaSelect, state = select.value, first = true) {
    select.options = (this.gallery?.states ?? []).map(({ id, name }) => ({
      value: id, label: name,
    }));
    select.value = select.options.some((option) => option.value === state)
      ? state : (first ? select.options[0]?.value : undefined) ?? "";
  }

  private groupOptions(select: HaSelect, validation = select.value === "validation") {
    select.options = [
      { label: this.labels.training, value: "training" },
      { label: this.labels.validation, value: "validation" },
    ];
    select.value = validation ? "validation" : "training";
  }

  private async evaluate(reference_id?: string) {
    await this.task(async (signal) => {
      const settings = this.readSettings();
      this.setFrame();
      this.captured = false;
      this.result = undefined;
      this.matchId = undefined;
      this.drawing = false;
      this.cancelDrawing();
      this.renderResult();
      this.show("preview");
      const result = await this.request<Result>("/test", signal, {
        settings,
        ...(reference_id && { reference_id }),
      });
      this.result = result;
      this.matchId = result.data.reference_id ?? undefined;
      this.stateOptions(this.get("captureState"), result.data.state_id ?? "", false);
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
    if (result.data.engine) {
      const engine = document.createElement("p");
      engine.className = "secondary";
      engine.textContent = engineNames[result.data.engine];
      panel.append(engine);
    }
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
      const similarity = result.data.engine === "tarsius";
      const order = (state: string) => Object.hasOwn(scores, state)
        ? (similarity ? -scores[state] : scores[state]) : Infinity;
      const rows = Object.entries(result.data.ref_counts ?? {})
        .sort(([a], [b]) => order(a) - order(b))
        .map(([state, count]) => [
          state,
          Object.hasOwn(scores, state) ? String(scores[state]) : "–",
          String(count),
        ]);
      panel.append(this.resultTable(
        [this.labels.state, similarity ? this.labels.similarity : this.labels.score, this.labels.count], rows,
      ));
    }
  }

  private renderEngine() {
    const tarsius = this.get<HaSelect>("engine").value === "tarsius";
    this.get("thresholdFields").hidden = tarsius;
    this.get("thresholdsHint").textContent = this.labels[tarsius ? "tarsius_settings" : "thresholds"];
  }

  private fillSettings() {
    if (!this.gallery) return;
    const { settings } = this.gallery;
    this.get<HaSelect>("engine").value = settings.engine;
    this.renderEngine();
    this.get<NumberField>("max_distance").value = String(
      settings.max_distance,
    );
    this.get<NumberField>("min_margin").value = String(
      settings.min_margin,
    );
    this.setRegion(settings.region);
  }

  private readRegion(): Region | null {
    const fields = coordinates.map((name) => this.get<NumberField>(name));
    if (fields.every((field) => !field.value && field.checkValidity()))
      return null;
    if (fields.some((field) => !field.checkValidity() || !field.value))
      throw new Error("invalid_settings");
    const [x, y, width, height] = fields.map(
      (field) => Number(field.value) / 100,
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
    const max = this.get<NumberField>("max_distance");
    const margin = this.get<NumberField>("min_margin");
    const engine = this.get<HaSelect>("engine").value === "tarsius" ? "tarsius" : "pillow";
    const valid = max.checkValidity() && !!max.value && margin.checkValidity() && !!margin.value;
    if (engine === "pillow" && !valid) throw new Error("invalid_settings");
    return {
      engine, region: this.readRegion(),
      max_distance: valid ? Number(max.value) : this.gallery!.settings.max_distance,
      min_margin: valid ? Number(margin.value) : this.gallery!.settings.min_margin,
    };
  }

  private renderDirty() {
    const status = this.get("dirty");
    status.textContent = "";
    let changed = false;
    if (this.gallery) {
      try {
        const draft = this.readSettings();
        const saved = this.gallery.settings;
        changed = draft.engine !== saved.engine || draft.max_distance !== saved.max_distance ||
          draft.min_margin !== saved.min_margin ||
          coordinates.some((key) =>
            Math.abs((draft.region?.[key] ?? -1) - (saved.region?.[key] ?? -1)) > 1e-9);
        if (changed) status.textContent = this.labels.dirty;
      } catch {
        status.textContent = this.labels.invalid_settings;
      }
    }
    this.get("save").toggleAttribute("disabled", this.busy || !changed);
  }

  private setRegion(region: Region | null) {
    this.draftRegion = region;
    for (const key of coordinates)
      this.get<NumberField>(key).value = region
        ? String(Math.round(region[key] * 10000) / 100)
        : "";
    this.renderRegion();
    this.refresh();
  }

  private renderRegion(region = this.draftRegion) {
    paintRegion(this.get("region"), this.frameUrl ? region : null);
  }

  private button(label: Label, action: () => unknown) {
    const button = document.createElement("ha-button");
    button.setAttribute("appearance", "plain");
    button.setAttribute("size", "s");
    actionLabel(button, this.labels[label], actionIcons[label]!);
    button.addEventListener("click", () => void action());
    return button;
  }

  private confirmRemoval(question: Label, name: string, remove: () => void) {
    const dialog = document.createElement("ha-dialog");
    dialog.setAttribute("header-title", this.labels[question]);
    dialog.setAttribute("width", "small");
    const item = document.createElement("p");
    item.textContent = name;
    const footer = document.createElement("ha-dialog-footer");
    footer.slot = "footer";
    const cancel = this.button("cancel", () => dialog.removeAttribute("open"));
    cancel.slot = "secondaryAction";
    const confirm = this.button("remove", () => {
      dialog.removeAttribute("open");
      remove();
    });
    confirm.slot = "primaryAction";
    confirm.setAttribute("variant", "danger");
    footer.append(cancel, confirm);
    dialog.append(item, footer);
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    this.get("dialogSlot").replaceChildren(dialog);
    dialog.setAttribute("open", "");
  }

  private observeThumbnails() {
    this.thumbnailObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target as HTMLImageElement;
        observer.unobserve(image);
        void this.thumbnail(image);
      }
    });
  }

  private loadHistory() {
    return this.task(async signal => {
      this.gallery = await this.request<Gallery>("", signal);
      if (this.tab === "history") this.renderHistory();
    });
  }

  private inspectImage(id: string, title: string) {
    return this.task(async signal => {
      const blob = await this.fetchImage(id, signal);
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const dialog = document.createElement("ha-dialog");
      dialog.setAttribute("header-title", title);
      const image = document.createElement("img");
      image.className = "original";
      image.alt = title;
      image.src = url;
      const footer = document.createElement("ha-dialog-footer");
      footer.slot = "footer";
      const close = this.button("close", () => dialog.removeAttribute("open"));
      close.slot = "primaryAction";
      footer.append(close);
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

  private renderHistory() {
    this.clearThumbnails();
    const grid = this.get("historyGrid");
    grid.replaceChildren();
    if (!this.gallery) return;
    this.get<HaSelect>("historyMode").value = this.gallery.history_settings.mode;
    this.get<NumberField>("historyLimit").value = String(this.gallery.history_settings.limit);
    this.get("historyMessage").textContent = !this.gallery.history.length
      ? this.labels.emptyHistory : !this.gallery.states.length ? this.labels.no_states : "";
    this.observeThumbnails();
    for (const item of [...this.gallery.history].reverse()) {
      const card = document.createElement("article");
      card.className = "reference";
      const image = document.createElement("img");
      image.alt = this.labels.capture;
      image.dataset.reference = item.id;
      this.thumbnailObserver?.observe(image);
      const title = document.createElement("strong");
      title.textContent = item.state_id ? item.state : this.labels.unknown;
      const stamp = document.createElement("span");
      stamp.textContent = new Date(item.time).toLocaleString(this.client?.locale.language, {
        timeZone: this.client?.config?.time_zone,
      }) + " · " + engineNames[item.engine];
      const open = document.createElement("button");
      open.type = "button";
      open.className = "openImage";
      open.setAttribute("aria-label", this.labels.viewCapture);
      open.onclick = () => void this.inspectImage(item.id, stamp.textContent!);
      open.append(image);
      card.append(open, title, stamp);
      if (item.reason && Object.hasOwn(this.labels, item.reason)) {
        const reason = document.createElement("span");
        reason.className = "secondary";
        reason.textContent = this.labels[item.reason as Label];
        card.append(reason);
      }
      const ref = this.gallery.references.find(r => r.id === item.id);
      if (this.gallery.states.length) {
        const state = document.createElement("ha-select") as HaSelect;
        state.label = this.labels.expected;
        this.stateOptions(state, ref?.state_id ?? item.state_id ?? "");
        const group = document.createElement("ha-select") as HaSelect;
        group.label = this.labels.imageUse;
        this.groupOptions(group, ref?.validation ?? false);
        card.append(state, group, this.button("correct", () => this.task(async signal => {
          await this.update("correct", { capture_id: item.id, state_id: state.value,
            validation: group.value === "validation" }, signal);
          this.renderHistory();
          this.feedback(this.labels.capture_saved);
        })));
      }
      if (ref) {
        const assigned = document.createElement("span");
        assigned.textContent = [this.labels[ref.validation ? "validation" : "training"],
          this.gallery.states.find(s => s.id === ref.state_id)?.name].join(" · ");
        card.append(assigned);
      }
      grid.append(card);
    }
  }

  private renderGallery() {
    this.clearThumbnails();
    const node = this.get("gallery");
    node.replaceChildren();
    this.get("stateMessage").textContent =
      this.gallery && !this.gallery.states.length ? this.labels.no_states : "";
    if (!this.gallery || this.tab !== "references") return;
    this.observeThumbnails();
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
      const remove = this.button("remove", () =>
        this.confirmRemoval("confirm_state", state.name, () =>
          this.galleryMutation("delete_state", { state_id: state.id })),
      );
      controls.append(name, rename, remove);
      section.append(title, controls);
      for (const validation of [false, true]) {
        const heading = document.createElement("h4");
        heading.textContent =
          this.labels[validation ? "validation" : "training"];
        const description = document.createElement("p");
        description.className = "secondary";
        description.textContent = this.labels[validation ? "validationHelp" : "trainingHelp"];
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
          description,
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
    const state = document.createElement("ha-select") as HaSelect;
    state.label = this.labels.state;
    this.stateOptions(state, ref.state_id);
    const group = document.createElement("ha-select") as HaSelect;
    group.label = this.labels.imageUse;
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
    const remove = this.button("remove", () =>
      this.confirmRemoval("confirm_remove", ref.name, () =>
        this.galleryMutation("delete", { reference_id: ref.id })),
    );
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
      const images = state_id ? files : files.filter(file =>
        file.webkitRelativePath.split("/").length === 3 && /\.(jpe?g|png|webp)$/i.test(file.name));
      for (const [index, file] of images.entries()) {
        signal.throwIfAborted();
        this.progress(`${this.labels.importing} ${index + 1}/${images.length} · ${file.name}`, index, images.length);
        try {
          let target = state_id;
          if (!target) {
            const parts = file.webkitRelativePath.split("/");
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
      if (!image.isConnected || signal.aborted || (this.tab !== "references" && this.tab !== "history"))
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
