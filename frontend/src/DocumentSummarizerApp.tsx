import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

// ============================================================================
// Type Definitions
// ============================================================================

interface Document {
  id: string;
  filename: string;
  chunks: number;
  size: string;
  images?: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface SessionStatus {
  documents_loaded: number;
  messages: number;
  provider: string;
  model: string;
  vector_store: {
    total_chunks_indexed: number;
    documents_indexed: number;
  };
  documents: Array<{
    id: string;
    filename: string;
    chunks: number;
    images: number;
    char_count: number;
  }>;
}

interface ApiResponse {
  response: string;
  status: 'success' | 'error';
}

interface ModelsInfo {
  current: { provider: string; model: string };
  claude: { available: boolean; models: string[] };
  ollama: { available: boolean; models: string[] };
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

const generateId = () => Math.random().toString(36).substring(2, 9);

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// ============================================================================
// Toast Notifications
// ============================================================================

const useToasts = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
};

const ToastContainer: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  const icons: Record<Toast['type'], string> = {
    success: '✅',
    error: '⚠️',
    info: 'ℹ️',
  };

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <span className="toast-icon">{icons[toast.type]}</span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-dismiss" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Streaming Hook
// ============================================================================

const useStreamingMessage = (onMessageUpdate: (content: string) => void) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stream = useCallback(
    async (query: string, apiUrl: string = '/query-stream') => {
      setIsStreaming(true);
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let fullMessage = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            if (!line.startsWith('data: ')) continue;

            const raw = line.slice(6);
            let chunk: string;
            try {
              chunk = JSON.parse(raw);
            } catch {
              // Fallback for any legacy non-JSON payloads
              chunk = raw;
            }

            if (chunk === '[DONE]') continue;

            fullMessage += chunk;
            onMessageUpdate(fullMessage);
          }

          buffer = lines[lines.length - 1];
        }

        if (buffer.startsWith('data: ')) {
          const raw = buffer.slice(6);
          try {
            const chunk = JSON.parse(raw);
            if (chunk !== '[DONE]') {
              fullMessage += chunk;
              onMessageUpdate(fullMessage);
            }
          } catch {
            // ignore trailing partial/invalid payload
          }
        }

        return fullMessage;
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          throw error;
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [onMessageUpdate]
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { stream, isStreaming, cancel };
};

// ============================================================================
// Document Panel Component
// ============================================================================

interface DocumentPanelProps {
  documents: Document[];
  onUpload: (files: File[]) => Promise<void>;
  isUploading: boolean;
  onDelete: (docId: string) => Promise<void>;
  onRename: (docId: string, newName: string) => Promise<void>;
  onPreview: (docId: string) => void;
  onBulkDelete: (docIds: string[]) => Promise<void>;
  onReorder: (newOrder: Document[]) => void;
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({
  documents,
  onUpload,
  isUploading,
  onDelete,
  onRename,
  onPreview,
  onBulkDelete,
  onReorder,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const dragItemIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      ['application/pdf', 'text/plain'].includes(f.type)
    );

    if (files.length > 0) {
      await onUpload(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await onUpload(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startEdit = (doc: Document) => {
    setEditingId(doc.id);
    setEditValue(doc.filename);
  };

  const commitEdit = async (docId: string) => {
    const trimmed = editValue.trim();
    setEditingId(null);
    if (trimmed) {
      await onRename(docId, trimmed);
    }
  };

  const handleDeleteClick = async (docId: string) => {
    if (confirmDeleteId !== docId) {
      setConfirmDeleteId(docId);
      return;
    }
    setDeletingId(docId);
    setConfirmDeleteId(null);
    await onDelete(docId);
    setDeletingId(null);
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };

  const toggleSelected = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === documents.length ? new Set() : new Set(documents.map((d) => d.id))
    );
  };

  const handleBulkDeleteClick = async () => {
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true);
      return;
    }
    setIsBulkDeleting(true);
    await onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setIsBulkDeleting(false);
    setSelectMode(false);
  };

  // --- Drag-to-reorder ---
  const handleDragStart = (index: number) => {
    dragItemIndex.current = index;
  };

  const handleDragOverItem = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDropOnItem = (index: number) => {
    const fromIndex = dragItemIndex.current;
    if (fromIndex === null || fromIndex === index) {
      dragItemIndex.current = null;
      setDragOverIndex(null);
      return;
    }
    const reordered = [...documents];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(index, 0, moved);
    onReorder(reordered);
    dragItemIndex.current = null;
    setDragOverIndex(null);
  };

  return (
    <aside className="document-panel">
      <div className="panel-header">
        <h2 className="panel-title">Documents</h2>
        {documents.length > 0 && (
          <button className="select-mode-btn" onClick={toggleSelectMode}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>

      <div
        className={`upload-zone upload-zone-large ${dragActive ? 'active' : ''}`}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        {isUploading ? (
          <div className="upload-spinner">
            <div className="spinner"></div>
            <p>Uploading...</p>
          </div>
        ) : (
          <>
            <p className="upload-icon-large">📤</p>
            <p className="upload-text-primary">Upload a document</p>
            <p className="upload-text-secondary">Drag & drop, or click to browse</p>
            <p className="upload-text-hint">PDF or TXT</p>
          </>
        )}
      </div>

      {selectMode && documents.length > 0 && (
        <div className="bulk-actions-bar">
          <label className="select-all-label">
            <input
              type="checkbox"
              checked={selectedIds.size === documents.length}
              onChange={toggleSelectAll}
            />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
          </label>
          {selectedIds.size > 0 && (
            <button
              className={`bulk-delete-btn ${confirmBulkDelete ? 'confirm' : ''}`}
              onClick={handleBulkDeleteClick}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting
                ? 'Deleting…'
                : confirmBulkDelete
                ? `✓ Confirm delete (${selectedIds.size})`
                : `🗑️ Delete (${selectedIds.size})`}
            </button>
          )}
        </div>
      )}

      <div className="documents-list">
        {documents.length === 0 ? (
          <p className="empty-state">No documents loaded</p>
        ) : (
          documents.map((doc, index) => (
            <div
              key={doc.id}
              className={`document-card ${deletingId === doc.id ? 'deleting' : ''} ${
                dragOverIndex === index ? 'drag-over' : ''
              }`}
              draggable={!selectMode && editingId !== doc.id}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOverItem(e, index)}
              onDrop={() => handleDropOnItem(index)}
              onDragEnd={() => setDragOverIndex(null)}
            >
              <div className="document-card-header">
                {selectMode && (
                  <input
                    type="checkbox"
                    className="document-select-checkbox"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => toggleSelected(doc.id)}
                  />
                )}

                {!selectMode && <span className="drag-handle" title="Drag to reorder">⠿</span>}

                {editingId === doc.id ? (
                  <input
                    className="document-name-input"
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(doc.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(doc.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <div
                    className="document-name"
                    onClick={() => !selectMode && startEdit(doc)}
                    title={selectMode ? doc.filename : 'Click to rename'}
                  >
                    {doc.filename}
                  </div>
                )}

                {!selectMode && (
                  <div className="document-card-actions">
                    <button
                      className="doc-action-btn"
                      onClick={() => onPreview(doc.id)}
                      title="Preview content"
                    >
                      👁️
                    </button>
                    <button
                      className={`doc-action-btn ${confirmDeleteId === doc.id ? 'confirm-delete' : ''}`}
                      onClick={() => handleDeleteClick(doc.id)}
                      onBlur={() => setConfirmDeleteId(null)}
                      title={confirmDeleteId === doc.id ? 'Click again to confirm' : 'Delete document'}
                    >
                      {confirmDeleteId === doc.id ? '✓ Confirm' : '🗑️'}
                    </button>
                  </div>
                )}
              </div>

              <div className="document-meta">
                {doc.size} • {doc.chunks} chunks
              </div>
              {doc.images && doc.images.length > 0 && (
                <div className="document-thumbnails">
                  {doc.images.slice(0, 4).map((src, i) => (
                    <img key={i} src={src} alt="" className="document-thumbnail" />
                  ))}
                  {doc.images.length > 4 && (
                    <div className="document-thumbnail-more">
                      +{doc.images.length - 4}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <SessionInfoPanel />
    </aside>
  );
};

// ============================================================================
// Session Info Panel (dynamic, self-polling)
// ============================================================================

const SessionInfoPanel: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/status');
        if (!response.ok) return;
        const data: SessionStatus = await response.json();
        setStatus(data);
      } catch {
        // silent — session info is non-critical
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  if (!status) {
    return (
      <div className="session-info">
        <h3 className="session-title">Session info</h3>
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  return (
    <div className="session-info">
      <div className="session-header" onClick={() => setExpanded((v) => !v)}>
        <h3 className="session-title">Session info</h3>
        <span className={`session-provider-badge ${status.provider}`}>
          {status.provider === 'claude' ? '☁️' : '💻'} {status.model}
        </span>
      </div>

      <div className="session-stats">
        <div className="stat">
          <span className="stat-label">Docs loaded:</span>
          <span className="stat-value">{status.documents_loaded}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Chunks indexed:</span>
          <span className="stat-value">{status.vector_store.total_chunks_indexed}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Messages:</span>
          <span className="stat-value">{status.messages}</span>
        </div>
      </div>

      {status.documents.length > 0 && (
        <button className="session-expand-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▲ Hide breakdown' : '▼ Per-document breakdown'}
        </button>
      )}

      {expanded && (
        <div className="session-breakdown">
          {status.documents.map((doc) => (
            <div key={doc.id} className="session-breakdown-item">
              <span className="breakdown-filename">{doc.filename}</span>
              <span className="breakdown-detail">
                {doc.chunks} chunks{doc.images > 0 ? ` • ${doc.images} images` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Message Component
// ============================================================================

interface MessageItemProps {
  message: Message;
  onCopy?: (text: string) => void;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, onCopy }) => {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopyClick = () => {
    if (!onCopy) return;
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={`message ${isUser ? 'user-message' : 'assistant-message'}`}>
      <div className="message-avatar">
        {isUser ? '👤' : '🤖'}
      </div>
      <div className="message-content">
        <div className="message-text">
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content || ' '}
            </ReactMarkdown>
          )}
        </div>
        <div className="message-footer">
          <div className="message-time">{formatTime(message.timestamp)}</div>
          {!isUser && !message.isStreaming && message.content && onCopy && (
            <button
              className={`message-copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopyClick}
              title="Copy response"
            >
              {copied ? (
                <>✅ Copied</>
              ) : (
                <>📋 Copy</>
              )}
            </button>
          )}
        </div>
        {message.isStreaming && <div className="message-indicator">typing...</div>}
      </div>
    </div>
  );
};

// ============================================================================
// Chat Panel Component
// ============================================================================

interface ChatPanelProps {
  messages: Message[];
  isStreaming: boolean;
  onSendMessage: (query: string) => Promise<void>;
  onQuickAction: (action: string) => Promise<void>;
  onCopyMessage?: (text: string) => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  onQuickAction,
  onCopyMessage,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading || isStreaming) return;

    setIsLoading(true);
    try {
      await onSendMessage(inputValue);
      setInputValue('');
      inputRef.current?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    setIsLoading(true);
    try {
      await onQuickAction(action);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-panel">
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="empty-icon">💬</div>
            <h3>No messages yet</h3>
            <p>Upload documents and ask a question to get started</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageItem key={msg.id} message={msg} onCopy={onCopyMessage} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-section">
        <form onSubmit={handleSend} className="input-form">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask a question or give a command..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading || isStreaming}
            className="query-input"
          />
          <button
            type="submit"
            disabled={isLoading || isStreaming || !inputValue.trim()}
            className="send-button"
          >
            {isStreaming ? '⟳' : '→'}
          </button>
        </form>

        <div className="quick-actions">
          <QuickActionButton
            icon="📄"
            label="Summarize"
            onClick={() => handleQuickAction('Summarize all documents')}
            disabled={isLoading || isStreaming}
          />
          <QuickActionButton
            icon="⚖️"
            label="Compare"
            onClick={() => handleQuickAction('Compare the documents')}
            disabled={isLoading || isStreaming}
          />
          <QuickActionButton
            icon="🔍"
            label="Extract"
            onClick={() => handleQuickAction('Extract key data from documents')}
            disabled={isLoading || isStreaming}
          />
          <QuickActionButton
            icon="💡"
            label="Insights"
            onClick={() => handleQuickAction('Generate insights from the documents')}
            disabled={isLoading || isStreaming}
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Quick Action Button Component
// ============================================================================

interface QuickActionButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
}

const QuickActionButton: React.FC<QuickActionButtonProps> = ({
  icon,
  label,
  onClick,
  disabled,
}) => (
  <button
    className="quick-action-btn"
    onClick={onClick}
    disabled={disabled}
    title={label}
  >
    <span className="action-icon">{icon}</span>
    <span className="action-label">{label}</span>
  </button>
);

// ============================================================================
// Model Selector Component
// ============================================================================

interface ModelSelectorProps {
  modelsInfo: ModelsInfo | null;
  onSwitch: (provider: string, model: string) => Promise<void>;
  isSwitching: boolean;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ modelsInfo, onSwitch, isSwitching }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!modelsInfo) return null;

  const currentLabel = modelsInfo.current.model;

  const handleSelect = async (provider: string, model: string) => {
    setIsOpen(false);
    if (provider === modelsInfo.current.provider && model === modelsInfo.current.model) return;
    await onSwitch(provider, model);
  };

  return (
    <div className="model-selector">
      <button
        className="model-selector-trigger"
        onClick={() => setIsOpen((v) => !v)}
        disabled={isSwitching}
      >
        <span className={`provider-dot ${modelsInfo.current.provider}`} />
        <span className="model-selector-label">
          {isSwitching ? 'Switching…' : currentLabel}
        </span>
        <span className="model-selector-caret">▾</span>
      </button>

      {isOpen && (
        <div className="model-selector-dropdown">
          <div className="model-group">
            <div className="model-group-title">
              Claude {!modelsInfo.claude.available && '(no API key)'}
            </div>
            {modelsInfo.claude.models.map((m) => (
              <button
                key={m}
                className={`model-option ${
                  modelsInfo.current.provider === 'claude' && modelsInfo.current.model === m
                    ? 'active'
                    : ''
                }`}
                disabled={!modelsInfo.claude.available}
                onClick={() => handleSelect('claude', m)}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="model-group">
            <div className="model-group-title">
              Ollama (local) {!modelsInfo.ollama.available && '(not running)'}
            </div>
            {modelsInfo.ollama.models.length === 0 && (
              <div className="model-option-empty">No local models found</div>
            )}
            {modelsInfo.ollama.models.map((m) => (
              <button
                key={m}
                className={`model-option ${
                  modelsInfo.current.provider === 'ollama' && modelsInfo.current.model === m
                    ? 'active'
                    : ''
                }`}
                onClick={() => handleSelect('ollama', m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main App Component
// ============================================================================

// ============================================================================
// Document Preview Modal
// ============================================================================

interface DocumentPreview {
  doc_id: string;
  filename: string;
  metadata: Record<string, any>;
  chunk_count: number;
  chunks: string[];
}

interface DocumentPreviewModalProps {
  docId: string;
  onClose: () => void;
}

const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({ docId, onClose }) => {
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeChunk, setActiveChunk] = useState(0);

  useEffect(() => {
    const fetchPreview = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/documents/${docId}/preview`);
        if (!response.ok) throw new Error('Failed to load document preview');
        const data: DocumentPreview = await response.json();
        setPreview(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preview');
      } finally {
        setIsLoading(false);
      }
    };
    fetchPreview();
  }, [docId]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{preview?.filename || 'Document Preview'}</h3>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        {isLoading && (
          <div className="modal-loading">
            <div className="spinner"></div>
            <p>Loading document…</p>
          </div>
        )}

        {error && <div className="modal-error">⚠️ {error}</div>}

        {preview && !isLoading && (
          <>
            <div className="preview-meta-bar">
              <span>{preview.chunk_count} chunks</span>
              {preview.metadata?.page_count && <span>{preview.metadata.page_count} pages</span>}
              {preview.metadata?.char_count && (
                <span>{preview.metadata.char_count.toLocaleString()} characters</span>
              )}
            </div>

            <div className="preview-body">
              <div className="preview-chunk-nav">
                {preview.chunks.map((_, i) => (
                  <button
                    key={i}
                    className={`preview-chunk-tab ${activeChunk === i ? 'active' : ''}`}
                    onClick={() => setActiveChunk(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>

              <div className="preview-chunk-content">
                {preview.chunks[activeChunk] || 'No content available.'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Main App Component
// ============================================================================

const DocumentSummarizerApp: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [modelsInfo, setModelsInfo] = useState<ModelsInfo | null>(null);
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);
  const { toasts, showToast, dismissToast } = useToasts();

  // Fetch available models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch('/models');
        const data: ModelsInfo = await response.json();
        setModelsInfo(data);
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };
    fetchModels();
  }, []);

  const handleModelSwitch = useCallback(async (provider: string, model: string) => {
    setIsSwitchingModel(true);
    try {
      const response = await fetch('/models/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to switch model');
      }

      setModelsInfo((prev) =>
        prev ? { ...prev, current: { provider, model } } : prev
      );
      showToast(`Switched to ${model}`, 'success');
    } catch (error) {
      showToast(
        `Error switching model: ${error instanceof Error ? error.message : error}`,
        'error'
      );
    } finally {
      setIsSwitchingModel(false);
    }
  }, [showToast]);

  const { stream, isStreaming } = useStreamingMessage((content: string) => {
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
        return [
          ...prev.slice(0, -1),
          { ...lastMessage, content, isStreaming: true },
        ];
      }
      return prev;
    });
  });

  // Session info (docs loaded, chunks, provider/model, messages) is now
  // handled by the self-polling SessionInfoPanel component.

  const handleUpload = useCallback(
    async (files: File[]) => {
      setIsUploading(true);
      try {
        for (const file of files) {
          const formData = new FormData();
          formData.append('file', file);

          const response = await fetch('/upload', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
          }

          const data: any = await response.json();

          setDocuments((prev) => [
            ...prev,
            {
              id: data.document_id,
              filename: data.filename,
              chunks: data.chunks,
              size: formatFileSize(file.size),
              images: data.images || [],
            },
          ]);

          showToast(`${file.name} uploaded successfully`, 'success');
        }
      } catch (error) {
        showToast(`Error uploading file: ${error instanceof Error ? error.message : error}`, 'error');
      } finally {
        setIsUploading(false);
      }
    },
    [showToast]
  );

  const handleSendMessage = useCallback(
    async (query: string) => {
      if (!documents.length) {
        showToast('Please upload at least one document first', 'info');
        return;
      }

      // Add user message
      const userMessage: Message = {
        id: generateId(),
        role: 'user',
        content: query,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);

      // Add streaming assistant message
      const assistantMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      try {
        const fullResponse = await stream(query);
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          return [
            ...prev.slice(0, -1),
            { ...lastMsg, content: fullResponse, isStreaming: false },
          ];
        });
      } catch (error) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              isStreaming: false,
            },
          ];
        });
      }
    },
    [documents.length, stream, showToast]
  );

  const handleQuickAction = useCallback(
    async (action: string) => {
      await handleSendMessage(action);
    },
    [handleSendMessage]
  );

  const handleClearConversation = useCallback(async () => {
    try {
      const response = await fetch('/reset', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to clear conversation');
      setMessages([]);
      showToast('Conversation cleared', 'success');
    } catch (error) {
      showToast('Failed to clear conversation', 'error');
    }
  }, [showToast]);

  const handleClearAll = useCallback(async () => {
    try {
      const response = await fetch('/clear-all', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to clear all data');
      setMessages([]);
      setDocuments([]);
      showToast('All data cleared', 'success');
    } catch (error) {
      showToast('Failed to clear all data', 'error');
    }
  }, [showToast]);

  const handleDeleteDocument = useCallback(async (docId: string) => {
    try {
      const response = await fetch(`/documents/${docId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete document');
      const deleted = documents.find((d) => d.id === docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      showToast(`${deleted?.filename || 'Document'} deleted`, 'success');
    } catch (error) {
      showToast('Failed to delete document', 'error');
    }
  }, [documents, showToast]);

  const handleRenameDocument = useCallback(async (docId: string, newName: string) => {
    try {
      const response = await fetch(`/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: newName }),
      });
      if (!response.ok) throw new Error('Failed to rename document');
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, filename: newName } : d))
      );
      showToast('Document renamed', 'success');
    } catch (error) {
      showToast('Failed to rename document', 'error');
    }
  }, [showToast]);

  const [previewDocId, setPreviewDocId] = useState<string | null>(null);

  const handlePreviewDocument = useCallback((docId: string) => {
    setPreviewDocId(docId);
  }, []);

  const handleBulkDeleteDocuments = useCallback(async (docIds: string[]) => {
    if (docIds.length === 0) return;
    try {
      const response = await fetch('/documents/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_ids: docIds }),
      });
      if (!response.ok) throw new Error('Bulk delete failed');
      const data = await response.json();
      setDocuments((prev) => prev.filter((d) => !docIds.includes(d.id)));
      showToast(data.message || `Deleted ${docIds.length} document(s)`, 'success');
    } catch (error) {
      showToast('Failed to delete selected documents', 'error');
    }
  }, [showToast]);

  const handleReorderDocuments = useCallback((newOrder: Document[]) => {
    setDocuments(newOrder);
  }, []);

  const handleExportConversation = useCallback(() => {
    if (messages.length === 0) {
      showToast('No conversation to export yet', 'info');
      return;
    }

    const lines: string[] = [
      `# DocSum AI — Conversation Export`,
      ``,
      `_Exported ${new Date().toLocaleString()}_`,
      ``,
      `**Documents in this session:** ${documents.map((d) => d.filename).join(', ') || 'None'}`,
      ``,
      `---`,
      ``,
    ];

    for (const msg of messages) {
      const speaker = msg.role === 'user' ? '### 🧑 You' : '### 🤖 Assistant';
      lines.push(speaker);
      lines.push(`_${formatTime(msg.timestamp)}_`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docsum-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Conversation exported', 'success');
  }, [messages, documents, showToast]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Document Summarizer Agent</h1>
        <div className="header-actions">
          <button className="header-btn" onClick={handleExportConversation} title="Export conversation as Markdown">
            📥 Export
          </button>
          <button className="header-btn" onClick={handleClearConversation} title="Clear conversation only">
            🗑️ Clear Chat
          </button>
          <button className="header-btn header-btn-danger" onClick={handleClearAll} title="Clear documents and conversation">
            🧹 Clear All
          </button>
          <ModelSelector
            modelsInfo={modelsInfo}
            onSwitch={handleModelSwitch}
            isSwitching={isSwitchingModel}
          />
        </div>
      </header>

      <main className="app-main">
        <DocumentPanel
          documents={documents}
          onUpload={handleUpload}
          isUploading={isUploading}
          onDelete={handleDeleteDocument}
          onRename={handleRenameDocument}
          onPreview={handlePreviewDocument}
          onBulkDelete={handleBulkDeleteDocuments}
          onReorder={handleReorderDocuments}
        />
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          onQuickAction={handleQuickAction}
          onCopyMessage={(text) => {
            navigator.clipboard.writeText(text);
            showToast('Copied to clipboard', 'success');
          }}
        />
      </main>

      {previewDocId && (
        <DocumentPreviewModal docId={previewDocId} onClose={() => setPreviewDocId(null)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default DocumentSummarizerApp;