# Import example fixtures

Small, realistic traces for manually exercising the **Import a trace** dialog
(paste, file upload, or URL). This directory lives at the repo top level and is
**not** under `data/`, so it is not auto-scanned — the files are only loaded when
you import them yourself.

## How to import

1. Open the app and click **Import a trace**.
2. Either **paste** the file contents into the text box, or **upload** the file.
   (`.txt`/`.json` both work; leave the format on auto-detect.)
3. The registry sniffs the content and routes it to the connector below.

## Files → connector

| File | Connector (`id`) | What it shows |
| --- | --- | --- |
| `native-sample.json` | `native` | Our normalized schema: analysis/commentary/final channels + tool call/result. |
| `openai-chat-sample.json` | `openai-chat` | Chat Completions with `tool_calls` + a `tool` reply and `usage`. |
| `openai-responses-sample.json` | `openai-responses` | Responses API `output`: reasoning → function_call → function_call_output → message. |
| `anthropic-messages-sample.json` | `anthropic-messages` | Messages API content blocks: `text` + `tool_use`, and a `tool_result` in a user turn, plus top-level `system`. |
| `qwen-messages-sample.json` | `qwen-generic` | Bare message list with Qwen/DeepSeek `reasoning_content` (split into analysis + final). |
| `simple-role-content.json` | `qwen-generic` | Minimal bare `[{role, content}]` array — the permissive fallback. |
| `harmony-sample.txt` | `harmony` | Harmony token text with `<|channel|>` tags and a tool call/result. |

## Detect-precedence note

Registry order is `native → openai-chat → openai-responses → anthropic-messages
→ qwen-generic → harmony`. `qwen-generic` is the plain-string fallback and only
claims shapes every specific connector declined. A plain `{messages:[{role,
content:"..."}]}` object (string content, no blocks, no top-level `system`) is
indistinguishable from OpenAI chat and is handled by `openai-chat`; route it to
`qwen-generic` by passing it as a bare array (as in `simple-role-content.json`)
or via an explicit format hint.
