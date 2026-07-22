from typing import Any, Dict, List, AsyncGenerator

import anthropic
import httpx

from src.config import settings
from src.memory import ConversationMemory
from src.tools import TOOLS
from src.vector_store import VectorStore


class DocumentAgent:
    def __init__(self):
        self.max_tokens = settings.MAX_TOKENS
        self.memory = ConversationMemory()
        self.vector_store = VectorStore()

        self.provider = settings.LLM_PROVIDER  # "claude" | "ollama"
        self.model = settings.MODEL_NAME if self.provider == "claude" else settings.OLLAMA_MODEL

        self.claude_client = None
        if settings.ANTHROPIC_API_KEY:
            self.claude_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    @property
    def client(self):
        """Backwards-compat: returns the active provider's client."""
        return self.claude_client if self.provider == "claude" else None

    def set_model(self, provider: str, model: str):
        """Switch provider/model at runtime — no restart needed."""
        if provider not in ("claude", "ollama"):
            raise ValueError(f"Unknown provider: {provider}")

        if provider == "claude" and not self.claude_client:
            raise ValueError("ANTHROPIC_API_KEY not configured — cannot switch to Claude.")

        self.provider = provider
        self.model = model

    # ------------------------------------------------------------------
    # Document management
    # ------------------------------------------------------------------

    def add_document(self, doc_id: str, data: Dict[str, Any], chunks: List[str]):
        """Add document metadata to memory and chunks to vector store."""
        self.memory.add_document(doc_id, data)
        self.vector_store.add_document(
            doc_id=doc_id,
            filename=data.get("filename", "unknown"),
            chunks=chunks,
        )

    # ------------------------------------------------------------------
    # Core query (non-streaming)
    # ------------------------------------------------------------------

    async def process_query(self, query: str) -> str:
        self.memory.add_message("user", query)
        if self.provider == "claude":
            return await self._query_claude(query)
        else:
            return await self._query_ollama(query)

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    def stream_query(self, query: str):
        """Claude streaming context manager."""
        return self.client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            system=self._build_system_prompt(query),
            tools=TOOLS,
            messages=self._format_messages(),
        )

    async def stream_query_ollama(self, query: str) -> AsyncGenerator[str, None]:
        """Ollama streaming generator."""
        import json

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self._build_system_prompt(query)},
                *self._format_messages(),
                {"role": "user", "content": query},
            ],
            "stream": True,
            "options": {
                "temperature": settings.TEMPERATURE,
                "num_predict": self.max_tokens,
            },
        }

        full_response = ""
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json=payload,
            ) as response:
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            full_response += chunk
                            yield chunk
                        if data.get("done"):
                            break
                    except Exception:
                        continue

        self.memory.add_message("assistant", full_response)

    # ------------------------------------------------------------------
    # Claude query
    # ------------------------------------------------------------------

    async def _query_claude(self, query: str) -> str:
        system_prompt = self._build_system_prompt(query)
        messages = self._format_messages()

        step = 0
        while step < settings.MAX_REASONING_STEPS:
            step += 1
            response = self.client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system_prompt,
                tools=TOOLS,
                messages=messages,
            )

            if response.stop_reason == "tool_use":
                tool_results = self._handle_tool_calls(response.content)
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": tool_results})
            else:
                text = "".join(
                    block.text for block in response.content if hasattr(block, "text")
                )
                self.memory.add_message("assistant", text)
                return text

        return "Maximum reasoning steps reached."

    # ------------------------------------------------------------------
    # Ollama query (non-streaming fallback)
    # ------------------------------------------------------------------

    async def _query_ollama(self, query: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self._build_system_prompt(query)},
                *self._format_messages(),
                {"role": "user", "content": query},
            ],
            "stream": False,
            "options": {
                "temperature": settings.TEMPERATURE,
                "num_predict": self.max_tokens,
            },
        }

        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        text = data.get("message", {}).get("content", "No response from Ollama.")
        self.memory.add_message("assistant", text)
        return text

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_system_prompt(self, query: str = "") -> str:
        # Get loaded document list
        if self.memory.document_context:
            lines = [
                f"- ID: {doc_id} | File: {data.get('filename', 'unknown')} "
                f"| Chunks: {data.get('chunk_count', '?')}"
                for doc_id, data in self.memory.document_context.items()
            ]
            docs_info = "Loaded documents:\n" + "\n".join(lines)
        else:
            docs_info = "No documents loaded yet."

        # Retrieve relevant chunks from vector store if query provided
        relevant_context = ""
        if query and not self.vector_store.is_empty():
            relevant_context = (
                "\n\nRelevant content retrieved from documents:\n"
                + "=" * 50
                + "\n"
                + self.vector_store.search_and_format(query, k=5)
                + "\n"
                + "=" * 50
            )

        return f"""You are an expert document analyst assistant.

{docs_info}
{relevant_context}

Your capabilities:
- Summarise documents clearly and concisely
- Compare multiple documents and highlight differences
- Extract specific data types (dates, names, figures)
- Generate insights and recommendations
- Answer questions based strictly on document content

Always ground your answers in the retrieved content above. If information is not present, say so."""

    def _format_messages(self) -> List[Dict[str, Any]]:
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.memory.get_recent_messages(20)
        ]

    def _handle_tool_calls(self, content_blocks) -> List[Dict[str, Any]]:
        return [
            {
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": self._execute_tool(block.name, block.input),
            }
            for block in content_blocks
            if block.type == "tool_use"
        ]

    def _execute_tool(self, tool_name: str, tool_input: Dict[str, Any]) -> str:
        doc_ids = tool_input.get("doc_ids") or list(self.memory.document_context.keys())
        question = tool_input.get("question") or tool_input.get("focus") or tool_name

        # Use vector search to get relevant chunks for this tool call
        context = self.vector_store.search_and_format(question, k=6, doc_ids=doc_ids)

        tool_map = {
            "summarize": f"[summarize | style={tool_input.get('style', 'detailed')}]\n{context}",
            "compare_documents": f"[compare | focus={tool_input.get('focus', 'general')}]\n{context}",
            "extract_data": f"[extract | type={tool_input.get('data_type', 'key info')}]\n{context}",
            "generate_insights": f"[insights | focus={tool_input.get('focus_area', 'general')}]\n{context}",
            "query_document": f"[query | question={tool_input.get('question', '')}]\n{context}",
        }
        return tool_map.get(tool_name, f"Unknown tool: {tool_name}")