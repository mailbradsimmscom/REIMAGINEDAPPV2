# python-sidecar/tests/conftest.py
#
# Pytest fixtures for python-sidecar tests.
# These fixtures provide mocked versions of external services.

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import os


# ============================================
# ENVIRONMENT FIXTURES
# ============================================

@pytest.fixture(autouse=True)
def test_environment():
    """Set test environment variables for all tests."""
    original_env = os.environ.copy()

    # Set test-specific env vars
    os.environ.update({
        'OPENAI_API_KEY': 'sk-test-not-real',
        'ANTHROPIC_API_KEY': 'sk-ant-test-not-real',
        'SUPABASE_URL': 'https://test-placeholder.supabase.co',
        'SUPABASE_SERVICE_KEY': 'test-service-key',
        'PINECONE_API_KEY': 'test-pinecone-key',
    })

    yield

    # Restore original env
    os.environ.clear()
    os.environ.update(original_env)


# ============================================
# DATABASE FIXTURES
# ============================================

@pytest.fixture
def mock_supabase():
    """
    Mock Supabase client for tests that don't need real DB.

    Usage:
        def test_something(mock_supabase):
            mock_supabase.table.return_value.select.return_value.execute.return_value = {
                "data": [{"id": 1, "name": "test"}]
            }
    """
    mock = MagicMock()

    # Default empty responses
    mock.table.return_value.select.return_value.execute.return_value = {"data": [], "error": None}
    mock.table.return_value.insert.return_value.execute.return_value = {"data": None, "error": None}
    mock.table.return_value.update.return_value.execute.return_value = {"data": None, "error": None}
    mock.table.return_value.delete.return_value.execute.return_value = {"data": None, "error": None}

    return mock


# ============================================
# LLM FIXTURES
# ============================================

@pytest.fixture
def mock_openai():
    """
    Mock OpenAI client for tests.

    Usage:
        async def test_chat(mock_openai):
            mock_openai.chat.completions.create.return_value = MagicMock(
                choices=[MagicMock(message=MagicMock(content="Test response"))]
            )
    """
    mock = AsyncMock()

    # Default chat completion response
    default_response = MagicMock()
    default_response.choices = [
        MagicMock(message=MagicMock(content="Mock response from OpenAI"))
    ]
    mock.chat.completions.create.return_value = default_response

    return mock


@pytest.fixture
def mock_anthropic():
    """
    Mock Anthropic client for tests.

    Usage:
        async def test_claude(mock_anthropic):
            mock_anthropic.messages.create.return_value = MagicMock(
                content=[MagicMock(text="Test response")]
            )
    """
    mock = AsyncMock()

    # Default message response
    default_response = MagicMock()
    default_response.content = [MagicMock(text="Mock response from Claude")]
    mock.messages.create.return_value = default_response

    return mock


# ============================================
# VECTOR DB FIXTURES
# ============================================

@pytest.fixture
def mock_pinecone():
    """
    Mock Pinecone client for tests.

    Usage:
        def test_search(mock_pinecone):
            mock_pinecone.query.return_value = {
                "matches": [{"id": "1", "score": 0.9}]
            }
    """
    mock = MagicMock()

    # Default empty search results
    mock.query.return_value = {"matches": []}
    mock.upsert.return_value = {"upserted_count": 0}
    mock.delete.return_value = {}

    return mock


# ============================================
# HTTP FIXTURES
# ============================================

@pytest.fixture
def mock_httpx():
    """
    Mock httpx for external HTTP calls.
    Use respx for more complex HTTP mocking scenarios.
    """
    mock = AsyncMock()
    mock.get.return_value = MagicMock(
        status_code=200,
        json=lambda: {"success": True}
    )
    mock.post.return_value = MagicMock(
        status_code=200,
        json=lambda: {"success": True}
    )
    return mock


# ============================================
# FASTAPI TEST CLIENT
# ============================================

@pytest.fixture
def test_client():
    """
    FastAPI test client for API endpoint testing.

    Usage:
        def test_health(test_client):
            response = test_client.get("/health")
            assert response.status_code == 200
    """
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app)


@pytest.fixture
def async_test_client():
    """
    Async FastAPI test client for async endpoint testing.

    Usage:
        async def test_chat(async_test_client):
            async with async_test_client as client:
                response = await client.post("/v1/chat/process", json={...})
    """
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ============================================
# PYTEST ASYNC CONFIGURATION
# ============================================

# Configure pytest-asyncio to use auto mode
pytest_plugins = ('pytest_asyncio',)


def pytest_configure(config):
    """Configure pytest markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
