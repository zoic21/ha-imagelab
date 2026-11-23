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
  .meter-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr)); gap:8px; }
  .meter-grid > * { min-width:0; }
  .meter-tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0; }
  .meter-tools ha-select { flex:1 1 190px; min-width:0; }
  .meter-frame { overflow:hidden; background:#111; }
  .meter-frame img { display:block; }
  .meter-frame .selection:not(.active) { border-style:dashed; background:transparent; opacity:.65; }
  .meter-status { font-variant-numeric:tabular-nums; }
`;
export async function editMeter(host, language, url, request, signal, saved) {
    const labels = language.startsWith("fr") ? meterStrings.fr : meterStrings.en;
    const common = language.startsWith("fr") ? panelStrings.fr : panelStrings.en;
    const dialog = document.createElement("ha-dialog");
    dialog.setAttribute("header-title", labels.configure);
    dialog.setAttribute("prevent-scrim-close", "");
    dialog.innerHTML = `
    <div data-editor hidden>
      <div class="meter-grid" data-format><ha-select data-kind></ha-select></div>
      <p class="secondary" data-guide></p>
      <div class="meter-tools">
        <ha-select data-target></ha-select><ha-button data-add appearance="plain"></ha-button>
        <ha-button data-remove appearance="plain"></ha-button>
      </div>
      <div class="meter-tools" data-direction hidden>
        <ha-select></ha-select>
      </div>
      <div class="zoneFrame meter-frame" data-frame hidden><img draggable="false"><div data-overlay aria-hidden="true"></div></div>
      <div class="zoneFields" data-coordinates></div>
      <div class="meter-tools"><ha-button data-capture appearance="plain"></ha-button>
        <ha-button data-test appearance="plain"></ha-button></div>
      <p class="secondary meter-status" data-result role="status" hidden></p>
      <div class="meter-grid" data-limits></div>
      <p class="secondary" data-help></p>
    </div>
    <ha-alert data-alert alert-type="error" hidden></ha-alert>
    <ha-dialog-footer slot="footer">
      <ha-button data-close slot="secondaryAction" appearance="plain"></ha-button>
      <ha-button data-save slot="primaryAction" variant="brand" disabled></ha-button>
    </ha-dialog-footer>`;
    const el = (name) => dialog.querySelector(`[data-${name}]`);
    const stage = el("frame");
    const image = stage.querySelector("img");
    image.alt = common.preview;
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
    actionLabel(el("capture"), labels.refresh, "camera");
    actionLabel(el("test"), labels.tryLayout, "play-outline");
    actionLabel(el("add"), labels.addDial, "plus");
    actionLabel(el("remove"), labels.removeDial, "minus");
    el("guide").textContent = labels.guide;
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
        const wheels = field(labels.wheels, 1, 12, "1", layout.wheels, el("format"));
        const decimals = field(labels.decimals, 0, 11, "1", layout.decimal_wheels, el("format"));
        const rotation = field(labels.rotation, -180, 180, "any", layout.rotation, el("format"));
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
        onSelect(target, value => { selected = Number(value); updateTargets(); });
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
        bindRegionDrawing(stage, () => !busy, paint, rect => {
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
            captureId = response.headers.get("X-Image-Lab-Capture");
            if (imageUrl)
                URL.revokeObjectURL(imageUrl);
            imageUrl = URL.createObjectURL(blob);
            image.onload = () => stage.style.setProperty("--ratio", String(image.naturalWidth / image.naturalHeight));
            image.src = imageUrl;
            stage.hidden = false;
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
