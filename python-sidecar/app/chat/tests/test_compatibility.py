"""
Compatibility and integration tests
"""
import pytest
import asyncio
from ..compatibility import get_langgraph_imports, create_workflow
from ..services.dip_retriever import DIPRetriever
from ..chat_models import ChatState

class TestCompatibility:

    def test_langgraph_imports(self):
        """Test LangGraph imports work correctly"""
        imports = get_langgraph_imports()
        assert 'StateGraph' in imports
        assert 'api_version' in imports
        assert imports['api_version'] in ['old', 'new']

    def test_workflow_creation(self):
        """Test workflow can be created"""
        workflow, start, end = create_workflow(ChatState)
        assert workflow is not None
        assert start is not None
        assert end is not None

    @pytest.mark.asyncio
    async def test_dip_retriever_initialization(self):
        """Test DIP retriever can initialize"""
        retriever = DIPRetriever()
        health = retriever.health_check()
        assert 'status' in health
        assert health['service'] == 'DIPRetriever'

    @pytest.mark.asyncio
    async def test_dip_retriever_query(self):
        """Test DIP retriever can handle queries without errors"""
        retriever = DIPRetriever()

        # Should not crash even if Supabase is not available
        results = await retriever.query_dip_tables(
            query="test query",
            table_types=['spec', 'procedure']
        )

        assert isinstance(results, list)

def test_python_version_compatibility():
    """Ensure Python version is supported"""
    import sys
    assert sys.version_info >= (3.8), "Python 3.8+ required"
    assert sys.version_info < (3.13), "Python 3.12 or lower recommended"

def test_pydantic_models():
    """Test Pydantic model creation"""
    from ..chat_models import ChatState, ChatRequest, ChatResponse

    # Test ChatState
    state = ChatState(user_query="test query")
    assert state.user_query == "test query"
    assert state.systems_context == []

    # Test ChatRequest
    request = ChatRequest(query="test")
    assert request.query == "test"

    # Test model validation
    with pytest.raises(Exception):  # Should fail validation
        ChatRequest()  # Missing required query field