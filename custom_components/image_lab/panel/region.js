export function paintRegion(overlay, region) {
    overlay.hidden = !region;
    if (!region)
        return;
    overlay.style.left = region.x * 100 + "%";
    overlay.style.top = region.y * 100 + "%";
    overlay.style.width = region.width * 100 + "%";
    overlay.style.height = region.height * 100 + "%";
}
/** Pointer coordinates follow the displayed, oriented image on desktop and touch. */
export function bindRegionDrawing(box, enabled, preview, commit) {
    let start;
    const point = (event) => {
        const rect = box.getBoundingClientRect();
        const normalize = (v) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
        return { x: normalize((event.clientX - rect.left) / rect.width),
            y: normalize((event.clientY - rect.top) / rect.height) };
    };
    box.addEventListener("pointerdown", event => {
        if (!enabled() || start || event.button !== 0)
            return;
        event.preventDefault();
        box.setPointerCapture(event.pointerId);
        start = { ...point(event), pointer: event.pointerId };
    });
    const draw = (event) => {
        if (!start || start.pointer !== event.pointerId)
            return;
        const end = point(event);
        const region = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
            width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
        if (event.type === "pointermove")
            preview(region);
        else {
            start = undefined;
            if (enabled() && region.width >= 0.001 && region.height >= 0.001)
                commit(region);
            else
                preview();
        }
    };
    box.addEventListener("pointermove", draw);
    box.addEventListener("pointerup", draw);
    const cancel = () => { start = undefined; preview(); };
    box.addEventListener("lostpointercapture", cancel);
    box.addEventListener("pointercancel", cancel);
    return cancel;
}
