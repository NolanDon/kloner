# AI Agent Middle-Man

This document explains how the AI agent route works as the middle-man between the chat UI and the app files.

## What It Does

The route receives a user request, asks a lightweight search/planner pass to choose the best files, hydrates only the needed files, and then asks the model to return a JSON response with edits.

The goal is to keep low-context requests small and fast. A simple copy edit should not pull in the whole app.

## Request Flow

1. The chat UI sends the user message, app id, the attached current file, and recent conversation.
2. The route classifies the request as `copy`, `targeted`, or `broad`.
3. A lightweight planner reasons over the current file, file catalog, and recent conversation to pick the most likely files.
4. The hydrator loads only those files when possible.
5. The route builds a compact prompt with the selected files, the current file anchor, and a short conversation tail.
6. The writer model returns JSON only.
7. The route validates the response, applies edits, and decides whether the preview needs a hard refresh.
8. Slack receives audit data for success, validation blocks, provider failures, and token/cost usage.

When both generated HTML and real source files exist, the selector now prefers source files such as `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, and `components/*` over `public/index.html`.

## Why This Exists

Without a middle-man layer, the model tends to see too much context and small edits become expensive.

This layer keeps the prompt smaller by:

- selecting only a few likely files for copy-only requests
- trimming conversation history
- excerpting relevant content from large files
- reducing retries for low-context asks
- logging token usage and failure details for monitoring
- asking a small number of targeted clarifying questions when the request is still too ambiguous to edit safely
- separating file search from file writing so the agent can reason about paths first and only hydrate the files it needs

## Request Modes

### Copy

Use this for small content edits like headings, button labels, banner text, or short copy fixes.

Expected behavior:

- pick 1 to 3 likely files
- use a short conversation tail
- return a small JSON response
- prefer the attached current file when it plausibly matches the request
- search the selected file contents for the most likely edit target
- avoid broad app context unless the selector cannot find a confident match

Example request:

> Please change the text in the top banner to say “Limited time offer ends Friday.”

Expected response:

```json
{
  "response": "Updated the banner text.",
  "refreshServer": false,
  "fileEdits": [
    {
      "path": "app/page.tsx",
      "content": "...full updated file content..."
    }
  ],
  "setupDatabase": false,
  "dbMigrations": []
}
```

### Targeted

Use this for a specific component, page, or style change.

Example request:

> Make the hero section use a darker background and larger heading.

Expected response:

```json
{
  "response": "Adjusted the hero section styling.",
  "refreshServer": false,
  "fileEdits": [
    {
      "path": "components/Hero.tsx",
      "content": "...full updated file content..."
    },
    {
      "path": "app/globals.css",
      "content": "...full updated file content..."
    }
  ],
  "setupDatabase": false,
  "dbMigrations": []
}
```

### Broad

Use this for app-wide changes, refactors, or requests that clearly need more of the codebase.

Example request:

> Refactor the app to use a new layout system across all pages.

Expected response:

```json
{
  "response": "Refactored the layout structure across the app.",
  "refreshServer": true,
  "fileEdits": [
    {
      "path": "app/layout.tsx",
      "content": "...full updated file content..."
    }
  ],
  "setupDatabase": false,
  "dbMigrations": []
}
```

## Low-Context Response Style

For short asks, the assistant response should be brief and plain-language.

Good examples:

- `Updated the banner text.`
- `Fixed the button label.`
- `Adjusted the hero copy.`
- `Tightened the spacing in the header.`
- `Made the CTA text clearer.`

Avoid responses like:

- `I updated the file and changed the hero component in app/page.tsx.`
- `I made several changes to the codebase.`
- `Here is the implementation detail...`

## When It Should Refresh the Server

The route should only request a hard refresh when the edit touches files that need it, such as:

- `package.json`
- config files
- middleware
- public HTML entry points

Most copy edits and component changes should rely on HMR instead of a full restart.

## Slack Observability

Slack events are used for:

- rejected requests before the model is called
- unsafe input blocks
- successful requests with token and cost data
- provider failures with diagnostic details

This makes it easier to spot:

- oversized prompts
- repeated failures
- risky requests
- unusual token spikes

Slack also receives a compact prompt debug snapshot that includes:

- selected file paths
- a short preview of each selected file's content
- the file-context excerpt sent to the model
- the final prompt preview used for the request

## Practical Example

User request:

> Please change the text in the top banner to say “We ship tomorrow.”

The middle-man should:

- classify this as `copy`
- use the attached current file as the first anchor
- choose the banner-related file(s) by reasoning over file names and contents
- hydrate only those files
- keep the prompt compact
- prefer editable source files over generated HTML when possible
- return one short JSON response
- avoid a full app refresh unless the edited file requires it

If the model still cannot apply a safe change, the fallback should explain that it could not confidently edit the attached files rather than telling the user to point at a specific file.

When the request is ambiguous but potentially actionable, it should ask a short follow-up with one or two targeted questions instead of returning a dead-end apology.

AI edit credits are charged using the request's token usage rather than a fixed per-edit fee, so larger prompts and larger responses cost more.

That is the main optimization goal: do the smallest correct edit with the smallest safe context.
