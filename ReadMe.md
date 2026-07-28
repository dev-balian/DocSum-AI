# DocSum AI — Agentic Document Summarizer

An AI-powered document analysis agent that summarizes, compares, extracts data from, and generates insights across PDF and TXT documents — with real-time streaming responses, semantic search over actual document content, and the ability to switch between cloud (Claude) and local (Ollama) LLMs on the fly.

> See [CHANGELOG.md](./CHANGELOG.md) for a full history of changes and fixes.

---

## Features

- Upload PDF/TXT documents — drag-and-drop or click to upload
- Real-time streaming chat — responses stream in live via Server-Sent Events
- Semantic search (RAG) — FAISS vector store retrieves the most relevant document chunks for every query, so answers are grounded in actual content
- Per-document breakdown — when multiple documents are loaded, summaries/insights are broken into clearly labeled sections per file, not blended together
- Switch LLMs on the fly — toggle between Claude (cloud) and Ollama (local, free, private) without restarting the app
- Quick actions — one-click Summarize, Compare, Extract, and Insights
- Rich Markdown output — headers, bold terms, tables, clean list nesting, and visually distinct section cards
- PDF image extraction — embedded images shown as thumbnails per document
- Full document management — rename, delete, preview extracted content, multi-select + bulk delete, drag-to-reorder
- Export conversation — download the full chat as a Markdown file
- Live session info — self-updating panel showing documents, indexed chunks, and active model
- Copy-to-clipboard on responses, toast notifications, one-click Clear Chat / Clear All
- Runs fully offline — with Ollama, no data ever leaves your machine

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Markdown rendering | react-markdown + remark-gfm |
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
│   │   ├── document_processor.py  # PDF/TXT extraction, chunking, image extraction
│   │   ├── memory.py              # Conversation + document metadata, rename/remove
│   │   ├── tools.py               # Agent tool definitions
│   │   ├── vector_store.py        # FAISS semantic search (global + per-document)
│   │   ├── agent.py               # Core agentic loop (Claude + Ollama, model switching)
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
├── README.md
└── CHANGELOG.md
```

---

## Setup

### Prerequisites

- Python 3.12 (Python 3.14 is not yet supported — no precompiled `pydantic-core` wheels)
- Node.js 18+
- [Ollama](https://ollama.com/download) (for local/private mode) and/or an [Anthropic API key](https://console.anthropic.com/) (for Claude)

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

Open **http://localhost:5173**

If you hit a peer-dependency error on `npm install` (unrelated ESLint version conflict), use:
```powershell
npm install --legacy-peer-deps
```

### 3. (Optional) Local LLM via Ollama

```powershell
ollama pull mistral
ollama pull llama3.1
```

Any pulled model automatically appears in the app's model switcher — no restart needed.

---

## Usage

1. Upload one or more PDF or TXT documents
2. Ask a question, or use a quick action (Summarize / Compare / Extract / Insights)
3. Watch the response stream in real time, formatted with headers, bold terms, and tables
4. With multiple documents loaded, each gets its own clearly labeled section
5. Manage documents from the sidebar — rename, preview content, delete, or select multiple for bulk delete
6. Switch models anytime using the selector in the top-right header
7. Copy any response with one click; export the whole conversation to Markdown; clear the chat or clear everything from the header buttons

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/upload` | POST | Upload and process a document (extracts text, chunks, images) |
| `/documents` | GET | List loaded documents |
| `/documents/{id}` | PATCH | Rename a document |
| `/documents/{id}` | DELETE | Delete a document (memory, vector store, disk) |
| `/documents/{id}/preview` | GET | Get a document's metadata and full chunk content |
| `/documents/bulk-delete` | POST | Delete multiple documents in one request |
| `/query` | POST | Ask a question (non-streaming) |
| `/query-stream` | POST | Ask a question (SSE streaming) |
| `/models` | GET | List available Claude/Ollama models |
| `/models/switch` | POST | Switch active model at runtime |
| `/reset` | POST | Clear conversation history (keeps documents) |
| `/clear-all` | POST | Clear documents, conversation, and vector store |
| `/status` | GET | Live session stats — docs, chunks, provider/model, per-document breakdown |
| `/health` | GET | Health check (current provider/model) |
| `/document-images/{filename}` | GET | Serve extracted PDF images |

Full interactive API docs available at `http://localhost:8000/docs` while the backend is running.

---

## How It Works

1. **Upload** — Document is parsed (pypdf for PDF), chunked, embedded via `sentence-transformers`, and indexed in a local FAISS store. Embedded images are extracted and saved.
2. **Query** — On each question, the query is embedded. If multiple documents are loaded, each is searched independently (per-document retrieval) so no single document dominates the response.
3. **Generate** — Retrieved chunks are injected directly into the system prompt, along with formatting rules (Markdown structure, per-document sections, list-nesting limits), then sent to the active LLM (Claude or Ollama).
4. **Stream** — The response streams back via Server-Sent Events, JSON-encoded to safely preserve formatting, and renders live as Markdown in the chat.
5. **Manage** — Documents can be renamed, previewed, deleted individually or in bulk, and reordered — all reflected instantly in memory, the vector store, and disk.

---

## License

MIT