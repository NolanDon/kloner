
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

### Automated Database Creation (OAuth)

Kloner supports **one-click Supabase project creation** via OAuth.

Required server environment variables:
- `SUPABASE_CLIENT_ID`
- `SUPABASE_CLIENT_SECRET`
- `SUPABASE_REDIRECT_URI` (optional; defaults to `${NEXTAUTH_URL}/api/supabase/oauth/callback`)

Security (required):
- `KLONER_ENCRYPTION_KEY` — base64-encoded 32-byte key used to encrypt Supabase OAuth tokens and keys stored in Firestore.

Generate `KLONER_ENCRYPTION_KEY`:
```bash
# Node (recommended)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# or OpenSSL
openssl rand -base64 32
```

Important:
- Keep `KLONER_ENCRYPTION_KEY` stable across deploys (rotating it will prevent decrypting previously stored credentials).

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
   - Follow the OAuth flow (preferred), or manually connect if offered

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

## Safe schema changes (propose → confirm → apply)

When the agent needs to modify your database schema, it will:
1. **Propose** a migration (stores SQL as a proposal)
2. **Ask you** to review and explicitly approve
3. **Apply** only after you click Apply or type `APPLY <proposalId>`

This prevents silent/destructive schema changes.

## Notes
- Replace `/public/hero.mp4` with your real video.
- Replace placeholder images in `/public/images` as needed.
- Colors and copy live in `lib/config.ts`.
