// src/components/AIAgentChat.tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, RotateCcw, Database, FileText, RefreshCw } from "lucide-react";
import { ensureSessionAndCsrf } from "@/app/login/LoginForm";

type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    type: "text" | "code" | "file-edit";
    restorePointId?: string;
    restoreActionLabel?: string;
};

type Checkpoint = {
    id: string;
    timestamp: Date;
    description: string;
    files: { [path: string]: string };
};

type DatabaseConnection = {
    id: string;
    name: string;
    type: string;
    host: string;
    port: number;
    database: string;
    status: "connected" | "disconnected" | "connecting";
};

type AIAgentChatProps = {
    appId: string;
    files: { [path: string]: { content: string; lastModified: number } };
    onFileEdit: (path: string, content: string) => void;
    onServerRefresh: () => void;
    onFilesReplace?: (files: { [path: string]: { content: string; lastModified: number } }) => void;
};

type RestorePointItem = {
    id: string;
    label: string;
    kept?: boolean;
    createdAt?: any;
    source?: string;
    paths?: string[];
    undoOf?: string | null;
};

export default function AIAgentChat({ appId, files, onFileEdit, onServerRefresh, onFilesReplace }: AIAgentChatProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "assistant",
            content: "Your app is ready! I can help you make changes and improvements. Here are some things I can do:\n\n• Add new features or pages\n• Style and customize the design\n• Connect to databases and APIs\n• Fix bugs or issues\n• Optimize performance\n• Add authentication or user accounts\n\nWhat would you like to change or add to your app?",
            timestamp: new Date(),
            type: "text"
        }
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [currentCheckpoint, setCurrentCheckpoint] = useState<string | null>(null);
    const [databaseConnections, setDatabaseConnections] = useState<DatabaseConnection[]>([]);
    const [restorePoints, setRestorePoints] = useState<RestorePointItem[]>([]);
    const [isRestoreBusy, setIsRestoreBusy] = useState(false);
    const [lastRestorePointId, setLastRestorePointId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = useCallback(() => {
        // Use scrollIntoView as primary method
        setTimeout(() => {
            if (messagesEndRef.current) {
                messagesEndRef.current.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'end',
                    inline: 'nearest' 
                });
            }
        }, 0);
        
        // Fallback: also try setting scrollTop on the container
        setTimeout(() => {
            if (messagesEndRef.current) {
                const container = messagesEndRef.current.parentElement;
                if (container) {
                    container.scrollTop = container.scrollHeight;
                }
                
                // Also try scrollIntoView again as backup
                messagesEndRef.current.scrollIntoView({ 
                    behavior: 'auto', 
                    block: 'end' 
                });
            }
        }, 50);
    }, []);

    // Load chat history on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem(`chat_history_${appId}`);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    const loadedMessages = parsed.map((msg: any) => ({
                        ...msg,
                        timestamp: new Date(msg.timestamp)
                    }));
                    setMessages(loadedMessages);
                } catch (e) {
                    console.error('Failed to load chat history', e);
                }
            }
        }
    }, [appId]);

    const withCsrfHeaders = useCallback(async () => {
        const csrf = await ensureSessionAndCsrf().catch(() => null);
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (csrf) headers["x-csrf"] = String(csrf);
        return headers;
    }, []);

    const fetchRestorePoints = useCallback(async () => {
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/restore-points`, { method: "GET" });
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            if (data?.ok && Array.isArray(data.restorePoints)) {
                setRestorePoints(data.restorePoints);
            }
        } catch {
            // ignore
        }
    }, [appId]);

    const syncFilesFromServer = useCallback(async () => {
        if (!onFilesReplace) return;
        try {
            await ensureSessionAndCsrf().catch(() => null);
            const res = await fetch(`/api/app-builder/${appId}/files`, { method: "GET" });
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            if (data?.files && typeof data.files === "object") {
                onFilesReplace(data.files);
            }
        } catch {
            // ignore
        }
    }, [appId, onFilesReplace]);

    useEffect(() => {
        fetchRestorePoints();
    }, [fetchRestorePoints]);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // Save chat history whenever messages change
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`chat_history_${appId}`, JSON.stringify(messages));
        }
    }, [messages, appId]);

    const createCheckpoint = useCallback((description: string) => {
        const checkpointId = `checkpoint_${Date.now()}`;
        const checkpoint: Checkpoint = {
            id: checkpointId,
            timestamp: new Date(),
            description,
            files: Object.fromEntries(
                Object.entries(files).map(([path, file]) => [path, file.content])
            ),
        };
        setCheckpoints(prev => [...prev, checkpoint]);
        setCurrentCheckpoint(checkpointId);
    }, [files]);

    const handleDatabaseConnect = useCallback((connection: DatabaseConnection) => {
        setDatabaseConnections(prev => [...prev.filter(c => c.id !== connection.id), connection]);
    }, []);

    const handleDatabaseDisconnect = useCallback((id: string) => {
        setDatabaseConnections(prev => prev.filter(c => c.id !== id));
    }, []);

    const applyRestorePoint = useCallback(async (restoreId: string, statusMessage?: string) => {
        if (!restoreId || isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetch(
                `/api/app-builder/${appId}/restore-points/${restoreId}/apply`,
                { method: "POST", headers, body: JSON.stringify({}) }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                throw new Error(data?.error || "Failed to apply restore point");
            }

            const newId = typeof data?.newRestorePointId === "string" ? data.newRestorePointId : null;
            if (newId) setLastRestorePointId(newId);

            setMessages(prev => [
                ...prev,
                {
                    id: `restore_${Date.now()}`,
                    role: "assistant",
                    content: `${statusMessage || "Applied restore point"}.` + (newId ? " (Redo available)" : ""),
                    timestamp: new Date(),
                    type: "text",
                    restorePointId: newId || undefined,
                    restoreActionLabel: newId ? "Redo" : undefined,
                },
            ]);

            await Promise.all([fetchRestorePoints(), syncFilesFromServer()]);
            onServerRefresh();
        } catch (err) {
            console.error("Apply restore point failed", err);
            setMessages(prev => [
                ...prev,
                {
                    id: `restore_err_${Date.now()}`,
                    role: "assistant",
                    content: "Sorry — I couldn't apply that restore point.",
                    timestamp: new Date(),
                    type: "text",
                },
            ]);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, isRestoreBusy, onServerRefresh, syncFilesFromServer, withCsrfHeaders]);

    const getStatusMessageForAction = useCallback((label?: string) => {
        const v = (label || "").toLowerCase();
        if (v === "undo") return "Undid change";
        if (v === "redo") return "Redid change";
        return "Applied restore point";
    }, []);

    const keepRestorePoint = useCallback(async (restoreId: string) => {
        if (!restoreId || isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetch(
                `/api/app-builder/${appId}/restore-points/${restoreId}/keep`,
                { method: "POST", headers, body: JSON.stringify({}) }
            );
            if (!res.ok) throw new Error("Failed to keep restore point");
            await fetchRestorePoints();
        } catch (err) {
            console.error("Keep restore point failed", err);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, isRestoreBusy, withCsrfHeaders]);

    const createManualRestorePoint = useCallback(async () => {
        if (isRestoreBusy) return;
        setIsRestoreBusy(true);
        try {
            const headers = await withCsrfHeaders();
            const res = await fetch(
                `/api/app-builder/${appId}/restore-points`,
                { method: "POST", headers, body: JSON.stringify({ label: "Manual restore point" }) }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to create restore point");
            const rid = typeof data?.restorePointId === "string" ? data.restorePointId : null;
            if (rid) setLastRestorePointId(rid);

            setMessages(prev => [
                ...prev,
                {
                    id: `manual_restore_${Date.now()}`,
                    role: "assistant",
                    content: "Saved a restore point.",
                    timestamp: new Date(),
                    type: "text",
                    restorePointId: rid || undefined,
                    restoreActionLabel: "Undo",
                },
            ]);

            await fetchRestorePoints();
        } catch (err) {
            console.error("Create restore point failed", err);
        } finally {
            setIsRestoreBusy(false);
        }
    }, [appId, fetchRestorePoints, isRestoreBusy, withCsrfHeaders]);

    const undoLastChange = useCallback(() => {
        if (lastRestorePointId) {
            applyRestorePoint(lastRestorePointId, "Undid last change");
            return;
        }
        if (checkpoints.length > 1) {
            const lastCheckpoint = checkpoints[checkpoints.length - 2];
            setCurrentCheckpoint(lastCheckpoint.id);
            Object.entries(lastCheckpoint.files).forEach(([path, content]) => {
                onFileEdit(path, content);
            });
            setCheckpoints(prev => prev.slice(0, -1));
        }
    }, [applyRestorePoint, checkpoints, lastRestorePointId, onFileEdit]);

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = {
            id: `user_${Date.now()}`,
            role: "user",
            content: input,
            timestamp: new Date(),
            type: "text"
        };

        setMessages(prev => [...prev, userMessage]);
        setInput("");
        setIsLoading(true);

        try {
            const headers = await withCsrfHeaders();

            const res = await fetch("/api/ai-agent", {
                method: "POST",
                headers,
                body: JSON.stringify({
                    message: input,
                    appId,
                    conversationHistory: [...messages.slice(-10), userMessage],
                    databaseConnections
                }),
            });

            if (!res.ok) throw new Error("Failed to get AI response");

            const data = await res.json();
            const aiMessage: Message = {
                id: `ai_${Date.now()}`,
                role: "assistant",
                content: data.response,
                timestamp: new Date(),
                type: "text"
            };

            setMessages(prev => [...prev, aiMessage]);

            // Handle file edits if any
            if (data.fileEdits && data.fileEdits.length > 0) {
                createCheckpoint(`AI edit: ${input.slice(0, 50)}...`);
                data.fileEdits.forEach((edit: { path: string; content: string }) => {
                    onFileEdit(edit.path, edit.content);
                });

                const rid = typeof data?.restorePointId === "string" ? data.restorePointId : null;
                if (rid) {
                    setLastRestorePointId(rid);
                    setMessages(prev => [
                        ...prev,
                        {
                            id: `rp_${Date.now()}`,
                            role: "assistant",
                            content: "Created a restore point for that edit.",
                            timestamp: new Date(),
                            type: "text",
                            restorePointId: rid,
                            restoreActionLabel: "Undo",
                        },
                    ]);
                    fetchRestorePoints();
                }
            }

            // Handle server refresh if requested
            if (data.refreshServer) {
                onServerRefresh();
            }
        } catch (err) {
            console.error("AI chat error:", err);
            const errorMessage: Message = {
                id: `error_${Date.now()}`,
                role: "assistant",
                content: "Sorry, I encountered an error. Please try again.",
                timestamp: new Date(),
                type: "text"
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-gray-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b bg-white flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-6 text-accent" />
                    <h3 className="font-medium text-sm">Agent</h3>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchRestorePoints}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Refresh restore points"
                        disabled={isRestoreBusy}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={createManualRestorePoint}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="Save restore point"
                        disabled={isRestoreBusy}
                    >
                        <FileText className="w-4 h-4" />
                    </button>
                    {(lastRestorePointId || checkpoints.length > 1) && (
                        <button
                            onClick={undoLastChange}
                            className="p-1 hover:bg-gray-200 rounded"
                            title="Undo last change"
                            disabled={isRestoreBusy}
                        >
                            <RotateCcw className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {restorePoints.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-medium text-gray-700">Recent restore points</div>
                            <button
                                onClick={fetchRestorePoints}
                                className="text-xs text-gray-600 hover:text-gray-900"
                                disabled={isRestoreBusy}
                            >
                                Refresh
                            </button>
                        </div>
                        <div className="mt-2 space-y-2">
                            {restorePoints.slice(0, 5).map((rp) => (
                                <div key={rp.id} className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-xs text-gray-800 truncate">{rp.label}</div>
                                        <div className="text-[11px] text-gray-500 truncate">
                                            {rp.id.slice(0, 8)}{rp.kept ? " • kept" : ""}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <button
                                            onClick={() => applyRestorePoint(rp.id, "Applied restore point")}
                                            disabled={isRestoreBusy}
                                            className="px-2 py-1 text-xs bg-gray-50 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            Apply
                                        </button>
                                        <button
                                            onClick={() => keepRestorePoint(rp.id)}
                                            disabled={isRestoreBusy}
                                            className="px-2 py-1 text-xs bg-gray-50 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            Keep
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        <div
                            className={`max-w-[80%] rounded-lg p-3 ${
                                message.role === "user"
                                    ? "bg-purple-50 border border-purple-200 text-gray-900"
                                    : "bg-orange-50 border border-orange-200"
                            }`}
                        >
                            <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
                            {message.restorePointId && (
                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        onClick={() =>
                                            applyRestorePoint(
                                                message.restorePointId!,
                                                getStatusMessageForAction(message.restoreActionLabel)
                                            )
                                        }
                                        disabled={isRestoreBusy}
                                        className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                        title={message.restoreActionLabel || "Apply"}
                                    >
                                        {message.restoreActionLabel || "Apply"}
                                    </button>
                                    <button
                                        onClick={() => keepRestorePoint(message.restorePointId!)}
                                        disabled={isRestoreBusy}
                                        className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                                        title="Keep (do not auto-trim)"
                                    >
                                        Keep
                                    </button>
                                    <span className="text-[11px] text-gray-500">
                                        {message.restorePointId.slice(0, 8)}
                                    </span>
                                </div>
                            )}
                            <div className="text-xs opacity-70 mt-2">
                                {message.timestamp.toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-gray-200 rounded-lg p-3 max-w-[80%]">
                            <div className="flex items-center gap-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent"></div>
                                <span className="text-sm text-gray-600">Thinking...</span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Database Connections */}
            {databaseConnections.length > 0 && (
                <div className="px-4 py-2 border-t bg-white flex-shrink-0">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Database className="w-4 h-4" />
                        <span>Connected databases:</span>
                        {databaseConnections.map((db) => (
                            <span key={db.id} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                                {db.name}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Input */}
            <div className="p-4 border-t bg-white rounded-lg flex-shrink-0">
                <div className="flex gap-2 border border-gray-300">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask me to build something..."
                        className="flex-1 p-3 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={3}
                        disabled={isLoading}
                    />
                    <button
                        onClick={sendMessage}
                        disabled={!input.trim() || isLoading}
                        className="px-3 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Send className="w-6 h-6 text-accent" />
                    </button>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                    Press Enter to send, Shift+Enter for new line
                </div>
            </div>
        </div>
    );
}
