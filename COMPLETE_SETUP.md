# Complete Setup & Deployment Guide

## Quick Start (5 minutes)

### Backend Setup

```bash
# 1. Install backend dependencies
pip install -r requirements.txt

# 2. Copy .env.example to .env and configure
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY

# 3. Start backend server
python -m uvicorn src.main:app --reload --port 8000

# Backend running at http://localhost:8000
```

### Frontend Setup

```bash
# 1. Navigate to frontend directory
cd frontend

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# Frontend running at http://localhost:3000
```

That's it! Open http://localhost:3000 in your browser.

---

## Project Structure

```
agentic-doc-summarizer/
├── backend/
│   ├── src/
│   │   ├── config.py                 # Settings
│   │   ├── models.py                 # API schemas
│   │   ├── document_processor.py      # PDF/TXT handling
│   │   ├── memory.py                 # Conversation state
│   │   ├── tools.py                  # Tool definitions
│   │   ├── agent.py                  # Agentic loop
│   │   └── main_backend_streaming.py # Updated FastAPI (USE THIS)
│   ├── requirements.txt               # Python dependencies
│   ├── .env.example                  # Config template
│   └── cli.py                         # Command-line interface
│
├── frontend/
│   ├── src/
│   │   ├── DocumentSummarizerApp.tsx # Main component
│   │   ├── styles.css                # Styling
│   │   └── main.tsx                  # Entry point
│   ├── index.html                     # HTML template
│   ├── package.json                  # Dependencies
│   ├── tsconfig.json                 # TypeScript config
│   ├── vite.config.ts                # Build config
│   └── FRONTEND_SETUP.md             # Frontend docs
│
└── COMPLETE_SETUP.md (this file)
```

---

## Backend Setup Details

### Requirements

- Python 3.10+
- pip or poetry
- Anthropic API key

### Installation

```bash
# Create virtual environment
python3.11 -m venv venv

# Activate it
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Create `.env` file:

```bash
# API Configuration
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Deployment mode
MODE=private  # or "public"

# LLM Configuration
LLM_PROVIDER=claude  # or "ollama"
OLLAMA_MODEL=mistral
OLLAMA_BASE_URL=http://localhost:11434

# Storage
STORAGE_TYPE=local  # or "cloud"
LOCAL_STORAGE_PATH=./documents

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=True
```

### Running the Backend

#### Development Mode (with auto-reload)

```bash
python -m uvicorn src.main:app --reload --port 8000
```

#### With Updated Streaming Backend

```bash
# Copy the streaming-enabled backend
cp main_backend_streaming.py src/main.py

# Run it
python -m uvicorn src.main:app --reload --port 8000
```

#### Production Mode

```bash
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Testing Backend

```bash
# Health check
curl http://localhost:8000/health

# Upload document
curl -F "file=@document.pdf" http://localhost:8000/upload

# Test streaming
curl -N http://localhost:8000/test-stream

# Interactive docs
# Open http://localhost:8000/docs in browser
```

---

## Frontend Setup Details

### Requirements

- Node.js 18+
- npm or yarn

### Installation

```bash
cd frontend

# Install dependencies
npm install

# Verify installation
npm run type-check
```

### Development

```bash
# Start dev server with hot reload
npm run dev

# Open http://localhost:3000
```

### Production Build

```bash
# Build optimized version
npm run build

# Output in dist/ directory
# Test locally:
npm run preview
```

### Environment Variables

Create `frontend/.env.local`:

```
VITE_API_URL=http://localhost:8000
```

For production:

```
VITE_API_URL=https://api.example.com
```

---

## Full Workflow

### 1. Upload Documents

**Frontend:**
- Click upload zone or drag files
- Shows progress during processing
- Displays document metadata

**Backend:**
- Receives PDF/TXT files
- Extracts text using PyPDF
- Chunks text intelligently
- Stores in memory

### 2. Ask Questions

**Frontend:**
- Type query or click quick action
- Real-time streaming response
- Messages persist in history

**Backend:**
- Receives query via SSE endpoint
- Builds system prompt with doc context
- Calls Claude API with tools
- Streams response back in real-time

### 3. Agent Reasoning

**Agent Flow:**
```
User Query
    ↓
System Prompt (docs + tools)
    ↓
Claude Reasoning (Think)
    ↓
Tool Selection (Plan)
    ↓
Tool Execution (Act)
    ↓
Response Synthesis (Reflect)
    ↓
Stream to Frontend
```

---

## Deployment

### Local Network

Allow other machines to access your local setup:

```bash
# Backend (accessible from network)
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000

# Frontend (update vite.config.ts)
# Change proxy target to your machine's IP:
# 'http://192.168.x.x:8000'

npm run dev
```

### Docker Deployment

#### Docker Compose (easiest)

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      MODE: private
    volumes:
      - ./documents:/app/documents

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend
    environment:
      VITE_API_URL: http://localhost:8000
```

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

Run:

```bash
export ANTHROPIC_API_KEY=your-key-here
docker-compose up
```

Access:
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API Docs: http://localhost:8000/docs

#### Heroku Deployment

```bash
# Login to Heroku
heroku login

# Create app
heroku create your-app-name

# Set environment variables
heroku config:set ANTHROPIC_API_KEY=your-key

# Deploy backend
git push heroku main

# Frontend to Vercel (see below)
```

#### Vercel Deployment (Frontend Only)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd frontend
vercel

# Configure environment:
# VITE_API_URL = https://your-api.com
```

### AWS Deployment

#### EC2 + ALB Setup

1. **Launch EC2 instance**
   ```bash
   # Ubuntu 22.04 LTS
   # Instance type: t3.medium minimum
   # Security group: Allow 22, 80, 443
   ```

2. **Install software**
   ```bash
   sudo apt update
   sudo apt install -y python3.11 python3-pip nodejs npm docker.io docker-compose

   # Add your user to docker group
   sudo usermod -aG docker $USER
   ```

3. **Deploy with Docker Compose**
   ```bash
   git clone your-repo
   cd your-repo
   export ANTHROPIC_API_KEY=your-key
   docker-compose up -d
   ```

4. **Set up Nginx reverse proxy**
   ```nginx
   upstream backend {
       server localhost:8000;
   }

   upstream frontend {
       server localhost:3000;
   }

   server {
       listen 80;
       server_name yourdomain.com;

       location /api {
           proxy_pass http://backend;
       }

       location / {
           proxy_pass http://frontend;
       }
   }
   ```

5. **SSL with Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```

---

## Monitoring & Debugging

### View Logs

**Backend:**
```bash
# Development
python -m uvicorn src.main:app --log-level debug

# Docker
docker-compose logs -f backend
```

**Frontend:**
- Browser DevTools (F12)
- Network tab for API calls
- Console for errors

### Debug Streaming

Test SSE streaming:

```bash
# Terminal 1: Start backend
python -m uvicorn src.main:app --reload

# Terminal 2: Test streaming
curl -N http://localhost:8000/test-stream

# Should see streaming response
```

### Performance Monitoring

```bash
# Backend performance
python -m cProfile -s cumtime -m uvicorn src.main:app

# Frontend
# Chrome DevTools → Performance tab → Record → Interact → Stop
```

### Common Issues

| Issue | Solution |
|-------|----------|
| CORS errors | Check backend CORS config in main.py |
| API 404 | Check backend is running on 8000 |
| Streaming not working | Verify browser supports EventSource, check SSE headers |
| Memory errors | Reduce MAX_TOKENS in settings, implement vector DB |
| File upload fails | Check LOCAL_STORAGE_PATH exists and is writable |

---

## Performance Optimization

### Quick Wins

1. **Enable response streaming** (already in place)
2. **Parallel document processing** (implemented)
3. **Cache system prompts** (use prompt caching)
4. **Lazy load UI** (React optimization)

### For Production

1. **Add vector database**
   ```bash
   pip install pinecone-client sentence-transformers
   ```

2. **Enable Redis caching**
   ```bash
   pip install redis
   docker run -d -p 6379:6379 redis:latest
   ```

3. **Use cheaper models for simple tasks**
   - Haiku for basic queries
   - Opus only for complex reasoning

4. **Implement rate limiting**
   ```python
   from slowapi import Limiter
   limiter = Limiter(key_func=get_remote_address)
   app.state.limiter = limiter
   ```

---

## Cost Estimation

### API Costs (Monthly)

| Usage Level | API Calls | Cost | Optimization |
|------------|-----------|------|--------------|
| Light | 100 | $0.50 | Prompt caching saves 90% |
| Medium | 1,000 | $5.00 | Use Haiku for 70% queries |
| Heavy | 10,000 | $50.00 | Vector DB reduces tokens 90% |

### Hosting Costs

| Platform | Tier | Cost | Notes |
|----------|------|------|-------|
| Vercel | Pro | $20/mo | Frontend only |
| Heroku | Eco | $7/mo | Full stack |
| AWS | t3.medium | $30/mo | Self-managed |
| DigitalOcean | Basic | $24/mo | Good value |

### Total Monthly (Medium Usage)

- API: $5-10 (with optimizations)
- Hosting: $25-50
- **Total: $30-60/month**

---

## Maintenance

### Regular Tasks

- **Daily**: Monitor error logs
- **Weekly**: Check API usage and costs
- **Monthly**: Update dependencies
- **Quarterly**: Performance audit

### Update Dependencies

```bash
# Backend
pip install --upgrade -r requirements.txt

# Frontend
npm update
npm audit fix
```

### Backup Strategy

```bash
# Backup documents
cp -r documents/ backup/documents_$(date +%Y%m%d)/

# Backup database (if added)
mysqldump -u user -p database > backup_$(date +%Y%m%d).sql
```

---

## Security Checklist

- [ ] API key stored in environment variables only
- [ ] HTTPS enabled in production
- [ ] CORS properly configured
- [ ] Input validation on all endpoints
- [ ] Rate limiting enabled
- [ ] Secrets not committed to git
- [ ] Regular dependency updates
- [ ] Security headers configured
- [ ] File upload validation

---

## Support & Resources

### Documentation
- Frontend: See `frontend/FRONTEND_SETUP.md`
- Backend: See `src/` docstrings
- API: Interactive docs at `/docs` when backend running

### Testing
```bash
# Backend tests
pytest

# Frontend tests
npm test

# Type checking
npm run type-check

# Linting
npm run lint
```

### Getting Help

1. Check the FAQ in documentation
2. Review error messages in logs
3. Test with `test-stream` endpoint
4. Check browser DevTools console
5. Read API documentation at `/docs`

---

## Next Steps

1. ✅ Start backend: `python -m uvicorn src.main:app --reload`
2. ✅ Start frontend: `npm run dev`
3. ✅ Open http://localhost:3000
4. ✅ Upload a document
5. ✅ Ask a question
6. ✅ Watch streaming response

Enjoy building! 🚀
