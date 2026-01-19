// ...existing code...
import React, { useState } from "react";

/**
 * Utility: trigger download of a JS object as a JSON file
 */
function downloadJSON(data, filename = "export.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Named export: ProductExportButton
 * Props:
 *  - products: array or object to export
 *  - filename: optional filename for download
 */
export function ProductExportButton({ products = [], filename = "products.json" }) {
  return (
    <button
      type="button"
      onClick={() => downloadJSON(products, filename)}
      style={{ padding: "8px 12px", cursor: "pointer" }}
    >
      Export Products
    </button>
  );
}

/**
 * Default export: ProductPage
 * Demonstrates usage of ProductExportButton with local sample data.
 */
export default function ProductPage() {
  const [products] = useState([
    { id: 1, name: "Product A", price: 9.99 },
    { id: 2, name: "Product B", price: 19.99 },
  ]);

  return (
    <main style={{ padding: 20 }}>
      <h1>Product Page</h1>
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {p.name} — ${p.price}
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 16 }}>
        <ProductExportButton products={products} filename="products-export.json" />
      </div>
    </main>
  );
}
// ...existing code...