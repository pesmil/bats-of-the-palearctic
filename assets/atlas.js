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

/* Genauigkeit der Ortsangabe: Klassen wie in webseite.py (GENAU_GRENZEN).
   0 = keine Angabe, 1 = bis 100 m, 2 = bis 500 m, 3 = bis 1 km, 4 = bis 5 km, 5 = bis 15 km, 6 = bis 25 km, 7 = ungenauer */
const GENAU_GRENZEN = [100, 500, 1000, 5000, 15000, 25000];
// Stufen des Schiebers (links «Any», nach rechts immer genauer): k = genaueste noch zugelassene Klasse
const GENAU_STUFEN = [{ t: "Any", k: 7 }, { t: "25 km", k: 6 }, { t: "15 km", k: 5 }, { t: "5 km", k: 4 },
                      { t: "1 km", k: 3 }, { t: "500 m", k: 2 }, { t: "100 m", k: 1 }];
function genauKlasse(acc) {
  if (!(acc > 0)) return 0;
  for (let i = 0; i < GENAU_GRENZEN.length; i++) if (acc <= GENAU_GRENZEN[i]) return i + 1;
  return 7;
}
// Filter {stufe, ohne} -> Prüffunktion für eine Klasse, oder null, wenn alles durchgeht
function genauPruefer(g) {
  if (!g || (!g.stufe && g.ohne)) return null;
  const max = GENAU_STUFEN[g.stufe].k;
  return (a) => (a === 0 ? g.ohne : a <= max);
}
function genauSchluessel(g) { return g ? `${g.stufe}|${g.ohne ? 1 : 0}` : ""; }
// für die Kartenfilter (MapLibre): zugelassene Klassen
function genauKlassen(g) {
  const ok = genauPruefer(g);
  return [0, 1, 2, 3, 4, 5, 6, 7].filter((a) => !ok || ok(a));
}
/* Zahlen nach Genauigkeit (data/genau/…), nur geladen, wenn nach Genauigkeit gefiltert wird.
   Jede Datei ruft atlasGenau(name, daten) auf. Fehlt sie (ältere Webseite), kommt null zurück. */
const GENAU_WAITING = {}, GENAU_CACHE = {};
window.atlasGenau = function (name, d) { if (GENAU_WAITING[name]) GENAU_WAITING[name](d); };
function loadGenau(name) {
  if (GENAU_CACHE[name]) return GENAU_CACHE[name];
  return (GENAU_CACHE[name] = new Promise((resolve) => {
    const el = document.createElement("script");
    GENAU_WAITING[name] = (d) => { delete GENAU_WAITING[name]; resolve(d); };
    el.onerror = () => { delete GENAU_WAITING[name]; resolve(null); };
    el.onload = () => el.remove();
    el.src = `${ATLAS_BASE}data/genau/${name}.js?v=${window.ATLAS_V || ""}`;
    document.head.appendChild(el);
  }));
}
/* Schieber «Location accuracy» mit Kästchen «Include records without accuracy».
   g wird direkt geändert; onChange nach dem Loslassen bzw. beim Umschalten. */
function genauRegler(host, g, onChange) {
  const el = document.createElement("div");
  el.className = "acc-filter";
  const id = "acc-" + Math.random().toString(36).slice(2, 7);
  el.innerHTML = `<div class="acc-wert" id="${id}-wert" aria-live="polite"></div>` +
    `<input type="range" class="acc-range" min="0" max="${GENAU_STUFEN.length - 1}" step="1" value="${g.stufe}" ` +
    `aria-label="Location accuracy" aria-describedby="${id}-wert">` +
    `<div class="acc-ticks" aria-hidden="true">${GENAU_STUFEN.map((s) => `<span>${s.t}</span>`).join("")}</div>` +
    `<label class="acc-ohne"><input type="checkbox"${g.ohne ? " checked" : ""}>Include records without accuracy</label>`;
  host.appendChild(el);
  const range = el.querySelector(".acc-range"), box = el.querySelector(".acc-ohne input");
  function zeigen() {
    const st = +range.value;
    el.querySelector(".acc-wert").textContent = st ? `Accurate to ${GENAU_STUFEN[st].t} or better` : "Any accuracy";
    range.setAttribute("aria-valuetext", GENAU_STUFEN[st].t);
    range.style.setProperty("--acc-p", (st / (GENAU_STUFEN.length - 1)) * 100 + "%");
    el.querySelectorAll(".acc-ticks span").forEach((sp, i) => sp.classList.toggle("on", i === st));
  }
  range.addEventListener("input", zeigen);
  range.addEventListener("change", () => { g.stufe = +range.value; onChange(); });
  box.addEventListener("change", () => { g.ohne = box.checked; onChange(); });
  zeigen();
  return { setzen(neu) { range.value = neu.stufe; box.checked = neu.ohne; zeigen(); } };
}

function recToFeature(r, i, data) {
  const [lon, lat, acc, t, , year, s, q, , , p] = r;
  const tax = data.taxa[t];
  const genus = data.genera[tax.g];
  const r0 = acc > 0 ? acc / (M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) : 0;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { i, r0, acc, t, g: tax.g, f: genus.f, y: year, s, q, p, u: acc > 0 ? 0 : 1, l: r[13] ?? -1, a: genauKlasse(acc) },
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
  const kurz = Object.assign({}, wert);
  if (Array.isArray(wert.area)) kurz.area = wert.area.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
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
/* Gebiet = gezeichnetes Polygon ({area: [[lon, lat], …]}) oder Land ({land: "CH"}) */
function gebietGueltig(g) {
  return !!g && ((Array.isArray(g.area) && g.area.length >= 4) || (typeof g.land === "string" && g.land !== ""));
}
function gebietName(meta, g) {
  if (g && g.land) {
    const c = (meta.countries || []).find((x) => x.c === g.land);
    return c ? c.n : g.land;
  }
  return "the area you drew on the map";
}
function landIndex(meta, iso) { return (meta.countries || []).findIndex((x) => x.c === iso); }
/* Länderdaten (data/laender/<Code>.js): Umriss «o», Ausdehnung «b», Zahlen «E», Quadrate «Z», Zeiträume «P» */
const LAND_WAITING = {}, LAND_CACHE = {};
window.atlasLand = function (c, d) { if (LAND_WAITING[c]) LAND_WAITING[c](d); };
function loadLand(meta, iso) {
  if (LAND_CACHE[iso]) return Promise.resolve(LAND_CACHE[iso]);
  const info = (meta.countries || []).find((x) => x.c === iso);
  if (!info) return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement("script");
    LAND_WAITING[iso] = (d) => { delete LAND_WAITING[iso]; LAND_CACHE[iso] = d; resolve(d); };
    el.onerror = () => { delete LAND_WAITING[iso]; resolve(null); };
    el.onload = () => el.remove();
    el.src = `${ATLAS_BASE}data/laender/${info.f}.js?v=${window.ATLAS_V || ""}`;
    document.head.appendChild(el);
  });
}
// Nachweise im Gebiet [taxon, quelle, qualität, jahr, anzahl]: Land genau aus den Länderdaten, Polygon wie unten
// genau: Prüffunktion für die Genauigkeitsklasse (genauPruefer) oder null
async function gebietEntries(meta, g, status = () => {}, grids = {}, genau = null) {
  if (g.land) {
    status("Loading …");
    if (genau) {
      const info = (meta.countries || []).find((x) => x.c === g.land);
      const d = info ? await loadGenau("laender/" + info.f) : null;
      status(null);
      const E = [], A = d ? d.E : [];   // [taxon, quelle, qualität, jahr, klasse, n]
      for (let k = 0; k < A.length; k += 6) if (genau(A[k + 4])) E.push(A[k], A[k + 1], A[k + 2], A[k + 3], A[k + 5]);
      return { exact: true, E };
    }
    const d = await loadLand(meta, g.land);
    status(null);
    return { exact: true, E: d ? d.E : [] };
  }
  return areaEntries(meta, g.area, status, grids, genau);
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
  const lons = area.map((p) => p[0]), lats = area.map((p) => p[1]);
  return kachelnIn(meta, Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats));
}
function kachelnIn(meta, w, s, e, n) {   // Detailkacheln (mit Nachweisen) in einem Rechteck
  const size = meta.tile, avail = new Set(meta.tiles || []);
  const x0 = Math.floor((Math.max(w, -180) + 180) / size), x1 = Math.floor((Math.min(e, 179.999) + 180) / size);
  const y0 = Math.floor((Math.max(s, -90) + 90) / size), y1 = Math.floor((Math.min(n, 89.999) + 90) / size);
  const ids = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (avail.has(`${x}_${y}`)) ids.push(`${x}_${y}`);
  return ids;
}
function areaGrenzen(area) {
  const lons = area.map((p) => p[0]), lats = area.map((p) => p[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}
// Umriss des Gebiets (gestrichelt) auf einer Karte zeichnen
function addAreaOutline(map, geometry) {
  const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#1f3a68";
  map.addSource("area-outline", { type: "geojson", data: { type: "Feature", properties: {}, geometry } });
  map.addLayer({ id: "area-fill", type: "fill", source: "area-outline", paint: { "fill-color": brand, "fill-opacity": 0.05 } }, "recs");
  map.addLayer({ id: "area-line", type: "line", source: "area-outline",
                 paint: { "line-color": brand, "line-width": 2, "line-dasharray": [2, 1] } });
}
async function areaEntries(meta, area, status = () => {}, grids = {}, genau = null) {
  const ids = areaKacheln(meta, area);
  const E = [];
  const exact = ids.length <= AREA_EXACT_TILES;
  if (exact) {
    status("Loading records …");
    const results = await Promise.all(ids.map(loadTile));
    status(null);
    for (const recs of results) for (const r of recs) {
      if ((!genau || genau(genauKlasse(r[2]))) && inPolygon(r[0], r[1], area)) E.push(r[3], r[6], r[7], r[5], 1);
    }
  } else if (genau) {   // Raster je Taxon mit Genauigkeit [cx, cy, quelle, qualität, jahr, klasse, anzahl]
    status("Loading …");
    const alle = await Promise.all(meta.taxa.map((_, t) => loadGenau("grid/" + t)));
    status(null);
    const drin = new Map();
    alle.forEach((D, t) => {
      if (!D) return;
      for (let k = 0; k < D.length; k += 7) {
        if (!genau(D[k + 5])) continue;
        const key = D[k] * 100000 + D[k + 1];
        if (!drin.has(key)) drin.set(key, inPolygon((D[k] + 0.5) * meta.cell - 180, (D[k + 1] + 0.5) * meta.cell - 90, area));
        if (drin.get(key)) E.push(t, D[k + 2], D[k + 3], D[k + 4], D[k + 6]);
      }
    });
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
/* Jede Kachel nur einmal laden: Karte, Zählung und Tabelle können dieselbe Kachel gleichzeitig verlangen */
const TILE_CACHE = {};
function loadTile(id) {
  if (TILE_CACHE[id]) return TILE_CACHE[id];
  return (TILE_CACHE[id] = new Promise((resolve) => {
    const el = document.createElement("script");
    TILE_WAITING[id] = (recs) => { delete TILE_WAITING[id]; resolve(recs); };
    el.onerror = () => { delete TILE_WAITING[id]; delete TILE_CACHE[id]; resolve([]); };
    el.onload = () => el.remove();
    el.src = `${ATLAS_BASE}data/tiles/${id}.js?v=${window.ATLAS_V || ""}`;
    document.head.appendChild(el);
  }));
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
  if (realm.biome) addBiomeToggle(map, realm.biome, box);
}

/* ---------------- Biome (RESOLVE Ecoregions 2017) ----------------
   Häkchen unter «Map layers», standardmässig aus. Die Flächen (data/biome.js, ≈ 3 MB) werden erst
   beim ersten Einschalten geladen und halbtransparent unter die Paläarktis und die Nachweise gelegt.
   Klick auf eine Fläche (ohne Nachweis an der Stelle) zeigt Ökoregion und Biom. */
let BIOME_WAITING = null;
window.atlasBiome = function (fc) { if (BIOME_WAITING) BIOME_WAITING(fc); };
function loadBiome() {
  return new Promise((resolve) => {
    const el = document.createElement("script");
    BIOME_WAITING = (fc) => { BIOME_WAITING = null; resolve(fc); };
    el.onerror = () => { BIOME_WAITING = null; resolve(null); };
    el.onload = () => el.remove();
    el.src = `${ATLAS_BASE}data/biome.js?v=${window.ATLAS_V || ""}`;
    document.head.appendChild(el);
  });
}

function addBiomeToggle(map, info, box) {
  const names = {}, color = ["match", ["get", "b"]];
  for (const [b, name, c] of info.legend) { names[b] = name; color.push(b, c); }
  color.push("#cccccc");
  const label = document.createElement("label");
  label.innerHTML = '<input type="checkbox" id="biome-toggle"><span class="swatch area biome-swatch"></span>' +
                    `<span>${esc(info.label)}</span>`;
  const legend = document.createElement("div");
  legend.className = "biome-legend";
  legend.hidden = true;
  legend.innerHTML = info.legend.map(([, name, c]) =>
    `<div class="biome-row"><span class="swatch area" style="background:${c};border-color:${c}"></span>${esc(name)}</div>`).join("") +
    '<p class="legend-source">Ecoregions from <a href="https://ecoregions.appspot.com" target="_blank" rel="noopener">RESOLVE 2017</a> ' +
    '(Dinerstein et al. 2017, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>). ' +
    'Click the map to see the ecoregion.</p>';
  box.append(label, legend);
  const toggle = label.querySelector("input");
  let state = "none";   // none → loading → ready
  const show = (v) => {
    for (const id of ["biome-fill", "biome-line"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
    legend.hidden = !v;
  };
  toggle.addEventListener("change", async () => {
    if (state === "ready") { show(toggle.checked); return; }
    if (state === "loading" || !toggle.checked) return;
    state = "loading";
    label.classList.add("loading");
    const fc = await loadBiome();
    label.classList.remove("loading");
    if (!fc) { state = "none"; toggle.checked = false; return; }
    map.addSource("biome", { type: "geojson", data: fc, tolerance: 0.5,
      attribution: 'Biomes: <a href="https://ecoregions.appspot.com" target="_blank" rel="noopener">RESOLVE Ecoregions 2017</a>, CC BY 4.0' });
    // unter Paläarktis, Raster und Nachweisen, aber über der Hintergrundkarte
    const unter = ["realm-fill", "range", "grid", "grid-dots", "area-fill", "land-fill", "recs"].find((l) => map.getLayer(l)) || "labels";
    map.addLayer({ id: "biome-fill", type: "fill", source: "biome",
      paint: { "fill-color": color, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 0.35] } }, unter);
    map.addLayer({ id: "biome-line", type: "line", source: "biome",
      paint: { "line-color": "#5b6b66", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 8, 0.9], "line-opacity": 0.45 } }, unter);
    map.on("click", "biome-fill", (e) => {
      if (window._atlasDrawing) return;
      const andere = ["recs", "grid", "grid-dots", "draw-pts"].filter((l) => map.getLayer(l));
      if (andere.length && map.queryRenderedFeatures(e.point, { layers: andere }).length) return;
      const f = e.features[0].properties;
      new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(e.lngLat)
        .setHTML(`<div class="pop-rec"><strong>${esc(f.n)}</strong><div class="meta">${esc(names[f.b] || "")}</div></div>`).addTo(map);
    });
    state = "ready";
    show(toggle.checked);
  });
}

/* ---------------- Seitenteil einklappen ----------------
   Knopf am linken Kartenrand: blendet das Seitenteil aus, damit nur die Karte zu sehen ist.
   Jede Seite startet mit aufgeklapptem Seitenteil (nichts wird gemerkt). Auf schmalen Bildschirmen
   (Seitenteil unter der Karte) gibt es den Knopf nicht. */
// Kleine Strich-Symbole (16 × 16) für alle Knöpfe auf der Karte: gleiche Grösse und Strichstärke
function symbol(pfad, px = 14) {
  return `<svg viewBox="0 0 16 16" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${pfad}"/></svg>`;
}
function seitenteilKnopf(map) {
  const main = document.querySelector("main.atlas");
  const box = main && main.querySelector(":scope > .map");
  if (!box) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "side-toggle";
  btn.setAttribute("aria-controls", "seitenteil");
  const side = main.querySelector(":scope > .side");
  if (side && !side.id) side.id = "seitenteil";
  box.appendChild(btn);
  function setzen(zu) {
    main.classList.toggle("side-collapsed", zu);
    btn.setAttribute("aria-expanded", String(!zu));
    btn.title = zu ? "Show the side panel" : "Hide the side panel (map only)";
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML = symbol(zu ? "M6 3l5 5-5 5" : "M10 3L5 8l5 5");
    map.resize();
  }
  // Handy: Startseite beginnt mit der Karte, die Filter liegen eingeklappt in einer Schublade (Knopf am linken Rand)
  setzen(main.classList.contains("home") && HANDY.matches);
  btn.addEventListener("click", () => setzen(!main.classList.contains("side-collapsed")));
  return setzen;
}
const HANDY = window.matchMedia("(max-width: 760px)");

/* ---------------- Nachweise eines Gebiets als Tabelle ----------------
   Lädt die Detailkacheln, die das Gebiet berührt, und behält die Nachweise darin, die «passt» erfüllen.
   Sehr grosse Gebiete (viele Kacheln) werden nicht geladen: dann eine kleinere Fläche zeichnen.
   «vorhanden»: alle Nachweise liegen schon vor (kleine Artseiten), dann nichts nachladen. */
const TABELLE_MAX_KACHELN = 60;    // 2°-Kacheln, also etwa 1000 × 1000 km
const TABELLE_MAX_ZEILEN = 2000;   // so viele Zeilen auf der Seite; die CSV-Datei enthält alle
async function gebietNachweise(meta, g, passt, status = () => {}, vorhanden = null) {
  let drin, ids = [];
  if (g.land) {
    const li = landIndex(meta, g.land);
    drin = (r) => r[13] === li;
    if (!vorhanden) {
      status("Loading …");
      const d = await loadLand(meta, g.land);
      status(null);
      if (!d || !d.b) return { recs: [] };
      ids = kachelnIn(meta, d.b[0], d.b[1], d.b[2], d.b[3]);
    }
  } else {
    drin = (r) => inPolygon(r[0], r[1], g.area);
    if (!vorhanden) ids = areaKacheln(meta, g.area);
  }
  let quellen = [vorhanden || []];
  if (!vorhanden) {
    if (ids.length > TABELLE_MAX_KACHELN) return { zuGross: true };
    status("Loading records …");
    quellen = await Promise.all(ids.map(loadTile));
    status(null);
  }
  const recs = [];
  for (const q of quellen) for (const r of q) if (passt(r) && drin(r)) recs.push(r);
  return { recs };
}

function nachweisTabelle(map, meta) {
  const host = map.getContainer().parentElement;
  const SPALTEN = [
    { k: "sp", t: "Species" }, { k: "date", t: "Date" }, { k: "src", t: "Source" }, { k: "grade", t: "Quality grade" },
    { k: "lat", t: "Latitude", num: true }, { k: "lon", t: "Longitude", num: true }, { k: "acc", t: "Accuracy", num: true },
    { k: "ds", t: "Dataset / reference" }, { k: "url", t: "Record" },
  ];
  let el = null, zeilen = [], sortKey = "date", sortAb = true, holen = null, titel = "", lauf = 0;

  function zeile(r) {
    const [lon, lat, acc, t, date, year, s, q, link, c, , nRaw, ds] = r;
    const grade = meta.grades[q] || "";
    const sets = ds && ds.length && meta.datasets ? ds.map((d) => meta.datasets[d]) : [];
    if (c >= 0 && meta.cites) sets.push(meta.cites[c]);
    return { r, sp: meta.taxa[t].n, date: date || (year ? String(year) : ""), src: meta.sources[s] || "",
             grade: /^Not graded/.test(grade) ? "" : grade, lat, lon, acc: acc > 0 ? acc : null,
             n: nRaw > 1 ? nRaw : 1, ds: sets.join("; "), url: recordUrl(link) };
  }
  function sortieren() {
    const k = sortKey, f = sortAb ? -1 : 1;
    zeilen.sort((a, b) => {
      const x = a[k], y = b[k];
      if (x === y) return 0;
      if (x === null || x === "") return 1;    // leere Werte immer ans Ende
      if (y === null || y === "") return -1;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * f;
    });
  }
  function anlegen() {
    el = document.createElement("section");
    el.className = "rec-panel";
    el.setAttribute("aria-label", "Records as table");
    el.innerHTML = `<div class="rec-head"><h2 class="rec-title"></h2><span class="rec-info"></span>` +
      `<span class="rec-actions"><button type="button" class="rec-btn rec-csv">Download CSV</button>` +
      `<button type="button" class="rec-btn rec-icon rec-size"></button>` +
      `<button type="button" class="rec-btn rec-icon rec-close" aria-label="Close table" title="Close">${symbol("M3.5 3.5l9 9M12.5 3.5l-9 9")}</button></span></div>` +
      `<div class="rec-body"></div>`;
    host.appendChild(el);
    el.querySelector(".rec-close").addEventListener("click", schliessen);
    groesse(false);
    el.querySelector(".rec-size").addEventListener("click", () => groesse(!el.classList.contains("gross")));
    el.querySelector(".rec-csv").addEventListener("click", csv);
    el.querySelector(".rec-body").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-k]");
      if (th) {
        sortAb = sortKey === th.dataset.k ? !sortAb : th.dataset.k === "date";
        sortKey = th.dataset.k;
        sortieren(); zeichnen();
        return;
      }
      const tr = e.target.closest("tr[data-i]");
      if (tr && !e.target.closest("a")) {   // Zeile anklicken: Karte springt zum Nachweis
        const z = zeilen[+tr.dataset.i];
        map.flyTo({ center: [z.lon, z.lat], zoom: Math.max(map.getZoom(), (meta.detailZoom || 8) + 2) });
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && offen() && !window._atlasDrawing) schliessen(); });
  }
  // Knopf vergrössern / verkleinern: Symbol und Text zeigen, was ein Klick bewirkt
  const PFEILE_AUS = "M9 2h5v5M14 2l-5 5M7 14H2V9M2 14l5-5";   // nach aussen: vergrössern
  const PFEILE_EIN = "M14 2L9 7M9 3v4h4M2 14l5-5M3 9h4v4";   // nach innen: verkleinern
  function groesse(gross) {
    el.classList.toggle("gross", gross);
    const b = el.querySelector(".rec-size"), text = gross ? "Smaller table" : "Larger table";
    b.title = text; b.setAttribute("aria-label", text); b.setAttribute("aria-pressed", String(gross));
    b.innerHTML = symbol(gross ? PFEILE_EIN : PFEILE_AUS);
  }
  function zeichnen() {
    const body = el.querySelector(".rec-body");
    const n = zeilen.length, gezeigt = zeilen.slice(0, TABELLE_MAX_ZEILEN);
    const summe = zeilen.reduce((a, z) => a + z.n, 0);
    el.querySelector(".rec-info").textContent = `${n.toLocaleString("en")} record${n === 1 ? "" : "s"}` +
      (summe > n ? ` (${summe.toLocaleString("en")} with merged ones)` : "");
    el.querySelector(".rec-csv").disabled = n === 0;
    if (!n) { body.innerHTML = `<p class="rec-msg">No records in this area with the current filters.</p>`; return; }
    const kopf = SPALTEN.map((s) => {
      const aktiv = s.k === sortKey;
      return `<th data-k="${s.k}"${s.num ? ' class="num"' : ""} aria-sort="${aktiv ? (sortAb ? "descending" : "ascending") : "none"}">` +
        `${s.t}${aktiv ? (sortAb ? " ▾" : " ▴") : ""}</th>`;
    }).join("");
    const reihen = gezeigt.map((z, i) => `<tr data-i="${i}" title="Show on the map">` +
      `<td class="sci">${esc(z.sp)}</td><td>${esc(z.date || "–")}${z.n > 1 ? ` <span class="rec-n" title="${z.n} records at this place, shown as one">×${z.n}</span>` : ""}</td>` +
      `<td>${esc(z.src)}</td><td>${esc(z.grade)}</td><td class="num">${z.lat.toFixed(4)}</td><td class="num">${z.lon.toFixed(4)}</td>` +
      `<td class="num">${z.acc ? esc(formatAccuracy(z.acc).replace("±", "")) : ""}</td><td class="rec-ds">${esc(z.ds)}</td>` +
      `<td>${z.url ? `<a href="${esc(z.url)}" target="_blank" rel="noopener">Open</a>` : ""}</td></tr>`).join("");
    body.innerHTML = (n > TABELLE_MAX_ZEILEN ? `<p class="rec-msg">The first ${TABELLE_MAX_ZEILEN.toLocaleString("en")} records are shown. ` +
      `Download the CSV file for all ${n.toLocaleString("en")}.</p>` : "") +
      `<table class="rec-table"><thead><tr>${kopf}</tr></thead><tbody>${reihen}</tbody></table>`;
  }
  function csv() {
    const feld = (v) => { v = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const kopf = ["species", "date", "year", "source", "quality_grade", "latitude", "longitude", "accuracy_m", "records_merged", "dataset_reference", "url"];
    const text = [kopf.join(",")].concat(zeilen.map((z) => [z.sp, z.date, z.r[5] || "", z.src, z.grade, z.lat, z.lon,
      z.acc === null ? "" : Math.round(z.acc), z.n, z.ds, z.url].map(feld).join(","))).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    a.download = "bat-records-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function neu() {
    if (!offen() || !holen) return;
    const run = ++lauf;
    el.querySelector(".rec-title").textContent = titel;
    el.querySelector(".rec-info").textContent = "";
    el.querySelector(".rec-body").innerHTML = `<p class="rec-msg">Loading records …</p>`;
    const res = await holen();
    if (run !== lauf || !offen()) return;
    if (res.zuGross) {
      zeilen = [];
      el.querySelector(".rec-csv").disabled = true;
      el.querySelector(".rec-body").innerHTML = `<p class="rec-msg">This area is too large to list every record. ` +
        `Please draw a smaller area (up to about 1000 × 1000 km) to see its records as a table.</p>`;
      return;
    }
    zeilen = res.recs.map(zeile);
    sortieren(); zeichnen();
  }
  function oeffnen(t, h) {
    if (!el) anlegen();
    titel = t; holen = h;
    el.hidden = false;
    neu();
  }
  function schliessen() { if (el) el.hidden = true; lauf++; }
  function offen() { return !!el && !el.hidden; }
  return { oeffnen, schliessen, offen, neu, setTitel: (t) => { titel = t; } };
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

  const state = { f: -1, g: -1, t: -1, from: null, to: null, area: null, land: null, s: new Set(data.sources.map((_, i) => i)),
                  q: new Set(data.grades.map((_, i) => i)), acc: { stufe: 0, ohne: true } };
  const genauOk = () => genauPruefer(state.acc);   // null = kein Genauigkeitsfilter
  let landData = null, landCells = new Set();   // gewähltes Land: Daten und Quadrate mit Nachweisen darin
  const countrySel = $("f-country");
  if (countrySel) countrySel.innerHTML = `<option value="">All countries</option>` +
    (data.countries || []).map((c) => `<option value="${esc(c.c)}">${esc(c.n)} (${c.k.toLocaleString("en")})</option>`).join("");

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
  // Schieber «Location accuracy» unter der Qualitätsstufe
  const accBox = document.createElement("fieldset");
  accBox.className = "filter acc"; accBox.id = "f-acc";
  accBox.innerHTML = "<legend>Location accuracy</legend>";
  ($("f-grades").closest("fieldset") || $("f-sources").closest("fieldset")).after(accBox);
  const accRegler = genauRegler(accBox, state.acc, () => apply());

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
    if (state.land) all.push(["==", ["get", "l"], landIndex(data, state.land)]);
    if (genauOk()) all.push(["in", ["get", "a"], ["literal", genauKlassen(state.acc)]]);
    return all;
  }

  /* Gezeichnetes Gebiet: Punkt-im-Polygon (Strahlenverfahren); Quadrate zählen, wenn ihre Mitte darin liegt */
  const areaCache = new Map();
  function cellInArea(cx, cy) {
    if (state.land) return landCells.has(cx * 100000 + cy);
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
  const seitenteil = seitenteilKnopf(map);
  const schubladeZu = () => { if (seitenteil && HANDY.matches) seitenteil(true); };   // Handy: Karte freigeben
  // Nachweise im Gebiet als Tabelle (Knopf unter «Remove area»)
  const tabelle = nachweisTabelle(map, data);
  const tabKnopf = document.createElement("button");
  tabKnopf.type = "button"; tabKnopf.id = "area-table"; tabKnopf.className = "area-btn secondary";
  tabKnopf.textContent = "Show records as table"; tabKnopf.hidden = true;
  ($("area-species") || $("clear-area")).after(tabKnopf);
  const tabTitel = () => "Records in " + (state.land ? gebietName(data, { land: state.land }) : "your area");
  function tabHolen() {
    const g = state.land ? { land: state.land } : { area: state.area };
    const genau = genauOk();
    return gebietNachweise(data, g, (r) => taxonOk(r[3]) && yearOk(r[5]) && state.s.has(r[6]) && state.q.has(r[7]) &&
                                           (!genau || genau(genauKlasse(r[2]))), mapStatus);
  }
  tabKnopf.addEventListener("click", () => { schubladeZu(); tabelle.oeffnen(tabTitel(), tabHolen); });
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
    return state.s.size < data.sources.length || state.q.size < data.grades.length || state.from || state.to || state.area || state.land ||
           !!genauOk();
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
    const genau = genauOk();
    if (genau) {   // mit Genauigkeit: eigene Raster je Taxon [cx, cy, quelle, qualität, jahr, klasse, anzahl]
      mapStatus("Loading …");
      const loaded = await Promise.all(wanted.map((t) => loadGenau("grid/" + t)));
      mapStatus(null);
      for (const D of loaded) {
        if (!D) continue;
        for (let k = 0; k < D.length; k += 7) {
          if (genau(D[k + 5]) && state.s.has(D[k + 2]) && state.q.has(D[k + 3]) && yearOk(D[k + 4]) && cellInArea(D[k], D[k + 1])) {
            add(D[k], D[k + 1], D[k + 6]);
          }
        }
      }
      return cells;
    }
    const nurLand = state.land && landData && state.s.size === data.sources.length &&
                    state.q.size === data.grades.length && !state.from && !state.to;
    if (nurLand) {   // Land ohne weitere Filter: Quadrate genau aus den Länderdaten
      const Z = landData.Z;   // [cx, cy, taxon, periode, n]
      for (let k = 0; k < Z.length; k += 5) if (taxonOk(Z[k + 2])) add(Z[k], Z[k + 1], Z[k + 4]);
      return cells;
    }
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
    const key = state.area || state.land, gk = genauSchluessel(state.acc);
    if (areaRes && areaRes.key === key && areaRes.gk === gk) return areaRes;
    const g = state.land ? { land: state.land } : { area: state.area };
    const res = Object.assign(await gebietEntries(data, g, mapStatus, taxonGrids, genauOk()), { key, gk });
    if ((state.area || state.land) === key && genauSchluessel(state.acc) === gk) areaRes = res;
    return res;
  }
  // Für die Artenliste: Gebiet und Filter merken – sie zählt selbst (so muss die Karte nicht fertig geladen sein)
  function areaMerken() {
    if (!state.area && !state.land) return;
    areaSchreiben(Object.assign(state.land ? { land: state.land } : { area: state.area },
      { version: data.version, from: state.from, to: state.to, s: [...state.s], q: [...state.q],
        acc: Object.assign({}, state.acc) }));
  }

  let statusEl = null;
  const ZEICHNEN_HINWEIS = "Tap the map to set the corners; tap the first point to finish.";
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
    const genau = genauOk();
    if (!state.area && !state.land && genau) {
      // Zahlen nach Genauigkeit [taxon, quelle, qualität, jahr, klasse, anzahl] (einmal nachgeladen)
      const A = (await loadGenau("counts")) || [];
      if (run !== applyRun) return;
      for (let k = 0; k < A.length; k += 6) {
        if (genau(A[k + 4]) && taxonOk(A[k]) && yearOk(A[k + 3])) zaehlen(A[k], A[k + 1], A[k + 2], A[k + 5]);
      }
    } else if (!state.area && !state.land) {
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
      const name = state.land ? gebietName(data, { land: state.land }) : null;
      $("area-note").textContent = name ? `Only records in ${name} are shown and counted.`
        : res.exact ? "Only records inside your area are shown and counted."
        : "Only records inside your area are shown. The area is large, so records are counted by squares: the numbers near " +
          "the edge are approximate; zoom in to see exactly which records lie inside.";
      const link = $("area-species");
      if (link) {
        const n = artenImGebiet.size;
        link.textContent = `Show the ${n} species ${name ? "in " + name : "in this area"} →`;
        link.hidden = n === 0;
      }
    }
    const species = [...taxa].filter((t) => data.taxa[t].s && !data.taxa[t].k).length;
    $("summary").innerHTML = `Showing <strong>${n.toLocaleString("en")}</strong> record${n === 1 ? "" : "s"} of <strong>${species}</strong> species`;
    document.querySelectorAll("#f-sources .n").forEach((el) => (el.textContent = perSource[+el.dataset.n].toLocaleString("en")));
    document.querySelectorAll("#f-grades .n").forEach((el) => (el.textContent = perGrade[+el.dataset.n].toLocaleString("en")));
    $("area-note").hidden = !state.area && !state.land;
    if (!state.area && !state.land && $("area-species")) $("area-species").hidden = true;
    tabKnopf.hidden = !state.area && !state.land;
    if (tabelle.offen()) {   // Tabelle folgt Gebiet und Filtern
      if (!state.area && !state.land) tabelle.schliessen();
      else if (run === applyRun) { tabelle.setTitel(tabTitel()); tabelle.neu(); }
    }
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
    if (HANDY.matches) { schubladeZu(); mapStatus(ZEICHNEN_HINWEIS); }   // Hinweis im Seitenteil wäre jetzt verdeckt
  }
  function drawStop() {
    setTimeout(() => (window._atlasDrawing = false), 0);   // erst nach diesem Klick: sonst öffnet sich ein Pop-up
    map.doubleClickZoom.enable(); map.getCanvas().style.cursor = "";
    $("area-hint").hidden = true; $("draw-area").textContent = "Draw area on map";
    if (statusEl && statusEl.textContent === ZEICHNEN_HINWEIS) mapStatus("");
  }
  function drawFinish() {
    drawPts = drawPts.filter((p, i) => i === 0 || Math.abs(p[0] - drawPts[i - 1][0]) + Math.abs(p[1] - drawPts[i - 1][1]) > 1e-9);
    if (drawPts.length < 3) return;
    drawStop(); drawRender(true);
    landAufheben();
    state.area = [...drawPts, drawPts[0]]; areaCache.clear();
    $("clear-area").hidden = false;
    apply();
  }
  function clearArea() {
    drawStop(); drawPts = []; drawRender(false);
    landAufheben();
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
    map.addSource("land", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "land-fill", type: "fill", source: "land", paint: { "fill-color": brand, "fill-opacity": 0.05 } }, "recs");
    map.addLayer({ id: "land-line", type: "line", source: "land",
                   paint: { "line-color": brand, "line-width": 2, "line-dasharray": [2, 1] } });
    landZeigen(true);
  });
  // Land wählen (Feld «Country»): ersetzt ein gezeichnetes Gebiet
  function landZeigen(zoomen) {
    if (!map.getSource("land")) return;
    const geo = state.land && landData && landData.o;
    map.getSource("land").setData(geo ? { type: "Feature", properties: {}, geometry: geo } : { type: "FeatureCollection", features: [] });
    if (zoomen && state.land && landData && landData.b) {
      const b = landData.b;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 9, animate: false });
    }
  }
  function landAufheben() {
    state.land = null; landData = null; landCells = new Set();
    if (countrySel) countrySel.value = "";
    landZeigen(false);
  }
  async function landSetzen(iso) {
    state.land = iso;
    if (countrySel) countrySel.value = iso;
    landData = await loadLand(data, iso);
    if (state.land !== iso) return;   // inzwischen anders gewählt
    landCells = new Set();
    if (landData) for (let k = 0; k < landData.Z.length; k += 5) landCells.add(landData.Z[k] * 100000 + landData.Z[k + 1]);
    $("clear-area").hidden = false;
    landZeigen(true);
    apply();
  }
  if (countrySel) countrySel.addEventListener("change", () => {
    const iso = countrySel.value;
    if (!iso) { clearArea(); return; }
    if (window._atlasDrawing) drawStop();
    drawPts = []; drawRender(false);
    state.area = null; areaCache.clear();
    landSetzen(iso);
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
  if (gebietGueltig(gemerkt)) {
    if (gemerkt.land) landSetzen(gemerkt.land);
    else {
      drawPts = gemerkt.area.slice(0, -1);
      state.area = gemerkt.area;
      map.on("load", () => drawRender(true));   // nach dem Anlegen der Zeichenebene (oben)
    }
    if (gemerkt.version === data.version) {   // Filter nur aus derselben Version der Webseite übernehmen
      state.from = gemerkt.from || null; state.to = gemerkt.to || null;
      if (state.from) yFrom.value = state.from;
      if (state.to) yTo.value = state.to;
      if (Array.isArray(gemerkt.s)) state.s = new Set(gemerkt.s);
      if (Array.isArray(gemerkt.q)) state.q = new Set(gemerkt.q);
      checks("f-sources", data.sources, state.s); checks("f-grades", data.grades, state.q);
    }
    if (gemerkt.acc && GENAU_STUFEN[gemerkt.acc.stufe]) {
      state.acc.stufe = gemerkt.acc.stufe; state.acc.ohne = gemerkt.acc.ohne !== false;
      accRegler.setzen(state.acc);
    }
    $("clear-area").hidden = false;
  }
  $("draw-area").addEventListener("click", () => (window._atlasDrawing ? (drawStop(), (drawPts = []), drawRender(false)) : drawStart()));
  $("clear-area").addEventListener("click", clearArea);

  $("reset").addEventListener("click", () => {
    if (state.area || window._atlasDrawing) { drawStop(); drawPts = []; drawRender(false); }
    $("clear-area").hidden = true;
    landAufheben();
    Object.assign(state, { f: -1, g: -1, t: -1, from: null, to: null, area: null });
    state.acc.stufe = 0; state.acc.ohne = true; accRegler.setzen(state.acc);
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
   Darüber wie die Startseite: Raster in der Übersicht, Kreise ab data.detailZoom.
   Ein Gebiet kommt aus der Adresse (#area=…, von Karte oder Artenliste) oder wird direkt auf der Artkarte gezeichnet. */
function initSpecies(data) {
  // Auf schmalen Bildschirmen startet die Legende zugeklappt, damit die Karte frei bleibt
  const legendBox = document.getElementById("map-legend");
  if (legendBox && window.matchMedia("(max-width: 760px)").matches) legendBox.open = false;
  const direct = Array.isArray(data.recs);
  const shown = new Set(PERIODS.map((_, i) => i));
  const box = document.getElementById("periods");

  // Gebiet: gezeichnetes Polygon («area») oder Land («land», ISO-Code); kann sich auf der Seite ändern
  const gemerkt = areaAusAdresse();
  let gebiet = gebietGueltig(gemerkt) ? gemerkt : null;
  let area = null, land = null;
  let areaOn = false, areaRecs = null;   // areaRecs: alle Nachweise dieser Art im Gebiet (genau), sonst null
  let landData = null;                   // Länderdaten (Zahlen pro Zeitraum und Quadrat sind dort genau)
  const zelleImGebiet = new Map();
  // Genauigkeit: Schieber in «Map layers»; Raster/Länderzahlen nach Genauigkeit werden erst dann geladen
  const acc = { stufe: 0, ohne: true };
  let genauGrid = null, genauLand = null;   // [cx, cy, periode, klasse, n] bzw. Länderdaten mit Klasse
  const genauOk = () => genauPruefer(acc);
  const recOk = (r) => { const ok = genauOk(); return !ok || ok(genauKlasse(r[2])); };
  function gebietUebernehmen(g) {
    gebiet = gebietGueltig(g) ? g : null;
    area = gebiet && gebiet.area ? gebiet.area : null;
    land = gebiet && gebiet.land ? gebiet.land : null;
    areaOn = !!gebiet; areaRecs = null; landData = null; genauLand = null;
    zelleImGebiet.clear();
  }
  gebietUebernehmen(gebiet);
  if (gebiet) areaLinks(gebiet);         // Menü «Map»/«Species» behalten das Gebiet
  function cellIn(cx, cy) {
    const key = cx * 100000 + cy;
    if (!zelleImGebiet.has(key)) zelleImGebiet.set(key, inPolygon((cx + 0.5) * data.cell - 180, (cy + 0.5) * data.cell - 90, area));
    return zelleImGebiet.get(key);
  }

  function periodCounts() {
    const counts = new Array(PERIODS.length).fill(0);
    const genau = genauOk();
    if (genau) {
      if (areaOn && land) {
        const P = genauLand ? genauLand.P : [];   // [taxon, periode, klasse, n]
        for (let k = 0; k < P.length; k += 4) if (P[k] === data.t && genau(P[k + 2])) counts[P[k + 1]] += P[k + 3];
      } else if (areaOn && areaRecs) { for (const r of areaRecs) if (recOk(r)) counts[r[10]]++; }
      else if (direct) { for (const r of data.recs) if (recOk(r)) counts[r[10]]++; }
      else {
        const G = genauGrid || [];
        for (let k = 0; k < G.length; k += 5) {
          if (genau(G[k + 3]) && (!areaOn || cellIn(G[k], G[k + 1]))) counts[G[k + 2]] += G[k + 4];
        }
      }
      return counts;
    }
    if (areaOn && land) {
      const P = landData ? landData.P : [];   // [taxon, periode, n]
      for (let k = 0; k < P.length; k += 3) if (P[k] === data.t) counts[P[k + 1]] += P[k + 2];
      return counts;
    }
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
      (areaOn && (!land || landData) ? `<p class="legend-source">No records of this species in ${land ? esc(gebietName(data, gebiet)) : "your area"}` +
        `${genauOk() ? " with this location accuracy" : ""}.</p>`
        : genauOk() ? `<p class="legend-source">No records with this location accuracy.</p>` : "");
    return counts;
  }

  function gridCells() {
    const cells = new Map();
    const add = (cx, cy, n) => { const key = cx * 100000 + cy; cells.set(key, (cells.get(key) || 0) + n); };
    const genau = genauOk();
    if (genau && !(areaOn && areaRecs)) {
      if (areaOn && land) {   // [cx, cy, taxon, periode, klasse, n]
        const Z = genauLand ? genauLand.Z : [];
        for (let k = 0; k < Z.length; k += 6) if (Z[k + 2] === data.t && shown.has(Z[k + 3]) && genau(Z[k + 4])) add(Z[k], Z[k + 1], Z[k + 5]);
      } else {
        const G = genauGrid || [];   // [cx, cy, periode, klasse, n]
        for (let k = 0; k < G.length; k += 5) {
          if (genau(G[k + 3]) && shown.has(G[k + 2]) && (!areaOn || cellIn(G[k], G[k + 1]))) add(G[k], G[k + 1], G[k + 4]);
        }
      }
      return cells;
    }
    if (areaOn && land) {   // Land: Quadrate genau aus den Länderdaten
      const Z = landData ? landData.Z : [];   // [cx, cy, taxon, periode, n]
      for (let k = 0; k < Z.length; k += 5) if (Z[k + 2] === data.t && shown.has(Z[k + 3])) add(Z[k], Z[k + 1], Z[k + 4]);
      return cells;
    }
    if (areaOn && areaRecs) {   // genau: Quadrate aus den Nachweisen im Gebiet
      for (const r of areaRecs) if (shown.has(r[10]) && recOk(r)) add(Math.floor((r[0] + 180) / data.cell), Math.floor((r[1] + 90) / data.cell), 1);
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
    if (areaOn && area) f.push(["within", { type: "Polygon", coordinates: [area] }]);
    if (areaOn && land) f.push(["==", ["get", "l"], landIndex(data, land)]);
    if (genauOk()) f.push(["in", ["get", "a"], ["literal", genauKlassen(acc)]]);
    return f;
  }

  // Kasten oben in der Legende: Gebiet zeichnen; mit Gebiet: Anzahl darin, Umschalter, Links zur Artenliste und Karte
  let areaBox = null;
  function renderAreaBox(counts) {
    if (!areaBox) {
      areaBox = document.createElement("div");
      areaBox.className = "checks area-box";
      box.before(areaBox);
    }
    const zeichnet = !!window._atlasDrawing;
    const knopf = `<button type="button" class="area-btn secondary small" id="sp-draw">` +
      `${zeichnet ? "Cancel drawing" : gebiet ? "Draw a new area" : "Draw area on map"}</button>`;
    const hinweis = zeichnet ? `<p class="legend-sub area-hint">Click on the map to set the corners of the area. ` +
      `Click the first point (or double-click) to finish; Esc cancels.</p>` : "";
    if (!gebiet) {
      areaBox.innerHTML = knopf + hinweis + `<hr class="legend-sep">`;
    } else {
      const n = counts.reduce((a, b) => a + b, 0);
      const ungefaehr = !land && !direct && !areaRecs ? " (approx.)" : "";
      const wo = land ? esc(gebietName(data, gebiet)) : "your area";
      areaBox.innerHTML = `<label><input type="checkbox" id="area-only"${areaOn ? " checked" : ""}>` +
        `<span class="swatch area" style="border-style:dashed;border-color:var(--brand)"></span>Only records in ${wo}` +
        (areaOn ? `<span class="n">${n.toLocaleString("en")}${ungefaehr}</span>` : "") + `</label>` +
        `<p class="legend-source"><a href="index.html${areaHash(gebiet)}">Species in ${land ? wo : "this area"}</a> · ` +
        `<a href="../index.html${areaHash(gebiet)}">Show the area on the main map</a></p>` +
        `<div class="area-tools">${knopf}` +
        (zeichnet ? "" : `<button type="button" class="area-btn secondary small" id="sp-clear">Remove area</button>` +
                         `<button type="button" class="area-btn secondary small" id="sp-table">Records as table</button>`) +
        `</div>${hinweis}<hr class="legend-sep">`;
      areaBox.querySelector("#area-only").addEventListener("change", (e) => {
        areaOn = e.target.checked;
        renderAreaBox(renderPeriods());
        aktualisieren();
      });
    }
    areaBox.querySelector("#sp-draw").addEventListener("click", () => (window._atlasDrawing ? drawCancel() : drawStart()));
    const weg = areaBox.querySelector("#sp-clear");
    if (weg) weg.addEventListener("click", () => gebietSetzen(null));
    const tab = areaBox.querySelector("#sp-table");
    if (tab) tab.addEventListener("click", () => tabelle.oeffnen(tabTitel(), tabHolen));
  }

  const map = makeMap("map");
  const colorExpr = ["match", ["get", "p"]];
  PERIODS.forEach((p, i) => colorExpr.push(i, p.color));
  colorExpr.push("#8a9496");
  let store = null, ready = false;
  seitenteilKnopf(map);
  // Nachweise dieser Art im Gebiet als Tabelle (nur die eingeschalteten Zeiträume)
  const tabelle = nachweisTabelle(map, data);
  const tabTitel = () => `Records of ${data.taxa[data.t].n} in ${land ? gebietName(data, gebiet) : "your area"}`;
  const tabHolen = () => gebietNachweise(data, gebiet, (r) => r[3] === data.t && shown.has(r[10]) && recOk(r), () => {},
                                         direct ? data.recs : null);
  function aktualisieren() {
    if (tabelle.offen()) {   // Tabelle folgt Gebiet und Zeiträumen
      if (!gebiet) tabelle.schliessen();
      else { tabelle.setTitel(tabTitel()); tabelle.neu(); }
    }
    if (!ready) return;
    map.setFilter("recs", recFilter());
    if (!direct) setGrid(map, data, gridCells());
    if (map.getLayer("area-line")) {
      map.setLayoutProperty("area-line", "visibility", areaOn ? "visible" : "none");
      map.setLayoutProperty("area-fill", "visibility", areaOn ? "visible" : "none");
    }
  }
  // Umriss des Gebiets (gestrichelt): beim ersten Mal anlegen, danach nur ersetzen bzw. leeren
  function umrissSetzen(geometry) {
    const src = map.getSource("area-outline");
    if (!src) { if (geometry) addAreaOutline(map, geometry); return; }
    src.setData(geometry ? { type: "Feature", properties: {}, geometry } : { type: "FeatureCollection", features: [] });
  }

  async function gebietVorbereiten() {
    const g = gebiet;   // falls inzwischen ein anderes Gebiet gezeichnet wurde, Ergebnis verwerfen
    if (land) {
      const d = await loadLand(data, land);
      if (g === gebiet) landData = d;
      return;
    }
    if (!area) return;
    if (direct) areaRecs = data.recs.filter((r) => inPolygon(r[0], r[1], area));
    else {
      const ids = areaKacheln(data, area);
      if (ids.length <= AREA_EXACT_TILES) {
        const results = await Promise.all(ids.map(loadTile));
        if (g !== gebiet) return;
        const recs = [];
        for (const res of results) for (const r of res) if (r[3] === data.t && inPolygon(r[0], r[1], area)) recs.push(r);
        areaRecs = recs;
      }
    }
  }

  // Zahlen nach Genauigkeit nachladen, soweit für die aktuelle Ansicht nötig
  async function genauVorbereiten() {
    if (!genauOk()) return;
    if (!direct && !genauGrid) genauGrid = (await loadGenau("species/" + data.taxa[data.t].s)) || [];
    if (land && !genauLand) {
      const info = (data.countries || []).find((x) => x.c === land), g = gebiet;
      const d = info ? await loadGenau("laender/" + info.f) : null;
      if (g === gebiet) genauLand = d || { P: [], Z: [] };
    }
  }
  async function genauGeaendert() {
    await genauVorbereiten();
    renderAreaBox(renderPeriods());
    aktualisieren();
  }

  // Neues Gebiet übernehmen (null = entfernen): Adresse und Tab-Speicher nachführen, Zahlen und Karte neu
  function gebietSetzen(g) {
    if (window._atlasDrawing) drawStop();
    drawPts = []; drawRender();
    gebietUebernehmen(g);
    try {
      if (gebiet) sessionStorage.setItem(AREA_KEY, JSON.stringify(gebiet));
      else sessionStorage.removeItem(AREA_KEY);
    } catch (e) { /* Speicher gesperrt: Gebiet gilt dann nur in der Adresse */ }
    history.replaceState(null, "", location.pathname + location.search + areaHash(gebiet));
    areaLinks(gebiet);
    if (ready) umrissSetzen(area ? { type: "Polygon", coordinates: [area] } : null);
    renderAreaBox(renderPeriods());
    aktualisieren();
    Promise.all([gebietVorbereiten(), genauVorbereiten()]).then(() => {
      if (ready && land && landData && landData.o) umrissSetzen(landData.o);
      renderAreaBox(renderPeriods()); aktualisieren();
    });
  }

  /* ---- Gebiet zeichnen (wie auf der Karte): Punkte anklicken, ersten Punkt (oder Doppelklick) zum Abschliessen ---- */
  let drawPts = [];
  function drawRender() {
    if (!map.getSource("draw")) return;
    const features = [];
    if (drawPts.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: drawPts }, properties: {} });
    drawPts.forEach((p) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
    map.getSource("draw").setData({ type: "FeatureCollection", features });
  }
  function drawStart() {
    window._atlasDrawing = true; drawPts = []; drawRender();
    map.doubleClickZoom.disable(); map.getCanvas().style.cursor = "crosshair";
    renderAreaBox(periodCounts());
  }
  function drawStop() {
    setTimeout(() => (window._atlasDrawing = false), 0);   // erst nach diesem Klick: sonst öffnet sich ein Pop-up
    map.doubleClickZoom.enable(); map.getCanvas().style.cursor = "";
  }
  function drawCancel() {
    drawStop(); drawPts = []; drawRender();
    setTimeout(() => renderAreaBox(periodCounts()), 0);
  }
  function drawFinish() {
    drawPts = drawPts.filter((p, i) => i === 0 || Math.abs(p[0] - drawPts[i - 1][0]) + Math.abs(p[1] - drawPts[i - 1][1]) > 1e-9);
    if (drawPts.length < 3) return;
    const ring = [...drawPts, drawPts[0]].map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]);
    // Jahr- und Quellenfilter der Karte behalten, falls vorhanden
    const rest = gebiet ? Object.assign({}, gebiet) : { version: data.version };
    delete rest.land;
    gebietSetzen(Object.assign(rest, { area: ring }));
    setTimeout(() => renderAreaBox(periodCounts()), 0);
  }
  map.on("click", (e) => {
    if (!window._atlasDrawing) return;
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (drawPts.length >= 3) {
      const a = map.project(drawPts[0]), b = e.point;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 12) { drawFinish(); return; }   // ersten Punkt getroffen
    }
    drawPts.push(p); drawRender();
  });
  map.on("dblclick", (e) => { if (window._atlasDrawing) { e.preventDefault(); drawFinish(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && window._atlasDrawing) drawCancel(); });

  // Schieber «Location accuracy» in der Legende, unter den Zeiträumen
  const accHost = document.createElement("div");
  accHost.className = "acc-box";
  accHost.innerHTML = `<hr class="legend-sep"><span class="legend-title">Location accuracy</span>`;
  box.after(accHost);
  genauRegler(accHost, acc, genauGeaendert);
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
    if (area) addAreaOutline(map, { type: "Polygon", coordinates: [area] });
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#1f3a68";
    map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "draw-line", type: "line", source: "draw", filter: ["!=", ["geometry-type"], "Point"],
                   paint: { "line-color": brand, "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({ id: "draw-pts", type: "circle", source: "draw", filter: ["==", ["geometry-type"], "Point"],
                   paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": brand, "circle-stroke-width": 2 } });
    bindPopups(map, data, "", store);
    ready = true;
    aktualisieren();
    if (area) map.fitBounds(areaGrenzen(area), { padding: 50, maxZoom: 10, animate: false });
    else if (land) vorbereitet.then(() => {   // Land: Umriss und Ausschnitt, sobald die Länderdaten da sind
      if (!landData) return;
      if (landData.o) { umrissSetzen(landData.o); aktualisieren(); }
      const b = landData.b;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 9, animate: false });
    });
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
  const area = gebietGueltig(gemerkt) ? gemerkt : null;
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
    empty.textContent = aktiv() && !q ? `No species recorded in ${esc(gebietName(meta, area))}.`
                                      : "No species match your search. Try a genus name or part of a common name.";
    zeigeBanner();
  }
  function zeigeBanner() {
    if (!area || !banner) return;
    banner.hidden = false;
    if (!counts) {
      banner.innerHTML = `<p>Counting the records in ${esc(gebietName(meta, area))} …</p>`;
      return;
    }
    if (areaOn) {
      const drin = rows.filter(inArea);
      const n = drin.reduce((a, r) => a + counts[r.dataset.n][0], 0);
      banner.innerHTML = `<p>Showing the <strong>${drin.filter((r) => !r.dataset.k).length}</strong> species recorded in ${esc(gebietName(meta, area))} ` +
        `(<strong>${n.toLocaleString("en")}</strong> record${n === 1 ? "" : "s"}${filtered ? ", with your filters from the map" : ""}). ` +
        `Records and latest year refer to ${area.land ? esc(gebietName(meta, area)) : "this area"}.${exact ? "" : " The area is large, so records near its edge are counted approximately."}</p>` +
        `<p><button type="button" id="area-toggle" class="link-btn">Show all species</button> · <a href="../index.html${areaHash(area)}">Change the area on the map</a></p>`;
    } else {
      banner.innerHTML = area.land
        ? `<p>${esc(gebietName(meta, area))} is selected on the map. <button type="button" id="area-toggle" class="link-btn">Show only species in ${esc(gebietName(meta, area))}</button></p>`
        : `<p>An area is drawn on the map. <button type="button" id="area-toggle" class="link-btn">Show only species in that area</button></p>`;
    }
    $("area-toggle").addEventListener("click", () => { areaOn = !areaOn; update(); });
  }
  async function zaehlen() {
    const genau = genauPruefer(area.acc && GENAU_STUFEN[area.acc.stufe] ? area.acc : null);
    const res = await gebietEntries(meta, area, () => {}, {}, genau);
    const gleich = area.version === meta.version;   // Filterwerte (Indizes) passen nur zur selben Version
    const sOk = new Set(gleich && Array.isArray(area.s) ? area.s : meta.sources.map((_, i) => i));
    const qOk = new Set(gleich && Array.isArray(area.q) ? area.q : meta.grades.map((_, i) => i));
    const von = gleich ? area.from : null, bis = gleich ? area.to : null;
    filtered = sOk.size < meta.sources.length || qOk.size < meta.grades.length || !!von || !!bis || !!genau;
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
