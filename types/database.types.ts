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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      competitions: {
        Row: {
          created_at: string
          end_matchday: number
          entry_fee: number | null
          id: string
          name: string
          overall_contribution: number | null
          season_id: string
          start_matchday: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_matchday: number
          entry_fee?: number | null
          id?: string
          name: string
          overall_contribution?: number | null
          season_id: string
          start_matchday: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_matchday?: number
          entry_fee?: number | null
          id?: string
          name?: string
          overall_contribution?: number | null
          season_id?: string
          start_matchday?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitions_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      entries: {
        Row: {
          calculated_score: number | null
          created_at: string
          id: string
          locked_at: string | null
          matchday_id: string
          score_calculated_at: string | null
          submitted_at: string | null
          total_goals_prediction: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calculated_score?: number | null
          created_at?: string
          id?: string
          locked_at?: string | null
          matchday_id: string
          score_calculated_at?: string | null
          submitted_at?: string | null
          total_goals_prediction?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calculated_score?: number | null
          created_at?: string
          id?: string
          locked_at?: string | null
          matchday_id?: string
          score_calculated_at?: string | null
          submitted_at?: string | null
          total_goals_prediction?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entries_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_selections: {
        Row: {
          category: string
          created_at: string
          entry_id: string
          fixture_id: string
          id: string
          is_correct: boolean | null
          points_awarded: number | null
          selected_team_side: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          entry_id: string
          fixture_id: string
          id?: string
          is_correct?: boolean | null
          points_awarded?: number | null
          selected_team_side?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          entry_id?: string
          fixture_id?: string
          id?: string
          is_correct?: boolean | null
          points_awarded?: number | null
          selected_team_side?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_selections_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_selections_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_score: number | null
          away_team_crest_url: string | null
          away_team_id: number | null
          away_team_name: string
          created_at: string
          external_fixture_id: string
          home_score: number | null
          home_team_crest_url: string | null
          home_team_id: number | null
          home_team_name: string
          id: string
          kickoff_at: string
          last_synced_at: string | null
          matchday_id: string
          status: string
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          away_team_crest_url?: string | null
          away_team_id?: number | null
          away_team_name: string
          created_at?: string
          external_fixture_id: string
          home_score?: number | null
          home_team_crest_url?: string | null
          home_team_id?: number | null
          home_team_name: string
          id?: string
          kickoff_at: string
          last_synced_at?: string | null
          matchday_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          away_team_crest_url?: string | null
          away_team_id?: number | null
          away_team_name?: string
          created_at?: string
          external_fixture_id?: string
          home_score?: number | null
          home_team_crest_url?: string | null
          home_team_id?: number | null
          home_team_name?: string
          id?: string
          kickoff_at?: string
          last_synced_at?: string | null
          matchday_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_matchday_id_fkey"
            columns: ["matchday_id"]
            isOneToOne: false
            referencedRelation: "matchdays"
            referencedColumns: ["id"]
          },
        ]
      }
      matchdays: {
        Row: {
          created_at: string
          fixture_sync_mode: string
          id: string
          is_accelerated_test: boolean
          locks_at: string | null
          matchday_number: number
          opens_at: string | null
          season_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixture_sync_mode?: string
          id?: string
          is_accelerated_test?: boolean
          locks_at?: string | null
          matchday_number: number
          opens_at?: string | null
          season_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixture_sync_mode?: string
          id?: string
          is_accelerated_test?: boolean
          locks_at?: string | null
          matchday_number?: number
          opens_at?: string | null
          season_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matchdays_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          pick8_participation_active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email?: string | null
          id: string
          is_active?: boolean
          is_admin?: boolean
          pick8_participation_active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          pick8_participation_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          name: string
          provider_season: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          provider_season: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          provider_season?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_pick8_accelerated_test_matchday: {
        Args: { target_matchday_number: number }
        Returns: Json
      }
      create_pick8_manual_test_matchday3: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      can_access_pick8_season: {
        Args: { check_season_id: string; check_user_id?: string }
        Returns: boolean
      }
      can_edit_pick8_entry: {
        Args: { check_entry_id: string; check_user_id?: string }
        Returns: boolean
      }
      can_read_pick8_entry: {
        Args: { check_entry_id: string; check_user_id?: string }
        Returns: boolean
      }
      can_submit_pick8_matchday: {
        Args: { check_matchday_id: string; check_user_id?: string }
        Returns: boolean
      }
      is_pick8_active: { Args: { check_user_id?: string }; Returns: boolean }
      is_pick8_admin: { Args: { check_user_id?: string }; Returns: boolean }
      prepare_pick8_accelerated_test_completion: {
        Args: { confirmed: boolean; target_matchday_number: number }
        Returns: Json
      }
      replace_submitted_pick8_selections: {
        Args: { check_entry_id: string; check_selections: Json }
        Returns: undefined
      }
      save_pick8_entry: {
        Args: {
          check_intent: string
          check_matchday_id: string
          check_selections: Json
          check_total_goals: number | null
        }
        Returns: Json
      }
      finish_pick8_manual_test_matchday3: {
        Args: Record<PropertyKey, never>
        Returns: Json
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
