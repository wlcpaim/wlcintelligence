import { queryOptions } from "@tanstack/react-query";
import { getGithubState, listGithubRepos } from "./functions/github.functions";
export const githubQuery = queryOptions({
  queryKey: ["integrations", "github"],
  queryFn: () => getGithubState(),
});
export const githubReposQuery = queryOptions({
  queryKey: ["integrations", "github", "repos"],
  queryFn: () => listGithubRepos(),
});
