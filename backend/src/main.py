import asyncio
import uuid
from pathlib import Path
from typing import AsyncGenerator

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.agent import DocumentAgent
from src.config import settings
from src.document_processor import DocumentProcessor
from src.models import DocumentUploadResponse, QueryRequest


class ModelSwitchRequest(BaseModel):
    provider: str  # "claude" | "ollama"
    model: str      # e.g. "claude-3-5-sonnet-20241022" or "llama3.1"

# ============================================================================
# App setup
# ============================================================================

app = FastAPI(
    title="Agentic Document Summarizer",
    description="AI-powered document analysis and summarization",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Singletons
# ============================================================================

processor = DocumentProcessor()
agent = DocumentAgent()

STORAGE_PATH = Path(settings.LOCAL_STORAGE_PATH)
STORAGE_PATH.mkdir(exist_ok=True)

# ============================================================================
# Startup
# ============================================================================

@app.on_event("startup")
async def startup():
    print(f"🚀 Mode: {settings.MODE} | LLM: {settings.LLM_PROVIDER}")

# ============================================================================
# Health
# ============================================================================

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "mode": settings.MODE,
        "llm_provider": agent.provider,
        "model": agent.model,
        "storage_type": settings.STORAGE_TYPE,
    }

@app.get("/status")
async def status():
    return {
        "documents_loaded": len(agent.memory.document_context),
        "messages": len(agent.memory.messages),
        "provider": agent.provider,
        "model": agent.model,
    }

# ============================================================================
# Model management
# ============================================================================

CLAUDE_MODELS = [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
]

@app.get("/models")
async def list_models():
    """List available models from both providers."""
    ollama_models = []
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            ollama_models = [m["name"] for m in data.get("models", [])]
    except Exception:
        pass  # Ollama not running — just return empty list

    return {
        "current": {"provider": agent.provider, "model": agent.model},
        "claude": {
            "available": bool(agent.claude_client),
            "models": CLAUDE_MODELS,
        },
        "ollama": {
            "available": len(ollama_models) > 0,
            "models": ollama_models,
        },
    }

@app.post("/models/switch")
async def switch_model(request: ModelSwitchRequest):
    """Switch the active LLM provider/model at runtime."""
    try:
        agent.set_model(request.provider, request.model)
    except ValueError as e:
        raise HTTPException(400, str(e))

    return {
        "message": f"Switched to {request.provider}: {request.model}",
        "provider": agent.provider,
        "model": agent.model,
    }

# ============================================================================
# Documents
# ============================================================================

@app.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(file: UploadFile = File(...)):
    allowed = {"application/pdf", "text/plain"}
    if file.content_type not in allowed:
        raise HTTPException(400, f"Unsupported type: {file.content_type}. Use PDF or TXT.")

    file_id = str(uuid.uuid4())[:8]
    file_path = STORAGE_PATH / f"{file_id}_{file.filename}"

    content = await file.read()
    file_path.write_bytes(content)

    try:
        doc = await processor.process_file(str(file_path))
    except Exception as e:
        raise HTTPException(400, f"Processing error: {e}")

    agent.add_document(doc.id, {
        "filename": doc.filename,
        "metadata": doc.metadata,
        "chunk_count": len(doc.chunks),
    }, doc.chunks)

    return DocumentUploadResponse(
        document_id=doc.id,
        filename=doc.filename,
        chunks=len(doc.chunks),
        message="Document processed successfully",
    )


@app.get("/documents")
async def list_documents():
    docs = [
        {
            "id": doc_id,
            "filename": data.get("filename", "unknown"),
            "chunks": data.get("chunk_count", 0),
        }
        for doc_id, data in agent.memory.document_context.items()
    ]
    return {"documents": docs, "count": len(docs)}

# ============================================================================
# Query — non-streaming
# ============================================================================

@app.post("/query")
async def query(request: QueryRequest):
    if not agent.memory.document_context:
        raise HTTPException(400, "No documents loaded. Upload a document first.")
    try:
        response = await agent.process_query(request.query)
        return {"response": response, "status": "success"}
    except Exception as e:
        raise HTTPException(500, f"Query error: {e}")

# ============================================================================
# Query — streaming (SSE)
# ============================================================================

async def sse_generator(query: str) -> AsyncGenerator[str, None]:
    try:
        if agent.provider == "ollama":
            async for chunk in agent.stream_query_ollama(query):
                yield f"data: {chunk}\n\n"
        else:
            with agent.stream_query(query) as stream:
                full_response = ""
                for text_chunk in stream.text_stream:
                    full_response += text_chunk
                    yield f"data: {text_chunk}\n\n"
                agent.memory.add_message("assistant", full_response)
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: Error: {e}\n\n"


@app.post("/query-stream")
async def query_stream(request: QueryRequest):
    if not agent.memory.document_context:
        async def no_docs():
            yield "data: Error: No documents loaded. Upload a document first.\n\n"
        return StreamingResponse(no_docs(), media_type="text/event-stream")

    agent.memory.add_message("user", request.query)

    return StreamingResponse(
        sse_generator(request.query),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ============================================================================
# Conversation management
# ============================================================================

@app.get("/messages")
async def get_messages():
    msgs = [
        {
            "role": m.role,
            "content": m.content,
            "timestamp": m.timestamp.isoformat(),
        }
        for m in agent.memory.messages
    ]
    return {"messages": msgs, "count": len(msgs)}


@app.post("/reset")
async def reset():
    agent.memory.clear()
    return {"message": "Conversation cleared", "documents_retained": len(agent.memory.document_context)}


@app.post("/clear-all")
async def clear_all():
    agent.memory.clear_all()
    return {"message": "All data cleared"}

# ============================================================================
# Dev helpers
# ============================================================================

@app.get("/test-stream")
async def test_stream():
    async def gen():
        for i in range(5):
            yield f"data: Chunk {i + 1} — streaming works!\n\n"
            await asyncio.sleep(0.4)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/")
async def root():
    return {"name": "Agentic Document Summarizer API", "version": "1.0.0", "docs": "/docs"}