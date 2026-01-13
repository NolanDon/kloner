// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import { Folder, File, Play, Upload, X, RefreshCw, MessageSquare, Code, Edit3, Check, RotateCcw } from "lucide-react";
import WebContainerRunner from "./WebContainerRunner";
import AIAgentChat from "./AIAgentChat";
import KlonerLoader from "./KlonerLoader";

type FileNode = {
    name: string;
    type: "file" | "folder";
    children?: FileNode[];
    content?: string;
};

type AppData = {
    id: string;
    name: string;
    files: { [path: string]: { content: string; lastModified: number } };
    vercelProjectId?: string;
    previewUrl?: string;
};

function FileTree({ nodes, onFileSelect, prefix = "" }: {
    nodes: FileNode[];
    onFileSelect: (path: string) => void;
    prefix?: string;
}) {
    return (
        <ul>
            {nodes.map((node) => (
                <li key={node.name}>
                    <div
                        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-100"
                        onClick={() => node.type === "file" && onFileSelect(prefix + node.name)}
                    >
                        {node.type === "folder" ? (
                            <Folder className="w-4 h-4" />
                        ) : (
                            <File className="w-4 h-4" />
                        )}
                        <span>{node.name}</span>
                    </div>
                    {node.children && (
                        <FileTree
                            nodes={node.children}
                            onFileSelect={onFileSelect}
                            prefix={prefix + node.name + "/"}
                        />
                    )}
                </li>
            ))}
        </ul>
    );
}

export default function AppBuilderEditor({ appId, onClose, onDeploy }: {
    appId: string;
    onClose: () => void;
    onDeploy?: (app: { id: string; name: string }) => void;
}) {
    const [app, setApp] = useState<AppData | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [code, setCode] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [viewMode, setViewMode] = useState<"ai" | "code">("ai"); // Default to AI chat
    const [isRenaming, setIsRenaming] = useState(false);
    const [tempName, setTempName] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isDeploying, setIsDeploying] = useState(false);
    const [leftPanelWidth, setLeftPanelWidth] = useState(500); // Default wider AI chat panel
    const [isResizing, setIsResizing] = useState(false);
    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Load app data
    useEffect(() => {
        const loadApp = async () => {
            try {
                const res = await fetch(`/api/app-builder/${appId}/files`);
                if (!res.ok) throw new Error("Failed to load app");
                const data = await res.json();
                setApp(data);
                buildFileTree(data.files);
            } catch (err) {
                console.error(err);
                // If app doesn't exist, close the overlay
                onClose();
            } finally {
                setLoading(false);
            }
        };
        loadApp();
    }, [appId, onClose]);

    // Load panel width from localStorage on mount
    useEffect(() => {
        const savedWidth = localStorage.getItem('app-builder-left-panel-width');
        if (savedWidth) {
            const width = parseInt(savedWidth, 10);
            if (width >= 300 && width <= 800) { // Reasonable bounds
                setLeftPanelWidth(width);
            }
        }
    }, []);

    // Save panel width to localStorage when it changes
    useEffect(() => {
        localStorage.setItem('app-builder-left-panel-width', leftPanelWidth.toString());
    }, [leftPanelWidth]);

    // Handle resize mouse events
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            
            const container = document.querySelector('[data-app-builder-container]');
            if (!container) return;
            
            const containerRect = container.getBoundingClientRect();
            const newWidth = e.clientX - containerRect.left;
            
            // Constrain width between 300px and 800px
            const constrainedWidth = Math.max(300, Math.min(800, newWidth));
            setLeftPanelWidth(constrainedWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    const buildFileTree = (files: AppData["files"]) => {
        const tree: FileNode[] = [];
        const paths = Object.keys(files);

        paths.forEach((path) => {
            const parts = path.split("/");
            let current = tree;

            parts.forEach((part, index) => {
                let node = current.find((n) => n.name === part);
                if (!node) {
                    node = {
                        name: part,
                        type: index === parts.length - 1 ? "file" : "folder",
                        children: index === parts.length - 1 ? undefined : [],
                    };
                    current.push(node);
                }
                if (node.children) current = node.children;
            });
        });

        setFileTree(tree);
    };

    const handleFileSelect = (path: string) => {
        if (app?.files[path]) {
            setCurrentFile(path);
            setCode(app.files[path].content);
        }
    };

    const handleCodeChange = (value: string | undefined) => {
        const newCode = value || "";
        setCode(newCode);

        // Auto-save after a delay
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(() => {
            handleSave();
        }, 1000);
    };

    const handleFileChangeFromContainer = useCallback((path: string, content: string) => {
        // Update local state
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [path]: { content, lastModified: Date.now() },
            },
        } : null);

        // If this is the currently open file, update the editor
        if (path === currentFile) {
            setCode(content);
        }

        // Auto-save to server
        saveFileToServer(path, content);
    }, [currentFile]);

    const handleFileEditFromAI = useCallback((path: string, content: string) => {
        // Update local state
        setApp((prev) => prev ? {
            ...prev,
            files: {
                ...prev.files,
                [path]: { content, lastModified: Date.now() },
            },
        } : null);

        // If this is the currently open file, update the editor
        if (path === currentFile) {
            setCode(content);
        }

        // Save to server
        saveFileToServer(path, content);
    }, [currentFile]);

    const saveFileToServer = useCallback(async (path: string, content: string) => {
        try {
            const res = await fetch(`/api/app-builder/${appId}/update-file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, content }),
            });
            if (!res.ok) throw new Error("Failed to save");
        } catch (err) {
            console.error("Auto-save failed", err);
        }
    }, [appId]);

    const handleSave = async () => {
        if (!currentFile || !app || isSaving) return;

        setIsSaving(true);
        try {
            const res = await fetch(`/api/app-builder/${appId}/update-file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: currentFile, content: code }),
            });
            if (!res.ok) throw new Error("Failed to save");
            // Update local state
            setApp((prev) => prev ? {
                ...prev,
                files: {
                    ...prev.files,
                    [currentFile]: { content: code, lastModified: Date.now() },
                },
            } : null);
        } catch (err) {
            console.error("Save failed", err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeploy = async () => {
        if (!app || isDeploying) return;

        setIsDeploying(true);
        try {
            if (onDeploy) {
                // Use the deployment wizard
                onDeploy({ id: app.id, name: app.name });
            } else {
                // Fallback to direct API call
                const res = await fetch(`/api/app-builder/${appId}/deploy`, {
                    method: "POST",
                });
                if (!res.ok) throw new Error("Failed to deploy");
                const data = await res.json();
                setApp((prev) => prev ? { ...prev, previewUrl: data.previewUrl } : null);
            }
        } catch (err) {
            console.error("Deploy failed", err);
        } finally {
            // Keep deploy disabled for longer to prevent spam
            setTimeout(() => setIsDeploying(false), 5000);
        }
    };

    const handleRefresh = () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        setRefreshKey(prev => prev + 1);
        // Reset loading state after a short delay
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    const handleRename = async () => {
        if (!app || !tempName.trim()) return;

        try {
            const res = await fetch(`/api/app-builder/${appId}/rename`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: tempName.trim() }),
            });
            if (!res.ok) throw new Error("Failed to rename");
            setApp(prev => prev ? { ...prev, name: tempName.trim() } : null);
            setIsRenaming(false);
        } catch (err) {
            console.error("Rename failed", err);
        }
    };

    const startRename = () => {
        setTempName(app?.name || "");
        setIsRenaming(true);
    };

    const cancelRename = () => {
        setIsRenaming(false);
        setTempName("");
    };

    if (loading) {
        return (
            <KlonerLoader />
        );
    }

    if (!app) {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8">
                    <div className="text-center">App not found</div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm">
            <div className="h-full w-full bg-white flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gray-50">
                    <div className="flex items-center gap-3">
                        {isRenaming ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={tempName}
                                    onChange={(e) => setTempName(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === "Enter") handleRename();
                                        if (e.key === "Escape") cancelRename();
                                    }}
                                    className="px-2 py-1 border rounded text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-accent"
                                    autoFocus
                                />
                                <button
                                    onClick={handleRename}
                                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                                    title="Save name"
                                >
                                    <Check className="w-4 h-4 text-green-600" />
                                </button>
                                <button
                                    onClick={cancelRename}
                                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                                    title="Cancel"
                                >
                                    <RotateCcw className="w-4 h-4 text-red-600" />
                                </button>
                            </div>
                        ) : (
                            <div className="relative group">
                                <h1
                                    className="text-xl font-semibold cursor-pointer hover:text-purple-600 transition-colors"
                                    onClick={startRename}
                                    title="Click to rename"
                                >
                                    {app?.name || "Untitled Project"}
                                </h1>
                                <div className="absolute -right-6 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Edit3 className="w-4 h-4 text-gray-400 hover:text-accent" />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2 items-center">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="px-4 py-2 bg-[#F55F2A] text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all  rounded-full"
                        >
                            <Upload className="w-4 h-4" />
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button
                            onClick={handleRefresh}
                            className="px-4 py-2 bg-[#F55F2A] text-white rounded flex items-center gap-2 rounded-full hover:bg-[#E04E1B]"
                            title="Rebuild app"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Rebuild
                        </button>
                        <button
                            onClick={handleDeploy}
                            disabled={isDeploying}
                            className="px-4 py-2 bg-[#F55F2A] text-white rounded hover:bg-[#E04E1B] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all  rounded-full"
                        >
                            <Upload className="w-4 h-4" />
                            {isDeploying ? "Deploying..." : "Deploy"}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-200 rounded transition-colors"
                            title="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex h-full" data-app-builder-container>
                    {/* Left Panel - AI Chat and Controls */}
                    <div 
                        className="flex flex-col border-r bg-gray-50 flex-shrink-0" 
                        style={{ width: `${leftPanelWidth}px` }}
                    >
                        {/* View Mode Toggle */}
                        <div className="p-3 border-b">
                            <div className="flex bg-white rounded-lg p-1 shadow-sm">
                                <button
                                    onClick={() => setViewMode("ai")}
                                    className={`flex-1 px-2 py-1 rounded text-xs flex items-center justify-center gap-1 ${
                                        viewMode === "ai"
                                            ? "bg-[#F55F2A] text-white"
                                            : "text-gray-600 hover:bg-gray-100"
                                    }`}
                                >
                                    <MessageSquare className="w-3 h-3" />
                                    AI
                                </button>
                                <button
                                    onClick={() => setViewMode("code")}
                                    className={`flex-1 px-2 py-1 rounded text-xs flex items-center justify-center gap-1 ${
                                        viewMode === "code"
                                            ? "bg-[#F55F2A] text-white"
                                            : "text-gray-600 hover:bg-gray-100"
                                    }`}
                                >
                                    <Code className="w-3 h-3" />
                                    Code
                                </button>
                            </div>
                        </div>

                        {/* AI Chat or Code View */}
                        <div className="flex-1">
                            {viewMode === "ai" ? (
                                // AI Chat Interface
                                <AIAgentChat
                                    appId={appId}
                                    files={app.files}
                                    onFileEdit={handleFileEditFromAI}
                                    onServerRefresh={handleRefresh}
                                />
                            ) : (
                                // Code View - File Tree and Editor
                                <div className="h-full flex flex-col">
                                    {/* File Tree */}
                                    <div className="flex-1 border-b p-3 overflow-auto">
                                        <h3 className="font-medium mb-2 text-sm">Files</h3>
                                        <FileTree nodes={fileTree} onFileSelect={handleFileSelect} />
                                    </div>

                                    {/* Code Editor */}
                                    <div className="flex-1">
                                        {currentFile ? (
                                            <Editor
                                                height="100%"
                                                language="javascript"
                                                value={code}
                                                onChange={handleCodeChange}
                                                theme="vs-dark"
                                                options={{
                                                    minimap: { enabled: false },
                                                    fontSize: 12,
                                                    lineNumbers: "off",
                                                    scrollBeyondLastLine: false,
                                                }}
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                                                Select a file to edit
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Resize Handle */}
                    <div
                        className="w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize transition-colors flex-shrink-0"
                        onMouseDown={() => setIsResizing(true)}
                        title="Drag to resize panels"
                    />

                    {/* Right Panel - Browser-like App View */}
                    <div className="flex-1 flex flex-col">
                        {/* Browser Chrome */}
                        <div className="bg-gray-100 border-b px-4 py-2 flex items-center gap-2">
                            <div className="flex gap-1">
                                <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                            </div>
                            {/* <div className="flex-1 bg-white rounded-md px-3 py-1 text-sm text-gray-600 border">
                                localhost:3000
                            </div> */}
                        </div>

                        {/* App Content */}
                        <div className="flex-1 bg-white">
                            {app ? (
                                <WebContainerRunner
                                    key={refreshKey}
                                    appId={appId}
                                    files={app.files}
                                    onFileChange={handleFileChangeFromContainer}
                                />
                            ) : (
                                <KlonerLoader />
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
