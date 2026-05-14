import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken = 'pk.eyJ1IjoibTFwZXRlcnNlbiIsImEiOiJjbXA0ZmcyMXYwMGNsMnBwcmQ3dm9pMG9vIn0.UovOd1-8eD4-Sp1lLq55WA';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); 
  return date.toLocaleString('en-US', { timeStyle: 'short' }); 
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); 
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), 
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), 
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    let clonedStation = { ...station }; 
    let id = clonedStation.short_name;
    clonedStation.arrivals = arrivals.get(id) ?? 0;
    clonedStation.departures = departures.get(id) ?? 0;
    clonedStation.totalTraffic = clonedStation.arrivals + clonedStation.departures;
    return clonedStation;
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/master/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  
  const bikeLaneStyle = {
    'line-color': '#32D400',  
    'line-width': 5,          
    'line-opacity': 0.6       
  };
  
  map.addLayer({ id: 'boston-bike-lanes', type: 'line', source: 'boston_route', paint: bikeLaneStyle });
  map.addLayer({ id: 'cambridge-bike-lanes', type: 'line', source: 'cambridge_route', paint: bikeLaneStyle });

  const svg = d3.select('#map').select('svg');
  let stations = [];

  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    stations = jsonData.data.stations;

    const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
    await d3.csv(trafficUrl, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      
      let startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);
      
      let endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    });

  } catch (error) {
    console.error('Error loading JSON or CSV:', error); 
  }

  stations = computeStationTraffic(stations);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) 
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic)) 
    .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic)) 
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx) 
      .attr('cy', (d) => getCoords(d).cy); 
  }
  
  updatePositions();
  map.on('move', updatePositions); 
  map.on('zoom', updatePositions); 
  map.on('resize', updatePositions); 
  map.on('moveend', updatePositions); 

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);
    
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
  
    circles
      .data(filteredStations, (d) => d.short_name) 
      .join('circle') 
      .attr('r', (d) => radiusScale(d.totalTraffic)) 
      .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic))
      .each(function (d) {
        d3.select(this).select('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value); 
  
    if (timeFilter === -1) {
      selectedTime.textContent = ''; 
      anyTimeLabel.style.display = 'block'; 
    } else {
      selectedTime.textContent = formatTime(timeFilter); 
      anyTimeLabel.style.display = 'none'; 
    }
  
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});