"""Set up and reconfigure image analyses with native Home Assistant selectors."""

from typing import Any
from uuid import uuid4

import probatio
from homeassistant.config_entries import (
    SOURCE_RECONFIGURE,
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
)
from homeassistant.const import CONF_ENTITY_ID, CONF_NAME
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import selector

from .analysis import MODULES, resolve_entity_id
from .const import (
    CONF_FILE,
    CONF_IMAGE_KEY,
    CONF_IMAGE_REVISION,
    CONF_MODULE,
    CONF_OBJECT_CONFIDENCE,
    CONF_OBJECT_LABELS,
    CONF_PALETTE_SIZE,
    CONF_SOURCE_TYPE,
    DEFAULT_OBJECT_CONFIDENCE,
    DEFAULT_PALETTE_SIZE,
    DOMAIN,
    IMAGE_TYPES,
    MAX_OBJECT_CONFIDENCE,
    MAX_PALETTE_SIZE,
    MIN_OBJECT_CONFIDENCE,
    MIN_PALETTE_SIZE,
    SourceType,
)
from .images import ImageError, get_image_storage
from .object_detection import LABELS


def _select(options: list[str], translation_key: str) -> selector.SelectSelector:
    return selector.SelectSelector(
        selector.SelectSelectorConfig(options=options, translation_key=translation_key)
    )


PROFILE_SCHEMA = probatio.Schema(
    {
        probatio.Required(CONF_NAME): selector.TextSelector(),
        probatio.Required(CONF_MODULE): _select(list(MODULES), CONF_MODULE),
    }
)


class ImageLabConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create one configuration entry per analysis."""

    VERSION = 1

    _entry: ConfigEntry | None = None
    _title: str
    _settings: dict[str, Any]

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose the name and module."""
        settings = self._entry.data if self._entry else {}
        suggested = {**settings, CONF_NAME: self._entry.title} if self._entry else {}
        errors = {}
        if user_input is not None:
            title = user_input[CONF_NAME].strip()
            if not title:
                errors[CONF_NAME] = "name_required"
            else:
                self._title = title
                self._settings = {
                    CONF_MODULE: user_input[CONF_MODULE],
                    CONF_IMAGE_KEY: settings.get(CONF_IMAGE_KEY) or uuid4().hex,
                }
                return await self.async_step_source()

        return self.async_show_form(
            step_id=self.source if self.source == SOURCE_RECONFIGURE else "user",
            data_schema=self.add_suggested_values_to_schema(
                PROFILE_SCHEMA, user_input or suggested
            ),
            errors=errors,
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Edit an existing analysis without changing its ID."""
        self._entry = self._get_reconfigure_entry()
        return await self.async_step_user(user_input)

    async def async_step_source(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose a supported source and configure module-specific options."""
        module = self._settings[CONF_MODULE]
        sources = MODULES[module].sources
        previous = self._entry.data if self._entry else {}
        default_source = previous.get(CONF_SOURCE_TYPE)
        if default_source not in sources:
            default_source = sources[0]
        fields: dict[probatio.Required, selector.Selector[Any]] = {
            probatio.Required(CONF_SOURCE_TYPE, default=default_source): _select(
                list(sources), CONF_SOURCE_TYPE
            )
        }
        errors = {}
        if module == "palette":
            default_size = previous.get(CONF_PALETTE_SIZE, DEFAULT_PALETTE_SIZE)
            if user_input is not None:
                size = user_input.get(CONF_PALETTE_SIZE, default_size)
                if MIN_PALETTE_SIZE <= size <= MAX_PALETTE_SIZE and int(size) == size:
                    self._settings[CONF_PALETTE_SIZE] = int(size)
                else:
                    errors[CONF_PALETTE_SIZE] = "invalid_palette_size"
            fields[probatio.Required(CONF_PALETTE_SIZE, default=default_size)] = (
                selector.NumberSelector(
                    selector.NumberSelectorConfig(
                        min=MIN_PALETTE_SIZE,
                        max=MAX_PALETTE_SIZE,
                        step=1,
                        mode=selector.NumberSelectorMode.BOX,
                    )
                )
            )
        if module == "object_detection":
            default_confidence = previous.get(
                CONF_OBJECT_CONFIDENCE, DEFAULT_OBJECT_CONFIDENCE
            )
            default_labels = previous.get(CONF_OBJECT_LABELS, [])
            fields[
                probatio.Required(CONF_OBJECT_CONFIDENCE, default=default_confidence)
            ] = selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=MIN_OBJECT_CONFIDENCE,
                    max=MAX_OBJECT_CONFIDENCE,
                    step=1,
                    unit_of_measurement="%",
                    mode=selector.NumberSelectorMode.BOX,
                )
            )
            fields[probatio.Required(CONF_OBJECT_LABELS, default=default_labels)] = (
                selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=list(LABELS),
                        translation_key=CONF_OBJECT_LABELS,
                        multiple=True,
                        sort=True,
                    )
                )
            )
            if user_input is not None:
                confidence = user_input.get(CONF_OBJECT_CONFIDENCE, default_confidence)
                if (
                    MIN_OBJECT_CONFIDENCE <= confidence <= MAX_OBJECT_CONFIDENCE
                    and confidence % 1 == 0
                ):
                    self._settings[CONF_OBJECT_CONFIDENCE] = int(confidence)
                else:
                    errors[CONF_OBJECT_CONFIDENCE] = "invalid_object_confidence"
                labels = user_input.get(CONF_OBJECT_LABELS, default_labels)
                self._settings[CONF_OBJECT_LABELS] = list(dict.fromkeys(labels))
        if user_input is not None and not errors:
            self._settings[CONF_SOURCE_TYPE] = user_input[CONF_SOURCE_TYPE]
            return await self.async_step_image()
        schema = probatio.Schema(fields)
        if errors:
            schema = self.add_suggested_values_to_schema(schema, user_input)
        return self.async_show_form(step_id="source", data_schema=schema, errors=errors)

    async def async_step_image(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose the entity or accept a validated image from the native upload."""
        source = SourceType(self._settings[CONF_SOURCE_TYPE])
        previous = (
            self._entry.data
            if self._entry and self._entry.data[CONF_SOURCE_TYPE] == source
            else {}
        )
        errors = {}
        if user_input is not None:
            if source is SourceType.UPLOAD:
                errors = await self._async_import(user_input.get(CONF_FILE))
            else:
                entity_id = resolve_entity_id(self.hass, user_input[CONF_ENTITY_ID])
                if not entity_id or not entity_id.startswith(f"{source}."):
                    errors[CONF_ENTITY_ID] = "invalid_entity"
                else:
                    registered = er.async_get(self.hass).async_get(entity_id)
                    self._settings[CONF_ENTITY_ID] = (
                        registered.id if registered else entity_id
                    )

            if not errors:
                if self._entry is None:
                    return self.async_create_entry(
                        title=self._title, data=self._settings
                    )
                if (
                    self.hass.config_entries.async_get_entry(self._entry.entry_id)
                    is None
                ):
                    return self.async_abort(reason="profile_not_found")
                return self.async_update_and_abort(
                    self._entry, title=self._title, data=self._settings
                )

        if source is SourceType.UPLOAD:
            field = probatio.Optional if previous else probatio.Required
            schema = probatio.Schema(
                {
                    field(CONF_FILE): selector.FileSelector(
                        selector.FileSelectorConfig(
                            accept=",".join(IMAGE_TYPES.values())
                        )
                    )
                }
            )
            step = "replace_image" if previous else "upload_image"
        else:
            schema = self.add_suggested_values_to_schema(
                probatio.Schema(
                    {
                        probatio.Required(CONF_ENTITY_ID): selector.EntitySelector(
                            selector.EntitySelectorConfig(domain=source)
                        )
                    }
                ),
                {
                    CONF_ENTITY_ID: resolve_entity_id(
                        self.hass, previous.get(CONF_ENTITY_ID)
                    )
                },
            )
            step = "select_entity"

        # The flow manager calls the displayed step on submission.
        return self.async_show_form(
            step_id=step, data_schema=schema, errors=errors, last_step=True
        )

    async_step_select_entity = async_step_image
    async_step_upload_image = async_step_image
    async_step_replace_image = async_step_image

    async def _async_import(self, upload_id: str | None) -> dict[str, str]:
        if upload_id is None:
            if self._entry and CONF_IMAGE_REVISION in self._entry.data:
                self._settings[CONF_IMAGE_REVISION] = self._entry.data[CONF_IMAGE_REVISION]
            return {}
        try:
            await get_image_storage(self.hass).async_import(
                self._settings[CONF_IMAGE_KEY],
                upload_id,
                self._entry.entry_id if self._entry else None,
            )
        except ImageError as err:
            return {CONF_FILE: err.reason}
        except (OSError, HomeAssistantError):
            return {CONF_FILE: "storage_error"}
        # Replacing only the file must also notify open panels of the change.
        self._settings[CONF_IMAGE_REVISION] = upload_id
        return {}
