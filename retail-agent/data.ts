/** In-memory mock data store for the retail agent. */

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  [key: string]: string | number;
}

export interface InventoryRecord {
  product_id: string;
  warehouse: string;
  quantity: number;
  last_updated: string;
  [key: string]: string | number;
}

export interface CartItem {
  product_id: string;
  quantity: number;
  [key: string]: string | number;
}

export interface Cart {
  cart_id: string;
  items: CartItem[];
  total: number;
  [key: string]: string | number | CartItem[];
}

// ---------------------------------------------------------------------------
// Product catalog – multiple items per category
// ---------------------------------------------------------------------------
export const PRODUCTS: Product[] = [
  // Electronics
  { id: 'PROD-001', name: 'Wireless Headphones', category: 'Electronics', price: 79.99, description: 'Noise-cancelling over-ear headphones with 30h battery' },
  { id: 'PROD-002', name: 'Bluetooth Speaker', category: 'Electronics', price: 49.99, description: 'Portable waterproof speaker with 360-degree sound' },
  { id: 'PROD-003', name: 'USB-C Charging Cable', category: 'Electronics', price: 12.99, description: 'Braided 6ft fast-charging cable' },
  // Sports
  { id: 'PROD-004', name: 'Running Shoes', category: 'Sports', price: 129.99, description: 'Lightweight trail running shoes with cushioned sole' },
  { id: 'PROD-005', name: 'Yoga Mat', category: 'Sports', price: 34.99, description: 'Non-slip eco-friendly yoga mat, 6 mm thick' },
  { id: 'PROD-006', name: 'Resistance Bands Set', category: 'Sports', price: 19.99, description: 'Set of 5 latex bands with varying resistance levels' },
  // Clothing
  { id: 'PROD-007', name: 'Cotton T-Shirt', category: 'Clothing', price: 24.99, description: 'Soft 100% cotton crew-neck t-shirt' },
  { id: 'PROD-008', name: 'Denim Jacket', category: 'Clothing', price: 89.99, description: 'Classic fit denim jacket with button closure' },
  { id: 'PROD-009', name: 'Wool Beanie', category: 'Clothing', price: 18.99, description: 'Warm knitted merino wool beanie' },
  // Home
  { id: 'PROD-010', name: 'Ceramic Coffee Mug', category: 'Home', price: 14.99, description: 'Handcrafted 12 oz ceramic mug' },
  { id: 'PROD-011', name: 'Scented Candle', category: 'Home', price: 22.99, description: 'Soy wax candle with lavender and vanilla scent, 50h burn' },
  { id: 'PROD-012', name: 'Throw Blanket', category: 'Home', price: 39.99, description: 'Ultra-soft fleece throw blanket, 50x60 inches' },
  // Books
  { id: 'PROD-013', name: 'Python Crash Course', category: 'Books', price: 39.99, description: 'Hands-on, project-based introduction to Python programming' },
  { id: 'PROD-014', name: 'Designing Data-Intensive Applications', category: 'Books', price: 44.99, description: 'Guide to distributed systems and data architecture' },
  { id: 'PROD-015', name: 'The Pragmatic Programmer', category: 'Books', price: 49.99, description: 'Classic guide to software craftsmanship and best practices' },
];

const WAREHOUSES = ['US-WEST', 'US-EAST', 'US-CENTRAL'];
const QUANTITIES = [150, 75, 300, 200, 120, 90, 250, 60, 180, 200, 110, 85, 50, 40, 65];

// ---------------------------------------------------------------------------
// Inventory records keyed by product ID
// ---------------------------------------------------------------------------
export const INVENTORY: Record<string, InventoryRecord> = Object.fromEntries(
  PRODUCTS.map((p, i) => [
    p.id,
    {
      product_id: p.id,
      warehouse: WAREHOUSES[i % 3],
      quantity: QUANTITIES[i],
      last_updated: '2025-01-15',
    },
  ]),
);

// ---------------------------------------------------------------------------
// Cart storage – keyed by session / cart ID, starts empty
// ---------------------------------------------------------------------------
export const CARTS: Record<string, Cart> = {};
