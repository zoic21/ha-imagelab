import { actionLabel } from "./action.js";
async function profileTranslations(hass, category) {
    const translations = await Promise.all([category, "selector"].map(section => hass.connection.sendMessagePromise({
        type: "frontend/get_translations", language: hass.locale.language,
        integration: ["image_lab"], category: section,
    })));
    const resources = Object.assign({}, ...translations.map(result => result.resources));
    return (key) => resources["component.image_lab." + key] ?? "";
}
function showForm(form, hass, schema, data, errors, translate, category, step) {
    const prefix = category + ".step." + step;
    for (const field of schema) {
        const value = field.description?.suggested_value ?? field.default;
        if (!(field.name in data) && value !== undefined)
            data[field.name] = value;
    }
    Object.assign(form, {
        hass, data, schema, error: errors, hidden: false,
        context: { domain: "image_lab", handler: "image_lab" },
        computeLabel: (field) => translate(prefix + ".data." + field.name) || field.name,
        computeHelper: (field) => translate(prefix + ".data_description." + field.name),
        computeError: (key) => translate(category + ".error." + key) || key,
        localizeValue: (key) => translate("selector." + key),
    });
}
export function editModuleSettings(host, hass, entry, labels, signal) {
    const container = document.createElement("div");
    container.innerHTML = `<ha-form hidden></ha-form>
    <ha-button class="moduleSettingsSave" variant="brand" disabled></ha-button>
    <p role="status" class="secondary" hidden></p>`;
    const form = container.querySelector("ha-form");
    const button = container.querySelector("ha-button");
    const status = container.querySelector("p");
    Object.assign(form, { hass, data: {}, schema: [] });
    host.append(container);
    signal.addEventListener("abort", () => container.remove(), { once: true });
    let translate;
    let saved;
    let busy = false;
    const changes = () => Object.fromEntries(form.schema
        .filter(({ name }) => JSON.stringify(form.data[name]) !== JSON.stringify(saved?.[name]))
        .map(({ name }) => [name, form.data[name] ?? null]));
    async function update() {
        if (busy || signal.aborted)
            return;
        const editing = saved !== undefined;
        const data = editing ? changes() : undefined;
        if (data && !Object.keys(data).length)
            return;
        busy = true;
        form.inert = true;
        status.hidden = true;
        button.setAttribute("loading", "");
        actionLabel(button, labels.saveSettings, "content-save-outline");
        try {
            translate ??= await profileTranslations(hass, "config");
            if (signal.aborted)
                return;
            const response = await hass.connection.sendMessagePromise({
                type: "image_lab/module_settings", profile_id: entry, ...(data && { settings: data }),
            });
            if (signal.aborted)
                return;
            const invalid = Object.keys(response.errors).length > 0;
            showForm(form, hass, response.data_schema, invalid ? { ...form.data } : {}, response.errors, translate, "config", "source");
            if (!invalid)
                saved = { ...form.data };
            if (editing && !invalid) {
                status.textContent = labels.settingsSaved;
                status.hidden = false;
            }
        }
        catch {
            if (!signal.aborted) {
                status.textContent = labels.optionsError;
                status.hidden = false;
                if (!editing)
                    actionLabel(button, labels.retry, "refresh");
            }
        }
        finally {
            busy = false;
            form.inert = false;
            button.removeAttribute("loading");
            button.toggleAttribute("disabled", Boolean(saved) && !Object.keys(changes()).length);
        }
    }
    button.addEventListener("click", () => void update());
    form.addEventListener("value-changed", event => {
        form.data = event.detail.value;
        status.hidden = true;
        button.toggleAttribute("disabled", !Object.keys(changes()).length);
    });
    void update();
}
// Reuse Home Assistant's flow schemas and native selectors without leaving the panel.
export async function runProfileFlow(host, hass, mode, entry, labels, signal, onCreated) {
    const isOptions = mode === "options";
    const category = isOptions ? "options" : "config";
    const path = `config/config_entries/${isOptions ? "options/" : ""}flow`;
    const startPath = mode === "create" || mode === "rename" ? "image_lab/analysis_flow" : path;
    const start = isOptions ? { handler: entry } : { handler: "image_lab", ...(entry && { entry_id: entry }) };
    const successReason = mode === "configure" ? "reconfigure_successful" :
        mode === "rename" ? "rename_successful" : undefined;
    const dialog = document.createElement("ha-dialog");
    const title = { create: labels.add, configure: labels.editSource, rename: labels.rename, options: labels.settings }[mode];
    dialog.setAttribute("header-title", title);
    dialog.innerHTML = `<p class="description" hidden></p><ha-alert alert-type="error" hidden></ha-alert>
    <ha-form hidden></ha-form>
    <ha-dialog-footer slot="footer"><ha-button slot="primaryAction" variant="brand" disabled></ha-button>
    <ha-button slot="secondaryAction" appearance="plain"></ha-button></ha-dialog-footer>`;
    const form = dialog.querySelector("ha-form");
    // Hidden HA forms still render while the first schema is being fetched.
    Object.assign(form, { hass, data: {}, schema: [] });
    const description = dialog.querySelector("p");
    const error = dialog.querySelector("ha-alert");
    const cancel = dialog.querySelector('[slot="secondaryAction"]');
    const submit = dialog.querySelector('[slot="primaryAction"]');
    let flowId;
    let step;
    let closed = false;
    let busy = false;
    let dirty = false;
    const discard = (id) => void hass.callApi("DELETE", path + "/" + id).catch(() => { });
    const close = () => {
        if (closed)
            return;
        closed = true;
        dialog.remove();
        signal.removeEventListener("abort", close);
        if (flowId && !busy)
            discard(flowId);
    };
    actionLabel(cancel, labels.cancel, "close");
    cancel.onclick = close;
    actionLabel(submit, labels.save, "content-save-outline");
    dialog.addEventListener("closed", close, { once: true });
    signal.addEventListener("abort", close, { once: true });
    form.addEventListener("value-changed", event => {
        form.data = event.detail.value;
        dirty = true;
        dialog.setAttribute("prevent-scrim-close", "");
    });
    host.append(dialog);
    dialog.setAttribute("open", "");
    let translate;
    async function advance() {
        if (closed || busy)
            return;
        busy = true;
        dialog.setAttribute("prevent-scrim-close", "");
        error.hidden = true;
        submit.setAttribute("loading", "");
        form.inert = true;
        try {
            translate ??= await profileTranslations(hass, category);
            if (closed)
                return;
            const next = await hass.callApi("POST", flowId ? path + "/" + flowId : startPath, flowId ? form.data : start);
            flowId = next.type === "form" ? next.flow_id : undefined;
            if (closed)
                return;
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
            const data = step?.step_id === next.step_id ? { ...form.data } : {};
            step = next;
            dialog.setAttribute("header-title", translate(prefix + ".title") || title);
            description.textContent = translate(prefix + ".description");
            description.hidden = !description.textContent;
            showForm(form, hass, next.data_schema, data, next.errors, translate, category, next.step_id);
            if (next.errors?.base) {
                error.textContent = translate(category + ".error." + next.errors.base) || next.errors.base;
                error.hidden = false;
            }
            const last = next.last_step || isOptions;
            actionLabel(submit, last ? labels.save : labels.next, last ? "content-save-outline" : "arrow-right");
        }
        catch {
            if (!closed) {
                error.textContent = labels.optionsError;
                error.hidden = false;
                actionLabel(submit, labels.retry, "refresh");
            }
        }
        finally {
            busy = false;
            form.inert = false;
            dialog.toggleAttribute("prevent-scrim-close", dirty);
            submit.removeAttribute("loading");
            submit.removeAttribute("disabled");
            if (closed && flowId)
                discard(flowId);
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
    if (mode === "rename")
        form.addEventListener("keydown", event => {
            if (event.key !== "Enter" || event.isComposing || event.defaultPrevented)
                return;
            event.preventDefault();
            submit.click();
        });
    await advance();
}
