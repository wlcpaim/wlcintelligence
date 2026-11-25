export interface GeminiKeyView {
  id: string;
  label: string;
  google_project: string;
  model: string;
  key_hint: string;
  is_primary: boolean;
  enabled: boolean;
  status: string;
  last_checked_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  cooldown_until: string | null;
  created_at: string;
}
export interface GeminiRunView {
  id: string;
  kind: string;
  ok: boolean;
  http_status: number | null;
  detail: string | null;
  key_id: string | null;
  created_at: string;
}
