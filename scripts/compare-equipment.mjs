#!/usr/bin/env node

/**
 * Compare equipment from boat build spec spreadsheet with systems table
 */

import XLSX from 'xlsx';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

// Equipment extracted from spreadsheet
const spreadsheetEquipment = [
  // ENGINES & PROPULSION
  { category: 'Engines', item: 'Yanmar 4JH57 (PORT)', notes: 'Upgraded from 4JH45 (line 87)', source: 'Running Costings' },
  { category: 'Engines', item: 'Yanmar 4JH57 (STBD)', notes: 'Upgraded from 4JH45 (line 87)', source: 'Running Costings' },
  { category: 'Saildrive', item: 'Yanmar SD60 (PORT)', notes: 'Line 15: "4JH45 x SD60"', source: 'Running Costings' },
  { category: 'Saildrive', item: 'Yanmar SD60 (STBD)', notes: 'Line 15: "4JH45 x SD60"', source: 'Running Costings' },
  { category: 'Propellers', item: 'Gori 3-blade 15" folding (x2)', notes: 'Line 89', source: 'Running Costings' },
  { category: 'Engine Control', item: 'Yanmar C35 engine control', notes: 'Line 17 - but upgraded to VC20 dual electronic throttle (line 81)', source: 'Running Costings' },

  // ELECTRICAL - VICTRON
  { category: 'Inverter', item: 'Victron Quattro 48/5000/70-100/100 230V', notes: 'Line 21 says 24V 5KW but system is 48V Integrel', source: 'Running Costings' },
  { category: 'Batteries', item: 'Victron LiFePO4 25.6V/200Ah (x4)', notes: 'Lines 20, 62: 4x 24V 200A/h = 800Ah house bank', source: 'Running Costings' },
  { category: 'Solar', item: 'Victron SmartSolar MPPT 100/30 (x2)', notes: 'Lines 63, 105: 6x 400W panels with 100/30 regulators', source: 'Running Costings' },
  { category: 'Charging', item: 'Integrel 9KW (x2)', notes: 'Lines 64, 104: Dual Integrel system', source: 'Running Costings' },
  { category: 'DC-DC', item: 'Victron Orion TR Smart 24/12-30A', notes: 'For 12V systems', source: 'Inferred' },
  { category: 'Shunt', item: 'Victron SmartShunt 500A/50mV', notes: 'Standard with Victron system', source: 'Inferred' },
  { category: 'BMS', item: 'Victron Lynx Smart BMS 500', notes: 'For LiFePO4 batteries', source: 'Inferred' },
  { category: 'Distribution', item: 'Victron Lynx Distributor', notes: 'Battery distribution', source: 'Inferred' },
  { category: 'Monitor', item: 'Victron Cerbo GX', notes: 'System monitoring', source: 'Inferred' },
  { category: 'Display', item: 'Victron GX Touch 70', notes: 'Touch display for Cerbo', source: 'Inferred' },

  // ELECTRICAL - OTHER
  { category: 'Charger', item: 'Victron Skylla 50A Multi-Voltage', notes: 'Line 65', source: 'Running Costings' },

  // NAVIGATION - B&G (Upgraded from Raymarine)
  { category: 'MFD', item: 'B&G Zeus S 16"', notes: 'Upgraded from Raymarine AXIOM 9', source: 'Running Costings line 178' },
  { category: 'MFD', item: 'B&G Zeus S 12"', notes: 'Secondary display', source: 'Systems table' },
  { category: 'MFD', item: 'B&G Nemesis 9"', notes: 'Cockpit display', source: 'Systems table' },
  { category: 'Radar', item: 'B&G Halo24+', notes: 'Upgraded from Raymarine Q24C', source: 'Systems table' },
  { category: 'Autopilot', item: 'B&G NAC-3', notes: 'Autopilot computer', source: 'Systems table' },
  { category: 'Autopilot', item: 'B&G T2 RAM 24V', notes: 'Linear drive', source: 'Systems table' },
  { category: 'Instruments', item: 'B&G Triton Display', notes: 'Instrument displays', source: 'Systems table' },
  { category: 'Wind', item: 'B&G WS310', notes: 'Wind sensor', source: 'Systems table' },
  { category: 'GPS', item: 'B&G ZG100 GPS Dome', notes: 'GPS antenna', source: 'Systems table' },
  { category: 'Compass', item: 'B&G Precision-9', notes: 'Heading sensor', source: 'Systems table' },
  { category: 'Sonar', item: 'B&G ForwardScan', notes: 'Forward looking sonar', source: 'Systems table' },
  { category: 'Transducer', item: 'B&G/Airmar DST810', notes: 'Triducer - speed/depth/temp', source: 'Systems table' },
  { category: 'AIS', item: 'B&G NAIS-500', notes: 'AIS transceiver', source: 'Systems table' },
  { category: 'VHF', item: 'B&G V100 Handset', notes: 'Upgraded from Ray63', source: 'Systems table' },
  { category: 'Rudder', item: 'B&G RF25N Rudder Feedback', notes: 'Rudder position sensor', source: 'Systems table' },
  { category: 'Camera', item: 'B&G IP Camera (x4)', notes: 'Line 161: 4x IP cams', source: 'Running Costings' },

  // APPLIANCES
  { category: 'Fridge', item: 'Vitrifrigo DRW180A RFX', notes: 'Line 23: double drawer fridge', source: 'Running Costings' },
  { category: 'Freezer', item: 'Vitrifrigo DRW180A BTX', notes: 'Line 24: double drawer freezer', source: 'Running Costings' },
  { category: 'Grill', item: 'Kenyon B70770 SilKEN Built-in 48VDC', notes: 'Lines 164-165: 48V grill + B96018 lid', source: 'Running Costings' },
  { category: 'Washer/Dryer', item: 'Samsung WD*TA***', notes: 'Line 118: 230V model', source: 'Running Costings' },
  { category: 'Oven', item: 'Bosch Gas Oven', notes: 'Line 52: gas oven with 4 burner hob', source: 'Running Costings' },
  { category: 'Induction', item: 'Bosch Induction Hob', notes: 'Separate from gas', source: 'Hull #28' },

  // WATER SYSTEMS
  { category: 'Watermaker', item: 'Schenker Zen 150 48V', notes: 'Line 156', source: 'Running Costings' },
  { category: 'Water Purifier', item: 'Acuva UV-LED', notes: 'Line 159', source: 'Running Costings' },
  { category: 'Water Heater', item: 'Isotemp Marine Water Heater', notes: 'Standard spec', source: 'Inferred' },
  { category: 'Freshwater Pump', item: 'Marco UP6/E', notes: 'Boat Spares line 40: "UP6/E 24V 3.5 bar"', source: 'Boat Spares' },
  { category: 'Transfer Pump', item: 'Marco Self-Priming Transfer Pump', notes: 'Line 88: diesel transfer', source: 'Running Costings' },

  // HVAC
  { category: 'Air Con', item: 'Frigomar SCU16VFD (Saloon)', notes: 'Line 78: 16 BTU', source: 'Running Costings' },
  { category: 'Air Con', item: 'Frigomar SCU10VFD (Cabin x3)', notes: 'Line 78: 3x 10 BTU', source: 'Running Costings' },
  { category: 'Fans', item: 'Caframo Sirocco (x8)', notes: 'Line 110: 8 fans total', source: 'Running Costings' },
  { category: 'Extractor', item: 'Vetus Extractor Fan', notes: 'Standard spec', source: 'Systems table' },

  // TOILETS
  { category: 'Toilet', item: 'Thetford Tecma Electric (x2)', notes: 'Line 22: two electric toilets', source: 'Running Costings' },

  // ANCHORING
  { category: 'Windlass', item: 'Quick Hector HC3 1500W', notes: 'Systems has Quick, spec says Maxwell HRC10 - CONFLICT', source: 'CONFLICT' },
  { category: 'Main Anchor', item: 'Rocna MkII 50kg', notes: 'Line 179: upgraded from Rocna 33', source: 'Running Costings' },
  { category: 'Secondary Anchor', item: 'Fortress FX-37', notes: 'Line 41', source: 'Running Costings' },

  // DECK GEAR - HARKEN
  { category: 'Winch', item: 'Harken 50.2 STEA 24V (Helm x2)', notes: 'Lines 10, 73: upgraded', source: 'Running Costings' },
  { category: 'Winch', item: 'Harken 50.2 STA Manual (x2)', notes: 'Base spec', source: 'Running Costings' },
  { category: 'Winch', item: 'Harken 46.2 STEA Electric (Port deck)', notes: 'Line 71', source: 'Running Costings' },
  { category: 'Winch', item: 'Harken 46.2 STEA Electric (Aft coaming x2)', notes: 'Line 72', source: 'Running Costings' },
  { category: 'Winch', item: 'Harken 60.3 STEA 24V H (Mainsheet)', notes: 'Line 192: Sz60 speed winch', source: 'Running Costings' },
  { category: 'Traveler', item: 'Harken 32mm Big Boat CB Traveler Car', notes: 'Standard spec', source: 'Systems table' },
  { category: 'Control', item: 'Harken Dual Function Control Box', notes: 'Winch control', source: 'Systems table' },
  { category: 'Control', item: 'Harken Analogic Switch', notes: 'Winch switch', source: 'Systems table' },
  { category: 'Blocks', item: 'Harken Black Magic Footblock', notes: 'Deck hardware', source: 'Systems table' },
  { category: 'Blocks', item: 'Harken High-Load Snatch Block', notes: 'Deck hardware', source: 'Systems table' },

  // RIGGING
  { category: 'Furler', item: 'Profurl C380', notes: 'Line 9', source: 'Running Costings' },
  { category: 'Load Sensors', item: 'Cyclops Marine SmartLink SR 5t/12.5t', notes: 'Line 182: load cells on cap shrouds', source: 'Running Costings' },
  { category: 'Load Sensors', item: 'Cyclops Marine SmartToggle 4.5t', notes: 'Additional sensors', source: 'Systems table' },
  { category: 'Gateway', item: 'Cyclops Marine BG03 Gateway', notes: 'For load sensors', source: 'Systems table' },

  // COMMUNICATIONS
  { category: 'Satellite', item: 'Iridium GO!', notes: 'Line 121, 175', source: 'Running Costings' },
  { category: 'Router', item: 'Peplink Balance 20X', notes: 'Line 176', source: 'Running Costings' },
  { category: 'Cellular', item: 'Pepwave MAX HD1 Dome Pro 5G', notes: 'Cellular modem', source: 'Systems table' },
  { category: 'WiFi', item: 'Peplink AP One AX', notes: 'Access point', source: 'Systems table' },
  { category: 'Starlink', item: 'Starlink', notes: 'Line 171', source: 'Running Costings' },

  // ENTERTAINMENT
  { category: 'Stereo', item: 'Fusion MS-RA770', notes: 'Line 123: MS-AV750 series', source: 'Running Costings' },
  { category: 'Speakers', item: 'Fusion 6.5" XS Speakers (x4)', notes: 'Line 123', source: 'Running Costings' },
  { category: 'TV', item: 'Samsung 32" TV', notes: 'Line 122', source: 'Running Costings' },

  // SAFETY
  { category: 'Vision', item: 'Sea.AI', notes: 'Line 177', source: 'Running Costings' },
  { category: 'EPIRB', item: 'ACR EPIRB Beacon', notes: 'Line 191: Full A licence safety kit', source: 'Running Costings' },
  { category: 'Danbuoy', item: 'Ocean Safety Inflatable Danbuoy', notes: 'Safety kit', source: 'Systems table' },

  // PLUMBING FIXTURES
  { category: 'Faucet', item: 'Franke Flexi Faucet', notes: 'Galley', source: 'Systems table' },
  { category: 'Shower', item: 'Hansgrohe Mixer Tap', notes: 'Hull #28 line 119: "Hansgrohe chrome"', source: 'Hull #28' },
  { category: 'Shower', item: 'Whale Swim N Rinse', notes: 'Transom shower', source: 'Systems table' },

  // TENDER
  { category: 'Tender', item: 'OC Tender OC350', notes: 'Line 190', source: 'Running Costings' },
  { category: 'Tender Propulsion', item: 'ZeroJet ZJ20', notes: 'Line 190: Zerojet on OC tender', source: 'Running Costings' },

  // ELECTRICAL DISTRIBUTION
  { category: 'Switch', item: 'Blue Sea 7700 Remote Battery Switch', notes: 'Battery switching', source: 'Systems table' },
  { category: 'Control', item: 'CZone Touch 7', notes: 'Digital switching', source: 'Systems table' },
  { category: 'Keypad', item: 'CZone Waterproof Keypad', notes: 'Nav station', source: 'Systems table' },
  { category: 'Gateway', item: 'CZone Gateway', notes: 'NMEA2000 interface', source: 'Systems table' },

  // COMPASS
  { category: 'Compass', item: 'Ritchie Navigation Compass', notes: 'NEED MODEL NUMBER', source: 'Systems table' },

  // FILTERS
  { category: 'Fuel Filter', item: 'Vetus/Parker Fuel Filter Water Separator', notes: 'Line 19: Dual Racor filters', source: 'Running Costings' },

  // LIGHTING
  { category: 'Underwater Lights', item: 'OceanLED (x2)', notes: 'Line 86: blue, port and starboard', source: 'Running Costings' },

  // DECKING
  { category: 'Decking', item: 'Flexiteek', notes: 'Line 129: cockpit flooring', source: 'Running Costings' },

  // HATCHES
  { category: 'Hatches', item: 'Lewmar Size 70 Medium Profile', notes: 'Hull #28 line 13', source: 'Hull #28' },
  { category: 'Hatches', item: 'Lewmar Size 60 Medium Profile', notes: 'Hull #28 line 27', source: 'Hull #28' },
  { category: 'Hatches', item: 'Magnus Size 47 Escape Hatch', notes: 'Hull #28 line 12', source: 'Hull #28' },

  // ANTENNA
  { category: 'Mount', item: 'Scanstrut ATMOS', notes: 'Antenna mount', source: 'Systems table' },
];

async function main() {
  const supabase = await getSupabaseClient();

  // Get all systems
  const { data: systems } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, description')
    .order('manufacturer_norm');

  console.log('='.repeat(80));
  console.log('EQUIPMENT COMPARISON: Spreadsheet vs Systems Table');
  console.log('='.repeat(80));
  console.log();

  const conflicts = [];
  const missing = [];
  const modelUpdates = [];

  // Key comparisons
  const comparisons = [
    {
      name: 'Yanmar Engines',
      spreadsheet: '4JH57 (upgraded from 4JH45)',
      systemKey: 'Port_Stbd_Engine',
      systemMfr: 'Yanmar',
      issue: 'Model should be 4JH57, also need PORT and STBD entries'
    },
    {
      name: 'Yanmar Saildrive',
      spreadsheet: 'SD60',
      systemKey: 'Sail_drive',
      systemMfr: 'Yanmar',
      issue: 'Model should be SD60, also need PORT and STBD entries'
    },
    {
      name: 'Kenyon Grill',
      spreadsheet: 'B70770 SilKEN Built-in 48VDC + Lid B96018',
      systemKey: 'silken_grill',
      systemMfr: 'Kenyon',
      issue: 'Model should be B70770'
    },
    {
      name: 'Windlass',
      spreadsheet: 'Maxwell HRC10 (spec) vs Quick Hector HC3 (systems)',
      systemKey: 'hector_hc3_series_windlass_1500w',
      systemMfr: 'Quick',
      issue: 'CONFLICT: Spreadsheet says Maxwell, Systems says Quick - which is correct?'
    },
    {
      name: 'Vitrifrigo Fridge',
      spreadsheet: 'DRW180A RFX (fridge) + DRW180A BTX (freezer)',
      systemKey: 'fridge_freezer',
      systemMfr: 'Vitrifrigo',
      issue: 'Should be 2 entries: DRW180A_RFX and DRW180A_BTX'
    },
    {
      name: 'Frigomar Air Con',
      spreadsheet: '1x SCU16VFD (16 BTU) + 3x SCU10VFD (10 BTU)',
      systemKey: 'airconditioners',
      systemMfr: 'Frigomar',
      issue: 'Should be 4 entries with specific models'
    },
    {
      name: 'Ritchie Compass',
      spreadsheet: 'Unknown model',
      systemKey: 'compass_with_key',
      systemMfr: 'Ritchie Navigation',
      issue: 'Need specific model (HB-740? HD-744? etc.)'
    },
    {
      name: 'Victron MPPT',
      spreadsheet: '100/30 (line 63, 105)',
      systemKey: 'smart_solar_mppt',
      systemMfr: 'Victron',
      issue: 'Model should be 100/30, also have 250/100 in systems - which is correct?'
    },
    {
      name: 'Samsung Washer/Dryer',
      spreadsheet: 'WD*TA*** series',
      systemKey: 'washer_dryer',
      systemMfr: 'Samsung',
      issue: 'Need exact model number'
    },
    {
      name: 'Marco Pump',
      spreadsheet: 'UP6/E (from Boat Spares)',
      systemKey: 'self_priming_transfer_pump',
      systemMfr: 'Marco',
      issue: 'Model should be UP6/E'
    },
  ];

  console.log('KEY COMPARISONS REQUIRING ATTENTION:');
  console.log('-'.repeat(80));

  for (const comp of comparisons) {
    const sys = systems?.find(s =>
      s.manufacturer_norm === comp.systemMfr &&
      s.model_norm === comp.systemKey
    );

    console.log(`\n${comp.name}`);
    console.log(`  Spreadsheet: ${comp.spreadsheet}`);
    console.log(`  Systems DB:  ${sys ? sys.model_norm + ' - ' + (sys.description || 'no description') : 'NOT FOUND'}`);
    console.log(`  Issue: ${comp.issue}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('QUESTIONS FOR YOU:');
  console.log('='.repeat(80));

  const questions = [
    '1. WINDLASS: Spreadsheet says "Maxwell HRC10" but systems has "Quick Hector HC3". Which is actually installed?',
    '2. VICTRON MPPT: Spreadsheet shows "100/30" but systems has both "smart_solar_mppt" and "smart_solar_mppt_250_100_tr". What models do you actually have?',
    '3. COMPASS: What is the exact Ritchie Navigation model? (e.g., HB-740, HD-744, D-515-EP)',
    '4. ENGINES: Confirm you have 2x Yanmar 4JH57 (upgraded from 4JH45)?',
    '5. SAILDRIVES: Confirm you have 2x Yanmar SD60?',
    '6. AIR CON: Confirm Frigomar 1x 16BTU (saloon) + 3x 10BTU (cabins)?',
    '7. VITRIFRIGO: You have DRW180A RFX (fridge) AND DRW180A BTX (freezer) as separate units?',
    '8. KENYON GRILL: Confirm model B70770 (SilKEN Built-in 48VDC)?',
  ];

  questions.forEach(q => console.log('\n' + q));

  console.log('\n' + '='.repeat(80));
  console.log('SYSTEMS IN TABLE BUT NOT IN SPREADSHEET:');
  console.log('='.repeat(80));

  // Check for systems not obviously in spreadsheet
  const spreadsheetMfrs = new Set([
    'Yanmar', 'Victron', 'B&G', 'Harken', 'Kenyon', 'Samsung', 'Vitrifrigo',
    'Frigomar', 'Schenker', 'Acuva', 'Marco', 'Quick', 'Rocna', 'Fortress',
    'Fusion', 'Peplink', 'Pepwave', 'CZone', 'Blue Sea', 'Ritchie Navigation',
    'Cyclops Marine', 'Vetus', 'Thetford', 'Hansgrohe', 'Franke', 'Whale',
    'OC Tender', 'ZeroJet', 'Ocean Safety', 'Flexiteek', 'Scanstrut',
    'Caframo', 'Integrel', 'Airmar', 'Iridium', 'Bosch'
  ]);

  systems?.forEach(s => {
    if (!spreadsheetMfrs.has(s.manufacturer_norm)) {
      console.log(`  ${s.manufacturer_norm} | ${s.model_norm} | ${s.description || ''}`);
    }
  });
}

main().catch(console.error);
