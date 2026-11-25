import { queryOptions } from "@tanstack/react-query";
import { getCloudflareState } from "./functions/cloudflare.functions";
export const cloudflareQuery = queryOptions({ queryKey: ["cloudflare"], queryFn: () => getCloudflareState() });
