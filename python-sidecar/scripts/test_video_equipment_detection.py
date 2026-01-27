#!/usr/bin/env python3
"""
Test Script: Video Equipment Detection

Extracts frames from boat videos and uses Claude Vision to detect:
- Manufacturer logos
- Model numbers
- Serial numbers
- Equipment labels
- Equipment types

Usage:
    python scripts/test_video_equipment_detection.py --video "/path/to/video.MOV"
    python scripts/test_video_equipment_detection.py --video "/path/to/video.MOV" --interval 2
"""

import os
import sys
import json
import base64
import argparse
import subprocess
from pathlib import Path
from datetime import datetime

# Load environment
env_file = Path('/Users/brad/code/REIMAGINEDAPPV2/.env')
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, _, value = line.partition('=')
            os.environ[key.strip()] = value.strip().strip('"').strip("'")

import anthropic

# Configuration
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
OUTPUT_DIR = Path('/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/visual_extraction_work/video_frames')

# Vision prompt for equipment detection
EQUIPMENT_DETECTION_PROMPT = """You are analyzing a frame from a video of a boat's engine bay. Your task is to identify any visible equipment, manufacturer logos, model numbers, or serial numbers.

For each piece of equipment you can identify, provide:
1. **manufacturer** - The brand/manufacturer name (e.g., "Yanmar", "Victron", "Blue Sea")
2. **model_number** - Any visible model number or product code
3. **serial_number** - Any visible serial number (if readable)
4. **equipment_type** - What type of equipment (e.g., "engine", "pump", "battery switch", "controller")
5. **description** - Brief description of what you see
6. **confidence** - How confident you are (high/medium/low)
7. **location_in_frame** - Where in the image (top-left, center, bottom-right, etc.)

Also note:
- Any text labels visible (stickers, nameplates, warning labels)
- Color coding that might indicate function (red=positive, black=negative, etc.)
- Any cables, hoses, or connections you can trace

Return your findings as JSON with this structure:
{
  "equipment_detected": [
    {
      "manufacturer": "...",
      "model_number": "...",
      "serial_number": "...",
      "equipment_type": "...",
      "description": "...",
      "confidence": "high|medium|low",
      "location_in_frame": "..."
    }
  ],
  "text_labels": ["..."],
  "observations": "Any other relevant observations about the engine bay",
  "image_quality": "good|fair|poor|blurry",
  "lighting": "good|dim|dark|overexposed"
}

If the frame is blurry, dark, or you can't identify anything, return minimal JSON with observations explaining why."""


def extract_frames(video_path: Path, output_dir: Path, interval_seconds: float = 2.0) -> list:
    """Extract frames from video at specified interval."""

    output_dir.mkdir(parents=True, exist_ok=True)

    video_name = video_path.stem
    frame_pattern = output_dir / f"{video_name}_frame_%04d.jpg"

    # Use ffmpeg to extract frames
    cmd = [
        'ffmpeg',
        '-i', str(video_path),
        '-vf', f'fps=1/{interval_seconds}',  # Extract 1 frame every N seconds
        '-q:v', '2',  # High quality JPEG
        '-y',  # Overwrite existing
        str(frame_pattern)
    ]

    print(f"Extracting frames from {video_path.name} every {interval_seconds}s...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"FFmpeg error: {result.stderr}")
        return []

    # Find extracted frames
    frames = sorted(output_dir.glob(f"{video_name}_frame_*.jpg"))
    print(f"Extracted {len(frames)} frames")

    return frames


def analyze_frame(frame_path: Path, client: anthropic.Anthropic) -> dict:
    """Analyze a single frame with Claude Vision."""

    # Read and encode image
    with open(frame_path, 'rb') as f:
        image_data = base64.standard_b64encode(f.read()).decode('utf-8')

    # Call Claude Vision
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_data
                        }
                    },
                    {
                        "type": "text",
                        "text": EQUIPMENT_DETECTION_PROMPT
                    }
                ]
            }
        ]
    )

    # Parse response
    response_text = message.content[0].text

    # Try to extract JSON
    try:
        # Find JSON in response
        start = response_text.find('{')
        end = response_text.rfind('}') + 1
        if start >= 0 and end > start:
            json_str = response_text[start:end]
            result = json.loads(json_str)
            result['_raw_response'] = response_text
            result['_frame'] = frame_path.name
            result['_tokens'] = {
                'input': message.usage.input_tokens,
                'output': message.usage.output_tokens
            }
            return result
    except json.JSONDecodeError:
        pass

    return {
        'equipment_detected': [],
        'observations': response_text,
        '_raw_response': response_text,
        '_frame': frame_path.name,
        '_parse_error': True
    }


def aggregate_detections(all_results: list) -> dict:
    """Aggregate equipment detections across all frames."""

    equipment_map = {}  # Key by manufacturer+model or description

    for result in all_results:
        for equip in result.get('equipment_detected', []):
            # Create a key for deduplication
            key_parts = []
            if equip.get('manufacturer'):
                key_parts.append(equip['manufacturer'].lower())
            if equip.get('model_number'):
                key_parts.append(equip['model_number'].lower())
            if not key_parts and equip.get('equipment_type'):
                key_parts.append(equip['equipment_type'].lower())
            if not key_parts and equip.get('description'):
                key_parts.append(equip['description'][:30].lower())

            key = '_'.join(key_parts) if key_parts else 'unknown'

            if key not in equipment_map:
                equipment_map[key] = {
                    **equip,
                    'seen_in_frames': [],
                    'detection_count': 0
                }

            equipment_map[key]['seen_in_frames'].append(result.get('_frame', 'unknown'))
            equipment_map[key]['detection_count'] += 1

            # Update with higher confidence info if available
            if equip.get('confidence') == 'high':
                for field in ['manufacturer', 'model_number', 'serial_number']:
                    if equip.get(field) and not equipment_map[key].get(field):
                        equipment_map[key][field] = equip[field]

    return {
        'unique_equipment': list(equipment_map.values()),
        'total_detections': sum(e['detection_count'] for e in equipment_map.values()),
        'frames_analyzed': len(all_results)
    }


def main():
    parser = argparse.ArgumentParser(description='Detect equipment in boat videos')
    parser.add_argument('--video', type=str, required=True, help='Path to video file')
    parser.add_argument('--interval', type=float, default=2.0, help='Seconds between frame extractions')
    parser.add_argument('--max-frames', type=int, default=25, help='Maximum frames to analyze')
    parser.add_argument('--skip-extraction', action='store_true', help='Skip extraction, use existing frames')
    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.exists():
        print(f"ERROR: Video not found: {video_path}")
        sys.exit(1)

    if not ANTHROPIC_API_KEY:
        print("ERROR: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    print(f"\n{'='*80}")
    print("VIDEO EQUIPMENT DETECTION TEST")
    print(f"{'='*80}")
    print(f"Video: {video_path.name}")
    print(f"Interval: {args.interval}s")
    print(f"Max frames: {args.max_frames}")

    # Create output directory for this video
    video_output_dir = OUTPUT_DIR / video_path.stem

    # Extract frames
    if args.skip_extraction:
        frames = sorted(video_output_dir.glob("*_frame_*.jpg"))
        print(f"Using {len(frames)} existing frames")
    else:
        frames = extract_frames(video_path, video_output_dir, args.interval)

    if not frames:
        print("No frames extracted!")
        sys.exit(1)

    # Limit frames
    frames = frames[:args.max_frames]
    print(f"Analyzing {len(frames)} frames...")

    # Initialize Claude client
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Analyze each frame
    all_results = []
    total_cost = 0

    for i, frame_path in enumerate(frames, 1):
        print(f"\n[{i}/{len(frames)}] Analyzing {frame_path.name}...")

        try:
            result = analyze_frame(frame_path, client)
            all_results.append(result)

            # Calculate cost (approximate)
            tokens = result.get('_tokens', {})
            cost = (tokens.get('input', 0) * 0.003 + tokens.get('output', 0) * 0.015) / 1000
            total_cost += cost

            # Print summary
            equipment_count = len(result.get('equipment_detected', []))
            quality = result.get('image_quality', 'unknown')
            print(f"    Equipment found: {equipment_count}")
            print(f"    Image quality: {quality}")

            if equipment_count > 0:
                for eq in result['equipment_detected'][:3]:  # Show first 3
                    mfr = eq.get('manufacturer', '?')
                    model = eq.get('model_number', '?')
                    etype = eq.get('equipment_type', '?')
                    print(f"    - {mfr} {model} ({etype})")

        except Exception as e:
            print(f"    ERROR: {e}")
            all_results.append({
                '_frame': frame_path.name,
                '_error': str(e),
                'equipment_detected': []
            })

    # Aggregate results
    print(f"\n{'='*80}")
    print("AGGREGATED RESULTS")
    print(f"{'='*80}")

    summary = aggregate_detections(all_results)

    print(f"\nFrames analyzed: {summary['frames_analyzed']}")
    print(f"Total detections: {summary['total_detections']}")
    print(f"Unique equipment: {len(summary['unique_equipment'])}")
    print(f"Estimated cost: ${total_cost:.3f}")

    print(f"\n{'='*80}")
    print("UNIQUE EQUIPMENT DETECTED")
    print(f"{'='*80}")

    for eq in summary['unique_equipment']:
        print(f"\n  Manufacturer: {eq.get('manufacturer', 'Unknown')}")
        print(f"  Model: {eq.get('model_number', 'Unknown')}")
        print(f"  Type: {eq.get('equipment_type', 'Unknown')}")
        print(f"  Serial: {eq.get('serial_number', 'Not visible')}")
        print(f"  Confidence: {eq.get('confidence', 'Unknown')}")
        print(f"  Seen in {eq.get('detection_count', 0)} frame(s)")
        if eq.get('description'):
            print(f"  Description: {eq['description'][:100]}...")

    # Save results
    results_file = video_output_dir / f"{video_path.stem}_results.json"
    with open(results_file, 'w') as f:
        json.dump({
            'video': str(video_path),
            'frames_analyzed': len(all_results),
            'interval_seconds': args.interval,
            'timestamp': datetime.now().isoformat(),
            'summary': summary,
            'frame_results': all_results,
            'estimated_cost': total_cost
        }, f, indent=2)

    print(f"\nResults saved to: {results_file}")

    return summary


if __name__ == "__main__":
    main()
