export const profileTabsStyles = `
  :host { --image-lab-tab-height: var(--header-height, 56px); }
  .settingsSavePosition {
    display: flex; justify-content: flex-end;
  }
  .settingsSave {
    /* The form sets the horizontal position while the viewport sets the height. */
    position: fixed; z-index: 3;
    bottom: calc(var(--save-bottom, 16px) + var(--safe-area-inset-bottom, 0px));
    --ha-button-box-shadow: var(--ha-box-shadow-l);
  }
  :host([narrow]) .settingsSave { --save-bottom: calc(var(--image-lab-tab-height) + 28px); }
  @media (prefers-reduced-motion: no-preference) {
    .settingsSave:not([hidden]) { animation: settings-save-enter 0.3s ease; }
    @keyframes settings-save-enter {
      from { bottom: calc(-80px - var(--safe-area-inset-bottom, 0px)); }
    }
  }
  .profileTabLabel {
    display:flex; align-items:center; gap:var(--ha-space-2, 8px);
  }
  .profileTabIcon { display:block; flex:none; --mdc-icon-size:20px; }
  :host(:not([narrow])) .profileTabs {
    /* Center in the toolbar and reserve a touch target at each end. */
    position: absolute; margin: auto;
    inset-block: var(--safe-area-inset-top, 0px) 0;
    inset-inline: calc(var(--ha-space-12, 48px) + 2 * var(--ha-space-3, 12px)
      + max(var(--safe-area-inset-left, 0px), var(--safe-area-inset-right, 0px)));
    max-width: max-content; height: max-content;
    --ha-tab-active-text-color:var(--app-header-text-color, currentColor);
    --ha-tab-indicator-color:var(--app-header-text-color, currentColor);
    --ha-tab-track-color:transparent;
    line-height:normal;
  }
  :host([narrow]) .profileTabs {
    position: fixed; z-index: 2; box-sizing: border-box;
    inset: auto 0 0;
    padding: 0 var(--safe-area-inset-right, 0px)
      var(--safe-area-inset-bottom, 0px) var(--safe-area-inset-left, 0px);
    border-block-start: 1px solid var(--divider-color);
    background: var(--sidebar-background-color, var(--card-background-color));
    color: var(--sidebar-text-color, var(--primary-text-color));
    --ha-tab-track-color: transparent;
    --ha-tab-indicator-color: transparent;
  }
  :host([narrow]) .profileTabs::part(nav) { padding: 0; }
  :host([narrow]) .profileTabs ha-tab-group-tab {
    flex: 1 1 0; min-width: 0;
    font-size: var(--ha-font-size-s, 12px);
  }
  :host([narrow]) .profileTabs ha-tab-group-tab::part(base) {
    box-sizing: border-box; width: 100%; height: var(--image-lab-tab-height);
    justify-content: center; padding: 0 var(--ha-space-1, 4px);
  }
  :host([narrow]) .profileTabLabel {
    flex-direction: column;
    gap: var(--ha-space-1, 4px); min-width: 0; max-width: 100%;
  }
  :host([narrow]) .profileTabText {
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
`;
export function profileTab(id, panel, controls, icon) {
    return `
    <ha-tab-group-tab slot="nav" panel="${panel}" id="${id}" aria-controls="${controls}">
      <span class="profileTabLabel">
        <ha-icon class="profileTabIcon" icon="mdi:${icon}" aria-hidden="true"></ha-icon>
        <span class="profileTabText" id="${id}-label"></span>
      </span>
    </ha-tab-group-tab>
  `;
}
