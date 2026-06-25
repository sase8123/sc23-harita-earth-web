const LICENSE_CONFIG = {
  supabaseUrl: "https://qlxrykywoiutncwfehvl.supabase.co",
  publishableKey: "sb_publishable_fCUx7PUID8qh6K1ADA_cbg_cF83SHjC",
  functionName: "hyper-service",
  webUrl: "https://earth.sc23harita.com/",
  product: "SC23_HARITA_EARTH",
  platform: "web",
  clientKind: "browser",
  appVersion: "5.0.0-web",
  consentVersion: "2026-06-22"
};

const LICENSE_TERMS = [
  "SC23 Harita Earth Web, KML ve KMZ dosyalarını uydu haritası üzerinde görüntülemek için lisanslı olarak sunulur.",
  "Yazılımın telif hakları SC23 Harita'ya aittir. İzinsiz çoğaltma, dağıtma veya tersine mühendislik yapılamaz.",
  "Deneme süresi ilk web lisans kaydından itibaren 30 gündür. Süre bitince dosya açma, haritada görüntüleme ve kaydetme özellikleri kapatılır.",
  "Lisans kontrolü için oturum bilgisi, cihaz tanımlayıcı, tarayıcı bilgisi, IP ve konum bilgisi gibi teknik kayıtlar saklanabilir."
].join("\n\n");

const licenseState = {
  allowed: false,
  checking: true,
  deviceHash: "",
  deviceSecret: "",
  session: null,
  status: "",
  purchaseRequested: false,
  lastCheckedAt: 0
};

const supabaseClient = window.supabase?.createClient(
  LICENSE_CONFIG.supabaseUrl,
  LICENSE_CONFIG.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

const fileInput = document.getElementById("fileInput");
const saveKmlButton = document.getElementById("saveKml");
const clearButton = document.getElementById("clearMap");
const logoutButton = document.getElementById("logoutButton");
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

const canvasRenderer = L.canvas({ padding: 0.25 });
const textLayer = L.layerGroup().addTo(map);

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

const esriLabels = L.tileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  {
    maxNativeZoom: 18,
    maxZoom: 21,
    opacity: 0.72,
    attribution: "Labels &copy; Esri"
  }
).addTo(map);

const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxNativeZoom: 19,
  maxZoom: 22,
  attribution: "&copy; OpenStreetMap"
});

const openTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxNativeZoom: 17,
  maxZoom: 21,
  attribution: "Map data &copy; OpenStreetMap, SRTM | Style &copy; OpenTopoMap"
});

const cartoLight = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxNativeZoom: 20,
  maxZoom: 22,
  attribution: "&copy; OpenStreetMap &copy; CARTO"
});

const cartoDark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxNativeZoom: 20,
  maxZoom: 22,
  attribution: "&copy; OpenStreetMap &copy; CARTO"
});

const layerControl = L.control.layers(
  {
    "Uydu": esriImagery,
    "OpenStreetMap": osm,
    "Topo Harita": openTopo,
    "Acik Harita": cartoLight,
    "Koyu Harita": cartoDark
  },
  {
    "Uydu Etiketleri": esriLabels
  },
  { position: "bottomright" }
).addTo(map);
makeLayerControlClickOnly(layerControl);

function makeLayerControlClickOnly(control) {
  const container = control.getContainer();
  const toggle = container?.querySelector(".leaflet-control-layers-toggle");
  if (!container || !toggle || !control._expand || !control._collapse) return;

  L.DomEvent.off(container, "mouseenter", control._expand, control);
  L.DomEvent.off(container, "mouseleave", control._collapse, control);
  L.DomEvent.on(toggle, "click", (event) => {
    L.DomEvent.stop(event);
    if (L.DomUtil.hasClass(container, "leaflet-control-layers-expanded")) {
      control.collapse();
      return;
    }
    control.expand();
  });
}

map.on("mousemove", (event) => {
  if (usesCenterTarget()) return;
  lastMouseLatLng = event.latlng;
  updateCoordinateHud(event.latlng);
});

map.on("move zoom moveend zoomend", updateCenterCoordinateHud);
centerTargetMode.addEventListener?.("change", updateCenterCoordinateHud);
setTimeout(updateCenterCoordinateHud, 250);
window.addEventListener("focus", () => {
  if (licenseState.allowed) checkWebLicense(true);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && licenseState.allowed) checkWebLicense(true);
});

fileInput.addEventListener("change", async () => {
  if (!await ensureFreshLicenseAllowed()) {
    fileInput.value = "";
    return;
  }
  if (fileInput.files?.[0]) {
    await openFile(fileInput.files[0]);
  }
});

saveKmlButton.addEventListener("click", () => {
  if (!currentKmlText) return;
  downloadText("SC23-Harita-Earth.kml", currentKmlText, "application/vnd.google-earth.kml+xml");
});

clearButton.addEventListener("click", resetMap);
logoutButton?.addEventListener("click", signOutAndReset);

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
  if (!await ensureFreshLicenseAllowed()) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) await openFile(file);
});

async function openFile(file) {
  if (!await ensureFreshLicenseAllowed()) return;
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
    setDetails(`Dosya açılamadı.\n${error.message || error}`);
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
  const featureTotal = geojson.features?.length ?? 0;
  const liteMode = isLiteMode(featureTotal);
  const rowLimit = liteMode ? 700 : 6000;
  const elevationLimit = liteMode ? 2500 : 15000;
  const rows = [];
  const counts = { objects: 0, points: 0, lines: 0, polygons: 0 };

  currentLayer = L.geoJSON(geojson, {
    renderer: canvasRenderer,
    pointToLayer: (feature, latlng) => makePoint(feature, latlng, liteMode),
    style: (feature) => styleFeature(feature),
    onEachFeature: (feature, layer) => {
      counts.objects += 1;
      countGeometry(feature.geometry, counts);
      addRows(feature, rows, rowLimit, elevationLimit);

      const title = cleanName(feature.properties?.name) || "Nesne";
      const description = cleanDescription(feature.properties?.description);
      if (!liteMode || title !== "Nesne" || description) {
        layer.bindPopup(`<strong>${escapeHtml(title)}</strong>${description ? `<br>${description}` : ""}`);
      }

      if (!liteMode && isRealTextFeature(feature)) {
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
          }).addTo(textLayer);
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
    liteMode ? `Mobil hizli mod: koordinat listesi ilk ${rowLimit} satirla sinirlandi, harita canvas ile hafif cizildi.` : "",
    "",
    "Not: Google Earth KML/KMZ verileri web haritasina donusturulur. 3D model, gx track, tour ve bazi Google Earth ozel efektleri tarayici haritasinda sinirli olabilir."
  ].join("\n"));
}

function isLiteMode(featureCount) {
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches || featureCount > 3500;
}

function makePoint(feature, latlng, liteMode = false) {
  const title = cleanName(feature.properties?.name);
  const z = getFirstElevation(feature);
  if (liteMode) {
    const point = L.circleMarker(latlng, {
      renderer: canvasRenderer,
      radius: 4,
      color: styleColor(feature, "#f6c744"),
      weight: 2,
      opacity: 0.95,
      fillColor: styleColor(feature, "#f6c744"),
      fillOpacity: 0.85
    });
    if (title || z !== "") {
      return point.bindTooltip(
        `${escapeHtml(title || "Yer isareti")}${z === "" ? "" : ` | Z: ${formatElevation(z)}`}`,
        { direction: "top", offset: [0, -10] }
      );
    }
    return point;
  }

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

function addRows(feature, rows, rowLimit, elevationLimit) {
  const name = cleanName(feature.properties?.name) || "Nesne";
  const type = feature.geometry?.type || "Bilinmiyor";
  for (const coord of flattenCoordinates(feature.geometry?.coordinates)) {
    if (coord[2] !== undefined && coord[2] !== null && coord[2] !== "") {
      if (elevationPoints.length < elevationLimit) elevationPoints.push({
        lat: Number(coord[1]),
        lon: Number(coord[0]),
        z: Number(coord[2])
      });
    }
    if (rows.length >= rowLimit) continue;
    rows.push({
      name,
      type,
      lon: coord[0],
      lat: coord[1],
      z: coord[2] ?? ""
    });
  }
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
  textLayer.clearLayers();
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

function ensureLicenseAllowed() {
  if (licenseState.allowed) return true;
  if (licenseState.checking) {
    showLicenseOverlay("checking");
    return false;
  }
  if (licenseState.purchaseRequested) {
    showLicenseOverlay("requested");
    return false;
  }
  showLicenseOverlay("purchase");
  return false;
}

async function ensureFreshLicenseAllowed() {
  if (!licenseState.allowed) return ensureLicenseAllowed();
  if (Date.now() - licenseState.lastCheckedAt < 30000) return true;
  await checkWebLicense(true);
  return ensureLicenseAllowed();
}

async function initLicense() {
  setAppEnabled(false);
  showLicenseOverlay("checking");

  if (!supabaseClient) {
    licenseState.checking = false;
    showLicenseOverlay("error", "Lisans sistemi yüklenemedi. Sayfayı yenileyin.");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  licenseState.session = data?.session || null;
  updateLogoutButton();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    licenseState.session = session;
    updateLogoutButton();
    if (session) checkWebLicense();
  });

  if (!licenseState.session) {
    licenseState.checking = false;
    showLicenseOverlay("login");
    return;
  }

  await checkWebLicense();
}

async function checkWebLicense(silent = false) {
  try {
    licenseState.checking = true;
    if (!silent) {
      setAppEnabled(false);
      showLicenseOverlay("checking");
    }

    const identity = await getWebIdentity();
    licenseState.deviceHash = identity.deviceHash;
    licenseState.deviceSecret = localStorage.getItem(identity.secretKey) || "";

    let result = await callLicenseService({
      action: licenseState.deviceSecret ? "check" : "register",
      deviceHash: identity.deviceHash,
      deviceSecret: licenseState.deviceSecret,
      installId: identity.installId
    });

    if (!result.allowed && result.status === "unauthorized") {
      localStorage.removeItem(identity.secretKey);
      licenseState.deviceSecret = "";
      result = await callLicenseService({
        action: "register",
        deviceHash: identity.deviceHash,
        installId: identity.installId
      });
    }

    if (result.deviceSecret) {
      licenseState.deviceSecret = result.deviceSecret;
      localStorage.setItem(identity.secretKey, result.deviceSecret);
    }

    licenseState.allowed = result.allowed === true;
    licenseState.status = result.status || "";
    licenseState.purchaseRequested = result.purchaseRequested === true ||
      localStorage.getItem(getPurchaseRequestKey()) === "1";
    licenseState.lastCheckedAt = Date.now();
    licenseState.checking = false;

    if (licenseState.allowed) {
      localStorage.removeItem(getPurchaseRequestKey());
      licenseState.purchaseRequested = false;
      setAppEnabled(true);
      hideLicenseOverlay();
      if (!currentKmlText) {
        setDetails(`${formatLicenseStatus(result)}\n\nBir KML veya KMZ dosyasi acin.`);
      }
      return;
    }

    setAppEnabled(false);
    if (licenseState.purchaseRequested) {
      showLicenseOverlay("requested");
      return;
    }
    showLicenseOverlay("purchase", result.message || "Deneme veya lisans süresi sona erdi.");
  } catch (error) {
    console.error(error);
    if (isUnauthorizedSessionError(error)) {
      await signOutAndReset();
      return;
    }
    licenseState.allowed = false;
    licenseState.checking = false;
    setAppEnabled(false);
    showLicenseOverlay("error", error.message || "Lisans kontrolü yapılamadı.");
  }
}

function formatLicenseStatus(result) {
  if (result?.status === "licensed") {
    if (result.isPerpetual === true || result.remainingDays === null) {
      return "Premium lisans aktif. Süresiz lisans.";
    }
    return `Premium lisans aktif. Kalan gün: ${result.remainingDays ?? "-"}`;
  }
  return result?.message || "Lisans aktif.";
}

async function callLicenseService(extraPayload) {
  const session = licenseState.session;
  if (!session?.access_token) throw new Error("Lisans kontrolü için giriş yapın.");

  const payload = {
    product: LICENSE_CONFIG.product,
    platform: LICENSE_CONFIG.platform,
    clientKind: LICENSE_CONFIG.clientKind,
    computerName: getWebComputerName(),
    osVersion: navigator.userAgent,
    architecture: navigator.userAgentData?.platform || navigator.platform || "web",
    culture: navigator.language || "tr-TR",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    appVersion: LICENSE_CONFIG.appVersion,
    consentVersion: LICENSE_CONFIG.consentVersion,
    consentHash: await sha256Text(LICENSE_TERMS),
    consentText: LICENSE_TERMS,
    ...extraPayload
  };

  const response = await fetch(`${LICENSE_CONFIG.supabaseUrl}/functions/v1/${LICENSE_CONFIG.functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: LICENSE_CONFIG.publishableKey,
      authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data && data.allowed === false && data.status) return data;
    throw new Error(data.message || "Lisans servisi cevap vermedi.");
  }
  return data;
}

async function getWebIdentity() {
  const user = licenseState.session?.user;
  if (!user?.id) throw new Error("Oturum bulunamadi.");

  const installIdKey = "sc23_web_install_id";
  let installId = localStorage.getItem(installIdKey);
  if (!installId) {
    installId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    localStorage.setItem(installIdKey, installId);
  }

  const deviceBasis = [
    "SC23 Harita Earth Web",
    user.id
  ].join("|");
  const deviceHash = await sha256Text(deviceBasis);
  return {
    installId,
    deviceHash,
    secretKey: `sc23_web_device_secret_${deviceHash.slice(0, 16)}`
  };
}

function getWebComputerName() {
  const email = licenseState.session?.user?.email || "Web kullanıcı";
  const browser = detectBrowserName();
  return `${browser} - ${email}`.slice(0, 128);
}

function detectBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "Microsoft Edge";
  if (ua.includes("Chrome/")) return "Google Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/")) return "Safari";
  return "Web Tarayici";
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function setAppEnabled(enabled) {
  fileInput.disabled = !enabled;
  clearButton.disabled = !enabled;
  document.body.classList.toggle("license-locked", !enabled);
  if (!enabled) saveKmlButton.disabled = true;
}

function getLicenseOverlay() {
  let overlay = document.getElementById("licenseOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "licenseOverlay";
  overlay.className = "license-overlay";
  document.body.appendChild(overlay);
  overlay.addEventListener("submit", onLicenseSubmit);
  overlay.addEventListener("click", (event) => {
    if (event.target?.dataset?.licenseClose === "1" && licenseState.allowed) hideLicenseOverlay();
  });
  return overlay;
}

function closeButtonHtml() {
  return `<button class="license-close" type="button" data-license-close="1" aria-label="Kapat">&times;</button>`;
}

function showLicenseOverlay(mode, message = "") {
  const overlay = getLicenseOverlay();
  overlay.hidden = false;

  if (mode === "checking") {
    overlay.innerHTML = `
      <section class="license-card compact">
        <h2>Lisans kontrol ediliyor</h2>
        <p>SC23 Harita Earth Web lisans durumu kontrol ediliyor.</p>
      </section>
    `;
    return;
  }

  if (mode === "login") {
    overlay.innerHTML = `
      <form class="license-card" data-license-form="login">
        <h2>SC23 Harita Earth Web</h2>
        <p>Devam etmek için e-posta ve şifre ile giriş yapın. Hesap yoksa aynı bilgilerle otomatik oluşturulur.</p>
        <label>
          <span>E-posta</span>
          <input name="email" type="email" autocomplete="email" required placeholder="ornek@mail.com">
        </label>
        <label>
          <span>Şifre</span>
          <input name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="En az 6 karakter">
        </label>
        <div class="license-terms">${escapeHtml(LICENSE_TERMS)}</div>
        <button class="button secondary wide" type="submit">Giriş Yap / Hesap Oluştur</button>
        <p class="license-note">Devam ederek lisans ve kullanım koşullarını kabul etmiş olursunuz.</p>
      </form>
    `;
    return;
  }

  if (mode === "purchase") {
    const email = licenseState.session?.user?.email || "";
    overlay.innerHTML = `
      <form class="license-card" data-license-form="purchase">
        <h2>Deneme Süresi Sona Erdi</h2>
        <p>${escapeHtml(message || "Deneme veya lisans süresi sona erdi.")}</p>
        <p class="machine-code">Makine kodu: ${escapeHtml((licenseState.deviceHash || "").slice(0, 16).toUpperCase() || "-")}</p>
        <label>
          <span>Ad Soyad</span>
          <input name="name" type="text" autocomplete="name" required>
        </label>
        <label>
          <span>E-posta</span>
          <input name="email" type="email" autocomplete="email" required value="${escapeHtml(email)}">
        </label>
        <div class="plan-row">
          <label><input type="radio" name="plan" value="monthly" checked> Aylık Lisans</label>
          <label><input type="radio" name="plan" value="yearly"> Yıllık Lisans</label>
        </div>
        <button class="button secondary wide" type="submit">Satın Alma Talebi Gönder</button>
      </form>
    `;
    return;
  }

  if (mode === "requested") {
    overlay.innerHTML = `
      <section class="license-card compact">
        <h2>Talebiniz Gönderildi</h2>
        <p>Satın alma talebiniz alındı. Lisans aktifleştirilene kadar dosya açma, haritada görüntüleme ve kaydetme özellikleri kapalı kalır.</p>
        <p class="license-note">Lisans verildikten sonra sayfayı yenileyerek kullanabilirsiniz.</p>
      </section>
    `;
    return;
  }

  overlay.innerHTML = `
    <section class="license-card">
      <h2>Lisans Kontrolü Yapılamadı</h2>
      <p>${escapeHtml(message || "Beklenmeyen bir hata oluştu.")}</p>
      <button class="button secondary wide" type="button" onclick="location.reload()">Tekrar Dene</button>
    </section>
  `;
}

function hideLicenseOverlay() {
  const overlay = document.getElementById("licenseOverlay");
  if (overlay) overlay.hidden = true;
}

async function onLicenseSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  const mode = form.dataset.licenseForm;
  const button = form.querySelector("button[type='submit']");
  let keepButtonDisabled = false;
  if (button) button.disabled = true;
  form.querySelectorAll(".license-error").forEach((item) => item.remove());

  try {
    if (mode === "login") {
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      await signInOrCreateAccount(email, password);
      updateLogoutButton();
      form.innerHTML = `
        <h2>Giriş Başarılı</h2>
        <p>Lisans kontrol ediliyor. Birazdan harita açılacak.</p>
      `;
      await checkWebLicense();
      return;
    }

    if (mode === "purchase") {
      const formData = new FormData(form);
      await callLicenseService({
        action: "purchase",
        deviceHash: licenseState.deviceHash,
        deviceSecret: licenseState.deviceSecret,
        customerName: String(formData.get("name") || "").trim(),
        customerEmail: String(formData.get("email") || "").trim(),
        requestedPlan: formData.get("plan") === "monthly" ? "monthly" : "yearly"
      });
      licenseState.allowed = false;
      licenseState.purchaseRequested = true;
      localStorage.setItem(getPurchaseRequestKey(), "1");
      setAppEnabled(false);
      showLicenseOverlay("requested");
      fileName.textContent = "Satın alma talebi gönderildi";
      setDetails("Satın alma talebiniz gönderildi. Lisans aktifleştirilince sayfayı yenileyip kullanabilirsiniz.");
    }
  } catch (error) {
    console.error(error);
    const friendlyMessage = getLicenseErrorMessage(error);
    const note = document.createElement("p");
    note.className = "license-error";
    note.textContent = friendlyMessage;
    form.appendChild(note);
    if (mode === "login" && isEmailRateLimit(error)) {
      keepButtonDisabled = true;
      startLoginCooldown(button, 90);
    }
  } finally {
    if (button && !keepButtonDisabled) button.disabled = false;
  }
}

async function signInOrCreateAccount(email, password) {
  const login = await supabaseClient.auth.signInWithPassword({ email, password });
  if (!login.error) {
    licenseState.session = login.data?.session || null;
    if (!licenseState.session) throw new Error("Oturum açılamadı. Lütfen tekrar deneyin.");
    return;
  }

  if (!isMissingAccount(login.error)) {
    throw login.error;
  }

  const signup = await supabaseClient.auth.signUp({ email, password });
  if (signup.error) {
    if (isAlreadyRegistered(signup.error)) {
      throw new Error("Bu e-posta zaten kayıtlı. Lütfen bu hesabın mevcut şifresiyle giriş yapın.");
    }
    throw signup.error;
  }
  licenseState.session = signup.data?.session || null;
  if (!licenseState.session) {
    throw new Error("Hesap oluşturuldu ancak giriş açılamadı. E-posta onayı kapatıldıktan sonra aynı bilgilerle tekrar giriş yapın.");
  }
}

function isMissingAccount(error) {
  const message = [
    error?.message,
    error?.code,
    error?.status,
    error?.name
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  return message.includes("invalid login") ||
    message.includes("invalid credentials") ||
    message.includes("400") ||
    message.includes("email not confirmed");
}

function isAlreadyRegistered(error) {
  const message = [
    error?.message,
    error?.code,
    error?.status,
    error?.name
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  return message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("user already") ||
    message.includes("email already");
}

function getLicenseErrorMessage(error) {
  if (isEmailRateLimit(error)) {
    return "Çok fazla giriş e-postası istendi. Lütfen biraz bekleyip tekrar deneyin.";
  }
  const message = String(error?.message || error?.error_description || error?.msg || "").trim();
  const lower = message.toLowerCase();
  if (lower.includes("already registered") || lower.includes("already exists") || lower.includes("user already") || lower.includes("email already")) {
    return "Bu e-posta zaten kayıtlı. Lütfen bu hesabın mevcut şifresiyle giriş yapın.";
  }
  if (lower.includes("invalid login") || lower.includes("invalid credentials")) {
    return "E-posta veya şifre hatalı. Hesabınız yoksa aynı e-posta ile yeni şifre belirleyip tekrar deneyin.";
  }
  if (lower.includes("email not confirmed") || lower.includes("confirm")) {
    return "Bu e-posta için onay gerekiyor. E-posta onayı kapatıldıktan sonra aynı bilgilerle tekrar giriş yapın.";
  }
  if (message && !["()", "[]", "{}", "null", "undefined"].includes(message)) return message;
  return "İşlem tamamlanamadı. Lütfen bilgileri kontrol edip tekrar deneyin.";
}

function isUnauthorizedSessionError(error) {
  const message = String(error?.message || error?.error_description || error?.msg || "").toLowerCase();
  return message.includes("yetkisiz") ||
    message.includes("unauthorized") ||
    message.includes("jwt") ||
    message.includes("token");
}

async function signOutAndReset() {
  try {
    await supabaseClient?.auth.signOut();
  } finally {
    clearLocalLicenseState();
    licenseState.allowed = false;
    licenseState.checking = false;
    licenseState.deviceHash = "";
    licenseState.deviceSecret = "";
    licenseState.session = null;
    licenseState.status = "";
    licenseState.purchaseRequested = false;
    licenseState.lastCheckedAt = 0;
    updateLogoutButton();
    resetMap();
    setAppEnabled(false);
    showLicenseOverlay("login");
  }
}

function clearLocalLicenseState() {
  const prefixes = [
    "sc23_web_device_secret_",
    `sc23_purchase_requested_${LICENSE_CONFIG.product}_`
  ];
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      localStorage.removeItem(key);
    }
  }
}

function updateLogoutButton() {
  if (logoutButton) logoutButton.hidden = !licenseState.session;
}

function isEmailRateLimit(error) {
  const message = [
    error?.message,
    error?.error_description,
    error?.code,
    error?.status,
    error?.name
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  return message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many") ||
    message.includes("email rate") ||
    message.includes("over_email_send_rate_limit");
}

function getPurchaseRequestKey() {
  const email = licenseState.session?.user?.email || "anonymous";
  return `sc23_purchase_requested_${LICENSE_CONFIG.product}_${email.toLowerCase()}`;
}

function startLoginCooldown(button, seconds) {
  if (!button) return;
  let remaining = seconds;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = `Tekrar dene (${remaining})`;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.textContent = originalText;
      return;
    }
    button.textContent = `Tekrar dene (${remaining})`;
  }, 1000);
}

resetMap();
initLicense();
