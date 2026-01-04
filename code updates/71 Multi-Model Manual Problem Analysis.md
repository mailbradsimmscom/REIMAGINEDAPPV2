# Multi-Model Manual Problem Analysis

**Date:** 2025-01-04
**Status:** Analysis Complete, Solution Pending

## Problem Statement

Many marine equipment manuals cover an entire product family rather than a single model. A Yanmar engine manual might document the 4JH45, 4JH57, 4JH80, and 4JH110 in the same PDF. A Kenyon grill manual covers the B70750, B70770, B70772, and B70790 variants. The specifications, procedures, and part numbers differ between models—oil capacity, max RPM, dimensions, wiring diagrams—but they all live in the same document and get chunked together.

### What We've Built

The system ingests marine equipment manuals (PDFs) and chunks them into semantically meaningful sections stored in Pinecone. Each chunk is embedded as a 3072-dimension vector and tagged with metadata including `asset_uid`, `manufacturer`, and `model`. The user's boat has an inventory of ~119 systems in Supabase, each with a specific manufacturer and model. When a user asks a question, the system identifies relevant equipment from their inventory, searches Pinecone for matching chunks, and synthesizes an answer using an LLM.

### The Core Issue

The Pinecone metadata reflects the **document-level model name** (e.g., "Port_Stbd_Engine" or "silken_grill"), not the specific product variants covered within. When a user asks "what's the oil capacity for my engine?", Pinecone returns chunks that match semantically, but those chunks often contain a table with values for **all models** in the family.

The system knows the user has a 4JH57 from their inventory, but that specificity is lost at two points:
1. **Pinecone can't filter by sub-model** because it's not in the metadata
2. **The synthesis prompt doesn't always emphasize** which exact model the user owns

The LLM sees multiple values and either guesses, returns the wrong model's specs, or hedges with "it depends on your model"—even though we know exactly which model they have.

---

## Analysis Results

### Scale of the Problem

We analyzed all 76 documents in Pinecone using GPT-4o-mini to identify multi-model manuals.

| Metric | Value |
|--------|-------|
| Total documents analyzed | 76 |
| **Multi-model manuals** | **59 (78%)** |
| Single-model manuals | 17 (22%) |
| Analysis cost | $0.15 |

**78% of manuals have this problem.** This isn't an edge case—it's the default state.

### Multi-Model Manuals Identified (59)

| # | Manufacturer | Model | Variants Found |
|---|--------------|-------|----------------|
| 1 | Yanmar | Port_Stbd_Engine | 3JH40, 4JH45, 4JH57, 4JH80, 4JH110 |
| 2 | Yanmar | Sail_drive | SD25, SD60, SD110, SD150 |
| 3 | Yanmar | vc20 | JH-CR, 4LV, 8LV, 6LY-CR, 6LF, 6LT |
| 4 | Kenyon | silken_grill | B70750, B70790, B70770, B70772 |
| 5 | Victron | quattro_48_5000_70_100_100_230v | 12/5000, 24/5000, 48/5000, 48/8000, 48/10000, 48/15000 |
| 6 | Victron | smart_solar_mppt_250_100_tr | 150/70, 150/85, 150/100, 250/70, 250/85, 250/100 |
| 7 | Victron | smart_solar_mppt | MPPT 75/10, MPPT 75/15, MPPT 100/15, MPPT 100/20 |
| 8 | Victron | life_p04_battery_25_6v_200a | 12.8/50, 12.8/100, 12.8/200, 25.6/200 |
| 9 | Victron | orion_tr_smart_24_12_30a | 12/12-18, 12/24-10, 24/12-20, 24/24-12, 48/12-20 |
| 10 | Victron | cerbo_gx | BPP900450100, BPP900450110, BPP900451100 |
| 11 | Victron | smartshunt_500a_50mv | 300A, 500A, 1000A, 2000A |
| 12 | Victron | lynx_smart_bms_500 | LYN034160210, LYN034170210 |
| 13 | Victron | lynx_distributor | LYN060102000, LYN060102010 |
| 14 | Ritchie Navigation | compass_with_key | HB-740, HB-741, HD-744, HD-745, D-515-EP... (16 variants) |
| 15 | Quick | hector_hc3_series_windlass_1500w | HC3 712, HC3 724, HC3 1012, HC3 1512... (18 variants) |
| 16 | Harken | winch_60_3_stea_24v_h_motor | 60.3 ST E/HY, 60.3 STA, 60.3 STC... (6 variants) |
| 17 | Harken | 50_2stea_24v_horizontal | 50.2 ST EL, 50.2 ST EL/HY 12V, 50.2 ST EL/HY 24V |
| 18 | Harken | 46_2stea | 46.2 ST EL, 46.2 ST HY... (6 variants) |
| 19 | Harken | dual_function_control_box | FlatWinder 250, 500, UniPower, Radial... (14 variants) |
| 20 | Harken | analogic_switch | HC7906, HC7905, HC8537... (7 variants) |
| 21 | Harken | black_magic_footblock | 6070, 6074, 6076... (10 variants) |
| 22 | Harken | high_load_snatch_block | 2146, 2147, 2149... (6 variants) |
| 23 | Harken | 50_2sta | IN46.2STA, IN46.2STC... (4 variants) |
| 24 | Harken | 32mm_big_boat_cb_traveler_car | 26mm, 32mm |
| 25 | Frigomar | airconditioners | SCU07VFD, SCU10VFD, SCU12VFD, SCU16VFD (E/A variants) |
| 26 | Vitrifrigo | fridge_freezer | DRW70A, DRW180A, DRW360A |
| 27 | Vetus | extractor_fan | VENT7612A, VENT7624A, VENT10212, VENT10224 |
| 28 | Vetus | fuel_filter_water_separators | 340VTEB, 350VTEB... (6 variants) |
| 29 | Vetus | no_smell_filter | NSFCAN, NSFCANS |
| 30 | B&G | v100_v100_b_handset | NRS-1, NRS-2, HS1, HS2, HS3, HS4 |
| 31 | B&G | zeus_s_16_mfd | Multiple screen sizes |
| 32 | B&G | zg100_gps_dome | Point-1, GS25, ZG100 |
| 33 | B&G | halo24_plus | Halo24, Halo24+ |
| 34 | B&G | dst810 | DST810, DX900+ |
| 35 | B&G | t2_ram_24v | RAM T1, RAM T2 |
| 36 | B&G | nemesis_9 | Multiple configurations |
| 37 | B&G | forwardscan_transducers | NSS evo2, NSO evo2, Zeus² |
| 38 | B&G | ip_camera | IP CAM-1 |
| 39 | CZone | waterproof_keypad | 8 part number variants |
| 40 | CZone | czone_gateway | 10 article number variants |
| 41 | Peplink | balance_20x_2_wan | Balance 20, 30, 50, 210, 310, 380, 580, 710 |
| 42 | Peplink | ap_one_ax | Enterprise, AC mini, In-Wall, Rugged... (8 variants) |
| 43 | Pepwave | max_hd1_dome_pro_5g | BR1 PRO, BR2 PRO, UBR LTE... (5 variants) |
| 44 | Cyclops Marine | smartlink_sr_5t_sr12_5t | nano, 2t, 5t, 10t, 20t |
| 45 | Cyclops Marine | smarttoggle_4_5t_12mm | FE-02, FE-03 |
| 46 | Cyclops Marine | bg03_smartfittings_gateway | 6 serial number variants |
| 47 | Marco | control_panel | Multiple sensor types |
| 48 | Marco | self_priming_transfer_pump | 16462213, UP6/E |
| 49 | Isotemp | marine_water_heater | 5 capacity variants |
| 50 | Whale | swin_n_rinse_shower | RT1649, RT2648, RT2658 |
| 51 | Thetford | tecma | 12-volt, 24-volt |
| 52 | Samsung | washer_dryer | WD8*TA*****, WD7*TA***** |
| 53 | Blue Sea | 7700 | 7700, 7701, 7702, 7703 |
| 54 | Franke | flexi_faucet | FFP5200, FFP5220... (8 variants) |
| 55 | Fusion | 6_5_xs_speakers | 4", 6.5", 7.7" sizes |
| 56 | Fusion | radio_stereo | MS-RA770 |
| 57 | ZeroJet | ZeroJet 350 | T20, C20, 10kWh, 5kWh |
| 58 | Rocna | mkii_50_50kg | Original, Mk II, Vulcan, Fisherman |
| 59 | Fortress | fx_37 | FX37 variants |

### Single-Model Manuals (17)

These manuals cover only one model and don't have the multi-model problem:

- Schenker zen_150_watermaker_48v
- B&G WS310, nais_500, nac_3_autopilot_computer, triton_display, precision_9, sonarhub, rf25n_rudder_feedback_unit
- CZone touch_7, network_bridge_interface
- Scanstrut atmos
- Acuva uv_led_water_purification_system
- Ocean Safety inflatable_danbuoy
- Integrel charging_system
- Airmar dst810_smart_multisensor
- OC Tender OC350
- Flexiteek material_guarantee

---

## User's Specific Equipment (from Build Spreadsheet)

Analysis of the Hull #28 build specification spreadsheet revealed the exact models installed:

| Equipment | Spreadsheet Model | Systems Table | Action Needed |
|-----------|-------------------|---------------|---------------|
| Yanmar Engines | **4JH57** (upgraded from 4JH45) | Port_Stbd_Engine | Update model to 4JH57, add PORT/STBD entries |
| Yanmar Saildrive | **SD60** | Sail_drive | Update model to SD60, add PORT/STBD entries |
| Kenyon Grill | **B70770** SilKEN Built-in 48VDC | silken_grill | Update model to B70770 |
| Thetford Toilet | **Tecma Silence Plus 2G 24V (Tall)** x2 | tecma | Update model, add 2 entries |
| Victron MPPT | **100/30** (x2) | smart_solar_mppt | Confirm vs 250/100 |
| Vitrifrigo | **DRW180A RFX** + **DRW180A BTX** | fridge_freezer | Split into 2 entries |
| Frigomar AC | **SCU16VFD** + 3x **SCU10VFD** | airconditioners | Split into 4 entries |
| Marco Pump | **UP6/E** | self_priming_transfer_pump | Update model |

### Conflicts Requiring User Input

1. **Windlass**: Spreadsheet says "Maxwell HRC10" but systems has "Quick Hector HC3" - which is installed?
2. **Compass**: Need exact Ritchie Navigation model (HB-740? HD-744? D-515-EP?)
3. **Victron MPPT**: Spreadsheet shows 100/30 but systems has 250/100 - clarify actual models

---

## Potential Solutions

### Option A: Fix at Synthesis (Low Effort)
Pass the user's exact model variant to the synthesis prompt:
```
User has: Yanmar 4JH57
When answering, use specifications for the 4JH57 specifically, not other models in the 4JH series.
```

### Option B: Add Variant Metadata (Medium Effort)
Store `variants_covered` array on documents table:
```json
{
  "doc_id": "...",
  "model": "Port_Stbd_Engine",
  "variants_covered": ["4JH45", "4JH57", "4JH80", "4JH110"]
}
```

### Option C: Model-Specific Chunking (High Effort)
During PDF ingestion, split chunks by model when tables/sections are model-specific.

### Option D: Structured Variant Field in Systems Table (Recommended)
Add `model_variant` field to systems table:
```sql
ALTER TABLE systems ADD COLUMN model_variant TEXT;
-- Example: manufacturer_norm='Yanmar', model_norm='4JH_engine', model_variant='4JH57'
```

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/analyze-multimodel-manuals.mjs` | GPT-4o-mini analysis of all documents |
| `results/multimodel-analysis.json` | Full analysis results (59 multi-model manuals) |
| `scripts/compare-equipment.mjs` | Compare spreadsheet vs systems table |

---

## Next Steps

1. **Update systems table** with correct model variants from build spreadsheet
2. **Resolve conflicts** (windlass, compass, MPPT models)
3. **Implement solution** - likely Option A (synthesis prompt) + Option D (variant field)
4. **Test** - verify chat returns correct model-specific specs

---

## Cost Summary

| Task | Cost |
|------|------|
| Multi-model analysis (76 docs, GPT-4o-mini) | $0.15 |
| Total | $0.15 |
