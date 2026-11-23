import { actionLabel } from "./action.js";
import { numberField, type NumberField } from "./number-field.js";
import { bindRegionDrawing, paintRegion, type Region } from "./region.js";
import { meterStrings, panelStrings } from "./translations.js";

const kinds = ["water", "gas", "energy"] as const;
const defaultRates = { water: 3, gas: 6, energy: 12 };
type Kind = typeof kinds[number];
type Dial = { region: Region | null; counterclockwise: boolean };
type Layout = {
  kind: Kind; max_rate: number; rotation: number; wheels: number; decimal_wheels: number;
  digits: Region | null; dials: Dial[];
};
type Draft = { settings: Partial<Layout>; initialized: boolean; revision: string };
type Select = HTMLElement & { label: string; value: string; options: { value: string; label: string }[] };
export type MeterResult = {
  value?: number | null; candidate?: number | null; meter_value?: number | null;
  confidence?: number | null; unit?: string; reason?: string | null;
};

export function meterText(result: MeterResult, language: string, compact = false): string {
  const labels = language.startsWith("fr") ? meterStrings.fr : meterStrings.en;
  const value = result.reason ? result.candidate : result.value;
  const format = (n: number) => [new Intl.NumberFormat(language, { maximumFractionDigits: 15 }).format(n),
    result.unit].filter(Boolean).join(" ");
  if (compact) return result.reason || value == null ? labels.rejected : format(value);
  const parts = [];
  if (value != null) parts.push((result.reason ? labels.candidate : labels.reading) + " · " + format(value));
  if (result.reason) parts.push(labels.reasons[result.reason] ?? labels.rejected);
  if (result.reason && result.meter_value != null) parts.push(labels.retained + " · " + format(result.meter_value));
  if (result.confidence != null) parts.push(labels.confidence + " · " +
    new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(result.confidence));
  return parts.join(" · ");
}

export const meterStyles = `
  .meter-editor { display:grid; gap:16px; }
  .meter-editor > *, .meter-grid > * { min-width:0; }
  @media (min-width: 760px) {
    .meter-editor { grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); gap:24px; }
    .meter-preview { position:sticky; top:0; align-self:start; background:var(--card-background-color); }
  }
  .meter-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-bottom:6px; }
  .meter-toolbar ha-icon-button {
    --ha-icon-button-size:var(--ha-space-10,40px);
    --ha-icon-button-padding-inline:0;
  }
  .meter-toolbar [data-pan][aria-pressed="true"] {
    border-radius:50%; background:var(--ha-color-fill-neutral-normal-active);
  }
  .meter-toolbar [data-capture] { margin-inline-start:auto; }
  .meter-toolbar [data-reset-zoom] {
    min-width:58px; font-variant-numeric:tabular-nums;
  }
  .meter-viewport {
    position:relative; height:clamp(200px,38dvh,400px); overflow:auto; scrollbar-width:none;
    border-radius:var(--ha-border-radius-md,8px);
    background:var(--ha-color-surface-lowered,var(--secondary-background-color));
  }
  @media (min-width: 760px) {
    .meter-viewport { height:clamp(220px,calc(100dvh - 385px),560px); }
  }
  .meter-viewport[data-zoomed] { overscroll-behavior:contain; }
  .meter-extent { position:relative; min-width:100%; min-height:100%; display:grid; place-items:center; }
  .meter-frame { position:relative; overflow:hidden; background:#111; touch-action:none; user-select:none; cursor:crosshair; }
  .meter-viewport[data-panning] .meter-frame { cursor:grab; }
  .meter-viewport[data-panning] .meter-frame:active { cursor:grabbing; }
  .meter-frame img { display:block; width:100%; height:100%; max-height:none; }
  .meter-frame .selection:not(.active) { border-style:dashed; background:transparent; opacity:.65; }
  .meter-section + .meter-section { border-top:1px solid var(--divider-color); margin-top:8px; padding-top:10px; }
  .meter-section h3 { margin:0 0 8px; font-size:1rem; }
  .meter-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .meter-grid > :only-child { grid-column:1 / -1; }
  .meter-tools { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
  .meter-dials { display:grid; gap:4px; }
  .meter-dials ha-button { min-width:0; }
  .meter-dials ha-button::part(base) { width:100%; justify-content:flex-start; }
  .meter-dials ha-button::part(label) { white-space:normal; text-align:start; }
  .meter-settings ha-select { display:block; }
  .meter-coordinates { margin-top:6px; }
  .meter-coordinate-content { display:grid; gap:8px; padding:8px; }
  .meter-coordinate-group p { margin:0 0 4px; }
  .meter-coordinate-content ha-button { justify-self:start; }
  .meter-initial-warning { margin-top:8px; }
  .meter-initial-warning ha-button { margin-top:4px; }
  .meter-rebase-content { padding:0 8px 4px; }
  .meter-rebase-content ha-input { display:block; }
  .meter-dialog .meter-footer { flex-direction:column; align-items:stretch; gap:8px; }
  .meter-footer p, .meter-footer ha-alert { margin:0; }
  .meter-status { font-variant-numeric:tabular-nums; }
`;

function bindMeterPreview(
  viewport: HTMLElement, canvas: HTMLElement, stage: HTMLElement, image: HTMLImageElement,
  region: () => Region | null, blocked: () => boolean,
  buttons: { out: HTMLElement; reset: HTMLElement; in: HTMLElement; pan: HTMLElement },
  labels: typeof meterStrings.en, language: string, signal: AbortSignal,
) {
  const levels = [1, 1.5, 2, 3, 4];
  const percentage = new Intl.NumberFormat(language, { style: "percent" });
  let level = 0;
  let panning = false;
  let drag: { pointer: number; x: number; y: number } | undefined;

  const viewportCenter = () => ({
    x: (viewport.scrollLeft + viewport.clientWidth / 2 - stage.offsetLeft) / stage.offsetWidth,
    y: (viewport.scrollTop + viewport.clientHeight / 2 - stage.offsetTop) / stage.offsetHeight,
  });
  const resize = (center: { x: number; y: number }) => {
    if (!image.naturalWidth || !viewport.clientWidth || !viewport.clientHeight) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = Math.min(viewport.clientWidth, viewport.clientHeight * ratio) * levels[level];
    const height = width / ratio;
    stage.style.width = width + "px";
    stage.style.height = height + "px";
    canvas.style.width = Math.max(width, viewport.clientWidth) + "px";
    canvas.style.height = Math.max(height, viewport.clientHeight) + "px";
    viewport.scrollLeft = stage.offsetLeft + center.x * width - viewport.clientWidth / 2;
    viewport.scrollTop = stage.offsetTop + center.y * height - viewport.clientHeight / 2;
  };
  const updatePan = (active: boolean) => {
    panning = active;
    viewport.toggleAttribute("data-panning", panning);
    buttons.pan.setAttribute("aria-pressed", String(panning));
    const label = panning ? labels.drawMode : labels.panMode;
    buttons.pan.setAttribute("label", label);
    buttons.pan.setAttribute("title", label);
  };
  const updateTools = () => {
    buttons.out.toggleAttribute("disabled", level === 0);
    buttons.in.toggleAttribute("disabled", level === levels.length - 1);
    buttons.pan.toggleAttribute("disabled", level === 0);
    buttons.reset.textContent = percentage.format(levels[level]);
    viewport.toggleAttribute("data-zoomed", level > 0);
  };
  const pickCenter = () => {
    const rect = region();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : { x: 0.5, y: 0.5 };
  };
  const zoom = (next: number) => {
    const center = level > 0 ? viewportCenter() : pickCenter();
    level = Math.max(0, Math.min(next, levels.length - 1));
    if (!level) updatePan(false);
    updateTools();
    resize(center);
  };
  buttons.out.onclick = () => zoom(level - 1);
  buttons.reset.onclick = () => zoom(0);
  buttons.in.onclick = () => zoom(level + 1);
  buttons.pan.onclick = () => updatePan(!panning);
  stage.addEventListener("pointerdown", event => {
    if (!panning || blocked() || drag || event.button !== 0) return;
    event.preventDefault();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    viewport.scrollLeft += drag.x - event.clientX;
    viewport.scrollTop += drag.y - event.clientY;
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  stage.addEventListener("lostpointercapture", () => { drag = undefined; });
  const observer = new ResizeObserver(() => resize(stage.offsetWidth ? viewportCenter() : pickCenter()));
  observer.observe(viewport);
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  image.addEventListener("load", () => resize(pickCenter()));
  updateTools();
  updatePan(false);
  return {
    isPanning: () => panning,
    startDrawing: () => updatePan(false),
    focusRegion: () => { if (level) resize(pickCenter()); },
  };
}

export async function editMeter(
  host: HTMLElement, language: string, url: string,
  request: (url: string, init?: RequestInit) => Promise<Response>, signal: AbortSignal,
  saved: () => void,
) {
  const labels = language.startsWith("fr") ? meterStrings.fr : meterStrings.en;
  const common = language.startsWith("fr") ? panelStrings.fr : panelStrings.en;
  const dialog = document.createElement("ha-dialog");
  dialog.className = "meter-dialog";
  dialog.setAttribute("width", "large");
  dialog.setAttribute("header-title", labels.configure);
  dialog.setAttribute("prevent-scrim-close", "");
  dialog.innerHTML = `
    <div class="meter-editor" data-editor hidden>
      <div class="meter-preview">
        <div class="meter-toolbar">
          <ha-icon-button data-zoom-out><ha-icon icon="mdi:magnify-minus-outline"></ha-icon></ha-icon-button>
          <ha-button data-reset-zoom appearance="plain" size="s"></ha-button>
          <ha-icon-button data-zoom-in><ha-icon icon="mdi:magnify-plus-outline"></ha-icon></ha-icon-button>
          <ha-icon-button data-pan><ha-icon icon="mdi:hand-back-right-outline"></ha-icon></ha-icon-button>
          <ha-icon-button data-capture><ha-icon icon="mdi:camera-retake-outline"></ha-icon></ha-icon-button>
        </div>
        <div class="meter-viewport" data-viewport role="region" tabindex="0" hidden>
          <div class="meter-extent" data-extent>
            <div class="meter-frame" data-frame><img draggable="false"><div data-overlay aria-hidden="true"></div></div>
          </div>
        </div>
        <p class="secondary" data-guide role="status"></p>
      </div>
      <div class="meter-settings">
        <section class="meter-section">
          <h3 data-format-title></h3>
          <div class="meter-grid" data-format><ha-select data-kind></ha-select></div>
        </section>
        <section class="meter-section">
          <h3 data-zones-title></h3>
          <div class="meter-tools" data-wheel-picker hidden><ha-button data-wheels-zone size="s"></ha-button></div>
          <div class="meter-grid" data-wheel-counts></div>
          <p class="secondary" data-wheel-limit role="status" hidden></p>
          <div class="meter-dials" data-dials role="group" hidden></div>
          <div class="meter-tools">
            <ha-button data-add appearance="plain" size="s" disabled></ha-button>
            <ha-button data-cancel-dial appearance="plain" size="s" hidden></ha-button>
            <ha-button data-remove appearance="plain" size="s" hidden></ha-button>
          </div>
          <div class="meter-grid" data-dial-settings hidden>
            <ha-select data-dial-order></ha-select>
            <ha-select data-direction></ha-select>
          </div>
          <ha-expansion-panel class="meter-coordinates" data-fine-tune>
            <div class="meter-coordinate-content">
              <div class="meter-coordinate-group" role="group" data-position-group>
                <p class="secondary" data-position-label></p>
                <div class="meter-grid" data-position></div>
              </div>
              <div class="meter-coordinate-group" role="group" data-size-group>
                <p class="secondary" data-size-label></p>
                <div class="meter-grid" data-size></div>
              </div>
              <ha-alert alert-type="error" data-coordinate-error hidden></ha-alert>
              <ha-button appearance="plain" size="s" data-restore-zone hidden></ha-button>
            </div>
          </ha-expansion-panel>
        </section>
        <section class="meter-section">
          <h3 data-index-title></h3>
          <div class="meter-grid" data-limits></div>
          <div class="meter-initial-warning" data-initial-warning hidden>
            <ha-alert alert-type="warning" data-initial-warning-text></ha-alert>
            <ha-button appearance="plain" size="s" data-confirm-initial></ha-button>
          </div>
          <p class="secondary" data-help></p>
          <ha-expansion-panel data-rebase hidden>
            <div class="meter-rebase-content">
              <p class="secondary" data-rebase-help></p>
              <div data-rebase-value></div>
              <ha-button data-apply-rebase appearance="outlined" size="s" disabled></ha-button>
            </div>
          </ha-expansion-panel>
        </section>
      </div>
    </div>
    <div class="meter-footer" slot="footer">
      <ha-alert data-alert alert-type="error" hidden></ha-alert>
      <p class="secondary meter-status" data-result role="status" hidden></p>
      <ha-dialog-footer>
        <ha-button data-close slot="secondaryAction" appearance="plain"></ha-button>
        <ha-button data-test slot="secondaryAction" appearance="plain" disabled></ha-button>
        <ha-button data-save slot="primaryAction" variant="brand" disabled></ha-button>
      </ha-dialog-footer>
    </div>`;
  const el = <T extends HTMLElement = HTMLElement>(name: string) => dialog.querySelector<T>(`[data-${name}]`)!;
  const stage = el("frame");
  const image = stage.querySelector("img")!;
  image.alt = common.preview;
  el("viewport").setAttribute("aria-label", common.preview);
  const scope = new AbortController();
  let imageUrl: string | undefined;
  const close = () => {
    dialog.remove();
    scope.abort();
    signal.removeEventListener("abort", close);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  };
  signal.addEventListener("abort", close, { once: true });
  dialog.addEventListener("closed", close, { once: true });
  el("close").onclick = close;
  actionLabel(el("close"), common.cancel, "close");
  actionLabel(el("save"), common.save, "content-save-outline");
  el("test").textContent = labels.tryLayout;
  for (const [key, label] of [
    ["zoom-out", labels.zoomOut], ["reset-zoom", labels.resetZoom],
    ["zoom-in", labels.zoomIn], ["capture", labels.refresh],
  ]) {
    el(key).setAttribute("label", label);
    el(key).setAttribute("title", label);
  }
  el("format-title").textContent = labels.formatTitle;
  el("zones-title").textContent = labels.zonesTitle;
  el("index-title").textContent = labels.indexTitle;
  el("initial-warning-text").textContent = labels.initialUncertain;
  actionLabel(el("confirm-initial"), labels.confirmInitial, "check");
  el("fine-tune").setAttribute("header", labels.fineTune);
  for (const [group, label] of [["position", labels.zonePosition], ["size", labels.zoneSize]]) {
    el(`${group}-group`).setAttribute("aria-label", label);
    el(`${group}-label`).textContent = label;
  }
  el("coordinate-error").textContent = labels.zoneInvalid;
  actionLabel(el("restore-zone"), labels.restoreZone, "undo");
  el("rebase").setAttribute("header", labels.rebase);
  el("rebase-help").textContent = labels.rebaseHelp;
  actionLabel(el("apply-rebase"), labels.confirmRebase, "check");
  actionLabel(el("wheels-zone"), labels.digits, "crop");
  el("dials").setAttribute("aria-label", labels.dials);
  el("wheel-limit").textContent = labels.wheelLimit;
  actionLabel(el("add"), labels.addDial, "plus");
  actionLabel(el("cancel-dial"), labels.cancelDial, "close");
  actionLabel(el("remove"), labels.removeDial, "minus");
  host.append(dialog);
  dialog.setAttribute("open", "");

  const fail = (reason?: string) => {
    const alert = el("alert");
    alert.textContent = reason ? labels.reasons[reason] ??
      common[reason as keyof typeof common] ?? labels.failed : "";
    alert.hidden = !reason;
  };
  const responseError = async (response: Response) =>
    new Error((await response.json().catch(() => ({}))).reason ?? "meter_request_failed");

  try {
    const { signal: editorSignal } = scope;
    const config = await request(url, { signal: editorSignal });
    if (!config.ok) throw await responseError(config);
    const { settings, initialized, revision }: Draft = await config.json();
    editorSignal.throwIfAborted();
    const layout: Layout = {
      kind: "water", max_rate: defaultRates.water, rotation: 0, wheels: 5, decimal_wheels: 0,
      digits: null, dials: [], ...settings,
    };
    let captureId: string | null = null;
    let busy = false;
    let selected = 0;
    let initialSuggestion: "accepted" | "uncertain" | undefined;
    let invalidCoordinates = false;

    const select = (field: Select, label: string, options: Select["options"], value: string) => {
      field.label = label;
      field.options = options;
      field.value = value;
    };
    const field = (name: string, min: number, max: number, step: string, value: number | string, host: HTMLElement, required = true) => {
      const input = numberField(max, required);
      input.setAttribute("label", name);
      input.setAttribute("min", String(min));
      input.setAttribute("step", step);
      input.value = String(value);
      host.append(input);
      return input;
    };
    const kind = el<Select>("kind");
    select(kind, labels.kind, kinds.map(value => ({ value, label: labels[value] })), layout.kind);
    kind.toggleAttribute("disabled", initialized);
    const rotation = field(labels.rotation, -180, 180, "any", layout.rotation, el("format"));
    const whole = field(labels.wholeDigits, 1, 12, "1", layout.wheels - layout.decimal_wheels, el("wheel-counts"));
    whole.toggleAttribute("disabled", initialized);
    const decimals = field(labels.decimalDigits, 0, 11, "1", layout.decimal_wheels, el("wheel-counts"));
    const rate = field(labels.maxRate, 0.000001, 1_000_000, "any", layout.max_rate, el("limits"));
    const indexLimit = () => 10 ** Number(whole.value);
    const initial = initialized ? undefined :
      field(labels.initial, 0, 10 ** 12, "any", "", el("limits"), false);
    const rebaseValue = initialized
      ? field(labels.rebaseIndex, 0, indexLimit(), "any", "", el("rebase-value"))
      : undefined;
    el("rebase").hidden = !initialized;
    el("help").textContent = initialized ? labels.fixedScale : labels.initialHelp;
    const direction = el<Select>("direction");
    const order = el<Select>("dial-order");
    select(direction, labels.direction, [
      { value: "cw", label: labels.clockwise }, { value: "ccw", label: labels.counterclockwise },
    ], "cw");
    const coords = (["x", "y", "width", "height"] as const).map(key => {
      const isPosition = key === "x" || key === "y";
      const input = field(common[key], isPosition ? 0 : 0.01, 100, "0.01", "",
        el(isPosition ? "position" : "size"), false);
      return [key, input] as const;
    });
    const addingDial = () => selected > layout.dials.length;
    const region = () => selected === 0 ? layout.digits : layout.dials[selected - 1]?.region ?? null;
    const factor = new Intl.NumberFormat(language, { maximumFractionDigits: 19 });
    const viewport = el("viewport");
    const preview = bindMeterPreview(viewport, el("extent"), stage, image, region, () => busy, {
      out: el("zoom-out"), reset: el("reset-zoom"), in: el("zoom-in"), pan: el("pan"),
    }, labels, language, editorSignal);
    const setRegion = (rect: Region) => {
      if (selected === 0) layout.digits = rect;
      else if (addingDial()) layout.dials.push({ region: rect, counterclockwise: false });
      else layout.dials[selected - 1].region = rect;
    };
    const wheelCount = () => Number(whole.value) + Number(decimals.value);
    const validNumbers = () => [whole, decimals, rotation, rate].every(f => f.value !== "" && f.checkValidity()) &&
      wheelCount() <= 12;
    const validIndex = (input: NumberField) =>
      input.value !== "" && input.checkValidity() && Number(input.value) < indexLimit();
    const refreshButtons = () => {
      el("wheel-limit").hidden = wheelCount() <= 12;
      const ready = !busy && !!captureId && !addingDial() && !invalidCoordinates && !!layout.digits &&
        layout.dials.every(dial => dial.region) && validNumbers();
      const needsConfirmation = initialSuggestion === "uncertain";
      el("initial-warning").hidden = !needsConfirmation;
      el("help").hidden = needsConfirmation;
      el("save").toggleAttribute("disabled", !ready || needsConfirmation || !!(initial?.value && !validIndex(initial)));
      el("test").toggleAttribute("disabled", !ready);
      el("add").toggleAttribute("disabled", busy || !captureId || layout.dials.length >= 8);
      el("apply-rebase").toggleAttribute("disabled", busy || !rebaseValue || !validIndex(rebaseValue));
    };
    const paint = (draft?: Region) => {
      const overlay = el("overlay");
      overlay.replaceChildren();
      const regions = [layout.digits, ...layout.dials.map(dial => dial.region)];
      if (draft) regions[selected] = draft;
      regions.forEach((rect, index) => {
        if (!rect) return;
        const selection = document.createElement("div");
        selection.className = index === selected ? "selection active" : "selection";
        paintRegion(selection, rect);
        overlay.append(selection);
      });
      image.style.transform = `rotate(${-layout.rotation}deg)`;
    };
    const showResult = (result?: MeterResult) => {
      const status = el("result");
      status.textContent = result ? meterText(result, language) : "";
      status.hidden = !status.textContent;
    };
    const clearSuggestion = () => {
      if (initialSuggestion && initial) initial.value = "";
      initialSuggestion = undefined;
    };
    const changed = () => {
      fail();
      showResult();
      clearSuggestion();
      updateZones();
      refreshButtons();
      paint();
    };
    const showCoordinateError = (invalid: boolean) => {
      invalidCoordinates = invalid;
      el("coordinate-error").hidden = !invalid;
      el("restore-zone").hidden = !invalid || !region();
    };
    const fillCoordinates = () => {
      const rect = region();
      for (const [key, input] of coords) input.value = rect ? String(Math.round(rect[key] * 10000) / 100) : "";
      showCoordinateError(false);
    };
    const markZone = (button: HTMLElement, current: boolean) => {
      button.setAttribute("aria-pressed", String(current));
      button.setAttribute("appearance", current ? "outlined" : "plain");
    };
    const updateZones = () => {
      el("wheel-picker").hidden = layout.dials.length === 0;
      markZone(el("wheels-zone"), selected === 0);
      const dials = el("dials");
      const places = decimals.value !== "" && decimals.checkValidity()
        ? Number(decimals.value) : layout.decimal_wheels;
      const multipliers = layout.dials.map((_, index) => ({
        value: String(index), label: "×" + factor.format(10 ** -(places + index + 1)),
      }));
      layout.dials.forEach((dial, index) => {
        let button = dials.children.item(index) as HTMLElement | null;
        if (!button) {
          button = document.createElement("ha-button");
          button.setAttribute("size", "s");
          button.onclick = () => selectZone(index + 1);
          dials.append(button);
        }
        markZone(button, selected === index + 1);
        const sense = dial.counterclockwise ? labels.counterclockwise : labels.clockwise;
        actionLabel(button, `${labels.dial} ${multipliers[index].label} · ${sense}`, "gauge");
      });
      while (dials.children.length > layout.dials.length) dials.lastElementChild!.remove();
      dials.hidden = layout.dials.length === 0;
      const dial = layout.dials[selected - 1];
      const guide = el("guide");
      const instruction = selected === 0 ? labels.guideWheels : addingDial() ? labels.guideAddDial : labels.guideDial;
      if (guide.textContent !== instruction) guide.textContent = instruction;
      el("add").hidden = addingDial();
      el("cancel-dial").hidden = !addingDial();
      el("dial-settings").hidden = el("remove").hidden = !dial;
      if (dial) {
        order.hidden = multipliers.length < 2;
        if (!order.hidden) select(order, labels.dialOrder, multipliers, String(selected - 1));
        direction.value = dial.counterclockwise ? "ccw" : "cw";
      }
    };
    const selectZone = (index: number) => {
      cancelDrawing();
      selected = index;
      preview.startDrawing();
      fillCoordinates();
      updateZones();
      refreshButtons();
      paint();
      if (region()) preview.focusRegion();
    };
    const onSelect = (input: Select, change: (value: string) => void) => {
      input.addEventListener("selected", event => {
        input.value = (event as CustomEvent<{ value: string }>).detail.value;
        change(input.value);
      });
    };
    onSelect(kind, value => {
      layout.kind = value as Kind;
      rate.value = String(defaultRates[layout.kind]);
      changed();
    });
    onSelect(direction, value => {
      const dial = layout.dials[selected - 1];
      if (dial) {
        dial.counterclockwise = value === "ccw";
        changed();
      }
    });
    onSelect(order, value => {
      const current = selected - 1;
      const next = Number(value);
      if (next === current || !layout.dials[current] || !layout.dials[next]) return;
      // The reader takes dials in descending order of significance.
      cancelDrawing();
      [layout.dials[current], layout.dials[next]] = [layout.dials[next], layout.dials[current]];
      selected = next + 1;
      changed();
    });
    el("wheels-zone").onclick = () => selectZone(0);
    el("add").onclick = () => {
      selectZone(layout.dials.length + 1);
      viewport.scrollIntoView({ block: "nearest" });
      viewport.focus({ preventScroll: true });
    };
    el("cancel-dial").onclick = () => selectZone(0);
    el("remove").onclick = () => {
      layout.dials.splice(selected - 1, 1);
      selectZone(0);
      changed();
    };
    for (const input of [whole, decimals]) input.addEventListener("input", changed);
    rate.addEventListener("input", refreshButtons);
    const confirmInitial = () => {
      initialSuggestion = undefined;
      refreshButtons();
    };
    initial?.addEventListener("input", confirmInitial);
    el("confirm-initial").onclick = () => {
      initial?.focus();
      confirmInitial();
    };
    rebaseValue?.addEventListener("input", refreshButtons);
    rotation.addEventListener("input", () => {
      if (rotation.value !== "" && rotation.checkValidity()) layout.rotation = Number(rotation.value);
      changed();
    });
    el("restore-zone").onclick = () => {
      fillCoordinates();
      refreshButtons();
      coords[0][1].focus();
    };
    for (const [, input] of coords) input.addEventListener("input", () => {
      const rect = Object.fromEntries(coords.map(([key, f]) => [key, Number(f.value) / 100])) as Region;
      const valid = coords.every(([, f]) => f.value !== "" && f.checkValidity()) &&
        rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9;
      showCoordinateError(!valid);
      if (!valid) {
        refreshButtons();
        return;
      }
      setRegion(rect);
      changed();
    });
    const cancelDrawing = bindRegionDrawing(stage, () => !busy && !preview.isPanning(), paint, rect => {
      setRegion(rect);
      fillCoordinates();
      changed();
    });

    const working = async (button: HTMLElement, run: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      fail();
      dialog.inert = true;
      button.setAttribute("loading", "");
      try {
        await run();
      } catch (error) {
        if (!editorSignal.aborted) fail(error instanceof Error ? error.message : "meter_request_failed");
      } finally {
        busy = false;
        dialog.inert = false;
        button.removeAttribute("loading");
        refreshButtons();
      }
    };
    const capture = () => working(el("capture"), async () => {
      const response = await request(url + "/capture", { signal: editorSignal });
      if (!response.ok) throw await responseError(response);
      if (response.headers.get("X-Image-Lab-Revision") !== revision) throw new Error("meter_settings_changed");
      const blob = await response.blob();
      editorSignal.throwIfAborted();
      const nextImageUrl = URL.createObjectURL(blob);
      const decoded = new Image();
      decoded.src = nextImageUrl;
      try {
        await decoded.decode();
        editorSignal.throwIfAborted();
      } catch (error) {
        URL.revokeObjectURL(nextImageUrl);
        throw error;
      }
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = nextImageUrl;
      captureId = response.headers.get("X-Image-Lab-Capture");
      viewport.hidden = false;
      image.src = nextImageUrl;
      clearSuggestion();
      showResult();
    });
    const submit = (operation: "test" | "save") => working(el(operation), async () => {
      if (operation === "test") {
        clearSuggestion();
        showResult();
      }
      const response = await request(url + "/" + operation, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: editorSignal,
        body: JSON.stringify({
          capture_id: captureId, revision,
          settings: { ...layout, wheels: wheelCount(), decimal_wheels: Number(decimals.value), max_rate: Number(rate.value) },
          initial_value: operation === "save" && initial?.value ? Number(initial.value) : undefined,
        }),
      });
      if (!response.ok) throw await responseError(response);
      const result: MeterResult = await response.json();
      editorSignal.throwIfAborted();
      if (operation === "test") {
        showResult(result);
        const value = result.reason ? result.candidate : result.value;
        if (initial && !initial.value && typeof value === "number" && value >= 0 && value < indexLimit()) {
          initial.value = String(value);
          initialSuggestion = result.reason ? "uncertain" : "accepted";
        }
      } else { saved(); close(); }
    });
    el("apply-rebase").onclick = () => {
      if (!rebaseValue || !validIndex(rebaseValue)) return;
      void working(el("apply-rebase"), async () => {
        const response = await request(url + "/rebase", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: editorSignal,
          body: JSON.stringify({ revision, value: Number(rebaseValue.value) }),
        });
        if (!response.ok) throw await responseError(response);
        const { value }: { value: number } = await response.json();
        editorSignal.throwIfAborted();
        rebaseValue.value = "";
        el("rebase").removeAttribute("expanded");
        const status = el("result");
        status.textContent = labels.rebased.replace("{value}", factor.format(value));
        status.hidden = false;
      });
    };
    el("capture").onclick = () => void capture();
    el("test").onclick = async () => {
      await submit("test");
      if (initialSuggestion === "uncertain") el("initial-warning").scrollIntoView({ block: "nearest" });
    };
    el("save").onclick = () => void submit("save");
    el("editor").hidden = false;
    selectZone(0);
    await capture();
  } catch (error) {
    if (!scope.signal.aborted) fail(error instanceof Error ? error.message : "meter_request_failed");
  }
}
