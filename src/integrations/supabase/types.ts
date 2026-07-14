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
      accounts: {
        Row: {
          active: boolean
          business_id: string
          code: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          type: string
        }
        Insert: {
          active?: boolean
          business_id: string
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          type: string
        }
        Update: {
          active?: boolean
          business_id?: string
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      activity_log: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          business_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          summary: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          business_id: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          summary: string
          type: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          business_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          summary?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      app_modules: {
        Row: {
          is_active: boolean
          key: string
          label: string
          path: string | null
          sort_order: number
        }
        Insert: {
          is_active?: boolean
          key: string
          label: string
          path?: string | null
          sort_order?: number
        }
        Update: {
          is_active?: boolean
          key?: string
          label?: string
          path?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      businesses: {
        Row: {
          books_opening_date: string | null
          city: string | null
          created_at: string
          currency: string
          export_account_name: string | null
          export_account_number: string | null
          export_address: string | null
          export_bank_name: string | null
          export_country: string | null
          export_email: string | null
          export_invoice_prefix: string | null
          export_phone: string | null
          export_rc_number: string | null
          export_swift: string | null
          id: string
          industry: string | null
          industry_other: string | null
          name: string
          onboarding_profile: Json | null
          opening_capital: number | null
          opening_cash: number | null
          owner_id: string
          prices_include_tax: boolean
          state: string | null
          subscription_cycle: string | null
          subscription_renews_at: string | null
          subscription_started_at: string | null
          subscription_tier: string | null
          tax_enabled: boolean
          timezone: string | null
          tin: string | null
          trial_plan: string | null
          trial_started_at: string | null
          valuation_method: string
          whatsapp_number: string | null
        }
        Insert: {
          books_opening_date?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          export_account_name?: string | null
          export_account_number?: string | null
          export_address?: string | null
          export_bank_name?: string | null
          export_country?: string | null
          export_email?: string | null
          export_invoice_prefix?: string | null
          export_phone?: string | null
          export_rc_number?: string | null
          export_swift?: string | null
          id?: string
          industry?: string | null
          industry_other?: string | null
          name: string
          onboarding_profile?: Json | null
          opening_capital?: number | null
          opening_cash?: number | null
          owner_id: string
          prices_include_tax?: boolean
          state?: string | null
          subscription_cycle?: string | null
          subscription_renews_at?: string | null
          subscription_started_at?: string | null
          subscription_tier?: string | null
          tax_enabled?: boolean
          timezone?: string | null
          tin?: string | null
          trial_plan?: string | null
          trial_started_at?: string | null
          valuation_method?: string
          whatsapp_number?: string | null
        }
        Update: {
          books_opening_date?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          export_account_name?: string | null
          export_account_number?: string | null
          export_address?: string | null
          export_bank_name?: string | null
          export_country?: string | null
          export_email?: string | null
          export_invoice_prefix?: string | null
          export_phone?: string | null
          export_rc_number?: string | null
          export_swift?: string | null
          id?: string
          industry?: string | null
          industry_other?: string | null
          name?: string
          onboarding_profile?: Json | null
          opening_capital?: number | null
          opening_cash?: number | null
          owner_id?: string
          prices_include_tax?: boolean
          state?: string | null
          subscription_cycle?: string | null
          subscription_renews_at?: string | null
          subscription_started_at?: string | null
          subscription_tier?: string | null
          tax_enabled?: boolean
          timezone?: string | null
          tin?: string | null
          trial_plan?: string | null
          trial_started_at?: string | null
          valuation_method?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_subscription_tier_fkey"
            columns: ["subscription_tier"]
            isOneToOne: false
            referencedRelation: "plan_prices_view"
            referencedColumns: ["plan_key"]
          },
          {
            foreignKeyName: "businesses_subscription_tier_fkey"
            columns: ["subscription_tier"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      cs_account_assignment: {
        Row: {
          account_manager_id: string | null
          assigned_at: string
          business_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          account_manager_id?: string | null
          assigned_at?: string
          business_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          account_manager_id?: string | null
          assigned_at?: string
          business_id?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_account_assignment_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_account_assignment_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_alert: {
        Row: {
          acknowledged_by: string | null
          business_id: string
          created_at: string
          detail: string | null
          id: string
          kind: string
          resolved_at: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_by?: string | null
          business_id: string
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          resolved_at?: string | null
          severity: string
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_by?: string | null
          business_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_alert_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_alert_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_customer_message: {
        Row: {
          body: string
          business_id: string
          channel: string
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          provider_message_id: string | null
          status: string
          subject: string
          template_key: string | null
          to_email: string
          to_name: string | null
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          channel?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          provider_message_id?: string | null
          status?: string
          subject: string
          template_key?: string | null
          to_email: string
          to_name?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          provider_message_id?: string | null
          status?: string
          subject?: string
          template_key?: string | null
          to_email?: string
          to_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_customer_message_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_customer_message_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_email_template: {
        Row: {
          body: string
          created_at: string
          key: string
          name: string
          subject: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          key: string
          name: string
          subject: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          key?: string
          name?: string
          subject?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cs_feature_request: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          detail: string | null
          id: string
          status: string
          title: string
          updated_at: string
          votes: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          status?: string
          title: string
          updated_at?: string
          votes?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          detail?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string
          votes?: number
        }
        Relationships: [
          {
            foreignKeyName: "cs_feature_request_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_feature_request_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_feedback: {
        Row: {
          body: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          rating: number | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          rating?: number | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          rating?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_feedback_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_feedback_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_health_snapshot: {
        Row: {
          band: string
          business_id: string
          captured_at: string
          created_at: string
          id: string
          reasons: Json
          score: number
          updated_at: string
        }
        Insert: {
          band: string
          business_id: string
          captured_at?: string
          created_at?: string
          id?: string
          reasons?: Json
          score: number
          updated_at?: string
        }
        Update: {
          band?: string
          business_id?: string
          captured_at?: string
          created_at?: string
          id?: string
          reasons?: Json
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_health_snapshot_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_health_snapshot_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_lead: {
        Row: {
          business_id: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string | null
          notes: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_lead_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_lead_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_note: {
        Row: {
          author_id: string | null
          body: string
          business_id: string
          created_at: string
          id: string
          type: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          business_id: string
          created_at?: string
          id?: string
          type?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          business_id?: string
          created_at?: string
          id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_note_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_note_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_pipeline: {
        Row: {
          business_id: string
          created_at: string
          stage: string
          stage_source: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          stage: string
          stage_source?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          stage?: string
          stage_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_pipeline_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_pipeline_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_plan_change_request: {
        Row: {
          approved_by: string | null
          business_id: string
          code_attempts: number
          code_expires_at: string | null
          code_hash: string | null
          created_at: string
          created_by: string | null
          executed_at: string | null
          from_cycle: string | null
          from_tier: string | null
          id: string
          requested_by: string | null
          status: string
          to_cycle: string | null
          to_tier: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          business_id: string
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          from_cycle?: string | null
          from_tier?: string | null
          id?: string
          requested_by?: string | null
          status?: string
          to_cycle?: string | null
          to_tier: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          business_id?: string
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          from_cycle?: string | null
          from_tier?: string | null
          id?: string
          requested_by?: string | null
          status?: string
          to_cycle?: string | null
          to_tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_plan_change_request_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_plan_change_request_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_renewal_payment: {
        Row: {
          amount: number | null
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          cycle: string | null
          id: string
          notes: string | null
          paid_at: string
          plan_key: string | null
          ref_no: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          business_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          cycle?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          plan_key?: string | null
          ref_no?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          cycle?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          plan_key?: string | null
          ref_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_renewal_payment_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_renewal_payment_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_settings: {
        Row: {
          adoption_active_days: number
          alert_adoption_days: number
          alert_churn_days: number
          alert_onboarding_days: number
          alert_renewal_critical_days: number
          alert_renewal_warn_days: number
          band_green_min: number
          band_yellow_min: number
          login_green_days: number
          login_red_days: number
          login_yellow_days: number
          products_stale_days: number
          renewal_healthy_days: number
          renewal_window_days: number
          sales_green_days: number
          sales_mid_days: number
          sales_window_days: number
          singleton: boolean
          updated_at: string
          warning_no_sales_days: number
        }
        Insert: {
          adoption_active_days?: number
          alert_adoption_days?: number
          alert_churn_days?: number
          alert_onboarding_days?: number
          alert_renewal_critical_days?: number
          alert_renewal_warn_days?: number
          band_green_min?: number
          band_yellow_min?: number
          login_green_days?: number
          login_red_days?: number
          login_yellow_days?: number
          products_stale_days?: number
          renewal_healthy_days?: number
          renewal_window_days?: number
          sales_green_days?: number
          sales_mid_days?: number
          sales_window_days?: number
          singleton?: boolean
          updated_at?: string
          warning_no_sales_days?: number
        }
        Update: {
          adoption_active_days?: number
          alert_adoption_days?: number
          alert_churn_days?: number
          alert_onboarding_days?: number
          alert_renewal_critical_days?: number
          alert_renewal_warn_days?: number
          band_green_min?: number
          band_yellow_min?: number
          login_green_days?: number
          login_red_days?: number
          login_yellow_days?: number
          products_stale_days?: number
          renewal_healthy_days?: number
          renewal_window_days?: number
          sales_green_days?: number
          sales_mid_days?: number
          sales_window_days?: number
          singleton?: boolean
          updated_at?: string
          warning_no_sales_days?: number
        }
        Relationships: []
      }
      cs_staff_role: {
        Row: {
          created_at: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cs_task: {
        Row: {
          assignee_id: string | null
          assignee_role: string | null
          business_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignee_role?: string | null
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          status?: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignee_role?: string | null
          business_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_task_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_task_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_ticket: {
        Row: {
          assignee_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          priority: string
          resolved_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_ticket_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_ticket_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      doc_counters: {
        Row: {
          business_id: string
          period: string
          scope: string
          seq: number
        }
        Insert: {
          business_id: string
          period: string
          scope: string
          seq?: number
        }
        Update: {
          business_id?: string
          period?: string
          scope?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "doc_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      email_alerts_sent: {
        Row: {
          alert_key: string
          business_id: string
          sent_at: string
        }
        Insert: {
          alert_key: string
          business_id: string
          sent_at?: string
        }
        Update: {
          alert_key?: string
          business_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_alerts_sent_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_alerts_sent_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          business_id: string
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          expense_date: string
          id: string
          paid_date: string | null
          payee: string | null
          payment_method: string | null
          receipt_ref: string | null
          status: string
          supplier_id: string | null
          tax_amount: number
          updated_at: string
        }
        Insert: {
          amount?: number
          business_id: string
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          expense_date?: string
          id?: string
          paid_date?: string | null
          payee?: string | null
          payment_method?: string | null
          receipt_ref?: string | null
          status?: string
          supplier_id?: string | null
          tax_amount?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          business_id?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          expense_date?: string
          id?: string
          paid_date?: string | null
          payee?: string | null
          payment_method?: string | null
          receipt_ref?: string | null
          status?: string
          supplier_id?: string | null
          tax_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      export_invoices: {
        Row: {
          account_name: string | null
          account_number: string | null
          amount_in_words: string | null
          bank_name: string | null
          business_id: string
          buyer_address: string | null
          buyer_country: string | null
          buyer_name: string | null
          country_of_origin: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivery_terms: string | null
          id: string
          invoice_date: string
          invoice_number: string
          items: Json
          mode_of_shipment: string | null
          notes: string | null
          packaging: string | null
          payment_terms: string | null
          seller_address: string | null
          seller_email: string | null
          seller_name: string | null
          seller_phone: string | null
          seller_rc: string | null
          subtotal: number
          swift: string | null
          total: number
          total_cartons: number
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          amount_in_words?: string | null
          bank_name?: string | null
          business_id: string
          buyer_address?: string | null
          buyer_country?: string | null
          buyer_name?: string | null
          country_of_origin?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_terms?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          items?: Json
          mode_of_shipment?: string | null
          notes?: string | null
          packaging?: string | null
          payment_terms?: string | null
          seller_address?: string | null
          seller_email?: string | null
          seller_name?: string | null
          seller_phone?: string | null
          seller_rc?: string | null
          subtotal?: number
          swift?: string | null
          total?: number
          total_cartons?: number
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          amount_in_words?: string | null
          bank_name?: string | null
          business_id?: string
          buyer_address?: string | null
          buyer_country?: string | null
          buyer_name?: string | null
          country_of_origin?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_terms?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          items?: Json
          mode_of_shipment?: string | null
          notes?: string | null
          packaging?: string | null
          payment_terms?: string | null
          seller_address?: string | null
          seller_email?: string | null
          seller_name?: string | null
          seller_phone?: string | null
          seller_rc?: string | null
          subtotal?: number
          swift?: string | null
          total?: number
          total_cartons?: number
        }
        Relationships: [
          {
            foreignKeyName: "export_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          active: boolean
          business_id: string
          category: string | null
          cost: number
          created_at: string
          created_by: string | null
          depreciation_rate: number
          id: string
          name: string
          year_purchased: number | null
        }
        Insert: {
          active?: boolean
          business_id: string
          category?: string | null
          cost?: number
          created_at?: string
          created_by?: string | null
          depreciation_rate?: number
          id?: string
          name: string
          year_purchased?: number | null
        }
        Update: {
          active?: boolean
          business_id?: string
          category?: string | null
          cost?: number
          created_at?: string
          created_by?: string | null
          depreciation_rate?: number
          id?: string
          name?: string
          year_purchased?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          business_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          team_role_id: string | null
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          team_role_id?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          team_role_id?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invitations_team_role_id_fkey"
            columns: ["team_role_id"]
            isOneToOne: false
            referencedRelation: "team_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          description: string
          id: string
          invoice_id: string
          line_total: number
          quantity: number
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          invoice_id: string
          line_total?: number
          quantity?: number
          unit_price?: number
        }
        Update: {
          description?: string
          id?: string
          invoice_id?: string
          line_total?: number
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          method: string
          note: string | null
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          method?: string
          note?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          method?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          business_id: string
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          discount_amount: number
          due_date: string | null
          fully_paid_at: string | null
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          sale_id: string | null
          status: string
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          business_id: string
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          discount_amount?: number
          due_date?: string | null
          fully_paid_at?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          sale_id?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          discount_amount?: number
          due_date?: string | null
          fully_paid_at?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          sale_id?: string | null
          status?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          memo: string | null
          source: string
          source_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          memo?: string | null
          source?: string
          source_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          memo?: string | null
          source?: string
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          business_id: string
          credit: number
          debit: number
          description: string | null
          entry_id: string
          id: string
        }
        Insert: {
          account_id: string
          business_id: string
          credit?: number
          debit?: number
          description?: string | null
          entry_id: string
          id?: string
        }
        Update: {
          account_id?: string
          business_id?: string
          credit?: number
          debit?: number
          description?: string | null
          entry_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      material_purchases: {
        Row: {
          business_id: string
          created_at: string
          id: string
          landed_costs: Json
          landed_total: number
          notes: string | null
          quantity: number
          raw_material_id: string
          supplier_id: string | null
          tax_amount: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          landed_costs?: Json
          landed_total?: number
          notes?: string | null
          quantity: number
          raw_material_id: string
          supplier_id?: string | null
          tax_amount?: number
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          landed_costs?: Json
          landed_total?: number
          notes?: string | null
          quantity?: number
          raw_material_id?: string
          supplier_id?: string | null
          tax_amount?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_purchases_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      member_access: {
        Row: {
          business_id: string
          permissions: Json | null
          team_role_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          permissions?: Json | null
          team_role_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          permissions?: Json | null
          team_role_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_access_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "member_access_team_role_id_fkey"
            columns: ["team_role_id"]
            isOneToOne: false
            referencedRelation: "team_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          business_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          link: string | null
          read_at: string | null
          recipient_id: string
          title: string
          type: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          business_id: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_id: string
          title: string
          type: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          business_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_id: string
          channel: string
          created_at: string
          customer_name: string
          customer_phone: string | null
          discount_amount: number
          id: string
          invoice_id: string | null
          notes: string | null
          payment_method: string
          staff_id: string | null
          status: string
          stock_deducted: boolean
          total_amount: number
          updated_at: string
        }
        Insert: {
          business_id: string
          channel?: string
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_method?: string
          staff_id?: string | null
          status?: string
          stock_deducted?: boolean
          total_amount?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          channel?: string
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_method?: string
          staff_id?: string | null
          status?: string
          stock_deducted?: boolean
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_employees: {
        Row: {
          account_name: string | null
          account_number: string | null
          active: boolean
          bank_name: string | null
          base_rate: number
          business_id: string
          created_at: string
          id: string
          name: string
          notes: string | null
          pay_type: string
          store_staff_id: string | null
          user_id: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          active?: boolean
          bank_name?: string | null
          base_rate?: number
          business_id: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          pay_type?: string
          store_staff_id?: string | null
          user_id?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          active?: boolean
          bank_name?: string | null
          base_rate?: number
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          pay_type?: string
          store_staff_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employees_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_employees_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "payroll_employees_store_staff_id_fkey"
            columns: ["store_staff_id"]
            isOneToOne: false
            referencedRelation: "store_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run_lines: {
        Row: {
          business_id: string
          deduction_total: number
          deductions: Json
          employee_id: string | null
          employee_name: string
          gross_pay: number
          id: string
          net_pay: number
          notes: string | null
          run_id: string
        }
        Insert: {
          business_id: string
          deduction_total?: number
          deductions?: Json
          employee_id?: string | null
          employee_name: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          run_id: string
        }
        Update: {
          business_id?: string
          deduction_total?: number
          deductions?: Json
          employee_id?: string | null
          employee_name?: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "payroll_run_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "payroll_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          deduction_total: number
          expense_id: string | null
          gross_total: number
          id: string
          net_total: number
          notes: string | null
          pay_date: string
          period_end: string | null
          period_label: string
          period_start: string | null
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          deduction_total?: number
          expense_id?: string | null
          gross_total?: number
          id?: string
          net_total?: number
          notes?: string | null
          pay_date?: string
          period_end?: string | null
          period_label: string
          period_start?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          deduction_total?: number
          expense_id?: string | null
          gross_total?: number
          id?: string
          net_total?: number
          notes?: string | null
          pay_date?: string
          period_end?: string | null
          period_label?: string
          period_start?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "payroll_runs_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_prices: {
        Row: {
          cycle: string
          discount_percent: number
          id: string
          is_active: boolean
          plan_id: string
          price_amount: number
          sort_order: number
        }
        Insert: {
          cycle: string
          discount_percent?: number
          id?: string
          is_active?: boolean
          plan_id: string
          price_amount?: number
          sort_order?: number
        }
        Update: {
          cycle?: string
          discount_percent?: number
          id?: string
          is_active?: boolean
          plan_id?: string
          price_amount?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          billing_period: string | null
          business_id: string | null
          created_at: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          key: string
          limits: Json
          modules: Json
          name: string
          price_amount: number
          price_currency: string
          promo_label: string | null
          promo_percent: number
          promo_until: string | null
          sort_order: number
        }
        Insert: {
          billing_period?: string | null
          business_id?: string | null
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          key: string
          limits?: Json
          modules?: Json
          name: string
          price_amount?: number
          price_currency?: string
          promo_label?: string | null
          promo_percent?: number
          promo_until?: string | null
          sort_order?: number
        }
        Update: {
          billing_period?: string | null
          business_id?: string | null
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          key?: string
          limits?: Json
          modules?: Json
          name?: string
          price_amount?: number
          price_currency?: string
          promo_label?: string | null
          promo_percent?: number
          promo_until?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "plans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_materials: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity_per_unit: number
          raw_material_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity_per_unit?: number
          raw_material_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity_per_unit?: number
          raw_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      production_requisition_items: {
        Row: {
          id: string
          quantity_issued: number | null
          quantity_requested: number
          raw_material_id: string
          requisition_id: string
        }
        Insert: {
          id?: string
          quantity_issued?: number | null
          quantity_requested: number
          raw_material_id: string
          requisition_id: string
        }
        Update: {
          id?: string
          quantity_issued?: number | null
          quantity_requested?: number
          raw_material_id?: string
          requisition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_requisition_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_requisition_items_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "production_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      production_requisitions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          decision_note: string | null
          id: string
          notes: string | null
          requested_by: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          decision_note?: string | null
          id?: string
          notes?: string | null
          requested_by?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          decision_note?: string | null
          id?: string
          notes?: string | null
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_requisitions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_requisitions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      production_run_materials: {
        Row: {
          id: string
          quantity_used: number
          quantity_wasted: number
          raw_material_id: string
          run_id: string
        }
        Insert: {
          id?: string
          quantity_used: number
          quantity_wasted?: number
          raw_material_id: string
          run_id: string
        }
        Update: {
          id?: string
          quantity_used?: number
          quantity_wasted?: number
          raw_material_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_run_materials_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_run_materials_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      production_run_outputs: {
        Row: {
          id: string
          product_id: string
          quantity: number
          run_id: string
        }
        Insert: {
          id?: string
          product_id: string
          quantity: number
          run_id: string
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_run_outputs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_run_outputs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "production_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      production_runs: {
        Row: {
          business_id: string
          created_at: string
          id: string
          notes: string | null
          produced_by: string | null
          requisition_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          notes?: string | null
          produced_by?: string | null
          requisition_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          produced_by?: string | null
          requisition_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "production_runs_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "production_requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          business_id: string
          category: string | null
          cost_price: number
          created_at: string
          expiry_date: string | null
          id: string
          name: string
          reorder_level: number
          selling_price: number
          sku: string | null
          stock_quantity: number
          tax_id: string | null
          unit: string | null
          weight: number | null
        }
        Insert: {
          business_id: string
          category?: string | null
          cost_price?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          name: string
          reorder_level?: number
          selling_price?: number
          sku?: string | null
          stock_quantity?: number
          tax_id?: string | null
          unit?: string | null
          weight?: number | null
        }
        Update: {
          business_id?: string
          category?: string | null
          cost_price?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          name?: string
          reorder_level?: number
          selling_price?: number
          sku?: string | null
          stock_quantity?: number
          tax_id?: string | null
          unit?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "products_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          business_id: string | null
          created_at: string
          id: string
          last_seen: string | null
          notification_prefs: Json | null
          onboarded: boolean
          owner_name: string
          phone: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          id: string
          last_seen?: string | null
          notification_prefs?: Json | null
          onboarded?: boolean
          owner_name: string
          phone?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string
          id?: string
          last_seen?: string | null
          notification_prefs?: Json | null
          onboarded?: boolean
          owner_name?: string
          phone?: string | null
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          description: string
          id: string
          line_total: number
          product_id: string | null
          purchase_order_id: string
          quantity: number
          raw_material_id: string | null
          unit_cost: number
        }
        Insert: {
          description: string
          id?: string
          line_total?: number
          product_id?: string | null
          purchase_order_id: string
          quantity?: number
          raw_material_id?: string | null
          unit_cost?: number
        }
        Update: {
          description?: string
          id?: string
          line_total?: number
          product_id?: string | null
          purchase_order_id?: string
          quantity?: number
          raw_material_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          business_id: string
          created_at: string
          expected_date: string | null
          id: string
          landed_costs: Json
          notes: string | null
          po_number: string
          received_at: string | null
          status: string
          supplier_id: string | null
          tax_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          expected_date?: string | null
          id?: string
          landed_costs?: Json
          notes?: string | null
          po_number: string
          received_at?: string | null
          status?: string
          supplier_id?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          expected_date?: string | null
          id?: string
          landed_costs?: Json
          notes?: string | null
          po_number?: string
          received_at?: string | null
          status?: string
          supplier_id?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_materials: {
        Row: {
          business_id: string
          cost_per_unit: number
          created_at: string
          id: string
          name: string
          notes: string | null
          reorder_level: number
          sku: string | null
          stock_quantity: number
          supplier_id: string | null
          unit: string
          updated_at: string
          weight: number | null
        }
        Insert: {
          business_id: string
          cost_per_unit?: number
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          reorder_level?: number
          sku?: string | null
          stock_quantity?: number
          supplier_id?: string | null
          unit?: string
          updated_at?: string
          weight?: number | null
        }
        Update: {
          business_id?: string
          cost_per_unit?: number
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          reorder_level?: number
          sku?: string | null
          stock_quantity?: number
          supplier_id?: string | null
          unit?: string
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_materials_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          product_id: string
          quantity: number
          sale_id: string
          unit_cost: number | null
          unit_price: number
        }
        Insert: {
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          unit_cost?: number | null
          unit_price: number
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
          unit_cost?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          method: string
          sale_id: string
        }
        Insert: {
          amount?: number
          business_id: string
          created_at?: string
          id?: string
          method: string
          sale_id: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          method?: string
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          business_id: string
          created_at: string
          discount_amount: number
          id: string
          payment_method: string
          staff_id: string | null
          tax_amount: number
          total_amount: number
          voided: boolean
        }
        Insert: {
          business_id: string
          created_at?: string
          discount_amount?: number
          id?: string
          payment_method?: string
          staff_id?: string | null
          tax_amount?: number
          total_amount?: number
          voided?: boolean
        }
        Update: {
          business_id?: string
          created_at?: string
          discount_amount?: number
          id?: string
          payment_method?: string
          staff_id?: string | null
          tax_amount?: number
          total_amount?: number
          voided?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sales_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          business_id: string
          created_at: string
          delta: number
          id: string
          notes: string | null
          product_id: string | null
          raw_material_id: string | null
          reason: string
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          delta: number
          id?: string
          notes?: string | null
          product_id?: string | null
          raw_material_id?: string | null
          reason: string
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          delta?: number
          id?: string
          notes?: string | null
          product_id?: string | null
          raw_material_id?: string | null
          reason?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      store_items: {
        Row: {
          business_id: string
          category: string | null
          created_at: string
          id: string
          kind: string
          name: string
          reorder_level: number
          stock_quantity: number
          unit: string | null
        }
        Insert: {
          business_id: string
          category?: string | null
          created_at?: string
          id?: string
          kind?: string
          name: string
          reorder_level?: number
          stock_quantity?: number
          unit?: string | null
        }
        Update: {
          business_id?: string
          category?: string | null
          created_at?: string
          id?: string
          kind?: string
          name?: string
          reorder_level?: number
          stock_quantity?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      store_staff: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          id: string
          name: string
          phone: string | null
          role: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          role?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_staff_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_staff_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      store_transactions: {
        Row: {
          business_id: string
          created_at: string
          due_date: string | null
          id: string
          item_id: string
          kind: string
          notes: string | null
          quantity: number
          returned_at: string | null
          returned_quantity: number
          staff_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          item_id: string
          kind: string
          notes?: string | null
          quantity: number
          returned_at?: string | null
          returned_quantity?: number
          staff_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          item_id?: string
          kind?: string
          notes?: string | null
          quantity?: number
          returned_at?: string | null
          returned_quantity?: number
          staff_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "store_transactions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "store_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_transactions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "store_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number
          business_id: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string
          cycle: string
          id: string
          plan_key: string
          started_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          business_id: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string
          cycle?: string
          id?: string
          plan_key: string
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          business_id?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string
          cycle?: string
          id?: string
          plan_key?: string
          started_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plan_prices_view"
            referencedColumns: ["plan_key"]
          },
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          business_id: string
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          rating: number | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_id: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_id?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          rating?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      taxes: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          rate: number
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          rate?: number
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "taxes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taxes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      team_roles: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          permissions: Json
          system_key: Database["public"]["Enums"]["app_role"] | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
          permissions?: Json
          system_key?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          permissions?: Json
          system_key?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_roles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_roles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          business_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
    }
    Views: {
      cs_alert_active: {
        Row: {
          acknowledged_by: string | null
          business_id: string | null
          business_name: string | null
          created_at: string | null
          detail: string | null
          id: string | null
          kind: string | null
          resolved_at: string | null
          severity: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_alert_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_alert_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_health_current: {
        Row: {
          band: string | null
          business_id: string | null
          captured_at: string | null
          reasons: Json | null
          score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_health_snapshot_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_health_snapshot_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_task_admin: {
        Row: {
          assignee_id: string | null
          assignee_role: string | null
          business_id: string | null
          business_name: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          id: string | null
          status: string | null
          title: string | null
          type: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cs_task_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_task_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "mv_business_aggregates"
            referencedColumns: ["business_id"]
          },
        ]
      }
      cs_worklist_admin: {
        Row: {
          assignee_role: string | null
          business_id: string | null
          business_name: string | null
          closed_at: string | null
          created_at: string | null
          due_date: string | null
          id: string | null
          kind: string | null
          priority: string | null
          rating: number | null
          status: string | null
          sub_type: string | null
          title: string | null
          votes: number | null
        }
        Relationships: []
      }
      mv_business_aggregates: {
        Row: {
          active_users: number | null
          business_id: string | null
          computed_at: string | null
          last_login: string | null
          orders_count: number | null
          products_added_30d: number | null
          products_low_stock: number | null
          products_total: number | null
          purchase_orders: number | null
          revenue_recorded: number | null
          sales_count: number | null
          stock_movements: number | null
          total_users: number | null
        }
        Relationships: []
      }
      plan_prices_view: {
        Row: {
          cycle: string | null
          discount_percent: number | null
          id: string | null
          is_active: boolean | null
          plan_id: string | null
          plan_key: string | null
          plan_name: string | null
          price_amount: number | null
          sort_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_prices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _ensure_asset_accounts: {
        Args: { _business_id: string }
        Returns: undefined
      }
      _post_journal_impl: {
        Args: {
          _business_id: string
          _entry_date: string
          _lines: Json
          _memo: string
          _source: string
          _source_id: string
        }
        Returns: string
      }
      accept_invitation: { Args: { _token: string }; Returns: string }
      admin_apply_plan_change: {
        Args: { p_actor: string; p_code: string; p_request_id: string }
        Returns: Json
      }
      admin_approve_plan_change: {
        Args: { p_request_id: string }
        Returns: string
      }
      admin_business_aggregates: {
        Args: { p_business_id?: string }
        Returns: Database["public"]["CompositeTypes"]["admin_business_row"][]
        SetofOptions: {
          from: "*"
          to: "admin_business_row"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_business_profile: {
        Args: { p_business_id: string }
        Returns: {
          industry: string
          owner_email: string
        }[]
      }
      admin_business_usage: {
        Args: { p_business_id: string }
        Returns: {
          orders_30d: number
          orders_90d: number
          orders_total: number
          po_30d: number
          po_90d: number
          po_total: number
          products_30d: number
          products_90d: number
          products_total: number
          revenue_30d: number
          revenue_90d: number
          revenue_total: number
          sales_30d: number
          sales_90d: number
          sales_total: number
          stock_30d: number
          stock_90d: number
          stock_total: number
        }[]
      }
      admin_cancel_plan_change: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      admin_customers_facets: { Args: never; Returns: Json }
      admin_customers_page: {
        Args: {
          p_account_manager?: string
          p_active?: boolean
          p_at_risk?: boolean
          p_band?: string
          p_dir?: string
          p_industry?: string
          p_limit?: number
          p_new_this_month?: boolean
          p_offset?: number
          p_paying?: boolean
          p_plan?: string
          p_renewal_days?: number
          p_renewal_due?: boolean
          p_search?: string
          p_sort?: string
          p_subscription_status?: string
          p_trial?: boolean
          p_unassigned?: boolean
        }
        Returns: {
          account_manager_id: string
          account_manager_name: string
          business_id: string
          health_band: string
          health_score: number
          industry: string
          joined_at: string
          last_login: string
          name: string
          owner_name: string
          plan_key: string
          products_total: number
          renewal_date: string
          sales_count: number
          subscription_status: string
          total_count: number
          total_users: number
        }[]
      }
      admin_dashboard_kpis: {
        Args: never
        Returns: {
          active_subscriptions: number
          currency: string
          mrr: number
          new_this_month: number
          total_businesses: number
          total_products: number
          total_revenue: number
          total_sales: number
        }[]
      }
      admin_delete_business: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      admin_get_plan_change: {
        Args: { p_business_id: string }
        Returns: {
          approved_by: string
          approved_by_name: string
          business_id: string
          code_expires_at: string
          created_at: string
          from_cycle: string
          from_tier: string
          id: string
          requested_by: string
          requested_by_name: string
          status: string
          to_cycle: string
          to_tier: string
        }[]
      }
      admin_health_trend: {
        Args: { p_days?: number }
        Returns: {
          at_risk: number
          day: string
          green: number
          total: number
          yellow: number
        }[]
      }
      admin_list_plans: {
        Args: never
        Returns: {
          cycle: string
          discount_percent: number
          plan_key: string
          plan_name: string
          price_amount: number
        }[]
      }
      admin_list_staff: {
        Args: never
        Returns: {
          email: string
          name: string
          user_id: string
        }[]
      }
      admin_list_staff_roles: {
        Args: never
        Returns: {
          email: string
          name: string
          pending: boolean
          role: string
          user_id: string
        }[]
      }
      admin_pipeline_board: {
        Args: never
        Returns: {
          account_manager_id: string
          account_manager_name: string
          business_id: string
          health_band: string
          health_score: number
          name: string
          renewal_date: string
          stage: string
          stage_source: string
        }[]
      }
      admin_refresh_aggregates: { Args: never; Returns: undefined }
      admin_remove_staff: { Args: { p_user_id: string }; Returns: undefined }
      admin_renewal_revenue: {
        Args: never
        Returns: {
          payment_count: number
          total: number
        }[]
      }
      admin_request_plan_change: {
        Args: { p_business_id: string; p_to_cycle: string; p_to_tier: string }
        Returns: string
      }
      approve_requisition: {
        Args: { _items?: Json; _requisition_id: string }
        Returns: Json
      }
      assert_permission: {
        Args: { _action: string; _business_id: string; _module: string }
        Returns: undefined
      }
      businesses_alert_snapshot: {
        Args: never
        Returns: {
          business_id: string
          business_name: string
          invoices: number
          owner_email: string
          products: number
          purchase_orders: number
          raw_materials: number
          staff: number
          subscription_renews_at: string
          subscription_tier: string
          suppliers: number
        }[]
      }
      cancel_requisition: { Args: { _requisition_id: string }; Returns: Json }
      commit_offline_invoice: { Args: { _invoice: Json }; Returns: Json }
      commit_offline_sale: { Args: { _sale: Json }; Returns: Json }
      commit_pos_sale: { Args: { _sale: Json }; Returns: Json }
      create_export_invoice: { Args: { _data: Json }; Returns: Json }
      create_export_invoice_impl: { Args: { _data: Json }; Returns: Json }
      create_requisition: {
        Args: { _business_id: string; _items: Json; _notes: string }
        Returns: Json
      }
      cs_alert_rules: {
        Args: {
          p_created: string
          p_first_product: string
          p_last_login: string
          p_last_sale: string
          p_now?: string
          p_period_end: string
          p_products: number
          p_sub_status: string
        }
        Returns: {
          active: boolean
          detail: string
          kind: string
          severity: string
        }[]
      }
      cs_apply_alert: {
        Args: {
          p_active: boolean
          p_business_id: string
          p_detail: string
          p_kind: string
          p_severity: string
        }
        Returns: undefined
      }
      cs_auto_stage: { Args: { p_business_id: string }; Returns: string }
      cs_can_see_business: { Args: { p_business_id: string }; Returns: boolean }
      cs_can_write: { Args: { p_area: string }; Returns: boolean }
      cs_compute_health: {
        Args: { p_business_id: string }
        Returns: {
          band: string
          reasons: Json
          score: number
        }[]
      }
      cs_customer_messages: {
        Args: { p_business_id: string }
        Returns: {
          business_id: string
          created_at: string
          created_by: string
          created_by_name: string
          error: string
          id: string
          status: string
          subject: string
          template_key: string
          to_email: string
        }[]
      }
      cs_cycle_months: { Args: { p_cycle: string }; Returns: number }
      cs_derive_pipeline: { Args: never; Returns: undefined }
      cs_eval_alerts: { Args: { p_business_id: string }; Returns: undefined }
      cs_eval_alerts_all: { Args: never; Returns: number }
      cs_get_settings: {
        Args: never
        Returns: {
          adoption_active_days: number
          alert_adoption_days: number
          alert_churn_days: number
          alert_onboarding_days: number
          alert_renewal_critical_days: number
          alert_renewal_warn_days: number
          band_green_min: number
          band_yellow_min: number
          login_green_days: number
          login_red_days: number
          login_yellow_days: number
          products_stale_days: number
          renewal_healthy_days: number
          renewal_window_days: number
          sales_green_days: number
          sales_mid_days: number
          sales_window_days: number
          singleton: boolean
          updated_at: string
          warning_no_sales_days: number
        }
        SetofOptions: {
          from: "*"
          to: "cs_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cs_is_admin: { Args: never; Returns: boolean }
      cs_message_log: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: {
          business_id: string
          business_name: string
          created_at: string
          created_by: string
          created_by_name: string
          error: string
          id: string
          status: string
          subject: string
          template_key: string
          to_email: string
          total_count: number
        }[]
      }
      cs_my_role: { Args: never; Returns: string }
      cs_nightly: { Args: never; Returns: undefined }
      cs_pipeline_stage: {
        Args: {
          p_active_users: number
          p_created: string
          p_last_login: string
          p_now?: string
          p_products: number
          p_purchase_orders: number
          p_sales: number
          p_sub_cycle: string
          p_sub_started: string
          p_sub_status: string
        }
        Returns: string
      }
      cs_recompute_alerts_business: {
        Args: { p_business_id: string }
        Returns: {
          acknowledged_by: string | null
          business_id: string
          created_at: string
          detail: string | null
          id: string
          kind: string
          resolved_at: string | null
          severity: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cs_alert"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cs_recompute_business: {
        Args: { p_business_id: string }
        Returns: {
          band: string
          business_id: string
          captured_at: string
          created_at: string
          id: string
          reasons: Json
          score: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cs_health_snapshot"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cs_role_can_write: {
        Args: { p_area: string; p_role: string }
        Returns: boolean
      }
      cs_score: {
        Args: {
          p_active_users: number
          p_last_login: string
          p_last_sale: string
          p_now?: string
          p_period_end: string
          p_products_recent: number
          p_products_total: number
          p_sub_status: string
        }
        Returns: {
          band: string
          reasons: Json
          score: number
        }[]
      }
      cs_sees_all: { Args: never; Returns: boolean }
      cs_sees_revenue: { Args: never; Returns: boolean }
      cs_snapshot_all: { Args: never; Returns: number }
      current_business_id: { Args: never; Returns: string }
      deduct_sale_stock: {
        Args: { _business_id: string; _items: Json }
        Returns: undefined
      }
      default_role_permissions: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_export_invoice: { Args: { _id: string }; Returns: undefined }
      delete_export_invoice_impl: { Args: { _id: string }; Returns: undefined }
      delete_invoice: { Args: { _invoice_id: string }; Returns: undefined }
      delete_invoice_impl: { Args: { _invoice_id: string }; Returns: undefined }
      delete_invoice_payment: { Args: { _payment_id: string }; Returns: Json }
      delete_invoice_payment_impl: {
        Args: { _payment_id: string }
        Returns: Json
      }
      delete_order: { Args: { _order_id: string }; Returns: undefined }
      delete_order_impl: { Args: { _order_id: string }; Returns: undefined }
      delete_requisition: {
        Args: { _requisition_id: string }
        Returns: undefined
      }
      deliver_order: { Args: { _order_id: string }; Returns: Json }
      deliver_order_impl: { Args: { _order_id: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      ensure_chart_of_accounts: { Args: never; Returns: undefined }
      get_invite_preview: {
        Args: { _token: string }
        Returns: {
          business_name: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      get_invite_state: {
        Args: { _token: string }
        Returns: {
          business_name: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }[]
      }
      get_member_emails: {
        Args: { p_business_id: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      has_business_role: {
        Args: {
          _business_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_permission: {
        Args: { _action: string; _business_id: string; _module: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      log_invoice_edit: {
        Args: { _invoice_id: string; _summary: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_doc_number: {
        Args: {
          _business_id: string
          _col: string
          _prefix: string
          _table: string
        }
        Returns: string
      }
      next_export_invoice_number: {
        Args: { _business_id: string }
        Returns: string
      }
      next_invoice_number: { Args: { _business_id: string }; Returns: string }
      post_journal: {
        Args: { _entry_date: string; _lines: Json; _memo: string }
        Returns: string
      }
      post_payroll_run: {
        Args: { _mark_paid: boolean; _payment_method: string; _run_id: string }
        Returns: Json
      }
      post_sale_journal: {
        Args: { _business_id: string; _sale_id: string }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_invoice_payment: {
        Args: {
          _amount: number
          _invoice_id: string
          _method: string
          _note: string
          _payment_id: string
        }
        Returns: Json
      }
      record_invoice_payment_impl: {
        Args: {
          _amount: number
          _invoice_id: string
          _method: string
          _note: string
          _payment_id: string
        }
        Returns: Json
      }
      record_production_run: {
        Args: {
          _business_id: string
          _labour_overhead?: number
          _materials: Json
          _notes: string
          _outputs: Json
          _requisition_id: string
          _shipping?: number
        }
        Returns: Json
      }
      reject_requisition: {
        Args: { _reason?: string; _requisition_id: string }
        Returns: Json
      }
      remove_member: { Args: { _user_id: string }; Returns: undefined }
      restock_sale_stock: {
        Args: { _business_id: string; _items: Json }
        Returns: undefined
      }
      run_depreciation: { Args: never; Returns: Json }
      start_plan_trial: { Args: { _plan_key: string }; Returns: Json }
      store_checkout: {
        Args: {
          _business_id: string
          _due_date: string
          _item_id: string
          _kind: string
          _notes: string
          _quantity: number
          _staff_id: string
        }
        Returns: Json
      }
      store_checkout_impl: {
        Args: {
          _business_id: string
          _due_date: string
          _item_id: string
          _kind: string
          _notes: string
          _quantity: number
          _staff_id: string
        }
        Returns: Json
      }
      store_return: {
        Args: { _quantity: number; _transaction_id: string }
        Returns: Json
      }
      store_return_impl: {
        Args: { _quantity: number; _transaction_id: string }
        Returns: Json
      }
      sync_asset_journal: {
        Args: { _business_id: string; _id: string }
        Returns: undefined
      }
      sync_expense_journal: {
        Args: { _business_id: string; _id: string }
        Returns: undefined
      }
      sync_invoice_journal: {
        Args: { _business_id: string; _id: string }
        Returns: undefined
      }
      sync_notifications: { Args: never; Returns: undefined }
      sync_payment_journal: {
        Args: { _business_id: string; _id: string }
        Returns: undefined
      }
      sync_po_journal: {
        Args: { _business_id: string; _id: string }
        Returns: undefined
      }
      sync_purchase_journal: {
        Args: { _business_id: string; _id: string }
        Returns: undefined
      }
      update_export_invoice: {
        Args: { _data: Json; _id: string }
        Returns: Json
      }
      update_export_invoice_impl: {
        Args: { _data: Json; _id: string }
        Returns: Json
      }
      update_requisition: {
        Args: { _items: Json; _notes: string; _requisition_id: string }
        Returns: Json
      }
      user_business_role: {
        Args: { _business_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
    }
    Enums: {
      app_role: "owner" | "manager" | "cashier"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "expired"
    }
    CompositeTypes: {
      admin_business_row: {
        business_id: string | null
        name: string | null
        currency: string | null
        timezone: string | null
        whatsapp_number: string | null
        owner_id: string | null
        owner_name: string | null
        plan_key: string | null
        subscription_status: string | null
        subscription_amount: number | null
        subscription_cycle: string | null
        subscription_started: string | null
        renewal_date: string | null
        joined_at: string | null
        total_users: number | null
        active_users: number | null
        last_login: string | null
        products_total: number | null
        products_added_30d: number | null
        products_low_stock: number | null
        stock_movements: number | null
        purchase_orders: number | null
        sales_count: number | null
        revenue_recorded: number | null
        orders_count: number | null
      }
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
    Enums: {
      app_role: ["owner", "manager", "cashier"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "expired",
      ],
    },
  },
} as const
