import { actionLabel } from "./action.js";
import { publicationStrings } from "./translations.js";
const intervalPresets = [5, 15, 30, 60];
// Match the backend limit for Python timedelta.
const maxIntervalMinutes = 999_999_999 * 1440 - 1;
export const publicationMarkup = `
  <section id="publication" class="settingsSection" aria-labelledby="publicationTitle">
    <h3 id="publicationTitle" class="settingsTitle"></h3>
    <div id="publicationEntity">
      <span id="publicationEntityLabel" class="secondary"></span>
      <ha-button id="outputEntity" appearance="plain" size="s"></ha-button>
    </div>
    <div id="publicationFields" class="publicationFields">
      <ha-select id="publicationOutput"></ha-select>
      <ha-alert id="publicationNeedsStates" alert-type="info" hidden>
        <span id="publicationReferencesHint"></span>
        <ha-button id="publicationReferences" appearance="plain"></ha-button>
      </ha-alert>
      <div id="publicationMapping" class="publicationFields" hidden>
        <div class="publicationPair">
          <ha-select id="publicationOnState" required></ha-select>
          <ha-select id="publicationOffState" required></ha-select>
        </div>
        <ha-select id="publicationClass" required></ha-select>
      </div>
      <div id="publicationTiming" class="publicationPair" hidden>
        <ha-select id="publicationInterval"></ha-select>
        <ha-input id="publicationConfirmation" type="number" min="0" max="60" step="1"></ha-input>
        <p id="publicationConfirmationHint" class="secondary"></p>
      </div>
      <ha-input id="publicationCustom" type="number" min="1" max="${maxIntervalMinutes}" step="1" hidden></ha-input>
    </div>
    <ha-alert id="publicationError" alert-type="error" role="alert" hidden></ha-alert>
  </section>`;
export const publicationStyles = `
  .publicationFields, .publicationPair { display:grid; gap:var(--ha-space-2, 8px); min-width:0; }
  .publicationPair { grid-template-columns:repeat(2, minmax(0, 1fr)); align-items:start; }
  #publicationTiming.intervalOnly { grid-template-columns:minmax(0, 1fr); }
  #publication :is(ha-select, ha-input) { min-width:0; display:block; }
  #publication ha-input { --ha-input-padding-bottom:0; }
  #publicationConfirmationHint {
    grid-column:2; margin:0; font-size:var(--ha-font-size-s, 12px);
  }
  #publicationReferences { display:block; width:max-content; max-width:100%; }
  #publicationReferences::part(base) { padding-inline:0; }
  #publicationEntity {
    display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;
    gap:0 var(--ha-space-2, 8px); margin-block-end:var(--ha-space-2, 8px); min-width:0;
  }
  #publicationEntityLabel { font-size:var(--ha-font-size-s, 12px); }
  #outputEntity {
    max-width:100%; --ha-button-label-overflow:visible;
    white-space:normal; overflow-wrap:anywhere; text-align:start;
  }
  #outputEntity::part(base) { padding-inline:var(--ha-space-2, 8px); }
  #publicationError { margin-block:var(--ha-space-2, 8px) 0; }
`;
export class PublicationSettings {
    root;
    changed;
    profile;
    context;
    snapshot;
    states = [];
    labels = publicationStrings.en;
    constructor(root, changed, openReferences) {
        this.root = root;
        this.changed = changed;
        this.get("publicationReferences").addEventListener("click", openReferences);
        const fields = this.get("publicationFields");
        fields.addEventListener("selected", event => {
            const target = event.target;
            target.value = event.detail.value;
            this.edited();
        });
        fields.addEventListener("input", event => {
            if (event.target.localName === "ha-input")
                this.edited();
        });
    }
    get(id) {
        return this.root.querySelector("#" + id);
    }
    select(id) { return this.get("publication" + id); }
    field(id) { return this.get("publication" + id); }
    get camera() { return this.profile?.source_type === "camera"; }
    get confirmation() { return this.camera && this.profile?.module !== "meter"; }
    configure(profile, language, entityId, entityName) {
        const context = profile && `${profile.profile_id}/${profile.source_type}/${profile.entity_id ?? ""}`;
        const contextChanged = context !== this.context;
        const savedChanged = JSON.stringify(profile?.publication) !== JSON.stringify(this.snapshot);
        const labels = publicationStrings[language];
        const languageChanged = labels !== this.labels;
        this.profile = profile;
        this.context = context;
        this.labels = labels;
        this.root.hidden = !profile;
        if (contextChanged)
            this.states = [];
        if (!profile) {
            this.snapshot = undefined;
            return;
        }
        this.snapshot = profile.publication;
        if (contextChanged || savedChanged || languageChanged)
            this.localize();
        if (contextChanged || savedChanged) {
            this.fill(profile.publication.settings);
            this.error("");
        }
        this.setEntity(entityId, entityName);
        this.refresh();
    }
    setEntity(entityId, entityName) {
        this.get("publicationEntity").hidden = !entityId;
        if (entityId) {
            const button = this.get("outputEntity");
            actionLabel(button, entityName || entityId, "information-outline");
            button.title = entityId;
        }
    }
    setStates(states) {
        if (!this.profile || this.profile.module !== "comparison" || this.states === states)
            return;
        this.states = states;
        this.setChoices();
        this.refresh();
    }
    localize() {
        const labels = this.labels;
        for (const [id, label] of Object.entries({
            publicationTitle: labels.title, publicationEntityLabel: labels.currentEntity,
            publicationReferencesHint: labels.need_two_states, publicationConfirmationHint: labels.confirmationHint,
        }))
            this.get(id).textContent = label;
        actionLabel(this.get("publicationReferences"), labels.references, "image-multiple-outline");
        this.select("Output").label = labels.output;
        this.select("OnState").label = labels.on;
        this.select("OffState").label = labels.off;
        this.select("Class").label = labels.sensorClass;
        const classes = labels.classes;
        this.select("Class").options = this.snapshot.binary_classes.map(value => ({ value, label: classes[value] }));
        this.select("Interval").label = labels.interval;
        this.select("Interval").options = [
            { value: "0", label: labels.manual },
            ...intervalPresets.map(value => ({ value: String(value), label: value === 60 ? labels.hour : `${value} min` })),
            { value: "custom", label: labels.custom },
        ];
        this.field("Custom").setAttribute("label", labels.customMinutes);
        this.field("Confirmation").setAttribute("label", labels.confirmation);
        this.setChoices();
    }
    setChoices() {
        const outputs = this.labels.outputs;
        this.select("Output").options = this.snapshot.output_types.map(value => ({
            value, label: outputs[value], disabled: value === "binary" && this.states.length < 2,
        }));
        const states = this.states.map(({ id, name }) => ({ value: id, label: name }));
        this.select("OnState").options = states;
        this.select("OffState").options = states;
    }
    fill(saved) {
        this.select("Output").value = saved.output;
        this.select("OnState").value = saved.on_state;
        this.select("OffState").value = saved.off_state;
        this.select("Class").value = saved.binary_class;
        const minutes = saved.interval_minutes;
        this.select("Interval").value = minutes === 0 || intervalPresets.includes(minutes) ? String(minutes) : "custom";
        this.field("Custom").value = minutes > 0 ? String(minutes) : "";
        this.field("Confirmation").value = String(saved.confirmation_seconds);
    }
    draft(profileId) {
        if (this.profile?.profile_id !== profileId || !this.snapshot)
            return;
        const saved = this.snapshot.settings;
        const changes = {};
        const output = this.select("Output").value;
        if (output !== saved.output)
            changes.output = output;
        if (this.camera) {
            const mode = this.select("Interval").value;
            const interval = this.field("Custom");
            const minutes = Number(mode === "custom" ? interval.value : mode);
            // The native required marker reserves a hint row inside ha-input.
            // Validate the numbers here so both timing fields stay aligned.
            if (mode === "custom" && (!interval.value || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > maxIntervalMinutes))
                throw new Error("invalid_frequency");
            if (minutes !== saved.interval_minutes)
                changes.interval_minutes = minutes;
        }
        if (this.confirmation && output !== "none") {
            const input = this.field("Confirmation");
            const seconds = Number(input.value);
            if (!input.value || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 60)
                throw new Error("invalid_delay");
            if (seconds !== saved.confirmation_seconds)
                changes.confirmation_seconds = seconds;
        }
        if (output === "binary") {
            const binary_class = this.select("Class").value;
            const on_state = this.select("OnState").value;
            const off_state = this.select("OffState").value;
            if (changes.output || binary_class !== saved.binary_class || on_state !== saved.on_state || off_state !== saved.off_state) {
                if (this.states.length < 2)
                    throw new Error("need_two_states");
                const ids = this.states.map(state => state.id);
                if (!ids.includes(on_state) || !ids.includes(off_state))
                    throw new Error("state_removed");
                if (on_state === off_state)
                    throw new Error("different_states");
                Object.assign(changes, { binary_class, on_state, off_state });
            }
        }
        return Object.keys(changes).length ? changes : undefined;
    }
    edited() {
        this.error("");
        this.refresh();
    }
    error(message) {
        const element = this.get("publicationError");
        element.textContent = message;
        element.hidden = !message;
    }
    refresh() {
        const profile = this.profile;
        if (!profile || !this.snapshot)
            return;
        const comparison = profile.module === "comparison";
        const output = this.select("Output").value;
        this.get("publicationNeedsStates").hidden = !comparison || this.states.length >= 2;
        this.get("publicationMapping").hidden = output !== "binary";
        this.get("publicationTiming").hidden = !this.camera;
        this.get("publicationTiming").classList.toggle("intervalOnly", !this.confirmation);
        this.field("Confirmation").hidden = !this.confirmation;
        this.field("Confirmation").toggleAttribute("disabled", output === "none");
        this.get("publicationConfirmationHint").hidden = !this.confirmation || output === "none";
        this.field("Custom").hidden = !this.camera || this.select("Interval").value !== "custom";
        this.changed();
    }
    showError(error) {
        const key = error instanceof Error ? error.message : error?.code;
        const labels = this.labels;
        this.error(key && typeof labels[key] === "string" ? labels[key] : this.labels.failed);
    }
}
