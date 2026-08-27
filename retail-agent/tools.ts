/** Retail agent tools for the Strands Agents TypeScript SDK. */

import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

import { PRODUCTS, INVENTORY, CARTS, type Cart } from './data.js';

function recalculateTotal(cart: Cart): void {
  let total = 0;
  for (const item of cart.items) {
    const p = PRODUCTS.find((p) => p.id === item.product_id);
    if (p) total += p.price * item.quantity;
  }
  cart.total = Math.round(total * 100) / 100;
}

function getOrCreateCart(): Cart {
  const cartId = 'default';
  if (!CARTS[cartId]) {
    CARTS[cartId] = { cart_id: cartId, items: [], total: 0 };
  }
  return CARTS[cartId];
}

const BROWSE_ALL = new Set(['', 'all', 'everything', '*']);

export const productSearch = tool({
  name: 'product_search',
  description:
    'Search for products by name, description, or category. An empty/blank ' +
    'query (or "all") returns the full catalog so customers can browse everything.',
  inputSchema: z.object({
    query: z.string().describe('Search query string matched against product name, description, and category'),
  }),
  callback: ({ query }) => {
    const q = query.trim().toLowerCase();
    if (BROWSE_ALL.has(q)) {
      return { query, results: PRODUCTS, count: PRODUCTS.length };
    }
    const results = PRODUCTS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
    return { query, results, count: results.length };
  },
});

export const checkInventory = tool({
  name: 'check_inventory',
  description: 'Check inventory stock levels for a specific product.',
  inputSchema: z.object({
    product_id: z.string().describe('The product identifier (e.g., "PROD-001")'),
  }),
  callback: ({ product_id }) => {
    const record = INVENTORY[product_id];
    if (!record) {
      return { error: 'Product not found', product_id };
    }
    return record;
  },
});

export const addToCart = tool({
  name: 'add_to_cart',
  description: 'Add a product to the shopping cart.',
  inputSchema: z.object({
    product_id: z.string().describe('The product identifier to add (e.g., "PROD-001")'),
    quantity: z.number().int().min(1).describe('Number of units to add (must be >= 1)'),
  }),
  callback: ({ product_id, quantity }) => {
    const product = PRODUCTS.find((p) => p.id === product_id);
    if (!product) {
      return { error: 'Product not found', product_id };
    }
    const cart = getOrCreateCart();
    const existing = cart.items.find((item) => item.product_id === product_id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.items.push({ product_id, quantity });
    }
    recalculateTotal(cart);
    return cart;
  },
});

export const updateCartItem = tool({
  name: 'update_cart_item',
  description: 'Update the quantity of a product already in the cart.',
  inputSchema: z.object({
    product_id: z.string().describe('The product identifier to update (e.g., "PROD-001")'),
    quantity: z.number().int().describe('New quantity to set. Must be >= 1'),
  }),
  callback: ({ product_id, quantity }) => {
    const cart = getOrCreateCart();
    const existing = cart.items.find((item) => item.product_id === product_id);
    if (!existing) {
      return { error: 'Product not in cart', product_id };
    }
    if (quantity < 1) {
      return { error: 'Quantity must be at least 1. Use remove_from_cart to delete.', product_id };
    }
    existing.quantity = quantity;
    recalculateTotal(cart);
    return cart;
  },
});

export const removeFromCart = tool({
  name: 'remove_from_cart',
  description: 'Remove a product from the shopping cart entirely.',
  inputSchema: z.object({
    product_id: z.string().describe('The product identifier to remove (e.g., "PROD-001")'),
  }),
  callback: ({ product_id }) => {
    const cart = getOrCreateCart();
    const originalLen = cart.items.length;
    cart.items = cart.items.filter((item) => item.product_id !== product_id);
    if (cart.items.length === originalLen) {
      return { error: 'Product not in cart', product_id };
    }
    recalculateTotal(cart);
    return cart;
  },
});

export const getCart = tool({
  name: 'get_cart',
  description: 'View the current shopping cart contents and total.',
  callback: () => getOrCreateCart(),
});

export const tools = [
  productSearch,
  checkInventory,
  addToCart,
  updateCartItem,
  removeFromCart,
  getCart,
];
