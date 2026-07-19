import { harmonyConnector } from './harmony'
import { nativeConnector } from './native'
import { openaiChatConnector } from './openaiChat'
import type { Connector, ParseContext, ParseResult } from './types'

export const connectors: Connector[] = [nativeConnector, openaiChatConnector, harmonyConnector]

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
