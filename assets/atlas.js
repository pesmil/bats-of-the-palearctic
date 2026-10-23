/* Bats of the Palearctic – Karten und Filter (MapLibre GL).
   Jeder Nachweis wird als Kreis mit seinem gemeldeten Genauigkeitsradius gezeichnet:
   beim Hineinzoomen wächst der Kreis auf seine echte Grösse in Metern; damit kleine
   Kreise in der Übersicht nicht verschwinden, haben sie eine Mindestgrösse am Bildschirm. */

const FAMILY_COLORS = {
  Vespertilionidae: "#2f6f95", Rhinolophidae: "#c47a12", Hipposideridae: "#7a4fa0",
  Pteropodidae: "#2e8b57", Molossidae: "#b03a6b", Miniopteridae: "#1f9e9a",
  Rhinopomatidae: "#8c6d3f", Emballonuridae: "#5b6e1e", Nycteridae: "#cf4f2b",
  Megadermatidae: "#4b5bb8", Rhinonycteridae: "#9a8a2e", Unassigned: "#7d8a8c",
};
const EXTRA_COLORS = ["#6d597a", "#3c8d5a", "#a35d2a", "#45738f"];
const PERIODS = [
  { label: "Before 2000", color: "#7b6fa6" },
  { label: "2000–2019", color: "#2d8c86" },
  { label: "2020 onwards", color: "#d99a1e" },
  { label: "Last 12 months", color: "#d99a1e", ring: true },
  { label: "Year unknown", color: "#8a9496" },
];
const MIN_PX = 3.5;                       // Mindestradius am Bildschirm
const M_PER_PX_Z0 = 78271.517;            // Meter pro Pixel bei Zoom 0 am Äquator (512-px-Kacheln)

function familyColor(name, i) {
  return FAMILY_COLORS[name] || EXTRA_COLORS[i % EXTRA_COLORS.length];
}

/* Radius: echte Meter, aber nie kleiner als MIN_PX. «zoom» darf in MapLibre nur
   ganz aussen in interpolate stehen, daher eine Stützstelle pro Zoomstufe. */
function radiusExpression() {
  const expr = ["interpolate", ["exponential", 2], ["zoom"]];
  for (let z = 0; z <= 22; z++) expr.push(z, ["max", MIN_PX, ["*", ["get", "r0"], Math.pow(2, z)]]);
  return expr;
}

/* Ordner der Webseite (für das Nachladen der Kacheln), aus der Adresse dieses Skripts */
const ATLAS_BASE = (() => {
  const src = document.currentScript && document.currentScript.src;
  return src ? src.replace(/assets\/atlas\.js(\?.*)?$/, "") : "";
})();
const GRID_COLORS = ["#a9cce6", "#86b9de", "#6baed6", "#3182bd", "#1f5f9e", "#0b3a6f"];
const GRID_STEPS = [1, 3, 10, 30, 100, 300];

function recToFeature(r, i, data) {
  const [lon, lat, acc, t, , year, s, q, , , p] = r;
  const tax = data.taxa[t];
  const genus = data.genera[tax.g];
  const r0 = acc > 0 ? acc / (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) : 0;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { i, r0, acc, t, g: tax.g, f: genus.f, y: year, s, q, p, u: acc > 0 ? 0 : 1 },
  };
}

function toFeatures(data) {
  return { type: "FeatureCollection", features: data.recs.map((r, i) => recToFeature(r, i, data)) };
}

/* Detailkacheln (data/tiles/<x>_<y>.js) werden als Skript nachgeladen – das klappt auch
   ohne Webserver (Doppelklick auf index.html). Jede Datei ruft atlasTile(id, recs) auf. */
const TILE_WAITING = {};
/* Gezeichnetes Gebiet: gilt im ganzen Browser-Tab (Karte und Artenliste) */
const AREA_KEY = "bpal-area";
const AREA_EXACT_TILES = 12;   // Gebiet berührt höchstens so viele Detailkacheln: genau zählen, sonst über Quadrate
/* Das Gebiet reist in der Adresse mit (#area=…): so klappt es auch, wenn die Seiten direkt vom Computer
   geöffnet werden (file://), wo der Browser jeder Seite einen eigenen Speicher gibt. Zusätzlich im Tab-Speicher. */
function areaAusAdresse() {
  const m = location.hash.match(/(?:^#|&)area=([^&]*)/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
}
function areaLesen() {
  const ausAdresse = areaAusAdresse();
  if (ausAdresse) return ausAdresse;
  try { return JSON.parse(sessionStorage.getItem(AREA_KEY) || "null"); } catch (e) { return null; }
}
function areaHash(wert) {
  if (!wert) return "";
  const kurz = Object.assign({}, wert, { area: wert.area.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) });
  return "#area=" + encodeURIComponent(JSON.stringify(kurz));
}
// Links zwischen Karte und Artenliste (Menü, Knöpfe) mit dem Gebiet versehen bzw. ohne
function areaLinks(wert) {
  for (const a of document.querySelectorAll('a[href*="species/index.html"], a[href$="index.html"], a[data-area-link]')) {
    const ziel = a.getAttribute("href").split("#")[0];
    if (!/(^|\/)(species\/)?index\.html$/.test(ziel)) continue;
    a.setAttribute("href", ziel + areaHash(wert));
  }
}
function inPolygon(lon, lat, ring) {   // Strahlenverfahren
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/* Nachweise im Gebiet als flache Liste [taxon, quelle, qualität, jahr, anzahl] – für Karte und Artenliste.
   Berührt das Gebiet höchstens AREA_EXACT_TILES Detailkacheln, wird jeder Nachweis geprüft (genau),
   sonst zählen die 0,5°-Quadrate, deren Mitte im Gebiet liegt. «grids»: schon geladene Raster je Taxon. */
function areaKacheln(meta, area) {   // Detailkacheln (mit Nachweisen), die das Gebiet berührt
  const size = meta.tile, avail = new Set(meta.tiles || []);
  const lons = area.map((p) => p[0]), lats = area.map((p) => p[1]);
  const x0 = Math.floor((Math.max(Math.min(...lons), -180) + 180) / size), x1 = Math.floor((Math.min(Math.max(...lons), 179.999) + 180) / size);
  const y0 = Math.floor((Math.max(Math.min(...lats), -90) + 90) / size), y1 = Math.floor((Math.min(Math.max(...lats), 89.999) + 90) / size);
  const ids = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (avail.has(`${x}_${y}`)) ids.push(`${x}_${y}`);
  return ids;
}
function areaGrenzen(area) {
  const lons = area.map((p) => p[0]), lats = area.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}
// Umriss des Gebiets (gestrichelt) auf einer Karte zeichnen
function addAreaOutline(map, area) {
  const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#1f3a68";
  map.addSource("area-outline", { type: "geojson", data: { type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [area] } } });
  map.addLayer({ id: "area-fill", type: "fill", source: "area-outline", paint: { "fill-color": brand, "fill-opacity": 0.05 } }, "recs");
  map.addLayer({ id: "area-line", type: "line", source: "area-outline",
                 paint: { "line-color": brand, "line-width": 2, "line-dasharray": [2, 1] } });
}
async function areaEntries(meta, area, status = () => {}, grids = {}) {
  const ids = areaKacheln(meta, area);
  const E = [];
  const exact = ids.length <= AREA_EXACT_TILES;
  if (exact) {
    status("Loading records …");
    const results = await Promise.all(ids.map(loadTile));
    status(null);
    for (const recs of results) for (const r of recs) if (inPolygon(r[0], r[1], area)) E.push(r[3], r[6], r[7], r[5], 1);
  } else {
    const alle = meta.taxa.map((_, t) => t);
    const missing = alle.filter((t) => !grids[t]);
    if (missing.length) {
      status("Loading …");
      const loaded = await Promise.all(missing.map(loadTaxonGrid));
      missing.forEach((t, i) => (grids[t] = loaded[i]));
      status(null);
    }
    const drin = new Map();
    for (const t of alle) {
      const D = grids[t];   // [cx, cy, quelle, qualität, jahr, anzahl]
      for (let k = 0; k < D.length; k += 6) {
        const key = D[k] * 100000 + D[k + 1];
        if (!drin.has(key)) drin.set(key, inPolygon((D[k] + 0.5) * meta.cell - 180, (D[k + 1] + 0.5) * meta.cell - 90, area));
        if (drin.get(key)) E.push(t, D[k + 2], D[k + 3], D[k + 4], D[k + 5]);
      }
    }
  }
  return { exact, E };
}
function areaSchreiben(wert) {
  areaLinks(wert);
  if (!wert && areaAusAdresse()) history.replaceState(null, "", location.pathname + location.search);
  if (wert && areaAusAdresse()) history.replaceState(null, "", location.pathname + location.search + areaHash(wert));
  try {
    if (wert) sessionStorage.setItem(AREA_KEY, JSON.stringify(wert));
    else sessionStorage.removeItem(AREA_KEY);
  } catch (e) { /* Speicher gesperrt (privates Fenster): Gebiet gilt dann nur auf der Karte */ }
}
window.atlasTile = function (id, recs) { if (TILE_WAITING[id]) TILE_WAITING[id](recs); };
function loadTile(id) {
  return new Promise((resolve) => {
    const el = document.createElement("script");
    TILE_WAITING[id] = (recs) => { delete TILE_WAITING[id]; resolve(recs); };
    el.onerror = () => { delete TILE_WAITING[id]; resolve([]); };
    el.onload = () => el.remove();
    el.src = `${ATLAS_BASE}data/tiles/${id}.js?v=${window.ATLAS_V || ""}`;
    document.head.appendChild(el);
  });
}

const GRID_WAITING = {};
window.atlasGrid = function (t, cells) { if (GRID_WAITING[t]) GRID_WAITING[t](cells); };
function loadTaxonGrid(t) {
  return new Promise((resolve) => {
    const el = document.createElement("script");
    GRID_WAITING[t] = (cells) => { delete GRID_WAITING[t]; resolve(cells); };
    el.onerror = () => { delete GRID_WAITING[t]; resolve([]); };
    el.onload = () => el.remove();
    el.src = `${ATLAS_BASE}data/grid/${t}.js?v=${window.ATLAS_V || ""}`;
    document.head.appendChild(el);
  });
}

/* Hält die geladenen Nachweise; lädt beim Hineinzoomen die sichtbaren Kacheln nach. */
function tileStore(map, data, onlyTaxon = -1) {
  const store = { recs: [], fc: { type: "FeatureCollection", features: [] }, loaded: new Set(), busy: false };
  const available = new Set(data.tiles || []);
  const status = document.createElement("div");
  status.className = "map-status";
  status.hidden = true;
  map.getContainer().appendChild(status);

  async function update() {
    if (store.busy || map.getZoom() < data.detailZoom - 0.5) return;
    const b = map.getBounds(), size = data.tile;
    const x0 = Math.floor((Math.max(b.getWest(), -180) + 180) / size), x1 = Math.floor((Math.min(b.getEast(), 179.999) + 180) / size);
    const y0 = Math.floor((Math.max(b.getSouth(), -90) + 90) / size), y1 = Math.floor((Math.min(b.getNorth(), 89.999) + 90) / size);
    const todo = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const id = `${x}_${y}`;
      if (available.has(id) && !store.loaded.has(id)) todo.push(id);
    }
    if (!todo.length) return;
    store.busy = true;
    status.textContent = "Loading records …";
    status.hidden = false;
    const results = await Promise.all(todo.slice(0, 40).map(loadTile));
    todo.slice(0, 40).forEach((id) => store.loaded.add(id));
    for (const recs of results) for (const r of recs) {
      if (onlyTaxon >= 0 && r[3] !== onlyTaxon) continue;
      store.fc.features.push(recToFeature(r, store.recs.length, data));
      store.recs.push(r);
    }
    map.getSource("recs").setData(store.fc);
    status.hidden = true;
    store.busy = false;
    update();   // inzwischen weiter verschoben?
  }
  map.on("moveend", update);
  store.update = update;
  return store;
}

/* Übersicht: Quadrate mit der Anzahl Nachweise, Farbe nach Anzahl */
function gridToPoints(cells, size) {
  const features = [];
  for (const [key, n] of cells) {
    const cx = Math.floor(key / 100000), cy = key % 100000;
    features.push({ type: "Feature", properties: { n },
      geometry: { type: "Point", coordinates: [(cx + 0.5) * size - 180, (cy + 0.5) * size - 90] } });
  }
  return { type: "FeatureCollection", features };
}

function gridToFeatures(cells, size) {
  const features = [];
  for (const [key, n] of cells) {
    const cx = Math.floor(key / 100000), cy = key % 100000;
    const w = cx * size - 180, s = cy * size - 90;
    features.push({ type: "Feature", properties: { n },
      geometry: { type: "Polygon", coordinates: [[[w, s], [w + size, s], [w + size, s + size], [w, s + size], [w, s]]] } });
  }
  return { type: "FeatureCollection", features };
}

function addGridLayer(map, data) {
  map.addSource("grid", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const color = ["step", ["get", "n"], GRID_COLORS[0]];
  GRID_STEPS.slice(1).forEach((v, i) => color.push(v, GRID_COLORS[i + 1]));
  map.addLayer({ id: "grid", type: "fill", source: "grid", maxzoom: data.detailZoom,
    paint: { "fill-color": color, "fill-opacity": 0.78, "fill-outline-color": "rgba(255,255,255,0.6)" } }, "recs");
  // Weit herausgezoomt sind die Quadrate nur wenige Pixel gross: Punkte darüber, damit auch Einzelnachweise sichtbar bleiben
  map.addSource("grid-pts", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "grid-dots", type: "circle", source: "grid-pts", maxzoom: 4,
    paint: { "circle-color": color, "circle-radius": 2.6, "circle-stroke-width": 0.6, "circle-stroke-color": "#0b3a6f",
             "circle-stroke-opacity": 0.5, "circle-opacity": 0.9 } }, "recs");
  map.on("click", "grid-dots", (e) => { if (!window._atlasDrawing) map.flyTo({ center: e.lngLat, zoom: Math.max(map.getZoom() + 2, 5) }); });
  map.on("mouseenter", "grid-dots", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "grid-dots", () => (map.getCanvas().style.cursor = ""));
  map.on("click", "grid", (e) => {
    if (window._atlasDrawing) return;
    const n = e.features[0].properties.n;
    new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(e.lngLat)
      .setHTML(`<div class="pop-rec"><strong>${n.toLocaleString("en")}</strong> record${n === 1 ? "" : "s"} in this square` +
               `<div class="meta"><a href="#" class="zoom-in">Zoom in to see them</a></div></div>`).addTo(map)
      .getElement().querySelector(".zoom-in").addEventListener("click", (ev) => {
        ev.preventDefault();
        map.flyTo({ center: e.lngLat, zoom: data.detailZoom + 0.3 });
      });
  });
  map.on("mouseenter", "grid", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "grid", () => (map.getCanvas().style.cursor = ""));
  const legend = document.getElementById("grid-legend");
  if (legend) {
    legend.hidden = false;
    legend.querySelector(".ramp").innerHTML = GRID_COLORS.map((c, i) =>
      `<span style="background:${c}" title="${GRID_STEPS[i]}+"></span>`).join("");
    legend.querySelector(".ramp-labels").innerHTML =
      `<span>${GRID_STEPS[0]}</span><span>${GRID_STEPS[GRID_STEPS.length - 1]}+</span>`;
    // Grösse der Quadrate in Kilometern (Mitteleuropa, ~47° N), damit man sich etwas darunter vorstellen kann
    const ns = Math.round(data.cell * 111 / 5) * 5, ew = Math.round(data.cell * 111 * Math.cos(47 * Math.PI / 180) / 5) * 5;
    legend.querySelector(".cell-size").textContent =
      `When zoomed out, records are counted in squares of about ${ns} × ${ew} km (in central Europe). Zoom in to see each record.`;
  }
}

function setGrid(map, data, cells) {
  if (!map.getSource("grid")) return;
  map.getSource("grid").setData(gridToFeatures(cells, data.cell));
  map.getSource("grid-pts").setData(gridToPoints(cells, data.cell));
}

function recordUrl(link) {
  if (!link) return "";
  if (/^i\d+$/.test(link)) return `https://www.inaturalist.org/observations/${link.slice(1)}`;
  if (/^g\d+$/.test(link)) return `https://www.gbif.org/occurrence/${link.slice(1)}`;
  return link;
}

function makeMap(container, opts = {}) {
  const map = createMap(container, opts);
  map.on("error", (ev) => console.error("Map:", ev.error && ev.error.message));
  // Quellenhinweis der Hintergrundkarte zugeklappt starten (Klick auf «i» öffnet ihn)
  map.once("load", () => {
    const a = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
  });
  window._atlasMap = map;   // zur Fehlersuche in der Browserkonsole
  return map;
}

function createMap(container, opts) {
  const esri = (layer) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
  return new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        base: { type: "raster", tiles: [esri("World_Light_Gray_Base")], tileSize: 256, maxzoom: 16,
                attribution: "Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors" },
        labels: { type: "raster", tiles: [esri("World_Light_Gray_Reference")], tileSize: 256, maxzoom: 16 },
      },
      layers: [
        { id: "base", type: "raster", source: "base" },
        { id: "labels", type: "raster", source: "labels" },
      ],
    },
    center: opts.center || [62, 46],
    zoom: opts.zoom ?? 2.2,
    maxZoom: 17,
    attributionControl: { compact: true },
    cooperativeGestures: false,
  });
}

function addRecordLayer(map, features, colorExpr, ringRecent = false, minzoom = 0) {
  const recent = ringRecent ? ["==", ["get", "p"], 3] : false;
  map.addSource("recs", { type: "geojson", data: features });
  map.addLayer({
    id: "recs", type: "circle", source: "recs", minzoom,
    layout: { "circle-sort-key": ["-", 0, ["get", "acc"]] },   // grosse Kreise zuunterst
    paint: {
      "circle-radius": radiusExpression(),
      "circle-color": colorExpr,
      "circle-opacity": ["case", ["==", ["get", "u"], 1], 0.85, 0.22],
      "circle-stroke-color": ["case", recent, "#1d2b2f", colorExpr],
      "circle-stroke-width": ["case", recent, 2.2, 1.3],
      "circle-stroke-opacity": 0.9,
      "circle-pitch-alignment": "map",
    },
  }, "labels");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function formatAccuracy(acc) {
  if (!(acc > 0)) return "accuracy not reported";
  return acc >= 1000 ? `±${(acc / 1000).toLocaleString("en", { maximumFractionDigits: 1 })} km` : `±${Math.round(acc)} m`;
}

function bindPopups(map, data, linkBase, store) {
  const recs = () => (store ? store.recs : data.recs);
  map.on("click", "recs", (e) => {
    if (window._atlasDrawing) return;
    const seen = new Set();
    const rows = [];
    for (const f of e.features) {
      const i = f.properties.i;
      if (seen.has(i)) continue;
      seen.add(i);
      rows.push(recs()[i]);
    }
    const shown = rows.slice(0, 8).map((r) => {
      const [, , acc, t, date, year, s, q, link, c, , nRaw, ds] = r;
      const url = recordUrl(link);
      const tax = data.taxa[t];
      const name = tax.s ? `<a class="sci" href="${linkBase}${tax.s}.html">${esc(tax.n)}</a>` : `<span class="sci">${esc(tax.n)}</span>`;
      const grade = data.grades[q] ? ` (${esc(data.grades[q])})` : "";
      const cite = c >= 0 ? `<div class="meta">${esc(data.cites[c])}</div>` : "";
      const open = url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">Open record</a>` : "";
      const merged = nRaw > 1 ? `<div class="meta">${nRaw.toLocaleString("en")} records at this place${year ? ` in ${year}` : ""} (shown as one)</div>` : "";
      const sets = ds && ds.length && data.datasets ? `<div class="meta">${esc(ds.map((d) => data.datasets[d]).join("; "))}</div>` : "";
      return `<div class="pop-rec">${name}<div class="meta">${esc(date || "date unknown")} · ${esc(data.sources[s])}${grade}</div>` +
             `${merged}${sets}${cite}<div class="meta">${formatAccuracy(acc)}${open}</div></div>`;
    });
    const more = rows.length > 8 ? `<div class="meta" style="margin-top:8px">and ${rows.length - 8} more here – zoom in to separate them</div>` : "";
    new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(shown.join("") + more).addTo(map);
  });
  map.on("mouseenter", "recs", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "recs", () => (map.getCanvas().style.cursor = ""));
}

function fitToRecords(map, recs) {
  if (!recs.length) return;
  let w = 180, s = 90, e = -180, n = -90;
  for (const r of recs) { w = Math.min(w, r[0]); e = Math.max(e, r[0]); s = Math.min(s, r[1]); n = Math.max(n, r[1]); }
  if (w === e && s === n) { map.jumpTo({ center: [w, s], zoom: 8 }); return; }
  map.fitBounds([[w, s], [e, n]], { padding: 50, maxZoom: 9, animate: false });
}

/* Paläarktis als dezente Fläche mit Umrisslinie unter den Nachweisen (Kern dunkler, Übergangszone heller) */
function addRealmLayer(map) {
  const realm = window.REALM;
  if (!realm) return;
  const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#1f3a68";
  map.addSource("realm", { type: "geojson", data: realm.geojson });
  const unter = ["range", "grid", "grid-dots", "recs"].find((l) => map.getLayer(l));   // Paläarktis zuunterst
  map.addLayer({ id: "realm-fill", type: "fill", source: "realm",
    paint: { "fill-color": brand, "fill-opacity": ["case", ["==", ["get", "zone"], "uebergang"], 0.035, 0.07] } }, unter);
  map.addLayer({ id: "realm-line", type: "line", source: "realm", filter: ["==", ["get", "zone"], "kern"],
    paint: { "line-color": brand, "line-width": 1, "line-opacity": 0.55 } }, unter);
  const box = document.getElementById("realm-box");
  const toggle = document.getElementById("realm-toggle");
  const label = document.getElementById("realm-label");
  if (!box) return;
  label.textContent = realm.label;
  box.hidden = false;
  toggle.addEventListener("change", () => {
    const v = toggle.checked ? "visible" : "none";
    map.setLayoutProperty("realm-fill", "visibility", v);
    map.setLayoutProperty("realm-line", "visibility", v);
  });
}

/* ---------------- Startseite ----------------
   Weit herausgezoomt: Quadrate mit der Anzahl Nachweise (aus data.grid, alle Filter wirken).
   Ab data.detailZoom: einzelne Kreise, die Kacheln dazu werden erst dann geladen. */
function initHome(data) {
  const $ = (id) => document.getElementById(id);
  const famSel = $("f-family"), genSel = $("f-genus"), taxSel = $("f-taxon");
  const yFrom = $("f-from"), yTo = $("f-to");
  const C = data.counts, CS = 5;   // [taxon, quelle, qualität, jahr, anzahl]
  let yMin = Infinity, yMax = -Infinity;
  for (let k = 0; k < C.length; k += CS) if (C[k + 3] > 0) { yMin = Math.min(yMin, C[k + 3]); yMax = Math.max(yMax, C[k + 3]); }
  if (!isFinite(yMin)) { yMin = 1900; yMax = new Date().getFullYear(); }
  yFrom.placeholder = yMin; yTo.placeholder = yMax;

  const state = { f: -1, g: -1, t: -1, from: null, to: null, area: null, s: new Set(data.sources.map((_, i) => i)),
                  q: new Set(data.grades.map((_, i) => i)) };

  // Anzahl Nachweise pro Familie / Gattung / Taxon für die Auswahllisten
  const nTax = new Array(data.taxa.length).fill(0);
  for (let k = 0; k < C.length; k += CS) nTax[C[k]] += C[k + 4];
  const nGen = new Array(data.genera.length).fill(0);
  data.taxa.forEach((t, i) => (nGen[t.g] += nTax[i]));
  const nFam = new Array(data.families.length).fill(0);
  data.genera.forEach((g, i) => (nFam[g.f] += nGen[i]));

  function fill(sel, allLabel, items) {
    sel.innerHTML = `<option value="-1">${allLabel}</option>` +
      items.map(([v, label, n]) => `<option value="${v}">${esc(label)} (${n.toLocaleString("en")})</option>`).join("");
  }
  function refreshLists() {
    fill(famSel, "All families", data.families.map((f, i) => [i, f, nFam[i]]).filter((x) => x[2] > 0));
    famSel.value = state.f;
    fill(genSel, "All genera", data.genera.map((g, i) => [i, g.n, nGen[i]])
      .filter((x) => x[2] > 0 && (state.f < 0 || data.genera[x[0]].f === state.f)));
    genSel.value = state.g;
    fill(taxSel, "All species", data.taxa.map((t, i) => [i, t.s || t.n.includes(" ") ? t.n : `${t.n} sp. (identified to genus only)`, nTax[i]])
      .filter((x) => x[2] > 0 && (state.g < 0 || data.taxa[x[0]].g === state.g) &&
                     (state.f < 0 || data.genera[data.taxa[x[0]].g].f === state.f)));
    taxSel.value = state.t;
  }

  // Gesamtzahl pro Quelle / Qualitätsstufe: Einträge ohne Nachweise gar nicht erst anzeigen
  const total = { "f-sources": new Array(data.sources.length).fill(0), "f-grades": new Array(data.grades.length).fill(0) };
  for (let k = 0; k < C.length; k += CS) { total["f-sources"][C[k + 1]] += C[k + 4]; total["f-grades"][C[k + 2]] += C[k + 4]; }
  function checks(containerId, labels, set) {
    const box = $(containerId);
    // «Not graded» = alle Nicht-iNat-Daten: kein eigenes Kästchen (bleibt immer eingeschlossen)
    const versteckt = (i) => containerId === "f-grades" && /^Not graded/.test(labels[i]);
    box.innerHTML = labels.map((l, i) => total[containerId][i] && !versteckt(i) ?
      `<label><input type="checkbox" value="${i}"${set.has(i) ? " checked" : ""}>${esc(l)}<span class="n" data-n="${i}"></span></label>` : "").join("");
    box.onchange = (e) => {
      const i = +e.target.value;
      e.target.checked ? set.add(i) : set.delete(i);
      apply();
    };
  }
  checks("f-sources", data.sources, state.s);
  checks("f-grades", data.grades, state.q);

  // Legende: Familien in der Kartenfarbe (gilt für die einzelnen Kreise)
  $("legend").innerHTML = data.families.map((f, i) => nFam[i] ? `<label><span class="swatch" style="background:${familyColor(f, i)}33;border-color:${familyColor(f, i)}"></span>${esc(f)}<span class="n">${nFam[i].toLocaleString("en")}</span></label>` : "").join("");

  function taxonOk(t) {
    if (state.t >= 0 && t !== state.t) return false;
    const tax = data.taxa[t];
    if (state.g >= 0 && tax.g !== state.g) return false;
    if (state.f >= 0 && data.genera[tax.g].f !== state.f) return false;
    return true;
  }
  function yearOk(y) {
    if ((state.from || state.to) && !y) return false;
    if (state.from && y < state.from) return false;
    if (state.to && y > state.to) return false;
    return true;
  }
  function filterExpr() {
    const all = ["all", ["in", ["get", "s"], ["literal", [...state.s]]], ["in", ["get", "q"], ["literal", [...state.q]]]];
    if (state.t >= 0) all.push(["==", ["get", "t"], state.t]);
    if (state.g >= 0) all.push(["==", ["get", "g"], state.g]);
    if (state.f >= 0) all.push(["==", ["get", "f"], state.f]);
    if (state.from || state.to) all.push([">", ["get", "y"], 0]);
    if (state.from) all.push([">=", ["get", "y"], state.from]);
    if (state.to) all.push(["<=", ["get", "y"], state.to]);
    if (state.area) all.push(["within", { type: "Polygon", coordinates: [state.area] }]);
    return all;
  }

  /* Gezeichnetes Gebiet: Punkt-im-Polygon (Strahlenverfahren); Quadrate zählen, wenn ihre Mitte darin liegt */
  const areaCache = new Map();
  function cellInArea(cx, cy) {
    if (!state.area) return true;
    const key = cx * 100000 + cy;
    if (!areaCache.has(key)) areaCache.set(key, inPolygon((cx + 0.5) * data.cell - 180, (cy + 0.5) * data.cell - 90, state.area));
    return areaCache.get(key);
  }

  const map = makeMap("map");
  const colorExpr = ["match", ["get", "f"]];
  data.families.forEach((f, i) => colorExpr.push(i, familyColor(f, i)));
  colorExpr.push("#7d8a8c");
  let ready = false, store = null;
  map.on("load", () => {
    addRecordLayer(map, { type: "FeatureCollection", features: [] }, colorExpr, false, data.detailZoom);
    addGridLayer(map, data);
    addRealmLayer(map);
    store = tileStore(map, data);
    bindPopups(map, data, "species/", store);
    ready = true;
    apply();
    store.update();
  });

  // Quadrate: ohne Quelle/Qualität/Jahr-Filter aus data.grid, sonst aus den Rastern je Taxon (werden nachgeladen)
  const taxonGrids = {};
  function restricted() {
    return state.s.size < data.sources.length || state.q.size < data.grades.length || state.from || state.to || state.area;
  }
  async function cellsFor() {
    const cells = new Map();
    const add = (cx, cy, n) => { const key = cx * 100000 + cy; cells.set(key, (cells.get(key) || 0) + n); };
    if (!restricted()) {
      const G = data.grid;
      for (let k = 0; k < G.length; k += 4) if (taxonOk(G[k + 2])) add(G[k], G[k + 1], G[k + 3]);
      return cells;
    }
    const wanted = data.taxa.map((_, t) => t).filter((t) => taxonOk(t) && nTax[t] > 0);
    const missing = wanted.filter((t) => !taxonGrids[t]);
    if (missing.length) {
      mapStatus("Loading …");
      const loaded = await Promise.all(missing.map(loadTaxonGrid));
      missing.forEach((t, i) => (taxonGrids[t] = loaded[i]));
      mapStatus(null);
    }
    for (const t of wanted) {
      const D = taxonGrids[t];   // [cx, cy, quelle, qualität, jahr, anzahl]
      for (let k = 0; k < D.length; k += 6) {
        if (state.s.has(D[k + 2]) && state.q.has(D[k + 3]) && yearOk(D[k + 4]) && cellInArea(D[k], D[k + 1])) add(D[k], D[k + 1], D[k + 5]);
      }
    }
    return cells;
  }
  let areaRes = null;
  async function entriesInArea() {
    const area = state.area;
    if (areaRes && areaRes.area === area) return areaRes;
    const res = Object.assign(await areaEntries(data, area, mapStatus, taxonGrids), { area });
    if (state.area === area) areaRes = res;
    return res;
  }
  // Für die Artenliste: Gebiet und Filter merken – sie zählt selbst (so muss die Karte nicht fertig geladen sein)
  function areaMerken() {
    if (!state.area) return;
    areaSchreiben({ area: state.area, version: data.version, from: state.from, to: state.to,
                    s: [...state.s], q: [...state.q] });
  }

  let statusEl = null;
  function mapStatus(text) {
    if (!statusEl) { statusEl = document.createElement("div"); statusEl.className = "map-status"; $("map").appendChild(statusEl); }
    statusEl.hidden = !text;
    if (text) statusEl.textContent = text;
  }

  let applyRun = 0;
  async function apply() {
    const run = ++applyRun;
    areaMerken();
    let n = 0;
    const taxa = new Set();
    const perSource = new Array(data.sources.length).fill(0), perGrade = new Array(data.grades.length).fill(0);
    const zaehlen = (t, s, q, c) => {
      // Zähler bei Quelle/Qualität: wie viele es mit den übrigen Filtern gäbe
      if (state.q.has(q)) perSource[s] += c;
      if (state.s.has(s)) perGrade[q] += c;
      if (!state.s.has(s) || !state.q.has(q)) return;
      n += c; taxa.add(t);
    };
    if (!state.area) {
      for (let k = 0; k < C.length; k += CS) {
        const t = C[k], y = C[k + 3];
        if (taxonOk(t) && yearOk(y)) zaehlen(t, C[k + 1], C[k + 2], C[k + 4]);
      }
    } else {
      // mit Gebiet: genau aus den Detailkacheln oder (grosses Gebiet) aus den Quadraten
      const res = await entriesInArea();
      if (run !== applyRun) return;
      const E = res.E;
      const artenImGebiet = new Set();   // für den Link zur Artenliste (ohne Taxon-Filter, wie dort)
      for (let k = 0; k < E.length; k += 5) {
        if (taxonOk(E[k]) && yearOk(E[k + 3])) zaehlen(E[k], E[k + 1], E[k + 2], E[k + 4]);
        if (data.taxa[E[k]].s && !data.taxa[E[k]].k && yearOk(E[k + 3]) && state.s.has(E[k + 1]) && state.q.has(E[k + 2])) artenImGebiet.add(E[k]);
      }
      $("area-note").textContent = res.exact
        ? "Only records inside your area are shown and counted."
        : "Only records inside your area are shown. The area is large, so records are counted by squares: the numbers near " +
          "the edge are approximate; zoom in to see exactly which records lie inside.";
      const link = $("area-species");
      if (link) {
        const n = artenImGebiet.size;
        link.textContent = `Show the ${n} species in this area →`;
        link.hidden = n === 0;
      }
    }
    const species = [...taxa].filter((t) => data.taxa[t].s && !data.taxa[t].k).length;
    $("summary").innerHTML = `Showing <strong>${n.toLocaleString("en")}</strong> record${n === 1 ? "" : "s"} of <strong>${species}</strong> species`;
    document.querySelectorAll("#f-sources .n").forEach((el) => (el.textContent = perSource[+el.dataset.n].toLocaleString("en")));
    document.querySelectorAll("#f-grades .n").forEach((el) => (el.textContent = perGrade[+el.dataset.n].toLocaleString("en")));
    $("area-note").hidden = !state.area;
    if (!state.area && $("area-species")) $("area-species").hidden = true;
    if (!ready) return;
    map.setFilter("recs", filterExpr());
    const cells = await cellsFor();
    if (run === applyRun) setGrid(map, data, cells);   // nur das Ergebnis der letzten Änderung zeigen
  }

  famSel.addEventListener("change", () => { state.f = +famSel.value; state.g = -1; state.t = -1; refreshLists(); apply(); });
  genSel.addEventListener("change", () => {
    state.g = +genSel.value; state.t = -1;
    if (state.g >= 0) state.f = data.genera[state.g].f;
    refreshLists(); apply();
  });
  taxSel.addEventListener("change", () => {
    state.t = +taxSel.value;
    if (state.t >= 0) { state.g = data.taxa[state.t].g; state.f = data.genera[state.g].f; }
    refreshLists(); apply();
  });
  for (const [el, key] of [[yFrom, "from"], [yTo, "to"]]) {
    el.addEventListener("change", () => { state[key] = el.value ? +el.value : null; apply(); });
  }
  /* ---- Gebiet zeichnen: Punkte anklicken, ersten Punkt (oder Doppelklick) zum Abschliessen ---- */
  let drawPts = [];
  function drawRender(closed) {
    if (!map.getSource("draw")) return;
    const ring = closed ? [...drawPts, drawPts[0]] : drawPts;
    const features = [];
    if (closed && drawPts.length >= 3) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
    else if (drawPts.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: {} });
    if (!closed) drawPts.forEach((p) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    map.getSource("draw").setData({ type: "FeatureCollection", features });
  }
  function drawStart() {
    window._atlasDrawing = true; drawPts = []; drawRender(false);
    map.doubleClickZoom.disable(); map.getCanvas().style.cursor = "crosshair";
    $("area-hint").hidden = false; $("draw-area").textContent = "Cancel drawing";
  }
  function drawStop() {
    setTimeout(() => (window._atlasDrawing = false), 0);   // erst nach diesem Klick: sonst öffnet sich ein Pop-up
    map.doubleClickZoom.enable(); map.getCanvas().style.cursor = "";
    $("area-hint").hidden = true; $("draw-area").textContent = "Draw area on map";
  }
  function drawFinish() {
    drawPts = drawPts.filter((p, i) => i === 0 || Math.abs(p[0] - drawPts[i - 1][0]) + Math.abs(p[1] - drawPts[i - 1][1]) > 1e-9);
    if (drawPts.length < 3) return;
    drawStop(); drawRender(true);
    state.area = [...drawPts, drawPts[0]]; areaCache.clear();
    $("clear-area").hidden = false;
    apply();
  }
  function clearArea() {
    drawStop(); drawPts = []; drawRender(false);
    state.area = null; areaCache.clear(); $("clear-area").hidden = true;
    areaSchreiben(null);
    apply();
  }
  map.on("load", () => {
    map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#1f3a68";
    map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", ["geometry-type"], "Polygon"],
                   paint: { "fill-color": brand, "fill-opacity": 0.06 } });
    map.addLayer({ id: "draw-line", type: "line", source: "draw", filter: ["!=", ["geometry-type"], "Point"],
                   paint: { "line-color": brand, "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "draw-pts", type: "circle", source: "draw", filter: ["==", ["geometry-type"], "Point"],
                   paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": brand, "circle-stroke-width": 2 } });
  });
  map.on("click", (e) => {
    if (!window._atlasDrawing) return;
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (drawPts.length >= 3) {
      const a = map.project(drawPts[0]), b = e.point;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 12) { drawFinish(); return; }   // ersten Punkt getroffen
    }
    drawPts.push(p); drawRender(false);
  });
  map.on("dblclick", (e) => { if (window._atlasDrawing) { e.preventDefault(); drawFinish(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && window._atlasDrawing) { drawStop(); drawPts = []; drawRender(false); } });
  const gemerkt = areaLesen();
  if (gemerkt && Array.isArray(gemerkt.area) && gemerkt.area.length >= 4) {
    drawPts = gemerkt.area.slice(0, -1);
    state.area = gemerkt.area;
    if (gemerkt.version === data.version) {   // Filter nur aus derselben Version der Webseite übernehmen
      state.from = gemerkt.from || null; state.to = gemerkt.to || null;
      if (state.from) yFrom.value = state.from;
      if (state.to) yTo.value = state.to;
      if (Array.isArray(gemerkt.s)) state.s = new Set(gemerkt.s);
      if (Array.isArray(gemerkt.q)) state.q = new Set(gemerkt.q);
      checks("f-sources", data.sources, state.s); checks("f-grades", data.grades, state.q);
    }
    $("clear-area").hidden = false;
    map.on("load", () => drawRender(true));   // nach dem Anlegen der Zeichenebene (oben)
  }
  $("draw-area").addEventListener("click", () => (window._atlasDrawing ? (drawStop(), (drawPts = []), drawRender(false)) : drawStart()));
  $("clear-area").addEventListener("click", clearArea);

  $("reset").addEventListener("click", () => {
    if (state.area || window._atlasDrawing) { drawStop(); drawPts = []; drawRender(false); $("clear-area").hidden = true; }
    Object.assign(state, { f: -1, g: -1, t: -1, from: null, to: null, area: null });
    areaCache.clear(); areaSchreiben(null);
    yFrom.value = ""; yTo.value = "";
    state.s = new Set(data.sources.map((_, i) => i)); state.q = new Set(data.grades.map((_, i) => i));
    checks("f-sources", data.sources, state.s); checks("f-grades", data.grades, state.q);
    refreshLists(); apply();
  });
  const side = document.querySelector(".side");
  $("toggle-filters").addEventListener("click", (e) => {
    const open = side.classList.toggle("open");
    e.target.setAttribute("aria-expanded", open);
    e.target.textContent = open ? "Hide filters" : "Filters";
  });

  refreshLists();
  apply();
}

/* ---------------- Artseite ----------------
   Bis einige Tausend Nachweise: alle direkt als Kreise (data.recs).
   Darüber wie die Startseite: Raster in der Übersicht, Kreise ab data.detailZoom. */
function initSpecies(data) {
  // Auf schmalen Bildschirmen startet die Legende zugeklappt, damit die Karte frei bleibt
  const legendBox = document.getElementById("map-legend");
  if (legendBox && window.matchMedia("(max-width: 760px)").matches) legendBox.open = false;
  const direct = Array.isArray(data.recs);
  const shown = new Set(PERIODS.map((_, i) => i));
  const box = document.getElementById("periods");

  // Gebiet aus der Artenliste (#area=… in der Adresse): nur Nachweise darin zeigen
  const gemerkt = areaAusAdresse();
  const area = gemerkt && Array.isArray(gemerkt.area) && gemerkt.area.length >= 4 ? gemerkt.area : null;
  let areaOn = !!area, areaRecs = null;   // areaRecs: alle Nachweise dieser Art im Gebiet (genau), sonst null
  if (area) areaLinks(gemerkt);           // Menü «Map»/«Species» behalten das Gebiet
  const zelleImGebiet = new Map();
  function cellIn(cx, cy) {
    const key = cx * 100000 + cy;
    if (!zelleImGebiet.has(key)) zelleImGebiet.set(key, inPolygon((cx + 0.5) * data.cell - 180, (cy + 0.5) * data.cell - 90, area));
    return zelleImGebiet.get(key);
  }

  function periodCounts() {
    const counts = new Array(PERIODS.length).fill(0);
    if (areaOn && areaRecs) for (const r of areaRecs) counts[r[10]]++;
    else if (direct) for (const r of data.recs) counts[r[10]]++;
    else for (let k = 0; k < data.grid.length; k += 4) {
      if (!areaOn || cellIn(data.grid[k], data.grid[k + 1])) counts[data.grid[k + 2]] += data.grid[k + 3];
    }
    return counts;
  }
  function renderPeriods() {
    const counts = periodCounts();
    box.innerHTML = PERIODS.map((p, i) => counts[i] ? `<label><input type="checkbox" value="${i}"${shown.has(i) ? " checked" : ""}>` +
      `<span class="swatch" style="background:${p.color}${p.ring ? "" : "33"};border-color:${p.ring ? "#1d2b2f" : p.color}"></span>` +
      `${p.label}<span class="n">${counts[i].toLocaleString("en")}</span></label>` : "").join("") ||
      (areaOn ? `<p class="legend-source">No records of this species in your area.</p>` : "");
    return counts;
  }

  function gridCells() {
    const cells = new Map();
    const add = (cx, cy, n) => { const key = cx * 100000 + cy; cells.set(key, (cells.get(key) || 0) + n); };
    if (areaOn && areaRecs) {   // genau: Quadrate aus den Nachweisen im Gebiet
      for (const r of areaRecs) if (shown.has(r[10])) add(Math.floor((r[0] + 180) / data.cell), Math.floor((r[1] + 90) / data.cell), 1);
      return cells;
    }
    for (let k = 0; k < data.grid.length; k += 4) {
      if (!shown.has(data.grid[k + 2]) || (areaOn && !cellIn(data.grid[k], data.grid[k + 1]))) continue;
      add(data.grid[k], data.grid[k + 1], data.grid[k + 3]);
    }
    return cells;
  }
  function recFilter() {
    const f = ["all", ["in", ["get", "p"], ["literal", [...shown]]]];
    if (areaOn) f.push(["within", { type: "Polygon", coordinates: [area] }]);
    return f;
  }

  // Kasten oben in der Legende: Anzahl im Gebiet, Umschalter, Links zurück
  let areaBox = null;
  function renderAreaBox(counts) {
    if (!area) return;
    if (!areaBox) {
      areaBox = document.createElement("div");
      areaBox.className = "checks area-box";
      box.before(areaBox);
    }
    const n = counts.reduce((a, b) => a + b, 0);
    const ungefaehr = !direct && !areaRecs ? " (approx.)" : "";
    areaBox.innerHTML = `<label><input type="checkbox" id="area-only"${areaOn ? " checked" : ""}>` +
      `<span class="swatch area" style="border-style:dashed;border-color:var(--brand)"></span>Only records in your area` +
      (areaOn ? `<span class="n">${n.toLocaleString("en")}${ungefaehr}</span>` : "") + `</label>` +
      `<p class="legend-source"><a href="index.html${areaHash(gemerkt)}">Species in this area</a> · ` +
      `<a href="../index.html${areaHash(gemerkt)}">Change the area on the map</a></p><hr class="legend-sep">`;
    areaBox.querySelector("#area-only").addEventListener("change", (e) => {
      areaOn = e.target.checked;
      const c = renderPeriods();
      renderAreaBox(c);
      aktualisieren();
    });
  }

  const map = makeMap("map");
  const colorExpr = ["match", ["get", "p"]];
  PERIODS.forEach((p, i) => colorExpr.push(i, p.color));
  colorExpr.push("#8a9496");
  let store = null, ready = false;
  function aktualisieren() {
    if (!ready) return;
    map.setFilter("recs", recFilter());
    if (!direct) setGrid(map, data, gridCells());
    if (map.getLayer("area-line")) {
      map.setLayoutProperty("area-line", "visibility", areaOn ? "visible" : "none");
      map.setLayoutProperty("area-fill", "visibility", areaOn ? "visible" : "none");
    }
  }

  async function gebietVorbereiten() {
    if (!area) return;
    if (direct) areaRecs = data.recs.filter((r) => inPolygon(r[0], r[1], area));
    else {
      const ids = areaKacheln(data, area);
      if (ids.length <= AREA_EXACT_TILES) {
        const results = await Promise.all(ids.map(loadTile));
        areaRecs = [];
        for (const recs of results) for (const r of recs) if (r[3] === data.t && inPolygon(r[0], r[1], area)) areaRecs.push(r);
      }
    }
  }

  renderAreaBox(renderPeriods());
  const vorbereitet = gebietVorbereiten().then(() => { renderAreaBox(renderPeriods()); aktualisieren(); });

  map.on("load", () => {
    if (direct) {
      addRecordLayer(map, toFeatures(data), colorExpr, true);
    } else {
      addRecordLayer(map, { type: "FeatureCollection", features: [] }, colorExpr, true, data.detailZoom);
      addGridLayer(map, data);
      store = tileStore(map, data, data.t);
    }
    addRealmLayer(map);
    if (data.inat_id) addRangeLayer(map, data.inat_id);
    if (area) addAreaOutline(map, area);
    bindPopups(map, data, "", store);
    ready = true;
    aktualisieren();
    if (area) map.fitBounds(areaGrenzen(area), { padding: 50, maxZoom: 10, animate: false });
    else if (direct) fitToRecords(map, data.recs);
    else map.fitBounds([[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]], { padding: 50, maxZoom: 9, animate: false });
    if (store) store.update();
    vorbereitet.then(aktualisieren);
  });
  box.addEventListener("change", (e) => {
    const i = +e.target.value;
    e.target.checked ? shown.add(i) : shown.delete(i);
    aktualisieren();
  });
}

/* Verbreitung von iNaturalist (Community-Karten, meist nach IUCN): pink wie auf iNaturalist, halbtransparent,
   Kacheln direkt von iNaturalist geladen – nur angedeutet, unter den Nachweisen. */
function addRangeLayer(map, taxonId) {
  const url = `https://api.inaturalist.org/v1/taxon_ranges/${taxonId}/{z}/{x}/{y}.png?color=%23ff5eb0`;
  map.addSource("range", { type: "raster", tiles: [url], tileSize: 256, maxzoom: 10,
                           attribution: 'Range: <a href="https://www.inaturalist.org">iNaturalist</a>' });
  map.addLayer({ id: "range", type: "raster", source: "range", paint: { "raster-opacity": 0.45 } },
               map.getLayer("grid") ? "grid" : "recs");
  const legend = document.getElementById("range-legend");
  const toggle = document.getElementById("range-toggle");
  if (!legend) return;
  toggle.addEventListener("change", () => map.setLayoutProperty("range", "visibility", toggle.checked ? "visible" : "none"));
  // Legende nur zeigen, wenn es für die Art überhaupt eine Verbreitungskarte gibt
  const probe = new Image();
  probe.crossOrigin = "anonymous";
  probe.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d");
      ctx.drawImage(probe, 0, 0, 64, 64);
      const px = ctx.getImageData(0, 0, 64, 64).data;
      let filled = false;
      for (let k = 3; k < px.length; k += 4) if (px[k] > 0) { filled = true; break; }
      legend.hidden = !filled;
    } catch (err) { legend.hidden = false; }   // Bild nicht auslesbar: Legende sicherheitshalber zeigen
  };
  probe.onerror = () => { legend.hidden = true; };
  probe.src = url.replace("{z}/{x}/{y}", "0/0/0");
}

/* ---------------- Artenliste ----------------
   Ist auf der Karte ein Gebiet gezeichnet, zeigt die Liste nur die Arten darin – mit Anzahl und letztem Jahr im
   Gebiet. Gezählt wird hier (aus den Kacheln bzw. Rastern), die Karte gibt nur Gebiet und Filter weiter. */
function initSpeciesIndex(meta) {
  // Ältere (zwischengespeicherte) Fassung der Seite ruft ohne Daten auf: gemeinsame Angaben selbst nachladen
  if (!meta && !window.ATLAS_META && areaLesen()) {
    const el = document.createElement("script");
    el.src = `${ATLAS_BASE}data/meta.js?v=${window.ATLAS_V || Date.now()}`;
    el.onload = () => initSpeciesIndex(window.ATLAS_META || null);
    el.onerror = () => initSpeciesIndex(null);
    document.head.appendChild(el);
    return;
  }
  meta = meta || window.ATLAS_META || null;
  const $ = (id) => document.getElementById(id);
  if (!$("area-banner") && $("species-search")) {   // ältere Seite ohne Platz für den Hinweis
    const div = document.createElement("div");
    div.id = "area-banner"; div.className = "area-banner"; div.hidden = true;
    $("species-search").before(div);
  }
  const input = $("species-search");
  const rows = [...document.querySelectorAll("tr[data-q]")];
  const sections = [...document.querySelectorAll("section[data-family]")];
  const empty = $("no-match"), banner = $("area-banner");
  const gemerkt = meta ? areaLesen() : null;
  const area = gemerkt && Array.isArray(gemerkt.area) && gemerkt.area.length >= 4 ? gemerkt : null;
  if (area) areaSchreiben(area);   // Menü-Link «Map» führt mit dem Gebiet zurück
  let counts = null, exact = true, filtered = false, areaOn = !!area;
  for (const r of rows) { r._n = r.querySelector("td.rec").textContent; r._l = r.querySelector("td.latest").textContent; }
  const countSpans = [...document.querySelectorAll("tr.genus-row .count, section[data-family] > h2 .count")];
  for (const c of countSpans) c._t = c.textContent;

  const aktiv = () => areaOn && counts;
  function inArea(r) {
    const c = counts && counts[r.dataset.n];
    return !!(c && c[0] > 0);
  }
  const species = (n) => `${n} species`;
  function update() {
    const q = input.value.trim().toLowerCase();
    for (const r of rows) {
      const c = aktiv() ? counts[r.dataset.n] : null;
      r.hidden = !!(q && !r.dataset.q.includes(q)) || (aktiv() && !inArea(r));
      for (const a of r.querySelectorAll("a[href]")) {   // Artseite öffnet dann mit demselben Gebiet
        const ziel = a.getAttribute("href").split("#")[0];
        a.setAttribute("href", ziel + (aktiv() && inArea(r) ? areaHash(area) : ""));
      }
      r.querySelector("td.rec").textContent = c ? c[0].toLocaleString("en") : r._n;
      r.querySelector("td.latest").textContent = c ? (c[1] || "–") : r._l;
    }
    // Gattungszeile nur zeigen, wenn mindestens eine ihrer Arten sichtbar ist
    for (const g of document.querySelectorAll("tr.genus-row")) {
      const eigene = [...g.parentElement.querySelectorAll("tr[data-q]")].filter((r) => r.dataset.genus === g.dataset.genus);
      g.hidden = !eigene.some((r) => !r.hidden);
      const c = g.querySelector(".count");
      c.textContent = aktiv() ? species(eigene.filter((r) => inArea(r) && !r.dataset.k).length) : c._t;
    }
    let any = false;
    for (const s of sections) {
      const visible = s.querySelectorAll("tr[data-q]:not([hidden])").length;
      s.hidden = visible === 0;
      any ||= visible > 0;
      const c = s.querySelector(":scope > h2 .count");
      if (c) c.textContent = aktiv() ? species([...s.querySelectorAll("tr[data-q]")].filter((r) => inArea(r) && !r.dataset.k).length) : c._t;
    }
    empty.hidden = any;
    empty.textContent = aktiv() && !q ? "No species recorded in the area you drew on the map."
                                      : "No species match your search. Try a genus name or part of a common name.";
    zeigeBanner();
  }
  function zeigeBanner() {
    if (!area || !banner) return;
    banner.hidden = false;
    if (!counts) {
      banner.innerHTML = "<p>Counting the records in the area you drew on the map …</p>";
      return;
    }
    if (areaOn) {
      const drin = rows.filter(inArea);
      const n = drin.reduce((a, r) => a + counts[r.dataset.n][0], 0);
      banner.innerHTML = `<p>Showing the <strong>${drin.filter((r) => !r.dataset.k).length}</strong> species recorded in the area you drew on the map ` +
        `(<strong>${n.toLocaleString("en")}</strong> record${n === 1 ? "" : "s"}${filtered ? ", with your year, source and quality filters" : ""}). ` +
        `Records and latest year refer to this area.${exact ? "" : " The area is large, so records near its edge are counted approximately."}</p>` +
        `<p><button type="button" id="area-toggle" class="link-btn">Show all species</button> · <a href="../index.html${areaHash(area)}">Change the area on the map</a></p>`;
    } else {
      banner.innerHTML = `<p>An area is drawn on the map. <button type="button" id="area-toggle" class="link-btn">Show only species in that area</button></p>`;
    }
    $("area-toggle").addEventListener("click", () => { areaOn = !areaOn; update(); });
  }
  async function zaehlen() {
    const res = await areaEntries(meta, area.area);
    const gleich = area.version === meta.version;   // Filterwerte (Indizes) passen nur zur selben Version
    const sOk = new Set(gleich && Array.isArray(area.s) ? area.s : meta.sources.map((_, i) => i));
    const qOk = new Set(gleich && Array.isArray(area.q) ? area.q : meta.grades.map((_, i) => i));
    const von = gleich ? area.from : null, bis = gleich ? area.to : null;
    filtered = sOk.size < meta.sources.length || qOk.size < meta.grades.length || !!von || !!bis;
    const c = {}, E = res.E;
    for (let k = 0; k < E.length; k += 5) {
      const y = E[k + 3];
      if (!sOk.has(E[k + 1]) || !qOk.has(E[k + 2])) continue;
      if ((von || bis) && !y) continue;
      if ((von && y < von) || (bis && y > bis)) continue;
      const name = meta.taxa[E[k]].n, z = c[name] || (c[name] = [0, 0]);
      z[0] += E[k + 4];
      z[1] = Math.max(z[1], y || 0);
    }
    counts = c; exact = res.exact;
    update();
  }
  input.addEventListener("input", update);
  update();
  if (area) zaehlen();
}
