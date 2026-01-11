# Season Recap

## Overview

Season Recap generates AI-powered summaries of your sailing season using OpenAI. It combines all trip and anchorage data into narrative recaps in three distinct styles.

**Who uses it:** Boat owners, crew, anyone wanting to share their sailing adventures
**Access:** `/public/season-recap.html` (via Other Links)

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to Season Recap                                    │
│     └── Other Links → Season Recap                              │
│     └── Or direct: /public/season-recap.html                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Page loads existing recaps (if any)                         │
│     └── GET /api/season-recap                                   │
│     └── Displays stored boring/exciting/unhinged content        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Click Generate button for desired style                     │
│     └── POST /api/season-recap/:style/generate                  │
│     └── Fetches all trips + anchorages                          │
│     └── Sends to OpenAI with style-specific prompt              │
│     └── Stores result, displays HTML content                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recap Styles

### Boring ("The Facts")

Technical, factual marine log style.

**Characteristics:**
- Professional and matter-of-fact
- Focus on distances, dates, statistics
- Proper nautical terminology
- Thorough but not embellished

**Example output:**
> The vessel departed Deshaies, Guadeloupe at 0700 on January 8, 2026. The passage to Jolly Harbour, Antigua covered 45.98 nautical miles over 7 hours 26 minutes, averaging 5.59 knots with a maximum speed of 7.95 knots.

---

### Exciting ("The Adventure")

Dramatic travel documentary style.

**Characteristics:**
- Engaging narrative flow
- Vivid descriptions and metaphors
- Routine passages become adventures
- Humor and celebration
- Colorful nautical language

**Example output:**
> As dawn broke over the emerald peaks of Guadeloupe, we cast off our lines and pointed our bow toward the open Caribbean. The trade winds filled our sails as we embarked on our longest passage yet...

---

### Unhinged ("The Legend")

Over-the-top legendary tale style.

**Characteristics:**
- MAXIMUM drama and exaggeration
- Pirate captain storytelling voice
- Sea monsters, Neptune, mythology references
- Statistics presented as world records
- Caribbean culture, history, and local color
- Extremely verbose and detailed

**Prompt features:**
- Captain Jack Sparrow meets David Attenborough
- Local island references (French Caribbean culture, volcanic Dominica, etc.)
- Caribbean food, rum, music
- Trade winds and regional weather
- 3-4 paragraphs minimum per section

**Example output:**
> AND THEN, dear listeners, gather 'round for the MOST LEGENDARY tale ever told upon these Caribbean waters! Our intrepid crew, blessed by Neptune himself, faced the MIGHTY Atlantic swells as they conquered the treacherous 45.98 nautical miles from Deshaies to Jolly Harbour - a distance that would make Blackbeard himself weep with envy!

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (season-recap.html)                                   │
│  ├── Three sections: Boring / Exciting / Unhinged               │
│  ├── Generate buttons with loading states                       │
│  ├── Displays HTML content with metadata                        │
│  └── Persists each style independently                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /api/season-recap (season-recap.route.js)                      │
│  └── season-recap.service.js                                    │
│      ├── getAllRecaps() - Fetch stored recaps                   │
│      ├── getRecap(style) - Fetch single recap                   │
│      └── generateRecap(style) - Generate via OpenAI             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  OpenAI API (Chat Completions)                                  │
│  └── Model: env.OPENAI_MODEL (GPT-5.x compatible)               │
│  └── max_completion_tokens: 4000                                │
│  └── Verbosity controlled via prompt, not temperature           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  └── season_recaps table                                        │
│      ├── style (boring/exciting/unhinged)                       │
│      ├── content (HTML)                                         │
│      ├── model_used, trips_count, anchorages_count              │
│      └── generated_at, updated_at                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/season-recap` | Get all stored recaps |
| GET | `/api/season-recap/:style` | Get specific recap |
| POST | `/api/season-recap/:style/generate` | Generate new recap |

### GET /api/season-recap

Returns all three recaps (null if not yet generated):

```json
{
  "success": true,
  "data": {
    "boring": { "id": "...", "content": "<h2>...</h2>", "generated_at": "..." },
    "exciting": { "id": "...", "content": "<h2>...</h2>", "generated_at": "..." },
    "unhinged": null
  }
}
```

### POST /api/season-recap/:style/generate

Generates and stores a new recap. Style must be `boring`, `exciting`, or `unhinged`.

**Process:**
1. Fetches all completed trips from `trips` table
2. Fetches all anchorages from `anchorages` table
3. Formats data with dates, distances, durations, statistics
4. Sends to OpenAI with style-specific system prompt
5. Stores HTML response in `season_recaps` table
6. Returns the stored record

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "style": "unhinged",
    "content": "<h2>The Most LEGENDARY Voyage...</h2>...",
    "model_used": "gpt-5.1-chat-latest",
    "trips_count": 11,
    "anchorages_count": 8,
    "generated_at": "2026-01-11T15:30:00Z"
  }
}
```

---

## Database Schema

### season_recaps

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| style | text | `boring`, `exciting`, or `unhinged` |
| content | text | HTML formatted recap |
| model_used | text | OpenAI model that generated this |
| trips_count | integer | Number of trips included |
| anchorages_count | integer | Number of anchorages included |
| generated_at | timestamptz | When recap was generated |
| created_at | timestamptz | Record creation |
| updated_at | timestamptz | Last update |

**Constraints:**
- Unique index on `style` (only one recap per style)
- CHECK constraint: `style IN ('boring', 'exciting', 'unhinged')`

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Page | `src/public/season-recap.html` |
| **Backend** | |
| Routes | `src/routes/season-recap/season-recap.route.js` |
| Service | `src/services/season-recap/season-recap.service.js` |
| **Database** | |
| Create table | `scripts/migrations/027_create_season_recaps_table.sql` |
| Add unhinged | `scripts/migrations/028_add_unhinged_recap_style.sql` |

---

## Data Included in Recaps

### From Trips

- Title (e.g., "Deshaies, Guadeloupe to Jolly Harbour, Antigua and Barbuda")
- Date (formatted: "Wednesday, January 8, 2026")
- Distance in nautical miles
- Duration (hours and minutes)
- Average speed (knots)
- Maximum speed (knots)
- Season totals (total trips, distance, sailing time)

### From Anchorages

- Location name
- Type (anchor or mooring)
- Arrival date
- Duration (days and hours)
- Average wind speed
- Season totals (total anchorages, days at anchor)

---

## OpenAI Integration

### Model Compatibility

Uses Chat Completions API (`/v1/chat/completions`) with GPT-5.x in compatibility mode.

**Request parameters:**
```javascript
{
  model: env.OPENAI_MODEL,  // e.g., "gpt-5.1-chat-latest"
  messages: [
    { role: 'system', content: stylePrompt },
    { role: 'user', content: dataPrompt }
  ],
  max_completion_tokens: 4000
}
```

**Note:** Temperature and seed are NOT used (ignored by GPT-5.x). Verbosity and style are controlled entirely through the prompt.

### Prompt Structure

1. **System prompt** - Defines the voice and style
2. **User prompt** - Contains all trip and anchorage data formatted for the model

See `season-recap.service.js` for full prompt definitions.

---

## Styling

The page uses iOS-style design consistent with other BoatOS pages:

| Style | Button Color |
|-------|--------------|
| Boring | Gray (#8E8E93) |
| Exciting | Orange gradient (#FF6B6B → #FF8E53) |
| Unhinged | Purple/pink gradient with pulse animation |

---

## Testing

```bash
# Generate boring recap
curl -X POST http://localhost:3000/api/season-recap/boring/generate

# Generate exciting recap
curl -X POST http://localhost:3000/api/season-recap/exciting/generate

# Generate unhinged recap
curl -X POST http://localhost:3000/api/season-recap/unhinged/generate

# Get all recaps
curl http://localhost:3000/api/season-recap
```

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Real-time updates" | **No.** Recaps are generated on demand |
| "Automatic regeneration" | **No.** User must click button |
| "Multiple recaps per style" | **No.** One per style, overwritten on regenerate |
| "Temperature controls style" | **No.** GPT-5.x ignores it; style is in prompt |
| "Sharing/export" | **Not yet.** Content is HTML, could be added |

---

## Future Enhancements

- [ ] Export to PDF
- [ ] Share via link
- [ ] Date range filtering
- [ ] Custom prompt input
- [ ] Image/photo integration

---

## Related Docs

- [Trips](./trips.md) - Trip data source
- [Anchorages](./anchorages.md) - Anchorage data source
- [Utility Scripts](../30-backend/utility-scripts.md) - Nominatim utility (shared with trips/anchorages)
- [API Reference](../API_REFERENCE.md) - Full API documentation
