#!/usr/bin/env python3
"""
Test script for ProductionDIPConnector
"""
import sys
import os
import asyncio

def test_production_connector():
    """Test the ProductionDIPConnector functionality"""
    print("🧪 Testing ProductionDIPConnector")
    print("=" * 50)

    # Add app to path
    sys.path.insert(0, '.')

    try:
        from app.chat.services.production_dip_retriever import ProductionDIPRetriever
        print("✅ ProductionDIPRetriever imported successfully")
    except Exception as e:
        print(f"❌ Import failed: {e}")
        return False

    # Initialize the connector
    try:
        connector = ProductionDIPRetriever()
        print("✅ ProductionDIPRetriever initialized")
    except Exception as e:
        print(f"❌ Initialization failed: {e}")
        return False

    # Test health check
    try:
        health = connector.health_check()
        print(f"✅ Health check: {health['status']}")
        print(f"   Service: {health.get('service', 'Unknown')}")
        print(f"   Supabase: {'✅' if health.get('supabase_available') else '❌'}")
    except Exception as e:
        print(f"❌ Health check failed: {e}")

    return True

async def test_table_validation():
    """Test production table validation"""
    print("\n🔍 Testing Production Table Validation")
    print("-" * 40)

    sys.path.insert(0, '.')

    try:
        from app.chat.services.production_dip_retriever import ProductionDIPRetriever
        connector = ProductionDIPRetriever()

        if not connector.supabase:
            print("⚠️  Supabase not available - validation test skipped")
            return True

        # Test table validation
        print("🔍 Validating production tables...")
        validated_tables = await connector.validate_production_tables()

        if validated_tables:
            print("✅ Production tables found:")
            for table_type, table_name in validated_tables.items():
                print(f"   • {table_type}: {table_name}")
        else:
            print("⚠️  No production tables validated (this is expected if they don't exist)")

        return True

    except Exception as e:
        print(f"❌ Table validation test failed: {e}")
        return False

async def test_query_functionality():
    """Test production query functionality"""
    print("\n🚀 Testing Production Query Functionality")
    print("-" * 40)

    sys.path.insert(0, '.')

    try:
        from app.chat.services.production_dip_retriever import ProductionDIPRetriever
        connector = ProductionDIPRetriever()

        if not connector.supabase:
            print("⚠️  Supabase not available - query test skipped")
            return True

        # Test query with sample data
        test_query = "network troubleshooting"
        table_types = ['spec', 'procedure', 'troubleshooting', 'routing']

        print(f"🔍 Testing query: '{test_query}'")
        print(f"📊 Table types: {table_types}")

        results = await connector.query_production_dip_tables(
            query=test_query,
            table_types=table_types,
            systems_context=[{"asset_uid": "test-asset-123"}]
        )

        print(f"📋 Query results: {len(results)} table(s) returned data")
        for result in results:
            print(f"   • {result['table_type']} ({result['table_name']}): {result['count']} results")

        return True

    except Exception as e:
        print(f"❌ Query test failed: {e}")
        return False

async def test_table_stats():
    """Test production table statistics"""
    print("\n📊 Testing Production Table Statistics")
    print("-" * 40)

    sys.path.insert(0, '.')

    try:
        from app.chat.services.production_dip_retriever import ProductionDIPRetriever
        connector = ProductionDIPRetriever()

        if not connector.supabase:
            print("⚠️  Supabase not available - stats test skipped")
            return True

        print("📊 Getting table statistics...")
        stats = await connector.get_table_stats()

        if "error" in stats:
            print(f"⚠️  Stats error: {stats['error']}")
        else:
            print("✅ Table statistics:")
            for table_type, stat_info in stats.items():
                status = stat_info.get('status', 'unknown')
                if status == 'available':
                    print(f"   • {table_type} ({stat_info['table_name']}): {stat_info['row_count']} rows")
                else:
                    print(f"   • {table_type}: {status} - {stat_info.get('error', 'No details')}")

        return True

    except Exception as e:
        print(f"❌ Stats test failed: {e}")
        return False

def test_comparison_with_staging():
    """Compare production vs staging connectors"""
    print("\n🔄 Testing Production vs Staging Comparison")
    print("-" * 40)

    sys.path.insert(0, '.')

    try:
        from app.chat.services.production_dip_retriever import ProductionDIPRetriever
        from app.chat.services.dip_retriever import DIPRetriever

        prod_connector = ProductionDIPRetriever()
        staging_connector = DIPRetriever()

        print("✅ Both connectors initialized")

        # Compare health checks
        prod_health = prod_connector.health_check()
        staging_health = staging_connector.health_check()

        print(f"📊 Production connector: {prod_health['service']} - {prod_health['status']}")
        print(f"📊 Staging connector: {staging_health['service']} - {staging_health['status']}")

        # Compare table configurations
        print("\n📋 Table Configuration Comparison:")
        print("   Production tables:")
        for table_type, table_name in ProductionDIPRetriever.PRODUCTION_TABLES.items():
            print(f"     • {table_type}: {table_name}")

        print("   Staging tables:")
        for table_type, table_name in DIPRetriever.TABLES.items():
            print(f"     • {table_type}: {table_name}")

        return True

    except Exception as e:
        print(f"❌ Comparison test failed: {e}")
        return False

async def main():
    """Run all tests"""
    print("🧪 ProductionDIPConnector Test Suite")
    print("=" * 60)

    all_passed = True

    # Basic functionality tests
    all_passed &= test_production_connector()
    all_passed &= await test_table_validation()
    all_passed &= await test_query_functionality()
    all_passed &= await test_table_stats()
    all_passed &= test_comparison_with_staging()

    print("\n" + "=" * 60)
    if all_passed:
        print("🎉 All tests completed!")
        print("\n📋 Next Steps:")
        print("1. Review the table validation results")
        print("2. Update table names if needed")
        print("3. Wire ProductionDIPConnector to chat system")
        print("4. Test with real production data")
    else:
        print("❌ Some tests had issues. Check the output above.")

if __name__ == "__main__":
    # Set chat module enabled for testing
    os.environ['CHAT_MODULE_ENABLED'] = 'true'
    asyncio.run(main())