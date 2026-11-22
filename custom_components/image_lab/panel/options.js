import { actionLabel } from "./action.js";
// Reuse Home Assistant's flow schemas and native selectors without leaving the panel.
export async function runProfileFlow(host, hass, mode, entry, labels, signal, created) {
    const isOptions = mode === "options";
    const category = isOptions ? "options" : "config";
    const path = `config/config_entries/${isOptions ? "options/" : ""}flow`;
    const start = isOptions ? { handler: entry } : { handler: "image_lab", ...(entry && { entry_id: entry }) };
    const dialog = document.createElement("ha-dialog");
    dialog.setAttribute("header-title", labels[mode === "create" ? "add" : mode === "configure" ? "configure" : "settings"]);
    dialog.innerHTML = `<p class="description" hidden></p><ha-alert alert-type="error" hidden></ha-alert>
    <ha-form hidden></ha-form>
    <ha-dialog-footer slot="footer"><ha-button slot="secondaryAction" appearance="plain"></ha-button>
    <ha-button slot="primaryAction" variant="brand" disabled></ha-button></ha-dialog-footer>`;
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
    });
    host.append(dialog);
    dialog.setAttribute("open", "");
    let resources;
    async function advance() {
        if (closed || busy)
            return;
        busy = true;
        error.hidden = true;
        submit.setAttribute("loading", "");
        form.inert = true;
        try {
            if (!resources) {
                const translations = await Promise.all([category, "selector"].map(section => hass.connection.sendMessagePromise({
                    type: "frontend/get_translations", language: hass.locale.language,
                    integration: ["image_lab"], category: section,
                })));
                resources = Object.assign({}, ...translations.map(result => result.resources));
            }
            if (closed)
                return;
            const next = await hass.callApi("POST", flowId ? path + "/" + flowId : mode === "create" ? "image_lab/analysis_flow" : path, flowId ? form.data : start);
            flowId = next.type === "form" ? next.flow_id : undefined;
            if (closed)
                return;
            const translate = (key) => resources?.["component.image_lab." + key] ?? "";
            if (next.type === "create_entry" || (mode === "configure" && next.type === "abort" &&
                next.reason === "reconfigure_successful")) {
                close();
                if (mode === "create" && next.type === "create_entry" && next.result?.entry_id)
                    created(next.result.entry_id);
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
            for (const field of next.data_schema) {
                const value = field.description?.suggested_value ?? field.default;
                if (!(field.name in data) && value !== undefined)
                    data[field.name] = value;
            }
            step = next;
            dialog.setAttribute("header-title", translate(prefix + ".title") || labels.settings);
            description.textContent = translate(prefix + ".description");
            description.hidden = !description.textContent;
            Object.assign(form, {
                hass, data, schema: next.data_schema, error: next.errors, hidden: false,
                context: { domain: "image_lab", handler: "image_lab" },
                computeLabel: (field) => translate(prefix + ".data." + field.name) || field.name,
                computeHelper: (field) => translate(prefix + ".data_description." + field.name),
                computeError: (key) => translate(category + ".error." + key) || key,
                localizeValue: (key) => translate("selector." + key),
            });
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
    await advance();
}
