/**
 * Test script for aisstream.io WebSocket API
 *
 * Usage: node scripts/test-aisstream.cjs
 *
 * Requires: npm install ws
 */

const WebSocket = require('ws');

// Configuration
const API_KEY = 'dd665519be6d615d98db70a71f8dbde7dcd4e7c5';
const TEST_MMSI = '368236870';
const TIMEOUT_SECONDS = 20;

// Bounding box around Antigua/Caribbean (where your AIS data is from)
// Format: [[lat_min, lon_min], [lat_max, lon_max]]
const ANTIGUA_BBOX = [[[16.5, -62.5], [18.0, -61.0]]];

console.log('='.repeat(50));
console.log('AISStream.io WebSocket Test');
console.log('='.repeat(50));
console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
console.log(`Test MMSI: ${TEST_MMSI}`);
console.log(`Timeout: ${TIMEOUT_SECONDS} seconds`);
console.log('='.repeat(50));
console.log('');

const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

let messageCount = 0;
let connected = false;

// Set timeout
const timeout = setTimeout(() => {
  console.log('');
  console.log(`[TIMEOUT] No messages received after ${TIMEOUT_SECONDS} seconds`);
  console.log('This could mean:');
  console.log('  1. The vessel is not currently transmitting AIS');
  console.log('  2. The MMSI is not in range of AISStream receivers');
  console.log('  3. API key or connection issue');
  ws.close();
  process.exit(0);
}, TIMEOUT_SECONDS * 1000);

ws.on('open', () => {
  connected = true;
  console.log('[CONNECTED] WebSocket connection established');

  // Send subscription message - test specific MMSI
  const subscribeMessage = {
    APIKey: API_KEY,
    BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [TEST_MMSI]
  };

  console.log('[SUBSCRIBING] Sending subscription request...');
  console.log(`  MMSI Filter: ${TEST_MMSI}`);
  console.log(`  Bounding Box: WORLD`);
  console.log('');
  console.log('[WAITING] Listening for AIS messages...');
  console.log('');

  ws.send(JSON.stringify(subscribeMessage));
});

ws.on('message', (data) => {
  clearTimeout(timeout);
  messageCount++;

  try {
    const message = JSON.parse(data.toString());

    console.log(`[MESSAGE ${messageCount}] Type: ${message.MessageType || 'Unknown'}`);
    console.log('-'.repeat(40));

    if (message.MetaData) {
      console.log('MetaData:');
      console.log(`  MMSI: ${message.MetaData.MMSI}`);
      console.log(`  Ship Name: ${message.MetaData.ShipName || 'N/A'}`);
      console.log(`  Latitude: ${message.MetaData.latitude}`);
      console.log(`  Longitude: ${message.MetaData.longitude}`);
      console.log(`  Time: ${message.MetaData.time_utc}`);
    }

    if (message.Message) {
      const msg = message.Message;

      if (message.MessageType === 'PositionReport' && msg.PositionReport) {
        const pos = msg.PositionReport;
        console.log('Position Report:');
        console.log(`  SOG: ${pos.Sog} knots`);
        console.log(`  COG: ${pos.Cog}°`);
        console.log(`  Heading: ${pos.TrueHeading}°`);
        console.log(`  Nav Status: ${pos.NavigationalStatus}`);
      }

      if (message.MessageType === 'ShipStaticData' && msg.ShipStaticData) {
        const ship = msg.ShipStaticData;
        console.log('Ship Static Data:');
        console.log(`  Name: ${ship.Name}`);
        console.log(`  Call Sign: ${ship.CallSign}`);
        console.log(`  Ship Type: ${ship.Type}`);
        console.log(`  Destination: ${ship.Destination}`);
        console.log(`  Dimensions: ${ship.Dimension?.A}x${ship.Dimension?.B}x${ship.Dimension?.C}x${ship.Dimension?.D}`);
      }
    }

    console.log('');

    // After receiving a few messages, we can close
    if (messageCount >= 3) {
      console.log('[SUCCESS] API working! Received messages, closing connection');
      ws.close();
    }

  } catch (err) {
    console.log('[RAW MESSAGE]', data.toString().substring(0, 200));
  }
});

ws.on('error', (error) => {
  clearTimeout(timeout);
  console.error('[ERROR]', error.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  clearTimeout(timeout);
  console.log('');
  console.log('='.repeat(50));
  console.log(`[CLOSED] Connection closed (code: ${code})`);
  console.log(`Total messages received: ${messageCount}`);
  console.log('='.repeat(50));
  process.exit(0);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n[INTERRUPTED] Closing connection...');
  ws.close();
});
