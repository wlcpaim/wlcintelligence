export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  is_pinned: boolean;
}

export function sortConversations<T extends Conversation>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at));
}

export function cleanTitle(text: string): string {
  return text.replace(/^[\s#"'`]+|[\s"'`]+$/g, "").replace(/\s+/g, " ").slice(0, 80).trim();
}

export function shouldGenerateTitle(conversation: { title_manual: boolean; title_generated: boolean }): boolean {
  return !conversation.title_manual && !conversation.title_generated;
}