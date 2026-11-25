export interface GithubAccountView {
  login: string | null;
  display_name: string | null;
  avatar_url: string | null;
  html_url: string | null;
  account_id: number | null;
  email: string | null;
  auth_type: string;
  token_hint: string;
  scopes: string | null;
  token_expires_at: string | null;
  status: string;
  connected_at: string;
  last_checked_at: string | null;
  last_error: string | null;
}
export interface GithubRepoView {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  permissions: { admin: boolean; push: boolean; pull: boolean };
  html_url: string;
  updated_at: string;
}
