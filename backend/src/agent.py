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

    def remove_document(self, doc_id: str) -> bool:
        """Remove a document from memory and the vector store."""
        if doc_id not in self.memory.document_context:
            return False
        self.memory.remove_document(doc_id)
        self.vector_store.remove_document(doc_id)
        return True

    def rename_document(self, doc_id: str, new_filename: str) -> bool:
        """Rename a document across memory and vector store."""
        if not self.memory.rename_document(doc_id, new_filename):
            return False
        self.vector_store.rename_document(doc_id, new_filename)
        return True

    def get_document_preview(self, doc_id: str) -> Dict[str, Any]:
        """Return document metadata plus its chunks, for the preview modal."""
        data = self.memory.document_context.get(doc_id)
        if not data:
            return None

        chunks = self.vector_store.get_document_chunks(doc_id)
        return {
            "doc_id": doc_id,
            "filename": data.get("filename", "unknown"),
            "metadata": data.get("metadata", {}),
            "chunk_count": len(chunks),
            "chunks": [c["text"] for c in chunks],
        }

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
        """Claude streaming context manager.

        No tools are passed here on purpose — relevant document content is
        already retrieved and injected directly into the system prompt via
        _build_system_prompt(). Passing tools to a streaming call risks the
        model silently issuing a tool_use turn with no text and no follow-up
        execution, which produces an empty/truncated stream.
        """
        return self.client.messages.stream(
            model=self.model,
            max_tokens=self.max_tokens,
            system=self._build_system_prompt(query),
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

        # Retrieve relevant chunks from vector store — restricted to
        # documents currently loaded in THIS session only.
        # When multiple documents are loaded, retrieve per-document so no
        # single document dominates/starves the others in a shared top-k search.
        relevant_context = ""
        loaded_doc_ids = list(self.memory.document_context.keys())
        if query and loaded_doc_ids and not self.vector_store.is_empty():
            if len(loaded_doc_ids) > 1:
                retrieved = self.vector_store.search_per_document(
                    query, doc_ids=loaded_doc_ids, k_per_doc=4
                )
            else:
                retrieved = self.vector_store.search_and_format(
                    query, k=5, doc_ids=loaded_doc_ids
                )

            relevant_context = (
                "\n\nRelevant content retrieved from documents:\n"
                + "=" * 50
                + "\n"
                + retrieved
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

Always ground your answers in the retrieved content above. If information is not present, say so.

FORMATTING RULES — always follow these for every response:
- Use Markdown formatting: ## for section headers, **bold** for key terms/names/figures, and bullet or numbered lists for anything with multiple items.
- Break longer answers into clearly labeled sections (e.g. "## Summary", "## Key Points", "## Details") rather than one dense paragraph.
- Use a Markdown table whenever comparing two or more documents or presenting structured data (dates, figures, categories).
- Use light, purposeful symbols to aid scanning — ✅ for confirmed/positive points, ⚠️ for risks or caveats, 📌 for key takeaways — but do not overuse them; a few per response is enough.
- Keep paragraphs short (2-4 sentences). Prefer lists over long prose when listing multiple items.
- Do not pad the response with filler — every section should carry real information.
- LIST NESTING RULE: Never nest bullet lists more than 2 levels deep. For structured records with several fields (e.g. a job entry with company, dates, responsibilities), use a bold inline label on ONE bullet level instead of creating a new nested sub-list per field — for example:
  "- **Senior Developer** — Amdocs India Pvt Ltd, Pune (Oct 2021 – Sept 2025)" followed by a single second-level bullet list of responsibilities, NOT a separate nested bullet for "Company:", another for "Dates:", another for "Responsibilities:". If you do use a second level, indent it with exactly 2 spaces, consistently, every time — never 3, 4, or 6 spaces.
- MULTI-DOCUMENT RULE: If more than one document is loaded and the request is to summarize, extract, or generate insights, ALWAYS give each document its own clearly labeled section using the exact format "## 📄 <filename>" as the header — never merge multiple documents into one blended answer unless the user explicitly asks for a comparison. Only add a final combined section (headed "## 🔗 Combined View") if it adds genuine value beyond the individual breakdowns."""

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

        # For per-document tools with multiple docs loaded, retrieve chunks
        # separately per document so no single document dominates/starves others.
        per_doc_tools = {"summarize", "extract_data", "generate_insights"}

        if tool_name in per_doc_tools and len(doc_ids) > 1:
            context = self.vector_store.search_per_document(question, doc_ids=doc_ids, k_per_doc=4)
            instruction = (
                "\nIMPORTANT: Multiple documents are loaded. Provide a separate, clearly "
                "labeled section for EACH document below (use '## <filename>' as the section "
                "header), before any combined summary or comparison."
            )
        else:
            context = self.vector_store.search_and_format(question, k=6, doc_ids=doc_ids)
            instruction = ""

        tool_map = {
            "summarize": f"[summarize | style={tool_input.get('style', 'detailed')}]{instruction}\n{context}",
            "compare_documents": f"[compare | focus={tool_input.get('focus', 'general')}]\n{context}",
            "extract_data": f"[extract | type={tool_input.get('data_type', 'key info')}]{instruction}\n{context}",
            "generate_insights": f"[insights | focus={tool_input.get('focus_area', 'general')}]{instruction}\n{context}",
            "query_document": f"[query | question={tool_input.get('question', '')}]\n{context}",
        }
        return tool_map.get(tool_name, f"Unknown tool: {tool_name}")