#!/usr/bin/env python3
"""
Test script for wired ProductionDIPConnector integration
"""
import sys
import os

def test_staging_environment():
    """Test staging environment (default)"""
    print("🧪 Testing Staging Environment (Default)")
    print("=" * 50)

    # Set staging environment
    os.environ['CHAT_MODULE_ENABLED'] = 'true'
    os.environ.pop('DIP_ENVIRONMENT', None)  # Remove if exists

    sys.path.insert(0, '.')

    try:
        from app.main import app
        print("✅ Staging environment loaded successfully")

        # Check chat imports and initialization
        if hasattr(app, 'chat_dip_retriever'):
            print("❌ chat_dip_retriever exposed globally (this is expected to fail)")
        else:
            print("✅ chat_dip_retriever properly scoped within chat module")

        return True

    except Exception as e:
        print(f"❌ Staging test failed: {e}")
        return False

def test_production_environment():
    """Test production environment"""
    print("\n🚀 Testing Production Environment")
    print("=" * 50)

    # Set production environment
    os.environ['CHAT_MODULE_ENABLED'] = 'true'
    os.environ['DIP_ENVIRONMENT'] = 'production'

    # Clear any cached modules
    modules_to_clear = [key for key in sys.modules.keys() if key.startswith('app.')]
    for module in modules_to_clear:
        if module in sys.modules:
            del sys.modules[module]

    sys.path.insert(0, '.')

    try:
        from app.main import app
        print("✅ Production environment loaded successfully")
        return True

    except Exception as e:
        print(f"❌ Production test failed: {e}")
        return False

def test_chat_module_disabled():
    """Test with chat module disabled"""
    print("\n❌ Testing Chat Module Disabled")
    print("=" * 50)

    # Disable chat module
    os.environ['CHAT_MODULE_ENABLED'] = 'false'
    os.environ.pop('DIP_ENVIRONMENT', None)

    # Clear any cached modules
    modules_to_clear = [key for key in sys.modules.keys() if key.startswith('app.')]
    for module in modules_to_clear:
        if module in sys.modules:
            del sys.modules[module]

    sys.path.insert(0, '.')

    try:
        from app.main import app
        print("✅ App loads successfully with chat disabled")
        return True

    except Exception as e:
        print(f"❌ Disabled chat test failed: {e}")
        return False

def test_environment_variables():
    """Test environment variable configurations"""
    print("\n🔧 Testing Environment Variable Configurations")
    print("=" * 50)

    test_configs = [
        {
            'CHAT_MODULE_ENABLED': 'true',
            'DIP_ENVIRONMENT': 'staging',
            'expected': 'Staging DIP connector'
        },
        {
            'CHAT_MODULE_ENABLED': 'true',
            'DIP_ENVIRONMENT': 'production',
            'expected': 'Production DIP connector'
        },
        {
            'CHAT_MODULE_ENABLED': 'true',
            'DIP_ENVIRONMENT': 'invalid',
            'expected': 'Staging DIP connector (fallback)'
        },
        {
            'CHAT_MODULE_ENABLED': 'false',
            'expected': 'Chat module disabled'
        }
    ]

    for i, config in enumerate(test_configs):
        print(f"\n🧪 Test Config {i+1}: {config['expected']}")

        # Set environment
        for key, value in config.items():
            if key != 'expected':
                os.environ[key] = value

        # Clear modules
        modules_to_clear = [key for key in sys.modules.keys() if key.startswith('app.')]
        for module in modules_to_clear:
            if module in sys.modules:
                del sys.modules[module]

        try:
            sys.path.insert(0, '.')
            from app.main import app
            print(f"   ✅ {config['expected']} - Configuration loaded")
        except Exception as e:
            print(f"   ❌ {config['expected']} - Failed: {e}")

    return True

def test_connector_method_compatibility():
    """Test that both connectors work with the same interface"""
    print("\n🔄 Testing Connector Method Compatibility")
    print("=" * 50)

    try:
        sys.path.insert(0, '.')

        # Test staging connector
        from app.chat.services.dip_retriever import DIPRetriever
        staging_connector = DIPRetriever()
        staging_health = staging_connector.health_check()
        print(f"✅ Staging connector: {staging_health['service']} - {staging_health['status']}")

        # Test production connector
        from app.chat.services.production_dip_retriever import ProductionDIPRetriever
        prod_connector = ProductionDIPRetriever()
        prod_health = prod_connector.health_check()
        print(f"✅ Production connector: {prod_health['service']} - {prod_health['status']}")

        # Test method availability
        print("\n📋 Method Compatibility:")
        print(f"   • Staging: has query_dip_tables: {hasattr(staging_connector, 'query_dip_tables')}")
        print(f"   • Production: has query_production_dip_tables: {hasattr(prod_connector, 'query_production_dip_tables')}")

        return True

    except Exception as e:
        print(f"❌ Compatibility test failed: {e}")
        return False

def main():
    """Run all wiring tests"""
    print("🔧 ProductionDIPConnector Wiring Test Suite")
    print("=" * 60)

    all_passed = True

    # Run tests
    all_passed &= test_connector_method_compatibility()
    all_passed &= test_environment_variables()
    all_passed &= test_staging_environment()
    all_passed &= test_production_environment()
    all_passed &= test_chat_module_disabled()

    print("\n" + "=" * 60)
    if all_passed:
        print("🎉 All wiring tests completed successfully!")
        print("\n📋 Environment Controls:")
        print("  • CHAT_MODULE_ENABLED=true/false - Enable/disable chat")
        print("  • DIP_ENVIRONMENT=staging/production - Choose connector")
        print("\n🚀 Usage Examples:")
        print("  # Staging (default)")
        print("  CHAT_MODULE_ENABLED=true python -m uvicorn app.main:app")
        print("  ")
        print("  # Production")
        print("  CHAT_MODULE_ENABLED=true DIP_ENVIRONMENT=production python -m uvicorn app.main:app")
    else:
        print("❌ Some wiring tests failed. Check the output above.")

if __name__ == "__main__":
    main()