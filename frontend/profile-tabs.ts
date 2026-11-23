export const profileTabsStyles = `
  :host { --image-lab-tab-height: var(--header-height, 56px); }
  .profileTabIcon { display: none; }
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
    display: flex; flex-direction: column; align-items: center;
    gap: var(--ha-space-1, 4px); min-width: 0; max-width: 100%;
  }
  :host([narrow]) .profileTabIcon { display: block; }
  :host([narrow]) .profileTabText {
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
`;

export function profileTab(id: string, panel: string, controls: string, icon: string) {
  return `
    <ha-tab-group-tab slot="nav" panel="${panel}" id="${id}" aria-controls="${controls}">
      <span class="profileTabLabel">
        <ha-icon class="profileTabIcon" icon="mdi:${icon}" aria-hidden="true"></ha-icon>
        <span class="profileTabText" id="${id}-label"></span>
      </span>
    </ha-tab-group-tab>
  `;
}
