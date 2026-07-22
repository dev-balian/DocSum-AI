import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import DocumentSummarizerApp from './DocumentSummarizerApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
        <DocumentSummarizerApp />
  </StrictMode>,
)
