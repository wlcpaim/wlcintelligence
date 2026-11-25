export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      chat_versions: {
        Row: {
          base_version: string
          chat_instruction: string
          copilot_instruction: string
          created_at: string
          github_path: string | null
          github_sha: string | null
          id: string
          name: string
          repo_full_name: string | null
          rules: Json
          slug: string
          sync_error: string | null
          synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          base_version?: string
          chat_instruction: string
          copilot_instruction: string
          created_at?: string
          github_path?: string | null
          github_sha?: string | null
          id?: string
          name: string
          repo_full_name?: string | null
          rules?: Json
          slug: string
          sync_error?: string | null
          synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          base_version?: string
          chat_instruction?: string
          copilot_instruction?: string
          created_at?: string
          github_path?: string | null
          github_sha?: string | null
          id?: string
          name?: string
          repo_full_name?: string | null
          rules?: Json
          slug?: string
          sync_error?: string | null
          synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cloudflare_connections: {
        Row: {
          account_id: string
          account_name: string | null
          connected_at: string
          db_key: string | null
          db_project_id: string | null
          db_url: string | null
          last_checked_at: string | null
          last_error: string | null
          status: string
          token_ciphertext: string
          token_hint: string | null
          token_iv: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          account_name?: string | null
          connected_at?: string
          db_key?: string | null
          db_project_id?: string | null
          db_url?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          status?: string
          token_ciphertext: string
          token_hint?: string | null
          token_iv: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          account_name?: string | null
          connected_at?: string
          db_key?: string | null
          db_project_id?: string | null
          db_url?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          status?: string
          token_ciphertext?: string
          token_hint?: string | null
          token_iv?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      code_files: {
        Row: {
          base_content: string | null
          content: string
          deleted: boolean
          id: string
          path: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_content?: string | null
          content?: string
          deleted?: boolean
          id?: string
          path: string
          project_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          base_content?: string | null
          content?: string
          deleted?: boolean
          id?: string
          path?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "code_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      code_project_backups: {
        Row: {
          commit_sha: string | null
          created_at: string
          files_count: number
          files_snapshot: Json
          id: string
          message: string
          parent_sha: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          commit_sha?: string | null
          created_at?: string
          files_count?: number
          files_snapshot: Json
          id?: string
          message: string
          parent_sha?: string | null
          project_id: string
          user_id?: string
        }
        Update: {
          commit_sha?: string | null
          created_at?: string
          files_count?: number
          files_snapshot?: Json
          id?: string
          message?: string
          parent_sha?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_project_backups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "code_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      code_projects: {
        Row: {
          base_sha: string | null
          branch: string | null
          cf_project: string | null
          created_at: string
          deploy_url: string | null
          id: string
          name: string
          repo_full_name: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_sha?: string | null
          branch?: string | null
          cf_project?: string | null
          created_at?: string
          deploy_url?: string | null
          id?: string
          name: string
          repo_full_name?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          base_sha?: string | null
          branch?: string | null
          cf_project?: string | null
          created_at?: string
          deploy_url?: string | null
          id?: string
          name?: string
          repo_full_name?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          is_pinned: boolean
          title: string
          title_generated: boolean
          title_manual: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_pinned?: boolean
          title?: string
          title_generated?: boolean
          title_manual?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_pinned?: boolean
          title?: string
          title_generated?: boolean
          title_manual?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      gemini_keys: {
        Row: {
          cooldown_until: string | null
          created_at: string
          enabled: boolean
          google_project: string
          id: string
          is_primary: boolean
          key_ciphertext: string
          key_hint: string
          key_iv: string
          label: string
          last_checked_at: string | null
          last_error: string | null
          last_used_at: string | null
          model: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          enabled?: boolean
          google_project?: string
          id?: string
          is_primary?: boolean
          key_ciphertext: string
          key_hint: string
          key_iv: string
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          last_used_at?: string | null
          model?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          enabled?: boolean
          google_project?: string
          id?: string
          is_primary?: boolean
          key_ciphertext?: string
          key_hint?: string
          key_iv?: string
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_used_at?: string | null
          model?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      github_connections: {
        Row: {
          account_id: number | null
          auth_type: string
          avatar_url: string | null
          connected_at: string
          display_name: string | null
          email: string | null
          html_url: string | null
          last_checked_at: string | null
          last_error: string | null
          login: string | null
          scopes: string | null
          status: string
          token_ciphertext: string
          token_expires_at: string | null
          token_hint: string
          token_iv: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: number | null
          auth_type?: string
          avatar_url?: string | null
          connected_at?: string
          display_name?: string | null
          email?: string | null
          html_url?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          login?: string | null
          scopes?: string | null
          status?: string
          token_ciphertext: string
          token_expires_at?: string | null
          token_hint: string
          token_iv: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: number | null
          auth_type?: string
          avatar_url?: string | null
          connected_at?: string
          display_name?: string | null
          email?: string | null
          html_url?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          login?: string | null
          scopes?: string | null
          status?: string
          token_ciphertext?: string
          token_expires_at?: string | null
          token_hint?: string
          token_iv?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      github_selection: {
        Row: {
          repo_full_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          repo_full_name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          repo_full_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_runs: {
        Row: {
          created_at: string
          detail: string | null
          http_status: number | null
          id: string
          key_id: string | null
          kind: string
          ok: boolean
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          http_status?: number | null
          id?: string
          key_id?: string | null
          kind: string
          ok?: boolean
          provider: string
          user_id?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          http_status?: number | null
          id?: string
          key_id?: string | null
          kind?: string
          ok?: boolean
          provider?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_status: {
        Row: {
          auth_type: string
          created_at: string
          last_checked_at: string | null
          last_error: string | null
          last_used_at: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_type?: string
          created_at?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_used_at?: string | null
          provider: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          auth_type?: string
          created_at?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_used_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legacy_users: {
        Row: {
          claimed_at: string | null
          display_name: string | null
          email: string
          imported_at: string
          new_user_id: string | null
          original_user_id: string
        }
        Insert: {
          claimed_at?: string | null
          display_name?: string | null
          email: string
          imported_at?: string
          new_user_id?: string | null
          original_user_id: string
        }
        Update: {
          claimed_at?: string | null
          display_name?: string | null
          email?: string
          imported_at?: string
          new_user_id?: string | null
          original_user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_events: {
        Row: {
          content: string
          created_at: string
          id: string
          project_id: string
          role: string
          source: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          project_id: string
          role: string
          source: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      system_sessions: {
        Row: {
          active_project_id: string | null
          id: string
          pending_plan: Json | null
          session_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_project_id?: string | null
          id?: string
          pending_plan?: Json | null
          session_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_project_id?: string | null
          id?: string
          pending_plan?: Json | null
          session_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      version_training_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
          version_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id?: string
          version_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "version_training_messages_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "chat_versions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_legacy_account: { Args: never; Returns: Json }
      exec_migration: { Args: { p_sql: string }; Returns: Json }
      inspect_schema: { Args: never; Returns: Json }
      lookup_auth_email: {
        Args: { p_email: string }
        Returns: {
          confirmed: boolean
          exists_account: boolean
          has_password: boolean
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
