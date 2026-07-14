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

export async function searchCatalog(
  query: string,
  type?: "product" | "service"
): Promise<CatalogItem[]> {
  const supabase = getErpClient();
  let request = supabase
    .from("catalog_items")
    .select("id, name, description, price, currency, unit, categories(name, type)")
    .eq("client_id", clientId())
    .eq("active", true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(10);

  if (type) {
    request = request.eq("categories.type", type);
  }

  const { data, error } = await request;
  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => row.categories)
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      currency: row.currency,
      unit: row.unit,
      category: row.categories.name,
      category_type: row.categories.type,
    }));
}

export async function listItemsByCategory(categorySlug: string): Promise<CatalogItem[]> {
  const supabase = getErpClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, description, price, currency, unit, categories!inner(name, type, slug)")
    .eq("client_id", clientId())
    .eq("active", true)
    .eq("categories.slug", categorySlug)
    .limit(10);

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    unit: row.unit,
    category: row.categories.name,
    category_type: row.categories.type,
  }));
}

export async function listCategories(): Promise<{ slug: string; name: string; type: string }[]> {
  const supabase = getErpClient();
  const { data, error } = await supabase.from("categories").select("slug, name, type");
  if (error) throw error;
  return data ?? [];
}

export async function getItemDetails(itemId: number): Promise<CatalogItem | null> {
  const supabase = getErpClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .select("id, name, description, price, currency, unit, categories(name, type)")
    .eq("id", itemId)
    .eq("client_id", clientId())
    .single();

  if (error) return null;
  const row = data as any;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    unit: row.unit,
    category: row.categories.name,
    category_type: row.categories.type,
  };
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

async function getOrCreateDraftOrder(customerId: number): Promise<number> {
  const supabase = getErpClient();

  const { data: existing, error: findError } = await supabase
    .from("orders")
    .select("id")
    .eq("client_id", clientId())
    .eq("customer_id", customerId)
    .eq("status", "draft")
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing.id as number;

  const { data: created, error: createError } = await supabase
    .from("orders")
    .insert({ client_id: clientId(), customer_id: customerId, status: "draft" })
    .select("id")
    .single();

  if (createError) throw createError;
  return created.id as number;
}

async function recalculateOrderTotal(orderId: number): Promise<number> {
  const supabase = getErpClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("line_total")
    .eq("order_id", orderId);

  if (error) throw error;
  const total = (data ?? []).reduce((sum: number, row: any) => sum + Number(row.line_total), 0);

  const { error: updateError } = await supabase
    .from("orders")
    .update({ total, updated_at: new Date().toISOString() })
    .eq("id", orderId);

  if (updateError) throw updateError;
  return total;
}

export interface OrderView {
  orderId: number;
  status: string;
  currency: string;
  total: number;
  items: Array<{ item_id: number; name: string; quantity: number; unit_price: number; line_total: number }>;
}

async function loadOrder(orderId: number): Promise<OrderView> {
  const supabase = getErpClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, currency, total")
    .eq("id", orderId)
    .single();
  if (orderError) throw orderError;

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("catalog_item_id, quantity, unit_price, line_total, catalog_items(name)")
    .eq("order_id", orderId);
  if (itemsError) throw itemsError;

  return {
    orderId: order.id as number,
    status: order.status as string,
    currency: order.currency as string,
    total: Number(order.total),
    items: (items ?? []).map((row: any) => ({
      item_id: row.catalog_item_id,
      name: row.catalog_items?.name ?? "Unknown item",
      quantity: row.quantity,
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

  const orderId = await getOrCreateDraftOrder(customerId);

  const { data: existing, error: findError } = await supabase
    .from("order_items")
    .select("id, quantity")
    .eq("order_id", orderId)
    .eq("catalog_item_id", itemId)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { error } = await supabase
      .from("order_items")
      .update({ quantity: existing.quantity + quantity })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("order_items")
      .insert({ order_id: orderId, catalog_item_id: itemId, quantity, unit_price: item.price });
    if (error) throw error;
  }

  await recalculateOrderTotal(orderId);
  return loadOrder(orderId);
}

export async function removeItemFromOrder(customerId: number, itemId: number): Promise<OrderView> {
  const supabase = getErpClient();
  const orderId = await getOrCreateDraftOrder(customerId);

  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("order_id", orderId)
    .eq("catalog_item_id", itemId);
  if (error) throw error;

  await recalculateOrderTotal(orderId);
  return loadOrder(orderId);
}

export async function viewOrder(customerId: number): Promise<OrderView> {
  const orderId = await getOrCreateDraftOrder(customerId);
  return loadOrder(orderId);
}

export async function confirmOrder(customerId: number): Promise<OrderView> {
  const supabase = getErpClient();
  const orderId = await getOrCreateDraftOrder(customerId);

  const { error } = await supabase
    .from("orders")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw error;

  return loadOrder(orderId);
}
