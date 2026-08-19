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
      agent_calls: {
        Row: {
          agent_id: string | null
          agent_name: string
          correlation_id: string | null
          cost_estimated_usd: number
          created_at: string
          error_message: string | null
          id: string
          input_tokens: number
          job_id: string | null
          latency_ms: number
          output_tokens: number
          status: string
          tenant_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_name: string
          correlation_id?: string | null
          cost_estimated_usd?: number
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number
          job_id?: string | null
          latency_ms?: number
          output_tokens?: number
          status: string
          tenant_id: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          correlation_id?: string | null
          cost_estimated_usd?: number
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number
          job_id?: string | null
          latency_ms?: number
          output_tokens?: number
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent: string
          correlation_id: string
          cost_usd: number
          error: string | null
          finished_at: string | null
          id: string
          result: Json | null
          started_at: string
          status: string
          tenant_id: string
          trigger: string
        }
        Insert: {
          agent: string
          correlation_id: string
          cost_usd?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          started_at?: string
          status?: string
          tenant_id: string
          trigger: string
        }
        Update: {
          agent?: string
          correlation_id?: string
          cost_usd?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          started_at?: string
          status?: string
          tenant_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agents_registry: {
        Row: {
          allowed_tools: Json
          created_at: string
          id: string
          model: string | null
          name: string
          prompt_name: string | null
          status: string
          tenant_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          allowed_tools?: Json
          created_at?: string
          id?: string
          model?: string | null
          name: string
          prompt_name?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          allowed_tools?: Json
          created_at?: string
          id?: string
          model?: string | null
          name?: string
          prompt_name?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agents_registry_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          id: string
          message: string
          severity: string
          tenant_id: string
          type: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          message: string
          severity?: string
          tenant_id: string
          type: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          message?: string
          severity?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kits: {
        Row: {
          brief_document_name: string | null
          brief_document_url: string | null
          color_primary: string | null
          color_secondary: string | null
          created_at: string
          font_family: string | null
          id: string
          logo_url: string | null
          tenant_id: string
          tone_description: string | null
          updated_at: string
          voice_training: string | null
          website_url: string | null
        }
        Insert: {
          brief_document_name?: string | null
          brief_document_url?: string | null
          color_primary?: string | null
          color_secondary?: string | null
          created_at?: string
          font_family?: string | null
          id?: string
          logo_url?: string | null
          tenant_id: string
          tone_description?: string | null
          updated_at?: string
          voice_training?: string | null
          website_url?: string | null
        }
        Update: {
          brief_document_name?: string | null
          brief_document_url?: string | null
          color_primary?: string | null
          color_secondary?: string | null
          created_at?: string
          font_family?: string | null
          id?: string
          logo_url?: string | null
          tenant_id?: string
          tone_description?: string | null
          updated_at?: string
          voice_training?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_kits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_categories: {
        Row: {
          created_at: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      content_calendar: {
        Row: {
          created_at: string
          creative_id: string | null
          date: string
          hold_publish: boolean
          id: string
          notes: string | null
          published_at: string | null
          slot_type: string
          source: Json
          status: string
          tenant_id: string
          theme: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creative_id?: string | null
          date: string
          hold_publish?: boolean
          id?: string
          notes?: string | null
          published_at?: string | null
          slot_type: string
          source?: Json
          status?: string
          tenant_id: string
          theme: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creative_id?: string | null
          date?: string
          hold_publish?: boolean
          id?: string
          notes?: string | null
          published_at?: string | null
          slot_type?: string
          source?: Json
          status?: string
          tenant_id?: string
          theme?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_calendar_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_calendar_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      creatives: {
        Row: {
          asset_urls: string[]
          brief: Json
          calendar_slot_id: string | null
          created_at: string
          id: string
          status: string
          template_id: string | null
          tenant_id: string
          type: string
          updated_at: string
          variant_group_id: string | null
        }
        Insert: {
          asset_urls?: string[]
          brief?: Json
          calendar_slot_id?: string | null
          created_at?: string
          id?: string
          status?: string
          template_id?: string | null
          tenant_id: string
          type: string
          updated_at?: string
          variant_group_id?: string | null
        }
        Update: {
          asset_urls?: string[]
          brief?: Json
          calendar_slot_id?: string | null
          created_at?: string
          id?: string
          status?: string
          template_id?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
          variant_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creatives_calendar_slot_id_fkey"
            columns: ["calendar_slot_id"]
            isOneToOne: false
            referencedRelation: "content_calendar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "render_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_log: {
        Row: {
          agent: string
          correlation_id: string
          created_at: string
          decision: Json
          id: string
          observed: Json
          outcome: Json | null
          rationale: string | null
          tenant_id: string
        }
        Insert: {
          agent: string
          correlation_id: string
          created_at?: string
          decision?: Json
          id?: string
          observed?: Json
          outcome?: Json | null
          rationale?: string | null
          tenant_id: string
        }
        Update: {
          agent?: string
          correlation_id?: string
          created_at?: string
          decision?: Json
          id?: string
          observed?: Json
          outcome?: Json | null
          rationale?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ephemerides: {
        Row: {
          accent_color_primary: string | null
          accent_color_secondary: string | null
          category: string
          country_code: string | null
          created_at: string
          date: string
          id: string
          is_recurring_annually: boolean
          name: string
          relevance_tags: string[]
          tenant_id: string | null
        }
        Insert: {
          accent_color_primary?: string | null
          accent_color_secondary?: string | null
          category?: string
          country_code?: string | null
          created_at?: string
          date: string
          id?: string
          is_recurring_annually?: boolean
          name: string
          relevance_tags?: string[]
          tenant_id?: string | null
        }
        Update: {
          accent_color_primary?: string | null
          accent_color_secondary?: string | null
          category?: string
          country_code?: string | null
          created_at?: string
          date?: string
          id?: string
          is_recurring_annually?: boolean
          name?: string
          relevance_tags?: string[]
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ephemerides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          attempts: number
          correlation_id: string
          created_at: string
          dispatched_at: string | null
          id: string
          last_error: string | null
          payload: Json
          status: string
          tenant_id: string
          type: string
        }
        Insert: {
          attempts?: number
          correlation_id?: string
          created_at?: string
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          status?: string
          tenant_id: string
          type: string
        }
        Update: {
          attempts?: number
          correlation_id?: string
          created_at?: string
          dispatched_at?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          status?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          created_at: string
          id: string
          kind: string
          last_used_at: string | null
          tenant_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          last_used_at?: string | null
          tenant_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          last_used_at?: string | null
          tenant_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      news_suggestions: {
        Row: {
          angle: string
          created_at: string
          headline: string
          id: string
          published_at: string | null
          source_name: string | null
          source_url: string
          status: string
          summary: string | null
          tenant_id: string
        }
        Insert: {
          angle: string
          created_at?: string
          headline: string
          id?: string
          published_at?: string | null
          source_name?: string | null
          source_url: string
          status?: string
          summary?: string | null
          tenant_id: string
        }
        Update: {
          angle?: string
          created_at?: string
          headline?: string
          id?: string
          published_at?: string | null
          source_name?: string | null
          source_url?: string
          status?: string
          summary?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_suggestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products_services: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          name: string
          photo_urls: string[]
          price: number | null
          tenant_id: string
          updated_at: string
          video_urls: string[]
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name: string
          photo_urls?: string[]
          price?: number | null
          tenant_id: string
          updated_at?: string
          video_urls?: string[]
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name?: string
          photo_urls?: string[]
          price?: number | null
          tenant_id?: string
          updated_at?: string
          video_urls?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "products_services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          conditions: string | null
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          ends_at: string
          id: string
          name: string
          product_ids: string[]
          starts_at: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          conditions?: string | null
          created_at?: string
          description?: string | null
          discount_type: string
          discount_value: number
          ends_at: string
          id?: string
          name: string
          product_ids?: string[]
          starts_at: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          conditions?: string | null
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          ends_at?: string
          id?: string
          name?: string
          product_ids?: string[]
          starts_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          template: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          template: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          template?: string
          version?: number
        }
        Relationships: []
      }
      publications: {
        Row: {
          created_at: string
          creative_id: string
          error_message: string | null
          external_post_id: string | null
          id: string
          platform: string
          published_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creative_id: string
          error_message?: string | null
          external_post_id?: string | null
          id?: string
          platform: string
          published_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creative_id?: string
          error_message?: string | null
          external_post_id?: string | null
          id?: string
          platform?: string
          published_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publications_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      render_templates: {
        Row: {
          canvas_height: number | null
          canvas_width: number | null
          component_ref: string
          created_at: string
          engine: string
          frame_image_url: string | null
          id: string
          name: string
          props_schema: Json
          status: string
          tenant_id: string | null
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          canvas_height?: number | null
          canvas_width?: number | null
          component_ref: string
          created_at?: string
          engine: string
          frame_image_url?: string | null
          id?: string
          name: string
          props_schema?: Json
          status?: string
          tenant_id?: string | null
          type: string
          updated_at?: string
          version?: number
        }
        Update: {
          canvas_height?: number | null
          canvas_width?: number | null
          component_ref?: string
          created_at?: string
          engine?: string
          frame_image_url?: string | null
          id?: string
          name?: string
          props_schema?: Json
          status?: string
          tenant_id?: string | null
          type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "render_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      social_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          instagram_business_account_id: string | null
          instagram_username: string | null
          last_error: string | null
          last_verified_at: string | null
          page_id: string
          page_name: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          instagram_business_account_id?: string | null
          instagram_username?: string | null
          last_error?: string | null
          last_verified_at?: string | null
          page_id: string
          page_name?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          instagram_business_account_id?: string | null
          instagram_username?: string | null
          last_error?: string | null
          last_verified_at?: string | null
          page_id?: string
          page_name?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          hitl_mode: string
          id: string
          name: string
          rubro: string | null
          slug: string
          status: string
          token_limit_daily: number | null
          token_limit_per_job: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          hitl_mode?: string
          id?: string
          name: string
          rubro?: string | null
          slug: string
          status?: string
          token_limit_daily?: number | null
          token_limit_per_job?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          hitl_mode?: string
          id?: string
          name?: string
          rubro?: string | null
          slug?: string
          status?: string
          token_limit_daily?: number | null
          token_limit_per_job?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_rubro_fkey"
            columns: ["rubro"]
            isOneToOne: false
            referencedRelation: "business_categories"
            referencedColumns: ["slug"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_pending_events: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          correlation_id: string
          created_at: string
          dispatched_at: string | null
          id: string
          last_error: string | null
          payload: Json
          status: string
          tenant_id: string
          type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_tenant_with_owner: {
        Args: { tenant_name: string; tenant_rubro: string; tenant_slug: string }
        Returns: {
          created_at: string
          hitl_mode: string
          id: string
          name: string
          rubro: string | null
          slug: string
          status: string
          token_limit_daily: number | null
          token_limit_per_job: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_calendar_regeneration: {
        Args: { target_tenant_id: string }
        Returns: undefined
      }
      request_creative_generation: {
        Args: { target_calendar_slot_id: string }
        Returns: undefined
      }
      request_creative_publish: {
        Args: { target_creative_id: string }
        Returns: undefined
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
