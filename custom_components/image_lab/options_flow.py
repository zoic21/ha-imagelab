"""Configure the entity and its automatic camera updates in native HA forms."""

from datetime import timedelta

import probatio
from homeassistant.config_entries import ConfigFlowResult, OptionsFlowWithReload
from homeassistant.helpers import selector

from .comparison_store import get_comparison_store
from .const import CONF_MODULE, CONF_SOURCE_TYPE, SourceType
from .images import ImageError
from .output import BINARY_CLASSES, OUTPUTS


def select_options(
    options: list[str] | list[selector.SelectOptionDict],
    translation_key: str | None = None,
) -> selector.SelectSelector:
    config = selector.SelectSelectorConfig(options=options)
    if translation_key:
        config["translation_key"] = translation_key
    return selector.SelectSelector(config)


class ImageLabOptionsFlow(OptionsFlowWithReload):
    """Keep output settings separate from source and analysis configuration."""

    _output: dict

    async def async_step_init(self, user_input: dict | None = None) -> ConfigFlowResult:
        entry = self.config_entry
        kinds = ("none", *OUTPUTS[entry.data[CONF_MODULE]])
        current = entry.options.get("output", "none")
        fields = {
            probatio.Required(
                "output", default=current if current in kinds else "none"
            ): select_options(list(kinds), "output")
        }
        camera = entry.data[CONF_SOURCE_TYPE] == SourceType.CAMERA
        if camera:
            fields[
                probatio.Required(
                    "interval_minutes", default=entry.options.get("interval_minutes", 0)
                )
            ] = selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=0,
                    step=1,
                    mode=selector.NumberSelectorMode.BOX,
                    unit_of_measurement="min",
                )
            )
            fields[
                probatio.Required(
                    "confirmation_seconds",
                    default=entry.options.get("confirmation_seconds", 0),
                )
            ] = selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=0,
                    max=60,
                    step=1,
                    mode=selector.NumberSelectorMode.BOX,
                    unit_of_measurement="s",
                )
            )
        errors = {}
        if user_input is not None:
            kind = user_input["output"]
            minutes = user_input.get("interval_minutes", 0) if camera else 0
            delay = user_input.get("confirmation_seconds", 0) if camera else 0
            if not float(delay).is_integer() or not 0 <= delay <= 60:
                errors["confirmation_seconds"] = "invalid_delay"
            elif (
                minutes < 0
                or not float(minutes).is_integer()
                or minutes >= timedelta.max.days * 1440
            ):
                errors["interval_minutes"] = "invalid_interval"
            elif kind == "none":
                if minutes:
                    errors["interval_minutes"] = "select_output"
                else:
                    return self.async_create_entry(data={})
            else:
                self._output = {"output": kind, "interval_minutes": int(minutes)}
                if camera:
                    self._output["confirmation_seconds"] = int(delay)
                if kind != "binary":
                    return self.async_create_entry(data=self._output)
                return await self.async_step_mapping()
        return self.async_show_form(
            step_id="init",
            errors=errors,
            data_schema=self.add_suggested_values_to_schema(
                probatio.Schema(fields), user_input or {}
            ),
        )

    async def async_step_mapping(
        self, user_input: dict | None = None
    ) -> ConfigFlowResult:
        entry = self.config_entry
        store = get_comparison_store(self.hass, entry.entry_id)
        try:
            async with store.lock:
                gallery = await self.hass.async_add_executor_job(store.load)
        except ImageError:
            return self.async_abort(reason="gallery_unavailable")
        choices = [
            {"value": state["id"], "label": state["name"]}
            for state in gallery["states"]
        ]
        ids = {item["value"] for item in choices}
        if len(ids) < 2:
            return self.async_abort(reason="need_two_states")
        errors = {}
        if user_input is not None:
            if user_input["on_state"] == user_input["off_state"]:
                errors["off_state"] = "different_states"
            elif {user_input["on_state"], user_input["off_state"]} <= ids:
                return self.async_create_entry(data={**self._output, **user_input})
            else:
                errors["base"] = "state_removed"
        schema = probatio.Schema(
            {
                probatio.Required(
                    "binary_class", default=entry.options.get("binary_class", "opening")
                ): select_options(list(BINARY_CLASSES), "binary_class"),
                probatio.Required("on_state"): select_options(choices),
                probatio.Required("off_state"): select_options(choices),
            }
        )
        previous = {
            key: entry.options[key]
            for key in ("on_state", "off_state")
            if entry.options.get(key) in ids
        }
        return self.async_show_form(
            step_id="mapping",
            errors=errors,
            last_step=True,
            data_schema=self.add_suggested_values_to_schema(
                schema, user_input or previous
            ),
        )
