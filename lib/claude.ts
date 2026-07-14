import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "./supabase";
import {
  addItemToOrder,
  confirmOrder,
  getItemDetails,
  listCategories,
  removeItemFromOrder,
  searchCatalog,
  updateCustomerInfo,
  viewOrder,
  type CatalogItem,
} from "./erp";
import { sendInteractiveButtons, sendListMessage } from "./whatsapp";

const SYSTEM_PROMPT = `You are the Arkflow Ordering Assistant on WhatsApp. Arkflow sells products (food, sports equipment, musical instruments, home equipment/furniture) and services (bus rental, tech development, business consulting).

Your job: figure out what the user is looking for from what they say (they may type or send a voice note, which arrives already transcribed), help them find the right item(s), build up an order, and confirm it when they're ready.

Guidelines:
- If the user's intent is unclear or they just say hi, call show_main_menu to present Products vs Services as buttons rather than guessing.
- If they pick a broad category, call show_category_menu to list items in it rather than describing every item in text.
- If they describe what they want in free text (typed or from a voice note), call search_catalog directly.
- When they want to add something, call add_item_to_order. Confirm quantities with the user if ambiguous.
- Before finalizing, call view_order and read the summary back to the user for confirmation.
- Only call confirm_order after the user explicitly confirms they want to place the order.
- Keep replies concise and conversational, suitable for a chat message. Use prices with their currency.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function formatItems(items: CatalogItem[]): string {
  if (items.length === 0) return "No matching items found.";
  return items
    .map((i) => `#${i.id} ${i.name} — ${i.price} ${i.currency}${i.unit ? ` / ${i.unit}` : ""} (${i.category})`)
    .join("\n");
}

interface ToolContext {
  phoneNumber: string;
  customerId: number;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "show_main_menu",
    description: "Send the user a button menu to choose between Products and Services.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "show_category_menu",
    description: "Send the user a list menu of categories for either products or services.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["product", "service"] },
      },
      required: ["type"],
    },
  },
  {
    name: "search_catalog",
    description: "Search the catalog by free-text query, optionally filtered to products or services.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: ["product", "service"] },
      },
      required: ["query"],
    },
  },
  {
    name: "get_item_details",
    description: "Get full details for a single catalog item by its id.",
    input_schema: {
      type: "object",
      properties: { item_id: { type: "number" } },
      required: ["item_id"],
    },
  },
  {
    name: "add_item_to_order",
    description: "Add a quantity of a catalog item to the user's current draft order.",
    input_schema: {
      type: "object",
      properties: {
        item_id: { type: "number" },
        quantity: { type: "number" },
      },
      required: ["item_id", "quantity"],
    },
  },
  {
    name: "remove_item_from_order",
    description: "Remove a catalog item entirely from the user's current draft order.",
    input_schema: {
      type: "object",
      properties: { item_id: { type: "number" } },
      required: ["item_id"],
    },
  },
  {
    name: "view_order",
    description: "Get the current draft order's items and total.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "confirm_order",
    description: "Finalize the user's draft order. Only call after the user explicitly confirms.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_customer_info",
    description: "Save the user's name and/or email once they provide it.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
    },
  },
];

async function executeTool(name: string, input: any, ctx: ToolContext): Promise<string> {
  switch (name) {
    case "show_main_menu": {
      await sendInteractiveButtons(ctx.phoneNumber, "What are you looking for today?", [
        { id: "menu_products", title: "Products" },
        { id: "menu_services", title: "Services" },
      ]);
      return "Main menu sent to the user.";
    }
    case "show_category_menu": {
      const categories = (await listCategories()).filter((c) => c.type === input.type);
      await sendListMessage(
        ctx.phoneNumber,
        input.type === "product" ? "Which kind of product?" : "Which service?",
        "Browse",
        [
          {
            title: input.type === "product" ? "Products" : "Services",
            rows: categories.map((c) => ({ id: `cat_${c.slug}`, title: c.name })),
          },
        ]
      );
      return "Category menu sent to the user.";
    }
    case "search_catalog": {
      const items = await searchCatalog(input.query, input.type);
      return formatItems(items);
    }
    case "get_item_details": {
      const item = await getItemDetails(input.item_id);
      if (!item) return "Item not found.";
      return `${item.name}: ${item.description ?? "no description"} — ${item.price} ${item.currency}${item.unit ? ` / ${item.unit}` : ""}`;
    }
    case "add_item_to_order": {
      const order = await addItemToOrder(ctx.customerId, input.item_id, input.quantity);
      return JSON.stringify(order);
    }
    case "remove_item_from_order": {
      const order = await removeItemFromOrder(ctx.customerId, input.item_id);
      return JSON.stringify(order);
    }
    case "view_order": {
      const order = await viewOrder(ctx.customerId);
      return JSON.stringify(order);
    }
    case "confirm_order": {
      const order = await confirmOrder(ctx.customerId);
      return JSON.stringify(order);
    }
    case "update_customer_info": {
      await updateCustomerInfo(ctx.phoneNumber, input);
      return "Customer info saved.";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export async function getAssistantReply(
  history: ConversationMessage[],
  userMessage: string,
  ctx: ToolContext
): Promise<string> {
  const anthropic = getClient();
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input, ctx);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Sorry, I'm having trouble processing that right now — could you try rephrasing?";
}
