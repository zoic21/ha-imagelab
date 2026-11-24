import { actionLabel } from "./action.js";
import type { NumberField } from "./number-field.js";
import { historyStrings } from "./translations.js";

export type Capture = { id: string; time: string; manual?: boolean };
export type HistorySettingsValue = { mode: "all" | "changes" | "off"; limit: number };

type Context = { locale: { language: string }; config?: { time_zone: string } };
type HistoryOptions<T extends Capture> = {
  image: (id: string, signal: AbortSignal, thumbnail: boolean) => Promise<Blob>;
  summary: (item: T) => { text: string; color?: string; uncertain?: boolean };
  details: (item: T, content: HTMLElement, image: HTMLImageElement, signal: AbortSignal) => void | Promise<void>;
};

const labelsFor = (language?: string) =>
  language?.startsWith("fr") ? historyStrings.fr : historyStrings.en;

export const historyMarkup = `
  <div class="history-toolbar">
    <h3 data-history-label></h3>
    <ha-button data-history-refresh appearance="plain"></ha-button>
  </div>
  <p class="secondary" data-history-status role="status" hidden></p>
  <div data-history-entries></div>
  <div data-history-dialog></div>`;

export const historySettingsMarkup = (standalone = true) => `
  <h3 data-history-settings-title></h3>
  <div class="history-fields">
    <ha-select data-history-mode></ha-select>
    <div class="history-limit-row">
      <p class="secondary" data-history-help></p>
      <ha-input data-history-limit type="number" min="1" max="100" step="1" required></ha-input>
    </div>
  </div>
  ${standalone ? '<div class="history-actions"><ha-button data-history-save variant="brand" size="s"></ha-button></div>' : ''}
  <p class="secondary" data-history-save-status role="status" hidden></p>`;

export const historyStyles = `
  .history-toolbar, .history-actions {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  }
  .history-toolbar { justify-content: space-between; }
  .history-toolbar h3, [data-history-settings-title] { margin: 0; font-size: 1rem; }
  .history-fields { display: grid; gap: var(--ha-space-2, 8px); margin-top: var(--ha-space-2, 8px); }
  .history-limit-row {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 112px); align-items: center;
    gap: var(--ha-space-2, 8px);
  }
  .history-fields ha-select, .history-fields ha-input { min-width: 0; }
  .history-limit-row ha-input { --ha-input-padding-bottom: 0; }
  .history-limit-row p { margin: 0; font-size: var(--ha-font-size-s, 12px); }
  .history-actions { justify-content: flex-end; margin-top: var(--ha-space-2, 8px); }
  .history-day { margin: 12px 0 2px; color: var(--secondary-text-color); font-size: .95em; font-weight: 500; }
  .history-list { margin: 0; padding: 0; list-style: none; }
  .history-list li + li { border-top: 1px solid var(--divider-color); }
  .history-entry {
    width: 100%; --ha-button-height: auto; --ha-button-border-radius: 0;
    --ha-button-label-overflow: visible; color: var(--primary-text-color);
  }
  .history-entry::part(base) { width: 100%; padding: 0 var(--ha-space-2, 8px); }
  .history-entry::part(label) { width: 100%; min-width: 0; }
  .history-entry-label {
    display: grid; grid-template-columns: 108px minmax(58px, 1fr) fit-content(200px) 20px;
    gap: 10px; align-items: center; width: 100%; padding: 8px 0; text-align: start;
    white-space: normal; font-weight: 400; color: var(--primary-text-color);
  }
  .history-thumbnail {
    display: grid; place-items: center; overflow: hidden; aspect-ratio: 16 / 9;
    border-radius: var(--ha-border-radius-md, 8px); background: var(--secondary-background-color);
    color: var(--secondary-text-color);
  }
  .history-thumbnail img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
  .history-time { display: block; font-variant-numeric: tabular-nums; font-weight: 500; }
  .history-trigger, .history-detail-meta { color: var(--secondary-text-color); font-size: .9em; }
  .history-summary {
    display: inline-flex; align-items: center; justify-self: end; gap: 5px;
    min-width: 0; max-width: 100%; overflow-wrap: anywhere;
    background: var(--secondary-background-color); border-radius: 16px; padding: 3px 8px;
  }
  .history-summary.uncertain {
    background: color-mix(in srgb, var(--warning-color) 18%, var(--card-background-color));
  }
  .history-summary-text {
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  }
  .history-color { flex: none; width: 12px; height: 12px; border: 1px solid var(--divider-color); border-radius: 50%; }
  .history-chevron { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .history-image { display: block; width: 100%; max-height: 55dvh; object-fit: contain; margin: auto; border-radius: var(--ha-border-radius-md, 8px); }
  .history-detail p { overflow-wrap: anywhere; }
  .history-correction { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
  .history-correction ha-select { flex: 1 1 190px; min-width: 0; }
  @media (max-width: 480px) {
    .history-entry-label { grid-template-columns: 62px minmax(58px, 1fr) minmax(0, 36%) 14px; gap: 6px; }
    .history-summary { font-size: .9em; padding-inline: 6px; }
    .history-chevron { --mdc-icon-size: 14px; }
  }`;

function element<T extends HTMLElement = HTMLElement>(root: HTMLElement, key: string): T {
  return root.querySelector<T>(`[data-history-${key}]`)!;
}

function icon(name: string, className = "") {
  const glyph = document.createElement("ha-icon");
  glyph.className = className;
  glyph.setAttribute("icon", `mdi:${name}`);
  glyph.setAttribute("aria-hidden", "true");
  return glyph;
}

export class CaptureHistory<T extends Capture> {
  private labels = historyStrings.en;
  private context?: Context;
  private scope?: AbortController;
  private observer?: IntersectionObserver;
  private urls: string[] = [];
  private detailScope?: AbortController;

  constructor(private root: HTMLElement, refresh: () => void) {
    element(root, "refresh").onclick = refresh;
    this.localize();
  }

  localize(context?: Context) {
    this.context = context;
    this.labels = labelsFor(context?.locale.language);
    element(this.root, "label").textContent = this.labels.captures;
    actionLabel(element(this.root, "refresh"), this.labels.refresh, "refresh");
  }

  status(message = "") {
    const status = element(this.root, "status");
    status.hidden = !message;
    status.textContent = message;
  }

  loading(value: boolean) {
    element(this.root, "refresh").toggleAttribute("loading", value);
    this.root.setAttribute("aria-busy", String(value));
    this.status(value ? this.labels.loading : "");
  }

  failed() {
    this.status(this.labels.failed);
  }

  clear() {
    this.scope?.abort();
    this.detailScope?.abort();
    this.observer?.disconnect();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    element(this.root, "entries").replaceChildren();
    this.loading(false);
  }

  render(items: T[], options: HistoryOptions<T>) {
    this.clear();
    if (!items.length) {
      this.status(this.labels.empty);
      return;
    }
    const { signal } = this.scope = new AbortController();
    const entries = element(this.root, "entries");
    const timeZone = this.context?.config?.time_zone;
    const language = this.context?.locale.language;
    const day = new Intl.DateTimeFormat(language, { timeZone, dateStyle: "long" });
    const clock = new Intl.DateTimeFormat(language, { timeZone, timeStyle: "medium" });
    this.observer = new IntersectionObserver((intersections, observer) => {
      for (const intersection of intersections) {
        if (!intersection.isIntersecting) continue;
        const image = intersection.target as HTMLElement;
        observer.unobserve(image);
        void this.thumbnail(image, options, signal);
      }
    });

    const groups = new Map<string, HTMLUListElement>();
    for (const item of [...items].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))) {
      const instant = new Date(item.time);
      const date = day.format(instant);
      let list = groups.get(date);
      if (!list) {
        const group = document.createElement("section");
        const heading = document.createElement("h4");
        heading.className = "history-day";
        heading.textContent = date;
        list = document.createElement("ul");
        list.className = "history-list";
        groups.set(date, list);
        group.append(heading, list);
        entries.append(group);
      }
      const row = document.createElement("li");
      const button = document.createElement("ha-button");
      button.className = "history-entry";
      button.setAttribute("appearance", "plain");
      button.setAttribute("variant", "neutral");
      const label = document.createElement("span");
      label.className = "history-entry-label";
      const thumb = document.createElement("span");
      thumb.className = "history-thumbnail";
      thumb.dataset.captureId = item.id;
      thumb.setAttribute("aria-hidden", "true");
      thumb.append(icon("image-outline"));
      const metadata = document.createElement("span");
      const time = document.createElement("time");
      time.className = "history-time";
      time.dateTime = item.time;
      time.textContent = clock.format(instant);
      const trigger = document.createElement("span");
      trigger.className = "history-trigger";
      trigger.textContent = this.labels[item.manual ? "manual" : "automatic"];
      metadata.append(time, trigger);
      const summary = options.summary(item);
      const chip = document.createElement("span");
      if (summary.text) {
        chip.className = "history-summary";
        chip.classList.toggle("uncertain", Boolean(summary.uncertain));
        const result = document.createElement("span");
        result.className = "history-summary-text";
        result.textContent = summary.text;
        chip.append(result);
        if (summary.color && /^#[0-9a-f]{6}$/i.test(summary.color)) {
          const color = document.createElement("span");
          color.className = "history-color";
          color.style.backgroundColor = summary.color;
          chip.prepend(color);
        }
      }
      label.append(thumb, metadata, chip, icon("chevron-right", "history-chevron"));
      button.append(label);
      button.onclick = () => void this.open(item, `${date} · ${time.textContent} · ${trigger.textContent}`, button, options);
      row.append(button);
      list.append(row);
      this.observer.observe(thumb);
    }
  }

  private async thumbnail(target: HTMLElement, options: HistoryOptions<T>, signal: AbortSignal) {
    try {
      const blob = await options.image(target.dataset.captureId!, signal, true);
      if (signal.aborted || !target.isConnected) return;
      const url = URL.createObjectURL(blob);
      this.urls.push(url);
      const image = document.createElement("img");
      image.alt = "";
      image.src = url;
      target.replaceChildren(image);
    } catch {
      // Keep the placeholder if a capture has expired or its thumbnail cannot be read.
    }
  }

  private async open(item: T, metadata: string, button: HTMLElement, options: HistoryOptions<T>) {
    this.detailScope?.abort();
    const controller = this.detailScope = new AbortController();
    const { signal } = controller;
    button.setAttribute("loading", "");
    try {
      const blob = await options.image(item.id, signal, false);
      signal.throwIfAborted();
      const dialog = document.createElement("ha-dialog");
      dialog.setAttribute("header-title", this.labels.capture);
      const content = document.createElement("div");
      content.className = "history-detail";
      const image = document.createElement("img");
      image.className = "history-image";
      image.alt = this.labels.capture;
      const stamp = document.createElement("p");
      stamp.className = "history-detail-meta";
      stamp.textContent = metadata;
      content.append(image, stamp);
      await options.details(item, content, image, signal);
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      image.src = url;
      const release = () => {
        URL.revokeObjectURL(url);
        signal.removeEventListener("abort", release);
        dialog.remove();
      };
      signal.addEventListener("abort", release, { once: true });
      dialog.addEventListener("closed", () => controller.abort(), { once: true });
      dialog.append(content);
      element(this.root, "dialog").append(dialog);
      dialog.setAttribute("open", "");
    } catch {
      if (!signal.aborted) this.failed();
    } finally {
      button.removeAttribute("loading");
    }
  }
}

export class HistorySettings {
  private labels = historyStrings.en;
  private value?: HistorySettingsValue;
  private pending = false;
  private scope?: AbortController;
  private readonly mode;
  private readonly limit;
  private readonly button;

  constructor(
    private root: HTMLElement,
    private comparison: boolean,
    private save?: (value: HistorySettingsValue, signal: AbortSignal) => Promise<void>,
  ) {
    this.mode = element<HTMLElement & { value: string; label: string; options: { value: string; label: string }[] }>(root, "mode");
    this.limit = element<NumberField>(root, "limit");
    this.button = root.querySelector<HTMLElement>("[data-history-save]");
    this.mode.addEventListener("selected", event => {
      this.mode.value = (event as CustomEvent<{value: string}>).detail.value;
      this.refresh();
    });
    this.limit.addEventListener("input", () => this.refresh());
    this.button?.addEventListener("click", () => void this.submit());
    this.localize();
    this.refresh();
  }

  localize(language?: string) {
    this.labels = labelsFor(language);
    element(this.root, "settings-title").textContent = this.labels.title;
    element(this.root, "help").textContent = this.labels.help;
    this.limit.setAttribute("label", this.labels.limit);
    this.mode.label = this.labels.mode;
    const options = this.comparison ? ["all", "changes", "off"] as const : ["all", "off"] as const;
    this.mode.options = options.map(value => ({ value, label: this.labels[value] }));
    if (this.button) actionLabel(this.button, this.labels.save, "content-save-outline");
  }

  setValue(value?: HistorySettingsValue) {
    this.scope?.abort();
    this.pending = false;
    this.value = value;
    this.mode.value = value?.mode ?? "";
    this.limit.value = value ? String(value.limit) : "";
    this.status();
    this.refresh();
  }

  failed() {
    this.status(this.labels.settingsFailed);
  }

  get changed(): boolean {
    return Boolean(this.value && (this.mode.value !== this.value.mode || Number(this.limit.value) !== this.value.limit));
  }

  get draft(): HistorySettingsValue | undefined {
    const limit = Number(this.limit.value);
    if (!this.value || !this.limit.checkValidity() || !Number.isInteger(limit) || limit < 1 || limit > 100) return;
    return { mode: this.mode.value as HistorySettingsValue["mode"], limit };
  }

  private status(message = "") {
    const status = element(this.root, "save-status");
    status.hidden = !message;
    status.textContent = message;
  }

  private refresh() {
    const disabled = this.pending || !this.value;
    this.mode.toggleAttribute("disabled", disabled);
    this.limit.toggleAttribute("disabled", disabled);
    this.button?.toggleAttribute("disabled", disabled || !this.changed);
    this.button?.toggleAttribute("loading", this.pending);
  }

  private async submit() {
    if (this.pending || !this.save || !this.limit.reportValidity()) return;
    const value = this.draft;
    if (!value) return;
    const { signal } = this.scope = new AbortController();
    this.pending = true;
    this.status();
    this.refresh();
    try {
      await this.save(value, signal);
      if (signal.aborted) return;
      this.value = value;
      this.status(this.labels.saved);
    } catch {
      if (!signal.aborted) this.failed();
    } finally {
      if (!signal.aborted) {
        this.pending = false;
        this.refresh();
      }
    }
  }
}
