import { actionLabel } from "./action.js";
// Reuse Home Assistant's flow schemas and native selectors without leaving the panel.
export async function runProfileFlow(host, hass, mode, entry, labels, signal, callbacks) {
    const isOptions = mode === "options";
    const inline = mode === "configure";
    const category = isOptions ? "options" : "config";
    const path = `config/config_entries/${isOptions ? "options/" : ""}flow`;
    const start = isOptions ? { handler: entry } : { handler: "image_lab", ...(entry && { entry_id: entry }) };
    const container = document.createElement(inline ? "div" : "ha-dialog");
    const dialog = inline ? undefined : container;
    const footer = inline ? 'div class="toolbar"' : 'ha-dialog-footer slot="footer"';
    dialog?.setAttribute("header-title", mode === "create" ? labels.add : labels.settings);
    container.innerHTML = `<p class="description" hidden></p><ha-alert alert-type="error" hidden></ha-alert>
    <ha-form hidden></ha-form>
    <${footer}><ha-button slot="primaryAction" variant="brand" disabled></ha-button>
    <ha-button slot="secondaryAction" appearance="plain"></ha-button></${inline ? "div" : "ha-dialog-footer"}>`;
    const form = container.querySelector("ha-form");
    // Hidden HA forms still render while the first schema is being fetched.
    Object.assign(form, { hass, data: {}, schema: [] });
    const description = container.querySelector("p");
    const error = container.querySelector("ha-alert");
    const cancel = container.querySelector('[slot="secondaryAction"]');
    const submit = container.querySelector('[slot="primaryAction"]');
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
        container.remove();
        signal.removeEventListener("abort", close);
        if (flowId && !busy)
            discard(flowId);
        if (!signal.aborted)
            callbacks.onClosed?.();
    };
    actionLabel(cancel, labels.cancel, "close");
    cancel.onclick = close;
    actionLabel(submit, labels.save, "content-save-outline");
    dialog?.addEventListener("closed", close, { once: true });
    signal.addEventListener("abort", close, { once: true });
    form.addEventListener("value-changed", event => {
        form.data = event.detail.value;
        dirty = true;
        dialog?.setAttribute("prevent-scrim-close", "");
    });
    host.append(container);
    dialog?.setAttribute("open", "");
    let resources;
    async function advance() {
        if (closed || busy)
            return;
        busy = true;
        dialog?.setAttribute("prevent-scrim-close", "");
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
                    callbacks.onCreated?.(next.result.entry_id);
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
            dialog?.setAttribute("header-title", translate(prefix + ".title") || labels.settings);
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
            dialog?.toggleAttribute("prevent-scrim-close", dirty);
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
