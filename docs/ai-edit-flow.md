# AI Edit Flow

This doc explains how the frontend AI editing flow works in the editor.

## Short Answer

The modal does not write files by itself.

The editor chat sends the prompt to same-origin embedding routes on the app: first `/api/app-embeddings/search`, then `/api/app-embeddings/edit-plan`. Those routes run the backend planning/search logic on the server and return JSON. The frontend only applies changes after that JSON comes back.

If the response includes `setupDatabase: true`, the chat UI may open a modal after the response is received. That modal is only a UI decision step. It does not itself write code into the app.

## What Happens In Order

1. The user sends a prompt from the editor chat.
2. The chat component gathers local context in the browser, including the current file, current file content, recent conversation, and retrieved chunks.
3. The browser sends a same-origin POST request to `/api/app-embeddings/search`.
4. The browser sends the search results to `/api/app-embeddings/edit-plan`.
5. The server routes build prompts, call the backend planning logic, and produce JSON responses.
6. The JSON response can include:
   - `response`
   - `fileEdits`
   - `htmlEdits`
   - `setupDatabase`
   - `dbMigrations`
7. The frontend reads the response.
8. If `setupDatabase` is true, the UI may show the database modal or a database setup choice prompt.
9. If there are file edits and no database migration conflict, the editor applies them through `onFileEdit`.
10. `onFileEdit` updates local editor state and then persists the file to Firebase and the live preview path.

## Where The Modal Is Called

The modal is triggered in the chat component after the AI response comes back, not before the API call.

In code terms, the sequence is:

- send request to `/api/app-embeddings/search`
- send request to `/api/app-embeddings/edit-plan`
- wait for response
- if `data.setupDatabase` is true, set state that opens the modal or setup prompt
- if `data.fileEdits` exists, apply those edits separately

There are two main modal-driven paths:

- Database setup prompt: if the AI says `setupDatabase: true`, the chat UI may show a Supabase setup choice modal.
- Migration review prompt: if the AI returns database migrations, the UI shows a review step before applying them.

In both cases, the modal is a decision point, not the place where file contents are written.

If the user chooses a database option, the frontend usually sends a follow-up message or opens the setup flow. That creates a new AI request. It does not directly patch files.

## Where The Business Logic Lives

The browser-side chat component only prepares the request, sends it, and applies the response.

The actual orchestration is in the server routes `/api/app-embeddings/search` and `/api/app-embeddings/edit-plan`:

- it parses the request body
- it builds the search/planning prompt
- it calls the model provider
- it normalizes `fileEdits`, `htmlEdits`, `setupDatabase`, and `dbMigrations`
- it returns the final JSON to the browser

So the business logic is split:

- browser: gather context, show UI, apply returned edits
- server route: decide what the AI should see and how the response is interpreted

## When Changes Are Written

File changes are written only after the AI response returns and the frontend iterates through the returned `fileEdits`.

For the editor-mounted chat, the write path is:

- chat receives `data.fileEdits`
- it calls `onFileEdit(edit.path, edit.content, creditRequestId)` for each edit
- the editor updates local state
- the editor saves the file and applies it to the preview

If database migrations are also present, the editor may stage the code changes instead of applying them immediately, so the database confirmation can happen first.

The mounted editor chat is labeled `Agent` in the UI and lives in `components/AppBuilderEditorAgentChat.tsx`. The older `components/AIAgentChat.tsx` still exists in the repo, but it is not the mounted editor surface.

## Request-Specific Note

If you are asking about the current editor flow, the modal is only a control step. The actual content changes happen later from the AI response payload, not from the modal action itself.

That means:

- modal response = choose how to continue
- AI response = decide what to change
- `onFileEdit` = write the actual file contents

## Important Boundary

This is not a browser-to-third-party direct call.

The browser sends the request to the app’s own API routes. Those routes then talk to the backend planning/editing flow from the server. That is why the modal and file writes are controlled by the frontend, while the model reasoning happens in the backend routes.
