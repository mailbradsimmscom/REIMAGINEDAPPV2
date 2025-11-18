#!/usr/bin/env python3
"""
Victron Cerbo GX MQTT Test Script

Connects to Victron Cerbo MQTT broker and prints all incoming messages
for 30 seconds to explore available data.

Usage:
    1. Update MQTT_BROKER with your Cerbo IP address
    2. Run: python3 victron_mqtt_test.py
"""

import paho.mqtt.client as mqtt
import time
import signal
import sys
from datetime import datetime

# ==================== CONFIGURATION ====================

MQTT_BROKER = "192.168.20.193"  # Your Cerbo GX IP address
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60
RUN_DURATION = 30  # seconds

# Subscribe to all Victron topics
# N = Victron installation ID (usually just one installation)
# # = wildcard for all subtopics
MQTT_TOPIC = "N/#"

# ==================== GLOBALS ====================

message_count = 0
start_time = None
client = None

# ==================== MQTT CALLBACKS ====================

def on_connect(client, userdata, flags, rc):
    """Called when connected to MQTT broker"""
    if rc == 0:
        print("=" * 70)
        print(f"✅ Connected to Victron Cerbo at {MQTT_BROKER}:{MQTT_PORT}")
        print(f"📡 Subscribing to: {MQTT_TOPIC}")
        print(f"⏱️  Will run for {RUN_DURATION} seconds...")
        print("=" * 70)
        print()
        print(f"{'TIMESTAMP':<12} {'TOPIC':<50} {'VALUE':<20}")
        print("-" * 70)
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"❌ Connection failed with code {rc}")
        print("   Code meanings:")
        print("   0: Success")
        print("   1: Incorrect protocol version")
        print("   2: Invalid client identifier")
        print("   3: Server unavailable")
        print("   4: Bad username or password")
        print("   5: Not authorized")
        sys.exit(1)


def on_disconnect(client, userdata, rc):
    """Called when disconnected from MQTT broker"""
    if rc != 0:
        print(f"\n⚠️  Unexpected disconnect! Code: {rc}")


def on_message(client, userdata, msg):
    """Called when a message is received"""
    global message_count
    message_count += 1

    # Get current timestamp
    timestamp = datetime.now().strftime("%H:%M:%S")

    # Decode payload
    try:
        value = msg.payload.decode('utf-8')
    except:
        value = f"<binary: {len(msg.payload)} bytes>"

    # Format and print
    topic = msg.topic
    print(f"{timestamp:<12} {topic:<50} {value:<20}")


def on_subscribe(client, userdata, mid, granted_qos):
    """Called when subscription is confirmed"""
    print(f"✅ Subscribed successfully (QoS: {granted_qos[0]})")
    print()


# ==================== SIGNAL HANDLER ====================

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    print("\n")
    print("=" * 70)
    print(f"🛑 Interrupted by user")
    print_summary()
    if client:
        client.disconnect()
        client.loop_stop()
    sys.exit(0)


# ==================== HELPER FUNCTIONS ====================

def print_summary():
    """Print summary of messages received"""
    elapsed = time.time() - start_time if start_time else 0
    print(f"📊 Summary:")
    print(f"   Messages received: {message_count}")
    print(f"   Duration: {elapsed:.1f} seconds")
    if elapsed > 0:
        print(f"   Rate: {message_count/elapsed:.1f} msg/sec")
    print("=" * 70)


# ==================== MAIN ====================

def main():
    """Main function"""
    global client, start_time

    print()
    print("🔌 Victron Cerbo GX MQTT Test")
    print("=" * 70)
    print()

    # Validate broker IP
    if MQTT_BROKER == "192.168.1.XXX":
        print("❌ ERROR: Please update MQTT_BROKER with your Cerbo IP address")
        print("   Edit this file and change line 15:")
        print(f'   MQTT_BROKER = "192.168.1.XXX"  # UPDATE THIS')
        print()
        sys.exit(1)

    # Register signal handler for Ctrl+C
    signal.signal(signal.SIGINT, signal_handler)

    # Create MQTT client (use callback_api_version for paho-mqtt 2.x)
    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION1,
        client_id="victron_test_script"
    )

    # Set callbacks
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    client.on_subscribe = on_subscribe

    try:
        # Connect to broker
        print(f"🔄 Connecting to {MQTT_BROKER}:{MQTT_PORT}...")
        client.connect(MQTT_BROKER, MQTT_PORT, MQTT_KEEPALIVE)

        # Start network loop in background thread
        client.loop_start()

        # Record start time
        start_time = time.time()

        # Run for specified duration
        time.sleep(RUN_DURATION)

        # Stop and disconnect
        print("\n")
        print("=" * 70)
        print(f"⏰ {RUN_DURATION} seconds elapsed")
        print_summary()

        client.loop_stop()
        client.disconnect()

    except ConnectionRefusedError:
        print()
        print("❌ Connection refused!")
        print("   Possible causes:")
        print(f"   - Cerbo not reachable at {MQTT_BROKER}")
        print("   - MQTT not enabled on Cerbo (check VenusOS settings)")
        print("   - Firewall blocking port 1883")
        print("   - Wrong IP address")
        sys.exit(1)

    except Exception as e:
        print()
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
