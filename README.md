
# Kloner - AI-Powered App Builder

This is an AI-powered app builder with integrated Supabase MCP support for intelligent database operations.

## Quick start
```bash
pnpm i   # or npm i / yarn
pnpm dev # http://localhost:3000
```

## Supabase MCP Integration

Kloner uses Supabase with Model Context Protocol (MCP) for AI-powered database operations. This enables the AI agent to:

- Explore your database schema and relationships
- Generate optimized queries and migrations
- Help with authentication setup and RLS policies
- Debug performance issues
- Create edge functions and API routes

### Automated Database Creation (Coming Soon) 🚀

Kloner will soon support **one-click Supabase project creation** via OAuth integration:

#### How It Will Work:
1. **One-Click Creation**: User clicks "🚀 Create New Supabase Project"
2. **OAuth Authorization**: Secure redirect to Supabase for permission
3. **Auto-Provisioning**: Project created with optimal settings
4. **Database Setup**: Initial tables, auth config, and RLS policies applied
5. **MCP Integration**: Immediate AI-powered database assistance
6. **Secure Storage**: Credentials automatically managed

#### Technical Implementation:
- **Supabase Management API**: Programmatic project creation
- **OAuth 2.0 Flow**: Secure user authorization
- **Auto-Configuration**: Pre-built schemas for common use cases
- **MCP Integration**: Real-time AI database assistance

#### Benefits:
- ⚡ **Instant Setup**: No manual dashboard navigation
- 🔒 **Secure**: OAuth-based authorization
- 🤖 **AI-Ready**: Immediate MCP integration
- 📊 **Optimized**: Best-practice configurations
- 💰 **Cost-Effective**: Pay-as-you-go Supabase billing

---

### Current Setup Process

1. **Create a Supabase Project**
   - Go to [supabase.com](https://supabase.com) and create a new project
   - Wait for the project to be fully provisioned

2. **Get Your Project Reference**
   - In your Supabase dashboard, copy the project reference from the URL
   - Example: `https://abcdefghijklmnopqrst.supabase.co` → `abcdefghijklmnopqrst`

3. **Connect in Kloner**
   - Open the app builder and click the AI chat
   - Choose "Connect Supabase" when prompted
   - Enter your project reference ID
   - Optionally add a service role key for full access (leave empty for read-only)

4. **MCP Configuration (Optional)**
   For enhanced AI capabilities, you can configure MCP in your AI client:

   ```json
   {
     "mcpServers": {
       "supabase": {
         "type": "http",
         "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_ID&read_only=true"
       }
     }
   }
   ```

### Security Best Practices

- **Always use read-only mode** for production data access
- **Scope to specific projects** to limit access
- **Enable manual tool approval** in your AI client
- **Use development branches** instead of production
- **Limit feature groups** to only what's needed

## Notes
- Replace `/public/hero.mp4` with your real video.
- Replace placeholder images in `/public/images` as needed.
- Colors and copy live in `lib/config.ts`.
