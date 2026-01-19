import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const addedProducts = await db.products.findMany();

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

  const shopifyProducts = [];
  productsJson.data.products.nodes.forEach((product) => {
    product.variants.nodes.forEach((variant) => {
      shopifyProducts.push({
        productId: product.id,
        productTitle: product.title,
        variantId: variant.id,
        variantTitle: variant.title,
        title: `${product.title} - ${variant.title}`,
        sku: variant.sku,
      });
    });
  });

  const availableProducts = shopifyProducts.filter(
    (p) =>
      !addedProducts.some(
        (a) => a.productId === p.productId && a.variantId === p.variantId,
      ),
  );

  return { addedProducts, availableProducts };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "updateInventory") {
    const variantId = formData.get("variantId");
    const sku = formData.get("sku");

    const inventoryRes = await fetch("http://localhost:4000/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku }),
    });

    const inventoryData = await inventoryRes.json();
    const quantity = inventoryData.inventory;

    if (quantity === undefined) {
      return { error: "Inventory API failed" };
    }

    const shopSetup = await db.shopSetup.findUnique({
      where: { shop },
    });

    const locationRes = await admin.graphql(
      `
      query GetFulfillmentServiceLocation($id: ID!) {
        fulfillmentService(id: $id) {
          location { id }
        }
      }
      `,
      { variables: { id: shopSetup.fulfillmentServiceId } },
    );

    const locationJson = await locationRes.json();
    const locationId = locationJson.data.fulfillmentService.location.id;

    const itemRes = await admin.graphql(
      `
      query GetInventoryItemsForVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            inventoryItem { id }
          }
        }
      }
      `,
      { variables: { ids: [variantId] } },
    );

    const itemJson = await itemRes.json();
    const inventoryItemId = itemJson.data.nodes[0].inventoryItem.id;

    await admin.graphql(
      `
      mutation SetAvailableInventory(
        $inventoryItemId: ID!
        $locationId: ID!
        $quantity: Int!
      ) {
        inventorySetQuantities(
          input: {
            name: "available"
            reason: "restock"
            ignoreCompareQuantity: true
            quantities: [{
              inventoryItemId: $inventoryItemId
              locationId: $locationId
              quantity: $quantity
            }]
          }
        ) {
          userErrors { message }
        }
      }
      `,
      {
        variables: {
          inventoryItemId,
          locationId,
          quantity,
        },
      },
    );

    return { success: true };
  }
  const selected = formData.getAll("products");

  if (!selected.length) {
    return { error: "Please select at least one product." };
  }

  const shopSetup = await db.shopSetup.findUnique({
    where: { shop },
  });

  const parsedSelected = selected.map((item) => JSON.parse(item));

  const data = parsedSelected.map((p) => ({
    ...p,
    fulfillmentServiceId: shopSetup.fulfillmentServiceId,
  }));

  await db.products.createMany({ data });

  const fsRes = await admin.graphql(
    `
    query GetFulfillmentServiceLocation($id: ID!) {
      fulfillmentService(id: $id) {
        location { id }
      }
    }
    `,
    { variables: { id: shopSetup.fulfillmentServiceId } },
  );

  const fsJson = await fsRes.json();
  const fsLocationId = fsJson.data.fulfillmentService.location.id;
  const variantIds = parsedSelected.map((p) => p.variantId);

  const inventoryItemsRes = await admin.graphql(
    `
    query GetInventoryItemsForVariants($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          inventoryItem { id }
        }
      }
    }
    `,
    { variables: { ids: variantIds } },
  );

  const inventoryItemsJson = await inventoryItemsRes.json();

  const inventoryItemMap = new Map();
  inventoryItemsJson.data.nodes.forEach((n) => {
    if (n?.inventoryItem) {
      inventoryItemMap.set(n.id, n.inventoryItem.id);
    }
  });

  const locationsRes = await admin.graphql(`
    query {
      locations(first: 10) {
        nodes { id }
      }
    }
  `);

  const locationsJson = await locationsRes.json();
  const merchantLocations = locationsJson.data.locations.nodes;

  for (const variantId of variantIds) {
    const inventoryItemId = inventoryItemMap.get(variantId);
    if (!inventoryItemId) continue;

    for (const loc of merchantLocations) {
      await admin.graphql(
        `
        mutation RemoveInventory(
          $inventoryItemId: ID!
          $locationId: ID!
        ) {
          inventorySetQuantities(
            input: {
              name: "available"
              reason: "correction"
              ignoreCompareQuantity: true
              quantities: [{
                inventoryItemId: $inventoryItemId
                locationId: $locationId
                quantity: 0
              }]
            }
          ) {
            userErrors { message }
          }
        }
        `,
        { variables: { inventoryItemId, locationId: loc.id } },
      );
    }

    await admin.graphql(
      `
      mutation ActivateInventory(
        $inventoryItemId: ID!
        $locationId: ID!
      ) {
        inventoryActivate(
          inventoryItemId: $inventoryItemId
          locationId: $locationId
        ) {
          userErrors { message }
        }
      }
      `,
      { variables: { inventoryItemId, locationId: fsLocationId } },
    );
  }

  await db.shopSetup.update({
    where: { shop },
    data: { step2Completed: true },
  });

  return null;
}

export default function DashboardProducts() {
  const { addedProducts = [], availableProducts = [] } = useLoaderData();
  const actionData = useActionData();
  const [showProducts, setShowProducts] = useState(false);

  return (
    <div style={{ padding: 24 }}>
      <h1>Products Dashboard</h1>

      <button onClick={() => setShowProducts(true)}>Add Product</button>

      <table border="1" style={{ marginTop: 20 }}>
        <thead>
          <tr>
            <th>Product</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Inventory</th>
          </tr>
        </thead>
        <tbody>
          {addedProducts.map((p) => (
            <tr key={`${p.productId}-${p.variantId}`}>
              <td>{p.productTitle}</td>
              <td>{p.variantTitle}</td>
              <td>{p.sku || "-"}</td>
              <td>
                <Form method="post">
                  <input type="hidden" name="_intent" value="updateInventory" />
                  <input type="hidden" name="variantId" value={p.variantId} />
                  <input type="hidden" name="sku" value={p.sku} />
                  <button type="submit">Update Inventory</button>
                </Form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showProducts && (
        <Form method="post">
          <h2>Select Products</h2>

          {availableProducts.map((p) => (
            <label key={p.variantId} style={{ display: "block" }}>
              <input
                type="checkbox"
                name="products"
                value={JSON.stringify(p)}
              />
              {p.title}
            </label>
          ))}

          <button type="submit">Add Selected Products</button>
        </Form>
      )}

      {actionData?.error && <p style={{ color: "red" }}>{actionData.error}</p>}
    </div>
  );
}
