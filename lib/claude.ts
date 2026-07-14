import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "./supabase";
import {
  addItemToOrder,
  confirmOrder,
  getItemDetails,
  listCategories,
  listItemsByCategory,
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
- Always reply in the same language the user is writing in (detect it from their message; if a voice note transcript is in Portuguese, reply in Portuguese, etc.). This includes text you pass into show_main_menu/show_category_menu.
- If the user's intent is unclear or they just say hi, call show_main_menu to present Products vs Services as buttons rather than guessing.
- If they pick a broad category (product or service type), call show_category_menu to present the specific categories as a list rather than describing every item in text.
- If the user just tapped a specific category from that list, call list_items_in_category with its slug and present the results conversationally.
- show_main_menu and show_category_menu send the ONLY message for that turn — their body_text IS your reply. Never send additional text alongside or after them.
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
    description:
      "Send the user a button menu to choose between Products and Services. This message IS your reply — do not send additional text alongside it.",
    input_schema: {
      type: "object",
      properties: {
        body_text: {
          type: "string",
          description:
            "Short prompt shown above the buttons (e.g. \"What are you looking for today?\"), written in the same language the user has been writing in.",
        },
        products_label: {
          type: "string",
          description: "Button label for the products option, max 20 characters, in the user's language.",
        },
        services_label: {
          type: "string",
          description: "Button label for the services option, max 20 characters, in the user's language.",
        },
      },
      required: ["body_text", "products_label", "services_label"],
    },
  },
  {
    name: "show_category_menu",
    description:
      "Send the user a list menu of categories for either products or services. This message IS your reply — do not send additional text alongside it.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["product", "service"] },
        body_text: {
          type: "string",
          description:
            "Short prompt shown above the list (e.g. \"Which kind of product?\"), written in the same language the user has been writing in.",
        },
        button_text: {
          type: "string",
          description: "Label for the button that opens the list, max 20 characters, in the user's language.",
        },
      },
      required: ["type", "body_text", "button_text"],
    },
  },
  {
    name: "list_items_in_category",
    description: "List all items in one specific category by its slug (use after the user taps a category from a menu).",
    input_schema: {
      type: "object",
      properties: { category_slug: { type: "string" } },
      required: ["category_slug"],
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
      await sendInteractiveButtons(ctx.phoneNumber, input.body_text, [
        { id: "menu_products", title: input.products_label },
        { id: "menu_services", title: input.services_label },
      ]);
      return "Main menu sent to the user.";
    }
    case "show_category_menu": {
      const categories = (await listCategories()).filter((c) => c.type === input.type);
      await sendListMessage(ctx.phoneNumber, input.body_text, input.button_text, [
        {
          title: input.type === "product" ? "Products" : "Services",
          rows: categories.map((c) => ({ id: `cat_${c.slug}`, title: c.name })),
        },
      ]);
      return "Category menu sent to the user.";
    }
    case "list_items_in_category": {
      const items = await listItemsByCategory(input.category_slug);
      return formatItems(items);
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

// Pure-navigation tools send a WhatsApp menu whose own body text (written by Claude,
// in the user's language) already is the reply — no second round-trip, no follow-up text.
const NAVIGATION_TOOLS = new Set(["show_main_menu", "show_category_menu"]);

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
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock?.type === "text" ? textBlock.text : "";
    }

    const toolUses = response.content.filter((block) => block.type === "tool_use");
    const allNavigation = toolUses.every((block) => NAVIGATION_TOOLS.has(block.name));

    if (allNavigation && toolUses.length > 0) {
      for (const block of toolUses) {
        await executeTool(block.name, block.input, ctx);
      }
      return "";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      const result = await executeTool(block.name, block.input, ctx);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Sorry, I'm having trouble processing that right now — could you try rephrasing?";
}
