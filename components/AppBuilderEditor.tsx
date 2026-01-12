// src/components/AppBuilderEditor.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { Folder, File, Play, Upload, X } from "lucide-react";

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

export default function AppBuilderEditor({ appId, onClose }: { appId: string; onClose: () => void }) {
    const [app, setApp] = useState<AppData | null>(null);
    const [loading, setLoading] = useState(true);
    const [currentFile, setCurrentFile] = useState<string | null>(null);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [code, setCode] = useState<string>("");

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
        setCode(value || "");
    };

    const handleSave = async () => {
        if (!currentFile || !app) return;

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
        }
    };

    const handleDeploy = async () => {
        if (!app) return;
        try {
            const res = await fetch(`/api/app-builder/${appId}/deploy`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to deploy");
            const data = await res.json();
            setApp((prev) => prev ? { ...prev, previewUrl: data.previewUrl } : null);
        } catch (err) {
            console.error("Deploy failed", err);
        }
    };

    if (loading) {
        return (
            <div className="fixed inset-0 z-[16000] bg-black/70 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white rounded-lg p-8">
                    <div className="text-center">Loading app...</div>
                </div>
            </div>
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
                    <h1 className="text-xl font-semibold">{app.name}</h1>
                    <div className="flex gap-2 items-center">
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Save
                        </button>
                        <button
                            onClick={handleDeploy}
                            className="px-4 py-2 bg-green-500 text-white rounded flex items-center gap-2 hover:bg-green-600"
                        >
                            <Upload className="w-4 h-4" />
                            Deploy
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-200 rounded"
                            title="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="flex flex-1">
                    {/* File Tree */}
                    <div className="w-64 border-r p-4">
                        <h2 className="font-semibold mb-2">Files</h2>
                        <FileTree nodes={fileTree} onFileSelect={handleFileSelect} />
                    </div>

                    {/* Code Editor */}
                    <div className="flex-1">
                        {currentFile ? (
                            <Editor
                                height="50vh"
                                language="javascript"
                                value={code}
                                onChange={handleCodeChange}
                                theme="vs-dark"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500">
                                Select a file to edit
                            </div>
                        )}
                    </div>

                    {/* Preview */}
                    <div className="w-1/2 border-l">
                        <div className="p-4 border-b">
                            <h2 className="font-semibold">Preview</h2>
                        </div>
                        <div className="h-full">
                            {app.previewUrl ? (
                                <iframe
                                    src={app.previewUrl}
                                    className="w-full h-full"
                                    title="App Preview"
                                />
                            ) : (
                                <div className="flex items-center justify-center h-full text-gray-500">
                                    Deploy to see preview
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}