#!/usr/bin/env python3
"""
Simple test to measure ACTUAL OpenAI synthesis timing
"""

import asyncio
import os
import sys
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))
load_dotenv('../.env')

from app.chat.services.llm_service import LLMService

async def test_synthesis_timing():
    """Test OpenAI synthesis with accurate timing"""

    print("="*80)
    print("🧪 TESTING OPENAI SYNTHESIS TIMING (DIRECT CALL)")
    print("="*80)
    print()

    # Initialize LLM service
    llm_service = LLMService()
    print(f"✅ LLM Service initialized")
    print(f"   Model: {llm_service.openai_model}")
    print()

    # Prepare test data (same as actual workflow)
    user_query = "tell me about my DST810"
    systems_context = [{"manufacturer": "Airmar", "model": "DST810"}]
    classification = {
        "intent": "general_information",
        "confidence": 0.8,
        "complexity_score": 0.5
    }
    dip_results = []
    pinecone_results = None
    conversation_summary = None

    print(f"📝 Query: {user_query}")
    print(f"📦 Equipment: {systems_context[0]['manufacturer']} {systems_context[0]['model']}")
    print()

    # Time the synthesis call
    print("⏱️  Starting synthesis...")
    start_time = datetime.now()

    response = await llm_service.synthesize_response(
        user_query=user_query,
        systems_context=systems_context,
        classification=classification,
        dip_results=dip_results,
        pinecone_results=pinecone_results,
        conversation_summary=conversation_summary,
        synthesis_model=None  # Use default from env
    )

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    print()
    print("="*80)
    print("📊 RESULTS")
    print("="*80)
    print(f"⏱️  Duration: {duration:.2f} seconds ({duration*1000:.0f}ms)")
    print(f"📝 Response length: {len(response)} characters")
    print()
    print("Response preview:")
    print(response[:500])
    print()

if __name__ == "__main__":
    asyncio.run(test_synthesis_timing())
