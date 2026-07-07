/**
 * Hand-written placeholder matching migrations/00000000000001_core_schema.sql.
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
          hitl_mode: "full-auto" | "approve-creatives" | "approve-all";
          status: "active" | "paused" | "archived";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          hitl_mode?: "full-auto" | "approve-creatives" | "approve-all";
          status?: "active" | "paused" | "archived";
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
    };
    Views: Record<string, never>;
    Functions: {
      create_tenant_with_owner: {
        Args: { tenant_name: string; tenant_slug: string };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      claim_pending_events: {
        Args: { batch_size?: number };
        Returns: Database["public"]["Tables"]["events"]["Row"][];
      };
    };
  };
}
