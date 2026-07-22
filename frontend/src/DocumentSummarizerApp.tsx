import React, { useState, useCallback, useRef, useEffect } from 'react';
import './styles.css';

// ============================================================================
// Type Definitions
// ============================================================================

interface Document {
  id: string;
  filename: string;
  chunks: number;
  size: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface SessionStats {
  docsLoaded: number;
  memoryUsed: string;
  messagesCount: number;
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
            if (line.startsWith('data: ')) {
              const chunk = line.slice(6);
              fullMessage += chunk;
              onMessageUpdate(fullMessage);
            }
          }

          buffer = lines[lines.length - 1];
        }

        if (buffer.startsWith('data: ')) {
          const chunk = buffer.slice(6);
          fullMessage += chunk;
          onMessageUpdate(fullMessage);
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
  stats: SessionStats;
  onUpload: (files: File[]) => Promise<void>;
  isUploading: boolean;
}

const DocumentPanel: React.FC<DocumentPanelProps> = ({
  documents,
  stats,
  onUpload,
  isUploading,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

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

  return (
    <aside className="document-panel">
      <div className="panel-header">
        <h2 className="panel-title">Documents</h2>
        <button
          className="icon-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Add document"
        >
          +
        </button>
      </div>

      <div
        className={`upload-zone ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
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
            <p className="upload-icon">📁</p>
            <p className="upload-text">Drop or click to upload</p>
          </>
        )}
      </div>

      <div className="documents-list">
        {documents.length === 0 ? (
          <p className="empty-state">No documents loaded</p>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} className="document-card">
              <div className="document-name">{doc.filename}</div>
              <div className="document-meta">
                {doc.size} • {doc.chunks} chunks
              </div>
            </div>
          ))
        )}
      </div>

      <div className="session-info">
        <h3 className="session-title">Session info</h3>
        <div className="session-stats">
          <div className="stat">
            <span className="stat-label">Docs loaded:</span>
            <span className="stat-value">{stats.docsLoaded}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Memory used:</span>
            <span className="stat-value">{stats.memoryUsed}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Messages:</span>
            <span className="stat-value">{stats.messagesCount}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};

// ============================================================================
// Message Component
// ============================================================================

interface MessageItemProps {
  message: Message;
}

const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`message ${isUser ? 'user-message' : 'assistant-message'}`}>
      <div className="message-avatar">
        {isUser ? '👤' : '🤖'}
      </div>
      <div className="message-content">
        <div className="message-text">{message.content}</div>
        <div className="message-time">{formatTime(message.timestamp)}</div>
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
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  isStreaming,
  onSendMessage,
  onQuickAction,
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
          messages.map((msg) => <MessageItem key={msg.id} message={msg} />)
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

const DocumentSummarizerApp: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [stats, setStats] = useState<SessionStats>({
    docsLoaded: 0,
    memoryUsed: '0 MB',
    messagesCount: 0,
  });
  const [modelsInfo, setModelsInfo] = useState<ModelsInfo | null>(null);
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);

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
    } catch (error) {
      alert(`Error switching model: ${error instanceof Error ? error.message : error}`);
    } finally {
      setIsSwitchingModel(false);
    }
  }, []);

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

  // Fetch session stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        setStats((prev) => ({
          ...prev,
          messagesCount: messages.length,
        }));
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [messages.length]);

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
            },
          ]);

          setStats((prev) => ({
            ...prev,
            docsLoaded: prev.docsLoaded + 1,
            memoryUsed: `${Math.round((prev.docsLoaded + 1) * 75)} MB`,
          }));
        }
      } catch (error) {
        alert(`Error uploading files: ${error}`);
      } finally {
        setIsUploading(false);
      }
    },
    []
  );

  const handleSendMessage = useCallback(
    async (query: string) => {
      if (!documents.length) {
        alert('Please upload at least one document first');
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

        setStats((prev) => ({
          ...prev,
          messagesCount: prev.messagesCount + 1,
        }));
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
    [documents.length, stream]
  );

  const handleQuickAction = useCallback(
    async (action: string) => {
      await handleSendMessage(action);
    },
    [handleSendMessage]
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Document Summarizer Agent</h1>
        <ModelSelector
          modelsInfo={modelsInfo}
          onSwitch={handleModelSwitch}
          isSwitching={isSwitchingModel}
        />
      </header>

      <main className="app-main">
        <DocumentPanel
          documents={documents}
          stats={stats}
          onUpload={handleUpload}
          isUploading={isUploading}
        />
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          onQuickAction={handleQuickAction}
        />
      </main>
    </div>
  );
};

export default DocumentSummarizerApp;