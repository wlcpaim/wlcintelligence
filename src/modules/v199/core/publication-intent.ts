/** Only explicit commands authorize side effects; "deploy-ready" is not authorization. */
export function wantsPublication(request: string): boolean {
  return /\b(?:publique|publicar\s+agora|publica\s+agora|fa(?:ça|zer)\s+(?:o\s+)?deploy|realiz(?:a|e|ar)\s+(?:o\s+)?deploy|deploy\s+agora)\b/i.test(request);
}