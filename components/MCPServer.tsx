// components/MCPServer.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Database, Server, Plus, X, Play, Settings } from "lucide-react";

type DatabaseConnection = {
    id: string;
    name: string;
    type: "postgresql" | "mysql" | "mongodb" | "sqlite";
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    status: "connected" | "disconnected" | "connecting";
};

type MCPServerProps = {
    onDatabaseConnect: (connection: DatabaseConnection) => void;
    onDatabaseDisconnect: (id: string) => void;
};

export default function MCPServer({ onDatabaseConnect, onDatabaseDisconnect }: MCPServerProps) {
    const [connections, setConnections] = useState<DatabaseConnection[]>([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newConnection, setNewConnection] = useState<Partial<DatabaseConnection>>({
        type: "postgresql",
        port: 5432
    });

    // Load saved connections from localStorage
    useEffect(() => {
        const saved = localStorage.getItem("mcp_database_connections");
        if (saved) {
            try {
                setConnections(JSON.parse(saved));
            } catch (error) {
                console.error("Failed to load database connections:", error);
            }
        }
    }, []);

    // Save connections to localStorage
    const saveConnections = useCallback((newConnections: DatabaseConnection[]) => {
        localStorage.setItem("mcp_database_connections", JSON.stringify(newConnections));
        setConnections(newConnections);
    }, []);

    const testConnection = async (connection: DatabaseConnection) => {
        // Update status to connecting
        const updatedConnections = connections.map(c =>
            c.id === connection.id ? { ...c, status: "connecting" as const } : c
        );
        setConnections(updatedConnections);

        try {
            // In a real implementation, this would test the actual database connection
            // For now, we'll simulate a successful connection
            await new Promise(resolve => setTimeout(resolve, 1000));

            const successConnection = { ...connection, status: "connected" as const };
            const finalConnections = connections.map(c =>
                c.id === connection.id ? successConnection : c
            );
            saveConnections(finalConnections);
            onDatabaseConnect(successConnection);
        } catch (error) {
            const failedConnection = { ...connection, status: "disconnected" as const };
            const finalConnections = connections.map(c =>
                c.id === connection.id ? failedConnection : c
            );
            saveConnections(finalConnections);
        }
    };

    const addConnection = () => {
        if (!newConnection.name || !newConnection.host || !newConnection.database) {
            alert("Please fill in all required fields");
            return;
        }

        const connection: DatabaseConnection = {
            id: `db_${Date.now()}`,
            name: newConnection.name!,
            type: newConnection.type as DatabaseConnection["type"],
            host: newConnection.host!,
            port: newConnection.port || 5432,
            database: newConnection.database!,
            username: newConnection.username || "",
            password: newConnection.password || "",
            status: "disconnected"
        };

        saveConnections([...connections, connection]);
        setNewConnection({ type: "postgresql", port: 5432 });
        setShowAddForm(false);
    };

    const removeConnection = (id: string) => {
        const updatedConnections = connections.filter(c => c.id !== id);
        saveConnections(updatedConnections);
        onDatabaseDisconnect(id);
    };

    const disconnectConnection = (id: string) => {
        const updatedConnections = connections.map(c =>
            c.id === id ? { ...c, status: "disconnected" as const } : c
        );
        saveConnections(updatedConnections);
        onDatabaseDisconnect(id);
    };

    return (
        <div className="bg-gray-50 border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-blue-500" />
                    <h3 className="font-semibold">MCP Database Server</h3>
                </div>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm flex items-center gap-1 hover:bg-blue-600"
                >
                    <Plus className="w-4 h-4" />
                    Add DB
                </button>
            </div>

            {/* Add Connection Form */}
            {showAddForm && (
                <div className="mb-4 p-3 bg-white border rounded">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Name</label>
                            <input
                                type="text"
                                value={newConnection.name || ""}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                                placeholder="My Database"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Type</label>
                            <select
                                value={newConnection.type}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, type: e.target.value as DatabaseConnection["type"] }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                            >
                                <option value="postgresql">PostgreSQL</option>
                                <option value="mysql">MySQL</option>
                                <option value="mongodb">MongoDB</option>
                                <option value="sqlite">SQLite</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Host</label>
                            <input
                                type="text"
                                value={newConnection.host || ""}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, host: e.target.value }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                                placeholder="localhost"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Port</label>
                            <input
                                type="number"
                                value={newConnection.port || 5432}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, port: parseInt(e.target.value) }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Database</label>
                            <input
                                type="text"
                                value={newConnection.database || ""}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, database: e.target.value }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                                placeholder="mydb"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Username</label>
                            <input
                                type="text"
                                value={newConnection.username || ""}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, username: e.target.value }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                            />
                        </div>
                        <div className="col-span-2">
                            <label className="block text-sm font-medium mb-1">Password</label>
                            <input
                                type="password"
                                value={newConnection.password || ""}
                                onChange={(e) => setNewConnection(prev => ({ ...prev, password: e.target.value }))}
                                className="w-full px-2 py-1 border rounded text-sm"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={addConnection}
                            className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                        >
                            Add Connection
                        </button>
                        <button
                            onClick={() => setShowAddForm(false)}
                            className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Connections List */}
            <div className="space-y-2">
                {connections.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No database connections</p>
                        <p className="text-xs">Add a database to connect your app</p>
                    </div>
                ) : (
                    connections.map((connection) => (
                        <div key={connection.id} className="flex items-center justify-between p-3 bg-white border rounded">
                            <div className="flex items-center gap-3">
                                <Database className="w-5 h-5 text-gray-600" />
                                <div>
                                    <div className="font-medium text-sm">{connection.name}</div>
                                    <div className="text-xs text-gray-500">
                                        {connection.type} • {connection.host}:{connection.port} • {connection.database}
                                    </div>
                                </div>
                                <div className={`px-2 py-1 rounded text-xs ${
                                    connection.status === "connected"
                                        ? "bg-green-100 text-green-700"
                                        : connection.status === "connecting"
                                        ? "bg-yellow-100 text-yellow-700"
                                        : "bg-red-100 text-red-700"
                                }`}>
                                    {connection.status}
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                {connection.status === "connected" ? (
                                    <button
                                        onClick={() => disconnectConnection(connection.id)}
                                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                                        title="Disconnect"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => testConnection(connection)}
                                        className="p-1 text-green-500 hover:bg-green-50 rounded"
                                        title="Connect"
                                        disabled={connection.status === "connecting"}
                                    >
                                        <Play className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={() => removeConnection(connection.id)}
                                    className="p-1 text-gray-500 hover:bg-gray-50 rounded"
                                    title="Remove"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}