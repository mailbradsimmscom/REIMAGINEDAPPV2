#!/usr/bin/env python3
"""
Test script for chat integration
"""
import sys
import os
import subprocess
import requests
import json

def test_python_version():
    """Test Python version compatibility"""
    print("🐍 Testing Python version compatibility...")
    version = sys.version_info
    print(f"Python version: {version.major}.{version.minor}.{version.micro}")

    if version < (3, 8):
        print("❌ Python 3.8+ required")
        return False
    if version >= (3, 13):
        print("⚠️  Python 3.12 or lower recommended")

    print("✅ Python version compatible")
    return True

def test_chat_module_imports():
    """Test chat module imports"""
    print("\n📦 Testing chat module imports...")

    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

        # Test compatibility layer
        from app.chat.compatibility import get_langgraph_imports
        imports = get_langgraph_imports()
        print(f"✅ LangGraph imports: {imports['api_version']} API")

        # Test DIP retriever
        from app.chat.services.dip_retriever import DIPRetriever
        retriever = DIPRetriever()
        health = retriever.health_check()
        print(f"✅ DIP Retriever: {health['status']}")

        # Test models
        from app.chat.chat_models import ChatRequest, ChatResponse
        request = ChatRequest(query="test")
        print("✅ Pydantic models working")

        return True

    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

def test_server_with_chat():
    """Test server startup with chat enabled"""
    print("\n🚀 Testing server startup with chat enabled...")

    env = os.environ.copy()
    env['CHAT_MODULE_ENABLED'] = 'true'

    try:
        # Start server in background
        process = subprocess.Popen([
            sys.executable, '-c',
            'from app.main import app; import uvicorn; uvicorn.run(app, host="127.0.0.1", port=8001)'
        ], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Give it time to start
        import time
        time.sleep(3)

        # Test health endpoint
        try:
            response = requests.get('http://127.0.0.1:8001/v1/chat/health', timeout=5)
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Chat health endpoint: {data.get('status', 'unknown')}")
                print(f"   Services: {data.get('services', {})}")
                return True
            else:
                print(f"❌ Health endpoint returned {response.status_code}")

        except requests.RequestException as e:
            print(f"❌ Health endpoint failed: {e}")

        finally:
            process.terminate()
            process.wait()

    except Exception as e:
        print(f"❌ Server test failed: {e}")

    return False

if __name__ == "__main__":
    print("🧪 Chat Integration Test Suite")
    print("=" * 50)

    all_passed = True

    all_passed &= test_python_version()
    all_passed &= test_chat_module_imports()
    all_passed &= test_server_with_chat()

    print("\n" + "=" * 50)
    if all_passed:
        print("🎉 All tests passed! Chat integration is ready.")
        print("\nNext steps:")
        print("1. Install chat dependencies: pip install -r requirements-chat.txt")
        print("2. Set environment: export CHAT_MODULE_ENABLED=true")
        print("3. Start server: python app/main.py")
        print("4. Test endpoint: curl http://localhost:8000/v1/chat/health")
    else:
        print("❌ Some tests failed. Check the output above.")
        sys.exit(1)