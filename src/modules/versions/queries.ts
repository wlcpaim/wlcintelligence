import { queryOptions } from "@tanstack/react-query";
import { listChatVersions, getTrainingHistory } from "./functions/versions.functions";
export const versionsQuery = queryOptions({ queryKey: ["chat-versions"], queryFn: () => listChatVersions() });
export const trainingQuery = (id: string) => queryOptions({ queryKey: ["chat-versions", id, "training"], queryFn: () => getTrainingHistory({ data: { id } }) });
