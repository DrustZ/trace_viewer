/**
 * ACE subprocesses need provider credentials and the normal runtime environment,
 * but never the independent credential that unlocks this Viewer over Tailnet.
 */
export function aceChildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source }
  delete environment.TRACE_VIEWER_ACCESS_TOKEN
  delete environment.TRACE_VIEWER_ACCESS_TOKEN_FILE
  return environment
}
