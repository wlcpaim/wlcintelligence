import { queryOptions } from "@tanstack/react-query";
import { listGeminiKeys } from "./functions/gemini.functions";
export const geminiQuery = queryOptions({
  queryKey: ["integrations", "gemini"],
  queryFn: () => listGeminiKeys(),
});
