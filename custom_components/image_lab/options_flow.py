"""Point native Home Assistant options to the Image Lab panel."""

from homeassistant.config_entries import ConfigFlowResult, OptionsFlow
from homeassistant.helpers import selector


def select_options(
    options: list[str] | list[selector.SelectOptionDict],
    translation_key: str | None = None,
) -> selector.SelectSelector:
    config = selector.SelectSelectorConfig(options=options)
    if translation_key:
        config["translation_key"] = translation_key
    return selector.SelectSelector(config)


class ImageLabOptionsFlow(OptionsFlow):
    """Keep publication settings in the panel."""

    async def async_step_init(self, user_input: dict | None = None) -> ConfigFlowResult:
        return self.async_abort(reason="open_panel")
