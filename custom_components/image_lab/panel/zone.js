import { bindRegionDrawing, paintRegion } from "./region.js";
import { actionLabel } from "./action.js";
import { numberField } from "./number-field.js";
export async function editZone(host, region, labels, url, request, signal) {
    const dialog = document.createElement("ha-dialog");
    dialog.setAttribute("header-title", labels.zone);
    dialog.innerHTML = `
    <p></p><div class="zoneFrame" hidden><img draggable="false"><div class="selection"></div></div>
    <div class="zoneFields"></div><ha-button appearance="plain" id="fullZone"></ha-button>
    <ha-alert alert-type="error" hidden></ha-alert>
    <ha-dialog-footer slot="footer"><ha-button slot="secondaryAction" appearance="plain"></ha-button>
    <ha-button slot="primaryAction" variant="brand"></ha-button></ha-dialog-footer>`;
    const box = dialog.querySelector(".zoneFrame");
    const overlay = box.querySelector(".selection");
    const image = box.querySelector("img");
    image.alt = labels.preview;
    const alert = dialog.querySelector("ha-alert");
    const save = dialog.querySelector('[slot="primaryAction"]');
    const cancel = dialog.querySelector('[slot="secondaryAction"]');
    const full = dialog.querySelector("#fullZone");
    actionLabel(cancel, labels.cancel, "close");
    actionLabel(full, labels.fullZone, "crop-free");
    actionLabel(save, labels.save, "content-save-outline");
    dialog.querySelector("p").textContent = labels.drawZone;
    const fields = new Map();
    const keys = ["x", "y", "width", "height"];
    const fill = (value) => {
        region = value;
        const rect = region ?? { x: 0, y: 0, width: 1, height: 1 };
        for (const [key, input] of fields)
            input.value = String(Math.round(rect[key] * 10000) / 100);
        save.removeAttribute("disabled");
        paintRegion(overlay, region);
    };
    for (const key of keys) {
        const input = numberField(100, true);
        input.setAttribute("label", labels[key]);
        fields.set(key, input);
        input.addEventListener("input", () => {
            const rect = Object.fromEntries([...fields].map(([k, f]) => [k, Number(f.value) / 100]));
            const valid = [...fields.values()].every(f => f.value !== "" && f.checkValidity()) && rect.width > 0 && rect.height > 0 &&
                rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9;
            dialog.setAttribute("prevent-scrim-close", "");
            save.toggleAttribute("disabled", !valid);
            if (valid) {
                region = rect;
                paintRegion(overlay, region);
            }
        });
        dialog.querySelector(".zoneFields").append(input);
    }
    fill(region);
    const edit = (value) => {
        dialog.setAttribute("prevent-scrim-close", "");
        fill(value);
    };
    bindRegionDrawing(box, () => !dialog.inert, r => paintRegion(overlay, r ?? region), edit);
    full.onclick = () => edit(null);
    let objectUrl;
    const scope = new AbortController();
    const close = () => {
        dialog.remove();
        scope.abort();
        signal.removeEventListener("abort", close);
        if (objectUrl)
            URL.revokeObjectURL(objectUrl);
    };
    cancel.onclick = close;
    dialog.addEventListener("closed", close, { once: true });
    signal.addEventListener("abort", close, { once: true });
    save.onclick = async () => {
        dialog.inert = true;
        save.setAttribute("loading", "");
        try {
            const response = await request(url, { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ region }), signal: scope.signal });
            if (!response.ok)
                throw Error();
            close();
        }
        catch {
            if (!scope.signal.aborted) {
                alert.hidden = false;
                alert.textContent = labels.saveZoneError;
            }
        }
        finally {
            dialog.inert = false;
            save.removeAttribute("loading");
        }
    };
    host.append(dialog);
    dialog.setAttribute("open", "");
    try {
        const response = await request(url, { signal: scope.signal, cache: "no-store" });
        if (!response.ok)
            throw Error();
        const blob = await response.blob();
        scope.signal.throwIfAborted();
        objectUrl = URL.createObjectURL(blob);
        image.onload = () => box.style.setProperty("--ratio", String(image.naturalWidth / image.naturalHeight));
        image.src = objectUrl;
        box.hidden = false;
    }
    catch {
        if (!scope.signal.aborted) {
            alert.hidden = false;
            alert.textContent = labels.source_no_image;
        }
    }
}
