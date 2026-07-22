# DocSum AI — Agentic Document Summarizer

An AI-powered document analysis agent that summarizes, compares, extracts data from, and generates insights across PDF and TXT documents — with real-time streaming responses and the ability to switch between cloud (Claude) and local (Ollama) LLMs on the fly.

---

## Features

- Upload PDF/TXT documents — drag-and-drop or click to upload
- Real-time streaming chat — responses stream in live via Server-Sent Events
- Semantic search (RAG) — FAISS vector store retrieves the most relevant document chunks for every query, so answers are grounded in actual content
- Switch LLMs on the fly — toggle between Claude (cloud) and Ollama (local, free, private) without restarting the app
- Quick actions — one-click Summarize, Compare, Extract, and Insights
- Runs fully offline — with Ollama, no data ever leaves your machine
- Session stats — track loaded documents, memory usage, and message count

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Python + FastAPI |
| LLM (cloud) | Anthropic Claude API |
| LLM (local) | Ollama (Mistral, Llama 3.1, etc.) |
| Vector search | FAISS + sentence-transformers |
| Document parsing | pypdf |

---

## Project Structure

```
DocSum-AI/
├── backend/
│   ├── src/
│   │   ├── config.py              # Settings (env vars)
│   │   ├── models.py              # Pydantic request/response schemas
│   │   ├── document_processor.py  # PDF/TXT extraction & chunking
│   │   ├── memory.py              # Conversation history
│   │   ├── tools.py               # Agent tool definitions
│   │   ├── vector_store.py        # FAISS semantic search
│   │   ├── agent.py               # Core agentic loop (Claude + Ollama)
│   │   └── main.py                # FastAPI app & endpoints
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── DocumentSummarizerApp.tsx  # Main React app
│   │   ├── styles.css
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
│
└── README.md
```

---

## Setup

### Prerequisites

- Python 3.12
- Node.js 18+
- Ollama (for local/private mode) and/or an Anthropic API key (for Claude)

### 1. Backend

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
MODE=private
LLM_PROVIDER=ollama          # or "claude"
ANTHROPIC_API_KEY=           # required only if using Claude
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral
LOCAL_STORAGE_PATH=./documents
```

Run the server:

```powershell
python -m uvicorn src.main:app --reload --port 8000
```

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### 3. (Optional) Local LLM via Ollama

```powershell
ollama pull mistral
ollama pull llama3.1
```

Any pulled model will automatically appear in the app's model switcher.

---

## Usage

1. Upload a PDF or TXT document
2. Ask a question, or use a quick action (Summarize / Compare / Extract / Insights)
3. Watch the response stream in real time
4. Switch models anytime using the selector in the top-right header

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| /upload | POST | Upload and process a document |
| /documents | GET | List loaded documents |
| /query | POST | Ask a question (non-streaming) |
| /query-stream | POST | Ask a question (SSE streaming) |
| /models | GET | List available Claude/Ollama models |
| /models/switch | POST | Switch active model at runtime |
| /reset | POST | Clear conversation history |
| /clear-all | POST | Clear documents and conversation |
| /health | GET | Health check |

Full interactive API docs available at http://localhost:8000/docs while the backend is running.

---

## How It Works

1. **Upload** — Document is parsed (pypdf for PDF), chunked, and embedded using sentence-transformers. Embeddings are stored in a local FAISS index.
2. **Query** — On each question, the query is embedded and FAISS retrieves the most semantically relevant chunks across loaded documents.
3. **Generate** — Retrieved chunks are injected into the system prompt, then sent to the active LLM (Claude or Ollama) for a grounded response.
4. **Stream** — The response streams back to the frontend via Server-Sent Events for a live, responsive feel.

---

## License

MIT