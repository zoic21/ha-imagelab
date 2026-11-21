import { bindRegionDrawing, paintRegion, type Region } from "./region.js";
import { numberField, type NumberField } from "./number-field.js";
import { panelStrings } from "./translations.js";

export async function editZone(
  host: HTMLElement, region: Region | null, labels: typeof panelStrings.en,
  url: string, request: (url: string, options?: RequestInit) => Promise<Response>,
  signal: AbortSignal,
) {
  const dialog = document.createElement("ha-dialog");
  dialog.setAttribute("header-title", labels.zone);
  dialog.innerHTML = `
    <p></p><div class="zoneFrame" hidden><img draggable="false"><div class="selection"></div></div>
    <div class="zoneFields"></div><ha-button appearance="plain" id="fullZone"></ha-button>
    <ha-alert alert-type="error" hidden></ha-alert>
    <ha-dialog-footer slot="footer"><ha-button slot="secondaryAction" appearance="plain"></ha-button>
    <ha-button slot="primaryAction" variant="brand"></ha-button></ha-dialog-footer>`;
  const box = dialog.querySelector<HTMLElement>(".zoneFrame")!;
  const overlay = box.querySelector<HTMLElement>(".selection")!;
  const image = box.querySelector("img")!;
  image.alt = labels.preview;
  const alert = dialog.querySelector<HTMLElement>("ha-alert")!;
  const save = dialog.querySelector<HTMLElement>('[slot="primaryAction"]')!;
  const cancel = dialog.querySelector<HTMLElement>('[slot="secondaryAction"]')!;
  const full = dialog.querySelector<HTMLElement>("#fullZone")!;
  cancel.textContent = labels.cancel;
  full.textContent = labels.fullZone;
  save.textContent = labels.save;
  dialog.querySelector("p")!.textContent = labels.drawZone;
  const fields = new Map<keyof Region, NumberField>();
  const keys = ["x", "y", "width", "height"] as const;
  const fill = (value: Region | null) => {
    region = value;
    const rect = region ?? { x: 0, y: 0, width: 1, height: 1 };
    for (const [key, input] of fields) input.value = String(Math.round(rect[key] * 10000) / 100);
    save.removeAttribute("disabled");
    paintRegion(overlay, region);
  };
  for (const key of keys) {
    const input = numberField(100, true);
    input.setAttribute("label", labels[key]);
    fields.set(key, input);
    input.addEventListener("input", () => {
      const rect = Object.fromEntries([...fields].map(([k, f]) => [k, Number(f.value) / 100])) as Region;
      const valid = [...fields.values()].every(f => f.value !== "" && f.checkValidity()) && rect.width > 0 && rect.height > 0 &&
        rect.x + rect.width <= 1 + 1e-9 && rect.y + rect.height <= 1 + 1e-9;
      save.toggleAttribute("disabled", !valid);
      if (valid) { region = rect; paintRegion(overlay, region); }
    });
    dialog.querySelector(".zoneFields")!.append(input);
  }
  fill(region);
  bindRegionDrawing(box, () => !dialog.inert, r => paintRegion(overlay, r ?? region), fill);
  full.onclick = () => fill(null);
  let objectUrl: string | undefined;
  const scope = new AbortController();
  const close = () => {
    dialog.remove();
    scope.abort();
    signal.removeEventListener("abort", close);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
  cancel.onclick = close;
  dialog.addEventListener("closed", close, { once: true });
  signal.addEventListener("abort", close, { once: true });
  save.onclick = async () => {
    dialog.inert = true;
    try {
      const response = await request(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }), signal: scope.signal });
      if (!response.ok) throw Error();
      close();
    } catch {
      if (!scope.signal.aborted) { alert.hidden = false; alert.textContent = labels.saveZoneError; }
    } finally { dialog.inert = false; }
  };
  host.append(dialog);
  dialog.setAttribute("open", "");
  try {
    const response = await request(url, { signal: scope.signal, cache: "no-store" });
    if (!response.ok) throw Error();
    const blob = await response.blob();
    scope.signal.throwIfAborted();
    objectUrl = URL.createObjectURL(blob);
    image.onload = () => box.style.setProperty("--ratio", String(image.naturalWidth / image.naturalHeight));
    image.src = objectUrl;
    box.hidden = false;
  } catch {
    if (!scope.signal.aborted) { alert.hidden = false; alert.textContent = labels.source_no_image; }
  }
}
