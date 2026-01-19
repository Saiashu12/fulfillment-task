//app.dashboard.orders.jsx
import { useLoaderData, Form } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);

  const orders = await db.order.findMany({
    orderBy: { createdAt: "desc" },
  });

  return { orders };
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const orderId = formData.get("orderId");

  if (!orderId) {
    return { error: "Missing orderId" };
  }
  const res = await fetch("http://localhost:4000/fulfill-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });

  const fulfillmentData = await res.json();

  if (!res.ok) {
    return { error: "Fulfillment failed on Node server" };
  }

  const { tracking_number, tracking_url, carrier } = fulfillmentData;
  const fulfillmentOrderRes = await admin.graphql(
    `
    query GetOrderWithFulfillmentOrders($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 5) {
          edges {
            node {
              id
              status
              requestStatus
            }
          }
        }
      }
    }
    `,
    {
      variables: {
        id: `gid://shopify/Order/${orderId}`,
      },
    },
  );

  const fulfillmentOrderJson = await fulfillmentOrderRes.json();

  const fulfillmentOrderId =
    fulfillmentOrderJson.data.order.fulfillmentOrders.edges[0]?.node.id;

  if (!fulfillmentOrderId) {
    return { error: "No fulfillment order found in Shopify" };
  }

  const fulfillRes = await admin.graphql(
    `
    mutation FulfillOrder(
      $fulfillmentOrderId: ID!
      $trackingCompany: String!
      $trackingNumber: String!
      $trackingUrl: URL
    ) {
      fulfillmentCreate(
        fulfillment: {
          notifyCustomer: false
          trackingInfo: {
            company: $trackingCompany
            number: $trackingNumber
            url: $trackingUrl
          }
          lineItemsByFulfillmentOrder: [
            {
              fulfillmentOrderId: $fulfillmentOrderId
            }
          ]
        }
        message: "Fulfilled by custom app"
      ) {
        fulfillment {
          id
          status
          trackingInfo {
            company
            number
            url
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
        fulfillmentOrderId,
        trackingCompany: carrier,
        trackingNumber: tracking_number,
        trackingUrl: tracking_url,
      },
    },
  );

  const fulfillJson = await fulfillRes.json();

  if (fulfillJson.data.fulfillmentCreate.userErrors.length > 0) {
    return {
      error: fulfillJson.data.fulfillmentCreate.userErrors
        .map((e) => e.message)
        .join(", "),
    };
  }

  return { success: true };
}

export default function DashboardOrders() {
  const { orders } = useLoaderData();

  return (
    <div>
      <h2>Orders</h2>

      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>Order</th>
            <th>Line Items</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.orderNumber || o.id}</td>
              <td>{o.lineItemCount}</td>
              <td>{o.status}</td>
              <td>
                {o.status !== "FULFILLED" && (
                  <Form method="post">
                    <input type="hidden" name="orderId" value={o.id} />
                    <button type="submit">Fulfill Order</button>
                  </Form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
