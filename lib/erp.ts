import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

let client: ReturnType<typeof createClient> | null = null;

function getErpClient(): any {
  if (!client) {
    client = createClient(env("ERP_SUPABASE_URL"), env("ERP_SUPABASE_SERVICE_ROLE_KEY"));
  }
  return client;
}

function clientId(): number {
  return Number(env("ARKFLOW_CLIENT_ID"));
}

// The catalog's category grouping is fixed (7 categories). service_tariffs stores the
// slug in its `category` column; this is the single source of truth for display name + type.
export const CATEGORIES: Array<{ slug: string; name: string; type: "product" | "service" }> = [
  { slug: "food", name: "Food", type: "product" },
  { slug: "sports_equipment", name: "Sports Equipment", type: "product" },
  { slug: "musical_instruments", name: "Musical Instruments", type: "product" },
  { slug: "home_equipment", name: "Home & Furniture", type: "product" },
  { slug: "bus_rental", name: "Bus Rental", type: "service" },
  { slug: "tech_development", name: "Tech Development", type: "service" },
  { slug: "business_consulting", name: "Business Consulting", type: "service" },
];

function categoryName(slug: string | null): string {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? "Other";
}

function categoryType(slug: string | null): "product" | "service" {
  return CATEGORIES.find((c) => c.slug === slug)?.type ?? "product";
}

export interface CatalogItem {
  id: number;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  unit: string | null;
  category: string;
  category_type: "product" | "service";
}

function toCatalogItem(row: any): CatalogItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.base_price),
    currency: row.currency,
    unit: row.unit,
    category: categoryName(row.category),
    category_type: categoryType(row.category),
  };
}

export async function searchCatalog(
  query: string,
  type?: "product" | "service"
): Promise<CatalogItem[]> {
  const supabase = getErpClient();
  const { data, error } = await supabase
    .from("service_tariffs")
    .select("id, name, description, base_price, currency, unit, category")
    .eq("client_id", clientId())
    .eq("active", true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(10);

  if (error) throw error;
  let items: CatalogItem[] = (data ?? []).map(toCatalogItem);
  if (type) items = items.filter((i: CatalogItem) => i.category_type === type);
  return items;
}

export async function listItemsByCategory(categorySlug: string): Promise<CatalogItem[]> {
  const supabase = getErpClient();
  const { data, error } = await supabase
    .from("service_tariffs")
    .select("id, name, description, base_price, currency, unit, category")
    .eq("client_id", clientId())
    .eq("active", true)
    .eq("category", categorySlug)
    .limit(10);

  if (error) throw error;
  return (data ?? []).map(toCatalogItem);
}

export async function listCategories(): Promise<{ slug: string; name: string; type: string }[]> {
  return CATEGORIES;
}

export async function getItemDetails(itemId: number): Promise<CatalogItem | null> {
  const supabase = getErpClient();
  const { data, error } = await supabase
    .from("service_tariffs")
    .select("id, name, description, base_price, currency, unit, category")
    .eq("id", itemId)
    .eq("client_id", clientId())
    .single();

  if (error) return null;
  return toCatalogItem(data);
}

export async function findOrCreateCustomer(phoneNumber: string): Promise<number> {
  const supabase = getErpClient();

  const { data: existing, error: findError } = await supabase
    .from("customers")
    .select("id")
    .eq("client_id", clientId())
    .eq("phone", phoneNumber)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing.id as number;

  const { data: created, error: createError } = await supabase
    .from("customers")
    .insert({ client_id: clientId(), phone: phoneNumber, name: `WhatsApp ${phoneNumber}` })
    .select("id")
    .single();

  if (createError) throw createError;
  return created.id as number;
}

export async function updateCustomerInfo(
  phoneNumber: string,
  info: { name?: string; email?: string }
): Promise<void> {
  const supabase = getErpClient();
  const { error } = await supabase
    .from("customers")
    .update(info)
    .eq("client_id", clientId())
    .eq("phone", phoneNumber);

  if (error) throw error;
}

// An "order" in this ERP is a quote (source='whatsapp') with quote_services line items.
// The quote's subtotal/tax/total are recomputed by a DB trigger whenever lines change.
async function getOrCreateDraftQuote(customerId: number): Promise<number> {
  const supabase = getErpClient();

  const { data: existing, error: findError } = await supabase
    .from("quotes")
    .select("id")
    .eq("client_id", clientId())
    .eq("customer_id", customerId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing.id as number;

  const { data: created, error: createError } = await supabase
    .from("quotes")
    .insert({ client_id: clientId(), customer_id: customerId, source: "whatsapp", status: "draft" })
    .select("id")
    .single();

  if (createError) throw createError;
  return created.id as number;
}

export interface OrderView {
  orderId: number;
  status: string;
  currency: string;
  total: number;
  items: Array<{ item_id: number; name: string; quantity: number; unit_price: number; line_total: number }>;
}

async function loadQuote(quoteId: number): Promise<OrderView> {
  const supabase = getErpClient();

  const { data: quote, error: qErr } = await supabase
    .from("quotes")
    .select("id, status, currency, total")
    .eq("id", quoteId)
    .single();
  if (qErr) throw qErr;

  const { data: lines, error: lErr } = await supabase
    .from("quote_services")
    .select("tariff_id, itinerary, qty, unit_price, line_total")
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true });
  if (lErr) throw lErr;

  return {
    orderId: quote.id as number,
    status: quote.status as string,
    currency: quote.currency as string,
    total: Number(quote.total),
    items: (lines ?? []).map((row: any) => ({
      item_id: row.tariff_id,
      name: row.itinerary ?? "Item",
      quantity: Number(row.qty),
      unit_price: Number(row.unit_price),
      line_total: Number(row.line_total),
    })),
  };
}

export async function addItemToOrder(
  customerId: number,
  itemId: number,
  quantity: number
): Promise<OrderView> {
  const supabase = getErpClient();
  const item = await getItemDetails(itemId);
  if (!item) throw new Error(`Catalog item ${itemId} not found`);

  const quoteId = await getOrCreateDraftQuote(customerId);

  const { data: existing, error: findError } = await supabase
    .from("quote_services")
    .select("id, qty")
    .eq("quote_id", quoteId)
    .eq("tariff_id", itemId)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase
      .from("quote_services")
      .update({ qty: Number(existing.qty) + quantity })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("quote_services").insert({
      client_id: clientId(),
      quote_id: quoteId,
      tariff_id: itemId,
      itinerary: item.name, // product name — surfaced in the Orders drawer
      qty: quantity,
      unit_price: item.price,
    });
    if (error) throw error;
  }

  // quote totals are recalculated by the quote_services_recalc trigger.
  return loadQuote(quoteId);
}

export async function removeItemFromOrder(customerId: number, itemId: number): Promise<OrderView> {
  const supabase = getErpClient();
  const quoteId = await getOrCreateDraftQuote(customerId);

  const { error } = await supabase
    .from("quote_services")
    .delete()
    .eq("quote_id", quoteId)
    .eq("tariff_id", itemId);
  if (error) throw error;

  return loadQuote(quoteId);
}

export async function viewOrder(customerId: number): Promise<OrderView> {
  const quoteId = await getOrCreateDraftQuote(customerId);
  return loadQuote(quoteId);
}

export async function confirmOrder(customerId: number): Promise<OrderView> {
  const supabase = getErpClient();
  const quoteId = await getOrCreateDraftQuote(customerId);

  const { error } = await supabase
    .from("quotes")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw error;

  return loadQuote(quoteId);
}

// Per-interaction telemetry row, mirroring Avicsa's WhatsApp bot (automation 19):
// one run per handled message, response_time in whole seconds, customer = phone.
export async function logRun(params: {
  customer: string;
  respondingTo: string;
  responseTimeSec: number;
  success: boolean;
}): Promise<void> {
  const supabase = getErpClient();
  const automationId = Number(env("ARKFLOW_AUTOMATION_ID"));
  const { error } = await supabase.from("runs").insert({
    automation_id: automationId,
    response_time: Math.max(0, Math.round(params.responseTimeSec)),
    status: params.success ? "success" : "fail",
    customer: params.customer,
    responding_to: `WA: "${params.respondingTo}"`,
  });
  if (error) throw error;
}
