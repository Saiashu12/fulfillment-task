// app.setup.step2.jsx
import { authenticate } from "../shopify.server";
import { useLoaderData, useActionData, Form } from "react-router";
import { useState } from "react";
import { useNavigate } from "react-router";
import { redirect } from "react-router";
import db from "../db.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopSetup = await db.shopSetup.findUnique({
    where: { shop },
  });
  if (
    !shopSetup ||
    !shopSetup.step1Completed ||
    !shopSetup.fulfillmentServiceId
  ) {
    return {
      products: [],
      productCount: 0,
      setupError:
        "Fulfillment service is not configured. Please complete Step 1 first.",
    };
  }

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
  console.log("Products from Shopify:", productsJson);

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

  const productCount = await db.products.count();

  return { products, productCount };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopSetup = await db.shopSetup.findUnique({
    where: { shop },
  });

  if (!shopSetup || !shopSetup.fulfillmentServiceId) {
    return {
      error:
        "Fulfillment service is not configured. Please complete the previous step first.",
    };
  }

  const formData = await request.formData();
  const selected = formData.getAll("products");

  if (!selected.length) {
    return { error: "Please select at least one product." };
  }
  const parsedSelected = selected.map((item) => JSON.parse(item));

  const data = parsedSelected.map((parsed) => ({
    ...parsed,
    fulfillmentServiceId: shopSetup.fulfillmentServiceId,
  }));
  const existing = await db.products.findMany({
    where: {
      OR: data.map((d) => ({
        productId: d.productId,
        variantId: d.variantId,
      })),
    },
  });

  if (existing.length > 0) {
    const existingTitles = existing.map((p) => p.title).join(", ");

    return {
      error:
        existing.length === 1
          ? `This product is already added: ${existingTitles}`
          : `These products are already added: ${existingTitles}`,
    };
  }

  await db.products.createMany({
    data,
  });
  await db.shopSetup.update({
    where: { shop },
    data: {
      step2Completed: true,
    },
  });

  try {
    const fulfillmentServiceId = shopSetup.fulfillmentServiceId;

    const fsRes = await admin.graphql(
      `
      query GetFulfillmentServiceLocation($id: ID!) {
        fulfillmentService(id: $id) {
          id
          serviceName
          location {
            id
          }
        }
      }
    `,
      {
        variables: {
          id: fulfillmentServiceId,
        },
      },
    );

    const fsJson = await fsRes.json();
    console.log("Fulfillment service info:", fsJson);

    const fs = fsJson.data?.fulfillmentService;
    const locationId = fs?.location?.id;

    if (!locationId) {
      console.error("No location found for fulfillment service", fsJson);
      return redirect("/app/dashboard/products");
    }
    const variantIds = parsedSelected.map((p) => p.variantId);

    const inventoryItemsRes = await admin.graphql(
      `
      query GetInventoryItemsForVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            inventoryItem {
              id
            }
          }
        }
      }
    `,
      {
        variables: {
          ids: variantIds,
        },
      },
    );

    const inventoryItemsJson = await inventoryItemsRes.json();
    console.log("Inventory items for variants:", inventoryItemsJson);

    const nodes = inventoryItemsJson.data?.nodes ?? [];

    const inventoryItemMap = new Map();
    nodes.forEach((node) => {
      if (node && node.inventoryItem) {
        inventoryItemMap.set(node.id, node.inventoryItem.id);
      }
    });

    const locationsRes = await admin.graphql(`
  query {
    locations(first: 10) {
      nodes {
        id
        name
        fulfillsOnlineOrders
      }
    }
  }
`);

    const locationsJson = await locationsRes.json();
    const merchantLocations = locationsJson.data.locations.nodes;

    for (const variantId of variantIds) {
      const inventoryItemId = inventoryItemMap.get(variantId);
      if (!inventoryItemId) {
        console.warn(
          `No inventoryItemId found for variant ${variantId}, skipping inventoryActivate.`,
        );
        continue;
      }

      for (const location of merchantLocations) {
        if (location.id === locationId) continue;

        const removeRes = await admin.graphql(
          `
      mutation RemoveInventory(
        $inventoryItemId: ID!
        $locationId: ID!
      ) {
        inventorySetQuantities(
          input: {
            name: "available"
            reason: "restock"
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
          {
            variables: {
              inventoryItemId,
              locationId: location.id,
            },
          },
        );

        const removeJson = await removeRes.json();

        const errors =
          removeJson.data?.inventorySetQuantities?.userErrors ?? [];

        if (errors.length > 0) {
          console.error(
            `RemoveInventory errors for variant ${variantId} at location ${location.id}:`,
            errors,
          );
        }
      }

      const activateRes = await admin.graphql(
        `
        mutation ActivateInventoryItemAtLocation(
          $inventoryItemId: ID!
          $locationId: ID!
        ) {
          inventoryActivate(
            inventoryItemId: $inventoryItemId
            locationId: $locationId
          ) {
            inventoryLevel {
              id
              item {
                id
              }
              location {
                id
              }
              quantities(names: ["available"]) {
                name
                quantity
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            inventoryItemId,
            locationId,
          },
        },
      );

      const activateJson = await activateRes.json();
      console.log(
        `inventoryActivate result for variant ${variantId}:`,
        activateJson,
      );

      const userErrors = activateJson.data?.inventoryActivate?.userErrors ?? [];
      if (userErrors.length > 0) {
        console.error(
          `inventoryActivate userErrors for variant ${variantId}:`,
          userErrors,
        );
      }
    }
  } catch (err) {
    console.error(
      "Error while associating products with fulfillment service location:",
      err,
    );
  }

  return redirect("/app/dashboard/products");
}

export default function AdditionalPage() {
  const { products, productCount, setupError } = useLoaderData();
  const actionData = useActionData();
  const [showProducts, setShowProducts] = useState(false);
  const navigate = useNavigate();

  console.log(productCount);

  if (setupError) {
    return (
      <div>
        <h1>Additional Page</h1>
        <p style={{ color: "red" }}>{setupError}</p>
      </div>
    );
  }

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

          {actionData?.error && (
            <p style={{ color: "red" }}>{actionData.error}</p>
          )}
        </Form>
      )}

      {productCount >= 1 ? (
        <button
          style={{ marginBottom: "15px" }}
          onClick={() => navigate("/app/dashboard/products")}
        >
          Dashboard
        </button>
      ) : (
        <p style={{ color: "red" }}>We need to add at least one product</p>
      )}
    </div>
  );
}
