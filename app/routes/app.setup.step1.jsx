// app.setup.step1.jsx
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const CARRIER_SERVICE_NAME = "Custom Carrier Service";
const FULFILLMENT_SERVICE_NAME = "Custom Fulfillment Service";
const CALLBACK_URL = "https://stolen-empty-orlando-mardi.trycloudflare.com";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const existingSetup = await db.shopSetup.findUnique({
    where: { shop },
  });

  let carrierServiceId = existingSetup?.carrierServiceId ?? null;
  let fulfillmentServiceId = existingSetup?.fulfillmentServiceId ?? null;
  let orderWebhookId = existingSetup?.orderWebhookId ?? null;

  if (
    existingSetup?.step1Completed &&
    carrierServiceId &&
    fulfillmentServiceId &&
    orderWebhookId
  ) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "Step 1 already completed",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (!carrierServiceId) {
    const carrierRes = await admin.graphql(
      `
      mutation CarrierServiceCreate(
        $input: DeliveryCarrierServiceCreateInput!
      ) {
        carrierServiceCreate(input: $input) {
          carrierService {
            id
            name
            active
            callbackUrl
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
          input: {
            name: CARRIER_SERVICE_NAME,
            callbackUrl:
              "https://eclipse-supervisor-suburban-inc.trycloudflare.com/carrier-service",
            active: true,
            supportsServiceDiscovery: true,
          },
        },
      },
    );

    const carrierData = await carrierRes.json();
    console.dir(carrierData, { depth: null });

    const carrierPayload = carrierData.data?.carrierServiceCreate;
    if (!carrierPayload) {
      throw new Error("Failed to create carrier service: No payload returned");
    }

    const carrierUserErrors = carrierPayload.userErrors ?? [];

    if (carrierUserErrors.length > 0) {
      console.error("Carrier service create userErrors:", carrierUserErrors);

      const messages = carrierUserErrors.map((e) => e.message);
      const alreadyConfigured = messages.some((m) =>
        m.toLowerCase().includes("already configured"),
      );

      if (!alreadyConfigured) {
        throw new Error(
          "Failed to create carrier service: " + messages.join("; "),
        );
      }
      const carrierListRes = await admin.graphql(
        `
        query CarrierServices($first: Int!, $query: String) {
          carrierServices(first: $first, query: $query) {
            edges {
              node {
                id
                name
                active
                callbackUrl
              }
            }
          }
        }
      `,
        {
          variables: {
            first: 50,
            query: `name:${JSON.stringify(CARRIER_SERVICE_NAME)}`,
          },
        },
      );

      const carrierListData = await carrierListRes.json();
      const carrierNodes =
        carrierListData.data?.carrierServices?.edges?.map(
          (edge) => edge.node,
        ) ?? [];

      const existingCarrier = carrierNodes.find(
        (c) => c.name === CARRIER_SERVICE_NAME,
      );

      if (!existingCarrier) {
        throw new Error(
          "Carrier service reported as 'already configured' but could not be found via carrierServices query.",
        );
      }

      carrierServiceId = existingCarrier.id;
    } else {
      carrierServiceId = carrierPayload.carrierService.id;
    }
  }

  if (!fulfillmentServiceId) {
    const fulfillmentRes = await admin.graphql(
      `
      mutation FulfillmentServiceCreate(
        $name: String!
        $callbackUrl: URL!
        $trackingSupport: Boolean
        $inventoryManagement: Boolean
        $requiresShippingMethod: Boolean
      ) {
        fulfillmentServiceCreate(
          name: $name
          callbackUrl: $callbackUrl
          trackingSupport: $trackingSupport
          inventoryManagement: $inventoryManagement
          requiresShippingMethod: $requiresShippingMethod
        ) {
          fulfillmentService {
            id
            serviceName
            callbackUrl
            inventoryManagement
            trackingSupport
            requiresShippingMethod
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
          name: FULFILLMENT_SERVICE_NAME,
          callbackUrl: CALLBACK_URL,
          trackingSupport: true,
          inventoryManagement: true,
          requiresShippingMethod: true,
        },
      },
    );

    const fulfillmentData = await fulfillmentRes.json();
    const fulfillmentPayload = fulfillmentData.data?.fulfillmentServiceCreate;

    if (!fulfillmentPayload) {
      throw new Error(
        "Failed to create fulfillment service: No payload returned",
      );
    }

    const fulfillmentUserErrors = fulfillmentPayload.userErrors ?? [];

    if (fulfillmentUserErrors.length > 0) {

      const messages = fulfillmentUserErrors.map((e) => e.message);
      const nameTaken = messages.some((m) =>
        m.toLowerCase().includes("name has already been taken"),
      );

      if (!nameTaken) {
        throw new Error(
          "Failed to create fulfillment service: " + messages.join("; "),
        );
      }

      const fulfillmentListRes = await admin.graphql(
        `
        query FulfillmentServiceList {
          shop {
            fulfillmentServices {
              id
              callbackUrl
              fulfillmentOrdersOptIn
              permitsSkuSharing
              handle
              inventoryManagement
              serviceName
            }
          }
        }
      `,
      );

      const fulfillmentListData = await fulfillmentListRes.json();
      const fsNodes = fulfillmentListData.data?.shop?.fulfillmentServices ?? [];

      const existingFs = fsNodes.find(
        (fs) => fs.serviceName === FULFILLMENT_SERVICE_NAME,
      );
      if (!existingFs) {
        throw new Error(
          "Fulfillment service name reported as 'already taken' but could not be found via shop.fulfillmentServices.",
        );
      }
      fulfillmentServiceId = existingFs.id;
    } else {
      fulfillmentServiceId = fulfillmentPayload.fulfillmentService.id;
    }
  }
  if (!orderWebhookId) {
    const webhookRes = await admin.graphql(
      `
      mutation WebhookSubscriptionCreate($callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: ORDERS_CREATE
          webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
        ) {
          webhookSubscription {
            id
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
          callbackUrl: CALLBACK_URL,
        },
      },
    );

    const webhookData = await webhookRes.json();
    console.dir(webhookData, { depth: null });

    const webhookPayload = webhookData.data?.webhookSubscriptionCreate;

    if (!webhookPayload) {
      throw new Error("Failed to create order webhook: No payload returned");
    }

    if (webhookPayload.userErrors?.length) {
      console.error("Webhook create userErrors:", webhookPayload.userErrors);
      throw new Error(
        "Failed to create order webhook: " +
          webhookPayload.userErrors.map((e) => e.message).join("; "),
      );
    }

    orderWebhookId = webhookPayload.webhookSubscription.id;
  }

  await db.shopSetup.upsert({
    where: { shop },
    update: {
      carrierServiceId,
      fulfillmentServiceId,
      orderWebhookId,
      step1Completed: true,
    },
    create: {
      shop,
      carrierServiceId,
      fulfillmentServiceId,
      orderWebhookId,
      step1Completed: true,
    },
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: "Step 1 completed successfully",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
};

export default function Step1() {
  const fetcher = useFetcher();

  const isLoading = fetcher.state === "submitting";

  return (
    <div style={{ padding: "24px", maxWidth: "700px" }}>
      <h1>Setup – Step 1</h1>

      <p>Clicking the button below will:</p>

      <ul>
        <li>Create a Carrier Service</li>
        <li>Create a Fulfillment Service</li>
        <li>Register an Order Created webhook</li>
      </ul>

      <fetcher.Form method="post">
        <button
          type="submit"
          disabled={isLoading}
          style={{
            marginTop: "16px",
            padding: "10px 16px",
            backgroundColor: "#000",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          {isLoading ? "Initializing..." : "Initialize Services"}
        </button>
      </fetcher.Form>

      {fetcher.data?.success && (
        <p style={{ marginTop: "12px", color: "green" }}>
          {fetcher.data.message ?? "Step 1 completed successfully"}
        </p>
      )}
    </div>
  );
}
