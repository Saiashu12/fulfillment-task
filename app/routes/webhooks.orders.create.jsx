import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, session } = await authenticate.webhook(request);
  const shop = session.shop;

  const orderId = payload.id.toString();
  const orderNumber = payload.name;

  const allLineItems = payload.line_items || [];

  const shopSetup = await db.shopSetup.findUnique({
    where: { shop },
  });

  if (!shopSetup?.fulfillmentServiceId) {
    return new Response("Fulfillment service not configured", { status: 200 });
  }
  const ownedProducts = await db.products.findMany({
    where: {
      fulfillmentServiceId: shopSetup.fulfillmentServiceId,
    },
  });

  const ownedVariantIds = new Set(ownedProducts.map((p) => p.variantId));

  const ownedLineItems = allLineItems.filter((li) =>
    ownedVariantIds.has(`gid://shopify/ProductVariant/${li.variant_id}`),
  );

  if (ownedLineItems.length === 0) {
    return new Response("No owned items in order", { status: 200 });
  }
  const rfRes = await fetch("http://localhost:4000/request-fulfillment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      lineItems: allLineItems.map((li) => ({
        id: li.id.toString(),
        sku: li.sku,
        quantity: li.quantity,
      })),
    }),
  });

  const rfData = await rfRes.json();

  if (!rfData.accepted) {
    console.log(
      `Order ${orderId} rejected (cart size = ${allLineItems.length})`,
    );
    return new Response("Fulfillment rejected", { status: 200 });
  }

  await db.order.create({
    data: {
      id: orderId,
      shop,
      orderNumber,
      lineItemCount: ownedLineItems.length,
      status: "REQUESTED",
    },
  });

  await db.orderLineItem.createMany({
    data: ownedLineItems.map((li) => ({
      id: li.id.toString(),
      orderId,
      sku: li.sku,
      quantity: li.quantity,
    })),
  });

  return new Response("ok", { status: 200 });
};
