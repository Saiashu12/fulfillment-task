import { authenticate } from "../shopify.server";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import db from "../db.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);


  const productsRes = await admin.graphql(`
    query {
      products(first: 100) {
        nodes {
          id
          title
          variants(first: 50) {
            nodes {
              id
              title
              sku
            }
          }
        }
      }
    }
  `);

  const productsJson = await productsRes.json();

  const products = [];
  productsJson.data.products.nodes.forEach((product) => {
    product.variants.nodes.forEach((variant) => {
      products.push({
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        title: `${product.title} - ${variant.title}`,
        sku: variant.sku,
      });
    });
  });

  return {  products };
}

export async function action({ request }) {
  const formData = await request.formData();
  const selected = formData.getAll("products");

  if (!selected.length) return null;

  const data = selected.map((item) => JSON.parse(item));
  await db.products.createMany({
    data,
  });

  return { success: true };
}

export default function AdditionalPage() {
  const { products } = useLoaderData();
  const actionData = useActionData();
  const [showProducts, setShowProducts] = useState(false);
  return (
    <div>
      <h1>Additional Page</h1>

      <button onClick={() => setShowProducts(!showProducts)}>
        Available Products
      </button>

      {showProducts && (
        <Form method="post">
          <h2>Select Products</h2>

          {products.map((p) => (
            <div key={p.variantId}>
              <label>
                <input
                  type="checkbox"
                  name="products"
                  value={JSON.stringify(p)}
                />
                {p.title}
              </label>
            </div>
          ))}

          <button type="submit">Add Selected Products</button>

          {actionData?.success && (
            <p style={{ color: "green" }}>Products saved successfully</p>
          )}
        </Form>
      )}

      
    </div>
  );
}
