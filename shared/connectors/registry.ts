import { anthropicMessagesConnector } from './anthropicMessages'
import { harmonyConnector } from './harmony'
import { nativeConnector } from './native'
import { openaiChatConnector } from './openaiChat'
import { openaiResponsesConnector } from './openaiResponses'
import { qwenGenericConnector } from './qwenGeneric'
import type { Connector, ParseContext, ParseResult } from './types'

// Order = detect priority. Specific formats first; qwen-generic is the plain
// {role,content} fallback (it defers to everything above). Harmony is text so
// its marker-based detect is orthogonal to the JSON connectors.
export const connectors: Connector[] = [
  nativeConnector,
  openaiChatConnector,
  openaiResponsesConnector,
  anthropicMessagesConnector,
  qwenGenericConnector,
  harmonyConnector,
]

export function detectFormat(text: string): Connector | null {
  for (const connector of connectors) {
    if (connector.detect(text)) return connector
  }
  return null
}

export function parseAny(text: string, ctx: ParseContext, formatHint?: string): ParseResult {
  const warnings: string[] = []
  if (formatHint !== undefined) {
    const hinted = connectors.find((c) => c.id === formatHint)
    if (hinted) return hinted.parse(text, ctx)
    warnings.push(`unknown format hint '${formatHint}', falling back to auto-detect`)
  }
  const detected = detectFormat(text)
  if (!detected) {
    return {
      traces: [],
      warnings: [...warnings, 'unrecognized format: no connector detected this content'],
    }
  }
  const result = detected.parse(text, ctx)
  return warnings.length > 0 ? { ...result, warnings: [...warnings, ...result.warnings] } : result
}
