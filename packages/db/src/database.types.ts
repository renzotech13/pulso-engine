/**
 * Hand-written placeholder matching migrations 00000000000001-00000000000004.
 * Regenerate from the real local stack once Docker is running:
 *   pnpm db:types
 * (overwrites this file with `supabase gen types typescript --local`)
 */
export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          rubro: string | null;
          hitl_mode: "full-auto" | "approve-creatives" | "approve-all";
          status: "active" | "paused" | "archived";
          token_limit_daily: number | null;
          token_limit_per_job: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          rubro?: string | null;
          hitl_mode?: "full-auto" | "approve-creatives" | "approve-all";
          status?: "active" | "paused" | "archived";
          token_limit_daily?: number | null;
          token_limit_per_job?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tenants"]["Insert"]>;
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: "owner" | "admin" | "viewer";
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          role?: "owner" | "admin" | "viewer";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["memberships"]["Insert"]>;
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          tenant_id: string;
          type: string;
          payload: Record<string, unknown>;
          correlation_id: string;
          status: "pending" | "dispatched" | "failed";
          attempts: number;
          last_error: string | null;
          created_at: string;
          dispatched_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          type: string;
          payload?: Record<string, unknown>;
          correlation_id?: string;
          status?: "pending" | "dispatched" | "failed";
          attempts?: number;
          last_error?: string | null;
          created_at?: string;
          dispatched_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>;
        Relationships: [];
      };
      agent_runs: {
        Row: {
          id: string;
          tenant_id: string;
          agent: string;
          trigger: string;
          status: "running" | "succeeded" | "failed";
          started_at: string;
          finished_at: string | null;
          cost_usd: number;
          result: Record<string, unknown> | null;
          error: string | null;
          correlation_id: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          agent: string;
          trigger: string;
          status: "running" | "succeeded" | "failed";
          started_at?: string;
          finished_at?: string | null;
          cost_usd?: number;
          result?: Record<string, unknown> | null;
          error?: string | null;
          correlation_id: string;
        };
        // append-only: UPDATE/DELETE are revoked at the grant level, so this
        // table never has a legitimate Update shape.
        Update: never;
        Relationships: [];
      };
      decision_log: {
        Row: {
          id: string;
          tenant_id: string;
          agent: string;
          observed: Record<string, unknown>;
          decision: Record<string, unknown>;
          rationale: string | null;
          outcome: Record<string, unknown> | null;
          correlation_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          agent: string;
          observed?: Record<string, unknown>;
          decision?: Record<string, unknown>;
          rationale?: string | null;
          outcome?: Record<string, unknown> | null;
          correlation_id: string;
          created_at?: string;
        };
        // append-only: UPDATE/DELETE are revoked at the grant level, so this
        // table never has a legitimate Update shape.
        Update: never;
        Relationships: [];
      };
      alerts: {
        Row: {
          id: string;
          tenant_id: string;
          severity: "info" | "warning" | "critical";
          type: string;
          message: string;
          created_at: string;
          acknowledged_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          severity?: "info" | "warning" | "critical";
          type: string;
          message: string;
          created_at?: string;
          acknowledged_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>;
        Relationships: [];
      };
      business_categories: {
        Row: {
          slug: string;
          name: string;
          created_at: string;
        };
        Insert: {
          slug: string;
          name: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_categories"]["Insert"]>;
        Relationships: [];
      };
      ephemerides: {
        Row: {
          id: string;
          tenant_id: string | null;
          country_code: string | null;
          name: string;
          date: string;
          is_recurring_annually: boolean;
          relevance_tags: string[];
          category: "nacional" | "internacional" | "comercial" | "religiosa";
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          country_code?: string | null;
          name: string;
          date: string;
          is_recurring_annually?: boolean;
          relevance_tags?: string[];
          category?: "nacional" | "internacional" | "comercial" | "religiosa";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ephemerides"]["Insert"]>;
        Relationships: [];
      };
      products_services: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          price: number | null;
          currency: string;
          photo_urls: string[];
          category: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          price?: number | null;
          currency?: string;
          photo_urls?: string[];
          category?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products_services"]["Insert"]>;
        Relationships: [];
      };
      promotions: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          discount_type: "percentage" | "fixed_amount";
          discount_value: number;
          starts_at: string;
          ends_at: string;
          conditions: string | null;
          product_ids: string[];
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          discount_type: "percentage" | "fixed_amount";
          discount_value: number;
          starts_at: string;
          ends_at: string;
          conditions?: string | null;
          product_ids?: string[];
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["promotions"]["Insert"]>;
        Relationships: [];
      };
      content_calendar: {
        Row: {
          id: string;
          tenant_id: string;
          date: string;
          slot_type: "post" | "carousel" | "story" | "reel";
          theme: string;
          status: "draft" | "approved" | "skipped";
          source: Record<string, unknown>;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          date: string;
          slot_type: "post" | "carousel" | "story" | "reel";
          theme: string;
          status?: "draft" | "approved" | "skipped";
          source?: Record<string, unknown>;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_calendar"]["Insert"]>;
        Relationships: [];
      };
      prompts: {
        Row: {
          id: string;
          name: string;
          version: number;
          template: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          version: number;
          template: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["prompts"]["Insert"]>;
        Relationships: [];
      };
      agents_registry: {
        Row: {
          id: string;
          name: string;
          version: number;
          allowed_tools: unknown[];
          prompt_name: string | null;
          model: string | null;
          status: "active" | "disabled";
          tenant_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          version?: number;
          allowed_tools?: unknown[];
          prompt_name?: string | null;
          model?: string | null;
          status?: "active" | "disabled";
          tenant_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agents_registry"]["Insert"]>;
        Relationships: [];
      };
      agent_calls: {
        Row: {
          id: string;
          agent_id: string | null;
          agent_name: string;
          tenant_id: string;
          job_id: string | null;
          correlation_id: string | null;
          input_tokens: number;
          output_tokens: number;
          cost_estimated_usd: number;
          latency_ms: number;
          status: "success" | "error" | "blocked";
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          agent_id?: string | null;
          agent_name: string;
          tenant_id: string;
          job_id?: string | null;
          correlation_id?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          cost_estimated_usd?: number;
          latency_ms?: number;
          status: "success" | "error" | "blocked";
          error_message?: string | null;
          created_at?: string;
        };
        // append-only: UPDATE/DELETE are revoked at the grant level, so this
        // table never has a legitimate Update shape.
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_tenant_with_owner: {
        Args: { tenant_name: string; tenant_slug: string; tenant_rubro: string };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      claim_pending_events: {
        Args: { batch_size?: number };
        Returns: Database["public"]["Tables"]["events"]["Row"][];
      };
      request_calendar_regeneration: {
        Args: { target_tenant_id: string };
        Returns: undefined;
      };
    };
  };
}
