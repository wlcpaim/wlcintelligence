export type ChatRole = "user" | "model";
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}
