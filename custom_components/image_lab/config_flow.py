"""Set up and reconfigure image analyses with native Home Assistant selectors."""

from typing import Any
from uuid import uuid4

import probatio
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_ENTITY_ID, CONF_NAME
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import selector

from .analysis import MODULES, resolve_entity_id
from .const import (
    CONF_FILE,
    CONF_IMAGE_KEY,
    CONF_IMAGE_REVISION,
    CONF_MODULE,
    CONF_SOURCE_TYPE,
    DOMAIN,
    IMAGE_TYPES,
    INSTALLATION_ID,
    SOURCE_ANALYSIS,
    SOURCE_RENAME,
    SourceType,
)
from .images import ImageError, get_image_storage
from .module_settings import module_settings_fields, normalize_module_settings
from .options_flow import ImageLabOptionsFlow, select_options

PROFILE_SCHEMA = probatio.Schema(
    {
        probatio.Required(CONF_NAME): selector.TextSelector(),
        probatio.Required(CONF_MODULE): select_options(list(MODULES), CONF_MODULE),
    }
)


class ImageLabConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create one configuration entry per analysis."""

    VERSION = 1

    _entry: ConfigEntry | None = None
    _title: str
    _settings: dict[str, Any]

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> ImageLabOptionsFlow:
        return ImageLabOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Install Image Lab with an empty workspace."""
        await self.async_set_unique_id(INSTALLATION_ID)
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title="Image Lab", data={})

    async def async_step_analysis(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose the name and module from the Image Lab panel."""
        errors = {}
        if user_input is not None:
            title = user_input[CONF_NAME].strip()
            if not title:
                errors[CONF_NAME] = "name_required"
            else:
                self._title = title
                self._settings = {
                    CONF_MODULE: user_input[CONF_MODULE],
                    CONF_IMAGE_KEY: uuid4().hex,
                }
                return await self.async_step_source()

        return self.async_show_form(
            step_id=SOURCE_ANALYSIS,
            data_schema=self.add_suggested_values_to_schema(
                PROFILE_SCHEMA, user_input or {}
            ),
            errors=errors,
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Edit the source while keeping the analysis ID and module."""
        self._entry = self._get_reconfigure_entry()
        if CONF_MODULE not in self._entry.data:
            return self.async_abort(reason="profile_not_found")
        self._settings = {
            CONF_MODULE: self._entry.data[CONF_MODULE],
            CONF_IMAGE_KEY: self._entry.data.get(CONF_IMAGE_KEY) or uuid4().hex,
        }
        return await self.async_step_source(user_input)

    async def async_step_rename(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Rename an analysis without asking for its source again."""
        entry_id = self.context.get("entry_id")
        entry = self.hass.config_entries.async_get_entry(entry_id) if entry_id else None
        if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
            return self.async_abort(reason="profile_not_found")
        if user_input is not None and (title := user_input[CONF_NAME].strip()):
            return self.async_update_reload_and_abort(
                entry, title=title, reason="rename_successful",
                reload_even_if_entry_is_unchanged=False,
            )
        return self.async_show_form(
            step_id=SOURCE_RENAME,
            data_schema=probatio.Schema(
                {probatio.Required(CONF_NAME, default=entry.title): selector.TextSelector()}
            ),
            errors={CONF_NAME: "name_required"} if user_input is not None else None,
            last_step=True,
        )

    async def async_step_source(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose a supported source and set initial module settings for new analyses."""
        module = self._settings[CONF_MODULE]
        sources = MODULES[module].sources
        previous = self._entry.data if self._entry else {}
        default_source = previous.get(CONF_SOURCE_TYPE)
        if default_source not in sources:
            default_source = sources[0]
        fields: dict[probatio.Required, selector.Selector[Any]] = {}
        errors = {}
        fields[probatio.Required(CONF_SOURCE_TYPE, default=default_source)] = (
            select_options(list(sources), CONF_SOURCE_TYPE)
        )
        module_fields = module_settings_fields(module, previous) if not self._entry else {}
        fields.update(module_fields)
        if user_input is not None:
            settings = {field.schema: user_input[field.schema] for field in module_fields}
            errors.update(normalize_module_settings(settings))
            if not errors:
                self._settings.update(settings)
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
                # Read the current entry after the image import so changes from
                # the separate settings form survive a source edit in progress.
                data = {**self._entry.data, **self._settings}
                if source is SourceType.UPLOAD:
                    data.pop(CONF_ENTITY_ID, None)
                else:
                    data.pop(CONF_IMAGE_REVISION, None)
                if (
                    source is not SourceType.CAMERA
                    or self._entry.data.get(CONF_ENTITY_ID) != data[CONF_ENTITY_ID]
                ):
                    data.pop("region", None)
                options = dict(self._entry.options)
                if options and source is not SourceType.CAMERA:
                    options["interval_minutes"] = 0
                    options.pop("confirmation_seconds", None)
                return self.async_update_reload_and_abort(
                    self._entry,
                    data=data,
                    options=options,
                    reload_even_if_entry_is_unchanged=False,
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
                self._settings[CONF_IMAGE_REVISION] = self._entry.data[
                    CONF_IMAGE_REVISION
                ]
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
