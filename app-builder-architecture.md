# App Builder Architecture

## Overview
This document outlines the MVP architecture for the Next.js App Builder feature, allowing users to create and edit Next.js applications with MCP backend integration and AI agent assistance. The system will provide a code editor interface similar to the existing PreviewEditor, with real-time preview and deployment capabilities via Vercel.

## Core Components

### 1. Frontend Editor Interface
- **Location**: `/app/dashboard/app-builder/[appId]` (new route)
- **Component**: `AppBuilderEditor.tsx` (similar to `PreviewEditor.tsx`)
- **Features**:
  - Code editor with syntax highlighting (Monaco Editor)
  - File tree navigation
  - Real-time preview iframe
  - AI agent chat interface for code modifications
  - Deploy button to Vercel

### 2. Backend API Endpoints
- **Base Path**: `/api/app-builder/`
- **Endpoints**:
  - `POST /api/app-builder/create` - Create new app with initial template
  - `GET /api/app-builder/[appId]/files` - Get app file structure
  - `POST /api/app-builder/[appId]/update-file` - Update specific file
  - `POST /api/app-builder/[appId]/deploy` - Trigger Vercel deployment
  - `POST /api/app-builder/[appId]/agent` - AI agent code modification requests

### 3. Database Schema
- **Collection**: `user_apps`
- **Fields**:
  - `id`: string
  - `userId`: string
  - `name`: string
  - `vercelProjectId`: string
  - `files`: { [path: string]: { content: string, lastModified: timestamp } }
  - `createdAt`: timestamp
  - `updatedAt`: timestamp

### 4. AI Agent System
- **Purpose**: Handle code generation, route addition, DB schema management
- **Integration**: MCP (Model Context Protocol) backend
- **Capabilities**:
  - Generate Next.js components
  - Add API routes
  - Modify database schemas
  - Handle MCP connections
  - Code refactoring and optimization

### 5. Preview System
- **Approach**: Local development server simulation
- **Implementation**:
  - Use Next.js dev server in a containerized environment
  - Or use Vercel's preview deployment feature
  - Update preview on file changes without full redeployment

### 6. Deployment Flow
- **Trigger**: User clicks "Deploy" button
- **Process**:
  1. Validate code
  2. Push files to Vercel via API
  3. Create/update deployment
  4. Update database with deployment URL
  5. Notify user of deployment status

## Security Considerations
- **Code Sandboxing**: All user code runs in isolated environments
- **Input Validation**: Sanitize all AI-generated and user-input code
- **Access Control**: Users can only access their own apps
- **Rate Limiting**: Limit API calls and deployments per user

## MVP Implementation Steps
1. Create basic editor interface
2. Implement file management API
3. Add AI agent integration
4. Set up preview system
5. Integrate Vercel deployment
6. Add MCP backend connections

## Future Enhancements
- Collaborative editing
- Version control integration
- Advanced AI features
- Performance optimizations
- Additional deployment targets