import { queryOptions } from "@tanstack/react-query";
import { getChatHistory, listConversations } from "./chat.functions";

export const conversationsQuery = queryOptions({ queryKey: ["conversations"], queryFn: () => listConversations() });
export const chatHistoryQuery = (id: string) => queryOptions({
  queryKey: ["chat-history", id], queryFn: () => getChatHistory({ data: { id } }), staleTime: 0,
});