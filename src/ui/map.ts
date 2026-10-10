import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { pointerAzimuth } from "./helpers";

export interface SiteMap {
  setSite(lat: number, lon: number, recenter?: boolean): void;
  setArrows(you: number, opt: number | null): void;
}

const IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const LABELS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

function arrowsSvg(you: number, opt: number | null): string {
  const arrow = (az: number, color: string, dashed: boolean, handle: boolean) => `
    <g transform="rotate(${az})">
      <line x1="0" y1="0" x2="0" y2="-62" stroke="${color}" stroke-width="5" stroke-linecap="round" ${dashed ? 'stroke-dasharray="7 6"' : ""}/>
      <path d="M0 -84 L-11 -60 L11 -60 Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      ${handle ? '<circle class="handle" cx="0" cy="-72" r="16" fill="transparent"/>' : ""}
    </g>`;
  return `<svg width="190" height="190" viewBox="-95 -95 190 190" style="overflow:visible">
    <circle r="62" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1" stroke-dasharray="2 4"/>
    ${opt === null ? "" : arrow(opt, "#eb6834", true, false)}
    ${arrow(you, "#3987e5", false, true)}
  </svg>`;
}

/**
 * Satellite map with the site pin and two direction arrows.
 * Calls onUnavailable() if imagery cannot load (e.g. a sandbox blocks it).
 */
export function createSiteMap(
  el: HTMLElement,
  lat: number,
  lon: number,
  cb: { onMove(lat: number, lon: number): void; onRotate(az: number): void; onUnavailable(): void },
): SiteMap {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([lat, lon], 18);
  const imagery = L.tileLayer(IMAGERY, {
    maxZoom: 19,
    maxNativeZoom: 19,
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community",
  }).addTo(map);
  L.tileLayer(LABELS, { maxZoom: 19, opacity: 0.8 }).addTo(map);

  let loaded = 0, failed = 0, reported = false;
  imagery.on("tileload", () => loaded++);
  imagery.on("tileerror", () => {
    failed++;
    if (!reported && loaded === 0 && failed >= 4) {
      reported = true;
      cb.onUnavailable();
    }
  });

  const pin = L.marker([lat, lon], {
    draggable: true,
    icon: L.divIcon({ className: "", html: '<div class="pin"></div>', iconSize: [22, 22], iconAnchor: [11, 26] }),
    zIndexOffset: 1000,
    keyboard: true,
    title: "Site — drag to move",
  }).addTo(map);
  pin.on("dragend", () => {
    const p = pin.getLatLng();
    arrows.setLatLng(p);
    cb.onMove(p.lat, p.lng);
  });
  pin.on("drag", () => arrows.setLatLng(pin.getLatLng()));

  let you = 180, opt: number | null = null;
  const arrows = L.marker([lat, lon], {
    interactive: false,
    keyboard: false,
    icon: L.divIcon({ className: "arrows-overlay", html: arrowsSvg(you, opt), iconSize: [190, 190], iconAnchor: [95, 95] }),
  }).addTo(map);

  // Drag the blue arrow head to rotate "yours".
  let rotating = false;
  const centre = () => {
    const pt = map.latLngToContainerPoint(arrows.getLatLng());
    const r = el.getBoundingClientRect();
    return [r.left + pt.x, r.top + pt.y];
  };
  el.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).classList?.contains("handle")) {
      rotating = true;
      map.dragging.disable();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!rotating) return;
    const [cx, cy] = centre();
    cb.onRotate(Math.round(pointerAzimuth(cx, cy, e.clientX, e.clientY)));
  });
  window.addEventListener("pointerup", () => {
    if (rotating) {
      rotating = false;
      map.dragging.enable();
    }
  });

  return {
    setSite(la, lo, recenter = true) {
      pin.setLatLng([la, lo]);
      arrows.setLatLng([la, lo]);
      if (recenter) map.setView([la, lo], Math.max(map.getZoom(), 17));
    },
    setArrows(y, o) {
      you = y;
      opt = o;
      const svgHost = (arrows.getElement() as HTMLElement | undefined);
      if (svgHost) svgHost.innerHTML = arrowsSvg(you, opt);
    },
  };
}

/** Altitude lookup (Open-Meteo, Copernicus 90 m DEM). */
export async function lookupAltitude(lat: number, lon: number, signal?: AbortSignal): Promise<number> {
  const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal });
  if (!r.ok) throw new Error(`elevation service ${r.status}`);
  const j = await r.json();
  const e = j?.elevation?.[0];
  if (typeof e !== "number") throw new Error("no elevation");
  return Math.round(e);
}

/** Address search (OpenStreetMap Nominatim). */
export async function geocode(q: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`search service ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j) || j.length === 0) return null;
  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon), name: j[0].display_name };
}
