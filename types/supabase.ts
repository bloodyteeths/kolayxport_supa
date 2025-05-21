export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      _prisma_migrations: {
        Row: {
          applied_steps_count: number
          checksum: string
          finished_at: string | null
          id: string
          logs: string | null
          migration_name: string
          rolled_back_at: string | null
          started_at: string
        }
        Insert: {
          applied_steps_count?: number
          checksum: string
          finished_at?: string | null
          id: string
          logs?: string | null
          migration_name: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Update: {
          applied_steps_count?: number
          checksum?: string
          finished_at?: string | null
          id?: string
          logs?: string | null
          migration_name?: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Relationships: []
      }
      Account: {
        Row: {
          access_token: string | null
          expires_at: number | null
          id: string
          id_token: string | null
          provider: string
          providerAccountId: string
          refresh_token: string | null
          refresh_token_expires_in: number | null
          scope: string | null
          session_state: string | null
          token_type: string | null
          type: string
          userId: string
        }
        Insert: {
          access_token?: string | null
          expires_at?: number | null
          id: string
          id_token?: string | null
          provider: string
          providerAccountId: string
          refresh_token?: string | null
          refresh_token_expires_in?: number | null
          scope?: string | null
          session_state?: string | null
          token_type?: string | null
          type: string
          userId: string
        }
        Update: {
          access_token?: string | null
          expires_at?: number | null
          id?: string
          id_token?: string | null
          provider?: string
          providerAccountId?: string
          refresh_token?: string | null
          refresh_token_expires_in?: number | null
          scope?: string | null
          session_state?: string | null
          token_type?: string | null
          type?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "Account_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      Inventory: {
        Row: {
          createdAt: string
          id: string
          location: string
          productId: string
          quantity: number
          reorderLevel: number | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id: string
          location?: string
          productId: string
          quantity?: number
          reorderLevel?: number | null
          updatedAt: string
        }
        Update: {
          createdAt?: string
          id?: string
          location?: string
          productId?: string
          quantity?: number
          reorderLevel?: number | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Inventory_productId_fkey"
            columns: ["productId"]
            isOneToOne: false
            referencedRelation: "Product"
            referencedColumns: ["id"]
          },
        ]
      }
      LabelJob: {
        Row: {
          carrier: string
          createdAt: string
          errorMessage: string | null
          id: string
          orderItemId: string
          pdfUrl: string | null
          status: string
          trackingNumber: string | null
          updatedAt: string
        }
        Insert: {
          carrier: string
          createdAt?: string
          errorMessage?: string | null
          id: string
          orderItemId: string
          pdfUrl?: string | null
          status: string
          trackingNumber?: string | null
          updatedAt: string
        }
        Update: {
          carrier?: string
          createdAt?: string
          errorMessage?: string | null
          id?: string
          orderItemId?: string
          pdfUrl?: string | null
          status?: string
          trackingNumber?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
      MarketplaceConfig: {
        Row: {
          config: Json
          createdAt: string
          id: string
          name: string
          updatedAt: string
          userId: string
        }
        Insert: {
          config: Json
          createdAt?: string
          id: string
          name: string
          updatedAt: string
          userId: string
        }
        Update: {
          config?: Json
          createdAt?: string
          id?: string
          name?: string
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "MarketplaceConfig_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      MarketplaceProduct: {
        Row: {
          createdAt: string
          id: string
          marketplace: string
          marketplaceData: Json | null
          marketplaceId: string
          productId: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id: string
          marketplace: string
          marketplaceData?: Json | null
          marketplaceId: string
          productId: string
          updatedAt: string
        }
        Update: {
          createdAt?: string
          id?: string
          marketplace?: string
          marketplaceData?: Json | null
          marketplaceId?: string
          productId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MarketplaceProduct_productId_fkey"
            columns: ["productId"]
            isOneToOne: false
            referencedRelation: "Product"
            referencedColumns: ["id"]
          },
        ]
      }
      Order: {
        Row: {
          createdAt: string
          currency: string | null
          customerName: string | null
          id: string
          marketplace: string
          marketplaceCreatedAt: string | null
          marketplaceKey: string
          notes: string | null
          orderNumber: string | null
          shipByDate: string | null
          status: string
          totalPrice: number | null
          updatedAt: string
          userId: string
        }
        Insert: {
          createdAt?: string
          currency?: string | null
          customerName?: string | null
          id: string
          marketplace: string
          marketplaceCreatedAt?: string | null
          marketplaceKey: string
          notes?: string | null
          orderNumber?: string | null
          shipByDate?: string | null
          status: string
          totalPrice?: number | null
          updatedAt: string
          userId: string
        }
        Update: {
          createdAt?: string
          currency?: string | null
          customerName?: string | null
          id?: string
          marketplace?: string
          marketplaceCreatedAt?: string | null
          marketplaceKey?: string
          notes?: string | null
          orderNumber?: string | null
          shipByDate?: string | null
          status?: string
          totalPrice?: number | null
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "Order_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      OrderItem: {
        Row: {
          id: string
          image: string | null
          marketplaceKey: string | null
          notes: string | null
          orderId: string
          orderNumber: string | null
          productName: string | null
          quantity: number
          shipBy: string | null
          sku: string | null
          totalPrice: number | null
          uniqueLineKey: string | null
          unitPrice: number | null
          variantInfo: string | null
        }
        Insert: {
          id: string
          image?: string | null
          marketplaceKey?: string | null
          notes?: string | null
          orderId: string
          orderNumber?: string | null
          productName?: string | null
          quantity: number
          shipBy?: string | null
          sku?: string | null
          totalPrice?: number | null
          uniqueLineKey?: string | null
          unitPrice?: number | null
          variantInfo?: string | null
        }
        Update: {
          id?: string
          image?: string | null
          marketplaceKey?: string | null
          notes?: string | null
          orderId?: string
          orderNumber?: string | null
          productName?: string | null
          quantity?: number
          shipBy?: string | null
          sku?: string | null
          totalPrice?: number | null
          uniqueLineKey?: string | null
          unitPrice?: number | null
          variantInfo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "OrderItem_orderId_fkey"
            columns: ["orderId"]
            isOneToOne: false
            referencedRelation: "Order"
            referencedColumns: ["id"]
          },
        ]
      }
      Product: {
        Row: {
          active: boolean
          cost: number | null
          createdAt: string
          description: string | null
          dimensions: Json | null
          id: string
          imageUrl: string | null
          name: string
          price: number
          sku: string
          updatedAt: string
          userId: string
          weight: number | null
        }
        Insert: {
          active?: boolean
          cost?: number | null
          createdAt?: string
          description?: string | null
          dimensions?: Json | null
          id: string
          imageUrl?: string | null
          name: string
          price: number
          sku: string
          updatedAt: string
          userId: string
          weight?: number | null
        }
        Update: {
          active?: boolean
          cost?: number | null
          createdAt?: string
          description?: string | null
          dimensions?: Json | null
          id?: string
          imageUrl?: string | null
          name?: string
          price?: number
          sku?: string
          updatedAt?: string
          userId?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "Product_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      Session: {
        Row: {
          expires: string
          id: string
          sessionToken: string
          userId: string
        }
        Insert: {
          expires: string
          id: string
          sessionToken: string
          userId: string
        }
        Update: {
          expires?: string
          id?: string
          sessionToken?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "Session_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      ShipperProfile: {
        Row: {
          createdAt: string
          defaultCurrencyCode: string | null
          dutiesPaymentType: string | null
          fedexFolderId: string | null
          id: string
          importerOfRecord: string | null
          shipperCity: string | null
          shipperCountryCode: string | null
          shipperName: string | null
          shipperPersonName: string | null
          shipperPhoneNumber: string | null
          shipperPostalCode: string | null
          shipperStateCode: string | null
          shipperStreet1: string | null
          shipperStreet2: string | null
          shipperTinNumber: string | null
          updatedAt: string
          userId: string
        }
        Insert: {
          createdAt?: string
          defaultCurrencyCode?: string | null
          dutiesPaymentType?: string | null
          fedexFolderId?: string | null
          id: string
          importerOfRecord?: string | null
          shipperCity?: string | null
          shipperCountryCode?: string | null
          shipperName?: string | null
          shipperPersonName?: string | null
          shipperPhoneNumber?: string | null
          shipperPostalCode?: string | null
          shipperStateCode?: string | null
          shipperStreet1?: string | null
          shipperStreet2?: string | null
          shipperTinNumber?: string | null
          updatedAt: string
          userId: string
        }
        Update: {
          createdAt?: string
          defaultCurrencyCode?: string | null
          dutiesPaymentType?: string | null
          fedexFolderId?: string | null
          id?: string
          importerOfRecord?: string | null
          shipperCity?: string | null
          shipperCountryCode?: string | null
          shipperName?: string | null
          shipperPersonName?: string | null
          shipperPhoneNumber?: string | null
          shipperPostalCode?: string | null
          shipperStateCode?: string | null
          shipperStreet1?: string | null
          shipperStreet2?: string | null
          shipperTinNumber?: string | null
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ShipperProfile_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      User: {
        Row: {
          createdAt: string
          driveFolderId: string | null
          email: string | null
          emailVerified: string | null
          googleAccountId: string | null
          googleSheetId: string | null
          id: string
          image: string | null
          name: string | null
          updatedAt: string
          userAppsScriptId: string | null
        }
        Insert: {
          createdAt?: string
          driveFolderId?: string | null
          email?: string | null
          emailVerified?: string | null
          googleAccountId?: string | null
          googleSheetId?: string | null
          id: string
          image?: string | null
          name?: string | null
          updatedAt: string
          userAppsScriptId?: string | null
        }
        Update: {
          createdAt?: string
          driveFolderId?: string | null
          email?: string | null
          emailVerified?: string | null
          googleAccountId?: string | null
          googleSheetId?: string | null
          id?: string
          image?: string | null
          name?: string | null
          updatedAt?: string
          userAppsScriptId?: string | null
        }
        Relationships: []
      }
      UserIntegrationSettings: {
        Row: {
          createdAt: string
          fedexAccountNumber: string | null
          fedexApiKey: string | null
          fedexApiSecret: string | null
          fedexMeterNumber: string | null
          hepsiburadaApiKey: string | null
          hepsiburadaMerchantId: string | null
          id: string
          shippoToken: string | null
          trendyolApiKey: string | null
          trendyolApiSecret: string | null
          trendyolSupplierId: string | null
          updatedAt: string
          userId: string
          veeqoApiKey: string | null
        }
        Insert: {
          createdAt?: string
          fedexAccountNumber?: string | null
          fedexApiKey?: string | null
          fedexApiSecret?: string | null
          fedexMeterNumber?: string | null
          hepsiburadaApiKey?: string | null
          hepsiburadaMerchantId?: string | null
          id: string
          shippoToken?: string | null
          trendyolApiKey?: string | null
          trendyolApiSecret?: string | null
          trendyolSupplierId?: string | null
          updatedAt: string
          userId: string
          veeqoApiKey?: string | null
        }
        Update: {
          createdAt?: string
          fedexAccountNumber?: string | null
          fedexApiKey?: string | null
          fedexApiSecret?: string | null
          fedexMeterNumber?: string | null
          hepsiburadaApiKey?: string | null
          hepsiburadaMerchantId?: string | null
          id?: string
          shippoToken?: string | null
          trendyolApiKey?: string | null
          trendyolApiSecret?: string | null
          trendyolSupplierId?: string | null
          updatedAt?: string
          userId?: string
          veeqoApiKey?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "UserIntegrationSettings_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "User"
            referencedColumns: ["id"]
          },
        ]
      }
      VerificationToken: {
        Row: {
          expires: string
          identifier: string
          token: string
        }
        Insert: {
          expires: string
          identifier: string
          token: string
        }
        Update: {
          expires?: string
          identifier?: string
          token?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
