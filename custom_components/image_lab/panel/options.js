// Run the integration's existing options flow with HA's schema-driven form.
// Both entry points therefore use the same selectors, translations and validation.
export async function editOutputOptions(host, hass, entry, labels, signal) {
    const path = "config/config_entries/options/flow";
    const dialog = document.createElement("ha-dialog");
    dialog.setAttribute("header-title", labels.settings);
    dialog.innerHTML = `<p class="description" hidden></p><ha-alert alert-type="error" hidden></ha-alert>
    <ha-form hidden></ha-form>
    <ha-dialog-footer slot="footer"><ha-button slot="secondaryAction" appearance="plain"></ha-button>
    <ha-button slot="primaryAction" variant="brand" disabled></ha-button></ha-dialog-footer>`;
    const form = dialog.querySelector("ha-form");
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
    cancel.textContent = labels.cancel;
    cancel.onclick = close;
    submit.textContent = labels.save;
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
        submit.setAttribute("disabled", "");
        form.inert = true;
        try {
            if (!resources) {
                const translations = await Promise.all(["options", "selector"].map(category => hass.connection.sendMessagePromise({
                    type: "frontend/get_translations", language: hass.locale.language,
                    integration: ["image_lab"], category,
                })));
                resources = Object.assign({}, ...translations.map(result => result.resources));
            }
            if (closed)
                return;
            const next = await hass.callApi("POST", flowId ? path + "/" + flowId : path, flowId ? form.data : { handler: entry });
            flowId = next.type === "form" ? next.flow_id : undefined;
            if (closed)
                return;
            const translate = (key) => resources?.["component.image_lab." + key] ?? "";
            if (next.type === "create_entry") {
                close();
                return;
            }
            if (next.type === "abort") {
                error.textContent = translate("options.abort." + next.reason) || next.reason;
                error.hidden = false;
                form.hidden = description.hidden = submit.hidden = true;
                return;
            }
            const prefix = "options.step." + next.step_id;
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
                context: { domain: "image_lab", handler: entry },
                computeLabel: (field) => translate(prefix + ".data." + field.name) || field.name,
                computeHelper: (field) => translate(prefix + ".data_description." + field.name),
                computeError: (key) => translate("options.error." + key) || key,
                localizeValue: (key) => translate("selector." + key),
            });
            if (next.errors?.base) {
                error.textContent = translate("options.error." + next.errors.base) || next.errors.base;
                error.hidden = false;
            }
            submit.textContent = labels.save;
        }
        catch {
            if (!closed) {
                error.textContent = labels.optionsError;
                error.hidden = false;
                submit.textContent = labels.retry;
            }
        }
        finally {
            busy = false;
            form.inert = false;
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
