const fileInput = document.getElementById("fileInput");
const saveKmlButton = document.getElementById("saveKml");
const clearButton = document.getElementById("clearMap");
const fileName = document.getElementById("fileName");
const coordRows = document.getElementById("coordRows");
const details = document.getElementById("details");
const dropZone = document.getElementById("dropZone");
const coordHud = document.getElementById("coordHud");
const centerTarget = document.getElementById("centerTarget");
const centerTargetMode = window.matchMedia("(pointer: coarse), (max-width: 900px)");

const stats = {
  objects: document.getElementById("statObjects"),
  points: document.getElementById("statPoints"),
  lines: document.getElementById("statLines"),
  polygons: document.getElementById("statPolygons")
};

let currentKmlText = "";
let currentLayer = null;
let elevationPoints = [];
let lastMouseLatLng = null;
let terrainTimer = null;
const terrainCache = new Map();

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true
}).setView([39.0, 35.2], 6);

L.control.zoom({ position: "topleft" }).addTo(map);

const esriImagery = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxNativeZoom: 17,
    maxZoom: 21,
    detectRetina: false,
    attribution: "Tiles &copy; Esri"
  }
).addTo(map);

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxNativeZoom: 19,
  maxZoom: 22,
  attribution: "&copy; OpenStreetMap"
});

L.control.layers(
  { "Uydu": esriImagery, "OpenStreetMap": osm },
  {},
  { position: "bottomright" }
).addTo(map);

map.on("mousemove", (event) => {
  if (usesCenterTarget()) return;
  lastMouseLatLng = event.latlng;
  updateCoordinateHud(event.latlng);
});

map.on("move zoom moveend zoomend", updateCenterCoordinateHud);
centerTargetMode.addEventListener?.("change", updateCenterCoordinateHud);
setTimeout(updateCenterCoordinateHud, 250);

fileInput.addEventListener("change", async () => {
  if (fileInput.files?.[0]) {
    await openFile(fileInput.files[0]);
  }
});

saveKmlButton.addEventListener("click", () => {
  if (!currentKmlText) return;
  downloadText("SC23-Harita-Earth.kml", currentKmlText, "application/vnd.google-earth.kml+xml");
});

clearButton.addEventListener("click", resetMap);

["dragenter", "dragover"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("visible");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  window.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === "drop") return;
    dropZone.classList.remove("visible");
  });
});

window.addEventListener("drop", async (event) => {
  dropZone.classList.remove("visible");
  const file = event.dataTransfer?.files?.[0];
  if (file) await openFile(file);
});

async function openFile(file) {
  try {
    setDetails("Dosya okunuyor...");
    const ext = file.name.split(".").pop().toLowerCase();
    const kmlText = ext === "kmz"
      ? await readKmz(file)
      : await file.text();

    currentKmlText = kmlText;
    renderKml(kmlText, file.name, ext.toUpperCase());
    saveKmlButton.disabled = false;
  } catch (error) {
    console.error(error);
    setDetails(`Dosya acilamadi.\n${error.message || error}`);
  }
}

async function readKmz(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry = Object.values(zip.files).find((entry) =>
    !entry.dir && entry.name.toLowerCase().endsWith(".kml")
  );

  if (!kmlEntry) {
    throw new Error("KMZ icinde KML dosyasi bulunamadi.");
  }

  return await kmlEntry.async("text");
}

function renderKml(kmlText, originalName, format) {
  resetMap(false);
  elevationPoints = [];

  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) {
    throw new Error("KML yapisi okunamadi.");
  }

  const geojson = toGeoJSON.kml(xml, { styles: true });
  const rows = [];
  const counts = { objects: 0, points: 0, lines: 0, polygons: 0 };

  currentLayer = L.geoJSON(geojson, {
    pointToLayer: (feature, latlng) => makePoint(feature, latlng),
    style: (feature) => styleFeature(feature),
    onEachFeature: (feature, layer) => {
      counts.objects += 1;
      countGeometry(feature.geometry, counts);
      addRows(feature, rows);

      const title = cleanName(feature.properties?.name) || "Nesne";
      const description = cleanDescription(feature.properties?.description);
      layer.bindPopup(`<strong>${escapeHtml(title)}</strong>${description ? `<br>${description}` : ""}`);

      if (isRealTextFeature(feature)) {
        const center = getFeatureCenter(feature);
        if (center) {
          L.marker(center, {
            interactive: false,
            icon: L.divIcon({
              className: "text-marker",
              html: escapeHtml(title),
              iconSize: [1, 1],
              iconAnchor: [0, 0]
            })
          }).addTo(map);
        }
      }
    }
  }).addTo(map);

  if (currentLayer.getBounds().isValid()) {
    map.fitBounds(currentLayer.getBounds(), { padding: [28, 28], maxZoom: 18 });
  }

  fileName.textContent = originalName;
  fillStats(counts);
  fillRows(rows);
  setDetails([
    `Dosya    : ${originalName}`,
    `Format   : ${format}`,
    `Nesne    : ${counts.objects}`,
    `Nokta    : ${counts.points}`,
    `Cizgi    : ${counts.lines}`,
    `Poligon  : ${counts.polygons}`,
    "",
    "Not: Google Earth KML/KMZ verileri web haritasina donusturulur. 3D model, gx track, tour ve bazi Google Earth ozel efektleri tarayici haritasinda sinirli olabilir."
  ].join("\n"));
}

function makePoint(feature, latlng) {
  const title = cleanName(feature.properties?.name);
  const z = getFirstElevation(feature);
  const iconUrl = feature.properties?.icon || feature.properties?.iconUrl || feature.properties?.iconHref;
  const marker = L.marker(latlng, {
    icon: iconUrl ? makeKmlIcon(iconUrl) : makeSc23Icon(title)
  });
  return marker.bindTooltip(
    `${escapeHtml(title || "Yer işareti")}${z === "" ? "" : ` | Z: ${formatElevation(z)}`}`,
    { direction: "top", offset: [0, -34] }
  );
}

function makeKmlIcon(iconUrl) {
  return L.icon({
    iconUrl,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -30],
    tooltipAnchor: [0, -30]
  });
}

function makeSc23Icon(title) {
  const label = title ? `<span class="sc23-pin-label">${escapeHtml(title)}</span>` : "";
  return L.divIcon({
    className: "",
    html: `<span class="sc23-pin"><span class="sc23-pin-body"></span>${label}</span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -40],
    tooltipAnchor: [0, -38]
  });
}

function styleFeature(feature) {
  const color = styleColor(feature, "#f6c744");
  return {
    color,
    weight: Number(feature.properties?.strokeWidth || 3),
    opacity: Number(feature.properties?.strokeOpacity || 0.95),
    fillColor: styleColor(feature, color),
    fillOpacity: Number(feature.properties?.fillOpacity || 0.22)
  };
}

function styleColor(feature, fallback) {
  return feature.properties?.stroke || feature.properties?.fill || fallback;
}

function countGeometry(geometry, counts) {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((item) => countGeometry(item, counts));
    return;
  }
  if (geometry.type.includes("Point")) counts.points += 1;
  if (geometry.type.includes("LineString")) counts.lines += 1;
  if (geometry.type.includes("Polygon")) counts.polygons += 1;
}

function addRows(feature, rows) {
  const name = cleanName(feature.properties?.name) || "Nesne";
  const type = feature.geometry?.type || "Bilinmiyor";
  flattenCoordinates(feature.geometry?.coordinates).slice(0, 3000).forEach((coord) => {
    if (coord[2] !== undefined && coord[2] !== null && coord[2] !== "") {
      elevationPoints.push({
        lat: Number(coord[1]),
        lon: Number(coord[0]),
        z: Number(coord[2])
      });
    }
    rows.push({
      name,
      type,
      lon: coord[0],
      lat: coord[1],
      z: coord[2] ?? ""
    });
  });
}

function flattenCoordinates(coords) {
  if (!Array.isArray(coords)) return [];
  if (typeof coords[0] === "number") return [coords];
  return coords.flatMap(flattenCoordinates);
}

function getFirstElevation(feature) {
  const coord = flattenCoordinates(feature.geometry?.coordinates)
    .find((item) => item[2] !== undefined && item[2] !== null && item[2] !== "");
  return coord ? coord[2] : "";
}

function findNearestElevation(latlng) {
  if (!elevationPoints.length) return "-";

  const zoom = map.getZoom();
  const limitMeters = zoom >= 19 ? 8
    : zoom >= 18 ? 18
    : zoom >= 17 ? 40
    : zoom >= 16 ? 90
    : zoom >= 15 ? 180
    : zoom >= 14 ? 350
    : 800;

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const point of elevationPoints) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !Number.isFinite(point.z)) continue;
    const distance = map.distance(latlng, L.latLng(point.lat, point.lon));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }

  return best && bestDistance <= limitMeters ? formatElevation(best.z) : "-";
}

function usesCenterTarget() {
  return centerTargetMode.matches;
}

function updateCenterCoordinateHud() {
  if (centerTarget) {
    centerTarget.hidden = !usesCenterTarget();
  }

  if (!usesCenterTarget()) return;
  lastMouseLatLng = map.getCenter();
  updateCoordinateHud(lastMouseLatLng);
}

function updateCoordinateHud(latlng) {
  const kmlZ = findNearestElevation(latlng);
  const terrainKey = makeTerrainKey(latlng);
  const terrainZ = terrainCache.get(terrainKey);
  const z = kmlZ !== "-" ? kmlZ : terrainZ ?? "...";

  coordHud.textContent = formatCoordinateHud(latlng, z);

  if (kmlZ === "-" && terrainZ === undefined) {
    queueTerrainElevation(latlng, terrainKey);
  }
}

function makeTerrainKey(latlng) {
  return `${latlng.lat.toFixed(5)},${latlng.lng.toFixed(5)}`;
}

function queueTerrainElevation(latlng, key) {
  clearTimeout(terrainTimer);
  terrainTimer = setTimeout(async () => {
    if (terrainCache.has(key)) return;

    try {
      const z = await fetchTerrainElevation(latlng);
      terrainCache.set(key, z === null ? "-" : formatElevation(z));
    } catch {
      terrainCache.set(key, "-");
    }

    if (lastMouseLatLng && makeTerrainKey(lastMouseLatLng) === key) {
      updateCoordinateHud(lastMouseLatLng);
    }
  }, 450);
}

async function fetchTerrainElevation(latlng) {
  const locations = `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
  const providers = [
    `https://api.opentopodata.org/v1/eudem25m?locations=${locations}`,
    `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`,
    `https://api.open-meteo.com/v1/elevation?latitude=${latlng.lat.toFixed(6)}&longitude=${latlng.lng.toFixed(6)}`
  ];

  for (const url of providers) {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) continue;

      const data = await response.json();
      const elevation = data?.results?.[0]?.elevation ?? data?.elevation?.[0];
      if (Number.isFinite(Number(elevation))) return Number(elevation);
    } catch {
      // Bir DEM servisi cevap vermezse digerine gec.
    }
  }

  return null;
}

function fillStats(counts) {
  stats.objects.textContent = counts.objects.toLocaleString("tr-TR");
  stats.points.textContent = counts.points.toLocaleString("tr-TR");
  stats.lines.textContent = counts.lines.toLocaleString("tr-TR");
  stats.polygons.textContent = counts.polygons.toLocaleString("tr-TR");
}

function fillRows(rows) {
  coordRows.innerHTML = "";
  const fragment = document.createDocumentFragment();

  rows.slice(0, 6000).forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.type)}</td>
      <td>${formatCoordinate(row.lat)}</td>
      <td>${formatCoordinate(row.lon)}</td>
      <td>${row.z === "" ? "" : formatElevation(row.z)}</td>
    `;
    fragment.appendChild(tr);
  });

  coordRows.appendChild(fragment);
}

function getFeatureCenter(feature) {
  const coords = flattenCoordinates(feature.geometry?.coordinates);
  if (!coords.length) return null;
  const avg = coords.reduce((acc, coord) => {
    acc.lat += coord[1];
    acc.lon += coord[0];
    return acc;
  }, { lat: 0, lon: 0 });
  return [avg.lat / coords.length, avg.lon / coords.length];
}

function isRealTextFeature(feature) {
  const properties = feature.properties || {};
  const name = cleanName(properties.name);
  if (!name) return false;
  const typeHint = `${properties.type || ""} ${properties.styleUrl || ""} ${properties.description || ""}`.toLowerCase();
  return /\b(text|mtext|label|yazi|yazı)\b/.test(typeHint);
}

function cleanName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(nesne|polyline|3d polyline|linestring|polygon|placemark)\s*\d*$/i.test(text)) return "";
  return text;
}

function cleanDescription(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return escapeHtml(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).slice(0, 800);
}

function formatNumber(value) {
  if (value === "" || value === undefined || Number.isNaN(Number(value))) return "";
  return Number(value).toFixed(7);
}

function formatCoordinate(value) {
  return formatNumber(value);
}

function formatElevation(value) {
  if (value === "" || value === undefined || Number.isNaN(Number(value))) return "";
  return String(Math.round(Number(value)));
}

function formatCoordinateHud(latlng, z) {
  if (window.matchMedia("(max-width: 640px)").matches) {
    return `E: ${latlng.lat.toFixed(5)} | B: ${latlng.lng.toFixed(5)} | Z: ${z}`;
  }

  return `Enlem: ${latlng.lat.toFixed(7)} | Boylam: ${latlng.lng.toFixed(7)} | Z: ${z}`;
}

function setDetails(text) {
  details.textContent = text;
}

function resetMap(resetFile = true) {
  if (currentLayer) {
    currentLayer.remove();
    currentLayer = null;
  }
  elevationPoints = [];
  coordRows.innerHTML = "";
  fillStats({ objects: 0, points: 0, lines: 0, polygons: 0 });
  lastMouseLatLng = null;
  clearTimeout(terrainTimer);
  coordHud.textContent = "Enlem: - | Boylam: - | Z: -";
  setDetails("Bir KML veya KMZ dosyasi acin.");
  if (resetFile) {
    currentKmlText = "";
    fileName.textContent = "Dosya bekleniyor";
    saveKmlButton.disabled = true;
    fileInput.value = "";
    map.setView([39.0, 35.2], 6);
  }
}

function downloadText(file, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

resetMap();
