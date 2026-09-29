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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      job_logs: {
        Row: {
          capture_summary: string | null
          completion_tokens: number | null
          created_at: string
          failure_reason: string | null
          handled_at: string | null
          id: string
          latency_ms: number | null
          model: string | null
          outcome: Database["public"]["Enums"]["job_outcome"]
          prompt_tokens: number | null
          rationale: string | null
          source: Database["public"]["Enums"]["source_kind"]
          user_id: string
          revert_blocked_reason: string | null
        }
        Insert: {
          capture_summary?: string | null
          completion_tokens?: number | null
          created_at?: string
          failure_reason?: string | null
          handled_at?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          outcome: Database["public"]["Enums"]["job_outcome"]
          prompt_tokens?: number | null
          rationale?: string | null
          source: Database["public"]["Enums"]["source_kind"]
          user_id: string
        }
        Update: {
          capture_summary?: string | null
          completion_tokens?: number | null
          created_at?: string
          failure_reason?: string | null
          handled_at?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          outcome?: Database["public"]["Enums"]["job_outcome"]
          prompt_tokens?: number | null
          rationale?: string | null
          source?: Database["public"]["Enums"]["source_kind"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          consented_at: string | null
          created_at: string
          id: string
          timezone: string
        }
        Insert: {
          consented_at?: string | null
          created_at?: string
          id: string
          timezone?: string
        }
        Update: {
          consented_at?: string | null
          created_at?: string
          id?: string
          timezone?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      task_tags: {
        Row: {
          tag_id: string
          task_id: string
          user_id: string
        }
        Insert: {
          tag_id: string
          task_id: string
          user_id: string
        }
        Update: {
          tag_id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_tags_tag_fkey"
            columns: ["tag_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "task_tags_task_fkey"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_by_job_log_id: string | null
          created_at: string
          description: string | null
          due_at: string | null
          due_has_time: boolean
          id: string
          job_log_id: string | null
          rationale: string | null
          source: Database["public"]["Enums"]["source_kind"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_by_job_log_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          due_has_time?: boolean
          id?: string
          job_log_id?: string | null
          rationale?: string | null
          source: Database["public"]["Enums"]["source_kind"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_by_job_log_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          due_has_time?: boolean
          id?: string
          job_log_id?: string | null
          rationale?: string | null
          source?: Database["public"]["Enums"]["source_kind"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_completed_by_job_log_id_fkey"
            columns: ["completed_by_job_log_id"]
            isOneToOne: false
            referencedRelation: "job_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_job_log_id_fkey"
            columns: ["job_log_id"]
            isOneToOne: false
            referencedRelation: "job_logs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_task: {
        Args: {
          p_description?: string
          p_due_at?: string
          p_due_has_time?: boolean
          p_job_log_id?: string
          p_rationale?: string
          p_source?: Database["public"]["Enums"]["source_kind"]
          p_tag_ids?: string[]
          p_title: string
        }
        Returns: string
      }
      merge_tags: {
        Args: { p_source_id: string; p_target_id: string }
        Returns: {
          blocked_reason: string
          created_at: string
          id: string
          name: string
        }[]
      }
      revert_blocked_reason: {
        Args: { "": Database["public"]["Tables"]["job_logs"]["Row"] }
        Returns: {
          error: true
        } & "the function public.revert_blocked_reason with parameter or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache"
      }
      revert_job_log: {
        Args: { p_job_log_id: string }
        Returns: {
          blocked_reason: string
          reverted: Database["public"]["Enums"]["job_outcome"]
          task_ids: string[]
        }[]
      }
      set_task_tags: {
        Args: { p_tag_ids: string[]; p_task_id: string }
        Returns: boolean
      }
    }
    Enums: {
      job_outcome: "created" | "completed" | "failed"
      source_kind: "capture_create" | "capture_complete" | "mail" | "manual"
      task_status: "todo" | "done"
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
    Enums: {
      job_outcome: ["created", "completed", "failed"],
      source_kind: ["capture_create", "capture_complete", "mail", "manual"],
      task_status: ["todo", "done"],
    },
  },
} as const
