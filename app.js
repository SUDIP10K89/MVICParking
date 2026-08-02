const API_CONFIG = {
    API_BASE: 'http://127.0.0.1:5000',
    PARKING_AREAS_API: 'http://127.0.0.1:5000/api/parking-areas',
    CCTV_STATUS_API: 'http://127.0.0.1:5000/api/parking-status'
};

const DEFAULT_CENTER = [27.7172, 85.3240];
const tileOptions = {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
};

let userMap;
let adminMap;
let userMarker;
let selectedAdminPoint;
let selectedAdminMarker;
let userPortalLoaded = false;
let adminPortalLoaded = false;
let currentOrigin = null;
let currentLocations = [];
let savedAreas = [];
let cctvParkingAreas = [];
let userMarkers;
let adminMarkers;
let userMarkerByAreaId = new Map();
let adminMarkerByAreaId = new Map();
let userParkingDataVersion = null;
let adminParkingDataVersion = null;

const pinIcon = L.divIcon({
    className: '',
    iconSize: [31, 31],
    iconAnchor: [16, 31],
    html: '<div class="parking-marker"><b>P</b></div>'
});

const livePinIcon = L.divIcon({
    className: '',
    iconSize: [33, 33],
    iconAnchor: [17, 33],
    html: '<div class="parking-marker live-marker"><b>P</b></div>'
});

const userIcon = L.divIcon({
    className: '',
    iconSize: [17, 17],
    iconAnchor: [9, 9],
    html: '<div class="user-marker"></div>'
});

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
}

function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function metersToMiles(meters) {
    return meters / 1609.344;
}

function coordinateKey(value) {
    return Number(value).toFixed(6);
}

function distanceMeters(origin, lat, lng) {
    return Math.round(L.latLng(origin).distanceTo([lat, lng]));
}

function distanceLabel(meters) {
    return meters > 999 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function setStatus(message) {
    document.querySelector('#status').textContent = message;
}

function getName(item) {
    return item.name || 'Admin parking area';
}

function renderCctvPreview(cameraUrl) {
    if (!cameraUrl) {
        return '<p class="popup-muted">No CCTV URL configured.</p>';
    }

    const safeUrl = escapeHtml(cameraUrl);
    if (cameraUrl.toLowerCase().startsWith('rtsp://')) {
        return `
            <div class="cctv-fallback">
                <p>RTSP streams cannot be previewed directly in most browsers.</p>
                <a href="${safeUrl}" target="_blank" rel="noreferrer">Open CCTV stream</a>
            </div>
        `;
    }

    return `
        <div class="cctv-preview">
            <img src="${safeUrl}" alt="CCTV feed for this parking area" loading="lazy">
            <a href="${safeUrl}" target="_blank" rel="noreferrer">Open CCTV feed</a>
        </div>
    `;
}

function renderParkingPopup(area, liveStatus = null) {
    const totalSlots = Number(area.totalSlots ?? area.capacity ?? 0);
    const occupiedSlots = Number(area.occupiedSlots ?? area.occupied ?? 0);
    const availableSlots = liveStatus && !liveStatus.error
        ? Number(liveStatus.available)
        : Number(area.availableSlots ?? Math.max(0, totalSlots - occupiedSlots));
    const capacity = liveStatus && !liveStatus.error ? Number(liveStatus.capacity) : totalSlots;
    const occupied = liveStatus && !liveStatus.error ? Number(liveStatus.occupied) : occupiedSlots;
    const detectedAt = liveStatus?.lastUpdated || area.lastDetectedAt;

    return `
        <div class="parking-popup">
            <h3>${escapeHtml(getName(area))}</h3>
            <div class="popup-stat">
                <strong>${availableSlots}</strong>
                <span>available of ${capacity} slots</span>
            </div>
            <p><b>Occupied:</b> ${occupied}</p>
            <p><b>Latitude:</b> ${Number(area.lat).toFixed(6)}</p>
            <p><b>Longitude:</b> ${Number(area.lng ?? area.lon).toFixed(6)}</p>
            ${liveStatus?.error ? `<p class="popup-error"><b>CCTV status:</b> ${escapeHtml(liveStatus.error)}</p>` : ''}
            ${liveStatus && !liveStatus.error ? '<p class="popup-live">Live CCTV count active</p>' : ''}
            ${detectedAt ? `<p class="popup-muted">Updated: ${escapeHtml(new Date(detectedAt).toLocaleTimeString())}</p>` : ''}
            ${renderCctvPreview(area.cameraUrl || '')}
        </div>
    `;
}

function getAreaKey(area) {
    return String(area.id || `${normalizeName(getName(area))}-${coordinateKey(area.lat)}-${coordinateKey(area.lng ?? area.lon)}`);
}

function getPayloadAreas(payload) {
    return Array.isArray(payload.areas) ? payload.areas : [];
}

function areaDatasetSignature(areas) {
    return JSON.stringify(areas.map(area => ({
        id: getAreaKey(area),
        name: area.name || '',
        lat: Number(area.lat),
        lng: Number(area.lng ?? area.lon),
        cameraUrl: area.cameraUrl || '',
        totalSlots: Number(area.totalSlots ?? area.capacity ?? 0),
        occupiedSlots: Number(area.occupiedSlots ?? area.occupied ?? 0),
        createdAt: area.createdAt || '',
        updatedAt: area.updatedAt || ''
    })));
}

function getParkingDataVersion(payload) {
    const areas = getPayloadAreas(payload);
    return payload.dataVersion || payload.lastModified || areaDatasetSignature(areas);
}

function prepareSavedAreas(areas) {
    return areas.map(area => ({ ...area, lng: area.lng ?? area.lon, adminAdded: true, source: 'admin' }));
}

function buildUserLocations(areas) {
    return attachCctvAvailability(areas)
        .map(area => ({ ...area, meters: distanceMeters(currentOrigin, area.lat, area.lng ?? area.lon) }))
        .filter(area => area.meters <= 10000)
        .sort((a, b) => a.meters - b.meters);
}

function getAvailabilityText(area) {
    const liveStatus = area.cctvStatus;
    if (liveStatus && !liveStatus.error) {
        return `${liveStatus.available} free / ${liveStatus.capacity} live units`;
    }

    return `${area.availableSlots} free / ${area.totalSlots} slots`;
}

function updateAreaDom(area, scope) {
    const key = getAreaKey(area);
    const item = [...document.querySelectorAll(`[data-${scope}-area-id]`)]
        .find(element => element.dataset[`${scope}AreaId`] === key);
    if (!item) return;

    const availability = item.querySelector('[data-availability]');
    const sync = item.querySelector('[data-sync-status]');
    const detected = item.querySelector('[data-detected-at]');

    if (availability) {
        availability.textContent = `${scope === 'user' ? 'Admin-added - ' : ''}${getAvailabilityText(area)}`;
    }

    if (sync) {
        sync.textContent = area.cctvStatus && !area.cctvStatus.error ? 'Live backend sync' : '';
    }

    if (detected) {
        detected.textContent = area.lastDetectedAt ? `Detector updated ${new Date(area.lastDetectedAt).toLocaleTimeString()}` : '';
    }
}

function updateMarkerPopup(markerMap, area) {
    const marker = markerMap.get(getAreaKey(area));
    if (marker) {
        marker.setPopupContent(renderParkingPopup(area, area.cctvStatus));
    }
}

function initUserMap() {
    if (userMap) return;
    userMap = L.map('user-map', { zoomControl: false }).setView(DEFAULT_CENTER, 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', tileOptions).addTo(userMap);
    userMarkers = L.layerGroup().addTo(userMap);
}

function initAdminMap() {
    if (adminMap) return;
    adminMap = L.map('admin-map', { zoomControl: true }).setView(DEFAULT_CENTER, 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', tileOptions).addTo(adminMap);
    adminMarkers = L.layerGroup().addTo(adminMap);
    adminMap.on('click', event => selectAdminLocation(event.latlng.lat, event.latlng.lng));
}

async function fetchSavedAreas() {
    const url = `${API_CONFIG.PARKING_AREAS_API}?_=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Parking-area database is unavailable.');
    const payload = await response.json();
    return payload && typeof payload === 'object' ? payload : { areas: [] };
}

async function fetchCctvParkingAreas() {
    try {
        const response = await fetch(API_CONFIG.CCTV_STATUS_API);
        if (!response.ok) throw new Error(`CCTV API failed with status ${response.status}`);
        const data = await response.json();
        cctvParkingAreas = Array.isArray(data.areas) ? data.areas : [];
    } catch (error) {
        cctvParkingAreas = [];
    }
}

function findMatchingCctvArea(place) {
    const placeName = normalizeName(getName(place));

    return cctvParkingAreas.find(area => {
        const areaName = normalizeName(area.name);
        const nameMatch = placeName && areaName && placeName === areaName;
        const latMatch = coordinateKey(place.lat) === coordinateKey(area.lat);
        const lngMatch = coordinateKey(place.lng ?? place.lon) === coordinateKey(area.lng);

        return nameMatch && latMatch && lngMatch;
    });
}

function attachCctvAvailability(places) {
    return places.map(place => ({ ...place, cctvStatus: findMatchingCctvArea(place) || null }));
}

async function findParking(lat, lng) {
    initUserMap();
    currentOrigin = [Number(lat), Number(lng)];
    userMap.setView(currentOrigin, 15);
    userMarkers.clearLayers();
    document.querySelector('#parking-list').innerHTML = '<p class="empty-state">Loading admin-added parking areas...</p>';
    setStatus('Loading admin-added parking areas...');

    const [savedResult, cctvResult] = await Promise.allSettled([
        fetchSavedAreas(),
        fetchCctvParkingAreas()
    ]);

    const savedPayload = savedResult.status === 'fulfilled' ? savedResult.value : { areas: [] };
    const adminAreas = savedResult.status === 'fulfilled'
        ? prepareSavedAreas(getPayloadAreas(savedPayload))
        : [];

    userParkingDataVersion = getParkingDataVersion(savedPayload);
    savedAreas = adminAreas;
    currentLocations = buildUserLocations(adminAreas);

    renderParking(currentLocations);

    if (currentLocations.length) {
        setStatus(`${currentLocations.length} admin-added parking area${currentLocations.length === 1 ? '' : 's'} found near this location.`);
    } else if (savedResult.status === 'rejected') {
        setStatus('Parking-area API is unavailable. Start the Python backend.');
    } else if (cctvResult.status === 'rejected') {
        setStatus('No admin-added parking areas found nearby. CCTV status could not be checked.');
    } else {
        setStatus('No admin-added parking areas found nearby.');
    }
}

function renderParking(locations) {
    const list = document.querySelector('#parking-list');
    document.querySelector('#result-count').textContent = `${locations.length} spot${locations.length === 1 ? '' : 's'}`;
    userMarkers.clearLayers();
    userMarkerByAreaId = new Map();

    if (!locations.length) {
        list.innerHTML = '<p class="empty-state">No admin-added parking areas were found around this location.</p>';
        return;
    }

    const bounds = [];
    list.innerHTML = '';

    locations.forEach(spot => {
        const name = getName(spot);
        const lat = Number(spot.lat);
        const lng = Number(spot.lng ?? spot.lon);
        const label = distanceLabel(spot.meters);
        const liveStatus = spot.cctvStatus;
        const adminAvailability = spot.adminAdded ? `${spot.availableSlots} free / ${spot.totalSlots} slots` : null;
        const liveAvailability = liveStatus && !liveStatus.error ? `${liveStatus.available} free / ${liveStatus.capacity} live units` : null;
        const availability = liveAvailability || adminAvailability || 'Admin-added parking area';
        const markerIcon = liveStatus || spot.adminAdded ? livePinIcon : pinIcon;
        const areaKey = getAreaKey(spot);
        const marker = L.marker([lat, lng], { icon: markerIcon })
            .bindPopup(renderParkingPopup(spot, liveStatus), { maxWidth: 330 })
            .addTo(userMarkers);
        userMarkerByAreaId.set(areaKey, marker);

        bounds.push([lat, lng]);

        const item = document.createElement('button');
        item.className = 'parking-item';
        item.type = 'button';
        item.dataset.userAreaId = areaKey;
        item.innerHTML = `
            <span class="parking-icon">P</span>
            <span>
                <span class="parking-name">${escapeHtml(name)}</span>
                <span class="parking-meta" data-availability>${spot.adminAdded ? 'Admin-added - ' : ''}${escapeHtml(availability)}</span>
                ${liveStatus?.error ? `<span class="parking-meta error-text">CCTV unavailable: ${escapeHtml(liveStatus.error)}</span>` : ''}
            </span>
            <span class="parking-distance">${label}</span>
        `;
        item.addEventListener('click', () => {
            userMap.setView([lat, lng], 17);
            marker.openPopup();
        });
        list.appendChild(item);
    });

    if (bounds.length) {
        userMap.fitBounds(bounds, { padding: [38, 38], maxZoom: 16 });
    }
}

async function refreshUserAvailability() {
    if (!currentOrigin || document.querySelector('#user-portal').classList.contains('hidden')) return;

    try {
        await fetchCctvParkingAreas();
        const freshPayload = await fetchSavedAreas();
        const freshVersion = getParkingDataVersion(freshPayload);
        const freshAreas = prepareSavedAreas(getPayloadAreas(freshPayload));

        if (freshVersion !== userParkingDataVersion) {
            userParkingDataVersion = freshVersion;
            savedAreas = freshAreas;
            currentLocations = buildUserLocations(freshAreas);
            renderParking(currentLocations);
            setStatus(currentLocations.length
                ? `${currentLocations.length} admin-added parking area${currentLocations.length === 1 ? '' : 's'} found near this location.`
                : 'No admin-added parking areas found nearby.');
            return;
        }

        const byId = new Map(freshAreas.map(area => [getAreaKey(area), area]));
        currentLocations = attachCctvAvailability(currentLocations.map(spot => {
            const areaKey = getAreaKey(spot);
            if (!spot.adminAdded || !byId.has(areaKey)) return spot;
            return byId.get(areaKey);
        })).map(area => ({ ...area, meters: distanceMeters(currentOrigin, area.lat, area.lng ?? area.lon) }));
        currentLocations.forEach(area => {
            updateAreaDom(area, 'user');
            updateMarkerPopup(userMarkerByAreaId, area);
        });
    } catch {
        // Keep the last rendered data if the local API is briefly unavailable.
    }
}

async function geocode(term) {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({
        format: 'jsonv2',
        limit: '1',
        q: term
    })}`);
    const places = await response.json();
    if (!places.length) throw new Error('Location not found.');
    return places[0];
}

function setUserLocation(lat, lng) {
    initUserMap();
    const pos = [Number(lat), Number(lng)];
    if (userMarker) userMarker.remove();
    userMarker = L.marker(pos, { icon: userIcon }).addTo(userMap).bindPopup('Your current location');
    userMap.setView(pos, 15);
    findParking(pos[0], pos[1]);
}

function selectAdminLocation(lat, lng, label) {
    initAdminMap();
    selectedAdminPoint = L.latLng(Number(lat), Number(lng));
    if (selectedAdminMarker) selectedAdminMarker.remove();
    selectedAdminMarker = L.marker(selectedAdminPoint, { icon: livePinIcon }).addTo(adminMap);
    adminMap.setView(selectedAdminPoint, 16);
    document.querySelector('#selected-location').textContent = label || `${selectedAdminPoint.lat.toFixed(5)}, ${selectedAdminPoint.lng.toFixed(5)}`;
    document.querySelector('#save-area').disabled = false;
}

function renderSavedAreas(areas) {
    const saved = document.querySelector('#saved-areas');
    document.querySelector('#saved-count').textContent = `${areas.length} area${areas.length === 1 ? '' : 's'}`;
    adminMarkers.clearLayers();
    adminMarkerByAreaId = new Map();

    if (!areas.length) {
        saved.innerHTML = '<p class="empty-state">No areas saved yet.</p>';
        return;
    }

    saved.innerHTML = '';
    areas.forEach(area => {
        const lat = Number(area.lat);
        const lng = Number(area.lng ?? area.lon);
        const liveStatus = area.cctvStatus;
        const liveAvailability = liveStatus && !liveStatus.error ? `${liveStatus.available} free / ${liveStatus.capacity} live units` : null;
        const adminAvailability = `${area.availableSlots} free / ${area.totalSlots} slots`;
        const areaKey = getAreaKey(area);
        const marker = L.marker([lat, lng], { icon: livePinIcon })
            .bindPopup(renderParkingPopup(area, liveStatus), { maxWidth: 330 })
            .addTo(adminMarkers);
        adminMarkerByAreaId.set(areaKey, marker);

        const item = document.createElement('button');
        item.className = 'parking-item';
        item.type = 'button';
        item.dataset.adminAreaId = areaKey;
        item.innerHTML = `
            <span class="parking-icon">P</span>
            <span>
                <span class="parking-name">${escapeHtml(area.name)}</span>
                <span class="parking-meta" data-availability>${escapeHtml(liveAvailability || adminAvailability)}</span>
                <span class="parking-meta" data-sync-status>${liveStatus && !liveStatus.error ? 'Live backend sync' : ''}</span>
                <span class="parking-meta" data-detected-at>${area.lastDetectedAt ? `Detector updated ${escapeHtml(new Date(area.lastDetectedAt).toLocaleTimeString())}` : ''}</span>
            </span>
        `;
        item.addEventListener('click', () => {
            adminMap.setView([lat, lng], 17);
            marker.openPopup();
        });
        saved.appendChild(item);
    });
}

async function loadAdminAreas() {
    initAdminMap();
    try {
        await fetchCctvParkingAreas();
        const savedPayload = await fetchSavedAreas();
        adminParkingDataVersion = getParkingDataVersion(savedPayload);
        savedAreas = attachCctvAvailability(prepareSavedAreas(getPayloadAreas(savedPayload)));
        renderSavedAreas(savedAreas);
    } catch {
        document.querySelector('#saved-areas').innerHTML = '<p class="empty-state">Parking-area API unavailable. Start the Python backend.</p>';
    }
}

async function refreshAdminAvailability() {
    if (document.querySelector('#admin-portal').classList.contains('hidden')) return;

    try {
        await fetchCctvParkingAreas();
        const savedPayload = await fetchSavedAreas();
        const freshVersion = getParkingDataVersion(savedPayload);
        savedAreas = attachCctvAvailability(prepareSavedAreas(getPayloadAreas(savedPayload)));

        if (freshVersion !== adminParkingDataVersion) {
            adminParkingDataVersion = freshVersion;
            renderSavedAreas(savedAreas);
            return;
        }

        savedAreas.forEach(area => {
            updateAreaDom(area, 'admin');
            updateMarkerPopup(adminMarkerByAreaId, area);
        });
    } catch {
        // Keep the last rendered admin data if the local API is briefly unavailable.
    }
}

function updateAvailableSlots() {
    const total = Number(document.querySelector('#total-slots').value);
    const occupied = Number(document.querySelector('#occupied-slots').value);
    const valid = Number.isInteger(total) && Number.isInteger(occupied) && total >= 0 && occupied >= 0;
    document.querySelector('#available-slots').textContent = valid
        ? `Available slots: ${Math.max(0, total - occupied)}`
        : 'Available slots: -';
}

function clearAdminForm() {
    document.querySelector('#area-name').value = '';
    document.querySelector('#admin-address').value = '';
    document.querySelector('#camera-url').value = '';
    document.querySelector('#total-slots').value = '';
    document.querySelector('#occupied-slots').value = '';
    document.querySelector('#available-slots').textContent = 'Available slots: -';
    document.querySelector('#selected-location').textContent = 'Enter a location or select a point on the map';
    document.querySelector('#save-area').disabled = true;
    selectedAdminPoint = null;
    if (selectedAdminMarker) {
        selectedAdminMarker.remove();
        selectedAdminMarker = null;
    }
}

document.querySelectorAll('.role-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.role-tab').forEach(item => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
    });

    const admin = tab.dataset.role === 'admin';
    document.querySelector('#auth-title').textContent = admin ? 'Sign in to manage parking' : 'Sign in to find parking';
    document.querySelector('#sign-in-button').innerHTML = `Sign in as ${admin ? 'admin' : 'user'} <span>+</span>`;
}));

document.querySelector('#sign-in-form').addEventListener('submit', event => {
    event.preventDefault();
    const role = document.querySelector('.role-tab.active').dataset.role;
    document.querySelector('#auth-screen').classList.add('hidden');
    document.querySelector(`#${role}-portal`).classList.remove('hidden');

    setTimeout(() => {
        if (role === 'user') {
            initUserMap();
            userMap.invalidateSize();
            if (!userPortalLoaded) {
                userPortalLoaded = true;
                findParking(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);
            }
        } else {
            initAdminMap();
            adminMap.invalidateSize();
            if (!adminPortalLoaded) {
                adminPortalLoaded = true;
                loadAdminAreas();
            }
        }
    }, 50);
});

document.querySelectorAll('[data-sign-out]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.portal').forEach(portal => portal.classList.add('hidden'));
    document.querySelector('#auth-screen').classList.remove('hidden');
}));

document.querySelector('#search-form').addEventListener('submit', async event => {
    event.preventDefault();
    const term = document.querySelector('#address').value.trim();
    if (!term) return document.querySelector('#address').focus();

    setStatus('Locating your destination...');
    try {
        const place = await geocode(term);
        findParking(place.lat, place.lon);
    } catch {
        setStatus('We could not find that address. Try a more specific place name.');
    }
});

document.querySelector('#location-button').addEventListener('click', () => {
    if (!navigator.geolocation) {
        setStatus('Your browser does not support location services.');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        ({ coords }) => setUserLocation(coords.latitude, coords.longitude),
        () => setStatus('We could not access your location. Check browser permissions.'),
        { enableHighAccuracy: true, timeout: 10000 }
    );
});

document.querySelector('#zoom-in').addEventListener('click', () => userMap?.zoomIn());
document.querySelector('#zoom-out').addEventListener('click', () => userMap?.zoomOut());

document.querySelector('#locate-area').addEventListener('click', async () => {
    const term = document.querySelector('#admin-address').value.trim();
    if (!term) return document.querySelector('#admin-address').focus();

    const button = document.querySelector('#locate-area');
    button.disabled = true;
    button.textContent = 'Finding';

    try {
        const place = await geocode(term);
        selectAdminLocation(place.lat, place.lon, place.display_name.split(',').slice(0, 2).join(','));
    } catch {
        document.querySelector('#selected-location').textContent = 'Location not found. Try a more specific address.';
    } finally {
        button.disabled = false;
        button.textContent = 'Locate';
    }
});

document.querySelector('#admin-current-location').addEventListener('click', () => {
    const locationStatus = document.querySelector('#selected-location');
    if (!navigator.geolocation) {
        locationStatus.textContent = 'Your browser does not support location services.';
        return;
    }

    locationStatus.textContent = 'Requesting your current location...';
    navigator.geolocation.getCurrentPosition(
        ({ coords }) => selectAdminLocation(coords.latitude, coords.longitude, 'Your current location'),
        () => { locationStatus.textContent = 'We could not access your location. Check browser permissions.'; },
        { enableHighAccuracy: true, timeout: 10000 }
    );
});

document.querySelector('#save-area').addEventListener('click', async () => {
    if (!selectedAdminPoint) return;

    const totalSlots = Number(document.querySelector('#total-slots').value);
    const occupiedSlots = Number(document.querySelector('#occupied-slots').value);
    if (!Number.isInteger(totalSlots) || totalSlots < 1 || !Number.isInteger(occupiedSlots) || occupiedSlots < 0 || occupiedSlots > totalSlots) {
        document.querySelector('#available-slots').textContent = 'Enter valid slot counts.';
        return;
    }

    const button = document.querySelector('#save-area');
    button.disabled = true;
    button.firstChild.textContent = 'Saving parking area ';

    try {
        const body = {
            name: document.querySelector('#area-name').value.trim() || `Parking area ${savedAreas.length + 1}`,
            lat: selectedAdminPoint.lat,
            lng: selectedAdminPoint.lng,
            cameraUrl: document.querySelector('#camera-url').value.trim(),
            totalSlots,
            occupiedSlots
        };

        const response = await fetch(API_CONFIG.PARKING_AREAS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not save parking area.');

        savedAreas.unshift(payload);
        renderSavedAreas(savedAreas);
        clearAdminForm();
    } catch (error) {
        document.querySelector('#selected-location').textContent = error.message || 'Could not save. Check the backend.';
        button.disabled = false;
    } finally {
        button.firstChild.textContent = 'Save parking area ';
    }
});

document.querySelector('#total-slots').addEventListener('input', updateAvailableSlots);
document.querySelector('#occupied-slots').addEventListener('input', updateAvailableSlots);

window.setInterval(() => {
    refreshUserAvailability();
    refreshAdminAvailability();
}, 3000);
