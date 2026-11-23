import { actionLabel } from "./action.js";
import { numberField } from "./number-field.js";
import { bindRegionDrawing, paintRegion } from "./region.js";
import { meterStrings, panelStrings } from "./translations.js";
const kinds = ["water", "gas", "energy"];
const defaultRates = { water: 3, gas: 6, energy: 12 };
export function meterText(result, language, compact = false) {
    const labels = language.startsWith("fr") ? meterStrings.fr : meterStrings.en;
    const value = result.reason ? result.candidate : result.value;
    const format = (n) => [new Intl.NumberFormat(language, { maximumFractionDigits: 15 }).format(n),
        result.unit].filter(Boolean).join(" ");
    if (compact)
        return result.reason || value == null ? labels.rejected : format(value);
    const parts = [];
    if (value != null)
        parts.push((result.reason ? labels.candidate : labels.reading) + " · " + format(value));
    if (result.reason)
        parts.push(labels.reasons[result.reason] ?? labels.rejected);
    if (result.reason && result.meter_value != null)
        parts.push(labels.retained + " · " + format(result.meter_value));
    if (result.confidence != null)
        parts.push(labels.confidence + " · " +
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
    .meter-viewport { height:clamp(220px,calc(100dvh - 330px),620px); }
  }
  .meter-viewport[data-zoomed] { overscroll-behavior:contain; }
  .meter-extent { position:relative; min-width:100%; min-height:100%; display:grid; place-items:center; }
  .meter-frame { position:relative; overflow:hidden; background:#111; touch-action:none; user-select:none; cursor:crosshair; }
  .meter-viewport[data-panning] .meter-frame { cursor:grab; }
  .meter-viewport[data-panning] .meter-frame:active { cursor:grabbing; }
  .meter-frame img { display:block; width:100%; height:100%; max-height:none; }
  .meter-frame .selection:not(.active) { border-style:dashed; background:transparent; opacity:.65; }
  .meter-section + .meter-section { border-top:1px solid var(--divider-color); margin-top:12px; padding-top:12px; }
  .meter-section h3 { margin:0 0 8px; font-size:1rem; }
  .meter-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .meter-grid > :only-child { grid-column:1 / -1; }
  .meter-tools { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
  .meter-settings ha-select { display:block; }
  .meter-coordinates .zoneFields { padding:0 8px 4px; }
  .meter-dialog .meter-footer { flex-direction:column; align-items:stretch; gap:8px; }
  .meter-footer p, .meter-footer ha-alert { margin:0; }
  .meter-status { font-variant-numeric:tabular-nums; }
`;
function bindMeterPreview(viewport, canvas, stage, image, region, blocked, buttons, labels, language, signal) {
    const levels = [1, 1.5, 2, 3, 4];
    const percentage = new Intl.NumberFormat(language, { style: "percent" });
    let level = 0;
    let panning = false;
    let drag;
    const viewportCenter = () => ({
        x: (viewport.scrollLeft + viewport.clientWidth / 2 - stage.offsetLeft) / stage.offsetWidth,
        y: (viewport.scrollTop + viewport.clientHeight / 2 - stage.offsetTop) / stage.offsetHeight,
    });
    const resize = (center) => {
        if (!image.naturalWidth || !viewport.clientWidth || !viewport.clientHeight)
            return;
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
    const updatePan = (active) => {
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
    const zoom = (next) => {
        const center = level > 0 ? viewportCenter() : pickCenter();
        level = Math.max(0, Math.min(next, levels.length - 1));
        if (!level)
            updatePan(false);
        updateTools();
        resize(center);
    };
    buttons.out.onclick = () => zoom(level - 1);
    buttons.reset.onclick = () => zoom(0);
    buttons.in.onclick = () => zoom(level + 1);
    buttons.pan.onclick = () => updatePan(!panning);
    stage.addEventListener("pointerdown", event => {
        if (!panning || blocked() || drag || event.button !== 0)
            return;
        event.preventDefault();
        drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", event => {
        if (!drag || drag.pointer !== event.pointerId)
            return;
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
    return { isPanning: () => panning, focusRegion: () => { if (level)
            resize(pickCenter()); } };
}
export async function editMeter(host, language, url, request, signal, saved) {
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
        <p class="secondary" data-guide></p>
      </div>
      <div class="meter-settings">
        <section class="meter-section">
          <h3 data-format-title></h3>
          <div class="meter-grid" data-format><ha-select data-kind></ha-select></div>
        </section>
        <section class="meter-section">
          <h3 data-zones-title></h3>
          <ha-select data-target></ha-select>
          <div class="meter-tools">
            <ha-button data-add appearance="plain" size="s"></ha-button>
            <ha-button data-remove appearance="plain" size="s" hidden></ha-button>
          </div>
          <div data-direction hidden><ha-select></ha-select></div>
          <ha-expansion-panel class="meter-coordinates" data-fine-tune>
            <div class="zoneFields" data-coordinates></div>
          </ha-expansion-panel>
        </section>
        <section class="meter-section">
          <h3 data-index-title></h3>
          <div class="meter-grid" data-limits></div>
          <p class="secondary" data-help></p>
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
    const el = (name) => dialog.querySelector(`[data-${name}]`);
    const stage = el("frame");
    const image = stage.querySelector("img");
    image.alt = common.preview;
    el("viewport").setAttribute("aria-label", common.preview);
    const scope = new AbortController();
    let imageUrl;
    const close = () => {
        dialog.remove();
        scope.abort();
        signal.removeEventListener("abort", close);
        if (imageUrl)
            URL.revokeObjectURL(imageUrl);
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
    el("fine-tune").setAttribute("header", labels.fineTune);
    actionLabel(el("add"), labels.addDial, "plus");
    actionLabel(el("remove"), labels.removeDial, "minus");
    host.append(dialog);
    dialog.setAttribute("open", "");
    const fail = (reason) => {
        const alert = el("alert");
        alert.textContent = reason ? labels.reasons[reason] ??
            common[reason] ?? labels.failed : "";
        alert.hidden = !reason;
    };
    const responseError = async (response) => new Error((await response.json().catch(() => ({}))).reason ?? "meter_request_failed");
    try {
        const { signal: editorSignal } = scope;
        const config = await request(url, { signal: editorSignal });
        if (!config.ok)
            throw await responseError(config);
        const { settings, initialized, revision } = await config.json();
        editorSignal.throwIfAborted();
        const layout = {
            kind: "water", max_rate: defaultRates.water, rotation: 0, wheels: 5, decimal_wheels: 0,
            digits: null, dials: [], ...settings,
        };
        let captureId = null;
        let busy = false;
        let selected = 0;
        const select = (field, label, options, value) => {
            field.label = label;
            field.options = options;
            field.value = value;
        };
        const field = (name, min, max, step, value, host, required = true) => {
            const input = numberField(max, required);
            input.setAttribute("label", name);
            input.setAttribute("min", String(min));
            input.setAttribute("step", step);
            input.value = String(value);
            host.append(input);
            return input;
        };
        const kind = el("kind");
        select(kind, labels.kind, kinds.map(value => ({ value, label: labels[value] })), layout.kind);
        kind.toggleAttribute("disabled", initialized);
        const rotation = field(labels.rotation, -180, 180, "any", layout.rotation, el("format"));
        const wheels = field(labels.wheels, 1, 12, "1", layout.wheels, el("format"));
        const decimals = field(labels.decimals, 0, 11, "1", layout.decimal_wheels, el("format"));
        const rate = field(labels.maxRate, 0.000001, 1_000_000, "any", layout.max_rate, el("limits"));
        const initial = initialized ? undefined :
            field(labels.initial, 0, 10 ** 12, "any", "", el("limits"), false);
        el("help").textContent = initialized ? labels.fixedScale : labels.initialHelp;
        const target = el("target");
        const direction = el("direction").querySelector("ha-select");
        select(direction, labels.direction, [
            { value: "cw", label: labels.clockwise }, { value: "ccw", label: labels.counterclockwise },
        ], "cw");
        const coords = ["x", "y", "width", "height"].map(key => [key, field(common[key], 0, 100, "any", "", el("coordinates"))]);
        for (const [, input] of coords)
            input.toggleAttribute("required", false);
        const region = () => selected === 0 ? layout.digits : layout.dials[selected - 1].region;
        const viewport = el("viewport");
        const preview = bindMeterPreview(viewport, el("extent"), stage, image, region, () => busy, {
            out: el("zoom-out"), reset: el("reset-zoom"), in: el("zoom-in"), pan: el("pan"),
        }, labels, language, editorSignal);
        const setRegion = (rect) => {
            if (selected === 0)
                layout.digits = rect;
            else
                layout.dials[selected - 1].region = rect;
        };
        const validNumbers = () => [wheels, decimals, rotation, rate].every(f => f.value !== "" && f.checkValidity()) &&
            Number(decimals.value) < Number(wheels.value) &&
            (!initial?.value || (initial.checkValidity() && Number(initial.value) < 10 ** (Number(wheels.value) - Number(decimals.value))));
        const refreshButtons = () => {
            const ready = !busy && !!captureId && !!layout.digits &&
                layout.dials.every(dial => dial.region) && validNumbers();
            el("save").toggleAttribute("disabled", !ready);
            el("test").toggleAttribute("disabled", !ready);
        };
        const paint = (draft) => {
            const overlay = el("overlay");
            overlay.replaceChildren();
            [layout.digits, ...layout.dials.map(dial => dial.region)].forEach((rect, index) => {
                const selection = document.createElement("div");
                selection.className = index === selected ? "selection active" : "selection";
                paintRegion(selection, index === selected && draft ? draft : rect);
                overlay.append(selection);
            });
            image.style.transform = `rotate(${-layout.rotation}deg)`;
        };
        const showResult = (result) => {
            const status = el("result");
            status.textContent = result ? meterText(result, language) : "";
            status.hidden = !status.textContent;
        };
        const changed = () => {
            fail();
            showResult();
            refreshButtons();
            paint();
        };
        const fillCoordinates = () => {
            const rect = region();
            for (const [key, input] of coords)
                input.value = rect ? String(Math.round(rect[key] * 10000) / 100) : "";
        };
        const updateTargets = () => {
            select(target, labels.region, [
                { value: "0", label: labels.digits },
                ...layout.dials.map((_, index) => ({ value: String(index + 1), label: labels.dial + " " + (index + 1) })),
            ], String(selected));
            el("guide").textContent = selected === 0 ? labels.guideWheels : labels.guideDial;
            el("direction").hidden = selected === 0;
            el("remove").hidden = selected === 0;
            el("add").toggleAttribute("disabled", layout.dials.length === 8);
            direction.value = layout.dials[selected - 1]?.counterclockwise ? "ccw" : "cw";
            fillCoordinates();
            paint();
            refreshButtons();
        };
        const onSelect = (input, change) => {
            input.addEventListener("selected", event => {
                input.value = event.detail.value;
                change(input.value);
            });
        };
        onSelect(kind, value => {
            layout.kind = value;
            rate.value = String(defaultRates[layout.kind]);
            changed();
        });
        onSelect(target, value => {
            selected = Number(value);
            updateTargets();
            if (region())
                preview.focusRegion();
        });
        onSelect(direction, value => {
            layout.dials[selected - 1].counterclockwise = value === "ccw";
            changed();
        });
        el("add").onclick = () => {
            layout.dials.push({ region: null, counterclockwise: false });
            selected = layout.dials.length;
            updateTargets();
            changed();
        };
        el("remove").onclick = () => {
            layout.dials.splice(selected - 1, 1);
            selected = 0;
            updateTargets();
            changed();
        };
        for (const input of [wheels, decimals, rate, initial])
            input?.addEventListener("input", changed);
        rotation.addEventListener("input", () => {
            if (rotation.value !== "" && rotation.checkValidity())
                layout.rotation = Number(rotation.value);
            changed();
        });
        for (const [, input] of coords)
            input.addEventListener("input", () => {
                const rect = Object.fromEntries(coords.map(([key, f]) => [key, Number(f.value) / 100]));
                const valid = coords.every(([, f]) => f.value !== "" && f.checkValidity()) &&
                    rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9;
                setRegion(valid ? rect : null);
                changed();
            });
        bindRegionDrawing(stage, () => !busy && !preview.isPanning(), paint, rect => {
            setRegion(rect);
            fillCoordinates();
            changed();
        });
        const working = async (button, run) => {
            if (busy)
                return;
            busy = true;
            fail();
            dialog.inert = true;
            button.setAttribute("loading", "");
            try {
                await run();
            }
            catch (error) {
                if (!editorSignal.aborted)
                    fail(error instanceof Error ? error.message : "meter_request_failed");
            }
            finally {
                busy = false;
                dialog.inert = false;
                button.removeAttribute("loading");
                refreshButtons();
            }
        };
        const capture = () => working(el("capture"), async () => {
            const response = await request(url + "/capture", { signal: editorSignal });
            if (!response.ok)
                throw await responseError(response);
            if (response.headers.get("X-Image-Lab-Revision") !== revision)
                throw new Error("meter_settings_changed");
            const blob = await response.blob();
            editorSignal.throwIfAborted();
            const nextImageUrl = URL.createObjectURL(blob);
            const decoded = new Image();
            decoded.src = nextImageUrl;
            try {
                await decoded.decode();
                editorSignal.throwIfAborted();
            }
            catch (error) {
                URL.revokeObjectURL(nextImageUrl);
                throw error;
            }
            if (imageUrl)
                URL.revokeObjectURL(imageUrl);
            imageUrl = nextImageUrl;
            captureId = response.headers.get("X-Image-Lab-Capture");
            viewport.hidden = false;
            image.src = nextImageUrl;
            showResult();
        });
        const submit = (operation) => working(el(operation), async () => {
            const response = await request(url + "/" + operation, {
                method: "POST", headers: { "Content-Type": "application/json" }, signal: editorSignal,
                body: JSON.stringify({
                    capture_id: captureId, revision,
                    settings: { ...layout, wheels: Number(wheels.value), decimal_wheels: Number(decimals.value), max_rate: Number(rate.value) },
                    initial_value: operation === "save" && initial?.value ? Number(initial.value) : undefined,
                }),
            });
            if (!response.ok)
                throw await responseError(response);
            const result = await response.json();
            editorSignal.throwIfAborted();
            if (operation === "test")
                showResult(result);
            else {
                saved();
                close();
            }
        });
        el("capture").onclick = () => void capture();
        el("test").onclick = () => void submit("test");
        el("save").onclick = () => void submit("save");
        el("editor").hidden = false;
        updateTargets();
        await capture();
    }
    catch (error) {
        if (!scope.signal.aborted)
            fail(error instanceof Error ? error.message : "meter_request_failed");
    }
}
