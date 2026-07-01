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
        Relationships: []
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
        Relationships: []
      }
      businesses: {
        Row: {
          city: string | null
          created_at: string
          currency: string
          id: string
          industry: string | null
          industry_other: string | null
          name: string
          owner_id: string
          state: string | null
          subscription_cycle: string | null
          subscription_renews_at: string | null
          subscription_started_at: string | null
          subscription_tier: string | null
          timezone: string | null
          whatsapp_number: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          currency?: string
          id?: string
          industry?: string | null
          industry_other?: string | null
          name: string
          owner_id: string
          state?: string | null
          subscription_cycle?: string | null
          subscription_renews_at?: string | null
          subscription_started_at?: string | null
          subscription_tier?: string | null
          timezone?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          currency?: string
          id?: string
          industry?: string | null
          industry_other?: string | null
          name?: string
          owner_id?: string
          state?: string | null
          subscription_cycle?: string | null
          subscription_renews_at?: string | null
          subscription_started_at?: string | null
          subscription_tier?: string | null
          timezone?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
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
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
            foreignKeyName: "invoices_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      material_purchases: {
        Row: {
          business_id: string
          created_at: string
          id: string
          notes: string | null
          quantity: number
          raw_material_id: string
          supplier_id: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          notes?: string | null
          quantity: number
          raw_material_id: string
          supplier_id?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          quantity?: number
          raw_material_id?: string
          supplier_id?: string | null
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
          id: string
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
          id?: string
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
          id?: string
          notes?: string | null
          payment_method?: string
          staff_id?: string | null
          status?: string
          stock_deducted?: boolean
          total_amount?: number
          updated_at?: string
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
          unit: string | null
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
          unit?: string | null
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
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
          notes: string | null
          po_number: string
          received_at: string | null
          status: string
          supplier_id: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          po_number: string
          received_at?: string | null
          status?: string
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          po_number?: string
          received_at?: string | null
          status?: string
          supplier_id?: string | null
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
          unit_price: number
        }
        Insert: {
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          unit_price: number
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
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
      sales: {
        Row: {
          business_id: string
          created_at: string
          discount_amount: number
          id: string
          payment_method: string
          staff_id: string | null
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
      current_business_id: { Args: never; Returns: string }
      deduct_raw_materials_for_product: {
        Args: { _product_id: string; _quantity: number }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
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
          status: string
          business_name: string | null
          email: string | null
          role: Database["public"]["Enums"]["app_role"] | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      remove_member: {
        Args: { _user_id: string }
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
      user_business_role: {
        Args: { _business_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
    }
    Enums: {
      app_role: "owner" | "manager" | "cashier"
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
    Enums: {
      app_role: ["owner", "manager", "cashier"],
    },
  },
} as const
