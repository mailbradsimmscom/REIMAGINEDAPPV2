# python-sidecar/tests/unit/test_fixtures.py
#
# Tests to verify pytest fixtures are working correctly.
# Validates conftest.py setup works as expected.

import pytest


def test_basic_assertion():
    """Basic test to verify pytest is working."""
    assert 1 + 1 == 2


def test_environment_fixture(test_environment):
    """Test that environment fixture sets test values."""
    import os
    assert os.environ.get('OPENAI_API_KEY') == 'sk-test-not-real'


def test_mock_supabase_fixture(mock_supabase):
    """Test that Supabase mock is available."""
    result = mock_supabase.table('test').select('*').execute()
    assert result['data'] == []


def test_mock_openai_fixture(mock_openai):
    """Test that OpenAI mock is available."""
    assert mock_openai.chat.completions.create is not None


@pytest.mark.asyncio
async def test_async_support():
    """Test that async tests work."""
    import asyncio
    await asyncio.sleep(0.01)
    assert True
