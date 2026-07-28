# DocSum AI — Complete Setup Guide

A step-by-step walkthrough to get DocSum AI running from scratch on Windows, covering the backend, frontend, optional local LLM support, and common issues you may hit along the way.

> For a feature overview, see [README.md](./README.md). For a full history of changes, see [CHANGELOG.md](./CHANGELOG.md).

---

## 1. Prerequisites

Install these before starting:

| Requirement | Version | Notes |
|---|---|---|
| Python | **3.12** | Python 3.14 is **not** supported — `pydantic-core` has no precompiled wheel for it yet, and building from source requires a Rust toolchain most machines don't have |
| Node.js | 18+ | Includes `npm` |
| Git | Any recent version | For version control |
| Ollama *(optional)* | Latest | Only needed for local/offline LLM mode — [download here](https://ollama.com/download) |
| Anthropic API key *(optional)* | — | Only needed for Claude (cloud) mode — [get one here](https://console.anthropic.com/settings/billing) |

You need **at least one** of Ollama or an Anthropic API key to actually query documents. You can set up both and switch between them anytime in the app.

---

## 2. Project Structure

Make sure your project folder looks like this before starting:

```
DocSum-AI/
├── backend/
│   └── src/
│       ├── config.py
│       ├── models.py
│       ├── document_processor.py
│       ├── memory.py
│       ├── tools.py
│       ├── vector_store.py
│       ├── agent.py
│       ├── main.py
│       └── __init__.py        (empty file — required)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── DocumentSummarizerApp.tsx
│       ├── styles.css
│       └── main.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── .gitignore
├── README.md
├── CHANGELOG.md
└── SETUP_GUIDE.md
```

---

## 3. Backend Setup

Open PowerShell and navigate to the `backend/` folder:

```powershell
cd "D:\AI Agents\Document Summeriser\backend"
```

### 3.1 — Create and activate a virtual environment

```powershell
python -m venv venv
venv\Scripts\activate
```

Your prompt should now show `(venv)` at the start of the line. If `python` resolves to the wrong version, check with:

```powershell
python --version
```

It must say **3.12.x**. If it shows 3.14 or another version, install Python 3.12 from [python.org](https://www.python.org/downloads/) (Windows 64-bit installer) and make sure it's the one on your `PATH`.

### 3.2 — Install dependencies

```powershell
pip install -r requirements.txt
```

This installs FastAPI, Uvicorn, Anthropic's SDK, `pypdf`, `httpx`, `faiss-cpu`, and `sentence-transformers` (the last one downloads a small embedding model, ~90MB, the first time it's used — not during `pip install`).

### 3.3 — Configure environment variables

Create a file named `.env` inside `backend/` (same folder as `requirements.txt`):

```env
MODE=private
LLM_PROVIDER=ollama
ANTHROPIC_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral
LOCAL_STORAGE_PATH=./documents
```

- Set `LLM_PROVIDER=claude` and fill in `ANTHROPIC_API_KEY` if you want to start with Claude instead of Ollama. Either way, you can switch models live in the app later — this is just the starting default.
- `LOCAL_STORAGE_PATH` is where uploaded files, extracted images, and the FAISS vector index get stored on disk.

### 3.4 — Start the backend

```powershell
python -m uvicorn src.main:app --reload --port 8000
```

You should see output ending in something like:

```
🚀 Mode: private | LLM: ollama
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Leave this terminal running. Verify it's alive by opening **http://localhost:8000/health** in a browser — you should get a JSON response.

---

## 4. Frontend Setup

Open a **second** PowerShell window (keep the backend running in the first one) and navigate to `frontend/`:

```powershell
cd "D:\AI Agents\Document Summeriser\frontend"
```

### 4.1 — Install dependencies

```powershell
npm install
```

If you hit a peer-dependency error (usually an unrelated ESLint version conflict), use:

```powershell
npm install --legacy-peer-deps
```

### 4.2 — Start the dev server

```powershell
npm run dev
```

You should see:

```
VITE ready
➜  Local:   http://localhost:5173/
```

Open **http://localhost:5173** in your browser. You should see the DocSum AI interface.

---

## 5. Optional: Set Up Ollama for Local/Offline Mode

If you want to run entirely offline with no API costs:

### 5.1 — Install Ollama

Download and install from [ollama.com/download](https://ollama.com/download). It runs as a background service after installation.

### 5.2 — Pull a model

In any terminal:

```powershell
ollama pull mistral
```

Optionally pull a stronger model too:

```powershell
ollama pull llama3.1
```

### 5.3 — Verify it's running

```powershell
ollama list
```

You should see `mistral` (and `llama3.1` if pulled) in the list. As long as Ollama is running, any model you've pulled will automatically show up in DocSum AI's model switcher in the top-right of the app — no restart needed.

---

## 6. Verifying the Full Setup

With both servers running:

1. Open **http://localhost:5173**
2. Upload a PDF or TXT file using the upload zone
3. Confirm it appears in the **Documents** sidebar with a chunk count
4. Click **Summarize** (or ask a question)
5. Confirm the response streams in with proper Markdown formatting (headers, bold text)
6. Open the model selector in the header — confirm you see your configured provider(s) listed
7. Check the **Session info** panel updates with document/chunk counts

If all of the above works, your setup is complete.

---

## 7. Common Setup Issues

| Symptom | Cause | Fix |
|---|---|---|
| `pydantic-core` fails to build | Python 3.14 in use | Install Python 3.12, recreate the venv |
| `pip install` fails with a path error | Spaces in your folder path (e.g. `D:\AI Agents\...`) | Quote the path: `pip install -r "D:\AI Agents\...\requirements.txt"`, or just `cd` into the folder first |
| `Attribute "app" not found` on `uvicorn` startup | Missing `src/__init__.py` | Create an empty file at `backend/src/__init__.py` |
| Upload requests hit `:5173` instead of `:8000` and fail | Missing/incomplete Vite proxy config | Ensure `vite.config.ts` has a proxy entry for **every** backend route: `/upload`, `/query-stream`, `/query`, `/documents`, `/models`, `/health`, `/reset`, `/clear-all`, `/status` |
| `git add .` fails with `'backend/' does not have a commit checked out` | A nested `.git` folder exists inside `backend/` | Remove it: `Remove-Item -Path "backend\.git" -Recurse -Force` (PowerShell — not `rmdir /s /q`, that's cmd syntax) |
| `npm install` fails with a peer-dependency conflict | Unrelated ESLint version mismatch | Run `npm install --legacy-peer-deps` |
| "Authentication error" when querying with Claude | Anthropic account has zero API credit | Add credit at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing) (minimum $5) |
| Summarize returns nothing or a generic answer | Backend code out of date / not restarted after an update | Stop and restart `uvicorn` — `--reload` doesn't always catch every change cleanly |
| `405 Method Not Allowed` on `/query-stream` in backend logs | Visiting the endpoint URL directly in a browser (which sends GET) | Ignore it — the app always uses POST correctly; this only happens from manual URL visits |

---

## 8. Everyday Commands Reference

**Start backend:**
```powershell
cd backend
venv\Scripts\activate
python -m uvicorn src.main:app --reload --port 8000
```

**Start frontend:**
```powershell
cd frontend
npm run dev
```

**Exit the Python virtual environment:**
```powershell
deactivate
```

**Pull a new Ollama model:**
```powershell
ollama pull <model-name>
```

---

## 9. Next Steps

Once running, see [README.md](./README.md) for the full feature list — document management (rename/delete/preview/bulk actions), conversation export, live model switching, and more.