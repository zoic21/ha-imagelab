import type { panelStrings } from "./translations.js";
import { actionLabel } from "./action.js";
import { createDialog } from "./dialog.js";

type Values = Record<string, unknown>;
type Field = { name: string; default?: unknown; required?: boolean; description?: { suggested_value?: unknown } };
type ProfileForm = HTMLElement & { data: Values; schema: Field[] };
type SettingsResponse = { data_schema: Field[]; errors: Record<string, string> };
type Step =
  | { type: "form"; flow_id: string; step_id: string; data_schema: Field[]; errors: Record<string, string>; last_step?: boolean }
  | { type: "abort"; reason: string }
  | { type: "create_entry"; result?: { entry_id: string } };

interface Client {
  locale: { language: string };
  callApi<T>(method: string, path: string, data?: Values): Promise<T>;
  connection: { sendMessagePromise<T>(message: Values): Promise<T> };
}

export type ProfileFlowMode = "create" | "configure" | "rename";

async function profileTranslations(hass: Client, category: string) {
  const translations = await Promise.all([category, "selector"].map(section =>
    hass.connection.sendMessagePromise<{ resources: Record<string, string> }>({
      type: "frontend/get_translations", language: hass.locale.language,
      integration: ["image_lab"], category: section,
    })));
  const resources = Object.assign({}, ...translations.map(result => result.resources));
  return (key: string) => resources["component.image_lab." + key] ?? "";
}

function showForm(form: ProfileForm, hass: Client, schema: Field[], data: Values,
  errors: Record<string, string>, translate: (key: string) => string, category: string, step: string) {
  const prefix = category + ".step." + step;
  for (const field of schema) {
    const value = field.description?.suggested_value ?? field.default;
    if (!(field.name in data) && value !== undefined) data[field.name] = value;
  }
  Object.assign(form, {
    hass, data, schema, error: errors, hidden: false,
    context: { domain: "image_lab", handler: "image_lab" },
    computeLabel: (field: Field) => translate(prefix + ".data." + field.name) || field.name,
    computeHelper: (field: Field) => translate(prefix + ".data_description." + field.name),
    computeError: (key: string) => translate(category + ".error." + key) || key,
    localizeValue: (key: string) => translate("selector." + key),
  });
}

export function editModuleSettings(host: HTMLElement, hass: Client, entry: string,
  labels: typeof panelStrings.en, signal: AbortSignal, changed: () => void) {
  const container = document.createElement("div");
  container.innerHTML = `<ha-form hidden></ha-form>
    <p role="status" class="secondary" hidden></p>
    <ha-button appearance="plain" hidden></ha-button>`;
  const form = container.querySelector("ha-form")! as ProfileForm;
  const retry = container.querySelector<HTMLElement>("ha-button")!;
  const status = container.querySelector("p")!;
  actionLabel(retry, labels.retry, "refresh");
  Object.assign(form, { hass, data: {}, schema: [] });
  host.append(container);
  signal.addEventListener("abort", () => container.remove(), { once: true });

  let translate: Awaited<ReturnType<typeof profileTranslations>> | undefined;
  let saved: Values | undefined;
  const changes = () => Object.fromEntries(form.schema
    .filter(({ name }) => JSON.stringify(form.data[name]) !== JSON.stringify(saved?.[name]))
    .map(({ name }) => [name, form.data[name] ?? null]));

  async function update(settings?: Values) {
    status.hidden = retry.hidden = true;
    try {
      translate ??= await profileTranslations(hass, "config");
      if (signal.aborted) return false;
      const response = await hass.connection.sendMessagePromise<SettingsResponse>({
        type: "image_lab/module_settings", profile_id: entry, ...(settings && { settings }),
      });
      if (signal.aborted) return false;
      const invalid = Object.keys(response.errors).length > 0;
      showForm(form, hass, response.data_schema, invalid ? { ...form.data } : {},
        response.errors, translate, "config", "source");
      if (!invalid) saved = structuredClone(form.data);
      return !invalid;
    } catch {
      if (!signal.aborted) {
        status.textContent = labels.optionsError;
        status.hidden = false;
        retry.hidden = Boolean(saved);
      }
      return false;
    } finally {
      if (!signal.aborted) changed();
    }
  }

  retry.addEventListener("click", () => void update());
  form.addEventListener("value-changed", event => {
    form.data = (event as CustomEvent<{ value: Values }>).detail.value;
    status.hidden = true;
    changed();
  });
  void update();
  return {
    get changed() { return Boolean(saved && Object.keys(changes()).length); },
    save: () => update(changes()),
  };
}

// Reuse Home Assistant's flow schemas and native selectors without leaving the panel.
export async function runProfileFlow(host: HTMLElement, hass: Client,
  mode: ProfileFlowMode, entry: string | undefined,
  labels: typeof panelStrings.en, signal: AbortSignal,
  onCreated: (entry: string) => void) {
  const category = "config";
  const path = "config/config_entries/flow";
  const startPath = mode === "create" || mode === "rename" ? "image_lab/analysis_flow" : path;
  const start = { handler: "image_lab", ...(entry && { entry_id: entry }) };
  const successReason = mode === "configure" ? "reconfigure_successful" :
    mode === "rename" ? "rename_successful" : undefined;
  const title = { create: labels.add, configure: labels.editSource, rename: labels.rename }[mode];
  const dialog = createDialog(title, labels.close);
  dialog.innerHTML = `<p class="description" hidden></p><ha-alert alert-type="error" hidden></ha-alert>
    <ha-form hidden></ha-form>
    <ha-dialog-footer slot="footer"><ha-button slot="primaryAction" variant="brand" disabled></ha-button>
    <ha-button slot="secondaryAction" appearance="plain"></ha-button></ha-dialog-footer>`;
  const form = dialog.querySelector("ha-form")! as ProfileForm;
  // Hidden HA forms still render while the first schema is being fetched.
  Object.assign(form, { hass, data: {}, schema: [] });
  const description = dialog.querySelector("p")!;
  const error = dialog.querySelector<HTMLElement>("ha-alert")!;
  const cancel = dialog.querySelector<HTMLElement>('[slot="secondaryAction"]')!;
  const submit = dialog.querySelector<HTMLElement>('[slot="primaryAction"]')!;
  let flowId: string | undefined;
  let step: Extract<Step, {type: "form"}> | undefined;
  let closed = false;
  let busy = false;
  let dirty = false;

  const discard = (id: string) => void hass.callApi("DELETE", path + "/" + id).catch(() => {});
  const close = () => {
    if (closed) return;
    closed = true;
    dialog.remove();
    signal.removeEventListener("abort", close);
    if (flowId && !busy) discard(flowId);
  };
  actionLabel(cancel, labels.cancel, "close");
  cancel.onclick = close;
  actionLabel(submit, labels.save, "content-save-outline");
  dialog.addEventListener("closed", close, { once: true });
  signal.addEventListener("abort", close, { once: true });
  form.addEventListener("value-changed", event => {
    form.data = (event as CustomEvent<{value: Values}>).detail.value;
    dirty = true;
    dialog.setAttribute("prevent-scrim-close", "");
  });
  host.append(dialog);
  dialog.setAttribute("open", "");

  let translate: Awaited<ReturnType<typeof profileTranslations>> | undefined;
  async function advance() {
    if (closed || busy) return;
    busy = true;
    dialog.setAttribute("prevent-scrim-close", "");
    error.hidden = true;
    submit.setAttribute("loading", "");
    form.inert = true;
    try {
      translate ??= await profileTranslations(hass, category);
      if (closed) return;
      const next = await hass.callApi<Step>("POST", flowId ? path + "/" + flowId : startPath,
        flowId ? form.data : start);
      flowId = next.type === "form" ? next.flow_id : undefined;
      if (closed) return;
      if (next.type === "create_entry" || (next.type === "abort" && next.reason === successReason)) {
        close();
        if (mode === "create" && next.type === "create_entry" && next.result?.entry_id)
          onCreated(next.result.entry_id);
        return;
      }
      if (next.type === "abort") {
        error.textContent = translate(category + ".abort." + next.reason) || next.reason;
        error.hidden = false;
        form.hidden = description.hidden = submit.hidden = true;
        return;
      }
      const prefix = category + ".step." + next.step_id;
      const data: Values = step?.step_id === next.step_id ? { ...form.data } : {};
      step = next;
      dialog.setAttribute("header-title", translate(prefix + ".title") || title);
      description.textContent = translate(prefix + ".description");
      description.hidden = !description.textContent;
      showForm(form, hass, next.data_schema, data, next.errors, translate, category, next.step_id);
      if (next.errors?.base) {
        error.textContent = translate(category + ".error." + next.errors.base) || next.errors.base;
        error.hidden = false;
      }
      const last = next.last_step;
      actionLabel(submit, last ? labels.save : labels.next, last ? "content-save-outline" : "arrow-right");
    } catch {
      if (!closed) {
        error.textContent = labels.optionsError;
        error.hidden = false;
        actionLabel(submit, labels.retry, "refresh");
      }
    } finally {
      busy = false;
      form.inert = false;
      dialog.toggleAttribute("prevent-scrim-close", dirty);
      submit.removeAttribute("loading");
      submit.removeAttribute("disabled");
      if (closed && flowId) discard(flowId);
    }
  }
  submit.onclick = () => {
    if (step?.data_schema.some(field => field.required && (form.data[field.name] == null || form.data[field.name] === ""))) {
      error.textContent = labels.requiredFields;
      error.hidden = false;
      return;
    }
    void advance();
  };
  if (mode === "rename") form.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    submit.click();
  });
  await advance();
}
