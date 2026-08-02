// Configuration - Using OpenStreetMap only (NO payment required, NO mock data!)
const API_CONFIG = {
    USE_OVERPASS: true,
    USE_FALLBACK: false,  // Disabled - only real data from OpenStreetMap
    CCTV_STATUS_API: 'http://127.0.0.1:5000/api/parking-status'
};

// Real parking data will be fetched from OpenStreetMap only
let parkingData = [];

let map;
let userMarker;
let parkingMarkers = [];
let currentParkingData = [];
let cctvParkingAreas = [];

function normalizeName(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function metersToMiles(meters) {
    return meters / 1609.344;
}

async function fetchCctvParkingAreas() {
    try {
        const response = await fetch(API_CONFIG.CCTV_STATUS_API);

        if (!response.ok) {
            throw new Error(`CCTV API failed with status ${response.status}`);
        }

        const data = await response.json();
        cctvParkingAreas = Array.isArray(data.areas) ? data.areas : [];
    } catch (error) {
        console.warn('Could not fetch CCTV parking status:', error.message);
        cctvParkingAreas = [];
    }
}

function findMatchingCctvArea(place) {
    const placeName = normalizeName(place.name);

    return cctvParkingAreas.find(area => {
        const areaName = normalizeName(area.name);
        const radiusMiles = metersToMiles(area.matchRadiusMeters || 200);
        const distanceMiles = calculateDistance(place.lat, place.lng, area.lat, area.lng);
        const coordinateMatch = distanceMiles <= radiusMiles;
        const nameMatch = placeName && areaName && (
            placeName.includes(areaName) ||
            areaName.includes(placeName)
        );

        return coordinateMatch || nameMatch;
    });
}

function attachCctvAvailability(places) {
    return places.map(place => {
        const matchingArea = findMatchingCctvArea(place);

        if (!matchingArea) {
            return {
                ...place,
                cctvStatus: null
            };
        }

        return {
            ...place,
            cctvStatus: matchingArea
        };
    });
}

function renderAvailability(status) {
    if (!status) {
        return '<p><strong>Live Parking:</strong> No live CCTV data</p>';
    }

    if (status.error) {
        return `<p><strong>Live Parking:</strong> Unavailable (${escapeHtml(status.error)})</p>`;
    }

    return `
        <p><strong>Live Parking:</strong> ${status.available} / ${status.capacity} units available</p>
        <p><strong>Occupied:</strong> ${status.occupied} units</p>
    `;
}

// Fetch parking data from multiple sources
async function fetchParkingData(lat, lng, radius = 1.5) {
    let parkingLocations = [];
    
    // Try Overpass API (free, no payment required)
    if (API_CONFIG.USE_OVERPASS) {
        const overpassResults = await fetchFromOverpass(lat, lng, radius);
        if (overpassResults.length >= 3) {
            return overpassResults;
        }
        parkingLocations = overpassResults;
    }
    
    // If we have good results, return them
    if (parkingLocations.length >= 3) {
        return parkingLocations.slice(0, 20);
    }
    
    // Fall back to fallback data
    if (API_CONFIG.USE_FALLBACK) {
        console.log('Using fallback parking data...');
        return generateFallbackParking(lat, lng);
    }
    
    return parkingLocations;
}

// Helper function to get parking type from name/title
function getParkingTypeFromName(name) {
    const nameLower = name.toLowerCase();
    
    if (nameLower.includes('underground') || nameLower.includes('underground parking')) return 'Underground';
    if (nameLower.includes('garage') || nameLower.includes('multi')) return 'Multi-level';
    if (nameLower.includes('surface') || nameLower.includes('open')) return 'Open Air';
    if (nameLower.includes('street')) return 'Street';
    if (nameLower.includes('valet')) return 'Valet';
    if (nameLower.includes('lot')) return 'Parking Lot';
    
    return 'Parking Area';
}

// Old function - kept for backward compatibility
function getParkingType(tags) {
    if (tags.parking === 'underground') return 'Underground';
    if (tags.parking === 'surface') return 'Open Air';
    if (tags.parking === 'street_parking') return 'Street';
    if (tags.parking === 'multi-storey') return 'Multi-level';
    return 'Parking Lot';
}

// Fetch parking data from Overpass API (FREE - no payment required!)
async function fetchFromOverpass(lat, lng, radius = 5) {
    try {
        // Convert radius from miles to kilometers to degrees (1 degree ≈ 111 km)
        const radiusKm = radius * 1.60934; // miles to km
        const radiusDegrees = radiusKm / 111;
        
        console.log(`Fetching from Overpass: radius=${radius} miles = ${radiusDegrees.toFixed(4)} degrees`);
        
                // Query for malls, hospitals, restaurants, supermarkets, and cinemas.
        const overpassQuery = `[out:json];
(
  node["shop"="mall"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
  way["shop"="mall"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
  
  node["amenity"="hospital"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
  way["amenity"="hospital"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});

    node["amenity"="restaurant"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
    way["amenity"="restaurant"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});

    node["shop"="supermarket"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
    way["shop"="supermarket"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});

    node["amenity"="cinema"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
    way["amenity"="cinema"](${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees});
);
out center;`;
        
        const url = 'https://overpass-api.de/api/interpreter';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            method: 'POST',
            body: overpassQuery,
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        if (!response.ok) throw new Error('API request failed');
        
        const data = await response.json();
        console.log('Overpass API response:', data);
        
        if (!data.elements) {
            console.log('No elements returned from Overpass API');
            return [];
        }
        
        const parkingLocations = [];
        let id = 1;
        
        data.elements.forEach(element => {
            let elemLat = element.lat || (element.center && element.center.lat);
            let elemLng = element.lon || (element.center && element.center.lon);
            
            if (elemLat && elemLng) {
                const name = element.tags.name || getDefaultName(element.tags);
                const parkingType = getParkingTypeFromTags(element.tags);
                const amenityType = getAmenityType(element.tags);
                
                console.log(`Found: ${name} (${amenityType}) - Type: ${parkingType}`);
                
                parkingLocations.push({
                    id: id++,
                    name: name,
                    lat: elemLat,
                    lng: elemLng,
                    type: parkingType,
                    amenity: amenityType,
                    address: element.tags['addr:street'] || amenityType,
                    distance: 0,
                    source: 'osm'
                });
            }
        });
        
        console.log(`Total locations found: ${parkingLocations.length}`);
        return parkingLocations;
        
    } catch (error) {
        console.error('Overpass API error:', error.message);
        console.error('Full error:', error);
        return [];
    }
}

// Get parking type from OSM tags
function getParkingTypeFromTags(tags) {
    if (tags.shop === 'mall') return 'Shopping Mall';
    if (tags.amenity === 'hospital') return 'Hospital';
    if (tags.amenity === 'restaurant') return 'Restaurant';
    if (tags.shop === 'supermarket') return 'Supermarket';
    if (tags.amenity === 'cinema') return 'Cinema Hall';
    
    return 'Parking Area';
}

// Get amenity type name
function getAmenityType(tags) {
    if (tags.shop === 'mall') return 'Shopping Mall';
    if (tags.amenity === 'hospital') return 'Hospital';
    if (tags.amenity === 'restaurant') return 'Restaurant';
    if (tags.shop === 'supermarket') return 'Supermarket';
    if (tags.amenity === 'cinema') return 'Cinema Hall';
    
    return 'Parking Area';
}

// Get default name if not available
function getDefaultName(tags) {
    const amenity = tags.amenity || tags.shop || tags.building || '';
    return `${amenity.charAt(0).toUpperCase() + amenity.slice(1)} Area`;
}

// Generate fallback parking data - DISABLED (using real data only)
function generateFallbackParking(centerLat, centerLng) {
    return []; // No mock data - only real OpenStreetMap data is used
}

// Determine parking type from tags
function getParkingType(tags) {
    if (tags.parking === 'underground') return 'Underground';
    if (tags.parking === 'surface') return 'Open Air';
    if (tags.parking === 'street_parking') return 'Street';
    if (tags.parking === 'multi-storey') return 'Multi-level';
    if (tags.parking === 'garage') return 'Garage';
    if (tags.amenity === 'parking_entrance') return 'Parking Entrance';
    return 'Parking Lot';
}

// Generate random available spaces (in real app, would come from API)
function generateRandomSpaces() {
    return Math.floor(Math.random() * 450) + 50;
}

// Generate random hourly rate based on parking type
function generateRandomRate(type) {
    const rates = {
        'Underground': Math.random() * 2 + 4,
        'Multi-level': Math.random() * 2 + 3,
        'Garage': Math.random() * 2 + 3.5,
        'Street': Math.random() * 1 + 1,
        'Open Air': Math.random() * 1.5 + 1.5,
        'default': Math.random() * 2 + 2
    };
    return parseFloat((rates[type] || rates['default']).toFixed(2));
}

// Initialize map
function initMap() {
    map = L.map('map').setView([40.7128, -74.0060], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // Ensure Leaflet calculates tile positions after layout settles.
    setTimeout(() => map.invalidateSize(), 0);
    window.addEventListener('resize', () => map.invalidateSize());

    // Try to get user location
    getUserLocation();
}

// Get user's location
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setUserLocation(latitude, longitude);
                findNearbyParking(latitude, longitude);
            },
            (error) => {
                console.log('Geolocation error:', error);
                document.getElementById('locationInfo').textContent = 'Location access denied. Using default location.';
            }
        );
    }
}

// Set user location on map
function setUserLocation(lat, lng) {
    map.setView([lat, lng], 15);
    
    if (userMarker) {
        map.removeLayer(userMarker);
    }
    
    userMarker = L.marker([lat, lng], {
        icon: L.icon({
            iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDEwMCAxMDAiPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQ4IiBmaWxsPSIjNDI4NWY0Ii8+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDUiIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzQyODVmNCIgc3Ryb2tlLXdpZHRoPSIyIi8+PHBhdGggZD0iTTMwIDQwIEw1MCAxNSBMNzAgNDAgWiIgZmlsbD0iIzQyODVmNCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjEyIiBmaWxsPSIjNDI4NWY0Ii8+PC9zdmc+',
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -40]
        })
    }).addTo(map).bindPopup('Your current location');
    
    document.getElementById('locationInfo').textContent = `Latitude: ${lat.toFixed(4)}, Longitude: ${lng.toFixed(4)}`;
}

// Find nearby parking
async function findNearbyParking(lat, lng, radius = 5) {
    console.log(`Searching for parking near ${lat}, ${lng} within ${radius} miles...`);
    clearMarkers();
    document.getElementById('parkingList').innerHTML = '<p class="loading">Finding nearby places...</p>';
    await fetchCctvParkingAreas();
    
    // Fetch real parking data from Overpass API
    let fetchedParking = await fetchParkingData(lat, lng, radius);
    console.log(`Fetched ${fetchedParking.length} locations from API with ${radius} mile radius`);
    
    // If no results, try with larger radius
    if (fetchedParking.length === 0 && radius < 20) {
        console.log('No results with initial radius, trying with 10 mile radius...');
        fetchedParking = await fetchParkingData(lat, lng, 10);
        console.log(`Fetched ${fetchedParking.length} locations with 10 mile radius`);
    }
    
    // If still no results, try with even larger radius
    if (fetchedParking.length === 0 && radius < 20) {
        console.log('Still no results, trying with 15 mile radius...');
        fetchedParking = await fetchParkingData(lat, lng, 15);
        console.log(`Fetched ${fetchedParking.length} locations with 15 mile radius`);
    }
    
    // Calculate distances and filter by radius
    currentParkingData = fetchedParking.map(parking => {
        parking.distance = calculateDistance(lat, lng, parking.lat, parking.lng);
        return parking;
    }).filter(parking => parking.distance <= 20); // Show within 20 miles
    currentParkingData = attachCctvAvailability(currentParkingData);
    
    console.log(`Filtered to ${currentParkingData.length} locations within range`);
    
    currentParkingData.sort((a, b) => a.distance - b.distance);
    
    currentParkingData.forEach(parking => {
        addMarkerToMap(parking);
    });
    
    displayParkingList(currentParkingData);
    document.getElementById('parkingCount').textContent = `Places found: ${currentParkingData.length}`;
}

// Calculate distance between two coordinates (haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Add marker to map
function addMarkerToMap(parking) {
    const icon = L.icon({
        iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDEwMCAxMDAiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0iZ3JhZCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+PHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzY2N2VlYTtzdG9wLW9wYWNpdHk6MSIgLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiM3NjRiYTI7c3RvcC1vcGFjaXR5OjEiIC8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDgiIGZpbGw9InVybCgjZ3JhZCkiLz48cGF0aCBkPSJNMjAgNTAgQTMwIDMwIDAgMCAxIDgwIDUwIEw4MCA2MCBRODAgNzAgNzAgODAgTDMwIDgwIFEyMCA3MCAyMCA2MCBaIiBmaWxsPSIjZmZmIiBzdHJva2U9IiM2NjdlZWEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjM1IiBjeT0iNzAiIHI9IjciIGZpbGw9IiM2NjdlZWEiLz48Y2lyY2xlIGN4PSI2NSIgY3k9IjcwIiByPSI3IiBmaWxsPSIjNjY3ZWVhIi8+PHJlY3QgeD0iMzAiIHk9IjMwIiB3aWR0aD0iNDAiIGhlaWdodD0iMjAiIGZpbGw9IiM2NjdlZWEiIG9wYWNpdHk9IjAuNiIgcng9IjMiLz48cmVjdCB4PSI0MCIgeT0iMjUiIHdpZHRoPSIyMCIgaGVpZ2h0PSIxNSIgZmlsbD0iI2ZmZiIgb3BhY2l0eT0iMC40IiByeD0iMiIvPjwvc3ZnPg==',
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
    });
    
    const marker = L.marker([parking.lat, parking.lng], { icon }).addTo(map);
    
    const popupContent = `
        <div style="width: 280px;">
            <h4 style="margin: 0 0 10px 0; color: #667eea;">${escapeHtml(parking.name)}</h4>
            <p><strong>Type:</strong> ${escapeHtml(parking.amenity || parking.type)}</p>
            <p><strong>Category:</strong> ${escapeHtml(parking.type)}</p>
            <p><strong>Address:</strong> ${escapeHtml(parking.address)}</p>
            <p><strong>Latitude:</strong> ${parking.lat.toFixed(6)}</p>
            <p><strong>Longitude:</strong> ${parking.lng.toFixed(6)}</p>
            <p><strong>Distance:</strong> ${parking.distance.toFixed(2)} miles</p>
            ${renderAvailability(parking.cctvStatus)}
        </div>
    `;
    
    marker.bindPopup(popupContent);
    parkingMarkers.push(marker);
}

// Clear all markers
function clearMarkers() {
    parkingMarkers.forEach(marker => map.removeLayer(marker));
    parkingMarkers = [];
}

// Display parking list
function displayParkingList(parkings) {
    const listContainer = document.getElementById('parkingList');
    
    if (parkings.length === 0) {
        listContainer.innerHTML = `
            <div class="placeholder">
                <p><strong>No parking areas found nearby.</strong></p>
                <p>This could mean:</p>
                <ul>
                    <li>You're in a rural area with limited amenities</li>
                    <li>OpenStreetMap data is sparse in your location</li>
                    <li>The Overpass API server is temporarily busy</li>
                </ul>
                <p>Try:</p>
                <ul>
                    <li>Searching for a different city/location</li>
                    <li>Trying again in a few moments</li>
                    <li>Zooming out on the map to see a wider area</li>
                </ul>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = parkings.map(parking => `
        <div class="parking-item" onclick="focusMarker(${parking.lat}, ${parking.lng})">
            <h3>${escapeHtml(parking.name)}</h3>
            <p><strong>Location Type:</strong> ${escapeHtml(parking.amenity || parking.type)}</p>
            <p><strong>Category:</strong> <span class="type">${escapeHtml(parking.type)}</span></p>
            <p><strong>Latitude:</strong> ${parking.lat.toFixed(6)}</p>
            <p><strong>Longitude:</strong> ${parking.lng.toFixed(6)}</p>
            <div class="${parking.cctvStatus ? 'availability live' : 'availability unavailable'}">
                ${parking.cctvStatus
                    ? `Live parking: ${parking.cctvStatus.available} / ${parking.cctvStatus.capacity} units available`
                    : 'No live CCTV parking data'}
            </div>
            <p class="distance">Distance: ${parking.distance.toFixed(2)} miles</p>
        </div>
    `).join('');
}

// Focus on marker when clicked from list
function focusMarker(lat, lng) {
    map.setView([lat, lng], 16);
}

// Search by place name
function searchByPlace() {
    const searchInput = document.getElementById('searchInput').value.trim();
    
    if (!searchInput) {
        alert('Please enter a place name');
        return;
    }
    
    // Using OpenStreetMap Nominatim API
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchInput)}&format=json&limit=1`;
    
    document.getElementById('parkingList').innerHTML = '<p class="loading">Searching...</p>';
    
    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data && data.length > 0) {
                const result = data[0];
                const lat = parseFloat(result.lat);
                const lng = parseFloat(result.lon);
                
                console.log(`Found location: ${result.display_name} at ${lat}, ${lng}`);
                
                setUserLocation(lat, lng);
                findNearbyParking(lat, lng, 10); // Start with 10 mile radius for searches
                document.getElementById('locationInfo').textContent = `Searched location: ${result.display_name}`;
            } else {
                alert('Location not found. Please try another search.');
                document.getElementById('parkingList').innerHTML = '<p class="placeholder">No results found for your search. Try a different location name.</p>';
            }
        })
        .catch(error => {
            console.error('Search error:', error);
            alert('Error searching location. Please try again.');
            document.getElementById('parkingList').innerHTML = '<p class="placeholder">Error during search. Please try again.</p>';
        });
}

// Event listeners
document.getElementById('searchBtn').addEventListener('click', searchByPlace);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchByPlace();
});

document.getElementById('locationBtn').addEventListener('click', getUserLocation);

// Initialize on load
window.addEventListener('load', initMap);
