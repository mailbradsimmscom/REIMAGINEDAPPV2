#!/usr/bin/env python3
"""
Standalone Chat Workflow Performance Test Script

Replicates the EXACT logic from the chat workflow for performance testing.
Measures timing for each step: classification, data retrieval, synthesis.

Usage:
    python test-chat-workflow.py "tell me about my bbq"
    python test-chat-workflow.py "tell me about my bbq" --systems-context '[]'
    python test-chat-workflow.py "tell me about my bbq" --model gpt-5
"""

import asyncio
import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

# Add current directory to path for imports (script is in python-sidecar/)
# This allows imports from app module
sys.path.insert(0, str(Path(__file__).parent))

# Load environment variables (same logic as main.py)
try:
    from dotenv import load_dotenv
    env_paths = ['.env', '../.env', '../../.env']
    for env_path in env_paths:
        if os.path.exists(env_path):
            load_dotenv(env_path)
            break
except ImportError:
    # dotenv not installed - try to continue with system env vars
    # But warn that .env file won't be loaded
    import sys
    print("⚠️  Warning: python-dotenv not found.", file=sys.stderr)
    print("   Install with: pip install python-dotenv", file=sys.stderr)
    print("   Continuing with system environment variables only...", file=sys.stderr)

# Import workflow components (same pattern as other test scripts)
try:
    from app.chat.services.llm_service import LLMService
    from app.chat.services.dip_retriever import DIPRetriever
    from app.chat.services.production_dip_retriever import ProductionDIPRetriever
    from app.chat.workflows.chat_workflow_sequential import ChatWorkflowSequential
    from app.pinecone_client import PineconeClient
    print("✅ Imports successful", flush=True)
except Exception as e:
    print(f"❌ Import error: {e}", flush=True)
    import traceback
    traceback.print_exc()
    sys.exit(1)


class WorkflowTimer:
    """Detailed timing for each workflow step"""
    
    def __init__(self):
        self.timings: Dict[str, float] = {}
        self.start_time: Optional[datetime] = None
        self.current_step: Optional[str] = None
        self.step_start: Optional[datetime] = None
    
    def start(self):
        """Start overall timing"""
        self.start_time = datetime.now()
        print("=" * 80)
        print("🚀 CHAT WORKFLOW PERFORMANCE TEST")
        print("=" * 80)
        print()
    
    def start_step(self, step_name: str):
        """Start timing a specific step"""
        if self.step_start:
            raise ValueError(f"Step '{self.current_step}' not ended before starting '{step_name}'")
        self.current_step = step_name
        self.step_start = datetime.now()
        print(f"📌 STEP: {step_name}")
        print(f"   Started at: {self.step_start.strftime('%H:%M:%S.%f')[:-3]}")
    
    def end_step(self) -> float:
        """End timing current step and return duration in milliseconds"""
        if not self.current_step or not self.step_start:
            raise ValueError("No active step to end")
        
        step_end = datetime.now()
        duration_ms = (step_end - self.step_start).total_seconds() * 1000
        self.timings[self.current_step] = duration_ms
        
        print(f"   ✅ Completed in: {duration_ms:.2f}ms")
        print()
        
        step_name = self.current_step
        self.current_step = None
        self.step_start = None
        
        return duration_ms
    
    def end(self) -> float:
        """End overall timing and return total duration in milliseconds"""
        if not self.start_time:
            raise ValueError("Timer not started")
        
        end_time = datetime.now()
        total_duration_ms = (end_time - self.start_time).total_seconds() * 1000
        
        print("=" * 80)
        print("📊 TIMING SUMMARY")
        print("=" * 80)
        
        # Sort steps by occurrence order
        sorted_steps = [
            "Classification",
            "Data Retrieval",
            "OpenAI Synthesis",
            "Perplexity Query",
            "Response Assembly",
            "Total"
        ]
        
        total_workflow = 0
        for step in sorted_steps:
            if step == "Total":
                continue
            if step in self.timings:
                total_workflow += self.timings[step]
                duration = self.timings[step]
                percentage = (duration / total_duration_ms * 100) if total_duration_ms > 0 else 0
                print(f"  {step:25s} {duration:8.2f}ms ({percentage:5.1f}%)")
        
        print(f"  {'Total':25s} {total_duration_ms:8.2f}ms (100.0%)")
        print()
        
        # Identify bottlenecks
        if len(self.timings) > 0:
            max_step = max(self.timings.items(), key=lambda x: x[1])
            print(f"🐌 Slowest step: {max_step[0]} ({max_step[1]:.2f}ms)")
            print()
        
        return total_duration_ms


async def run_workflow_test(
    query: str,
    systems_context: Optional[List[Dict[str, Any]]] = None,
    synthesis_model: Optional[str] = None,
    thread_id: Optional[str] = None
):
    """Run the chat workflow with detailed timing"""
    
    timer = WorkflowTimer()
    timer.start()
    
    try:
        # Initialize services (exact same as main.py)
        print("🔧 Initializing services...")
        init_start = datetime.now()
        
        # DIP Retriever
        dip_environment = os.getenv('DIP_ENVIRONMENT', 'staging').lower()
        if dip_environment == 'production':
            dip_retriever = ProductionDIPRetriever()
            print(f"   ✅ Production DIP Retriever initialized")
        else:
            dip_retriever = DIPRetriever()
            print(f"   ✅ Staging DIP Retriever initialized")
        
        # LLM Service
        llm_service = LLMService()
        print(f"   ✅ LLM Service initialized")
        
        # Pinecone Client
        pinecone_client = PineconeClient()
        print(f"   ✅ Pinecone Client initialized")
        
        # Workflow
        workflow = ChatWorkflowSequential(llm_service, dip_retriever, pinecone_client)
        print(f"   ✅ Chat Workflow initialized")
        
        init_duration = (datetime.now() - init_start).total_seconds() * 1000
        print(f"   ⏱️  Initialization: {init_duration:.2f}ms")
        print()
        
        # Prepare inputs
        systems_context = systems_context or []
        
        print(f"📝 Query: {query}")
        print(f"📦 Systems context: {len(systems_context)} items")
        if systems_context:
            for i, system in enumerate(systems_context[:3]):  # Show first 3
                print(f"   {i+1}. {system.get('manufacturer', '')} {system.get('model', '')}")
            if len(systems_context) > 3:
                print(f"   ... and {len(systems_context) - 3} more")
        print()
        
        # Run workflow with timing hooks
        # Initialize state (same as workflow.process_chat)
        state = {
            "user_query": query,
            "thread_id": thread_id,
            "systems_context": systems_context,
            "conversation_summary": None,
            "memory_context": None,
            "synthesis_model": synthesis_model,
            "classification": None,
            "primary_equipment": None,
            "secondary_equipment": [],
            "dip_results": [],
            "pinecone_results": None,
            "final_response": None,
            "response_score": None,
            "processing_steps": [],
            "start_time": datetime.now(),
            "error": None
        }
        
        timer.start_step("Classification")
        state = await workflow._classify_query(state)
        classification_duration = timer.end_step()
        state["classification_duration_ms"] = classification_duration
        
        if state.get("error"):
            print(f"❌ Classification failed: {state['error']}")
            return
        
        timer.start_step("Data Retrieval")
        state = await workflow._retrieve_data(state)
        data_retrieval_duration = timer.end_step()
        state["pinecone_duration_ms"] = data_retrieval_duration
        
        if state.get("error"):
            print(f"❌ Data retrieval failed: {state['error']}")
            return
        
        # Run OpenAI and Perplexity in parallel with timing
        print("⚡ Starting parallel OpenAI + Perplexity...")
        parallel_start = datetime.now()
        
        # Create tasks
        openai_task = asyncio.create_task(workflow._synthesize_response(state))
        perplexity_task = asyncio.create_task(workflow._query_perplexity(state))
        
        # Wait for first to complete
        done, pending = await asyncio.wait(
            [openai_task, perplexity_task],
            return_when=asyncio.FIRST_COMPLETED
        )
        
        first_complete = datetime.now()
        first_duration = (first_complete - parallel_start).total_seconds() * 1000
        
        openai_done = openai_task in done
        perplexity_done = perplexity_task in done
        
        # Get results
        openai_result = None
        perplexity_result = None
        
        if openai_done:
            timer.start_step("OpenAI Synthesis")
            try:
                openai_result = await openai_task
                timer.end_step()
                if isinstance(openai_result, dict):
                    response_text = openai_result.get("final_response", "")
                    print(f"   ✅ OpenAI response: {len(response_text)} chars")
                else:
                    print(f"   ⚠️  OpenAI result is not a dict: {type(openai_result)}")
            except Exception as e:
                timer.end_step()
                print(f"   ❌ OpenAI failed: {e}")
                openai_result = e
        
        if perplexity_done:
            timer.start_step("Perplexity Query")
            try:
                perplexity_result = await perplexity_task
                timer.end_step()
                if perplexity_result:
                    answer = perplexity_result.get("answer", "")
                    print(f"   ✅ Perplexity response: {len(answer)} chars, {len(perplexity_result.get('citations', []))} citations")
                else:
                    print(f"   ⚠️  Perplexity result is None")
            except Exception as e:
                timer.end_step()
                print(f"   ❌ Perplexity failed: {e}")
                perplexity_result = None
        
        # Wait for remaining task
        if not openai_done:
            timer.start_step("OpenAI Synthesis (wait)")
            try:
                openai_result = await openai_task
                timer.end_step()
                if isinstance(openai_result, dict):
                    response_text = openai_result.get("final_response", "")
                    print(f"   ✅ OpenAI response: {len(response_text)} chars")
            except Exception as e:
                timer.end_step()
                print(f"   ❌ OpenAI failed: {e}")
                openai_result = e
        
        if not perplexity_done:
            timer.start_step("Perplexity Query (wait)")
            try:
                perplexity_result = await perplexity_task
                timer.end_step()
                if perplexity_result:
                    answer = perplexity_result.get("answer", "")
                    print(f"   ✅ Perplexity response: {len(answer)} chars, {len(perplexity_result.get('citations', []))} citations")
            except Exception as e:
                timer.end_step()
                print(f"   ❌ Perplexity failed: {e}")
                perplexity_result = None
        
        # Assemble response
        timer.start_step("Response Assembly")
        state = await workflow._assemble_response(openai_result, perplexity_result, state)
        timer.end_step()
        
        # Print results
        print()
        print("=" * 80)
        print("📄 RESPONSE")
        print("=" * 80)
        final_response = state.get("final_response", "")
        print(final_response[:500] + ("..." if len(final_response) > 500 else ""))
        print()
        
        # Timing summary
        timer.end()
        
        # Performance analysis
        if openai_done and perplexity_done:
            print("=" * 80)
            print("⚡ PARALLEL EXECUTION ANALYSIS")
            print("=" * 80)
            openai_duration = timer.timings.get("OpenAI Synthesis", 0) or timer.timings.get("OpenAI Synthesis (wait)", 0)
            perplexity_duration = timer.timings.get("Perplexity Query", 0) or timer.timings.get("Perplexity Query (wait)", 0)
            parallel_total = max(openai_duration, perplexity_duration)
            sequential_total = openai_duration + perplexity_duration
            saved = sequential_total - parallel_total
            
            print(f"   OpenAI: {openai_duration:.2f}ms")
            print(f"   Perplexity: {perplexity_duration:.2f}ms")
            print(f"   Sequential would take: {sequential_total:.2f}ms")
            print(f"   Parallel took: {parallel_total:.2f}ms")
            print(f"   ⚡ Time saved: {saved:.2f}ms ({saved/sequential_total*100:.1f}%)")
            print()
            
            if openai_duration < perplexity_duration:
                print(f"   ✅ OpenAI was faster (return first, append Perplexity later)")
            else:
                print(f"   ✅ Perplexity was faster (consider reversing logic)")
            print()
        
    except Exception as e:
        print()
        print("=" * 80)
        print(f"❌ ERROR: {e}")
        print("=" * 80)
        import traceback
        traceback.print_exc()
        sys.exit(1)


def parse_systems_context(arg: str) -> List[Dict[str, Any]]:
    """Parse systems_context JSON string"""
    try:
        return json.loads(arg)
    except json.JSONDecodeError as e:
        print(f"❌ Error parsing systems_context JSON: {e}")
        sys.exit(1)


def main():
    # Print to stderr so we can see it even if stdout is buffered
    import sys
    print("🚀 Starting test script...", file=sys.stderr, flush=True)
    print(f"Python version: {sys.version}", file=sys.stderr, flush=True)
    print(f"Working directory: {os.getcwd()}", file=sys.stderr, flush=True)
    
    parser = argparse.ArgumentParser(
        description="Test chat workflow with detailed timing",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic test
  python test-chat-workflow.py "tell me about my bbq"
  
  # With systems context
  python test-chat-workflow.py "tell me about my watermaker" \\
    --systems-context '[{"manufacturer":"Schenker","model":"zen_150_watermaker_48v"}]'
  
  # With specific model
  python test-chat-workflow.py "tell me about my bbq" --model gpt-5
        """
    )
    
    parser.add_argument("query", help="User query to process")
    parser.add_argument(
        "--systems-context",
        type=str,
        default=None,
        help="Systems context as JSON array (default: empty)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Synthesis model override (e.g., gpt-5, gpt-4o)"
    )
    parser.add_argument(
        "--thread-id",
        type=str,
        default=None,
        help="Optional thread ID"
    )
    
    args = parser.parse_args()
    
    systems_context = parse_systems_context(args.systems_context) if args.systems_context else []
    
    # Run async workflow
    asyncio.run(run_workflow_test(
        query=args.query,
        systems_context=systems_context,
        synthesis_model=args.model,
        thread_id=args.thread_id
    ))


if __name__ == "__main__":
    main()
