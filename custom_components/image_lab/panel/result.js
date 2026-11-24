export function analysisTime(time, hass) {
    const stamp = document.createElement("time");
    stamp.dateTime = time;
    stamp.textContent = new Intl.DateTimeFormat(hass?.locale.language, {
        timeZone: hass?.config?.time_zone,
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(time));
    return stamp;
}
export const resultStyles = `
  .resultMeta {
    display: flex; flex-wrap: wrap; align-items: center;
    gap: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
    overflow-wrap: anywhere;
  }
  .resultMeta time {
    font-size: var(--ha-font-size-s, 12px); font-weight: var(--ha-font-weight-normal, 400);
    color: var(--secondary-text-color);
  }
  .resultBadge {
    display: inline-flex; align-items: center; gap: var(--ha-space-1, 4px);
    box-sizing: border-box; max-width: 100%; overflow-wrap: anywhere;
    padding: var(--ha-space-1, 4px) var(--ha-space-2, 8px);
    border-radius: var(--ha-border-radius-pill, 999px);
    background: color-mix(in srgb, var(--success-color, var(--primary-color)) 18%, transparent);
    font-weight: var(--ha-font-weight-medium, 500);
  }`;
