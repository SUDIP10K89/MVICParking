# 🅿️ Parking Finder Website

A modern, responsive web application to help users find nearby parking areas using their current location or by searching for a specific place.

## Features

✨ **Core Features:**
- 📍 **Geolocation Support** - Get parking areas near your current location with one click
- 🔍 **Place Search** - Search for parking areas by entering any place name or address
- 🗺️ **Interactive Map** - View all parking locations on an interactive map using Leaflet
- 📋 **Detailed Listings** - See parking details including type, hourly rate, available spaces, and distance
- 📱 **Responsive Design** - Works perfectly on desktop, tablet, and mobile devices
- 🎯 **Click to Focus** - Click on parking items in the list to focus on that location on the map

## Technical Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Mapping:** Leaflet.js + OpenStreetMap tiles
- **APIs Supported:**
  - Mapbox API (Free - 250k requests/month, NO payment required)
  - HERE Maps API (Free tier - NO payment required)
  - Overpass API (Free - OpenStreetMap parking data)
  - Fallback Database (Always available)
- **Geolocation:** Browser Geolocation API
- **Place Search:** OpenStreetMap Nominatim API

## Getting Started

### Installation

1. **Download the files:**
   - `index.html` - Main HTML file
   - `styles.css` - Styling
   - `app.js` - JavaScript functionality

2. **Open in browser:**
   - Simply open `index.html` in your web browser
   - No server setup required (it's a client-side application)

### Usage

1. **Using Your Location:**
   - Click the "📍 Use My Location" button
   - Allow browser to access your location (you may be prompted)
   - The app will automatically find nearby parking areas
   - Parking locations will appear on the map and in the list below

2. **Search by Place:**
   - Enter a place name or address in the search box (e.g., "Times Square", "Central Park")
   - Click "Search" or press Enter
   - The app will search for the location and find nearby parking areas

3. **View Details:**
   - Click on any parking item in the list to focus on it on the map
   - Click on map markers to see detailed information about that parking area

## API Configuration

The app supports multiple parking data sources with intelligent fallback - **all free, NO payment required!**

### Option 1: Mapbox API (FREE - 250,000 requests/month)

1. Sign up at [Mapbox](https://account.mapbox.com/auth/signup) (free, no payment info needed)
2. Get your access token from account settings
3. Add to `app.js`:
   ```javascript
   MAPBOX_API_KEY: 'your_mapbox_token_here'
   ```

### Option 2: HERE Maps API (FREE - No payment required)

1. Sign up at [HERE Developer](https://developer.here.com/sign-up) (free, no payment info needed)
2. Create an API key
3. Add to `app.js`:
   ```javascript
   HERE_API_KEY: 'your_here_api_key_here'
   ```

### Option 3: Overpass API (FREE - Always included)

- No setup required
- Automatically used if Mapbox/HERE aren't configured
- Free OpenStreetMap parking data

## Data Sources Priority

The app intelligently selects the best source:

1. **Mapbox** (if configured)
2. **HERE Maps** (if configured)
3. **Overpass API** (always available, free)
4. **Fallback Database** (guaranteed availability)

This means you'll always get parking results, even if APIs are unavailable!

## Sample Parking Data

The app comes with pre-loaded sample parking data across multiple areas:
- Central Plaza Parking (Downtown)
- Market Street Garage (Downtown)
- Tower Plaza Parking (Midtown)
- Museum District Garage (Uptown)
- And more...

Each parking location includes:
- Name and address
- Parking type (Underground, Multi-level, Street, Open Air)
- Number of available spaces
- Hourly rate
- Distance from your location

## Customization

### Adding Real Data

To connect to real parking data:

1. **Replace sample data in `app.js`:**
   - Modify the `parkingData` array with your actual parking locations
   - Or fetch from a real parking API

2. **Example code to fetch from an API:**
   ```javascript
   fetch('https://your-api.com/parking')
       .then(response => response.json())
       .then(data => {
           parkingData = data;
           // Use the data
       });
   ```

### Styling

- Colors can be customized in `styles.css`
- Primary color: `#667eea`
- Secondary color: `#764ba2`
- Background: `#f5f5f5`

### Map Center

To change the default map center location, modify in `app.js`:
```javascript
map = L.map('map').setView([40.7128, -74.0060], 13);
// Change coordinates and zoom level as needed
```

## Features Explained

### Geolocation
- Uses browser's built-in Geolocation API
- Requires user permission to access location
- Updates map and finds nearby parking within 5 miles radius

### Search Functionality
- Uses OpenStreetMap Nominatim API (free, no API key required)
- Converts place names to coordinates
- Automatically searches for parking near the found location

### Distance Calculation
- Uses haversine formula for accurate distance calculation
- Shows distance in miles
- Automatically sorts parking by distance

### Responsive Design
- Mobile-first design approach
- Breakpoints for tablets and larger screens
- Touch-friendly buttons and interactions

## Browser Compatibility

- Chrome/Edge 60+
- Firefox 55+
- Safari 12+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Permissions

The app requires:
- **Location Permission** - To show your current location and find nearby parking
- **No other sensitive permissions needed**

## Troubleshooting

### No parking areas showing?
- Check your internet connection
- Ensure location services are enabled
- Try a different search area
- Check browser console (F12 > Console) for error messages

### "API Error" in console?
- **Google Places:** Verify API key is valid and has Places API enabled
- **Overpass:** May be overloaded; try again in a few moments
- **Both fail:** Fallback data will automatically display

### Limited parking results in your area?
- Results depend on API data coverage in your region
- Overpass API has less data than Google Places
- Configure Google Maps API for complete coverage
- Try expanding your search radius

### Map not loading?
- Check internet connection
- Clear browser cache (Ctrl+Shift+Delete)
- Try a different browser
- OpenStreetMap tiles should load automatically

## Limitations

- **Without API key:** Results depend on Overpass API data availability (free)
- **Google Places API cost:** Charged per request after free tier ($7/1000 requests)
- **Geolocation accuracy:** Varies by device and browser
- **Search relies on:** Place names being recognized by geocoding services
- **Real-time availability:** Would require integration with parking providers

These limitations can be minimized with proper API configuration!

## Future Enhancements

Potential features to add:
- Real-time parking availability updates
- Parking price comparison
- Reviews and ratings
- Reservations system
- Historical occupancy data
- EV charging station integration
- Multiple language support
- Offline mode

## License

This project is open source and available for personal and commercial use.

## Support

For issues or suggestions:
1. Check browser console for error messages (F12 > Console)
2. Ensure location services are enabled
3. Check internet connection for map and API functionality
4. Verify API keys are correctly configured in app.js
5. See Troubleshooting section above

---

**Created:** May 2026
**Last Updated:** May 2026
**Version:** 2.0 (Multi-API Support with Google Maps Places, Overpass API, and Intelligent Fallback)
